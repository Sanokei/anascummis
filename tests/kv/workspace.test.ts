import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity, Result } from '@shared/types';
import { ok } from '@shared/types';
import type { NativeContext } from '@worker/registry/registry';
import { buildRegistry } from '@worker/registry/natives';
import { defaultEnvelope } from '@worker/policy/permissions';
import { anotherSession, applyMigrations, guest, seedUser } from '../helpers/db';

/**
 * KV holds the session workspace. It is the store a generated capability can
 * reach, so the boundaries that matter are the key layout keeping one session
 * out of another, the name check keeping an artifact from escaping its prefix,
 * and the expiry that stops a guest's workspace becoming durable storage.
 */

beforeAll(applyMigrations);

const registry = () => buildRegistry(env);

function context(identity: Identity, args: Record<string, unknown>): NativeContext {
  return {
    args,
    env,
    identity,
    permissions: defaultEnvelope(identity),
    signal: new AbortController().signal,
    chargeExternal: () => ok(0),
  };
}

function run(id: string, identity: Identity, args: Record<string, unknown>): Promise<Result<unknown>> {
  const handler = registry().native(id);
  if (!handler) throw new Error(`${id} is not a registered native`);
  return handler.execute(context(identity, args));
}

const write = (identity: Identity, name: string, content: string, contentType?: string) =>
  run('workspace.write', identity, { name, content, ...(contentType ? { contentType } : {}) });

const read = (identity: Identity, name: string) => run('workspace.read', identity, { name });

const list = (identity: Identity) => run('workspace.list', identity, {});

describe('the workspace round trip', () => {
  it('reads back what it wrote', async () => {
    const identity = guest();
    const written = await write(identity, 'notes.md', '# Plan\nShip it.', 'text/markdown');
    expect(written.ok).toBe(true);

    const found = await read(identity, 'notes.md');
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value).toMatchObject({
        name: 'notes.md',
        content: '# Plan\nShip it.',
        contentType: 'text/markdown',
      });
    }
  });

  it('counts bytes rather than characters', async () => {
    const identity = guest();
    const written = await write(identity, 'unicode.txt', 'café');
    expect(written.ok && (written.value as { bytes: number }).bytes).toBe(5);
  });

  it('defaults an artifact with no stated type to plain text', async () => {
    const identity = guest();
    await write(identity, 'plain.txt', 'body');
    const found = await read(identity, 'plain.txt');
    expect(found.ok && (found.value as { contentType: string }).contentType).toBe('text/plain');
  });

  it('overwrites in place rather than accumulating keys', async () => {
    const identity = guest();
    await write(identity, 'draft.txt', 'first');
    await write(identity, 'draft.txt', 'second');

    const found = await read(identity, 'draft.txt');
    expect(found.ok && (found.value as { content: string }).content).toBe('second');

    const keys = await env.CACHE.list({ prefix: `ws:${identity.sessionId}:` });
    expect(keys.keys.length).toBe(1);
  });

  it('says the artifact does not exist instead of returning an empty one', async () => {
    const result = await read(guest(), 'never-written.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('missing-capability');
      expect(result.message).toContain('never-written.txt');
    }
  });
});

describe('artifact names', () => {
  it('refuses anything that could climb out of the session prefix', async () => {
    const identity = guest();
    for (const name of ['../other', 'a/b', 'has space', '', '.hidden', 'x'.repeat(200)]) {
      const result = await write(identity, name, 'body');
      expect(result.ok, `${JSON.stringify(name)} was accepted`).toBe(false);
      if (!result.ok) expect(result.kind).toBe('invalid-argument');
    }
    expect((await env.CACHE.list()).keys.length).toBe(0);
  });

  it('refuses the same names on the way back out', async () => {
    const result = await read(guest(), '../other');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('invalid-argument');
  });

  it('accepts the ordinary shapes a file name takes', async () => {
    const identity = guest();
    for (const name of ['notes.md', 'report-2026.txt', 'a_b.json', 'Plan1']) {
      expect((await write(identity, name, 'body')).ok, name).toBe(true);
    }
  });
});

describe('session boundaries', () => {
  it('keeps one session out of another session’s workspace', async () => {
    const mine = guest();
    const theirs = guest();
    await write(mine, 'secret.txt', 'mine only');

    expect((await read(theirs, 'secret.txt')).ok).toBe(false);
    expect(await list(theirs)).toEqual(ok({ names: [] }));
  });

  it('scopes a workspace to the session even for a signed-in account', async () => {
    const identity = await seedUser();
    const second = anotherSession(identity);
    await write(identity, 'first.txt', 'body');

    expect((await read(second, 'first.txt')).ok).toBe(false);
  });

  it('lists only the names in this session, with the prefix stripped', async () => {
    const identity = guest();
    const other = guest();
    await write(identity, 'a.txt', 'one');
    await write(identity, 'b.txt', 'two');
    await write(other, 'c.txt', 'three');

    const listed = await list(identity);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect((listed.value as { names: string[] }).names.sort()).toEqual(['a.txt', 'b.txt']);
    }
  });
});

describe('expiry', () => {
  it('binds every artifact to the guest retention window', async () => {
    const identity = guest();
    const before = Math.floor(Date.now() / 1000);
    await write(identity, 'temp.txt', 'body');

    const listed = await env.CACHE.list({ prefix: `ws:${identity.sessionId}:` });
    const expiration = listed.keys[0]?.expiration;
    expect(expiration, 'the artifact was written with no expiry at all').toBeTypeOf('number');

    const retention = Number(env.GUEST_RETENTION_SECONDS);
    expect(expiration).toBeGreaterThanOrEqual(before + retention - 5);
    expect(expiration).toBeLessThanOrEqual(before + retention + 5);
  });
});

describe('the KV binding itself', () => {
  it('returns null for a key that was never written', async () => {
    expect(await env.CACHE.get('absent')).toBeNull();
  });

  it('parses a value back into an object when asked for json', async () => {
    await env.CACHE.put('shape', JSON.stringify({ a: 1, nested: { b: [2, 3] } }));
    expect(await env.CACHE.get('shape', 'json')).toEqual({ a: 1, nested: { b: [2, 3] } });
  });

  it('round-trips bytes without going through a string', async () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    await env.CACHE.put('bytes', bytes);
    const back = await env.CACHE.get('bytes', 'arrayBuffer');
    expect(new Uint8Array(back ?? new ArrayBuffer(0))).toEqual(bytes);
  });

  it('keeps metadata alongside the value', async () => {
    await env.CACHE.put('with-meta', 'body', { metadata: { origin: 'test' } });
    const result = await env.CACHE.getWithMetadata<{ origin: string }>('with-meta');
    expect(result.value).toBe('body');
    expect(result.metadata).toEqual({ origin: 'test' });
  });

  it('separates one prefix from another when listing', async () => {
    await env.CACHE.put('ws:one:a', 'a');
    await env.CACHE.put('ws:one:b', 'b');
    await env.CACHE.put('ws:two:c', 'c');

    const listed = await env.CACHE.list({ prefix: 'ws:one:' });
    expect(listed.keys.map((k) => k.name)).toEqual(['ws:one:a', 'ws:one:b']);
  });

  it('pages through a listing rather than truncating it silently', async () => {
    for (let i = 0; i < 5; i++) await env.CACHE.put(`page:${i}`, String(i));

    const first = await env.CACHE.list({ prefix: 'page:', limit: 2 });
    expect(first.keys.length).toBe(2);
    expect(first.list_complete).toBe(false);
    if (first.list_complete) return;

    const rest = await env.CACHE.list({ prefix: 'page:', cursor: first.cursor });
    expect(first.keys.concat(rest.keys).length).toBe(5);
    expect(rest.list_complete).toBe(true);
  });

  it('removes a key on delete', async () => {
    await env.CACHE.put('doomed', 'body');
    await env.CACHE.delete('doomed');
    expect(await env.CACHE.get('doomed')).toBeNull();
  });

  it('starts each test from an empty namespace', async () => {
    expect((await env.CACHE.list()).keys).toEqual([]);
  });
});
