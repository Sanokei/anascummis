import type { Identity, JobView } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { TaskBudget } from '../policy/budget';
import { SessionClient } from '../do/session-coordinator';
import { randomId } from '../crypto';

/**
 * Conservative elastic job pool.
 *
 * Hot and cold describe latency priority, not a count. There is one
 * conversational authority per session and a dynamic set of independent jobs.
 * A job becomes a model-backed agent only when reasoning is actually useful:
 * deterministic validation and storage do not get their own agent.
 *
 * No permanent concurrency number is encoded. The ceiling moves with the
 * remaining budget, and neither the model nor a worker can raise it.
 */

export type JobKind =
  | 'research'
  | 'skill-discovery'
  | 'skill-execution'
  | 'artifact'
  | 'ink-authoring'
  | 'lua-forge'
  | 'validation'
  | 'context-preparation'
  | 'maintenance';

/** Kinds where model reasoning earns a separate agent. */
const MODEL_BACKED: ReadonlySet<JobKind> = new Set<JobKind>([
  'research',
  'skill-execution',
  'ink-authoring',
  'lua-forge',
  'context-preparation',
]);

export interface JobRequest {
  kind: JobKind;
  label: string;
  /** Speculative work prepares a likely next need and is cancellable. */
  speculative: boolean;
  /** Required interactive work takes precedence over speculation. */
  urgency: 'interactive' | 'background';
  /** Deduplication identity. Equivalent requests collapse into one job. */
  dedupeKey: string;
  /** Estimated cost, reserved before the job starts. */
  estimate: { externalCalls: number; modelTokens: number; elapsedMs: number };
  /** Jobs this one needs. A cycle is rejected. */
  dependsOn?: string[];
  run: (ctx: JobContext) => Promise<Result<unknown>>;
}

export interface JobContext {
  identity: Identity;
  budget: TaskBudget;
  signal: AbortSignal;
  /** Generation this job was admitted under. A stale result cannot land. */
  generation: number;
  branchId: string;
}

export interface AdmittedJob {
  id: string;
  request: JobRequest;
  view: JobView;
  promise: Promise<Result<unknown>>;
}

export interface AdmissionDecision {
  admitted: boolean;
  reason: string;
  reusedJobId?: string;
}

interface Reservation {
  externalCalls: number;
  modelTokens: number;
}

export class Scheduler {
  private readonly jobs = new Map<string, AdmittedJob>();
  private readonly byDedupeKey = new Map<string, string>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly env: Env,
    private readonly identity: Identity,
    private readonly budget: TaskBudget,
    private readonly generation: number,
    private readonly branchId: string,
  ) {}

  /**
   * Only the scheduler spawns jobs. A worker returns a dependency request; it
   * cannot create a descendant itself.
   */
  admit(request: JobRequest): Result<AdmittedJob> | AdmissionDecision {
    const existing = this.byDedupeKey.get(request.dedupeKey);
    if (existing) {
      const job = this.jobs.get(existing);
      if (job) {
        return { admitted: false, reason: 'An equivalent job is already running.', reusedJobId: existing };
      }
    }

    if (request.dependsOn && this.hasCycle(request.dependsOn, request.dedupeKey)) {
      return { admitted: false, reason: 'That dependency would form a cycle.' };
    }

    const decision = this.canAdmit(request);
    if (!decision.admitted) return decision;

    // Reserve the estimate before starting, then reconcile afterwards.
    const reserve = this.reserve(request);
    if (!reserve.ok) return { admitted: false, reason: reserve.message };

    const id = randomId('job');
    const controller = new AbortController();
    this.controllers.set(id, controller);

    const view: JobView = {
      id,
      kind: request.kind,
      label: request.label,
      state: 'running',
      speculative: request.speculative,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    const childBudget = this.budget.child(`job:${id}`, {
      externalCalls: request.estimate.externalCalls,
      modelTokens: request.estimate.modelTokens,
      elapsedMs: request.estimate.elapsedMs,
    });

    const promise = this.execute(id, request, childBudget, controller.signal, view);
    const job: AdmittedJob = { id, request, view, promise };
    this.jobs.set(id, job);
    this.byDedupeKey.set(request.dedupeKey, id);
    return ok(job);
  }

  private async execute(
    id: string,
    request: JobRequest,
    budget: TaskBudget,
    signal: AbortSignal,
    view: JobView,
  ): Promise<Result<unknown>> {
    const client = new SessionClient(this.env, this.identity.sessionId);
    await client.upsertJob(view, this.generation).catch(() => undefined);

    try {
      const result = await request.run({
        identity: this.identity,
        budget,
        signal,
        generation: this.generation,
        branchId: this.branchId,
      });
      view.state = result.ok ? 'done' : 'failed';
      if (!result.ok) view.detail = result.message;
      return result;
    } catch (err) {
      view.state = 'failed';
      view.detail = err instanceof Error ? err.message : String(err);
      return fail('upstream-error', view.detail);
    } finally {
      view.finishedAt = new Date().toISOString();
      this.reconcile(id, budget);
      // A stale generation makes this a no-op rather than an overwrite.
      await client.upsertJob(view, this.generation).catch(() => undefined);
      this.controllers.delete(id);
    }
  }

  /**
   * Admission. More concurrency needs stronger justification, and speculation
   * yields to interactive work whenever the two compete.
   */
  private canAdmit(request: JobRequest): AdmissionDecision {
    if (this.budget.exhausted) {
      return { admitted: false, reason: `The task budget is paused: ${this.budget.pauseReason}.` };
    }

    const running = [...this.jobs.values()].filter((j) => j.view.state === 'running');
    const ceiling = this.currentCeiling();

    if (running.length >= ceiling) {
      if (request.urgency === 'interactive') {
        // Required work displaces the newest speculative job rather than queuing.
        const victim = [...running].reverse().find((j) => j.request.speculative);
        if (victim) {
          this.cancel(victim.id, 'Displaced by required interactive work.');
          return { admitted: true, reason: 'Admitted by displacing speculative work.' };
        }
      }
      return {
        admitted: false,
        reason: `The concurrency ceiling for the remaining budget is ${ceiling}.`,
      };
    }

    if (request.speculative && running.some((j) => j.request.urgency === 'interactive')) {
      // Speculation while interactive work is pending needs a real payoff.
      if (request.estimate.elapsedMs > 5_000) {
        return {
          admitted: false,
          reason: 'Speculative work that slow is not worth running alongside an interactive job.',
        };
      }
    }

    return { admitted: true, reason: 'Within budget and independent of the current work.' };
  }

  /**
   * The ceiling moves with what is actually left, so it is a consequence of the
   * budget rather than a fixed product rule.
   */
  private currentCeiling(): number {
    const view = this.budget.view();
    const timeLeft = Math.max(0, view.elapsedMaxMs - view.elapsedMs);
    const callsLeft = this.budget.limits.externalCalls - this.budget.used('externalCalls');
    const tokensLeft = this.budget.limits.modelTokens - this.budget.used('modelTokens');

    if (timeLeft < 5_000 || callsLeft <= 1 || tokensLeft < 4_000) return 1;
    if (timeLeft < 20_000 || callsLeft <= 4 || tokensLeft < 20_000) return 2;
    if (callsLeft <= 10) return 3;
    return 4;
  }

  private reserve(request: JobRequest): Result<true> {
    const calls = this.budget.chargeExternalCall(request.estimate.externalCalls);
    if (!calls.ok) return calls;
    const tokens = this.budget.chargeModelTokens(
      MODEL_BACKED.has(request.kind) ? request.estimate.modelTokens : 0,
    );
    if (!tokens.ok) return tokens;
    return ok(true);
  }

  /**
   * Reconciles a reservation against actual use.
   *
   * The child budget already charged the parent as it went, so this records
   * the difference for observability rather than refunding: a refund would let
   * an underestimating job effectively raise its own ceiling.
   */
  private reconcile(id: string, childBudget: TaskBudget): void {
    this.reservations.set(id, {
      externalCalls: childBudget.used('externalCalls'),
      modelTokens: childBudget.used('modelTokens'),
    });
  }

  private hasCycle(dependsOn: string[], ownKey: string): boolean {
    if (dependsOn.includes(ownKey)) return true;
    const seen = new Set<string>([ownKey]);
    const stack = [...dependsOn];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (seen.has(key)) return true;
      seen.add(key);
      const jobId = this.byDedupeKey.get(key);
      const job = jobId ? this.jobs.get(jobId) : undefined;
      if (job?.request.dependsOn) stack.push(...job.request.dependsOn);
    }
    return false;
  }

  cancel(jobId: string, reason: string): boolean {
    const controller = this.controllers.get(jobId);
    const job = this.jobs.get(jobId);
    if (!controller || !job) return false;
    controller.abort(reason);
    job.view.state = 'cancelled';
    job.view.detail = reason;
    job.view.finishedAt = new Date().toISOString();
    return true;
  }

  /** Optional work is cancelled when the user changes direction. */
  cancelSpeculative(reason: string): number {
    let cancelled = 0;
    for (const job of this.jobs.values()) {
      if (job.request.speculative && job.view.state === 'running') {
        if (this.cancel(job.id, reason)) cancelled += 1;
      }
    }
    return cancelled;
  }

  views(): JobView[] {
    return [...this.jobs.values()].map((j) => j.view);
  }

  /**
   * Awaits only the jobs whose results this turn actually depends on. The
   * conversation does not wait for unrelated work.
   */
  async awaitRequired(jobIds: string[]): Promise<Map<string, Result<unknown>>> {
    const out = new Map<string, Result<unknown>>();
    await Promise.all(
      jobIds.map(async (id) => {
        const job = this.jobs.get(id);
        if (!job) {
          out.set(id, fail('missing-capability', `Job ${id} is not known to this scheduler.`));
          return;
        }
        out.set(id, await job.promise);
      }),
    );
    return out;
  }

  /**
   * A result carries the generation and branch it was admitted under. One from
   * a superseded direction is rejected rather than merged.
   */
  acceptResult(job: AdmittedJob, currentGeneration: number, currentBranchId: string): Result<true> {
    if (this.generation !== currentGeneration) {
      return fail('cancelled', 'That work belongs to a conversation direction you have since left.');
    }
    if (this.branchId !== currentBranchId) {
      return fail('cancelled', 'That work belongs to a different branch.');
    }
    if (job.view.state === 'cancelled') {
      return fail('cancelled', 'That job was cancelled before it finished.');
    }
    return ok(true);
  }
}
