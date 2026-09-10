import type { Identity, PermissionName } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { sha256Hex } from '../crypto';

/**
 * Skill catalogue with staged loading and per-owner scoping.
 *
 * Three tiers:
 *   global   ships with the Worker, identical for everyone
 *   user     one account's own staged packages, durable
 *   session  one guest's packages, expiry-bound
 *
 * Discovery merges the global tier with the caller's own tier. A user or
 * session package can never shadow a global name, so staging a package called
 * "cloudflare" does not replace the trusted one; the collision is rejected.
 *
 * The Agent Skills format is metadata-first: a catalogue entry carries only
 * what discovery needs to choose. Instructions load on activation, and
 * supporting resources load after that. Loading instructions is not execution.
 */

export type InvocationMode = 'automatic' | 'explicit-only' | 'disabled';
export type TrustLevel = 'bundled' | 'vetted' | 'staged' | 'revoked';
export type OwnerScope = 'global' | 'user' | 'session';

export interface SkillOwner {
  scope: OwnerScope;
  id: string;
}

export const GLOBAL_OWNER: SkillOwner = { scope: 'global', id: '' };

/** The tier a caller's own packages live in. Guests get a session tier. */
export function ownerFor(identity: Identity): SkillOwner {
  return identity.kind === 'user'
    ? { scope: 'user', id: identity.userId }
    : { scope: 'session', id: identity.sessionId };
}

export interface SkillMetadata {
  owner: SkillOwner;
  qualifiedName: string;
  revision: string;
  origin: string;
  title: string;
  description: string;
  license: string;
  contentHash: string;
  invocation: InvocationMode;
  toolPermissions: PermissionName[];
  dependencies: string[];
  trust: TrustLevel;
}

export interface SkillPackage extends SkillMetadata {
  /** The SKILL.md body. Untrusted task material, never policy. */
  body: string;
  resources: Record<string, string>;
}

export interface ParsedSkill {
  name: string;
  description: string;
  license: string;
  invocation: InvocationMode;
  allowedTools: PermissionName[];
  dependencies: string[];
  body: string;
}

const KNOWN_PERMISSIONS = new Set<string>([
  'net.search',
  'net.fetch',
  'workspace.read',
  'workspace.write',
  'skills.read',
  'skills.execute',
  'memory.read',
  'memory.write',
  'cloudflare.read',
  'cloudflare.deploy',
  'clock.read',
]);

/**
 * Parses a SKILL.md file: YAML-ish frontmatter followed by markdown.
 *
 * The parser is deliberately strict and small. An unrecognised frontmatter key
 * is ignored rather than interpreted, so a package cannot introduce a new
 * directive simply by naming one.
 */
export function parseSkillMarkdown(source: string): Result<ParsedSkill> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return fail('contract-mismatch', 'A skill file must begin with YAML frontmatter.');

  const [, frontmatter = '', body = ''] = match;
  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const entry = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!entry) continue;
    fields.set(entry[1]!.toLowerCase(), stripQuotes(entry[2] ?? ''));
  }

  const name = fields.get('name');
  const description = fields.get('description');
  if (!name) return fail('contract-mismatch', 'A skill must declare a name.');
  if (!description) return fail('contract-mismatch', 'A skill must declare a description.');
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) {
    return fail('contract-mismatch', `"${name}" is not a valid skill name.`);
  }

  const invocationRaw = (fields.get('invocation') ?? 'automatic').toLowerCase();
  const invocation: InvocationMode =
    invocationRaw === 'explicit-only' || invocationRaw === 'disabled'
      ? (invocationRaw as InvocationMode)
      : 'automatic';

  const allowedTools = splitList(
    fields.get('allowed-tools') ?? fields.get('allowedtools') ?? '',
  ).filter((t) => KNOWN_PERMISSIONS.has(t)) as PermissionName[];

  return ok({
    name,
    description,
    license: fields.get('license') ?? 'unspecified',
    invocation,
    allowedTools,
    dependencies: splitList(fields.get('dependencies') ?? ''),
    body: body.trim(),
  });
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(/[,\n]/)
    .map((v) => stripQuotes(v).trim())
    .filter((v) => v.length > 0);
}

export class SkillCatalog {
  constructor(private readonly env: Env) {}

  /**
   * Stages a package into one tier without installing or authorising it.
   *
   * A global name is reserved: a user- or session-scoped package that reuses
   * one is rejected rather than allowed to shadow it during discovery.
   */
  async stage(input: {
    owner: SkillOwner;
    qualifiedName: string;
    origin: string;
    source: string;
    trust: TrustLevel;
    resources?: Record<string, string>;
    /** Session-tier packages expire with the session. */
    expiresAt?: string | null;
  }): Promise<Result<SkillMetadata>> {
    const parsed = parseSkillMarkdown(input.source);
    if (!parsed.ok) return parsed;

    if (input.owner.scope !== 'global') {
      const reserved = await this.env.DB.prepare(
        `SELECT origin, trust FROM skill_catalog
         WHERE owner_scope = 'global' AND qualified_name = ? LIMIT 1`,
      )
        .bind(input.qualifiedName)
        .first<{ origin: string; trust: string }>();
      if (reserved) {
        return fail(
          'not-authorised',
          `"${input.qualifiedName}" is a ${reserved.trust} skill from ${reserved.origin}. Your own package cannot take that name; rename it.`,
        );
      }
      if (input.trust === 'bundled' || input.trust === 'vetted') {
        return fail('not-authorised', 'Only the deployment can mark a skill bundled or vetted.');
      }
    }

    const contentHash = await sha256Hex(input.source);
    // An update is a new version requiring its own validation, so the revision
    // is the content hash rather than a self-declared version string.
    const revision = contentHash.slice(0, 16);

    const metadata: SkillMetadata = {
      owner: input.owner,
      qualifiedName: input.qualifiedName,
      revision,
      origin: input.origin,
      title: parsed.value.name,
      description: parsed.value.description,
      license: parsed.value.license,
      contentHash,
      invocation: parsed.value.invocation,
      toolPermissions: parsed.value.allowedTools,
      dependencies: parsed.value.dependencies,
      trust: input.trust,
    };

    await this.env.DB.prepare(
      `INSERT OR REPLACE INTO skill_catalog
         (owner_scope, owner_id, qualified_name, revision, origin, title, description,
          license, content_hash, invocation, tool_permissions, dependencies, trust,
          body, resources, expires_at, staged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        input.owner.scope,
        input.owner.id,
        metadata.qualifiedName,
        metadata.revision,
        metadata.origin,
        metadata.title,
        metadata.description,
        metadata.license,
        metadata.contentHash,
        metadata.invocation,
        JSON.stringify(metadata.toolPermissions),
        JSON.stringify(metadata.dependencies),
        metadata.trust,
        parsed.value.body,
        JSON.stringify(input.resources ?? {}),
        input.expiresAt ?? null,
        new Date().toISOString(),
      )
      .run();

    return ok(metadata);
  }

  /**
   * What one caller can see: the global tier plus their own.
   *
   * Metadata only. Instructions are not loaded at this stage.
   */
  async list(owner: SkillOwner, includeDisabled = false): Promise<SkillMetadata[]> {
    const now = new Date().toISOString();
    const rows = await this.env.DB.prepare(
      `SELECT owner_scope, owner_id, qualified_name, revision, origin, title, description,
              license, content_hash, invocation, tool_permissions, dependencies, trust
       FROM skill_catalog
       WHERE trust != 'revoked'
         AND (expires_at IS NULL OR expires_at > ?)
         AND (owner_scope = 'global' OR (owner_scope = ? AND owner_id = ?))
       ORDER BY (owner_scope = 'global') DESC, qualified_name`,
    )
      .bind(now, owner.scope, owner.id)
      .all<Record<string, unknown>>();

    const seen = new Set<string>();
    const out: SkillMetadata[] = [];
    for (const row of rows.results ?? []) {
      const metadata = rowToMetadata(row);
      if (!includeDisabled && metadata.invocation === 'disabled') continue;
      // Global must sort first so a collision resolves to the trusted package.
      // Ordering on `owner_scope DESC` would not do that: SQLite compares the
      // values lexicographically, and 'user' sorts above 'global'.
      //
      // A collision is reachable even though `stage` refuses a non-global
      // package that reuses a global name, because the two can arrive in the
      // other order: an account stages a name, and a later deployment ships a
      // global package that claims it.
      if (seen.has(metadata.qualifiedName)) continue;
      seen.add(metadata.qualifiedName);
      out.push(metadata);
    }
    return out;
  }

  /**
   * Names where the caller has a package of their own that a global package
   * has since taken over. Their row still exists but no longer resolves, and
   * silently dropping it would leave them wondering why their skill stopped
   * being used.
   */
  async shadowedByGlobal(owner: SkillOwner): Promise<string[]> {
    if (owner.scope === 'global') return [];
    const rows = await this.env.DB.prepare(
      `SELECT DISTINCT mine.qualified_name AS name
       FROM skill_catalog mine
       JOIN skill_catalog global
         ON global.qualified_name = mine.qualified_name
        AND global.owner_scope = 'global'
       WHERE mine.owner_scope = ? AND mine.owner_id = ? AND mine.trust != 'revoked'`,
    )
      .bind(owner.scope, owner.id)
      .all<{ name: string }>();
    return (rows.results ?? []).map((r) => r.name);
  }

  /** Loads the pinned instructions for one revision the caller can reach. */
  async load(owner: SkillOwner, qualifiedName: string, revision?: string): Promise<Result<SkillPackage>> {
    const now = new Date().toISOString();
    // Global first, for the same reason as `list`: this row's body is what
    // `activate` wraps and puts in the prompt, so resolving a collision to the
    // caller's own package would let it serve its instructions under a trusted
    // name indefinitely.
    const sql = `SELECT * FROM skill_catalog
       WHERE qualified_name = ?
         AND (expires_at IS NULL OR expires_at > ?)
         AND (owner_scope = 'global' OR (owner_scope = ? AND owner_id = ?))
         ${revision ? 'AND revision = ?' : ''}
       ORDER BY (owner_scope = 'global') DESC, staged_at DESC LIMIT 1`;

    const statement = revision
      ? this.env.DB.prepare(sql).bind(qualifiedName, now, owner.scope, owner.id, revision)
      : this.env.DB.prepare(sql).bind(qualifiedName, now, owner.scope, owner.id);

    const row = await statement.first<Record<string, unknown>>();
    if (!row) return fail('missing-skill', `No skill named ${qualifiedName} is available to you.`);

    const metadata = rowToMetadata(row);
    if (metadata.trust === 'revoked') {
      return fail('revoked', `${qualifiedName}@${metadata.revision} is revoked and cannot run.`);
    }

    return ok({
      ...metadata,
      body: String(row.body ?? ''),
      resources: safeParseRecord(row.resources),
    });
  }

  /** Revocation is scoped: a user cannot revoke a global skill for everyone. */
  async revoke(owner: SkillOwner, qualifiedName: string, revision: string): Promise<Result<true>> {
    const res = await this.env.DB.prepare(
      `UPDATE skill_catalog SET trust = 'revoked'
       WHERE qualified_name = ? AND revision = ? AND owner_scope = ? AND owner_id = ?`,
    )
      .bind(qualifiedName, revision, owner.scope, owner.id)
      .run();
    if (!res.meta.changes) {
      return fail('missing-skill', 'No such skill revision in a tier you control.');
    }
    return ok(true);
  }

  /** Removes a guest's packages when their session ends. */
  async purgeSession(sessionId: string): Promise<number> {
    const res = await this.env.DB.prepare(
      `DELETE FROM skill_catalog WHERE owner_scope = 'session' AND owner_id = ?`,
    )
      .bind(sessionId)
      .run();
    return res.meta.changes ?? 0;
  }
}

function rowToMetadata(row: Record<string, unknown>): SkillMetadata {
  return {
    owner: {
      scope: (row.owner_scope as OwnerScope) ?? 'global',
      id: String(row.owner_id ?? ''),
    },
    qualifiedName: String(row.qualified_name),
    revision: String(row.revision),
    origin: String(row.origin),
    title: String(row.title),
    description: String(row.description),
    license: String(row.license),
    contentHash: String(row.content_hash),
    invocation: (row.invocation as InvocationMode) ?? 'automatic',
    toolPermissions: safeParseArray(row.tool_permissions) as PermissionName[],
    dependencies: safeParseArray(row.dependencies),
    trust: (row.trust as TrustLevel) ?? 'staged',
  };
}

function safeParseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
    return out;
  } catch {
    return {};
  }
}
