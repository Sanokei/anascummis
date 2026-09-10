import type { JobView, PendingConfirmation, Turn } from '@shared/types';
import type { Env } from '../env';

/**
 * Serialized session coordinator.
 *
 * KV is eventually consistent, which makes it unsuitable for a transactional
 * HEAD update or an immediate revocation. This Durable Object owns the live
 * decisions instead: the active HEAD, the generation fence, action ordering,
 * and the job table.
 *
 * The generation fence is the mechanism behind Stop. Pressing Stop increments
 * the generation, which invalidates every in-flight dispatch and every job
 * result carrying an older generation, so a late response cannot resume work
 * the user already abandoned.
 */

export interface SessionSnapshot {
  generation: number;
  storyId: string | null;
  storyVersion: string | null;
  headCheckpointId: string | null;
  runtimeState: string | null;
  /** Cross-story interruptions, innermost last. */
  continuationStack: ContinuationFrame[];
  turns: Turn[];
  pendingConfirmation: PendingConfirmation | null;
  jobs: JobView[];
  budgetRecord: string | null;
  budgetStartedAt: number | null;
  mission: string | null;
  currentTask: string | null;
  currentFocus: string | null;
  constraints: string[];
  listening: boolean;
  lastChunkHash: string | null;
}

export interface ContinuationFrame {
  storyId: string;
  storyVersion: string;
  runtimeState: string;
  /** The decision that was suspended, so it can be offered again on return. */
  pendingDecision: string | null;
  returnContract: string;
}

const MAX_TURNS_HELD = 60;

export class SessionCoordinator implements DurableObject {
  private snapshot: SessionSnapshot | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private async load(): Promise<SessionSnapshot> {
    if (this.snapshot) return this.snapshot;
    const stored = await this.state.storage.get<SessionSnapshot>('snapshot');
    this.snapshot = stored ?? {
      generation: 1,
      storyId: null,
      storyVersion: null,
      headCheckpointId: null,
      runtimeState: null,
      continuationStack: [],
      turns: [],
      pendingConfirmation: null,
      jobs: [],
      budgetRecord: null,
      budgetStartedAt: null,
      mission: null,
      currentTask: null,
      currentFocus: null,
      constraints: [],
      listening: false,
      lastChunkHash: null,
    };
    return this.snapshot;
  }

  private async save(): Promise<void> {
    if (this.snapshot) await this.state.storage.put('snapshot', this.snapshot);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.pathname.replace(/^\/+/, '');

    // Every operation runs inside blockConcurrencyWhile, so two requests can
    // never interleave a read-modify-write of the HEAD.
    return this.state.blockConcurrencyWhile(async () => {
      const snapshot = await this.load();
      const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : {};

      switch (op) {
        case 'snapshot':
          return json(snapshot);

        case 'stop': {
          // Invalidate the current generation. Anything still running becomes
          // stale and cannot write back.
          snapshot.generation += 1;
          snapshot.pendingConfirmation = null;
          snapshot.listening = false;
          for (const job of snapshot.jobs) {
            if (job.state === 'queued' || job.state === 'running') {
              job.state = 'cancelled';
              job.finishedAt = new Date().toISOString();
            }
          }
          await this.save();
          return json({ generation: snapshot.generation });
        }

        case 'commit-turn': {
          // A write carrying a stale generation is refused rather than applied.
          const generation = Number(body.generation ?? 0);
          if (generation !== snapshot.generation) {
            return json(
              { applied: false, reason: 'stale-generation', generation: snapshot.generation },
              409,
            );
          }
          const turns = Array.isArray(body.turns) ? (body.turns as Turn[]) : [];
          snapshot.turns = [...snapshot.turns, ...turns].slice(-MAX_TURNS_HELD);
          if (typeof body.runtimeState === 'string') snapshot.runtimeState = body.runtimeState;
          if (typeof body.storyId === 'string') snapshot.storyId = body.storyId;
          if (typeof body.storyVersion === 'string') snapshot.storyVersion = body.storyVersion;
          if (typeof body.headCheckpointId === 'string') {
            snapshot.headCheckpointId = body.headCheckpointId;
          }
          snapshot.pendingConfirmation = (body.pendingConfirmation as PendingConfirmation) ?? null;
          if (typeof body.budgetRecord === 'string') snapshot.budgetRecord = body.budgetRecord;
          if (typeof body.budgetStartedAt === 'number') snapshot.budgetStartedAt = body.budgetStartedAt;
          if ('mission' in body) snapshot.mission = (body.mission as string | null) ?? null;
          if ('currentTask' in body) snapshot.currentTask = (body.currentTask as string | null) ?? null;
          if ('currentFocus' in body) snapshot.currentFocus = (body.currentFocus as string | null) ?? null;
          if (Array.isArray(body.constraints)) snapshot.constraints = body.constraints.map(String);
          await this.save();
          return json({ applied: true, generation: snapshot.generation });
        }

        case 'begin-turn': {
          // A new turn resets the per-turn budget record but keeps the fence.
          snapshot.budgetRecord = null;
          snapshot.budgetStartedAt = Date.now();
          await this.save();
          return json({ generation: snapshot.generation, budgetStartedAt: snapshot.budgetStartedAt });
        }

        case 'push-continuation': {
          const frame = body.frame as ContinuationFrame | undefined;
          if (!frame) return json({ error: 'missing frame' }, 400);
          if (snapshot.continuationStack.length >= 8) {
            return json({ error: 'continuation stack is at its depth limit' }, 409);
          }
          snapshot.continuationStack.push(frame);
          await this.save();
          return json({ depth: snapshot.continuationStack.length });
        }

        case 'pop-continuation': {
          const frame = snapshot.continuationStack.pop() ?? null;
          await this.save();
          return json({ frame, depth: snapshot.continuationStack.length });
        }

        case 'set-listening': {
          snapshot.listening = body.listening === true;
          // Stopping capture also clears the duplicate-chunk marker, so a new
          // session does not inherit the previous one's suppression state.
          if (!snapshot.listening) snapshot.lastChunkHash = null;
          await this.save();
          return json({ listening: snapshot.listening });
        }

        case 'record-chunk': {
          const hash = typeof body.chunkHash === 'string' ? body.chunkHash : null;
          const previous = snapshot.lastChunkHash;
          snapshot.lastChunkHash = hash;
          await this.save();
          return json({ previousChunkHash: previous });
        }

        case 'upsert-job': {
          const job = body.job as JobView | undefined;
          if (!job) return json({ error: 'missing job' }, 400);
          const generation = Number(body.generation ?? 0);
          if (generation !== snapshot.generation) {
            return json({ applied: false, reason: 'stale-generation' }, 409);
          }
          const index = snapshot.jobs.findIndex((j) => j.id === job.id);
          if (index >= 0) snapshot.jobs[index] = job;
          else snapshot.jobs.push(job);
          snapshot.jobs = snapshot.jobs.slice(-40);
          await this.save();
          return json({ applied: true });
        }

        case 'cancel-job': {
          const id = String(body.jobId ?? '');
          const job = snapshot.jobs.find((j) => j.id === id);
          if (job && (job.state === 'queued' || job.state === 'running')) {
            job.state = 'cancelled';
            job.finishedAt = new Date().toISOString();
          }
          await this.save();
          return json({ cancelled: Boolean(job) });
        }

        case 'reset': {
          // Used when a guest session expires or a user asks to start over.
          await this.state.storage.deleteAll();
          this.snapshot = null;
          return json({ reset: true });
        }

        default:
          return json({ error: `Unknown coordinator operation: ${op}` }, 404);
      }
    });
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Typed client so callers do not hand-build coordinator URLs. */
export class SessionClient {
  private readonly stub: DurableObjectStub;

  constructor(env: Env, sessionId: string) {
    this.stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
  }

  private async call<T>(op: string, body?: unknown): Promise<T> {
    const res = await this.stub.fetch(`https://coordinator/${op}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await res.json()) as T;
  }

  snapshot(): Promise<SessionSnapshot> {
    return this.call<SessionSnapshot>('snapshot');
  }

  stop(): Promise<{ generation: number }> {
    return this.call('stop', {});
  }

  beginTurn(): Promise<{ generation: number; budgetStartedAt: number }> {
    return this.call('begin-turn', {});
  }

  commitTurn(input: Record<string, unknown>): Promise<{ applied: boolean; reason?: string; generation: number }> {
    return this.call('commit-turn', input);
  }

  pushContinuation(frame: ContinuationFrame): Promise<{ depth: number; error?: string }> {
    return this.call('push-continuation', { frame });
  }

  popContinuation(): Promise<{ frame: ContinuationFrame | null; depth: number }> {
    return this.call('pop-continuation', {});
  }

  setListening(listening: boolean): Promise<{ listening: boolean }> {
    return this.call('set-listening', { listening });
  }

  recordChunk(chunkHash: string): Promise<{ previousChunkHash: string | null }> {
    return this.call('record-chunk', { chunkHash });
  }

  upsertJob(job: JobView, generation: number): Promise<{ applied: boolean }> {
    return this.call('upsert-job', { job, generation });
  }

  cancelJob(jobId: string): Promise<{ cancelled: boolean }> {
    return this.call('cancel-job', { jobId });
  }

  reset(): Promise<{ reset: boolean }> {
    return this.call('reset', {});
  }
}
