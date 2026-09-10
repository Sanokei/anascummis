import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, seedUser, splitStatements } from '../helpers/db';

/**
 * The migrations are the schema. Several guarantees the worker relies on are
 * not written in TypeScript at all: they are CHECK constraints, partial unique
 * indexes and cascades, and nothing else in the codebase notices when an edit
 * drops one.
 */

beforeAll(applyMigrations);

async function tableNames(): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name",
  ).all<{ name: string }>();
  return (rows.results ?? []).map((r) => r.name);
}

describe('migrations', () => {
  it('are numbered without a gap or a duplicate', () => {
    const numbers = migrationFiles().map((m) => Number(m.name.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('splits statements even when a comment carries a semicolon', () => {
    const sql = "-- one; two\nCREATE TABLE t (a TEXT); -- trailing;\nINSERT INTO t VALUES ('x');";
    expect(splitStatements(sql)).toEqual(['CREATE TABLE t (a TEXT)', "INSERT INTO t VALUES ('x')"]);
  });

  it('creates every table the worker reads or writes', async () => {
    const names = await tableNames();
    for (const table of [
      'users',
      'identities',
      'sessions',
      'oauth_flows',
      'service_connections',
      'global_config',
      'checkpoints',
      'turns',
      'memory_files',
      'memory_index',
      'capabilities',
      'capability_grants',
      'action_receipts',
      'skill_catalog',
      'skill_runs',
      'stories',
      'consent_records',
      'job_records',
      'vision_pages',
      'vision_annotations',
      'access_identities',
    ]) {
      expect(names).toContain(table);
    }
  });
});

describe('users', () => {
  it('defaults a new account to the member role with memory off', async () => {
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .bind('u_role', 'role@example.test', new Date().toISOString())
      .run();
    const row = await env.DB.prepare('SELECT role, memory_enabled FROM users WHERE id = ?')
      .bind('u_role')
      .first<{ role: string; memory_enabled: number }>();
    expect(row).toEqual({ role: 'member', memory_enabled: 0 });
  });

  it('refuses a second account on the same address', async () => {
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .bind('u_a', 'shared@example.test', now)
      .run();
    await expect(
      env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
        .bind('u_b', 'shared@example.test', now)
        .run(),
    ).rejects.toThrow();
  });

  it('allows many accounts with no address, because the index is partial', async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, NULL, ?)').bind('u_n1', now),
      env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, NULL, ?)').bind('u_n2', now),
    ]);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email IS NULL').first<{
      n: number;
    }>();
    expect(row?.n).toBe(2);
  });
});

describe('constrained columns', () => {
  function insertCheckpoint(id: string, column: 'snapshot_kind' | 'branch_state', value: string) {
    return env.DB.prepare(
      `INSERT INTO checkpoints
         (id, session_id, parent_id, story_id, story_version, runtime_state,
          snapshot_kind, context_revision, branch_state, created_at)
       VALUES (?, 's1', NULL, 'story', '1', '{}', ?, 'r1', ?, ?)`,
    ).bind(
      id,
      column === 'snapshot_kind' ? value : 'full',
      column === 'branch_state' ? value : 'current',
      new Date().toISOString(),
    );
  }

  it('accepts only a full or delta snapshot kind', async () => {
    await insertCheckpoint('ck_ok', 'snapshot_kind', 'full').run();
    await expect(insertCheckpoint('ck_bad', 'snapshot_kind', 'partial').run()).rejects.toThrow();
  });

  it('accepts only the four documented branch states', async () => {
    for (const state of ['current', 'inactive', 'archived', 'pinned']) {
      await insertCheckpoint(`ck_${state}`, 'branch_state', state).run();
    }
    await expect(insertCheckpoint('ck_bogus', 'branch_state', 'deleted').run()).rejects.toThrow();
  });

  it('accepts only a user, project or topic memory scope', async () => {
    const identity = await seedUser();
    const now = new Date().toISOString();
    const write = (id: string, scope: string) =>
      env.DB.prepare(
        `INSERT INTO memory_files (id, user_id, scope, path, title, body, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'p', 't', 'b', 'authored', ?, ?)`,
      )
        .bind(id, identity.userId, scope, now, now)
        .run();
    await write('m_ok', 'topic');
    await expect(write('m_bad', 'global')).rejects.toThrow();
  });
});

describe('registry and receipt keys', () => {
  it('holds one row per capability id and version', async () => {
    const install = (version: string) =>
      env.DB.prepare(
        `INSERT INTO capabilities
           (id, version, owner, workspace_scope, kind, source_hash, contract, status, validation, installed_at)
         VALUES ('web.search', ?, 'host', 'global', 'native', 'h', '{}', 'installed', '{}', ?)`,
      )
        .bind(version, new Date().toISOString())
        .run();
    await install('1.0.0');
    await install('1.1.0');
    await expect(install('1.0.0')).rejects.toThrow();
  });

  it('refuses a repeated idempotency key for the same capability', async () => {
    const receipt = (id: string, capability: string) =>
      env.DB.prepare(
        `INSERT INTO action_receipts
           (id, session_id, capability_id, capability_version, idempotency_key,
            arguments_hash, generation, intent_at, outcome)
         VALUES (?, 's1', ?, '1.0.0', 'idem_1', 'hash', 1, ?, 'pending')`,
      )
        .bind(id, capability, new Date().toISOString())
        .run();
    await receipt('r_1', 'web.search');
    await expect(receipt('r_2', 'web.search')).rejects.toThrow();
    // The same key against a different capability is a different action.
    await receipt('r_3', 'web.fetch');
  });
});

describe('skill catalogue scoping', () => {
  const stage = (scope: string, owner: string, name: string, revision = '1') =>
    env.DB.prepare(
      `INSERT INTO skill_catalog
         (owner_scope, owner_id, qualified_name, revision, origin, title, description,
          license, content_hash, invocation, trust, body, staged_at)
       VALUES (?, ?, ?, ?, 'test', 'T', 'D', 'MIT', 'h', 'automatic', ?, 'body', ?)`,
    )
      .bind(scope, owner, name, revision, scope === 'global' ? 'bundled' : 'staged', new Date().toISOString())
      .run();

  it('lets one global name and revision map to exactly one package', async () => {
    await stage('global', '', 'cloudflare');
    await expect(stage('global', '', 'cloudflare')).rejects.toThrow();
    await stage('global', '', 'cloudflare', '2');
  });

  it('lets two accounts stage the same name without colliding', async () => {
    await stage('user', 'u_1', 'wrangler');
    await stage('user', 'u_2', 'wrangler');
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM skill_catalog WHERE qualified_name = 'wrangler'",
    ).first<{ n: number }>();
    expect(row?.n).toBe(2);
  });
});

describe('account deletion', () => {
  it('takes the memory, config and linked identities with it', async () => {
    const identity = await seedUser();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO memory_files (id, user_id, scope, path, title, body, origin, created_at, updated_at)
         VALUES ('m_del', ?, 'topic', 'p', 't', 'b', 'learned', ?, ?)`,
      ).bind(identity.userId, now, now),
      env.DB.prepare(
        `INSERT INTO global_config (user_id, schema_version, document, updated_at)
         VALUES (?, 2, '{}', ?)`,
      ).bind(identity.userId, now),
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, provider, provider_uid, linked_at)
         VALUES ('i_del', ?, 'github', 'uid', ?)`,
      ).bind(identity.userId, now),
    ]);

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(identity.userId).run();

    for (const table of ['memory_files', 'global_config', 'identities']) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`)
        .bind(identity.userId)
        .first<{ n: number }>();
      expect(row?.n, `${table} still holds rows for the deleted account`).toBe(0);
    }
  });
});
