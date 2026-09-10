import { Compiler } from 'inkjs/full';
import type { CapabilityContract, ValidationCheck, ValidationEvidence } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import { sha256Hex } from '../crypto';
import { isWellFormedCapabilityId } from '../registry/registry';

/**
 * The Ink Story Harness.
 *
 * A candidate story is compiled with the real Ink compiler, then its compiled
 * JSON is walked to enumerate every external-function reference. Regex over the
 * source is used only for early diagnostics; the authoritative check runs over
 * compiler output, so an action hidden in an unselected branch, in a tag, or
 * behind a divert is still found.
 *
 * The rule this exists to enforce: no executable story version may contain an
 * unresolved action reference, even on a branch nobody will select.
 */

export interface StoryCandidate {
  id: string;
  version: string;
  source: string;
  /** Knots the host is allowed to enter this story at. */
  declaredEntryPoints: string[];
  /** Knots that return control to the caller's continuation. */
  declaredReturnPoints: string[];
}

export interface ActionReference {
  /** The external function name as written in the story. */
  name: string;
  /** Capability id it resolves to, when the name is well formed. */
  capabilityId: string | null;
  argumentCount: number;
}

export interface ValidatedStory {
  id: string;
  version: string;
  source: string;
  sourceHash: string;
  compiled: string;
  entryPoints: string[];
  actionRefs: ActionReference[];
  validation: ValidationEvidence;
}

export interface HarnessDiagnostic {
  code:
    | 'compile-error'
    | 'unresolved-capability'
    | 'revoked-capability'
    | 'missing-permission'
    | 'arity-mismatch'
    | 'dynamic-action-name'
    | 'undeclared-entry-point'
    | 'undeclared-return-point'
    | 'prohibited-construct';
  message: string;
  /** Present when the diagnostic names a capability the Forge could build. */
  proposedCapabilityId?: string;
}

export interface HarnessContext {
  /** Contract snapshot the story is generated and validated against. */
  contracts: Map<string, CapabilityContract>;
  /** Permissions the session actually holds. */
  grantedPermissions: Set<string>;
}

/** Ink constructs that would let generated text reach outside the story. */
const PROHIBITED_SOURCE: { pattern: RegExp; message: string }[] = [
  {
    pattern: /EXTERNAL\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*=/,
    message: 'An EXTERNAL declaration may not carry an inline fallback definition.',
  },
  {
    pattern: /~\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*/,
    message: 'Dotted property access is not valid Ink and is not accepted as an action target.',
  },
];

const EXTERNAL_DECL = /^\s*EXTERNAL\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/gm;

export async function validateStory(
  candidate: StoryCandidate,
  ctx: HarnessContext,
): Promise<Result<ValidatedStory> & { diagnostics?: HarnessDiagnostic[] }> {
  const diagnostics: HarnessDiagnostic[] = [];
  const checks: ValidationCheck[] = [];

  for (const rule of PROHIBITED_SOURCE) {
    if (rule.pattern.test(candidate.source)) {
      diagnostics.push({ code: 'prohibited-construct', message: rule.message });
    }
  }
  checks.push({
    name: 'prohibited-constructs',
    passed: diagnostics.length === 0,
    detail: diagnostics.map((d) => d.message).join('; ') || undefined,
  });
  if (diagnostics.length > 0) {
    return { ...fail('contract-mismatch', diagnostics[0]!.message), diagnostics };
  }

  // Real Ink compilation. Regex matching alone is not sufficient.
  let compiledJson: string;
  try {
    const compiler = new Compiler(candidate.source);
    const story = compiler.Compile();
    compiledJson = story.ToJson() ?? '';
    if (!compiledJson) throw new Error('Compiler produced no output.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({ code: 'compile-error', message });
    checks.push({ name: 'ink-compilation', passed: false, detail: message });
    return { ...fail('contract-mismatch', `Story failed to compile: ${message}`), diagnostics };
  }
  checks.push({ name: 'ink-compilation', passed: true });

  // Authoritative enumeration: external calls found in compiler output.
  const compiledRefs = collectExternalCalls(compiledJson);
  const declared = declaredExternals(candidate.source);

  // Every call site must have a matching EXTERNAL declaration, and every
  // declaration must name a capability rather than a constructed string.
  for (const call of compiledRefs) {
    const decl = declared.get(call.name);
    if (!decl) {
      diagnostics.push({
        code: 'dynamic-action-name',
        message: `The story calls "${call.name}" without an EXTERNAL declaration.`,
      });
      continue;
    }
    if (decl.arity !== call.argumentCount) {
      diagnostics.push({
        code: 'arity-mismatch',
        message: `"${call.name}" is declared with ${decl.arity} arguments but called with ${call.argumentCount}.`,
      });
    }
  }

  const actionRefs: ActionReference[] = [];
  for (const [name, decl] of declared) {
    const capabilityId = externalNameToCapabilityId(name);
    actionRefs.push({ name, capabilityId, argumentCount: decl.arity });

    if (!capabilityId) {
      diagnostics.push({
        code: 'dynamic-action-name',
        message: `EXTERNAL "${name}" does not map to a statically enumerable capability id.`,
      });
      continue;
    }
    const contract = ctx.contracts.get(capabilityId);
    if (!contract) {
      diagnostics.push({
        code: 'unresolved-capability',
        message: `No installed capability named ${capabilityId} satisfies EXTERNAL ${name}.`,
        proposedCapabilityId: capabilityId,
      });
      continue;
    }
    if (contract.status !== 'installed') {
      diagnostics.push({
        code: 'revoked-capability',
        message: `${capabilityId} is ${contract.status} and cannot back an executable story.`,
      });
      continue;
    }
    const missing = contract.permissions.filter((p) => !ctx.grantedPermissions.has(p));
    if (missing.length > 0) {
      diagnostics.push({
        code: 'missing-permission',
        message: `${capabilityId} needs ungranted permissions: ${missing.join(', ')}.`,
      });
    }
  }

  checks.push({
    name: 'action-references-resolved',
    passed: !diagnostics.some((d) =>
      ['unresolved-capability', 'revoked-capability', 'dynamic-action-name', 'arity-mismatch'].includes(d.code),
    ),
  });
  checks.push({
    name: 'permissions-available',
    passed: !diagnostics.some((d) => d.code === 'missing-permission'),
  });

  const knots = collectKnotNames(candidate.source);
  for (const entry of candidate.declaredEntryPoints) {
    if (!knots.has(entry)) {
      diagnostics.push({
        code: 'undeclared-entry-point',
        message: `Declared entry point "${entry}" is not a knot in this story.`,
      });
    }
  }
  for (const ret of candidate.declaredReturnPoints) {
    if (!knots.has(ret)) {
      diagnostics.push({
        code: 'undeclared-return-point',
        message: `Declared return point "${ret}" is not a knot in this story.`,
      });
    }
  }
  checks.push({
    name: 'entry-and-return-points',
    passed: !diagnostics.some(
      (d) => d.code === 'undeclared-entry-point' || d.code === 'undeclared-return-point',
    ),
  });

  const passed = diagnostics.length === 0;
  const validation: ValidationEvidence = {
    validatedAt: new Date().toISOString(),
    validator: 'ink-story-harness@1',
    checks,
    passed,
  };

  if (!passed) {
    return {
      ...fail('contract-mismatch', summarise(diagnostics), { diagnostics }),
      diagnostics,
    };
  }

  return {
    ...ok({
      id: candidate.id,
      version: candidate.version,
      source: candidate.source,
      sourceHash: await sha256Hex(candidate.source),
      compiled: compiledJson,
      entryPoints: candidate.declaredEntryPoints,
      actionRefs,
      validation,
    }),
    diagnostics,
  };
}

function summarise(diagnostics: HarnessDiagnostic[]): string {
  if (diagnostics.length === 1) return diagnostics[0]!.message;
  return `${diagnostics.length} problems, starting with: ${diagnostics[0]!.message}`;
}

/**
 * Maps an Ink EXTERNAL name to a capability id.
 *
 * The mapping is total and reversible: `web_search` becomes `web.search`. A
 * name that cannot be mapped is rejected rather than guessed at, which is what
 * keeps action targets statically enumerable.
 */
export function externalNameToCapabilityId(name: string): string | null {
  if (!/^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*){1,3}$/.test(name)) return null;
  const id = name.replace(/_/g, '.');
  return isWellFormedCapabilityId(id) ? id : null;
}

export function capabilityIdToExternalName(id: string): string {
  return id.replace(/\./g, '_');
}

interface ExternalDecl {
  arity: number;
}

export function declaredExternals(source: string): Map<string, ExternalDecl> {
  const out = new Map<string, ExternalDecl>();
  EXTERNAL_DECL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXTERNAL_DECL.exec(source)) !== null) {
    const name = match[1]!;
    const params = (match[2] ?? '').trim();
    out.set(name, { arity: params.length === 0 ? 0 : params.split(',').length });
  }
  return out;
}

export function collectKnotNames(source: string): Set<string> {
  const out = new Set<string>();
  const knot = /^\s*={2,}\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = knot.exec(source)) !== null) out.add(match[1]!);
  const stitch = /^\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/gm;
  while ((match = stitch.exec(source)) !== null) out.add(match[1]!);
  return out;
}

/**
 * Walks compiled Ink JSON for external-call containers.
 *
 * Compiled Ink represents a call to an external function as an object with an
 * `x()` key naming the function and a numeric argument count. Walking the whole
 * tree finds calls on branches that source-level inspection would miss.
 */
export function collectExternalCalls(compiledJson: string): ActionReference[] {
  let root: unknown;
  try {
    root = JSON.parse(compiledJson);
  } catch {
    return [];
  }
  const found = new Map<string, ActionReference>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;

    const external = record['x()'];
    if (typeof external === 'string') {
      const argCount = typeof record.exArgs === 'number' ? record.exArgs : 0;
      const existing = found.get(external);
      if (!existing || existing.argumentCount < argCount) {
        found.set(external, {
          name: external,
          capabilityId: externalNameToCapabilityId(external),
          argumentCount: argCount,
        });
      }
    }
    for (const value of Object.values(record)) visit(value);
  };

  visit(root);
  return [...found.values()];
}
