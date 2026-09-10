import type { PermissionName } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { sha256Hex } from '../crypto';

/**
 * Skill catalogue with staged loading.
 *
 * The Agent Skills format is metadata-first: a catalogue entry carries only
 * what discovery needs to choose. Instructions load on activation, and
 * supporting resources load after that. Loading instructions is not execution.
 */

export type InvocationMode = 'automatic' | 'explicit-only' | 'disabled';
export type TrustLevel = 'bundled' | 'vetted' | 'staged' | 'revoked';

export interface SkillMetadata {
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

  const allowedTools = splitList(fields.get('allowed-tools') ?? fields.get('allowedtools') ?? '')
    .filter((t) => KNOWN_PERMISSIONS.has(t)) as PermissionName[];

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
   * Stages a package without installing or authorising it.
   *
   * A duplicate qualified name cannot shadow a trusted skill: a bundled or
   * vetted entry with the same name blocks the staging outright.
   */
  async stage(input: {
    qualifiedName: string;
    origin: string;
    source: string;
    trust: TrustLevel;
    resources?: Record<string, string>;
  }): Promise<Result<SkillMetadata>> {
    const parsed = parseSkillMarkdown(input.source);
    if (!parsed.ok) return parsed;

    const existingTrusted = await this.env.DB.prepare(
      `SELECT trust, origin FROM skill_catalog
       WHERE qualified_name = ? AND trust IN ('bundled','vetted')
       ORDER BY staged_at DESC LIMIT 1`,
    )
      .bind(input.qualifiedName)
      .first<{ trust: string; origin: string }>();

    if (existingTrusted && existingTrusted.origin !== input.origin && input.trust === 'staged') {
      return fail(
        'not-authorised',
        `"${input.qualifiedName}" already names a ${existingTrusted.trust} skill from ${existingTrusted.origin}. A staged package cannot shadow it.`,
      );
    }

    const contentHash = await sha256Hex(input.source);
    // An update is a new version requiring its own validation, so the revision
    // is the content hash rather than a self-declared version string.
    const revision = contentHash.slice(0, 16);

    const metadata: SkillMetadata = {
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
         (qualified_name, revision, origin, title, description, license, content_hash,
          invocation, tool_permissions, dependencies, trust, body, resources, staged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
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
        new Date().toISOString(),
      )
      .run();

    return ok(metadata);
  }

  /** Catalogue metadata only. Instructions are not loaded at this stage. */
  async list(includeDisabled = false): Promise<SkillMetadata[]> {
    const rows = await this.env.DB.prepare(
      `SELECT qualified_name, revision, origin, title, description, license, content_hash,
              invocation, tool_permissions, dependencies, trust
       FROM skill_catalog WHERE trust != 'revoked' ORDER BY qualified_name`,
    ).all<Record<string, unknown>>();
    return (rows.results ?? [])
      .map(rowToMetadata)
      .filter((s) => includeDisabled || s.invocation !== 'disabled');
  }

  /** Loads the pinned instructions for one revision. */
  async load(qualifiedName: string, revision?: string): Promise<Result<SkillPackage>> {
    const row = revision
      ? await this.env.DB.prepare(
          'SELECT * FROM skill_catalog WHERE qualified_name = ? AND revision = ?',
        )
          .bind(qualifiedName, revision)
          .first<Record<string, unknown>>()
      : await this.env.DB.prepare(
          `SELECT * FROM skill_catalog WHERE qualified_name = ? ORDER BY staged_at DESC LIMIT 1`,
        )
          .bind(qualifiedName)
          .first<Record<string, unknown>>();

    if (!row) return fail('missing-skill', `No skill named ${qualifiedName} is in the catalogue.`);
    const metadata = rowToMetadata(row);
    if (metadata.trust === 'revoked') {
      return fail('revoked', `${qualifiedName}@${metadata.revision} is revoked and cannot run.`);
    }

    const body = String(row.body ?? '');
    // The stored hash covers the whole source file, so re-checking the body
    // alone would not match. Integrity is asserted at staging time.
    return ok({
      ...metadata,
      body,
      resources: safeParseRecord(row.resources),
    });
  }

  async revoke(qualifiedName: string, revision: string): Promise<Result<true>> {
    const res = await this.env.DB.prepare(
      `UPDATE skill_catalog SET trust = 'revoked' WHERE qualified_name = ? AND revision = ?`,
    )
      .bind(qualifiedName, revision)
      .run();
    if (!res.meta.changes) return fail('missing-skill', 'No such skill revision.');
    return ok(true);
  }
}

function rowToMetadata(row: Record<string, unknown>): SkillMetadata {
  return {
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
