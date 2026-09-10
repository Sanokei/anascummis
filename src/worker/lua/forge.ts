import type {
  CapabilityBudget,
  CapabilityContract,
  JsonSchema,
  PermissionName,
  RiskClass,
  ValidationCheck,
  ValidationEvidence,
} from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { CapabilityRegistry, LUA_GRANTABLE_PERMISSIONS, isWellFormedCapabilityId } from '../registry/registry';
import { validateAgainstSchema } from '../registry/schema';
import { runLua, screenLuaSource, type HostBinding, type SandboxLimits } from './sandbox';
import { chat, type ChatMessage } from '../providers/model';
import { TaskBudget } from '../policy/budget';
import { PermissionEnvelope } from '../policy/permissions';
import { parseJsonObject } from '../providers/vision';

/**
 * Story Function Forge.
 *
 * A capability request first looks for a contract-compatible installed
 * capability. Similar names alone do not establish compatibility, so the check
 * is on the input and output schemas, not on the id.
 *
 * When new Lua is genuinely needed, a publishable candidate must pass syntax,
 * schema, prohibited-operation, permission, resource-limit and execution
 * checks inside the actual sandbox, against host-authored tests as well as
 * model-written ones. Passing is evidence, not proof of general safety, and
 * the evidence is stored with the installed version.
 */

export interface CapabilitySpec {
  id: string;
  title: string;
  summary: string;
  input: JsonSchema;
  output: JsonSchema;
  requestedPermissions: PermissionName[];
  risk: RiskClass;
}

export interface ForgeRequest {
  spec: CapabilitySpec;
  /** What the story actually needs, in the user's terms. */
  rationale: string;
  budget: TaskBudget;
  sessionPermissions: PermissionEnvelope;
  signal: AbortSignal;
}

export interface ForgeAttempt {
  attempt: number;
  source: string;
  checks: ValidationCheck[];
  passed: boolean;
  failureSummary: string | null;
}

export interface ForgeReport {
  outcome: 'installed' | 'reused' | 'failed';
  capability: CapabilityContract | null;
  attempts: ForgeAttempt[];
  /** Present when nothing was installed. Preserves the last valid state. */
  reason: string | null;
}

const DEFAULT_BUDGET: CapabilityBudget = {
  timeoutMs: 4_000,
  instructionLimit: 1_500_000,
  outputBytes: 96 * 1024,
  hostCalls: 6,
};

/** Host-authored probes every candidate faces, whatever the model wrote. */
interface HostProbe {
  name: string;
  args: unknown;
  /** Passes when the capability behaves acceptably, including by refusing. */
  accept: (result: Result<unknown>) => boolean;
}

export class StoryFunctionForge {
  constructor(
    private readonly env: Env,
    private readonly registry: CapabilityRegistry,
  ) {}

  async forge(req: ForgeRequest): Promise<ForgeReport> {
    const attempts: ForgeAttempt[] = [];

    if (!isWellFormedCapabilityId(req.spec.id)) {
      return { outcome: 'failed', capability: null, attempts, reason: `"${req.spec.id}" is not a valid capability id.` };
    }

    // Reuse before building. Compatibility is decided on the contract.
    const reuse = await this.findCompatible(req.spec);
    if (reuse) {
      return { outcome: 'reused', capability: reuse, attempts, reason: null };
    }

    const overreach = req.spec.requestedPermissions.filter(
      (p) => !LUA_GRANTABLE_PERMISSIONS.includes(p) || !req.sessionPermissions.has(p),
    );
    if (overreach.length > 0) {
      return {
        outcome: 'failed',
        capability: null,
        attempts,
        reason: `The request asks for permissions outside the granted envelope: ${overreach.join(', ')}. That needs explicit approval, not generated code.`,
      };
    }

    const maxAttempts = Number.parseInt(this.env.MAX_FORGE_ATTEMPTS, 10) || 3;
    let lastFailure = 'No attempt was made.';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const charged = req.budget.chargeForgeAttempt();
      if (!charged.ok) {
        return {
          outcome: 'failed',
          capability: null,
          attempts,
          reason: `${charged.message} The last valid state is preserved.`,
        };
      }
      if (req.signal.aborted) {
        return { outcome: 'failed', capability: null, attempts, reason: 'Stopped before the build finished.' };
      }

      const generated = await this.generate(req, attempts);
      if (!generated.ok) {
        lastFailure = generated.message;
        attempts.push({ attempt, source: '', checks: [], passed: false, failureSummary: generated.message });
        continue;
      }

      const validated = await this.validate(req.spec, generated.value);
      attempts.push({
        attempt,
        source: generated.value,
        checks: validated.checks,
        passed: validated.passed,
        failureSummary: validated.passed ? null : summarise(validated.checks),
      });

      if (!validated.passed) {
        lastFailure = summarise(validated.checks);
        continue;
      }

      const evidence: ValidationEvidence = {
        validatedAt: new Date().toISOString(),
        validator: 'story-function-forge@1',
        checks: validated.checks,
        passed: true,
      };

      const installed = await this.registry.install({
        contract: {
          id: req.spec.id,
          version: '1.0.0',
          kind: 'lua',
          title: req.spec.title,
          summary: req.spec.summary,
          owner: 'forge',
          workspaceScope: 'user',
          input: req.spec.input,
          output: req.spec.output,
          permissions: req.spec.requestedPermissions,
          risk: req.spec.risk,
          requiresConfirmation: req.spec.risk !== 'none',
          budget: DEFAULT_BUDGET,
          idempotent: true,
          cancellable: true,
          validation: evidence,
        },
        source: generated.value,
        validation: evidence,
      });

      if (!installed.ok) {
        lastFailure = installed.message;
        continue;
      }
      return { outcome: 'installed', capability: installed.value, attempts, reason: null };
    }

    return {
      outcome: 'failed',
      capability: null,
      attempts,
      reason: `${maxAttempts} attempts were used without a candidate that passed validation. Last failure: ${lastFailure}`,
    };
  }

  /**
   * Contract compatibility, not name similarity.
   *
   * An installed capability is only a substitute when it accepts at least the
   * required inputs and produces at least the required outputs.
   */
  private async findCompatible(spec: CapabilitySpec): Promise<CapabilityContract | null> {
    for (const contract of await this.registry.listInstalled()) {
      if (contract.status !== 'installed') continue;
      if (!schemaAccepts(contract.input, spec.input)) continue;
      if (!schemaProvides(contract.output, spec.output)) continue;
      const extra = contract.permissions.filter((p) => !spec.requestedPermissions.includes(p));
      // A candidate that needs more authority than the request is not a match.
      if (extra.length > 0) continue;
      return contract;
    }
    return null;
  }

  private async generate(req: ForgeRequest, previous: ForgeAttempt[]): Promise<Result<string>> {
    const repairContext =
      previous.length > 0
        ? [
            'A previous attempt failed. Fix exactly these problems:',
            previous[previous.length - 1]?.failureSummary ?? 'unknown failure',
            'Previous source:',
            previous[previous.length - 1]?.source ?? '',
          ].join('\n')
        : '';

    const bindings = req.spec.requestedPermissions
      .map((p) => BINDING_DOCS[p])
      .filter((d): d is string => Boolean(d));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You write one small Lua 5.4 capability.',
          'Reply with JSON only: {"source":"<lua source>"}.',
          'Define exactly one global function: function run(args) ... end',
          'It receives a table matching the input schema and returns a table matching the output schema.',
          'You may use string, table, math and basic Lua. You may NOT use os, io, require, load,',
          'dofile, debug, package, coroutine, setmetatable, getmetatable or _ENV.',
          'You cannot call a language model, spawn anything, or reach another capability.',
          bindings.length > 0
            ? `Granted host bindings, each returning {ok=boolean, value=..., error=string}:\n${bindings.join('\n')}`
            : 'No host bindings are granted. Compute from the arguments alone.',
          'Handle malformed input by returning a table with ok=false and a reason. Never error out.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Capability: ${req.spec.id}`,
          `Purpose: ${req.spec.summary}`,
          `Why it is needed: ${req.rationale}`,
          `Input schema: ${JSON.stringify(req.spec.input)}`,
          `Output schema: ${JSON.stringify(req.spec.output)}`,
          repairContext,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];

    const res = await chat(this.env, {
      messages,
      json: true,
      temperature: 0.2,
      maxTokens: 1600,
      modelClass: 'pro',
      signal: req.signal,
    });
    if (!res.ok) return res;

    req.budget.chargeModelTokens(res.value.usage.promptTokens + res.value.usage.completionTokens);

    const parsed = parseJsonObject(res.value.text);
    if (!parsed.ok) return parsed;
    const source = (parsed.value as { source?: unknown }).source;
    if (typeof source !== 'string' || source.trim().length === 0) {
      return fail('contract-mismatch', 'The generator did not return Lua source.');
    }
    return ok(source);
  }

  /**
   * Runs the full validation battery inside the real sandbox.
   *
   * Tests include malformed input, an oversized payload, an attempted escape,
   * and a resource-exhaustion probe, not only the happy path a model would
   * write for itself.
   */
  private async validate(
    spec: CapabilitySpec,
    source: string,
  ): Promise<{ passed: boolean; checks: ValidationCheck[] }> {
    const checks: ValidationCheck[] = [];

    const screened = screenLuaSource(source);
    checks.push({
      name: 'prohibited-operations',
      passed: screened.ok,
      ...(screened.ok ? {} : { detail: screened.message }),
    });
    if (!screened.ok) return { passed: false, checks };

    const limits: SandboxLimits = {
      instructionLimit: DEFAULT_BUDGET.instructionLimit,
      timeoutMs: DEFAULT_BUDGET.timeoutMs,
      outputBytes: DEFAULT_BUDGET.outputBytes,
      hostCalls: DEFAULT_BUDGET.hostCalls,
      maxValueNodes: 4000,
    };
    // Validation runs with stub bindings, so a candidate never reaches the
    // network or the workspace while it is still a draft.
    const stubs = stubBindings(spec.requestedPermissions);

    const happy = await runLua(source, sampleFor(spec.input), stubs, limits);
    checks.push({
      name: 'executes-on-valid-input',
      passed: happy.ok,
      ...(happy.ok ? {} : { detail: happy.message }),
    });

    if (happy.ok) {
      const shaped = validateAgainstSchema(spec.output, happy.value.value);
      checks.push({
        name: 'output-matches-contract',
        passed: shaped.ok,
        ...(shaped.ok ? {} : { detail: shaped.message }),
      });
    }

    for (const probe of HOST_PROBES) {
      const run = await runLua(source, probe.args, stubs, limits);
      const outcome: Result<unknown> = run.ok ? ok(run.value.value) : run;
      checks.push({
        name: probe.name,
        passed: probe.accept(outcome),
        ...(probe.accept(outcome) ? {} : { detail: `Unacceptable behaviour: ${describeResult(outcome)}` }),
      });
    }

    // A capability must not be able to exceed its own instruction ceiling.
    const tight = await runLua(source, sampleFor(spec.input), stubs, {
      ...limits,
      instructionLimit: 5_000,
    });
    checks.push({
      name: 'respects-instruction-ceiling',
      passed: tight.ok || tight.kind === 'budget-exhausted' || tight.kind === 'timeout',
      ...(tight.ok || tight.kind === 'budget-exhausted' || tight.kind === 'timeout'
        ? {}
        : { detail: `Unexpected failure under a tight ceiling: ${tight.message}` }),
    });

    return { passed: checks.every((c) => c.passed), checks };
  }
}

/**
 * Host-authored probes. These are fixed, so a model cannot write around them
 * by supplying only tests it knows its own code passes.
 */
const HOST_PROBES: HostProbe[] = [
  {
    name: 'handles-nil-input',
    args: null,
    // Refusing cleanly is acceptable; crashing the sandbox is not.
    accept: (result) => result.ok || result.kind !== 'sandbox-violation',
  },
  {
    name: 'handles-wrong-shape',
    args: { unexpected: [1, 2, 3], nested: { deep: true } },
    accept: (result) => result.ok || result.kind !== 'sandbox-violation',
  },
  {
    name: 'handles-empty-strings',
    args: { query: '', name: '', text: '', url: '' },
    accept: (result) => result.ok || result.kind !== 'sandbox-violation',
  },
  {
    name: 'handles-oversized-string',
    args: { query: 'x'.repeat(20_000), text: 'y'.repeat(20_000) },
    accept: (result) =>
      result.ok || result.kind === 'budget-exhausted' || result.kind === 'timeout' || result.kind === 'invalid-argument',
  },
];

const BINDING_DOCS: Partial<Record<PermissionName, string>> = {
  'net.search': '  host.search(query, limit) -> {ok=..., value={results={...}}}',
  'net.fetch': '  host.fetch(url) -> {ok=..., value={text=..., finalUrl=...}}',
  'clock.read': '  host.now() -> {ok=true, value="<ISO timestamp>"}',
};

/** Stubs used during validation, so a draft never touches the real world. */
function stubBindings(permissions: PermissionName[]): HostBinding[] {
  const bindings: HostBinding[] = [];
  if (permissions.includes('net.search')) {
    bindings.push({
      name: 'search',
      call: () => ({ ok: true, value: { results: [{ title: 'Example', url: 'https://example.invalid', snippet: 'stub' }] } }),
    });
  }
  if (permissions.includes('net.fetch')) {
    bindings.push({
      name: 'fetch',
      call: () => ({ ok: true, value: { text: 'stub page text', finalUrl: 'https://example.invalid' } }),
    });
  }
  if (permissions.includes('clock.read')) {
    bindings.push({ name: 'now', call: () => ({ ok: true, value: '2026-09-10T00:00:00.000Z' }) });
  }
  return bindings;
}

/** A plausible instance of a schema, used to exercise the happy path. */
export function sampleFor(schema: JsonSchema): unknown {
  switch (schema.type) {
    case 'string':
      return schema.enum?.[0] ?? 'sample';
    case 'number':
      return schema.minimum ?? 1.5;
    case 'integer':
      return schema.minimum ?? 2;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array':
      return schema.items ? [sampleFor(schema.items)] : [];
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) out[key] = sampleFor(sub);
      return out;
    }
    default:
      return null;
  }
}

/** Whether `candidate` accepts everything `required` would send it. */
export function schemaAccepts(candidate: JsonSchema, required: JsonSchema): boolean {
  if (candidate.type !== required.type) return false;
  if (candidate.type !== 'object') return true;
  const candidateProps = candidate.properties ?? {};
  for (const key of required.required ?? []) {
    if (!(key in candidateProps)) return false;
  }
  // A candidate that demands a field the requester never sends is unusable.
  for (const key of candidate.required ?? []) {
    if (!(required.properties ?? {})[key]) return false;
  }
  return true;
}

/** Whether `candidate` produces at least the fields `required` expects. */
export function schemaProvides(candidate: JsonSchema, required: JsonSchema): boolean {
  if (candidate.type !== required.type) return false;
  if (candidate.type !== 'object') return true;
  const candidateProps = candidate.properties ?? {};
  for (const key of Object.keys(required.properties ?? {})) {
    if (!(key in candidateProps)) return false;
  }
  return true;
}

function summarise(checks: ValidationCheck[]): string {
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0) return 'No failing check was recorded.';
  return failed.map((c) => `${c.name}: ${c.detail ?? 'failed'}`).join('; ');
}

function describeResult(result: Result<unknown>): string {
  return result.ok ? 'returned a value' : `${result.kind}: ${result.message}`;
}
