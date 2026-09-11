import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity, Result } from '../../src/shared/types';
import { applyMigrations, anotherSession, guest, seedUser } from '../helpers/db';
import { DesignWorkspace, measureSource, type Measurement } from '../../src/worker/design/workspace';
import {
  MAX_ROUNDS_PER_DESIGN_LAB,
  type DesignLab,
  type Surface,
  type ViewRender,
} from '../../src/worker/design/types';
import { SCENE_SOURCE_EXAMPLE } from '../../src/worker/design/scene';
import { createRaster, imageStats, setPixel } from '../../src/worker/design/raster';

/**
 * The design lab: `measureSource` on its own, then the workspace over real D1
 * and KV.
 *
 * Two properties carry most of the weight here. The first is that measurement is
 * *total* — it returns a `Result` for anything at all, including sources written
 * to break it, because an author's typo must come back as a message rather than
 * as a stack trace inside the Worker. The second is that a lab is scoped to the
 * session that made it, on every path that reaches a row: `load`, `source`,
 * `history` and `renderBytes` each have to answer "not yours" rather than
 * answer anyway, so the boundary is pinned on all four.
 *
 * The vision half of `submit` is exercised against the real provider path rather
 * than a stub: the test pool configures no multimodal model, so `visionChat`
 * fails with `missing-credential` before any network call, which is exactly the
 * outage the review is designed to degrade through.
 */

beforeAll(applyMigrations);

/**
 * A scene round renders four 512px views, PNG-encodes them plus a contact sheet,
 * and writes them to KV. That is seconds of real work rather than the default
 * five, so the tests that do it say so explicitly.
 */
const RENDER_TIMEOUT_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Three circles, each with a name, on a canvas with a declared viewBox. */
const THREE_CIRCLES = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle id="sun" cx="40" cy="40" r="20" fill="#ffcc00"/>
  <circle id="moon" cx="140" cy="60" r="18" fill="#cccccc"/>
  <circle id="lamp" cx="100" cy="150" r="12" fill="#cc4444"/>
</svg>`;

/** The same drawing with every name stripped off it. */
const UNNAMED_CIRCLES = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="40" cy="40" r="20" fill="#ffcc00"/>
  <circle cx="140" cy="60" r="18" fill="#cccccc"/>
</svg>`;

/** A source that is not a document at all: the closing tag does not match. */
const MALFORMED_SVG = '<svg width="10" height="10"><circle r="4"></svg>';

/** A scene whose parts parent each other in a loop. */
const CYCLIC_SCENE = `scene "loop" unit=m

part a kind=box size=1,1,1 parent=b
part b kind=box size=1,1,1 parent=a
`;

/** A scene with no `scene` directive, which the language requires first. */
const HEADLESS_SCENE = 'part a kind=box size=1,1,1';

function nestedGroups(depth: number): string {
  return `<svg width="10" height="10">${'<g>'.repeat(depth)}${'</g>'.repeat(depth)}</svg>`;
}

/** Unwraps a success, failing the test with the reason when it is not one. */
function valueOf<T>(result: Result<T>): T {
  expect(result.ok, result.ok ? '' : `${result.kind}: ${result.message}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/** The pure call, with the `Result` assertion folded in. */
function measure(surface: Surface, source: string, renders: ViewRender[] | null): Measurement {
  return valueOf(measureSource(surface, source, renders));
}

/**
 * `renders` is required by the signature, so omitting it outright is only
 * reachable from an untyped caller. The runtime tolerates it, and this pins that
 * it still means "no pixels were produced".
 */
const measureWithoutRenders = measureSource as unknown as (
  surface: Surface,
  source: string,
  renders?: ViewRender[] | null,
) => Result<Measurement>;

/** A scene tuned so that every criterion below is settled by a host check. */
const LAMP_CRITERIA = ['exactly two cylinders', 'the shade is part of the lamp', 'exactly one root'];

const workspace = (): DesignWorkspace => new DesignWorkspace(env);

async function newLab(
  identity: Identity,
  input: { surface: Surface; criteria: string[]; title?: string },
): Promise<DesignLab> {
  return valueOf(
    await workspace().create(identity, {
      title: input.title ?? 'a lab',
      surface: input.surface,
      criteria: input.criteria,
    }),
  );
}

/** `-1` for a missing row, so an absent lab cannot be mistaken for a fresh one. */
async function roundsOf(labId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT rounds FROM design_labs WHERE id = ?')
    .bind(labId)
    .first<{ rounds: number }>();
  return Number(row?.rounds ?? -1);
}

/* ================================================================== */
/* Half one: measuring a source, with no bindings in sight             */
/* ================================================================== */

describe('measuring a drawing', () => {
  it('counts the shapes and measures every element that has a name', () => {
    const found = measure('vector', THREE_CIRCLES, null);
    const svg = found.measures.svg!;

    expect(svg.digest.counts.circle).toBe(3);
    expect(found.measures.scene).toBeNull();
    expect(found.measures.surface).toBe('vector');

    // The ids are the handles a criterion refers to, so each one has to come
    // back with the box it actually occupies.
    expect(Object.keys(svg.elementBounds).sort()).toEqual(['lamp', 'moon', 'sun']);
    expect(svg.elementBounds.sun).toEqual({ min: [20, 20], max: [60, 60] });
    expect(svg.elementBounds.moon).toEqual({ min: [122, 42], max: [158, 78] });
  });

  it('leaves an unnamed element out rather than inventing a box for it', () => {
    // A criterion can only name something that has a name, so an element with no
    // id is absent from the bounds table. Giving it a placeholder box at the
    // origin would make it nameable by position and would answer questions about
    // it that nobody can ask.
    const found = measure('vector', UNNAMED_CIRCLES, null);
    expect(found.measures.svg!.digest.counts.circle).toBe(2);
    expect(found.measures.svg!.elementBounds).toEqual({});
    expect(found.measures.svg!.digest.ids).toEqual([]);
  });

  it('reports no pixels when nothing was rendered', () => {
    expect(measure('vector', THREE_CIRCLES, null).measures.pixels).toBeNull();
    expect(valueOf(measureWithoutRenders('vector', THREE_CIRCLES)).measures.pixels).toBeNull();
    // An empty render list means "nothing was rendered", not "a measurement with
    // no views in it" — the two would read the same to a caller otherwise.
    expect(measure('vector', THREE_CIRCLES, []).measures.pixels).toBeNull();
  });

  it('carries the supplied renders through, named', () => {
    const raster = createRaster(8, 8, [255, 255, 255, 255]);
    setPixel(raster, 3, 3, [0, 0, 0, 255]);
    const renders: ViewRender[] = [{ view: 'canvas', raster, stats: imageStats(raster) }];

    const found = measure('vector', THREE_CIRCLES, renders);
    const pixels = found.measures.pixels!;
    expect(pixels.views.map((view) => view.view)).toEqual(['canvas']);
    expect(pixels.views[0]!.stats.width).toBe(8);
    expect(pixels.views[0]!.stats.blank).toBe(false);
    expect(found.views).toHaveLength(1);
  });
});

describe('measuring a scene', () => {
  it('records the assembly and renders it without being given a renderer', () => {
    const found = measure('scene', SCENE_SOURCE_EXAMPLE, null);
    const scene = found.measures.scene!;

    expect(found.measures.svg).toBeNull();
    expect(scene.parents).toEqual({ lamp: null, base: 'lamp', post: 'base', shade: 'post' });
    expect(scene.digest.partCount).toBe(4);

    // The asymmetry with the vector surface, pinned: a scene renders itself, so
    // the pixels exist even though the caller passed no renders at all.
    expect(found.views.map((render) => render.view)).toEqual(['front', 'right', 'top', 'iso']);
    expect(found.measures.pixels!.views.map((view) => view.view)).toEqual(['front', 'right', 'top', 'iso']);
    expect(found.graph).not.toBeNull();
  });

  it('records the loop and renders nothing at all', () => {
    const found = measure('scene', CYCLIC_SCENE, null);

    expect(found.issues.map((issue) => issue.code)).toContain('cycle');
    // A walk that never terminates is worse than a round with no render, so the
    // mesh is not built and no view is drawn — but the graph survives, because
    // the author needs something to fix.
    expect(found.views).toEqual([]);
    expect(found.measures.pixels).toBeNull();
    expect(found.graph).not.toBeNull();
    expect(found.measures.scene!.parents).toEqual({ a: 'b', b: 'a' });
  });
});

describe('a source that will not parse', () => {
  it('fails rather than reporting an empty successful measurement, on both surfaces', () => {
    for (const [surface, source] of [
      ['vector', MALFORMED_SVG],
      ['scene', HEADLESS_SCENE],
      ['vector', ''],
      ['scene', ''],
    ] as [Surface, string][]) {
      const result = measureSource(surface, source, null);
      // The whole point of the two-track design: an unreadable source is not a
      // drawing that measured zero of everything.
      expect(result.ok, `${surface}: ${JSON.stringify(source.slice(0, 24))}`).toBe(false);
      if (result.ok) continue;
      expect(result.kind).toBe('invalid-argument');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('refuses a document nested past the depth limit instead of running out of stack', () => {
    const result = measureSource('vector', nestedGroups(300), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('nests');
  });

  it('states where the syntax error is, so it can be found', () => {
    const result = measureSource('vector', MALFORMED_SVG, null);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('line 1');
  });
});

describe('measureSource never throws', () => {
  const cases: { name: string; surface: Surface; source: string }[] = [
    { name: 'an empty string', surface: 'vector', source: '' },
    { name: 'an empty string', surface: 'scene', source: '' },
    { name: 'a hundred thousand angle brackets', surface: 'vector', source: '<'.repeat(100_000) },
    { name: 'a hundred thousand angle brackets', surface: 'scene', source: '<'.repeat(100_000) },
    { name: 'three hundred nested groups', surface: 'vector', source: nestedGroups(300) },
    {
      name: '__proto__ as an id',
      surface: 'vector',
      source: '<svg width="10" height="10"><circle id="__proto__" cx="5" cy="5" r="2"/></svg>',
    },
    { name: 'a part naming itself as its parent', surface: 'scene', source: 'scene "self" unit=m\npart a kind=box size=1,1,1 parent=a\n' },
  ];

  for (const { name, surface, source } of cases) {
    it(`returns a Result for ${name} on the ${surface} surface`, () => {
      let result: Result<Measurement>;
      try {
        result = measureSource(surface, source, null);
      } catch (cause) {
        throw new Error(`measureSource threw on ${name}: ${String(cause)}`);
      }
      expect(typeof result.ok).toBe('boolean');
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    });
  }

  it('treats __proto__ as an id like any other, and keeps every other name too', () => {
    const found = measure(
      'vector',
      '<svg width="10" height="10"><circle id="__proto__" cx="5" cy="5" r="2"/><rect id="frame" width="8" height="8"/></svg>',
      null,
    );
    // The element is real and its name reaches the digest, which is what a
    // "has an element named" criterion is checked against.
    expect(found.measures.svg!.digest.ids).toContain('__proto__');
    // The danger is not only that the hostile name is lost: writing through the
    // inherited accessor replaces the table's prototype, so every *other* entry
    // is affected too. Both names must survive together.
    expect(Object.keys(found.measures.svg!.elementBounds).sort()).toEqual(['__proto__', 'frame']);
    expect(found.measures.svg!.elementBounds['frame']).toBeDefined();
  });

  // The keys of `elementBounds` are author-chosen strings, so the table is built
  // on a null prototype. On an object literal, `elementBounds['__proto__'] =
  // bounds` invokes the inherited setter instead of adding an entry: the table's
  // [[Prototype]] becomes the bounds object and the element vanishes from
  // `Object.keys` — which is precisely the channel `namesFor` in checks.ts
  // resolves a criterion's names through. The author would then be told their
  // element does not exist, having named it correctly.
  it('keeps the bounds of an element whose id is __proto__', () => {
    const found = measure('vector', '<svg width="10" height="10"><circle id="__proto__" cx="5" cy="5" r="2"/></svg>', null);
    const bounds = found.measures.svg!.elementBounds;

    expect(Object.keys(bounds)).toEqual(['__proto__']);
    // A null prototype is the mechanism, not incidental: it is what makes an
    // arbitrary author-chosen string safe as a key. Asserting it means a future
    // change back to an object literal fails here rather than in a picture
    // somebody cannot debug.
    expect(Object.getPrototypeOf(bounds)).toBeNull();
  });
});

describe('measuring the same source twice', () => {
  it('gives the same answer, so a criterion cannot change verdict between rounds', () => {
    const first = measure('scene', SCENE_SOURCE_EXAMPLE, null);
    const second = measure('scene', SCENE_SOURCE_EXAMPLE, null);
    expect(first.measures).toEqual(second.measures);
    expect(first.issues).toEqual(second.issues);
  });

  it('gives the same answer on the vector surface, renders included', () => {
    const raster = createRaster(6, 6, [255, 255, 255, 255]);
    const renders: ViewRender[] = [{ view: 'canvas', raster, stats: imageStats(raster) }];
    expect(measure('vector', THREE_CIRCLES, renders).measures).toEqual(
      measure('vector', THREE_CIRCLES, renders).measures,
    );
  });
});

/* ================================================================== */
/* Half two: the workspace, against real D1 and KV                     */
/* ================================================================== */

describe('create', () => {
  it('refuses a lab with no criteria, and writes no row', async () => {
    const identity = guest();
    for (const criteria of [[], [''], ['   '], ['\t', '  ']]) {
      const created = await workspace().create(identity, {
        title: 'a lab',
        surface: 'vector',
        criteria,
      });
      // Without a criterion there is nothing to check against and the round
      // becomes a question about whether the picture is nice.
      expect(created.ok, JSON.stringify(criteria)).toBe(false);
      if (!created.ok) expect(created.kind).toBe('invalid-argument');
    }

    const counted = await env.DB.prepare('SELECT COUNT(*) AS n FROM design_labs WHERE session_id = ?')
      .bind(identity.sessionId)
      .first<{ n: number }>();
    expect(Number(counted?.n ?? 0)).toBe(0);
  });

  it('trims each criterion and keeps at most twelve of them', async () => {
    const identity = guest();
    const criteria = Array.from({ length: 15 }, (_, i) => `  criterion ${i + 1}  `);
    const lab = await newLab(identity, { surface: 'vector', criteria: ['  exactly three circles  ', '   ', 'the moon is above the sun'] });

    expect(lab.criteria).toEqual(['exactly three circles', 'the moon is above the sun']);

    const long = await newLab(identity, { surface: 'vector', criteria });
    expect(long.criteria).toHaveLength(12);
    expect(long.criteria[0]).toBe('criterion 1');
    expect(long.criteria[11]).toBe('criterion 12');
  });
});

describe('load', () => {
  it('returns the lab to the session that made it', async () => {
    const identity = guest();
    const created = await newLab(identity, { surface: 'scene', criteria: LAMP_CRITERIA, title: 'a lamp' });

    const loaded = valueOf(await workspace().load(identity, created.id));
    expect(loaded).toMatchObject({
      id: created.id,
      title: 'a lamp',
      surface: 'scene',
      criteria: LAMP_CRITERIA,
      state: 'open',
      rounds: 0,
    });
    expect(loaded.createdAt).toBe(created.createdAt);
  });

  it('refuses the lab to any other session', async () => {
    const identity = guest();
    const created = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    const theirs = await workspace().load(guest(), created.id);
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.kind).toBe('missing-capability');
  });

  it('scopes the lab to the session even for a signed-in account', async () => {
    const identity = await seedUser();
    const created = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    const second = await workspace().load(anotherSession(identity), created.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.kind).toBe('missing-capability');
  });
});

describe('submit on a scene', () => {
  it(
    'measures, reviews, stores and charges exactly one round',
    async () => {
      const identity = guest();
      const lab = await newLab(identity, { surface: 'scene', criteria: LAMP_CRITERIA, title: 'a table lamp' });

      const submitted = await workspace().submit(identity, { lab, source: SCENE_SOURCE_EXAMPLE });
      const value = valueOf(submitted);

      // Every criterion, in the order it was written, each one answered.
      expect(value.review.verdicts.map((verdict) => verdict.criterion)).toEqual(LAMP_CRITERIA);
      expect(value.review.verdicts.every((verdict) => verdict.basis === 'deterministic')).toBe(true);
      expect(value.review.verdicts.every((verdict) => verdict.outcome === 'met')).toBe(true);
      expect(value.review.allVerified).toBe(true);
      // No vision provider is configured, so nothing was asked of one — proving
      // the clean path skips the model entirely rather than merely hiding it.
      expect(value.review.reviewedBy).toBeNull();
      expect(value.review.otherObservations).toEqual([]);

      expect(value.glb).toMatch(/\.glb$/);
      expect(Object.keys(value.renders).sort()).toEqual(['front', 'iso', 'right', 'sheet', 'top']);
      expect(value.unrendered).toBeNull();
      // The contact sheet is the revision's primary artifact when there is one,
      // because a single image showing every view is what a person wants to open.
      expect(value.revision.renderKey).toBe(value.renders.sheet);

      expect(await roundsOf(lab.id)).toBe(1);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    'degrades to the host verdicts when no vision provider is reachable',
    async () => {
      const identity = guest();
      const lab = await newLab(identity, {
        surface: 'scene',
        criteria: ['exactly two cylinders', 'the lamp reads as a sunset'],
        title: 'a table lamp',
      });

      const submitted = await workspace().submit(identity, { lab, source: SCENE_SOURCE_EXAMPLE });
      // A provider outage must not discard the checks that did run, and must not
      // fail the round: the host verdicts are the authoritative half.
      const value = valueOf(submitted);
      const [checked, perceptual] = value.review.verdicts;

      expect(checked!.criterion).toBe('exactly two cylinders');
      expect(checked!.basis).toBe('deterministic');
      expect(checked!.outcome).toBe('met');

      // The criterion nobody could settle is unverifiable, which is the safe
      // direction to fail in — it is never quietly promoted to met.
      expect(perceptual!.criterion).toBe('the lamp reads as a sunset');
      expect(perceptual!.outcome).toBe('unverifiable');
      expect(perceptual!.basis).toBe('unverifiable');
      expect(perceptual!.opinion).toBeNull();

      // The refusal travels to the caller, and the outage is recorded loudly
      // rather than being visible only as an absent opinion.
      expect(value.review.refused.map((refusal) => refusal.criterion)).toEqual(['the lamp reads as a sunset']);
      expect(value.review.reviewedBy).toBeNull();
      expect(value.review.otherObservations[0]).toContain('No vision review was obtained');
      expect(value.review.otherObservations[0]).toContain('waiting only on that answer');

      expect(await roundsOf(lab.id)).toBe(1);
    },
    RENDER_TIMEOUT_MS,
  );
});

describe('submit does not charge for a source it cannot read', () => {
  it('leaves the round counter alone when the source will not parse', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'scene', criteria: LAMP_CRITERIA });

    const submitted = await workspace().submit(identity, { lab, source: 'scene "lamp"\npart a kind=box size=1,1,1 parent=' });
    expect(submitted.ok).toBe(false);
    if (!submitted.ok) expect(submitted.kind).toBe('invalid-argument');

    // A syntax error is not an attempt at the drawing. Charging for it would let
    // a typo eat the budget the real work needs.
    expect(await roundsOf(lab.id)).toBe(0);
  });

  it('leaves the round counter alone for an unreadable drawing too', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    expect((await workspace().submit(identity, { lab, source: MALFORMED_SVG })).ok).toBe(false);
    expect(await roundsOf(lab.id)).toBe(0);
  });

  it('refuses a revision with no source at all', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    const submitted = await workspace().submit(identity, { lab, source: '   ' });
    expect(submitted.ok).toBe(false);
    if (!submitted.ok) expect(submitted.kind).toBe('invalid-argument');
    expect(await roundsOf(lab.id)).toBe(0);
  });
});

describe('submit refuses', () => {
  it('a lab that has been closed', async () => {
    const identity = guest();
    const created = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    const closed = valueOf(await workspace().close(identity, created.id, 'good enough'));
    expect(closed.state).toBe('closed');

    const reloaded = valueOf(await workspace().load(identity, created.id));
    expect(reloaded.state).toBe('closed');

    const submitted = await workspace().submit(identity, { lab: reloaded, source: THREE_CIRCLES });
    expect(submitted.ok).toBe(false);
    if (!submitted.ok) expect(submitted.kind).toBe('not-authorised');
    expect(await roundsOf(created.id)).toBe(0);
  });

  it('a lab whose round budget is spent, on the fifth submit', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    // Each round goes through `load` first, which is what a real caller does and
    // what makes the counter authoritative: the guard reads the lab it is given.
    for (let round = 1; round <= MAX_ROUNDS_PER_DESIGN_LAB; round++) {
      const current = valueOf(await workspace().load(identity, lab.id));
      expect(current.rounds).toBe(round - 1);
      const done = await workspace().submit(identity, { lab: current, source: THREE_CIRCLES });
      expect(done.ok, done.ok ? '' : done.message).toBe(true);
      expect(await roundsOf(lab.id)).toBe(round);
    }

    const spent = valueOf(await workspace().load(identity, lab.id));
    expect(spent.rounds).toBe(MAX_ROUNDS_PER_DESIGN_LAB);

    const refused = await workspace().submit(identity, { lab: spent, source: THREE_CIRCLES });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.kind).toBe('budget-exhausted');
      expect(refused.message).toContain(String(MAX_ROUNDS_PER_DESIGN_LAB));
    }
    expect(await roundsOf(lab.id)).toBe(MAX_ROUNDS_PER_DESIGN_LAB);
  });
});

describe('renderBytes', () => {
  it(
    'serves a key that belongs to this session',
    async () => {
      const identity = guest();
      const lab = await newLab(identity, { surface: 'scene', criteria: LAMP_CRITERIA });
      const value = valueOf(await workspace().submit(identity, { lab, source: SCENE_SOURCE_EXAMPLE }));

      const served = valueOf(await workspace().renderBytes(identity, lab.id, value.renders.sheet!));
      expect(served.mimeType).toBe('image/png');
      const header = new Uint8Array(served.bytes.slice(0, 8));
      expect([...header]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(served.bytes.byteLength).toBeGreaterThan(0);

      // Every view is reachable by its own key, not only through the sheet.
      const one = valueOf(await workspace().renderBytes(identity, lab.id, value.renders.front!));
      expect(one.bytes.byteLength).toBeGreaterThan(0);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    'refuses a key that belongs to another session',
    async () => {
      const owner = guest();
      const lab = await newLab(owner, { surface: 'scene', criteria: LAMP_CRITERIA });
      const value = valueOf(await workspace().submit(owner, { lab, source: SCENE_SOURCE_EXAMPLE }));

      // The key is checked against the session's own revisions rather than being
      // trusted, so knowing another session's key is not enough to read it.
      const thief = guest();
      const refused = await workspace().renderBytes(thief, lab.id, value.renders.sheet!);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.kind).toBe('not-authorised');

      // The same session, but a lab it does not own: still nothing allowed.
      const stranger = await workspace().renderBytes(thief, 'design_nonexistent', value.renders.sheet!);
      expect(stranger.ok).toBe(false);
      if (!stranger.ok) expect(stranger.kind).toBe('not-authorised');
    },
    RENDER_TIMEOUT_MS,
  );

  it('refuses a key that no revision of this session ever named', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    const refused = await workspace().renderBytes(identity, lab.id, `design/${lab.id}/nothing/sheet.png`);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.kind).toBe('not-authorised');
  });

  // The mesh is the 3D deliverable, so it has to be reachable through the only
  // accessor there is. It cannot come from `render_key`: that column holds one
  // key and a scene with views puts its contact sheet there. So the mesh key is
  // derived from the revision id, the same way `store` builds it, which keeps
  // the export servable in every case rather than only when nothing rendered.
  it('serves the exported mesh it just stored', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'scene', criteria: LAMP_CRITERIA });
    const value = valueOf(await workspace().submit(identity, { lab, source: SCENE_SOURCE_EXAMPLE }));

    // The mesh really is in the store under this key — `store` puts it there and
    // hands the key back — so when the assertion below fails it is the accessor
    // refusing, not the bytes having gone missing.
    expect(await env.CACHE.get(value.glb!, 'arrayBuffer')).not.toBeNull();

    const served = valueOf(await workspace().renderBytes(identity, lab.id, value.glb!));
    expect(served.mimeType).toBe('model/gltf-binary');
    expect(served.bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('history', () => {
  it('returns the revisions for the lab, oldest first', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    const submitted: string[] = [];
    for (let round = 0; round < 3; round++) {
      const current = valueOf(await workspace().load(identity, lab.id));
      const value = valueOf(await workspace().submit(identity, { lab: current, source: THREE_CIRCLES }));
      submitted.push(value.revision.id);
    }

    const rows = await workspace().history(identity, lab.id);
    expect(rows.map((row) => String(row.id))).toEqual(submitted);

    const times = rows.map((row) => String(row.created_at));
    expect([...times].sort()).toEqual(times);

    // The revision carries its own review, so history can be read without
    // re-running anything.
    const first = rows[0]!;
    expect(first.all_verified).toBe(1);
    expect(JSON.parse(String(first.verdicts))).toHaveLength(1);
    expect(JSON.parse(String(first.verdicts))[0].basis).toBe('deterministic');
  });

  it('returns nothing for a session that does not own the lab', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });
    valueOf(await workspace().submit(identity, { lab, source: THREE_CIRCLES }));

    expect(await workspace().history(guest(), lab.id)).toEqual([]);
    // And the same session's history is scoped by lab, not merely by session.
    expect(await workspace().history(identity, 'design_nonexistent')).toEqual([]);
  });
});

describe('why a revision has no pixels', () => {
  it('is recorded with the revision, so it outlives the turn that produced it', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });

    // No rasteriser is configured, which is the ordinary case for a deployment
    // with no Browser Rendering binding — and the one a person is most likely to
    // meet, because it is what they get the first time they ask for a drawing.
    const submitted = valueOf(await workspace().submit(identity, { lab, source: THREE_CIRCLES }));
    expect(submitted.unrendered).toBe(
      'No SVG rasteriser is configured, so no pixels were produced. Source checks still ran.',
    );

    // The property under test: the reason is in the row, not only in the value
    // returned to the caller that produced it. Everything that draws or reports
    // a revision afterwards reads the row, and a reason living only in a return
    // value is gone by the time anything looks — which is what made the client's
    // "why nothing was rendered" panel unreachable.
    const rows = await workspace().history(identity, lab.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unrendered).toBe(submitted.unrendered);
  });

  it(
    'is absent for a revision that did render',
    async () => {
      const identity = guest();
      const lab = await newLab(identity, { surface: 'scene', criteria: LAMP_CRITERIA });

      const submitted = valueOf(
        await workspace().submit(identity, { lab, source: SCENE_SOURCE_EXAMPLE }),
      );
      expect(submitted.unrendered).toBeNull();

      // Null in the column as well as in the value, which is the trade the
      // migration states plainly: a revision that rendered and one recorded
      // before the column existed are the same shape here, and `render_key`
      // rather than this column is what answers "did it render".
      const rows = await workspace().history(identity, lab.id);
      expect(rows[0]!.unrendered).toBeNull();
    },
    RENDER_TIMEOUT_MS,
  );
});

describe('source', () => {
  it('gives back the authored text verbatim to its own session', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });
    const value = valueOf(await workspace().submit(identity, { lab, source: THREE_CIRCLES }));

    const found = valueOf(await workspace().source(identity, lab.id, value.revision.id));
    // The source is the artifact, so it comes back as written rather than
    // re-serialised from anything that was derived from it.
    expect(found.source).toBe(THREE_CIRCLES);
    expect(found.surface).toBe('vector');
    expect(value.revision.sourceHash).toHaveLength(64);
  });

  it('refuses the source to another session', async () => {
    const identity = guest();
    const lab = await newLab(identity, { surface: 'vector', criteria: ['exactly three circles'] });
    const value = valueOf(await workspace().submit(identity, { lab, source: THREE_CIRCLES }));

    const refused = await workspace().source(guest(), lab.id, value.revision.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.kind).toBe('missing-capability');
  });
});

/* ------------------------------------------------------------------ */
