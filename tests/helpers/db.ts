import { env } from 'cloudflare:test';
import type { Identity } from '@shared/types';

/**
 * Schema loading for tests.
 *
 * The test pool hands out an empty D1 database, so the migrations under
 * `migrations/` are the schema under test as much as they are setup: a table
 * or constraint that never made it into a migration will fail here rather than
 * in production. They are pulled in through the bundler instead of the
 * filesystem because the pool runs tests inside workerd, where `node:fs` is
 * not available.
 */
const migrationSources = import.meta.glob('../../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * D1's `exec` wants one statement per line, and these migrations are written
 * for humans, so the file is split here instead. Line comments go first
 * because several of them contain a semicolon; no migration puts a semicolon
 * or a `--` inside a string literal, and this will need revisiting if one ever
 * does.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Every migration, in filename order, which is the order they are numbered in. */
export function migrationFiles(): { name: string; sql: string }[] {
  return Object.entries(migrationSources)
    .map(([path, sql]) => ({ name: path.slice(path.lastIndexOf('/') + 1), sql }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function applyMigrations(): Promise<void> {
  for (const migration of migrationFiles()) {
    for (const statement of splitStatements(migration.sql)) {
      try {
        await env.DB.prepare(statement).run();
      } catch (cause) {
        throw new Error(`${migration.name} failed on: ${statement.slice(0, 80)}`, { cause });
      }
    }
  }
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${(seq += 1).toString().padStart(4, '0')}`;

export async function seedUser(input?: {
  email?: string;
  memoryEnabled?: boolean;
}): Promise<Extract<Identity, { kind: 'user' }>> {
  const userId = nextId('u');
  await env.DB.prepare(
    'INSERT INTO users (id, email, display_name, created_at, memory_enabled) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      userId,
      input?.email ?? `${userId}@example.test`,
      'Test Account',
      new Date().toISOString(),
      input?.memoryEnabled === false ? 0 : 1,
    )
    .run();
  return {
    kind: 'user',
    sessionId: nextId('s'),
    userId,
    email: input?.email ?? `${userId}@example.test`,
    displayName: 'Test Account',
  };
}

export function guest(): Extract<Identity, { kind: 'guest' }> {
  return { kind: 'guest', sessionId: nextId('s') };
}

/** A second session for the same account, to check session-scoped boundaries. */
export function anotherSession<T extends Identity>(identity: T): T {
  return { ...identity, sessionId: nextId('s') };
}
