import { describe, expect, it } from 'vitest';
import { TASK_LIMITS, TURN_LIMITS, TaskBudget, type BudgetLimits } from '@worker/policy/budget';

/**
 * The budget is what stops a task spending without end, and the rule it has to
 * hold is that nothing reachable from inside the task can enlarge it. A nested
 * envelope may only narrow, and it spends its parent as it spends itself, so
 * wrapping work in a skill or a second harness buys nothing.
 */

const limits = (overrides: Partial<BudgetLimits> = {}): BudgetLimits => ({
  dispatches: 4,
  hostCalls: 10,
  elapsedMs: 45_000,
  forgeAttempts: 2,
  inkRepairAttempts: 2,
  externalCalls: 6,
  modelTokens: 1000,
  ...overrides,
});

const budget = (overrides: Partial<BudgetLimits> = {}) => new TaskBudget('task', limits(overrides));

describe('nesting', () => {
  it('narrows to the smaller of the two figures', () => {
    const child = budget().child('skill', { dispatches: 2, hostCalls: 3 });
    expect(child.limits.dispatches).toBe(2);
    expect(child.limits.hostCalls).toBe(3);
  });

  it('ignores a child asking for more than its parent holds', () => {
    const child = budget({ dispatches: 4 }).child('skill', { dispatches: 999, modelTokens: 10_000_000 });
    expect(child.limits.dispatches).toBe(4);
    expect(child.limits.modelTokens).toBe(1000);
  });

  it('inherits any limit the child does not mention', () => {
    const child = budget().child('skill', { dispatches: 1 });
    expect(child.limits.hostCalls).toBe(10);
    expect(child.limits.externalCalls).toBe(6);
  });

  it('cannot be enlarged by nesting a second time', () => {
    const grandchild = budget({ dispatches: 4 })
      .child('skill', { dispatches: 2 })
      .child('inner', { dispatches: 99 });
    expect(grandchild.limits.dispatches).toBe(2);
  });

  it('cannot be enlarged by a chain of children each asking for a little more', () => {
    let current = budget({ hostCalls: 10 });
    for (let i = 0; i < 5; i++) current = current.child(`level${i}`, { hostCalls: 10 + i });
    expect(current.limits.hostCalls).toBe(10);
  });

  it('narrows a limit permanently, so a later child cannot walk it back up', () => {
    const narrowed = budget({ hostCalls: 10 }).child('skill', { hostCalls: 2 });
    expect(narrowed.child('inner', { hostCalls: 10 }).limits.hostCalls).toBe(2);
  });
});

describe('spending through a child', () => {
  it('charges the parent as well as the child', () => {
    const parent = budget();
    const child = parent.child('skill', { dispatches: 2 });

    expect(child.chargeDispatch().ok).toBe(true);
    expect(child.used('dispatches')).toBe(1);
    expect(parent.used('dispatches')).toBe(1);
  });

  it('spends one pool across two children rather than giving each its own', () => {
    const parent = budget({ dispatches: 3 });
    const first = parent.child('a', { dispatches: 3 });
    const second = parent.child('b', { dispatches: 3 });

    expect(first.chargeDispatch().ok).toBe(true);
    expect(first.chargeDispatch().ok).toBe(true);
    expect(second.chargeDispatch().ok).toBe(true);

    // The parent's three are now gone, so the second child cannot spend a
    // fourth even though its own limit says three.
    const overflow = second.chargeDispatch();
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.kind).toBe('budget-exhausted');
  });

  it('stops a child at its own smaller limit before the parent is empty', () => {
    const parent = budget({ dispatches: 4 });
    const child = parent.child('skill', { dispatches: 1 });

    expect(child.chargeDispatch().ok).toBe(true);
    expect(child.chargeDispatch().ok).toBe(false);
    // The parent still has room; only the child is finished.
    expect(parent.used('dispatches')).toBe(1);
    expect(parent.chargeDispatch().ok).toBe(true);
  });

  it('does not charge the child when the parent refuses', () => {
    const parent = budget({ hostCalls: 1 });
    const child = parent.child('skill', { hostCalls: 5 });
    parent.chargeHostCall();

    expect(child.chargeHostCall().ok).toBe(false);
    expect(child.used('hostCalls')).toBe(0);
  });

  it('pauses the child when the parent runs out', () => {
    const parent = budget({ dispatches: 1 });
    const child = parent.child('skill', { dispatches: 5 });
    parent.chargeDispatch();

    child.chargeDispatch();
    expect(child.exhausted).toBe(true);
    expect(child.pauseReason).toBe('story dispatches');
  });
});

describe('charging', () => {
  it('names the exhausted budget and its ceiling', () => {
    const task = budget({ dispatches: 1 });
    task.chargeDispatch();

    const refused = task.chargeDispatch();
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.kind).toBe('budget-exhausted');
      expect(refused.message).toContain('story dispatches');
      expect(refused.message).toContain('1');
    }
  });

  it('reports the running total as it goes', () => {
    const task = budget();
    expect(task.chargeHostCall()).toEqual({ ok: true, value: 1 });
    expect(task.chargeHostCall(3)).toEqual({ ok: true, value: 4 });
  });

  it('refuses a charge that would cross the limit rather than clamping it', () => {
    const task = budget({ hostCalls: 5 });
    task.chargeHostCall(4);

    expect(task.chargeHostCall(2).ok).toBe(false);
    expect(task.used('hostCalls')).toBe(4);
  });

  it('keeps each counter separate', () => {
    const task = budget({ dispatches: 1, forgeAttempts: 1 });
    task.chargeDispatch();
    expect(task.chargeForgeAttempt().ok).toBe(true);
  });

  it('stays paused once it has run out, whatever is charged next', () => {
    const task = budget({ dispatches: 1 });
    task.chargeDispatch();
    task.chargeDispatch();

    const later = task.chargeHostCall();
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.message).toContain('already paused');
    expect(task.exhausted).toBe(true);
  });

  it('counts an external call once per unit requested', () => {
    const task = budget({ externalCalls: 6 });
    task.chargeExternalCall(4);
    expect(task.used('externalCalls')).toBe(4);
  });

  it('rounds a fractional token estimate and refuses to be charged a negative', () => {
    const task = budget({ modelTokens: 1000 });
    task.chargeModelTokens(10.6);
    expect(task.used('modelTokens')).toBe(11);

    task.chargeModelTokens(-500);
    expect(task.used('modelTokens')).toBe(11);
  });
});

describe('elapsed time', () => {
  it('is exhausted once the window has passed, without being charged anything', () => {
    const started = Date.now() - 60_000;
    const task = new TaskBudget('task', limits({ elapsedMs: 45_000 }), null, started);

    expect(task.exhausted).toBe(true);
    expect(task.pauseReason).toBe('elapsed-time');
  });

  it('refuses a charge on a task whose time is up', () => {
    const started = Date.now() - 60_000;
    const task = new TaskBudget('task', limits({ elapsedMs: 45_000 }), null, started);

    const refused = task.chargeDispatch();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain('Time budget');
  });

  it('gives a child the parent’s clock rather than a fresh one', () => {
    const started = Date.now() - 60_000;
    const parent = new TaskBudget('task', limits({ elapsedMs: 45_000 }), null, started);

    // A skill starting late does not get its 45 seconds over again.
    expect(parent.child('skill', {}).exhausted).toBe(true);
  });

  it('is not exhausted while the window is still open', () => {
    expect(budget({ elapsedMs: 45_000 }).exhausted).toBe(false);
    expect(budget().pauseReason).toBeNull();
  });
});

describe('surviving a pause across requests', () => {
  it('restores the counters that were already spent', () => {
    const task = budget({ dispatches: 4 });
    task.chargeDispatch();
    task.chargeDispatch();
    task.chargeHostCall(3);

    const restored = TaskBudget.restore('task', limits({ dispatches: 4 }), task.serialize(), Date.now());
    expect(restored.used('dispatches')).toBe(2);
    expect(restored.used('hostCalls')).toBe(3);
    expect(restored.chargeDispatch().ok).toBe(true);
  });

  it('keeps a paused task paused', () => {
    const task = budget({ dispatches: 1 });
    task.chargeDispatch();
    task.chargeDispatch();

    const restored = TaskBudget.restore('task', limits({ dispatches: 1 }), task.serialize(), Date.now());
    expect(restored.exhausted).toBe(true);
    expect(restored.pauseReason).toBe('story dispatches');
  });

  it('starts fresh when there is no record', () => {
    const restored = TaskBudget.restore('task', limits(), null, Date.now());
    expect(restored.used('dispatches')).toBe(0);
    expect(restored.exhausted).toBe(false);
  });

  it('refuses to run rather than resetting to zero on an unreadable record', () => {
    const restored = TaskBudget.restore('task', limits(), 'not json', Date.now());
    expect(restored.exhausted).toBe(true);
    expect(restored.pauseReason).toBe('budget-record-unreadable');
    expect(restored.chargeDispatch().ok).toBe(false);
  });
});

describe('the view handed to the client', () => {
  it('reports used against max for each counter it shows', () => {
    const task = budget({ dispatches: 4, hostCalls: 10, forgeAttempts: 2 });
    task.chargeDispatch();
    task.chargeHostCall(2);

    expect(task.view()).toMatchObject({
      dispatchesUsed: 1,
      dispatchesMax: 4,
      hostCallsUsed: 2,
      hostCallsMax: 10,
      forgeAttemptsUsed: 0,
      forgeAttemptsMax: 2,
      exhausted: false,
    });
  });

  it('says so when the task is finished', () => {
    const task = budget({ dispatches: 1 });
    task.chargeDispatch();
    task.chargeDispatch();
    expect(task.view().exhausted).toBe(true);
  });
});

describe('the shipped limits', () => {
  it('gives a single turn less room than an authorised task', () => {
    for (const key of ['dispatches', 'hostCalls', 'elapsedMs', 'externalCalls', 'modelTokens'] as const) {
      expect(TURN_LIMITS[key], key).toBeLessThan(TASK_LIMITS[key]);
    }
  });

  it('does not let a longer task retry a failed build more often', () => {
    expect(TASK_LIMITS.forgeAttempts).toBe(TURN_LIMITS.forgeAttempts);
    expect(TASK_LIMITS.inkRepairAttempts).toBe(TURN_LIMITS.inkRepairAttempts);
  });
});
