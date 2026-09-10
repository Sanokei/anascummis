import type {
  ActionReceipt,
  CapabilityContract,
  ConfirmationMode,
  Identity,
  PendingConfirmation,
} from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { CapabilityRegistry } from './registry';
import { PermissionEnvelope, confirmationBinding, needsConfirmation } from '../policy/permissions';
import { TaskBudget } from '../policy/budget';
import { runLua, type HostBinding, type SandboxLimits } from '../lua/sandbox';
import { canonicalJson, randomId, sha256Hex } from '../crypto';

/**
 * The one gate every capability call passes through.
 *
 * Order matters and is deliberate:
 *   resolve → permissions → budget → argument validation → confirmation →
 *   intent receipt → execute → observed outcome → result validation.
 *
 * The intent receipt is written *before* dispatch so a consequential operation
 * that never reports back is recorded as `unknown` rather than disappearing.
 */

export interface DispatchRequest {
  capabilityId: string;
  capabilityVersion?: string;
  args: unknown;
  identity: Identity;
  permissions: PermissionEnvelope;
  budget: TaskBudget;
  confirmationMode: ConfirmationMode;
  /** Fences the dispatch: a stale generation cannot take effect. */
  generation: number;
  signal: AbortSignal;
  /** Supplied when the user has already confirmed this exact action. */
  confirmationToken?: string;
  /** Natural idempotency key where the caller has one. */
  idempotencyKey?: string;
  /** Speculative work may compute and test but must not act consequentially. */
  speculative?: boolean;
}

export type DispatchOutcome =
  | { kind: 'value'; value: unknown; receipt: ActionReceipt | null }
  | { kind: 'confirmation-required'; confirmation: PendingConfirmation }
  | { kind: 'failure'; failure: ReturnType<typeof fail>; receipt: ActionReceipt | null };

export class Dispatcher {
  constructor(
    private readonly env: Env,
    private readonly registry: CapabilityRegistry,
  ) {}

  async dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    const resolved = await this.registry.resolve(req.capabilityId, req.capabilityVersion);
    if (!resolved.ok) return { kind: 'failure', failure: resolved, receipt: null };
    const contract = resolved.value;

    const permitted = req.permissions.check(contract);
    if (!permitted.ok) return { kind: 'failure', failure: permitted, receipt: null };

    if (req.signal.aborted) {
      return {
        kind: 'failure',
        failure: fail('cancelled', 'Stopped before the action was dispatched.'),
        receipt: null,
      };
    }

    const dispatchCharge = req.budget.chargeDispatch();
    if (!dispatchCharge.ok) return { kind: 'failure', failure: dispatchCharge, receipt: null };

    const validated = this.registry.validateArgs(contract, req.args);
    if (!validated.ok) return { kind: 'failure', failure: validated, receipt: null };
    const args = validated.value;

    // Speculation may compute and test, never act.
    if (req.speculative && isConsequential(contract)) {
      return {
        kind: 'failure',
        failure: fail(
          'not-authorised',
          `${contract.id} has real effects, so speculative work will not run it.`,
        ),
        receipt: null,
      };
    }

    if (needsConfirmation(contract, req.confirmationMode)) {
      const binding = await confirmationBinding({
        capabilityId: contract.id,
        capabilityVersion: contract.version,
        args,
        sessionId: req.identity.sessionId,
        generation: req.generation,
        permissions: req.permissions.list(),
      });
      if (req.confirmationToken !== binding) {
        return {
          kind: 'confirmation-required',
          confirmation: {
            id: randomId('confirm'),
            capabilityId: contract.id,
            capabilityVersion: contract.version,
            title: contract.title,
            action: contract.summary,
            target: describeTarget(args),
            consequences: consequencesFor(contract),
            risk: contract.risk,
            bindingHash: binding,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
        };
      }
    }

    const argsHash = await sha256Hex(canonicalJson(args));
    const idempotencyKey = req.idempotencyKey ?? `${argsHash}:${req.generation}`;

    // A prior receipt for the same idempotency identity that never resolved
    // must be reconciled before a retry.
    const prior = await this.env.DB.prepare(
      'SELECT id, outcome, summary FROM action_receipts WHERE capability_id = ? AND idempotency_key = ?',
    )
      .bind(contract.id, idempotencyKey)
      .first<{ id: string; outcome: string; summary: string }>();

    if (prior && prior.outcome === 'unknown') {
      return {
        kind: 'failure',
        failure: fail(
          'unknown',
          `A previous ${contract.id} call with this identity has an unknown outcome. Reconcile it before retrying.`,
          { receiptId: prior.id },
          true,
        ),
        receipt: null,
      };
    }
    if (prior && prior.outcome === 'completed' && contract.idempotent) {
      return {
        kind: 'failure',
        failure: fail('contract-mismatch', `${contract.id} already completed for this identity.`, {
          receiptId: prior.id,
        }),
        receipt: null,
      };
    }

    const receipt = isConsequential(contract)
      ? await this.recordIntent(req, contract, idempotencyKey, argsHash)
      : null;

    const started = Date.now();
    let result: Result<unknown>;
    try {
      result = await this.execute(contract, args, req);
    } catch (err) {
      result = fail('upstream-error', `${contract.id} threw: ${describe(err)}`, undefined, true);
    }
    const elapsed = Date.now() - started;

    if (result.ok) {
      const shaped = this.registry.validateResult(contract, result.value);
      if (!shaped.ok) {
        if (receipt) await this.recordOutcome(receipt, 'unknown', 'Result did not match the contract.');
        return { kind: 'failure', failure: shaped, receipt };
      }
      if (receipt) {
        await this.recordOutcome(receipt, 'completed', `${contract.id} completed in ${elapsed} ms.`);
        receipt.observedOutcome = 'completed';
        receipt.outcomeRecordedAt = new Date().toISOString();
      }
      return { kind: 'value', value: shaped.value, receipt };
    }

    if (receipt) {
      // A cancelled or timed-out remote call may still have taken effect.
      const outcome =
        result.outcomeUnknown || result.kind === 'timeout' || result.kind === 'cancelled'
          ? 'unknown'
          : 'failed';
      await this.recordOutcome(receipt, outcome, result.message);
      receipt.observedOutcome = outcome;
      receipt.outcomeRecordedAt = new Date().toISOString();
    }
    return { kind: 'failure', failure: result, receipt };
  }

  private async execute(
    contract: CapabilityContract,
    args: Record<string, unknown>,
    req: DispatchRequest,
  ): Promise<Result<unknown>> {
    const timeout = AbortSignal.timeout(contract.budget.timeoutMs);
    const signal = anySignal([req.signal, timeout]);

    if (contract.kind === 'native') {
      const handler = this.registry.native(contract.id);
      if (!handler) return fail('missing-capability', `${contract.id} has no host handler.`);
      return handler.execute({
        args,
        env: this.env,
        identity: req.identity,
        permissions: req.permissions,
        signal,
        chargeExternal: (n) => req.budget.chargeExternalCall(n),
      });
    }

    const loaded = await this.registry.loadLuaSource(contract.id, contract.version);
    if (!loaded.ok) return loaded;

    const limits: SandboxLimits = {
      instructionLimit: contract.budget.instructionLimit,
      timeoutMs: contract.budget.timeoutMs,
      outputBytes: contract.budget.outputBytes,
      hostCalls: contract.budget.hostCalls,
      maxValueNodes: 4000,
    };
    const bindings = this.bindingsFor(contract, req, signal);
    return this.runSandbox(loaded.value.source, args, bindings, limits);
  }

  private async runSandbox(
    source: string,
    args: unknown,
    bindings: HostBinding[],
    limits: SandboxLimits,
  ): Promise<Result<unknown>> {
    const run = await runLua(source, args, bindings, limits);
    if (!run.ok) return run;
    return ok(run.value.value);
  }

  /**
   * Host bindings a Lua capability may reach. Each one is a granted, scoped
   * operation. There is no binding that reaches the model, spawns a job,
   * invokes another capability, or returns a secret.
   */
  private bindingsFor(
    contract: CapabilityContract,
    req: DispatchRequest,
    signal: AbortSignal,
  ): HostBinding[] {
    const bindings: HostBinding[] = [];
    const granted = new Set(contract.permissions);

    if (granted.has('net.search') && req.permissions.has('net.search')) {
      bindings.push({
        name: 'search',
        call: async (callArgs) => {
          const charged = req.budget.chargeExternalCall();
          if (!charged.ok) return { ok: false, error: charged.message };
          const handler = this.registry.native('web.search');
          if (!handler) return { ok: false, error: 'search adapter unavailable' };
          const res = await handler.execute({
            args: { query: String(callArgs[0] ?? ''), limit: Number(callArgs[1] ?? 5) },
            env: this.env,
            identity: req.identity,
            permissions: req.permissions,
            signal,
            chargeExternal: () => ok(0),
          });
          return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.message };
        },
      });
    }

    if (granted.has('net.fetch') && req.permissions.has('net.fetch')) {
      bindings.push({
        name: 'fetch',
        call: async (callArgs) => {
          const charged = req.budget.chargeExternalCall();
          if (!charged.ok) return { ok: false, error: charged.message };
          const handler = this.registry.native('web.fetch');
          if (!handler) return { ok: false, error: 'fetch adapter unavailable' };
          const res = await handler.execute({
            args: { url: String(callArgs[0] ?? '') },
            env: this.env,
            identity: req.identity,
            permissions: req.permissions,
            signal,
            chargeExternal: () => ok(0),
          });
          return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.message };
        },
      });
    }

    if (granted.has('clock.read')) {
      bindings.push({ name: 'now', call: () => ({ ok: true, value: new Date().toISOString() }) });
    }

    return bindings;
  }

  private async recordIntent(
    req: DispatchRequest,
    contract: CapabilityContract,
    idempotencyKey: string,
    argsHash: string,
  ): Promise<ActionReceipt> {
    const id = randomId('receipt');
    const intentAt = new Date().toISOString();
    await this.env.DB.prepare(
      `INSERT OR REPLACE INTO action_receipts
         (id, session_id, user_id, capability_id, capability_version, idempotency_key,
          arguments_hash, generation, intent_at, outcome, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '')`,
    )
      .bind(
        id,
        req.identity.sessionId,
        req.identity.kind === 'user' ? req.identity.userId : null,
        contract.id,
        contract.version,
        idempotencyKey,
        argsHash,
        req.generation,
        intentAt,
      )
      .run();
    return {
      id,
      capabilityId: contract.id,
      capabilityVersion: contract.version,
      idempotencyKey,
      intentRecordedAt: intentAt,
      observedOutcome: 'pending',
      outcomeRecordedAt: null,
      summary: '',
    };
  }

  private async recordOutcome(
    receipt: ActionReceipt,
    outcome: 'completed' | 'failed' | 'cancelled' | 'unknown',
    summary: string,
  ): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE action_receipts SET outcome = ?, outcome_at = ?, summary = ? WHERE id = ?',
    )
      .bind(outcome, new Date().toISOString(), summary.slice(0, 500), receipt.id)
      .run();
  }
}

/** Whether an action can have an effect worth a receipt. */
export function isConsequential(contract: CapabilityContract): boolean {
  if (contract.risk === 'none' || contract.risk === 'low') return !contract.idempotent;
  return true;
}

function consequencesFor(contract: CapabilityContract): string[] {
  const out: string[] = [];
  if (!contract.idempotent) out.push('Running it twice is not the same as running it once.');
  if (contract.risk === 'irreversible') out.push('This cannot be undone from here.');
  if (contract.permissions.includes('cloudflare.deploy')) {
    out.push('It uses your connected Cloudflare account.');
  }
  if (contract.permissions.includes('net.fetch')) out.push('It contacts an external site.');
  if (contract.permissions.includes('memory.write')) out.push('It writes to durable memory.');
  if (out.length === 0) out.push('No lasting effect outside this conversation.');
  return out;
}

function describeTarget(args: Record<string, unknown>): string {
  for (const key of ['url', 'target', 'name', 'query', 'path', 'account']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value.slice(0, 200);
  }
  return 'this session';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** AbortSignal.any is not available on every runtime version in use. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
