import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { JobView, PendingConfirmation, Turn } from '@shared/types';
import type { ContinuationFrame, SessionSnapshot } from '@worker/do/session-coordinator';
import { SessionClient } from '@worker/do/session-coordinator';

/**
 * The coordinator owns the decisions KV is too eventually consistent to hold:
 * the live HEAD, the generation fence behind Stop, and the job table. The
 * fence is the part worth being strict about, because it is what stops a
 * response that arrives after Stop from resuming abandoned work.
 */

let counter = 0;
const newSession = () => new SessionClient(env, `session_${(counter += 1)}`);

const stubFor = (sessionId: string) => env.SESSION.get(env.SESSION.idFromName(sessionId));

/**
 * Calls an operation without going through `SessionClient`, for the cases
 * where the status code is the thing under test. The body is always read:
 * leaving a response undrained holds the object's storage open and the test
 * pool then cannot roll it back between tests.
 */
async function post(
  sessionId: string,
  op: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await stubFor(sessionId).fetch(`https://coordinator/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const turn = (id: string, text = 'hello'): Turn => ({
  id,
  role: 'user',
  text,
  at: new Date().toISOString(),
});

const job = (id: string, state: JobView['state'] = 'queued'): JobView => ({
  id,
  kind: 'search',
  label: 'Looking something up',
  state,
  speculative: false,
  startedAt: new Date().toISOString(),
  finishedAt: null,
});

const frame = (storyId: string): ContinuationFrame => ({
  storyId,
  storyVersion: '1',
  runtimeState: '{}',
  pendingDecision: null,
  returnContract: 'resume',
});

const confirmation: PendingConfirmation = {
  id: 'confirm_1',
  capabilityId: 'cloudflare.deploy',
  capabilityVersion: '1.0.0',
  title: 'Deploy the worker',
  action: 'deploy',
  target: 'anascummis.com',
  consequences: ['The live site changes.'],
  risk: 'irreversible',
  bindingHash: 'hash',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe('a fresh session', () => {
  it('starts at generation 1 with nothing pending', async () => {
    const snapshot = await newSession().snapshot();
    expect(snapshot).toMatchObject({
      generation: 1,
      storyId: null,
      headCheckpointId: null,
      runtimeState: null,
      continuationStack: [],
      turns: [],
      pendingConfirmation: null,
      jobs: [],
      listening: false,
      lastChunkHash: null,
    });
  });

  it('is independent of every other session', async () => {
    const first = newSession();
    const second = newSession();
    await first.commitTurn({ generation: 1, turns: [turn('t1')] });

    expect((await first.snapshot()).turns.length).toBe(1);
    expect((await second.snapshot()).turns.length).toBe(0);
  });

  it('answers an unknown operation with a 404 rather than a silent success', async () => {
    const unknown = await post('unknown-op', 'not-an-operation', {});
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: 'Unknown coordinator operation: not-an-operation' });
  });
});

describe('committing a turn', () => {
  it('appends turns and moves the head', async () => {
    const session = newSession();
    const applied = await session.commitTurn({
      generation: 1,
      turns: [turn('t1'), turn('t2')],
      runtimeState: '{"knot":"middle"}',
      storyId: 'lowtown',
      storyVersion: '3',
      headCheckpointId: 'ckpt_1',
    });
    expect(applied).toEqual({ applied: true, generation: 1 });

    const snapshot = await session.snapshot();
    expect(snapshot.turns.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(snapshot.runtimeState).toBe('{"knot":"middle"}');
    expect(snapshot.storyId).toBe('lowtown');
    expect(snapshot.storyVersion).toBe('3');
    expect(snapshot.headCheckpointId).toBe('ckpt_1');
  });

  it('accumulates across turns rather than replacing them', async () => {
    const session = newSession();
    await session.commitTurn({ generation: 1, turns: [turn('t1')] });
    await session.commitTurn({ generation: 1, turns: [turn('t2')] });
    expect((await session.snapshot()).turns.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('holds a bounded window, keeping the most recent turns', async () => {
    const session = newSession();
    const turns = Array.from({ length: 70 }, (_, i) => turn(`t${i}`));
    await session.commitTurn({ generation: 1, turns });

    const held = (await session.snapshot()).turns;
    expect(held.length).toBe(60);
    expect(held[0]?.id).toBe('t10');
    expect(held[59]?.id).toBe('t69');
  });

  it('clears a pending confirmation that the commit did not carry forward', async () => {
    const session = newSession();
    await session.commitTurn({ generation: 1, turns: [], pendingConfirmation: confirmation });
    expect((await session.snapshot()).pendingConfirmation?.id).toBe('confirm_1');

    await session.commitTurn({ generation: 1, turns: [] });
    expect((await session.snapshot()).pendingConfirmation).toBeNull();
  });

  it('leaves a field alone when the commit omits it', async () => {
    const session = newSession();
    await session.commitTurn({ generation: 1, turns: [], storyId: 'lowtown', mission: 'Ship the worker' });
    await session.commitTurn({ generation: 1, turns: [] });

    const snapshot = await session.snapshot();
    expect(snapshot.storyId).toBe('lowtown');
    // `mission` is explicitly clearable, so naming it with null is different
    // from leaving it out. Leaving it out keeps it.
    expect(snapshot.mission).toBe('Ship the worker');
  });

  it('clears the mission when the commit names it as null', async () => {
    const session = newSession();
    await session.commitTurn({ generation: 1, turns: [], mission: 'Ship the worker' });
    await session.commitTurn({ generation: 1, turns: [], mission: null });
    expect((await session.snapshot()).mission).toBeNull();
  });
});

describe('the generation fence', () => {
  it('refuses a commit carrying a generation that Stop has already retired', async () => {
    const session = newSession();
    const stopped = await session.stop();
    expect(stopped.generation).toBe(2);

    const late = await session.commitTurn({ generation: 1, turns: [turn('t_late')] });
    expect(late).toMatchObject({ applied: false, reason: 'stale-generation', generation: 2 });
    expect((await session.snapshot()).turns).toEqual([]);
  });

  it('answers a stale commit with a conflict status, not a success', async () => {
    const sessionId = 'fenced-session';
    await post(sessionId, 'stop', {});
    const stale = await post(sessionId, 'commit-turn', { generation: 1, turns: [] });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ applied: false, reason: 'stale-generation' });
  });

  it('accepts work carrying the generation issued after Stop', async () => {
    const session = newSession();
    const { generation } = await session.stop();
    const applied = await session.commitTurn({ generation, turns: [turn('t_new')] });
    expect(applied.applied).toBe(true);
  });

  it('advances the fence once per Stop', async () => {
    const session = newSession();
    expect((await session.stop()).generation).toBe(2);
    expect((await session.stop()).generation).toBe(3);
    expect((await session.stop()).generation).toBe(4);
  });

  it('drops a confirmation the user has walked away from', async () => {
    const session = newSession();
    await session.commitTurn({ generation: 1, turns: [], pendingConfirmation: confirmation });
    await session.stop();
    expect((await session.snapshot()).pendingConfirmation).toBeNull();
  });

  it('stops capture so a new turn does not inherit it', async () => {
    const session = newSession();
    await session.setListening(true);
    await session.stop();
    expect((await session.snapshot()).listening).toBe(false);
  });

  it('survives the object being evicted from memory', async () => {
    const sessionId = 'persisted-session';
    const session = new SessionClient(env, sessionId);
    await session.stop();
    await session.commitTurn({ generation: 2, turns: [turn('t1')] });

    // A fresh in-memory instance has to read the fence back from storage
    // rather than starting over at generation 1.
    await runInDurableObject(stubFor(sessionId), async (_instance, state) => {
      const stored = await state.storage.get<SessionSnapshot>('snapshot');
      expect(stored?.generation).toBe(2);
      expect(stored?.turns.map((t) => t.id)).toEqual(['t1']);
    });
  });
});

describe('the job table', () => {
  it('records a job and updates it in place', async () => {
    const session = newSession();
    await session.upsertJob(job('j1'), 1);
    await session.upsertJob({ ...job('j1'), state: 'done', finishedAt: new Date().toISOString() }, 1);

    const jobs = (await session.snapshot()).jobs;
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.state).toBe('done');
  });

  it('refuses a result belonging to a retired generation', async () => {
    const session = newSession();
    await session.stop();
    expect(await session.upsertJob(job('j_late'), 1)).toMatchObject({
      applied: false,
      reason: 'stale-generation',
    });
    expect((await session.snapshot()).jobs).toEqual([]);
  });

  it('cancels everything still in flight when the user presses Stop', async () => {
    const session = newSession();
    await session.upsertJob(job('j_queued', 'queued'), 1);
    await session.upsertJob(job('j_running', 'running'), 1);
    await session.upsertJob(job('j_done', 'done'), 1);

    await session.stop();

    const byId = Object.fromEntries((await session.snapshot()).jobs.map((j) => [j.id, j]));
    expect(byId.j_queued?.state).toBe('cancelled');
    expect(byId.j_running?.state).toBe('cancelled');
    // A job that already finished is history, not something to cancel.
    expect(byId.j_done?.state).toBe('done');
    expect(byId.j_queued?.finishedAt).toBeTypeOf('string');
  });

  it('cancels one job by id and reports whether it found it', async () => {
    const session = newSession();
    await session.upsertJob(job('j1', 'running'), 1);

    expect(await session.cancelJob('j1')).toEqual({ cancelled: true });
    expect((await session.snapshot()).jobs[0]?.state).toBe('cancelled');
    expect(await session.cancelJob('nonexistent')).toEqual({ cancelled: false });
  });

  it('leaves a finished job alone when asked to cancel it', async () => {
    const session = newSession();
    await session.upsertJob(job('j_done', 'done'), 1);
    await session.cancelJob('j_done');
    expect((await session.snapshot()).jobs[0]?.state).toBe('done');
  });

  it('keeps the table bounded, holding the most recent jobs', async () => {
    const session = newSession();
    for (let i = 0; i < 45; i++) await session.upsertJob(job(`j${i}`), 1);

    const jobs = (await session.snapshot()).jobs;
    expect(jobs.length).toBe(40);
    expect(jobs[0]?.id).toBe('j5');
    expect(jobs[39]?.id).toBe('j44');
  });

  it('refuses a request with no job rather than storing a blank row', async () => {
    const missing = await post('no-job', 'upsert-job', { generation: 1 });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: 'missing job' });
  });
});

describe('the continuation stack', () => {
  it('returns interruptions innermost first', async () => {
    const session = newSession();
    await session.pushContinuation(frame('outer'));
    await session.pushContinuation(frame('inner'));

    expect((await session.popContinuation()).frame?.storyId).toBe('inner');
    expect((await session.popContinuation()).frame?.storyId).toBe('outer');
  });

  it('reports the depth as it changes', async () => {
    const session = newSession();
    expect((await session.pushContinuation(frame('a'))).depth).toBe(1);
    expect((await session.pushContinuation(frame('b'))).depth).toBe(2);
    expect((await session.popContinuation()).depth).toBe(1);
  });

  it('hands back nothing when there is nothing to return to', async () => {
    expect(await newSession().popContinuation()).toEqual({ frame: null, depth: 0 });
  });

  it('refuses to nest past its depth limit', async () => {
    const session = newSession();
    for (let i = 0; i < 8; i++) {
      expect((await session.pushContinuation(frame(`s${i}`))).depth).toBe(i + 1);
    }

    const overflow = await session.pushContinuation(frame('one-too-many'));
    expect(overflow.error).toContain('depth limit');
    expect((await session.snapshot()).continuationStack.length).toBe(8);
  });

  it('refuses a push with no frame', async () => {
    const missing = await post('no-frame', 'push-continuation', {});
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: 'missing frame' });
  });
});

describe('capture', () => {
  it('reports the previous chunk so a repeat can be recognised', async () => {
    const session = newSession();
    expect(await session.recordChunk('hash_a')).toEqual({ previousChunkHash: null });
    expect(await session.recordChunk('hash_b')).toEqual({ previousChunkHash: 'hash_a' });
    expect(await session.recordChunk('hash_b')).toEqual({ previousChunkHash: 'hash_b' });
  });

  it('forgets the last chunk when capture stops', async () => {
    const session = newSession();
    await session.setListening(true);
    await session.recordChunk('hash_a');
    await session.setListening(false);

    expect((await session.snapshot()).lastChunkHash).toBeNull();
    expect(await session.recordChunk('hash_a')).toEqual({ previousChunkHash: null });
  });

  it('keeps the marker while capture is still running', async () => {
    const session = newSession();
    await session.setListening(true);
    await session.recordChunk('hash_a');
    await session.setListening(true);
    expect((await session.snapshot()).lastChunkHash).toBe('hash_a');
  });

  it('treats anything but true as not listening', async () => {
    const coerced = await post('listening-coercion', 'set-listening', { listening: 'yes' });
    expect(coerced.body).toEqual({ listening: false });
  });
});

describe('the per-turn budget', () => {
  it('clears the record and stamps a start time', async () => {
    const session = newSession();
    await session.commitTurn({ generation: 1, turns: [], budgetRecord: '{"dispatches":3}' });

    const before = Date.now();
    const begun = await session.beginTurn();
    expect(begun.generation).toBe(1);
    expect(begun.budgetStartedAt).toBeGreaterThanOrEqual(before);

    const snapshot = await session.snapshot();
    expect(snapshot.budgetRecord).toBeNull();
    expect(snapshot.budgetStartedAt).toBe(begun.budgetStartedAt);
  });

  it('does not reset the fence, so Stop still holds across a new turn', async () => {
    const session = newSession();
    await session.stop();
    expect((await session.beginTurn()).generation).toBe(2);
  });
});

describe('serialization', () => {
  it('does not lose a write when many arrive at once', async () => {
    const session = newSession();
    await Promise.all(Array.from({ length: 25 }, (_, i) => session.upsertJob(job(`j${i}`), 1)));

    const jobs = (await session.snapshot()).jobs;
    expect(jobs.length).toBe(25);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(25);
  });

  it('does not interleave concurrent turn commits', async () => {
    const session = newSession();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => session.commitTurn({ generation: 1, turns: [turn(`t${i}`)] })),
    );
    expect((await session.snapshot()).turns.length).toBe(20);
  });
});

describe('reset', () => {
  it('leaves the session as though it had never run', async () => {
    const session = newSession();
    await session.commitTurn({ generation: 1, turns: [turn('t1')], storyId: 'lowtown' });
    await session.stop();
    await session.pushContinuation(frame('outer'));

    expect(await session.reset()).toEqual({ reset: true });

    const snapshot = await session.snapshot();
    expect(snapshot.generation).toBe(1);
    expect(snapshot.turns).toEqual([]);
    expect(snapshot.storyId).toBeNull();
    expect(snapshot.continuationStack).toEqual([]);
  });

  it('clears the underlying storage rather than only the cached copy', async () => {
    const sessionId = 'reset-session';
    const session = new SessionClient(env, sessionId);
    await session.commitTurn({ generation: 1, turns: [turn('t1')] });
    await session.reset();

    await runInDurableObject(stubFor(sessionId), async (_instance, state) => {
      expect(await state.storage.get('snapshot')).toBeUndefined();
    });
  });
});
