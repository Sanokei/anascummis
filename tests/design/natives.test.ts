import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity, Result } from '../../src/shared/types';
import { applyMigrations, guest, anotherSession } from '../helpers/db';
import type { NativeContext, NativeHandler } from '../../src/worker/registry/registry';
import { isWellFormedCapabilityId } from '../../src/worker/registry/registry';
import { PermissionEnvelope, defaultEnvelope } from '../../src/worker/policy/permissions';
import { TaskBudget, TURN_LIMITS } from '../../src/worker/policy/budget';
import { DESIGN_NATIVES } from '../../src/worker/registry/design-natives';
import { buildRegistry } from '../../src/worker/registry/natives';
import { externalNameToCapabilityId } from '../../src/worker/ink/harness';
import { SurfaceCollector, validateBlock } from '../../src/worker/surfaces/surface';
import { SCENE_SOURCE_EXAMPLE } from '../../src/worker/design/scene';
import { MAX_ROUNDS_PER_DESIGN_LAB } from '../../src/worker/design/types';
import type { Env } from '../../src/worker/env';

/**
 * The design capabilities, driven the way the dispatcher drives them.
 *
 * Every other design test reaches a module directly. This one goes through
 * `execute(ctx)` — the actual seam between the registry and the work — because
 * the failures it covers are the ones that leave every module test green: an
 * argument read under the wrong name, an identity dropped on the way through, a
 * charge taken where no request is made, or a verdict that reaches a caller in a
 * shape the module never produced.
 *
 * Two properties here are not about the design harness at all but about the
 * rules it inherits, and they are the ones worth breaking a test over:
 *
 *   - **No image bytes cross the Lua boundary.** These contracts return verdicts,
 *     counts and storage keys. A picture is fetched through the session-bounded
 *     byte route, never smuggled out inside a tool result. That is asserted
 *     structurally over the whole returned object rather than by checking a
 *     field name, because the rule is about the shape of what leaves, not about
 *     one key.
 *
 *   - **`allVerified` is only ever true on host checks.** An opinion from a
 *     vision model can be recorded and can be interesting, and it can never make
 *     this flag true. The implication is asserted on a real submission.
 */

beforeAll(applyMigrations);

/* ------------------------------------------------------------------ */
/* Driving a native the way the dispatcher does                        */
/* ------------------------------------------------------------------ */

interface Charges {
  /** Every `chargeExternal` call, in order, with the amount asked for. */
  calls: number[];
}

/**
 * A context for one dispatch.
 *
 * The whole of `NativeContext` is built from the real classes rather than a
 * hand-rolled object literal, so a change to what a native is handed breaks
 * here instead of being papered over by a cast.
 */
function contextFor(
  identity: Identity,
  args: Record<string, unknown>,
  charge: (n: number) => Result<number> = (n) => ({ ok: true, value: n }),
  surfaces?: SurfaceCollector,
): { ctx: NativeContext; charges: Charges } {
  const charges: Charges = { calls: [] };
  const ctx: NativeContext = {
    args,
    env: env as unknown as Env,
    identity,
    permissions: defaultEnvelope(identity),
    signal: new AbortController().signal,
    budget: new TaskBudget('budget_natives_test', TURN_LIMITS),
    chargeExternal: (n = 1) => {
      charges.calls.push(n);
      return charge(n);
    },
    // Left off entirely when there is none, rather than set to undefined. A
    // native that asks whether there is a collector has to see the same absence
    // an inline story pass produces, not a key that is present and empty.
    ...(surfaces ? { surfaces } : {}),
  };
  return { ctx, charges };
}

/** The handler for a capability id, failing loudly when there is none. */
function native(id: string): NativeHandler {
  const found = DESIGN_NATIVES.find((handler) => handler.contract.id === id);
  expect(found, `no design native with id ${id}`).toBeDefined();
  return found as NativeHandler;
}

async function call(
  id: string,
  identity: Identity,
  args: Record<string, unknown>,
  charge?: (n: number) => Result<number>,
  surfaces?: SurfaceCollector,
): Promise<{ result: Result<unknown>; charges: Charges }> {
  const { ctx, charges } = contextFor(identity, args, charge, surfaces);
  const result = await native(id).execute(ctx);
  return { result, charges };
}

/** Unwraps a success, failing with the reason rather than an `undefined`. */
function valueOf<T>(result: Result<T>): T {
  expect(result.ok, result.ok ? '' : `${result.kind}: ${result.message}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value as T;
}

/**
 * Every place a returned object could be carrying picture bytes: a binary
 * container, a long array of numbers, or a base64 data URI in a string.
 *
 * Returns the paths, so a failure names where it is rather than just that it
 * happened.
 */
function byteContainers(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node instanceof Uint8Array || node instanceof ArrayBuffer) {
      found.push(path);
      return;
    }
    if (typeof node === 'string') {
      // The other way bytes travel as text: a data URI is how a PNG would look
      // if a caller were handed one through a field meant for a key.
      if (/data:image\/[a-z+]+;base64,/i.test(node)) found.push(`${path} (data URI)`);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 64 && node.every((item) => typeof item === 'number')) {
        found.push(`${path} (number[${node.length}])`);
      }
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) walk(item, `${path}.${key}`);
    }
  };
  walk(value, '$');
  return found;
}

async function revisionCount(labId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM design_revisions WHERE lab_id = ?')
    .bind(labId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A scene lab with criteria a host check can settle, and that the bundled lamp
 * actually satisfies.
 *
 * Deliberately all-machine-checkable and all-true: the submission below has to
 * be able to reach `allVerified`, because a property that holds only over
 * unverifiable verdicts holds vacuously and proves nothing.
 */
const SCENE_CRITERIA = ['there are 2 cylinders', 'there is 1 cone'];

/** A criterion no rule compiles, which has to come back as a refusal. */
const SUBJECTIVE = 'the lighting feels warm and inviting';

/** The least a lab can be opened with. Every lab needs at least one criterion. */
const ONE_CRITERION = ['there are 2 circles'];

/** A drawing whose colours and circles a vector lab can count. */
const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle id="sun" cx="40" cy="40" r="20" fill="#ffcc00"/>
  <circle id="moon" cx="140" cy="60" r="18" fill="#cccccc"/>
</svg>`;

/** Opens a lab and returns its id, for the tests that only need one to exist. */
async function openLab(
  identity: Identity,
  overrides: { title?: string; surface?: 'vector' | 'scene'; criteria?: string[] } = {},
): Promise<string> {
  const opened = valueOf(
    await call('design.open', identity, {
      title: overrides.title ?? 'A lab',
      surface: overrides.surface ?? 'vector',
      criteria: overrides.criteria ?? ONE_CRITERION,
    }).then((r) => r.result),
  ) as { labId: string };
  return opened.labId;
}

/** Inserts a revision row directly, for the tests that need a stored one. */
async function insertRevision(input: {
  id: string;
  labId: string;
  sessionId: string;
  source: string;
  overrides?: { verdicts?: string; counts?: string; refused?: string; issues?: string };
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO design_revisions
       (id, lab_id, session_id, surface, source, source_hash, views, verdicts, all_verified, counts, refused, issues, other_observations, created_at)
     VALUES (?, ?, ?, 'vector', ?, 'hash', '[]', ?, 0, ?, ?, ?, '[]', ?)`,
  )
    .bind(
      input.id,
      input.labId,
      input.sessionId,
      input.source,
      input.overrides?.verdicts ?? '[]',
      input.overrides?.counts ?? '{}',
      input.overrides?.refused ?? '[]',
      input.overrides?.issues ?? '[]',
      new Date().toISOString(),
    )
    .run();
}

/**
 * What the one real scene submission produced.
 *
 * Held in memory rather than re-read from D1, because the pool rolls storage
 * back between tests: a row written by one test is not there for the next. The
 * returned object survives; the row it describes does not.
 */
let sceneLabId = '';
let sceneSubmit: Record<string, unknown> = {};

describe('the design contracts', () => {
  it('registers the four ids the skill and the Ink externals name', () => {
    // `design_submit` reaches this by mapping its underscores to dots, so the
    // ids are not free to change: a rename here silently breaks the story that
    // calls it, which is the kind of break nothing else would catch.
    expect(DESIGN_NATIVES.map((handler) => handler.contract.id).sort()).toEqual([
      'design.close',
      'design.open',
      'design.read',
      'design.submit',
    ]);
  });

  it('uses capability ids the registry will accept', () => {
    for (const handler of DESIGN_NATIVES) {
      expect(isWellFormedCapabilityId(handler.contract.id), handler.contract.id).toBe(true);
    }
  });

  it('declares itself native, host-owned and session-scoped', () => {
    for (const handler of DESIGN_NATIVES) {
      const contract = handler.contract;
      expect(contract.kind, contract.id).toBe('native');
      expect(contract.owner, contract.id).toBe('host');
      expect(contract.workspaceScope, contract.id).toBe('session');
      expect(contract.cancellable, contract.id).toBe(true);
      expect(contract.status, contract.id).toBe('installed');
    }
  });

  it('keeps the only above-none risk on the one contract that reaches a provider', () => {
    // Risk drives whether a call is treated as consequential. A read that
    // claimed to be risky would gate work that touches nothing; a submit that
    // claimed `none` would hide that it can spend a browser render and a vision
    // call. Only `design.submit` is allowed above `none`.
    const risky = DESIGN_NATIVES.filter((handler) => handler.contract.risk !== 'none');
    expect(risky.map((handler) => handler.contract.id)).toEqual(['design.submit']);
    expect(native('design.read').contract.idempotent).toBe(true);
    expect(native('design.submit').contract.idempotent).toBe(false);
  });

  it('states in the input schema what execute would otherwise have to guess', () => {
    // The dispatcher validates against these before `execute` runs, so a
    // required field missing here is a call that reaches the handler and is
    // refused there instead of not arriving at all.
    expect(native('design.open').contract.input.required).toEqual(['title', 'surface', 'criteria']);
    expect(native('design.submit').contract.input.required).toEqual(['labId', 'source']);
    expect(native('design.read').contract.input.required).toEqual(['labId']);
    expect(native('design.close').contract.input.required).toEqual(['labId', 'summary']);
  });

  it('gives every contract a budget long enough for the work it does', () => {
    // A submit renders a mesh and may call a model; the others read or write a
    // row. A timeout here that is shorter than the work is a capability that
    // always reports a timeout, which is indistinguishable from a hang.
    for (const handler of DESIGN_NATIVES) {
      const budget = handler.contract.budget;
      expect(budget.timeoutMs, handler.contract.id).toBeGreaterThan(0);
      expect(budget.hostCalls, handler.contract.id).toBeGreaterThan(0);
      expect(budget.outputBytes, handler.contract.id).toBeGreaterThan(0);
    }
    expect(native('design.submit').contract.budget.timeoutMs).toBeGreaterThan(
      native('design.read').contract.budget.timeoutMs,
    );
  });
});

/* ------------------------------------------------------------------ */
/* design.open                                                         */
/* ------------------------------------------------------------------ */

describe('design.open', () => {
  it('refuses a surface it does not have, rather than defaulting to one', async () => {
    // A defaulted surface is the worst outcome available: it changes which
    // criteria compile and which coordinate convention applies, and the author
    // is told nothing. Every one of these is a plausible thing to send.
    for (const surface of ['Scene', 'SCENE', 'image', '', 'vector ', null, 3]) {
      const { result } = await call('design.open', guest(), {
        title: 'x',
        surface,
        criteria: ['there are 2 circles'],
      });
      expect(result.ok, `surface: ${String(surface)}`).toBe(false);
      expect(result.ok ? '' : result.kind).toBe('invalid-argument');
    }
  });

  it('creates no lab when it refuses', async () => {
    const identity = guest();
    const before = await countLabs(identity.sessionId);
    await call('design.open', identity, { title: 'x', surface: 'nope', criteria: ONE_CRITERION });
    expect(await countLabs(identity.sessionId)).toBe(before);
  });

  it('refuses a lab with nothing to check, which the schema alone cannot express', async () => {
    // `criteria` is required by the input schema, but an empty array satisfies
    // that and is not a lab: criteria are what the work is judged against, so a
    // lab with none would accept revisions and be able to say nothing about
    // any of them. The schema vocabulary has no `minItems`, so the refusal is
    // the workspace's, and this is where that shows.
    const identity = guest();
    const before = await countLabs(identity.sessionId);
    const { result } = await call('design.open', identity, {
      title: 'Nothing to judge',
      surface: 'vector',
      criteria: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.kind).toBe('invalid-argument');
    expect(result.ok ? '' : result.message).toMatch(/at least one acceptance criterion/i);
    expect(await countLabs(identity.sessionId)).toBe(before);
  });

  it('caps the criteria and returns exactly what it kept', async () => {
    // The cap lives in the workspace because the schema vocabulary has no
    // maxItems. What matters here is that the author is told which criteria are
    // actually being judged, rather than believing all fifteen are.
    const fifteen = Array.from({ length: 15 }, (_, i) => `there are ${i + 1} circles`);
    const { result } = await call('design.open', guest(), {
      title: 'Many circles',
      surface: 'vector',
      criteria: fifteen,
    });
    const opened = valueOf(result) as { labId: string; criteria: string[]; maxRounds: number };

    expect(opened.criteria).toHaveLength(12);
    expect(opened.criteria).toEqual(fifteen.slice(0, 12));
    expect(opened.maxRounds).toBe(MAX_ROUNDS_PER_DESIGN_LAB);
  });

  it('publishes a vocabulary that matches the surface it opened', async () => {
    // The vocabulary is derived from the live rule tables, so this is really
    // checking that the derivation reaches the caller: an author told they may
    // write a criterion that the next submit refuses has been misled by us.
    const scene = valueOf(
      await call('design.open', guest(), {
        title: 'A lamp',
        surface: 'scene',
        criteria: SCENE_CRITERIA,
      }).then((r) => r.result),
    ) as { vocabulary: { settlable: string[] } };

    const vector = valueOf(
      await call('design.open', guest(), {
        title: 'A drawing',
        surface: 'vector',
        criteria: ['there are 2 circles'],
      }).then((r) => r.result),
    ) as { vocabulary: { settlable: string[] } };

    const sceneSays = scene.vocabulary.settlable.join(' | ');
    const vectorSays = vector.vocabulary.settlable.join(' | ');

    // Assembly vocabulary is offered to a scene and withheld from a drawing,
    // because a drawing cannot nest parts. Symmetrically for the canvas.
    expect(sceneSays).toMatch(/nest/);
    expect(vectorSays).not.toMatch(/nest/);
    expect(vectorSays).toMatch(/canvas/);
    expect(sceneSays).not.toMatch(/canvas/);
  });

  it('reports whether this surface can actually be rendered here', async () => {
    // An author needs this before writing, because a pixel criterion on a
    // surface with no renderer compiles and then comes back unverifiable. The
    // scene claims its own renderer, which needs no provider at all.
    const opened = valueOf(
      await call('design.open', guest(), {
        title: 'A lamp',
        surface: 'scene',
        criteria: SCENE_CRITERIA,
      }).then((r) => r.result),
    ) as { renderer: { available: boolean; reason: string } };

    expect(opened.renderer.available).toBe(true);
    expect(opened.renderer.reason).toMatch(/no provider|inside the Worker/i);
  });
});

async function countLabs(sessionId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM design_labs WHERE session_id = ?')
    .bind(sessionId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* design.submit                                                       */
/* ------------------------------------------------------------------ */

describe('design.submit', () => {
  it('charges for a drawing, and refuses when the charge is declined', async () => {
    // A vector lab renders through Browser Rendering, so it will reach out and
    // is charged before it starts. Declining the charge has to stop the round
    // outright: a refusal that still did the work would be charging for show.
    const identity = guest();
    const labId = await openLab(identity, { title: 'A drawing' });

    const { result, charges } = await call(
      'design.submit',
      identity,
      { labId, source: DRAWING },
      () => ({ ok: false, kind: 'budget-exhausted', message: 'No external calls left.' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.kind).toBe('budget-exhausted');
    expect(charges.calls, 'a vector round should ask to be charged').toHaveLength(1);
    expect(await revisionCount(labId)).toBe(0);
  });

  it('does not charge for a scene, whose renderer is entirely local', async () => {
    // The scene is compiled and rasterised inside the Worker: no provider, no
    // network, nothing to charge for. This submission is given a charge that
    // always fails, so if it succeeds the charge was never taken.
    const identity = guest();
    sceneLabId = await openLab(identity, { title: 'A lamp', surface: 'scene', criteria: SCENE_CRITERIA });

    const { result, charges } = await call(
      'design.submit',
      identity,
      { labId: sceneLabId, source: SCENE_SOURCE_EXAMPLE, note: 'First round.' },
      () => ({ ok: false, kind: 'budget-exhausted', message: 'No external calls left.' }),
    );

    expect(result.ok, result.ok ? '' : `${result.kind}: ${result.message}`).toBe(true);
    expect(charges.calls, 'a scene round should take no charge').toHaveLength(0);
    sceneSubmit = valueOf(result) as Record<string, unknown>;

    // The stored row is checked here rather than in a test of its own because
    // the pool rolls storage back between tests: a row written by this test is
    // not visible to the next one, and a read there would pass by finding
    // nothing rather than by agreeing.
    const row = await env.DB.prepare(
      'SELECT verdicts, all_verified, counts FROM design_revisions WHERE lab_id = ?',
    )
      .bind(sceneLabId)
      .first<{ verdicts: string; all_verified: number; counts: string }>();

    expect(row, 'the round should have been recorded').not.toBeNull();
    const stored = JSON.parse(row?.verdicts ?? '[]') as { criterion: string; basis: string }[];
    const returned = sceneSubmit.verdicts as { criterion: string; basis: string }[];

    // A caller acting on the verdicts just returned and a reader acting on the
    // stored ones must not be told different things.
    expect(stored.map((v) => v.criterion)).toEqual(returned.map((v) => v.criterion));
    expect(stored.map((v) => v.basis)).toEqual(returned.map((v) => v.basis));
    expect(Boolean(row?.all_verified)).toBe(sceneSubmit.allVerified);
  }, 60_000);

  it('settles what a check can settle, and says so with a basis', () => {
    const verdicts = sceneSubmit.verdicts as { criterion: string; basis: string; outcome: string }[];
    expect(verdicts.length).toBeGreaterThan(0);

    // The claim the whole harness rests on: arithmetic reached at least one of
    // these. Without this the implication below would be vacuously true.
    const deterministic = verdicts.filter((v) => v.basis === 'deterministic');
    expect(deterministic.length, JSON.stringify(verdicts)).toBeGreaterThan(0);
    expect(deterministic.some((v) => v.outcome === 'met')).toBe(true);
  });

  it('reaches allVerified on a round every check settled', () => {
    // The happy path, asserted rather than assumed. If this cannot be reached,
    // the implication below is vacuous and the harness has no path to "done".
    expect(sceneSubmit.refused, 'nothing should have been refused').toEqual([]);
    expect(
      sceneSubmit.allVerified,
      `not fully settled: ${JSON.stringify(sceneSubmit.verdicts)}`,
    ).toBe(true);
  });

  it('never reports allVerified true on anything but a host check', () => {
    const verdicts = sceneSubmit.verdicts as { criterion: string; basis: string; outcome: string }[];
    const refused = sceneSubmit.refused as unknown[];

    // Every basis is one of the three the schema publishes. A fourth value
    // would reach a caller that switches on this and has no case for it.
    for (const verdict of verdicts) {
      expect(['deterministic', 'opinion-only', 'unverifiable'], verdict.basis).toContain(verdict.basis);
    }

    if (sceneSubmit.allVerified === true) {
      expect(refused, 'allVerified is true, so nothing may have been refused').toHaveLength(0);
      for (const verdict of verdicts) {
        expect(verdict.basis, `allVerified with a ${verdict.basis} verdict`).toBe('deterministic');
        expect(verdict.outcome, `allVerified with a ${verdict.outcome} verdict`).toBe('met');
      }
    }
  });

  it('sends no picture bytes across the boundary', () => {
    // The rule inherited from the vision and lab natives. Asserted over the
    // whole shape rather than by checking that a field is missing, because the
    // ways a PNG could leak out are not limited to one key.
    expect(byteContainers(sceneSubmit)).toEqual([]);
  });

  it('returns keys, not pictures, for the things it did render', () => {
    const keys = sceneSubmit.renderKeys as Record<string, string> | undefined;
    expect(keys, 'a scene round renders views').toBeDefined();
    expect(Object.keys(keys ?? {}).length).toBeGreaterThan(0);

    for (const [view, key] of Object.entries(keys ?? {})) {
      expect(typeof key, view).toBe('string');
      // Storage keys are addressed through the session-bounded byte route, so
      // they name a location inside the design prefix and nothing else.
      expect(key.startsWith('design/'), key).toBe(true);
      expect(key.includes('..'), key).toBe(false);
      expect(key.length, view).toBeLessThan(300);
    }

    // A scene is exported as a mesh as well as drawn, and the key for it is
    // handed back the same way.
    expect(String(sceneSubmit.glbKey)).toMatch(/^design\/.*\.glb$/);
  });

  it('refuses to submit to a lab belonging to another session', async () => {
    const owner = guest();
    const labId = await openLab(owner, { title: 'Not yours', surface: 'scene', criteria: SCENE_CRITERIA });

    const { result } = await call('design.submit', anotherSession(owner), {
      labId,
      source: SCENE_SOURCE_EXAMPLE,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.kind).toBe('missing-capability');
    expect(await revisionCount(labId)).toBe(0);
  });

  it('names a criterion it could not compile rather than judging it anyway', async () => {
    // The vector surface is used because it renders nothing in this pool, so
    // the round is cheap; what is being tested is that an uncompilable
    // criterion comes back as a refusal with a reason, in a list of its own,
    // and never as a verdict that pretends a model checked it.
    const identity = guest();
    const labId = await openLab(identity, {
      title: 'A drawing with a feeling',
      criteria: [ONE_CRITERION[0] as string, SUBJECTIVE],
    });

    const submitted = valueOf(
      await call('design.submit', identity, { labId, source: DRAWING }).then((r) => r.result),
    ) as {
      refused: { criterion: string; reason: string }[];
      verdicts: { criterion: string; basis: string; outcome: string }[];
      allVerified: boolean;
      unrendered?: string;
    };

    // A criterion no rule compiles is reported in `refused`, with a reason.
    const refusal = submitted.refused.find((r) => r.criterion === SUBJECTIVE);
    expect(refusal, JSON.stringify(submitted.refused)).toBeDefined();
    expect(refusal?.reason).toBeTruthy();

    // It also keeps a verdict of its own, which is the right way round: the
    // criterion stays visible in the round rather than vanishing from it. What
    // must never happen is that it come back settled — this round has no
    // multimodal provider, so nobody could have judged it, and a `met` here
    // would be a claim made on no evidence at all.
    const verdict = submitted.verdicts.find((v) => v.criterion === SUBJECTIVE);
    expect(verdict, JSON.stringify(submitted.verdicts)).toBeDefined();
    expect(verdict?.basis).not.toBe('deterministic');
    expect(verdict?.outcome).not.toBe('met');

    // And so the round as a whole is not settled.
    expect(submitted.allVerified).toBe(false);
  }, 60_000);

  it('stops a lab at its round budget rather than revising forever', async () => {
    // A design harness that never stops is one that burns a vision call on
    // every pass of a loop that cannot converge. The budget is what makes
    // "revise until it is right" a bounded procedure, so the round after the
    // last allowed one has to be refused outright.
    const identity = guest();
    const labId = await openLab(identity, { title: 'Round and round' });

    for (let round = 1; round <= MAX_ROUNDS_PER_DESIGN_LAB; round++) {
      const { result } = await call('design.submit', identity, {
        labId,
        source: DRAWING,
        note: `Round ${round}.`,
      });
      expect(result.ok, `round ${round}: ${result.ok ? '' : result.message}`).toBe(true);
    }

    const { result } = await call('design.submit', identity, { labId, source: DRAWING });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.kind).toBe('budget-exhausted');
    expect(result.ok ? '' : result.message).toMatch(/round|revision/i);
    // And the refused round is not recorded, so the count is the budget rather
    // than one more than it.
    expect(await revisionCount(labId)).toBe(MAX_ROUNDS_PER_DESIGN_LAB);
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* design.read                                                         */
/* ------------------------------------------------------------------ */

describe('design.read', () => {
  it('says plainly when nothing has been submitted', async () => {
    const identity = guest();
    const labId = await openLab(identity, { title: 'Nothing yet' });

    const read = valueOf(
      await call('design.read', identity, { labId }).then((r) => r.result),
    ) as { note?: string; rounds: number };

    expect(read.note).toMatch(/nothing has been submitted/i);
    expect(read.rounds).toBe(0);
  });

  it('returns the owner their source back, and the verdicts recorded for it', async () => {
    const identity = guest();
    const labId = await openLab(identity, { title: 'A drawing' });
    const verdicts = [
      { criterion: 'there are 2 circles', basis: 'deterministic', outcome: 'met' },
      { criterion: SUBJECTIVE, basis: 'unverifiable', outcome: 'unverifiable' },
    ];
    await insertRevision({
      id: 'rev_stored',
      labId,
      sessionId: identity.sessionId,
      source: DRAWING,
      overrides: { verdicts: JSON.stringify(verdicts) },
    });

    const read = valueOf(await call('design.read', identity, { labId }).then((r) => r.result)) as {
      source: string;
      surface: string;
      revisionId: string;
      verdicts: { criterion: string; basis: string }[];
      truncated: boolean;
      rounds: number;
    };

    // The artifact is the source text, returned so the next round can revise
    // it. A read that came back with the picture instead would be a different
    // contract than the one declared.
    expect(read.source).toBe(DRAWING);
    expect(read.surface).toBe('vector');
    expect(read.revisionId).toBe('rev_stored');
    expect(read.truncated).toBe(false);

    // Each verdict comes back with the basis it was recorded under, which is
    // the whole reason the basis is stored rather than recomputed: a reader of
    // a past round has to be able to tell what was checked from what was only
    // opined, without trusting a summary written later.
    expect(read.verdicts.map((v) => v.criterion)).toEqual(verdicts.map((v) => v.criterion));
    expect(read.verdicts.map((v) => v.basis)).toEqual(['deterministic', 'unverifiable']);
  });

  it('refuses a lab belonging to another session', async () => {
    const owner = guest();
    const labId = await openLab(owner, { title: 'Not yours to read' });

    const { result } = await call('design.read', anotherSession(owner), { labId });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.kind).toBe('missing-capability');
  });

  it('answers another session exactly as it answers a lab that does not exist', async () => {
    // The two refusals have to be the same answer, or a session can learn which
    // lab ids are real by reading the failure. This is the same choice the byte
    // route makes when it returns 404 for a render that belongs to somebody
    // else rather than saying so.
    const owner = guest();
    const labId = await openLab(owner, { title: 'Not yours to read' });
    const other = anotherSession(owner);

    const theirs = await call('design.read', other, { labId });
    const nobody = await call('design.read', other, { labId: 'design_doesnotexist' });

    expect(theirs.result.ok).toBe(false);
    expect(nobody.result.ok).toBe(false);
    expect(theirs.result.ok ? '' : theirs.result.kind).toBe(
      nobody.result.ok ? '' : nobody.result.kind,
    );
    expect(theirs.result.ok ? '' : theirs.result.message).toBe(
      nobody.result.ok ? '' : nobody.result.message,
    );
  });

  it('returns no bytes', async () => {
    const identity = guest();
    const labId = await openLab(identity, { title: 'A drawing' });
    await insertRevision({
      id: 'rev_stored',
      labId,
      sessionId: identity.sessionId,
      source: DRAWING,
    });

    const read = valueOf(await call('design.read', identity, { labId }).then((r) => r.result));
    expect(byteContainers(read)).toEqual([]);
  });

  it('caps a long source and says that it did', async () => {
    // Driven from a row inserted directly, because the cap is a property of the
    // read and building a source large enough to cross it through a real submit
    // would test the parser's limits instead.
    const identity = guest();
    const labId = await openLab(identity, { title: 'A very long source' });

    const long = 'x'.repeat(40 * 1024);
    await insertRevision({
      id: 'rev_long_source',
      labId,
      sessionId: identity.sessionId,
      source: long,
    });

    const read = valueOf(await call('design.read', identity, { labId }).then((r) => r.result)) as {
      source: string;
      truncated: boolean;
      revisionId: string;
    };

    expect(read.truncated).toBe(true);
    expect(read.revisionId).toBe('rev_long_source');
    expect(read.source.length).toBe(32 * 1024);
  });

  it('returns a short source whole, and says it did not truncate', async () => {
    const identity = guest();
    const labId = await openLab(identity, { title: 'A short source' });
    await insertRevision({
      id: 'rev_short',
      labId,
      sessionId: identity.sessionId,
      source: DRAWING,
    });

    const read = valueOf(await call('design.read', identity, { labId }).then((r) => r.result)) as {
      source: string;
      truncated: boolean;
    };

    expect(read.truncated).toBe(false);
    expect(read.source).toBe(DRAWING);
  });

  it('answers a revision id it does not have without pretending it read one', async () => {
    const identity = guest();
    const labId = await openLab(identity, { title: 'A drawing' });

    // A row has to exist, or the read answers the different question of a lab
    // nothing was ever submitted to and this would test that branch instead.
    await insertRevision({
      id: 'rev_present',
      labId,
      sessionId: identity.sessionId,
      source: DRAWING,
    });

    const read = valueOf(
      await call('design.read', identity, { labId, revisionId: 'rev_missing' }).then((r) => r.result),
    ) as { note?: string; source?: string; revisionId?: string };

    expect(read.note).toMatch(/no revision with that id/i);
    // The point of the branch: it says it could not find the one asked for
    // rather than quietly handing back a different revision's source.
    expect(read.source).toBeUndefined();
    expect(read.revisionId).toBeUndefined();
  });

  it('reads back a stored row whose json columns are corrupt', async () => {
    // A row can be old, or written by an older shape. A read that threw here
    // would take out the whole tool call rather than report an empty list, so
    // the parsing has to be total.
    const identity = guest();
    const labId = await openLab(identity, { title: 'A corrupt row' });

    await insertRevision({
      id: 'rev_corrupt',
      labId,
      sessionId: identity.sessionId,
      source: DRAWING,
      // Four different ways of not being the shape the column promises: not
      // json at all, an array where an object belongs, an object where an array
      // belongs, and a bare word.
      overrides: { verdicts: 'not json', counts: '[]', refused: '{}', issues: 'nope' },
    });

    const read = valueOf(await call('design.read', identity, { labId }).then((r) => r.result)) as {
      verdicts: unknown[];
      counts: Record<string, unknown>;
      refused: unknown[];
      issues: unknown[];
      // The read still succeeds: the source is the artifact and it is intact,
      // so one unreadable column is not a reason to refuse everything.
      source: string;
    };

    expect(read.source).toBe(DRAWING);
    expect(read.verdicts).toEqual([]);
    expect(read.counts).toEqual({});
    expect(read.refused).toEqual([]);
    expect(read.issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* design.close                                                        */
/* ------------------------------------------------------------------ */

describe('design.close', () => {
  it('closes a lab and reports the state it ended in', async () => {
    const identity = guest();
    const labId = await openLab(identity, { title: 'Closed almost immediately' });

    const closed = valueOf(
      await call('design.close', identity, {
        labId,
        summary: 'Nothing was settled; no revisions were submitted.',
      }).then((r) => r.result),
    ) as { labId: string; state: string; rounds: number };

    expect(closed.labId).toBe(labId);
    expect(closed.state).toBe('closed');
    expect(closed.rounds).toBe(0);

    // And the read agrees, because the state is a column rather than something
    // the close call only reported.
    const read = valueOf(await call('design.read', identity, { labId }).then((r) => r.result)) as {
      state: string;
    };
    expect(read.state).toBe('closed');
  });

  it('takes no further revisions once closed', async () => {
    const identity = guest();
    const labId = await openLab(identity, { title: 'Shut' });
    valueOf(
      await call('design.close', identity, { labId, summary: 'Done.' }).then((r) => r.result),
    );

    const { result } = await call('design.submit', identity, { labId, source: DRAWING });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/closed/i);
    expect(await revisionCount(labId)).toBe(0);
  });

  it('refuses a lab belonging to another session', async () => {
    const owner = guest();
    const labId = await openLab(owner, { title: 'Not yours to close' });

    const { result } = await call('design.close', anotherSession(owner), {
      labId,
      summary: 'Not mine to close.',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.kind).toBe('missing-capability');
  });
});

/* ------------------------------------------------------------------ */
/* The envelope                                                        */
/* ------------------------------------------------------------------ */

describe('reachability', () => {
  it('registers them in the registry the orchestrator builds', async () => {
    // Every other test in this file drives a handler directly, which would keep
    // passing if the handlers were never registered. This is the one that says
    // a turn can actually reach them: `buildRegistry` is what `Orchestrator`
    // constructs, and `/api/capabilities` lists from the same call.
    const registry = buildRegistry(env as unknown as Env);
    const installed = await registry.listInstalled();
    const ids = new Set(installed.map((entry) => entry.id));

    for (const handler of DESIGN_NATIVES) {
      expect(ids.has(handler.contract.id), `${handler.contract.id} is not registered`).toBe(true);
    }
  });

  it('reaches design.submit from the Ink external a story would write', () => {
    // A story names an external with underscores; the registry keys on dots.
    // If this mapping stops covering the design ids, the capability stays
    // installed and becomes unreachable from the only place that calls it.
    expect(externalNameToCapabilityId('design_submit')).toBe('design.submit');
    expect(externalNameToCapabilityId('design_open')).toBe('design.open');
    expect(externalNameToCapabilityId('design_read')).toBe('design.read');
    expect(externalNameToCapabilityId('design_close')).toBe('design.close');
  });

  it('offers every registered design id a permission envelope that grants it', () => {
    // Registered but ungranted is a capability that always fails at the
    // permission check, which reads to a person as the feature being broken.
    const envelope = defaultEnvelope(guest());
    for (const handler of DESIGN_NATIVES) {
      expect(envelope.missingFor(handler.contract), handler.contract.id).toEqual([]);
    }
  });
});

describe('the permission envelope', () => {
  it('can express the permissions these contracts ask for', () => {
    // A contract asking for a permission an envelope can never grant is a
    // capability that can never run. Both are declared here, so a rename on
    // either side fails in this test rather than at dispatch.
    const all = new PermissionEnvelope(['workspace.read', 'workspace.write']);
    for (const handler of DESIGN_NATIVES) {
      expect(all.missingFor(handler.contract), handler.contract.id).toEqual([]);
      expect(handler.contract.permissions.length, handler.contract.id).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('showing the round', () => {
  /*
   * The failure this whole feature exists to prevent is a picture nobody can
   * see. Everything above proves the harness measures correctly; this proves
   * the measurement arrives somewhere a person is looking, which is a separate
   * claim that was false until the window was raised.
   *
   * The window id is derived from the lab id rather than random, and these
   * tests hold it to that: a random id would still pass a "raised a window"
   * test while putting a second window beside the first on every round.
   */

  const windowIdFor = (labId: string): string => `design-${labId.replace(/_/g, '-')}`;

  it('raises a window naming the lab and the revision it just recorded', async () => {
    const identity = guest();
    const labId = await openLab(identity, { surface: 'scene' });
    const surfaces = new SurfaceCollector();

    const submitted = valueOf(
      await call('design.submit', identity, { labId, source: SCENE_SOURCE_EXAMPLE }, undefined, surfaces).then(
        (r) => r.result,
      ),
    ) as { revisionId: string; windowId?: string };

    expect(submitted.windowId).toBe(windowIdFor(labId));

    const plan = surfaces.plan();
    expect(plan.windows).toHaveLength(1);
    const block = plan.windows[0]?.tabs[0]?.blocks[0];
    expect(block?.kind).toBe('design');
    expect(block?.labId).toBe(labId);
    expect(block?.revisionId).toBe(submitted.revisionId);
  });

  /*
   * The producer and the validator are two code paths that only ever meet in
   * production, so nothing stops a native from raising a block the host itself
   * would refuse — and the refusal would not even surface, because the raise
   * happens after the native has already succeeded. This is the test that
   * catches that, and it is deliberately written as "whatever it raises" rather
   * than as a field-by-field restatement, so it keeps holding when the block
   * grows.
   */
  it('raises a block the surface validator would accept from anyone', async () => {
    const identity = guest();
    const labId = await openLab(identity, { surface: 'scene' });
    const surfaces = new SurfaceCollector();
    await call('design.submit', identity, { labId, source: SCENE_SOURCE_EXAMPLE }, undefined, surfaces);

    const window = surfaces.plan().windows[0];
    expect(window).toBeDefined();
    for (const tab of window?.tabs ?? []) {
      for (const block of tab.blocks) {
        expect(
          validateBlock(block, { windowId: window?.id ?? '', tabId: tab.id }),
          `${block.id} would be refused if a model had proposed it`,
        ).toEqual([]);
      }
    }
  });

  it('updates the same window on a later round rather than raising a twin', async () => {
    const identity = guest();
    const labId = await openLab(identity, { surface: 'scene' });
    const surfaces = new SurfaceCollector();

    const first = valueOf(
      await call('design.submit', identity, { labId, source: SCENE_SOURCE_EXAMPLE }, undefined, surfaces).then(
        (r) => r.result,
      ),
    ) as { windowId?: string; windowUpdated?: boolean };
    const second = valueOf(
      await call('design.submit', identity, { labId, source: SCENE_SOURCE_EXAMPLE }, undefined, surfaces).then(
        (r) => r.result,
      ),
    ) as { windowId?: string; windowUpdated?: boolean };

    expect(first.windowId).toBe(windowIdFor(labId));
    expect(second.windowId).toBe(first.windowId);
    expect(first.windowUpdated).toBe(false);
    expect(second.windowUpdated).toBe(true);
    expect(surfaces.plan().windows).toHaveLength(1);
  });

  it('takes the window down when the lab is closed', async () => {
    const identity = guest();
    const labId = await openLab(identity, { surface: 'scene' });
    const surfaces = new SurfaceCollector();
    await call('design.submit', identity, { labId, source: SCENE_SOURCE_EXAMPLE }, undefined, surfaces);
    expect(surfaces.openCount()).toBe(1);

    await call('design.close', identity, { labId, summary: 'Settled.' }, undefined, surfaces);

    // A closed lab takes no further revisions, so a window still showing the
    // last one would be the only thing left on screen saying the lab is live.
    expect(surfaces.plan().close.map((entry) => entry.id)).toContain(windowIdFor(labId));
    expect(surfaces.openCount()).toBe(0);
  });

  /*
   * An inline story pass resolving a design external has no collector, and the
   * call has to keep working: the revision is the deliverable and the window is
   * only how it becomes visible. Absent, not failed.
   */
  it('records the round when there is no turn to show it in', async () => {
    const identity = guest();
    const labId = await openLab(identity, { surface: 'scene' });

    const submitted = valueOf(
      await call('design.submit', identity, { labId, source: SCENE_SOURCE_EXAMPLE }).then((r) => r.result),
    ) as { revisionId: string; windowId?: string; windowRefused?: string };

    expect(submitted.revisionId).toMatch(/^rev_/);
    expect(submitted.windowId).toBeUndefined();
    expect(submitted.windowRefused).toBeUndefined();
  });
});
