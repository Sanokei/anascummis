import type { GlobalConfig, Identity, Turn } from '@shared/types';
import { DEFAULT_GLOBAL_CONFIG, fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { randomId } from '../crypto';

/**
 * Layered context, after Claude Code's documented pattern: scoped instruction
 * files, topic context loaded when relevant, and a concise index that points at
 * separate topic files rather than one growing memory document.
 *
 * The hierarchy is global product guidance, user preferences, project or task
 * context, relevant topic memories, then immediate conversation state.
 * Host-enforced constraints deliberately sit outside it: memory content is
 * context, never policy, and nothing loaded here can raise authority.
 */

export interface Mission {
  /** What the user is actually trying to do overall. May be absent. */
  mission: string | null;
  currentTask: string | null;
  currentFocus: string | null;
  acceptedConstraints: string[];
  unresolvedDecisions: string[];
}

export const EMPTY_MISSION: Mission = {
  mission: null,
  currentTask: null,
  currentFocus: null,
  acceptedConstraints: [],
  unresolvedDecisions: [],
};

export interface MemoryFile {
  id: string;
  scope: 'user' | 'project' | 'topic';
  path: string;
  title: string;
  body: string;
  revision: number;
  origin: 'authored' | 'learned';
  confirmed: boolean;
  sourceRefs: string[];
  branchId: string | null;
}

export interface AssembledContext {
  /** Ordered from most general to most specific. */
  layers: { name: string; body: string }[];
  mission: Mission;
  recentTurns: Turn[];
  loadedMemoryIds: string[];
  /** Set when a required piece of context could not be loaded. */
  missing: string[];
}

const WORKING_TURN_TARGET = 12;

export class MemoryManager {
  constructor(private readonly env: Env) {}

  /* ---------------- global configuration ---------------- */

  async loadConfig(identity: Identity): Promise<GlobalConfig> {
    if (identity.kind !== 'user') return structuredClone(DEFAULT_GLOBAL_CONFIG);
    const row = await this.env.DB.prepare(
      'SELECT document, schema_version FROM global_config WHERE user_id = ?',
    )
      .bind(identity.userId)
      .first<{ document: string; schema_version: number }>();
    if (!row) return structuredClone(DEFAULT_GLOBAL_CONFIG);
    try {
      return migrateConfig(JSON.parse(row.document) as GlobalConfig, row.schema_version);
    } catch {
      return structuredClone(DEFAULT_GLOBAL_CONFIG);
    }
  }

  /**
   * Writes configuration through a validated host setter. A generated story
   * cannot reach this: persistence, spending and credentials are not fields it
   * can name, and unknown keys are dropped rather than merged.
   */
  async saveConfig(identity: Identity, patch: unknown): Promise<Result<GlobalConfig>> {
    if (identity.kind !== 'user') {
      return fail('not-authorised', 'Durable preferences need a signed-in account.');
    }
    const current = await this.loadConfig(identity);
    const merged = applyConfigPatch(current, patch);
    if (!merged.ok) return merged;

    await this.env.DB.prepare(
      `INSERT INTO global_config (user_id, schema_version, document, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET schema_version = excluded.schema_version,
         document = excluded.document, updated_at = excluded.updated_at`,
    )
      .bind(identity.userId, merged.value.schemaVersion, JSON.stringify(merged.value), new Date().toISOString())
      .run();
    return merged;
  }

  /* ---------------- memory files ---------------- */

  /**
   * The index routes retrieval. Only matching topic files are loaded, so a
   * worker's context contains the sources its task needs and nothing else.
   */
  async recall(identity: Identity, query: string, limit = 5): Promise<MemoryFile[]> {
    if (identity.kind !== 'user') return [];
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2);
    if (terms.length === 0) return [];

    const rows = await this.env.DB.prepare(
      `SELECT DISTINCT m.id, m.scope, m.path, m.title, m.body, m.revision, m.origin,
              m.confirmed, m.source_refs, m.branch_id
       FROM memory_files m
       LEFT JOIN memory_index i ON i.memory_id = m.id
       WHERE m.user_id = ? AND m.superseded_by IS NULL
       ORDER BY m.updated_at DESC LIMIT 100`,
    )
      .bind(identity.userId)
      .all<Record<string, unknown>>();

    return (rows.results ?? [])
      .map(rowToMemory)
      .map((file) => {
        const hay = `${file.path} ${file.title} ${file.body}`.toLowerCase();
        return { file, score: terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.file);
  }

  /**
   * Records a memory.
   *
   * A proposed summary cannot overwrite a user-confirmed fact: it is stored as
   * a new revision and the old one is marked superseded only when the new one
   * is itself confirmed. A branch hypothesis keeps its `branchId` so it never
   * reads as global truth.
   */
  async remember(
    identity: Identity,
    input: {
      scope: 'user' | 'project' | 'topic';
      path: string;
      title: string;
      body: string;
      origin: 'authored' | 'learned';
      confirmed: boolean;
      sourceRefs?: string[];
      branchId?: string | null;
      indexKeys?: string[];
    },
  ): Promise<Result<MemoryFile>> {
    if (identity.kind !== 'user') {
      return fail('not-authorised', 'Guests have no durable memory. Sign in to keep this.');
    }
    const enabled = await this.persistenceEnabled(identity);
    if (!enabled) {
      return fail('not-authorised', 'Durable memory is switched off for this account.');
    }
    if (!/^[a-z0-9][a-z0-9/_-]{0,180}$/.test(input.path)) {
      return fail('invalid-argument', 'A memory path may not contain traversal or spaces.');
    }

    const existing = await this.env.DB.prepare(
      `SELECT id, revision, confirmed FROM memory_files
       WHERE user_id = ? AND path = ? AND superseded_by IS NULL
       ORDER BY revision DESC LIMIT 1`,
    )
      .bind(identity.userId, input.path)
      .first<{ id: string; revision: number; confirmed: number }>();

    if (existing && existing.confirmed === 1 && !input.confirmed) {
      return fail(
        'not-authorised',
        `"${input.path}" holds a fact you confirmed. A proposed summary cannot replace it.`,
      );
    }

    const id = randomId('mem');
    const revision = (existing?.revision ?? 0) + 1;
    const now = new Date().toISOString();

    const statements = [
      this.env.DB.prepare(
        `INSERT INTO memory_files
           (id, user_id, scope, path, title, body, revision, origin, confirmed,
            source_refs, branch_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        identity.userId,
        input.scope,
        input.path,
        input.title,
        input.body,
        revision,
        input.origin,
        input.confirmed ? 1 : 0,
        JSON.stringify(input.sourceRefs ?? []),
        input.branchId ?? null,
        now,
        now,
      ),
    ];
    if (existing) {
      statements.push(
        this.env.DB.prepare('UPDATE memory_files SET superseded_by = ? WHERE id = ?').bind(id, existing.id),
      );
    }
    for (const key of (input.indexKeys ?? []).slice(0, 12)) {
      statements.push(
        this.env.DB.prepare(
          'INSERT OR REPLACE INTO memory_index (user_id, key, memory_id, weight) VALUES (?, ?, ?, 1.0)',
        ).bind(identity.userId, key.toLowerCase().slice(0, 80), id),
      );
    }
    await this.env.DB.batch(statements);

    return ok({
      id,
      scope: input.scope,
      path: input.path,
      title: input.title,
      body: input.body,
      revision,
      origin: input.origin,
      confirmed: input.confirmed,
      sourceRefs: input.sourceRefs ?? [],
      branchId: input.branchId ?? null,
    });
  }

  async persistenceEnabled(identity: Identity): Promise<boolean> {
    if (identity.kind !== 'user') return false;
    const row = await this.env.DB.prepare('SELECT memory_enabled FROM users WHERE id = ?')
      .bind(identity.userId)
      .first<{ memory_enabled: number }>();
    return row?.memory_enabled === 1;
  }

  async setPersistence(identity: Identity, enabled: boolean): Promise<Result<boolean>> {
    if (identity.kind !== 'user') {
      return fail('not-authorised', 'Only a signed-in account can enable durable memory.');
    }
    await this.env.DB.prepare('UPDATE users SET memory_enabled = ? WHERE id = ?')
      .bind(enabled ? 1 : 0, identity.userId)
      .run();
    return ok(enabled);
  }

  /** Export and deletion controls, so the memory setting is inspectable. */
  async exportAll(identity: Identity): Promise<Result<{ memories: MemoryFile[]; config: GlobalConfig }>> {
    if (identity.kind !== 'user') {
      return fail('not-authorised', 'There is nothing durable to export for a guest.');
    }
    const rows = await this.env.DB.prepare(
      `SELECT id, scope, path, title, body, revision, origin, confirmed, source_refs, branch_id
       FROM memory_files WHERE user_id = ? ORDER BY path, revision`,
    )
      .bind(identity.userId)
      .all<Record<string, unknown>>();
    return ok({
      memories: (rows.results ?? []).map(rowToMemory),
      config: await this.loadConfig(identity),
    });
  }

  /**
   * Deletion overrides pins and removes the associated index entries.
   *
   * The count is taken before the delete rather than read from `meta.changes`.
   * D1 reports one figure for the whole statement, and rows removed from
   * `memory_index` by the cascade are counted alongside the memories, so a
   * single memory with two index keys would otherwise be reported as three
   * deletions to the user.
   */
  async deleteAll(identity: Identity): Promise<Result<number>> {
    if (identity.kind !== 'user') return fail('not-authorised', 'Guests have no durable memory to delete.');

    const counted = await this.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM memory_files WHERE user_id = ?',
    )
      .bind(identity.userId)
      .first<{ n: number }>();
    const removed = counted?.n ?? 0;

    await this.env.DB.prepare('DELETE FROM memory_files WHERE user_id = ?')
      .bind(identity.userId)
      .run();
    // The cascade covers this, but an orphaned index row would otherwise
    // survive and keep routing retrieval at a memory that no longer exists.
    await this.env.DB.prepare('DELETE FROM memory_index WHERE user_id = ?').bind(identity.userId).run();

    return ok(removed);
  }

  /* ---------------- assembly ---------------- */

  async assemble(input: {
    identity: Identity;
    mission: Mission;
    recentTurns: Turn[];
    query: string;
    /** Restricts loading to what a worker's task actually needs. */
    scopeHint?: 'conversation' | 'worker';
  }): Promise<AssembledContext> {
    const layers: { name: string; body: string }[] = [];
    const missing: string[] = [];

    layers.push({ name: 'product-guidance', body: PRODUCT_GUIDANCE });

    const config = await this.loadConfig(input.identity);
    layers.push({
      name: 'user-preferences',
      body: [
        `Confirmation mode: ${config.dialogue.confirmationMode}.`,
        `Language: ${config.dialogue.language}.`,
        config.accessibility.reducedMotion ? 'Reduced motion is on.' : '',
        config.accessibility.screenReaderVerbose ? 'Screen-reader verbosity is on.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    });

    const missionBody = describeMission(input.mission);
    if (missionBody) layers.push({ name: 'mission', body: missionBody });

    const memories = input.scopeHint === 'worker' ? [] : await this.recall(input.identity, input.query, 5);
    if (memories.length > 0) {
      layers.push({
        name: 'topic-memory',
        body: memories
          .map((m) => `## ${m.title} (${m.path}, r${m.revision}${m.confirmed ? ', confirmed' : ''})\n${m.body}`)
          .join('\n\n'),
      });
    }

    // Three relevant units is a working target, not permission to drop an
    // older constraint that still applies, so constraints ride in the mission
    // layer rather than being trimmed with the turn window.
    const recent = input.recentTurns.slice(-WORKING_TURN_TARGET);
    if (input.mission.acceptedConstraints.length > 0 && !missionBody) {
      missing.push('mission');
    }

    return {
      layers,
      mission: input.mission,
      recentTurns: recent,
      loadedMemoryIds: memories.map((m) => m.id),
      missing,
    };
  }
}

const PRODUCT_GUIDANCE = [
  'You are Anascummis. Composed, practical, quietly curious, slightly dry.',
  'Most turns are one sentence. Use a second only when the meaning needs it.',
  'Answer the actual question. Leave absurdity unexplained.',
  'Never open with praise such as "Great question" or "Absolutely".',
  'Distinguish a documented finding, a claim, a proposal, a test result, and an unknown.',
  'Never claim to have browsed, deployed, messaged anyone, or finished work the system did not do.',
].join(' ');

export function describeMission(mission: Mission): string {
  const parts: string[] = [];
  if (mission.mission) parts.push(`Mission: ${mission.mission}`);
  if (mission.currentTask) parts.push(`Current task: ${mission.currentTask}`);
  if (mission.currentFocus) parts.push(`Current focus: ${mission.currentFocus}`);
  if (mission.acceptedConstraints.length > 0) {
    parts.push(`Accepted constraints: ${mission.acceptedConstraints.join('; ')}`);
  }
  if (mission.unresolvedDecisions.length > 0) {
    parts.push(`Still undecided: ${mission.unresolvedDecisions.join('; ')}`);
  }
  return parts.join('\n');
}

function rowToMemory(row: Record<string, unknown>): MemoryFile {
  return {
    id: String(row.id),
    scope: (row.scope as MemoryFile['scope']) ?? 'topic',
    path: String(row.path),
    title: String(row.title),
    body: String(row.body),
    revision: Number(row.revision ?? 1),
    origin: (row.origin as MemoryFile['origin']) ?? 'learned',
    confirmed: row.confirmed === 1,
    sourceRefs: safeParseArray(row.source_refs),
    branchId: row.branch_id === null || row.branch_id === undefined ? null : String(row.branch_id),
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

/**
 * Applies a preference patch. Only these keys exist, so persistence,
 * credentials and spending cannot be reached through this path at all.
 */
export function applyConfigPatch(current: GlobalConfig, patch: unknown): Result<GlobalConfig> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return fail('invalid-argument', 'Expected a settings object.');
  }
  const next: GlobalConfig = structuredClone(current);
  const input = patch as Record<string, unknown>;

  const dialogue = input.dialogue as Record<string, unknown> | undefined;
  if (dialogue) {
    if (isConfirmationMode(dialogue.confirmationMode)) {
      next.dialogue.confirmationMode = dialogue.confirmationMode;
    }
    if (typeof dialogue.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(dialogue.language)) {
      next.dialogue.language = dialogue.language;
    }
    if (typeof dialogue.speechOutput === 'boolean') next.dialogue.speechOutput = dialogue.speechOutput;
    if (typeof dialogue.speechRate === 'number') {
      next.dialogue.speechRate = clamp(dialogue.speechRate, 0.5, 2);
    }
    if (typeof dialogue.allowInterruption === 'boolean') {
      next.dialogue.allowInterruption = dialogue.allowInterruption;
    }
  }

  const a11y = input.accessibility as Record<string, unknown> | undefined;
  if (a11y) {
    if (typeof a11y.captions === 'boolean') next.accessibility.captions = a11y.captions;
    if (typeof a11y.textScale === 'number') next.accessibility.textScale = clamp(a11y.textScale, 0.8, 2);
    if (typeof a11y.highContrast === 'boolean') next.accessibility.highContrast = a11y.highContrast;
    if (typeof a11y.reducedMotion === 'boolean') next.accessibility.reducedMotion = a11y.reducedMotion;
    if (typeof a11y.screenReaderVerbose === 'boolean') {
      next.accessibility.screenReaderVerbose = a11y.screenReaderVerbose;
    }
  }

  const project = input.project as Record<string, unknown> | undefined;
  if (project) {
    for (const [key, value] of Object.entries(project).slice(0, 40)) {
      if (typeof value === 'string' && key.length <= 60) next.project[key] = value.slice(0, 500);
    }
  }

  return ok(next);
}

function isConfirmationMode(value: unknown): value is GlobalConfig['dialogue']['confirmationMode'] {
  return value === 'always' || value === 'risky-only' || value === 'off';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Forward migration for the schema-versioned configuration document. */
export function migrateConfig(document: GlobalConfig, version: number): GlobalConfig {
  if (version >= 2) return { ...structuredClone(DEFAULT_GLOBAL_CONFIG), ...document, schemaVersion: 2 };
  // Version 1 had no accessibility block; defaults fill it rather than erroring.
  return {
    ...structuredClone(DEFAULT_GLOBAL_CONFIG),
    ...document,
    accessibility: { ...DEFAULT_GLOBAL_CONFIG.accessibility, ...(document.accessibility ?? {}) },
    schemaVersion: 2,
  };
}
