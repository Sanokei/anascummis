import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CapabilityContract, Identity, Result } from '@shared/types';
import { fail, ok } from '@shared/types';
import { Dispatcher, isConsequential } from '@worker/registry/dispatcher';
import { CapabilityRegistry, type NativeContext } from '@worker/registry/registry';
import { PermissionEnvelope, confirmationBinding } from '@worker/policy/permissions';
import { TaskBudget, TURN_LIMITS } from '@worker/policy/budget';
import { applyMigrations, seedUser } from '../helpers/db';

/**
 * Every capability call passes through here, and the order is the point:
 * resolve, permissions, budget, arguments, confirmation, intent receipt,
 * execute, observed outcome, result validation. The receipt is written before
 * dispatch so a call that never reports back is recorded as unknown rather
 * than disappearing, and an unknown receipt blocks a retry until someone has
 * reconciled it.
 */

beforeAll(applyMigrations);

const contract = (overrides: Partial<CapabilityContract> = {}): CapabilityContract => ({
  id: 'test.act',
  version: '1.0.0',
  sourceHash: 'native:test.act',
  kind: 'native',
  title: 'Act',
  summary: 'Does the thing.',
  owner: 'host',
  workspaceScope: 'global',
  input: {
    type: 'object',
    properties: { target: { type: 'string' } },
    required: ['target'],
    additionalProperties: false,
  },
  output: { type: 'string' },
  permissions: ['net.fetch'],
  risk: 'moderate',
  requiresConfirmation: false,
  budget: { timeoutMs: 5_000, instructionLimit: 0, outputBytes: 4096, hostCalls: 1 },
  idempotent: false,
  cancellable: true,
  validation: { validatedAt: '2026-09-10T00:00:00.000Z', validator: 'test', checks: [], passed: true },
  status: 'installed',
  installedAt: '2026-09-10T00:00:00.000Z',
  ...overrides,
});

interface Harness {
  dispatcher: Dispatcher;
  calls: NativeContext[];
}

function harnessFor(
  c: CapabilityContract,
  execute: (ctx: NativeContext) => Promise<Result<unknown>> = async () => ok('done'),
): Harness {
  const registry = new CapabilityRegistry(env);
  const calls: NativeContext[] = [];
  registry.registerNative({
    contract: c,
    execute: (ctx) => {
      calls.push(ctx);
      return execute(ctx);
    },
  });
  return { dispatcher: new Dispatcher(env, registry), calls };
}

const identity: Identity = { kind: 'guest', sessionId: 'session_1' };

function request(overrides: Partial<Parameters<Dispatcher['dispatch']>[0]> = {}) {
  return {
    capabilityId: 'test.act',
    args: { target: 'anascummis.com' },
    identity,
    permissions: new PermissionEnvelope(['net.fetch']),
    budget: new TaskBudget('turn', TURN_LIMITS),
    confirmationMode: 'off' as const,
    generation: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const receiptRows = async () => {
  const rows = await env.DB.prepare(
    'SELECT id, capability_id, idempotency_key, outcome, summary, generation FROM action_receipts',
  ).all<Record<string, unknown>>();
  return rows.results ?? [];
};

describe('the gates before anything runs', () => {
  it('refuses a capability that is not installed', async () => {
    const { dispatcher } = harnessFor(contract());
    const outcome = await dispatcher.dispatch(request({ capabilityId: 'test.missing' }));

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') expect(outcome.failure.kind).toBe('missing-capability');
    expect(await receiptRows()).toEqual([]);
  });

  it('refuses a version that is not the installed one', async () => {
    const { dispatcher } = harnessFor(contract());
    const outcome = await dispatcher.dispatch(request({ capabilityVersion: '2.0.0' }));

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') expect(outcome.failure.kind).toBe('contract-mismatch');
  });

  it('refuses a permission the session does not hold, before charging the budget', async () => {
    const { dispatcher, calls } = harnessFor(contract());
    const budget = new TaskBudget('turn', TURN_LIMITS);
    const outcome = await dispatcher.dispatch(request({ permissions: new PermissionEnvelope([]), budget }));

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') expect(outcome.failure.kind).toBe('missing-permission');
    expect(budget.used('dispatches')).toBe(0);
    expect(calls).toEqual([]);
  });

  it('refuses once Stop has already fired', async () => {
    const { dispatcher, calls } = harnessFor(contract());
    const controller = new AbortController();
    controller.abort();

    const outcome = await dispatcher.dispatch(request({ signal: controller.signal }));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') expect(outcome.failure.kind).toBe('cancelled');
    expect(calls).toEqual([]);
  });

  it('refuses when the dispatch budget is spent', async () => {
    const { dispatcher } = harnessFor(contract());
    const budget = new TaskBudget('turn', { ...TURN_LIMITS, dispatches: 1 });
    budget.chargeDispatch();

    const outcome = await dispatcher.dispatch(request({ budget }));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') expect(outcome.failure.kind).toBe('budget-exhausted');
  });

  it('refuses arguments that do not match the installed contract', async () => {
    const { dispatcher, calls } = harnessFor(contract());

    const missing = await dispatcher.dispatch(request({ args: {} }));
    expect(missing.kind).toBe('failure');
    if (missing.kind === 'failure') expect(missing.failure.kind).toBe('invalid-argument');

    const extra = await dispatcher.dispatch(request({ args: { target: 'x', sneak: true } }));
    expect(extra.kind).toBe('failure');
    if (extra.kind === 'failure') expect(extra.failure.kind).toBe('invalid-argument');

    expect(calls).toEqual([]);
  });

  it('hands the executing capability the validated arguments', async () => {
    const { dispatcher, calls } = harnessFor(contract());
    await dispatcher.dispatch(request());
    expect(calls[0]?.args).toEqual({ target: 'anascummis.com' });
  });
});

describe('speculative work', () => {
  it('will not run something with real effects', async () => {
    const { dispatcher, calls } = harnessFor(contract({ risk: 'irreversible' }));
    const outcome = await dispatcher.dispatch(request({ speculative: true }));

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.failure.kind).toBe('not-authorised');
      expect(outcome.failure.message).toContain('real effects');
    }
    expect(calls).toEqual([]);
    expect(await receiptRows()).toEqual([]);
  });

  it('will run something harmless and repeatable', async () => {
    const { dispatcher } = harnessFor(contract({ risk: 'none', idempotent: true }));
    const outcome = await dispatcher.dispatch(request({ speculative: true }));
    expect(outcome.kind).toBe('value');
  });
});

describe('confirmation', () => {
  const risky = contract({ risk: 'irreversible' });

  it('asks before running, and does not run while it is asking', async () => {
    const { dispatcher, calls } = harnessFor(risky);
    const outcome = await dispatcher.dispatch(request());

    expect(outcome.kind).toBe('confirmation-required');
    if (outcome.kind === 'confirmation-required') {
      expect(outcome.confirmation.capabilityId).toBe('test.act');
      expect(outcome.confirmation.capabilityVersion).toBe('1.0.0');
      expect(outcome.confirmation.risk).toBe('irreversible');
      expect(outcome.confirmation.target).toBe('anascummis.com');
      expect(outcome.confirmation.consequences).toContain('This cannot be undone from here.');
      expect(outcome.confirmation.bindingHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(calls).toEqual([]);
    expect(await receiptRows()).toEqual([]);
  });

  it('asks even when the user switched confirmation off', async () => {
    const { dispatcher } = harnessFor(risky);
    const outcome = await dispatcher.dispatch(request({ confirmationMode: 'off' }));
    expect(outcome.kind).toBe('confirmation-required');
  });

  it('runs once the matching token comes back', async () => {
    const { dispatcher, calls } = harnessFor(risky);
    const asked = await dispatcher.dispatch(request());
    if (asked.kind !== 'confirmation-required') throw new Error('expected a confirmation');

    const outcome = await dispatcher.dispatch(
      request({ confirmationToken: asked.confirmation.bindingHash }),
    );
    expect(outcome.kind).toBe('value');
    expect(calls.length).toBe(1);
  });

  it('asks again when the token does not match', async () => {
    const { dispatcher } = harnessFor(risky);
    const outcome = await dispatcher.dispatch(request({ confirmationToken: 'not-the-token' }));
    expect(outcome.kind).toBe('confirmation-required');
  });

  it('will not let a token approved for one target authorise another', async () => {
    const { dispatcher } = harnessFor(risky);
    const approved = await confirmationBinding({
      capabilityId: 'test.act',
      capabilityVersion: '1.0.0',
      args: { target: 'anascummis.com' },
      sessionId: identity.sessionId,
      generation: 1,
      permissions: ['net.fetch'],
    });

    const substituted = await dispatcher.dispatch(
      request({ args: { target: 'someone-elses-domain.com' }, confirmationToken: approved }),
    );
    expect(substituted.kind).toBe('confirmation-required');
  });

  it('will not let a token survive Stop', async () => {
    const { dispatcher } = harnessFor(risky);
    const asked = await dispatcher.dispatch(request());
    if (asked.kind !== 'confirmation-required') throw new Error('expected a confirmation');

    const afterStop = await dispatcher.dispatch(
      request({ generation: 2, confirmationToken: asked.confirmation.bindingHash }),
    );
    expect(afterStop.kind).toBe('confirmation-required');
  });

  it('does not ask about a risk-free reader when confirmation is off', async () => {
    const { dispatcher } = harnessFor(contract({ risk: 'none', idempotent: true }));
    const outcome = await dispatcher.dispatch(request({ confirmationMode: 'off' }));
    expect(outcome.kind).toBe('value');
  });

  it('describes the session as the target when no argument names one', async () => {
    const { dispatcher } = harnessFor(
      contract({
        risk: 'irreversible',
        input: { type: 'object', properties: {}, additionalProperties: false },
      }),
    );
    const outcome = await dispatcher.dispatch(request({ args: {} }));
    expect(outcome.kind).toBe('confirmation-required');
    if (outcome.kind === 'confirmation-required') {
      expect(outcome.confirmation.target).toBe('this session');
    }
  });
});

describe('receipts', () => {
  it('records intent before dispatch and the outcome after', async () => {
    let seenDuringExecution: unknown[] = [];
    const { dispatcher } = harnessFor(contract(), async () => {
      seenDuringExecution = await receiptRows();
      return ok('done');
    });

    const outcome = await dispatcher.dispatch(request());
    expect(outcome.kind).toBe('value');

    // The row already existed while the capability was still running.
    expect(seenDuringExecution.length).toBe(1);
    expect((seenDuringExecution[0] as { outcome: string }).outcome).toBe('pending');

    const after = await receiptRows();
    expect(after[0]).toMatchObject({ capability_id: 'test.act', outcome: 'completed' });
  });

  it('writes no receipt for a harmless repeatable read', async () => {
    const { dispatcher } = harnessFor(contract({ risk: 'none', idempotent: true }));
    const outcome = await dispatcher.dispatch(request());

    expect(outcome.kind).toBe('value');
    if (outcome.kind === 'value') expect(outcome.receipt).toBeNull();
    expect(await receiptRows()).toEqual([]);
  });

  it('attaches the account to a receipt when there is one', async () => {
    const account = await seedUser();
    const { dispatcher } = harnessFor(contract());
    await dispatcher.dispatch(request({ identity: account }));

    const row = await env.DB.prepare('SELECT user_id, session_id FROM action_receipts').first<{
      user_id: string;
      session_id: string;
    }>();
    expect(row?.user_id).toBe(account.userId);
    expect(row?.session_id).toBe(account.sessionId);
  });

  it('leaves no account on a guest receipt', async () => {
    const { dispatcher } = harnessFor(contract());
    await dispatcher.dispatch(request());

    const row = await env.DB.prepare('SELECT user_id FROM action_receipts').first<{
      user_id: string | null;
    }>();
    expect(row?.user_id).toBeNull();
  });

  it('records a failure as failed', async () => {
    const { dispatcher } = harnessFor(contract(), async () =>
      fail('invalid-argument', 'the upstream rejected it'),
    );
    const outcome = await dispatcher.dispatch(request());

    expect(outcome.kind).toBe('failure');
    const rows = await receiptRows();
    expect(rows[0]).toMatchObject({ outcome: 'failed', summary: 'the upstream rejected it' });
  });

  it('records a thrown error as unknown, because it may still have taken effect', async () => {
    const { dispatcher } = harnessFor(contract(), async () => {
      throw new Error('connection reset');
    });
    const outcome = await dispatcher.dispatch(request());

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.failure.kind).toBe('upstream-error');
      expect(outcome.failure.outcomeUnknown).toBe(true);
    }
    expect((await receiptRows())[0]).toMatchObject({ outcome: 'unknown' });
  });

  it('records a timeout as unknown', async () => {
    const { dispatcher } = harnessFor(contract(), async () => fail('timeout', 'took too long'));
    await dispatcher.dispatch(request());
    expect((await receiptRows())[0]).toMatchObject({ outcome: 'unknown' });
  });

  it('records a cancellation as unknown', async () => {
    const { dispatcher } = harnessFor(contract(), async () => fail('cancelled', 'stopped mid-flight'));
    await dispatcher.dispatch(request());
    expect((await receiptRows())[0]).toMatchObject({ outcome: 'unknown' });
  });

  it('records a result that does not match the contract as unknown', async () => {
    const { dispatcher } = harnessFor(contract(), async () => ok(42));
    const outcome = await dispatcher.dispatch(request());

    expect(outcome.kind).toBe('failure');
    // The capability ran; only the shape coming back was wrong, so whether it
    // took effect is genuinely unknown.
    expect((await receiptRows())[0]).toMatchObject({ outcome: 'unknown' });
  });
});

describe('retrying against a prior receipt', () => {
  const priorReceipt = async (outcome: string, idempotencyKey = 'key_1') => {
    await env.DB.prepare(
      `INSERT INTO action_receipts
         (id, session_id, capability_id, capability_version, idempotency_key,
          arguments_hash, generation, intent_at, outcome, summary)
       VALUES ('receipt_prior', 'session_1', 'test.act', '1.0.0', ?, 'hash', 1, ?, ?, 'earlier attempt')`,
    )
      .bind(idempotencyKey, new Date().toISOString(), outcome)
      .run();
  };

  it('blocks a retry while an earlier outcome is unknown', async () => {
    await priorReceipt('unknown');
    const { dispatcher, calls } = harnessFor(contract());

    const outcome = await dispatcher.dispatch(request({ idempotencyKey: 'key_1' }));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.failure.kind).toBe('unknown');
      expect(outcome.failure.message).toContain('Reconcile it before retrying');
      expect(outcome.failure.outcomeUnknown).toBe(true);
      expect(outcome.failure.detail).toEqual({ receiptId: 'receipt_prior' });
    }
    expect(calls, 'the capability ran despite an unreconciled receipt').toEqual([]);
  });

  it('refuses to repeat something idempotent that already completed', async () => {
    await priorReceipt('completed');
    const { dispatcher, calls } = harnessFor(contract({ idempotent: true }));

    const outcome = await dispatcher.dispatch(request({ idempotencyKey: 'key_1' }));
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.failure.kind).toBe('contract-mismatch');
      expect(outcome.failure.message).toContain('already completed');
    }
    expect(calls).toEqual([]);
  });

  it('allows a retry after an outright failure', async () => {
    await priorReceipt('failed');
    const { dispatcher } = harnessFor(contract());
    expect((await dispatcher.dispatch(request({ idempotencyKey: 'key_1' }))).kind).toBe('value');
  });

  it('does not confuse a different idempotency identity with this one', async () => {
    await priorReceipt('unknown', 'someone-elses-key');
    const { dispatcher } = harnessFor(contract());
    expect((await dispatcher.dispatch(request({ idempotencyKey: 'key_1' }))).kind).toBe('value');
  });

  it('derives a key from the arguments and generation when the caller has none', async () => {
    const { dispatcher } = harnessFor(contract());
    await dispatcher.dispatch(request());

    const row = await env.DB.prepare('SELECT idempotency_key FROM action_receipts').first<{
      idempotency_key: string;
    }>();
    expect(row?.idempotency_key).toMatch(/^[0-9a-f]{64}:1$/);
  });

  it('treats the same call in a later generation as a different attempt', async () => {
    const { dispatcher } = harnessFor(contract());
    await dispatcher.dispatch(request({ generation: 1 }));
    await dispatcher.dispatch(request({ generation: 2 }));

    const rows = await receiptRows();
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.idempotency_key)).size).toBe(2);
  });
});

describe('classifying what deserves a receipt', () => {
  it('spares a repeatable read', () => {
    expect(isConsequential(contract({ risk: 'none', idempotent: true }))).toBe(false);
    expect(isConsequential(contract({ risk: 'low', idempotent: true }))).toBe(false);
  });

  it('records anything that is not repeatable, however harmless it looks', () => {
    expect(isConsequential(contract({ risk: 'none', idempotent: false }))).toBe(true);
    expect(isConsequential(contract({ risk: 'low', idempotent: false }))).toBe(true);
  });

  it('records anything above low risk, even when it is repeatable', () => {
    for (const risk of ['moderate', 'high', 'irreversible'] as const) {
      expect(isConsequential(contract({ risk, idempotent: true })), risk).toBe(true);
    }
  });
});
