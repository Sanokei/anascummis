import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_CONFIG } from '@shared/types';
import { MemoryManager } from '@worker/memory/manager';
import { applyMigrations, guest, seedUser } from '../helpers/db';

/**
 * Durable memory is the part of the product with a promise attached: a guest
 * leaves nothing behind, a switched-off account writes nothing, and a fact the
 * user confirmed is not quietly replaced by something the model inferred.
 * Each of those is a D1 write path, so each is checked against real rows.
 */

beforeAll(applyMigrations);

const manager = () => new MemoryManager(env);

const countRows = async (table: string): Promise<number> => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
};

describe('global configuration', () => {
  it('hands a guest the defaults without touching the table', async () => {
    const config = await manager().loadConfig(guest());
    expect(config).toEqual(DEFAULT_GLOBAL_CONFIG);
    expect(await countRows('global_config')).toBe(0);
  });

  it('hands an account with no row the defaults', async () => {
    const identity = await seedUser();
    expect(await manager().loadConfig(identity)).toEqual(DEFAULT_GLOBAL_CONFIG);
  });

  it('round-trips a saved preference through D1', async () => {
    const identity = await seedUser();
    const saved = await manager().saveConfig(identity, {
      dialogue: { confirmationMode: 'risky-only', language: 'pt-BR' },
      accessibility: { reducedMotion: true },
    });
    expect(saved.ok).toBe(true);

    const reloaded = await manager().loadConfig(identity);
    expect(reloaded.dialogue.confirmationMode).toBe('risky-only');
    expect(reloaded.dialogue.language).toBe('pt-BR');
    expect(reloaded.accessibility.reducedMotion).toBe(true);
  });

  it('updates the existing row rather than accumulating rows per save', async () => {
    const identity = await seedUser();
    await manager().saveConfig(identity, { dialogue: { language: 'fr' } });
    await manager().saveConfig(identity, { dialogue: { language: 'de' } });
    expect(await countRows('global_config')).toBe(1);
    expect((await manager().loadConfig(identity)).dialogue.language).toBe('de');
  });

  it('refuses to give a guest durable preferences', async () => {
    const result = await manager().saveConfig(guest(), { dialogue: { language: 'fr' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('not-authorised');
  });

  it('drops keys that are not preferences, so persistence cannot be set this way', async () => {
    const identity = await seedUser({ memoryEnabled: false });
    await manager().saveConfig(identity, {
      memory: { persistenceEnabled: true },
      dialogue: { language: 'en' },
    });
    expect((await manager().loadConfig(identity)).memory.persistenceEnabled).toBe(false);
    expect(await manager().persistenceEnabled(identity)).toBe(false);
  });

  it('clamps a speech rate that is out of range instead of storing it', async () => {
    const identity = await seedUser();
    await manager().saveConfig(identity, { dialogue: { speechRate: 40 } });
    expect((await manager().loadConfig(identity)).dialogue.speechRate).toBe(2);
  });

  it('fills in the block a version 1 document never had', async () => {
    const identity = await seedUser();
    const legacy = {
      schemaVersion: 1,
      dialogue: { ...DEFAULT_GLOBAL_CONFIG.dialogue, language: 'ja' },
      memory: { persistenceEnabled: false },
      project: {},
    };
    await env.DB.prepare(
      'INSERT INTO global_config (user_id, schema_version, document, updated_at) VALUES (?, 1, ?, ?)',
    )
      .bind(identity.userId, JSON.stringify(legacy), new Date().toISOString())
      .run();

    const config = await manager().loadConfig(identity);
    expect(config.schemaVersion).toBe(2);
    expect(config.dialogue.language).toBe('ja');
    expect(config.accessibility).toEqual(DEFAULT_GLOBAL_CONFIG.accessibility);
  });

  it('falls back to the defaults when the stored document is unreadable', async () => {
    const identity = await seedUser();
    await env.DB.prepare(
      'INSERT INTO global_config (user_id, schema_version, document, updated_at) VALUES (?, 2, ?, ?)',
    )
      .bind(identity.userId, 'not json at all', new Date().toISOString())
      .run();
    expect(await manager().loadConfig(identity)).toEqual(DEFAULT_GLOBAL_CONFIG);
  });
});

describe('remembering', () => {
  const note = {
    scope: 'topic' as const,
    path: 'projects/anascummis',
    title: 'Deploy target',
    body: 'The worker is deployed to anascummis.com.',
    origin: 'learned' as const,
    confirmed: false,
  };

  it('leaves nothing behind for a guest', async () => {
    const result = await manager().remember(guest(), note);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('not-authorised');
    expect(await countRows('memory_files')).toBe(0);
  });

  it('writes nothing while the account has memory switched off', async () => {
    const identity = await seedUser({ memoryEnabled: false });
    const result = await manager().remember(identity, note);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('not-authorised');
    expect(await countRows('memory_files')).toBe(0);
  });

  it('refuses a path that could climb out of its scope', async () => {
    const identity = await seedUser();
    for (const path of ['../etc/passwd', 'has spaces', '/absolute', 'Projects/Caps']) {
      const result = await manager().remember(identity, { ...note, path });
      expect(result.ok, `${path} was accepted`).toBe(false);
      if (!result.ok) expect(result.kind).toBe('invalid-argument');
    }
    expect(await countRows('memory_files')).toBe(0);
  });

  it('stores a new revision and supersedes the old one', async () => {
    const identity = await seedUser();
    const first = await manager().remember(identity, note);
    const second = await manager().remember(identity, { ...note, body: 'Now deployed behind Access.' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.revision).toBe(1);
    expect(second.value.revision).toBe(2);

    const rows = await env.DB.prepare(
      'SELECT id, revision, superseded_by FROM memory_files WHERE user_id = ? ORDER BY revision',
    )
      .bind(identity.userId)
      .all<{ id: string; revision: number; superseded_by: string | null }>();
    expect(rows.results?.[0]?.superseded_by).toBe(second.value.id);
    expect(rows.results?.[1]?.superseded_by).toBeNull();
  });

  it('will not let an inferred summary overwrite a fact the user confirmed', async () => {
    const identity = await seedUser();
    await manager().remember(identity, { ...note, confirmed: true, origin: 'authored' });

    const overwrite = await manager().remember(identity, { ...note, body: 'Guessed.', confirmed: false });
    expect(overwrite.ok).toBe(false);
    if (!overwrite.ok) {
      expect(overwrite.kind).toBe('not-authorised');
      expect(overwrite.message).toContain(note.path);
    }
    expect(await countRows('memory_files')).toBe(1);
  });

  it('lets a confirmed correction replace a confirmed fact', async () => {
    const identity = await seedUser();
    await manager().remember(identity, { ...note, confirmed: true });
    const corrected = await manager().remember(identity, {
      ...note,
      body: 'Corrected by the user.',
      confirmed: true,
    });
    expect(corrected.ok).toBe(true);
    if (corrected.ok) expect(corrected.value.revision).toBe(2);
  });

  it('keeps a branch hypothesis tagged so it does not read as settled', async () => {
    const identity = await seedUser();
    const result = await manager().remember(identity, { ...note, branchId: 'branch_7' });
    expect(result.ok && result.value.branchId).toBe('branch_7');
    const row = await env.DB.prepare('SELECT branch_id FROM memory_files WHERE user_id = ?')
      .bind(identity.userId)
      .first<{ branch_id: string }>();
    expect(row?.branch_id).toBe('branch_7');
  });

  it('caps how many index keys one memory can claim', async () => {
    const identity = await seedUser();
    const indexKeys = Array.from({ length: 30 }, (_, i) => `KEY-${i}`);
    await manager().remember(identity, { ...note, indexKeys });
    expect(await countRows('memory_index')).toBe(12);

    const stored = await env.DB.prepare('SELECT key FROM memory_index LIMIT 1').first<{ key: string }>();
    expect(stored?.key).toBe(stored?.key.toLowerCase());
  });
});

describe('recall', () => {
  const seedNotes = async () => {
    const identity = await seedUser();
    await manager().remember(identity, {
      scope: 'topic',
      path: 'infra/cloudflare',
      title: 'Worker bindings',
      body: 'D1 holds durable rows and KV holds session artifacts.',
      origin: 'learned',
      confirmed: false,
    });
    await manager().remember(identity, {
      scope: 'topic',
      path: 'people/chris',
      title: 'Chris',
      body: 'Prefers a written summary over a call.',
      origin: 'authored',
      confirmed: true,
    });
    return identity;
  };

  it('returns nothing for a guest', async () => {
    expect(await manager().recall(guest(), 'cloudflare')).toEqual([]);
  });

  it('ignores a query with no term long enough to be selective', async () => {
    const identity = await seedNotes();
    expect(await manager().recall(identity, 'a of')).toEqual([]);
  });

  it('loads only the topics the query actually touches', async () => {
    const identity = await seedNotes();
    const hits = await manager().recall(identity, 'cloudflare bindings');
    expect(hits.map((h) => h.path)).toEqual(['infra/cloudflare']);
  });

  it('ranks the file matching more terms first', async () => {
    const identity = await seedNotes();
    const hits = await manager().recall(identity, 'summary written cloudflare');
    expect(hits[0]?.path).toBe('people/chris');
  });

  it('does not surface a superseded revision', async () => {
    const identity = await seedUser();
    await manager().remember(identity, {
      scope: 'topic',
      path: 'infra/target',
      title: 'Target',
      body: 'staging environment',
      origin: 'learned',
      confirmed: false,
    });
    await manager().remember(identity, {
      scope: 'topic',
      path: 'infra/target',
      title: 'Target',
      body: 'production environment',
      origin: 'learned',
      confirmed: false,
    });
    expect(await manager().recall(identity, 'staging')).toEqual([]);
    expect((await manager().recall(identity, 'production'))[0]?.revision).toBe(2);
  });

  it('keeps one account out of another account’s memory', async () => {
    const mine = await seedNotes();
    const theirs = await seedUser();
    expect(await manager().recall(theirs, 'cloudflare')).toEqual([]);
    expect((await manager().recall(mine, 'cloudflare')).length).toBe(1);
  });
});

describe('export and deletion', () => {
  it('refuses both for a guest', async () => {
    const g = guest();
    expect((await manager().exportAll(g)).ok).toBe(false);
    expect((await manager().deleteAll(g)).ok).toBe(false);
  });

  it('returns every revision, including superseded ones', async () => {
    const identity = await seedUser();
    const base = {
      scope: 'topic' as const,
      path: 'notes/one',
      title: 'One',
      origin: 'learned' as const,
      confirmed: false,
    };
    await manager().remember(identity, { ...base, body: 'first' });
    await manager().remember(identity, { ...base, body: 'second' });

    const exported = await manager().exportAll(identity);
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expect(exported.value.memories.map((m) => m.revision)).toEqual([1, 2]);
      expect(exported.value.config).toEqual(DEFAULT_GLOBAL_CONFIG);
    }
  });

  it('clears the files and their index entries together', async () => {
    const identity = await seedUser();
    await manager().remember(identity, {
      scope: 'topic',
      path: 'notes/two',
      title: 'Two',
      body: 'body',
      origin: 'learned',
      confirmed: false,
      indexKeys: ['two'],
    });

    const removed = await manager().deleteAll(identity);
    expect(removed.ok).toBe(true);
    expect(await countRows('memory_files')).toBe(0);
    expect(await countRows('memory_index')).toBe(0);
  });

  it('reports a count that is not the number of memories removed', async () => {
    const identity = await seedUser();
    await manager().remember(identity, {
      scope: 'topic',
      path: 'notes/counted',
      title: 'Counted',
      body: 'body',
      origin: 'learned',
      confirmed: false,
      indexKeys: ['one', 'two'],
    });

    // One memory went in. D1 reports `meta.changes` for the whole statement,
    // and the two index rows deleted by the cascade are counted alongside it,
    // so the number `deleteAll` returns is 3. Anything shown to the user as
    // "N memories deleted" is therefore wrong. Pinned here as the behaviour
    // that exists, not the behaviour that is wanted.
    const removed = await manager().deleteAll(identity);
    expect(removed.ok && removed.value).toBe(3);
  });

  it('leaves another account untouched', async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    const note = {
      scope: 'topic' as const,
      path: 'notes/keep',
      title: 'Keep',
      body: 'body',
      origin: 'learned' as const,
      confirmed: false,
    };
    await manager().remember(mine, note);
    await manager().remember(theirs, note);

    await manager().deleteAll(mine);
    expect(await countRows('memory_files')).toBe(1);
  });
});

describe('the persistence switch', () => {
  it('is off for a guest and cannot be turned on', async () => {
    const g = guest();
    expect(await manager().persistenceEnabled(g)).toBe(false);
    expect((await manager().setPersistence(g, true)).ok).toBe(false);
  });

  it('gates writing once it is turned off', async () => {
    const identity = await seedUser();
    await manager().setPersistence(identity, false);
    const result = await manager().remember(identity, {
      scope: 'topic',
      path: 'notes/blocked',
      title: 'Blocked',
      body: 'body',
      origin: 'learned',
      confirmed: false,
    });
    expect(result.ok).toBe(false);
    expect(await countRows('memory_files')).toBe(0);
  });
});
