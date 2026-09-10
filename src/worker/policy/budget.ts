import type { BudgetView } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';

export interface BudgetLimits {
  dispatches: number;
  hostCalls: number;
  elapsedMs: number;
  forgeAttempts: number;
  inkRepairAttempts: number;
  externalCalls: number;
  /** Rough token ceiling for the whole task envelope. */
  modelTokens: number;
}

export const TURN_LIMITS: BudgetLimits = {
  dispatches: 3,
  hostCalls: 24,
  elapsedMs: 45_000,
  forgeAttempts: 3,
  inkRepairAttempts: 3,
  externalCalls: 12,
  modelTokens: 60_000,
};

/** A longer, explicitly authorised envelope. Distinct from the per-turn one. */
export const TASK_LIMITS: BudgetLimits = {
  dispatches: 24,
  hostCalls: 200,
  elapsedMs: 300_000,
  forgeAttempts: 3,
  inkRepairAttempts: 3,
  externalCalls: 80,
  modelTokens: 400_000,
};

interface Counters {
  dispatches: number;
  hostCalls: number;
  forgeAttempts: number;
  inkRepairAttempts: number;
  externalCalls: number;
  modelTokens: number;
}

/**
 * One budget per task envelope. Switching harness, renaming a request, or
 * returning through Ink cannot create a fresh one: the caller must pass the
 * same instance down, and `child` only ever narrows.
 */
export class TaskBudget {
  readonly id: string;
  readonly limits: BudgetLimits;
  private readonly startedAt: number;
  private readonly counters: Counters;
  private readonly parent: TaskBudget | null;
  private pausedReason: string | null = null;

  constructor(id: string, limits: BudgetLimits, parent: TaskBudget | null = null, now = Date.now()) {
    this.id = id;
    this.limits = limits;
    this.parent = parent;
    this.startedAt = now;
    this.counters = {
      dispatches: 0,
      hostCalls: 0,
      forgeAttempts: 0,
      inkRepairAttempts: 0,
      externalCalls: 0,
      modelTokens: 0,
    };
  }

  /**
   * A nested envelope that can only be smaller than its parent and that also
   * consumes the parent. Wrapping work in a skill cannot enlarge either.
   */
  child(id: string, narrow: Partial<BudgetLimits>): TaskBudget {
    const limits: BudgetLimits = { ...this.limits };
    for (const key of Object.keys(narrow) as (keyof BudgetLimits)[]) {
      const proposed = narrow[key];
      if (typeof proposed === 'number') limits[key] = Math.min(limits[key], proposed);
    }
    return new TaskBudget(id, limits, this, this.startedAt);
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  get exhausted(): boolean {
    return this.pausedReason !== null || this.elapsedMs >= this.limits.elapsedMs;
  }

  get pauseReason(): string | null {
    if (this.pausedReason) return this.pausedReason;
    if (this.elapsedMs >= this.limits.elapsedMs) return 'elapsed-time';
    return null;
  }

  private charge(key: keyof Counters, amount: number, label: string): Result<number> {
    if (this.pausedReason) {
      return fail('budget-exhausted', `Task budget already paused: ${this.pausedReason}.`);
    }
    if (this.elapsedMs >= this.limits.elapsedMs) {
      this.pausedReason = 'elapsed-time';
      return fail('budget-exhausted', 'Time budget for this task is used up.');
    }
    const limit = this.limits[key as keyof BudgetLimits];
    if (this.counters[key] + amount > limit) {
      this.pausedReason = label;
      return fail('budget-exhausted', `Budget for ${label} is used up (${limit}).`);
    }
    if (this.parent) {
      const up = this.parent.charge(key, amount, label);
      if (!up.ok) {
        this.pausedReason = label;
        return up;
      }
    }
    this.counters[key] += amount;
    return ok(this.counters[key]);
  }

  chargeDispatch(): Result<number> {
    return this.charge('dispatches', 1, 'story dispatches');
  }
  chargeHostCall(n = 1): Result<number> {
    return this.charge('hostCalls', n, 'host calls');
  }
  chargeForgeAttempt(): Result<number> {
    return this.charge('forgeAttempts', 1, 'capability build attempts');
  }
  chargeInkRepair(): Result<number> {
    return this.charge('inkRepairAttempts', 1, 'story repair attempts');
  }
  chargeExternalCall(n = 1): Result<number> {
    return this.charge('externalCalls', 1 * n, 'external calls');
  }
  chargeModelTokens(n: number): Result<number> {
    return this.charge('modelTokens', Math.max(0, Math.round(n)), 'model tokens');
  }

  used(key: keyof Counters): number {
    return this.counters[key];
  }

  view(): BudgetView {
    return {
      dispatchesUsed: this.counters.dispatches,
      dispatchesMax: this.limits.dispatches,
      hostCallsUsed: this.counters.hostCalls,
      hostCallsMax: this.limits.hostCalls,
      elapsedMs: this.elapsedMs,
      elapsedMaxMs: this.limits.elapsedMs,
      forgeAttemptsUsed: this.counters.forgeAttempts,
      forgeAttemptsMax: this.limits.forgeAttempts,
      exhausted: this.exhausted,
    };
  }

  /** Serialized so a paused turn stays paused across requests. */
  serialize(): string {
    return JSON.stringify({ id: this.id, counters: this.counters, paused: this.pausedReason });
  }

  static restore(id: string, limits: BudgetLimits, serialized: string | null, startedAt: number): TaskBudget {
    const budget = new TaskBudget(id, limits, null, startedAt);
    if (!serialized) return budget;
    try {
      const parsed = JSON.parse(serialized) as { counters?: Counters; paused?: string | null };
      if (parsed.counters) Object.assign(budget.counters, parsed.counters);
      if (parsed.paused) budget.pausedReason = parsed.paused;
    } catch {
      /* A corrupt record must not silently reset the budget to zero. */
      budget.pausedReason = 'budget-record-unreadable';
    }
    return budget;
  }
}
