import type {
  CapabilityContract,
  Identity,
  PermissionName,
  ValidationEvidence,
} from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { sha256Hex } from '../crypto';
import { validateAgainstSchema, serializedSize } from './schema';
import type { PermissionEnvelope } from '../policy/permissions';
import type { TaskBudget } from '../policy/budget';

/**
 * The authoritative executable catalogue.
 *
 * Two rules are enforced here rather than trusted to callers:
 *   1. Execution requires an installed, non-revoked version. Historic
 *      validation evidence never overrides a later revocation.
 *   2. Capability ids are looked up, never constructed. `resolve` refuses any
 *      id that is not already a known key.
 */

export interface NativeHandler {
  contract: CapabilityContract;
  execute: (ctx: NativeContext) => Promise<Result<unknown>>;
}

export interface NativeContext {
  args: Record<string, unknown>;
  env: Env;
  identity: Identity;
  permissions: PermissionEnvelope;
  /** Aborts when the session generation is fenced or the user pressed Stop. */
  signal: AbortSignal;
  /** The task budget this dispatch charges against, for work beyond `chargeExternal`. */
  budget: TaskBudget;
  /** Charged for each outbound request the adapter makes. */
  chargeExternal: (n?: number) => Result<number>;
}

export interface LuaCapabilityRecord {
  contract: CapabilityContract;
  source: string;
}

const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*){1,3}$/;

export function isWellFormedCapabilityId(id: string): boolean {
  return CAPABILITY_ID.test(id) && id.length <= 64;
}

export class CapabilityRegistry {
  private readonly natives = new Map<string, NativeHandler>();
  private readonly luaCache = new Map<string, LuaCapabilityRecord>();

  constructor(private readonly env: Env) {}

  registerNative(handler: NativeHandler): void {
    const id = handler.contract.id;
    if (!isWellFormedCapabilityId(id)) {
      throw new Error(`Refusing to register a malformed capability id: ${id}`);
    }
    // Duplicate names cannot silently shadow an already-trusted handler.
    if (this.natives.has(id)) {
      throw new Error(`Capability ${id} is already registered; refusing to shadow it.`);
    }
    this.natives.set(id, handler);
  }

  /** Every installed native contract, for the registry view handed to the model. */
  nativeContracts(): CapabilityContract[] {
    return [...this.natives.values()].map((h) => h.contract);
  }

  native(id: string): NativeHandler | null {
    return this.natives.get(id) ?? null;
  }

  /**
   * Look up an executable capability. Returns `missing-capability` for an
   * unknown id and `revoked` for one that exists but may no longer run: the
   * two are different conditions and callers must be able to tell them apart.
   */
  async resolve(id: string, version?: string): Promise<Result<CapabilityContract>> {
    if (!isWellFormedCapabilityId(id)) {
      return fail('missing-capability', `"${id}" is not a valid capability id.`);
    }

    const native = this.natives.get(id);
    if (native) {
      if (version && version !== native.contract.version) {
        return fail(
          'contract-mismatch',
          `${id} is installed at ${native.contract.version}, not ${version}.`,
        );
      }
      return ok(native.contract);
    }

    const row = version
      ? await this.env.DB.prepare(
          'SELECT contract, status FROM capabilities WHERE id = ? AND version = ?',
        )
          .bind(id, version)
          .first<{ contract: string; status: string }>()
      : await this.env.DB.prepare(
          `SELECT contract, status FROM capabilities
           WHERE id = ? AND status = 'installed'
           ORDER BY installed_at DESC LIMIT 1`,
        )
          .bind(id)
          .first<{ contract: string; status: string }>();

    if (!row) return fail('missing-capability', `No capability named ${id} is installed.`);
    if (row.status === 'revoked') {
      return fail('revoked', `${id} has been revoked and can no longer run.`);
    }
    if (row.status === 'draft') {
      return fail('missing-capability', `${id} exists only as an unpublished draft.`);
    }
    return ok(JSON.parse(row.contract) as CapabilityContract);
  }

  async loadLuaSource(id: string, version: string): Promise<Result<LuaCapabilityRecord>> {
    const cacheKey = `${id}@${version}`;
    const cached = this.luaCache.get(cacheKey);
    if (cached) return ok(cached);

    const row = await this.env.DB.prepare(
      'SELECT contract, source, source_hash, status FROM capabilities WHERE id = ? AND version = ?',
    )
      .bind(id, version)
      .first<{ contract: string; source: string | null; source_hash: string; status: string }>();

    if (!row) return fail('missing-capability', `No source stored for ${cacheKey}.`);
    if (row.status !== 'installed') {
      return fail('revoked', `${cacheKey} is ${row.status} and cannot be executed.`);
    }
    if (!row.source) return fail('contract-mismatch', `${cacheKey} has no Lua source.`);

    // The stored hash is the identity of the version. A mismatch means the row
    // was altered after installation, so refuse rather than run it.
    const actual = await sha256Hex(row.source);
    if (actual !== row.source_hash) {
      return fail('sandbox-violation', `${cacheKey} source hash does not match its installed record.`);
    }

    const record: LuaCapabilityRecord = {
      contract: JSON.parse(row.contract) as CapabilityContract,
      source: row.source,
    };
    this.luaCache.set(cacheKey, record);
    return ok(record);
  }

  async install(input: {
    contract: Omit<CapabilityContract, 'sourceHash' | 'installedAt' | 'status'>;
    source: string;
    validation: ValidationEvidence;
  }): Promise<Result<CapabilityContract>> {
    if (!isWellFormedCapabilityId(input.contract.id)) {
      return fail('invalid-argument', `"${input.contract.id}" is not a valid capability id.`);
    }
    if (this.natives.has(input.contract.id)) {
      return fail(
        'not-authorised',
        `${input.contract.id} is a trusted host adapter and cannot be shadowed by generated Lua.`,
      );
    }
    if (!input.validation.passed) {
      return fail('contract-mismatch', 'Refusing to install a capability whose validation failed.');
    }

    const existing = await this.env.DB.prepare(
      'SELECT version FROM capabilities WHERE id = ? AND version = ?',
    )
      .bind(input.contract.id, input.contract.version)
      .first<{ version: string }>();
    if (existing) {
      return fail('contract-mismatch', `${input.contract.id}@${input.contract.version} already exists.`);
    }

    const sourceHash = await sha256Hex(input.source);
    const installedAt = new Date().toISOString();
    const contract: CapabilityContract = {
      ...input.contract,
      sourceHash,
      installedAt,
      status: 'installed',
      validation: input.validation,
    };

    // Installation is atomic: contract and source land together or not at all.
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO capabilities
           (id, version, owner, workspace_scope, kind, source_hash, source, contract,
            status, validation, installed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'installed', ?, ?)`,
      ).bind(
        contract.id,
        contract.version,
        contract.owner,
        contract.workspaceScope,
        contract.kind,
        sourceHash,
        input.source,
        JSON.stringify(contract),
        JSON.stringify(input.validation),
        installedAt,
      ),
    ]);

    return ok(contract);
  }

  async revoke(id: string, version: string, reason: string): Promise<Result<true>> {
    const res = await this.env.DB.prepare(
      `UPDATE capabilities SET status = 'revoked', revoked_at = ?
       WHERE id = ? AND version = ? AND status != 'revoked'`,
    )
      .bind(new Date().toISOString(), id, version)
      .run();
    if (!res.meta.changes) {
      return fail('missing-capability', `Nothing to revoke for ${id}@${version}.`);
    }
    this.luaCache.delete(`${id}@${version}`);
    void reason;
    return ok(true);
  }

  /** Installed capabilities visible to a session, as a limited registry view. */
  async listInstalled(): Promise<CapabilityContract[]> {
    const rows = await this.env.DB.prepare(
      `SELECT contract FROM capabilities WHERE status = 'installed' ORDER BY id`,
    ).all<{ contract: string }>();
    const stored = (rows.results ?? []).map((r) => JSON.parse(r.contract) as CapabilityContract);
    return [...this.nativeContracts(), ...stored];
  }

  /** Validates arguments against the installed input contract. */
  validateArgs(contract: CapabilityContract, args: unknown): Result<Record<string, unknown>> {
    const checked = validateAgainstSchema(contract.input, args ?? {});
    if (!checked.ok) return checked;
    return ok(checked.value as Record<string, unknown>);
  }

  validateResult(contract: CapabilityContract, value: unknown): Result<unknown> {
    const size = serializedSize(value);
    if (size > contract.budget.outputBytes) {
      return fail(
        'budget-exhausted',
        `${contract.id} returned ${size} bytes, over its ${contract.budget.outputBytes} ceiling.`,
      );
    }
    return validateAgainstSchema(contract.output, value);
  }
}

/** Permissions a Lua capability may request. Anything else is refused up front. */
export const LUA_GRANTABLE_PERMISSIONS: PermissionName[] = [
  'net.search',
  'net.fetch',
  'workspace.read',
  'workspace.write',
  'skills.read',
  'clock.read',
];
