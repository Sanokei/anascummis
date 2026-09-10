import type { CapabilityContract, Identity, PermissionName, RiskClass } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import { canonicalJson, sha256Hex } from '../crypto';

/**
 * The permission envelope active for one session. Grants come from the host,
 * never from generated Ink, Lua, skill text, or a retrieved page.
 */
export class PermissionEnvelope {
  private readonly granted = new Set<PermissionName>();

  constructor(granted: Iterable<PermissionName> = []) {
    for (const p of granted) this.granted.add(p);
  }

  has(permission: PermissionName): boolean {
    return this.granted.has(permission);
  }

  list(): PermissionName[] {
    return [...this.granted].sort();
  }

  grant(permission: PermissionName): void {
    this.granted.add(permission);
  }

  revoke(permission: PermissionName): void {
    this.granted.delete(permission);
  }

  /** Narrowing only. A skill or capability can never widen what it received. */
  narrowTo(permissions: PermissionName[]): PermissionEnvelope {
    return new PermissionEnvelope(permissions.filter((p) => this.granted.has(p)));
  }

  missingFor(contract: CapabilityContract): PermissionName[] {
    return contract.permissions.filter((p) => !this.granted.has(p));
  }

  check(contract: CapabilityContract): Result<true> {
    const missing = this.missingFor(contract);
    if (missing.length > 0) {
      return fail(
        'missing-permission',
        `${contract.id} needs permissions that are not granted: ${missing.join(', ')}.`,
        { missing },
      );
    }
    return ok(true);
  }
}

/** Baseline grants for a session that has not connected any external service. */
export function defaultEnvelope(identity: Identity): PermissionEnvelope {
  const base: PermissionName[] = [
    'net.search',
    'net.fetch',
    'workspace.read',
    'workspace.write',
    'skills.read',
    'skills.execute',
    'clock.read',
  ];
  if (identity.kind === 'user') base.push('memory.read', 'memory.write');
  return new PermissionEnvelope(base);
}

export const RISK_ORDER: Record<RiskClass, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
  irreversible: 4,
};

/**
 * Whether the host requires a confirmation. Classification comes from the
 * installed contract, not from a tag in generated Ink.
 */
export function needsConfirmation(
  contract: CapabilityContract,
  mode: 'always' | 'risky-only' | 'off',
): boolean {
  // Irreversible and security-sensitive work always confirms, whatever the
  // user preference says.
  if (contract.risk === 'irreversible' || contract.risk === 'high') return true;
  if (contract.requiresConfirmation && mode !== 'off') return true;
  if (mode === 'always') return contract.risk !== 'none';
  if (mode === 'risky-only') return RISK_ORDER[contract.risk] >= RISK_ORDER.moderate;
  return false;
}

/**
 * Confirmation binds to the exact capability version, arguments, and the
 * relevant slice of session state. Changing any of them invalidates it.
 */
export async function confirmationBinding(input: {
  capabilityId: string;
  capabilityVersion: string;
  args: unknown;
  sessionId: string;
  generation: number;
  permissions: PermissionName[];
}): Promise<string> {
  return sha256Hex(
    canonicalJson({
      c: input.capabilityId,
      v: input.capabilityVersion,
      a: input.args,
      s: input.sessionId,
      g: input.generation,
      p: [...input.permissions].sort(),
    }),
  );
}
