import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/worker/env';
import { ok, type Identity, type Result } from '../../src/shared/types';
import { hmacSign } from '../../src/worker/crypto';
import { MAX_ROUNDS_PER_DESIGN_LAB, REVIEW_CAVEAT, type DesignLab } from '../../src/worker/design/types';
import { DesignWorkspace, type SubmitResult } from '../../src/worker/design/workspace';
import { registerDesignRoutes } from '../../src/worker/routes/design';
import { createRaster, encodePng, setPixel } from '../../src/worker/design/raster';
import { applyMigrations } from '../helpers/db';

/**
 * Reading a recorded revision back over HTTP.
 *
 * `route.test.ts` covers `renderKeyFromPath` as a pure function, which is the
 * right place for the path gate and the wrong place for everything this route
 * actually exists to do. What is left is unreachable without a request: the
 * session that owns a revision and the one that does not take different
 * branches, the difference between them is the whole security property, and a
 * unit test that calls the handler cannot make a cookie cross the wire. So this
 * is the first test in the repo that drives a route over HTTP rather than
 * calling into it, and it stays deliberately small: one route, one cookie, and
 * assertions that fail loudly if the properties below break.
 *
 * The session cookie is the reason the test pool needs `SESSION_SECRET`. With
 * no secret, `resolveIdentity` mints a fresh guest id on every request, so no
 * two requests are ever the same session and none of this can be observed; the
 * binding in `vitest.config.ts` is what makes a guest addressable at all. Over
 * plain http — which is what a request built from a path resolves to — the
 * `__Host-` prefix is dropped, so the cookie is `anascummis_guest`.
 */

beforeAll(applyMigrations);

/**
 * The app under test.
 *
 * The real app is built in `routes/api.ts`, which registers this same function
 * at the same path, so nothing here is a stand-in for the route's own wiring.
 * It is a bare Hono because `index.ts` sets `X-Content-Type-Options` on every
 * response it serves: through the full app a dropped header call in the route
 * would be masked by the middleware, and the assertion that a refusal carries
 * the same headers as a success — the thing a previous change moved the header
 * calls above the id check to get — would pass against the very regression it
 * exists to catch.
 */
const app = new Hono<{ Bindings: Env }>();
registerDesignRoutes(app);

/** The session that owns the labs, and one that owns nothing of its own. */
const OWNER = 'guest_test0001';
const STRANGER = 'guest_test0002';

/** Settled by a host check, so a round costs no model call. */
const CRITERION = 'exactly three circles';

/** Three circles, each named: the criteria a host can settle exactly. */
const THREE_CIRCLES = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle id="sun" cx="40" cy="40" r="20" fill="#ffcc00"/>
  <circle id="moon" cx="140" cy="60" r="18" fill="#cccccc"/>
  <circle id="lamp" cx="100" cy="150" r="12" fill="#cc4444"/>
</svg>`;

/** Ids of the right shape that name nothing, for the absent cases. */
const NO_SUCH_LAB = `design_${'0'.repeat(32)}`;
const NO_SUCH_REVISION = `rev_${'0'.repeat(32)}`;

/* ------------------------------------------------------------------ */
/* Driving the route                                                   */
/* ------------------------------------------------------------------ */

/** Unwraps a success, failing the test with the reason when it is not one. */
function valueOf<T>(result: Result<T>): T {
  expect(result.ok, result.ok ? '' : `${result.kind}: ${result.message}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/**
 * A guest cookie signed the way `resolveIdentity` signs one.
 *
 * `signValue` is private, so the value is rebuilt from the same primitive it
 * uses — and the rebuild is verified by use rather than by inspection. A cookie
 * that did not verify would resolve to a brand new session, and every request
 * below would answer 404 instead of the revision it asked for.
 */
async function cookieFor(sessionId: string): Promise<string> {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured for the test pool.');
  const signed = `${sessionId}.${await hmacSign(secret, sessionId)}`;
  return `anascummis_guest=${encodeURIComponent(signed)}`;
}

/** A GET as the given guest. A path, so Hono makes it `http://localhost/...`. */
async function get(path: string, sessionId: string): Promise<Response> {
  return app.request(path, { headers: { cookie: await cookieFor(sessionId) } }, env);
}

const revisionPath = (labId: string, revisionId: string) =>
  `/api/design/${labId}/revisions/${revisionId}`;

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

interface Seeded {
  lab: DesignLab;
  rounds: SubmitResult[];
}

/**
 * A lab and its rounds, written through the workspace rather than over HTTP.
 *
 * Seeding through a route would make a failure in this file ambiguous between
 * the route being tested and the route that wrote the row; the workspace is
 * already covered by `workspace.test.ts`, so this file starts from rows that
 * are known good and asks only how they read back.
 */
async function seed(sessionId: string, rounds: number, withPixels = false): Promise<Seeded> {
  const identity: Identity = { kind: 'guest', sessionId };
  const workspace = new DesignWorkspace(env);
  const lab = valueOf(
    await workspace.create(identity, { title: 'a lab', surface: 'vector', criteria: [CRITERION] }),
  );

  const submitted: SubmitResult[] = [];
  for (let round = 0; round < rounds; round++) {
    // Reloaded each time because `submit` reads the counter off the lab it is
    // handed, which is what a real caller does between rounds.
    const current = valueOf(await workspace.load(identity, lab.id));
    submitted.push(
      valueOf(
        await workspace.submit(identity, {
          lab: current,
          source: THREE_CIRCLES,
          ...(withPixels ? { rasteriseSvg: standInRasteriser } : {}),
        }),
      ),
    );
  }
  return { lab, rounds: submitted };
}

/**
 * A stand-in for Browser Rendering, which no test binding provides.
 *
 * Without one a vector round records that nothing was rendered, which is the
 * honest answer and the one the assertions on `unrendered` need; with one the
 * same round produces a real render and records nothing, which is the other
 * half of that field. The picture is tiny because only its existence matters
 * here, and the workspace decodes whatever bytes it is handed.
 */
async function standInRasteriser(): Promise<Result<Uint8Array>> {
  const raster = createRaster(8, 8, [255, 255, 255, 255]);
  setPixel(raster, 3, 3, [0, 0, 0, 255]);
  return ok(await encodePng(raster));
}

/* ================================================================== */

describe('GET /api/design/:labId/revisions/:revisionId', () => {
  it('serves the revision to the session that owns it, in the shape the client spreads', async () => {
    const { lab, rounds } = await seed(OWNER, 1);
    const [submitted] = rounds;

    const response = await get(revisionPath(lab.id, submitted!.revision.id), OWNER);
    expect(response.status).toBe(200);
    const body = await bodyOf(response);

    // The key set, not a sample of it. This body is spread straight into
    // `DesignView`'s props, so a field dropped in a refactor is a panel that
    // quietly stops drawing: nothing throws, nothing is logged, and no other
    // test reads the wire shape. Every key here is one of those props.
    expect(Object.keys(body).sort()).toEqual([
      'allVerified',
      'caveat',
      'counts',
      'glbKey',
      'issues',
      'labId',
      'maxRounds',
      'otherObservations',
      'refused',
      'renderKeys',
      'reviewedAt',
      'reviewedBy',
      'revisionId',
      'round',
      'surface',
      'title',
      'unrendered',
      'verdicts',
    ]);

    expect(body.labId).toBe(lab.id);
    expect(body.revisionId).toBe(submitted!.revision.id);
    expect(body.title).toBe('a lab');
    expect(body.surface).toBe('vector');
    expect(body.round).toBe(1);
    expect(body.maxRounds).toBe(MAX_ROUNDS_PER_DESIGN_LAB);

    // The verdicts travel as they were recorded, with their basis attached:
    // a criterion settled by a host check must not arrive looking like one
    // nobody could settle.
    expect(body.verdicts).toHaveLength(1);
    expect((body.verdicts as Record<string, unknown>[])[0]).toMatchObject({
      criterion: CRITERION,
      basis: 'deterministic',
      outcome: 'met',
    });
    expect(body.allVerified).toBe(true);
    expect(body.caveat).toBe(REVIEW_CAVEAT);
    expect(body.reviewedBy).toBeNull();
    expect(body.otherObservations).toEqual([]);

    // The revision's own timestamp, which is also when it was reviewed: there
    // is no separate moment recorded, and an invented one would be a made-up
    // fact on a screen that is read as a record.
    expect(body.reviewedAt).toBe(submitted!.revision.createdAt);

    // A drawing has no mesh, and nothing was rendered for this one, so the
    // render map is empty rather than carrying a key to bytes that are not
    // there.
    expect(body.glbKey).toBeNull();
    expect(body.renderKeys).toEqual({});
  });

  it('reports the round a revision was submitted in, not the lab’s running total', async () => {
    const { lab, rounds } = await seed(OWNER, 2);
    const [first, second] = rounds;
    expect(first!.revision.id).not.toBe(second!.revision.id);

    // The lab has reached round 2 before either revision is fetched, which is
    // what makes the two assertions different statements. Reading `lab.rounds`
    // — the bug this pins — answers 2 for both of them, and puts round 1's
    // revision and round 1's criteria under the label "round 2".
    const current = valueOf(await new DesignWorkspace(env).load({ kind: 'guest', sessionId: OWNER }, lab.id));
    expect(current.rounds).toBe(2);

    const one = await bodyOf(await get(revisionPath(lab.id, first!.revision.id), OWNER));
    expect(one.revisionId).toBe(first!.revision.id);
    expect(one.round).toBe(1);

    const two = await bodyOf(await get(revisionPath(lab.id, second!.revision.id), OWNER));
    expect(two.revisionId).toBe(second!.revision.id);
    expect(two.round).toBe(2);
  });

  it('answers another session’s revision exactly as it answers one that never existed', async () => {
    const { lab, rounds } = await seed(OWNER, 1);
    const real = rounds[0]!.revision.id;

    // The stranger owns a lab of their own, so their request gets past the lab
    // lookup and is answered by the revision lookup — the branch under test,
    // and the one an attacker who has been handed a real revision id reaches.
    const theirs = await seed(STRANGER, 0);
    const wrongSession = await get(revisionPath(theirs.lab.id, real), STRANGER);
    const neverExisted = await get(revisionPath(lab.id, NO_SUCH_REVISION), OWNER);
    const wrongBody = await wrongSession.text();
    const absentBody = await neverExisted.text();

    expect(wrongSession.status).toBe(404);
    expect(neverExisted.status).toBe(404);
    // Pinned to the branch the comparison is about, so two empty bodies cannot
    // satisfy it by agreeing about nothing.
    expect(JSON.parse(wrongBody)).toEqual({
      error: 'missing-capability',
      message: 'No such revision in this lab.',
    });

    // Byte-identical, not merely both 404. Any difference at all — a different
    // sentence, an extra field, a different status — would tell the stranger
    // which of the two happened, and that is a fact about the owner's work.
    expect(wrongBody).toBe(absentBody);

    // The same holds one level up: a lab this session cannot see is refused in
    // the same words as a lab that was never created, so a lab id cannot be
    // probed for existence either.
    const theirLab = await get(revisionPath(lab.id, real), STRANGER);
    const noLab = await get(revisionPath(NO_SUCH_LAB, real), STRANGER);
    const theirBody = await theirLab.text();
    expect(theirLab.status).toBe(404);
    expect(JSON.parse(theirBody)).toMatchObject({ error: 'missing-capability' });
    expect(theirBody).toBe(await noLab.text());
  });

  it('refuses a malformed id before it looks anything up', async () => {
    const { lab, rounds } = await seed(OWNER, 1);
    const real = rounds[0]!.revision.id;

    const malformed: [string, string][] = [
      // A revision id that is not one of ours, in every shape that has bitten
      // an id check before: the wrong case, a slash that arrives encoded and is
      // decoded back into a path separator, and punctuation the grammar does
      // not admit.
      [NO_SUCH_LAB, 'REV_abc'],
      [NO_SUCH_LAB, 'rev_a%2Fb'],
      [NO_SUCH_LAB, 'rev_..%2F..'],
      [NO_SUCH_LAB, 'rev_a.b'],
      // One character past what the grammar admits, and far past it: an id of
      // the right shape that is merely too long still has to be refused at the
      // gate rather than carried into a query.
      [NO_SUCH_LAB, `rev_${'a'.repeat(61)}`],
      [NO_SUCH_LAB, `rev_${'a'.repeat(80)}`],
      // And the same on the lab segment, which is the other half of the gate.
      ['DESIGN_abc', real],
      ['design_a%2Fb', real],
      ['design_a.b', real],
      [`design_${'a'.repeat(80)}`, real],
    ];

    for (const [labId, revisionId] of malformed) {
      const response = await get(revisionPath(labId, revisionId), OWNER);
      const label = `${labId}/${revisionId}`;

      // 400 and not 404: the lab in every one of these requests does not exist,
      // so an implementation that looked the lab up first would answer 404 and
      // this would be red. That is the ordering — the gate runs before any
      // database work — expressed as something a status code can show.
      expect(response.status, label).toBe(400);
      expect(await bodyOf(response), label).toEqual({
        error: 'invalid-argument',
        message: 'That is not a readable revision.',
      });
    }

    // The gate is not merely a cheaper 404: the revision above is real and this
    // session owns it, so the only reason to refuse is the id's shape.
    expect((await get(revisionPath(lab.id, real), OWNER)).status).toBe(200);
  });

  it('carries the private-cache headers on the refusals as well as on the revision', async () => {
    const { lab, rounds } = await seed(OWNER, 1);

    // Each of these leaves the handler by a different door — the id gate, the
    // session lookup inside the history, and the ordinary 200 — and the headers
    // have to be on all three. On the 404 in particular: that refusal is a
    // statement about one session's work, and a shared cache reusing it for the
    // next visitor would disclose the fact that the request was answered from
    // somebody else's data.
    const responses: [number, Response][] = [
      [200, await get(revisionPath(lab.id, rounds[0]!.revision.id), OWNER)],
      [404, await get(revisionPath(lab.id, NO_SUCH_REVISION), OWNER)],
      [400, await get(revisionPath(lab.id, 'REV_abc'), OWNER)],
    ];

    for (const [status, response] of responses) {
      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control'), `status ${status}`).toBe('private, no-store');
      expect(response.headers.get('X-Content-Type-Options'), `status ${status}`).toBe('nosniff');
    }
  });

  it('reports why a revision has no pixels, and nothing when it has some', async () => {
    const nothing = await seed(OWNER, 1);
    const unrendered = await bodyOf(
      await get(revisionPath(nothing.lab.id, nothing.rounds[0]!.revision.id), OWNER),
    );
    // The reason is read from the row rather than re-derived at read time, so a
    // revision's explanation is the one recorded with it even though the
    // configuration that produced it may since have changed.
    expect(unrendered.unrendered).toBe(
      'No SVG rasteriser is configured, so no pixels were produced. Source checks still ran.',
    );

    const pixels = await seed(OWNER, 1, true);
    const rendered = await bodyOf(
      await get(revisionPath(pixels.lab.id, pixels.rounds[0]!.revision.id), OWNER),
    );

    // Null, where `design.read` omits the key: this body is spread into the
    // component's props, where an absent key and a null draw the same panel.
    expect(rendered.unrendered).toBeNull();
    // And the render really is addressable: the key the route hands back is the
    // one the byte route would serve.
    expect(Object.keys(rendered.renderKeys as Record<string, string>)).toEqual(['canvas']);
    expect((rendered.renderKeys as Record<string, string>).canvas).toBe(
      `design/${pixels.lab.id}/${pixels.rounds[0]!.revision.id}/canvas.png`,
    );
  });
});
