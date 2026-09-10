import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Identity } from '@shared/types';
import { CheckpointStore } from '@worker/memory/checkpoints';
import { anotherSession, applyMigrations, guest, seedUser } from '../helpers/db';

/**
 * The checkpoint table is the durable half of "go back": the coordinator holds
 * the live HEAD, and these rows hold the ancestry it can be restored from.
 * What is checked here is the DAG staying acyclic and single-headed, the
 * refusal to restore state that no longer loads, and pruning that does not
 * take a checkpoint something else still points at.
 */

beforeAll(applyMigrations);

const store = () => new CheckpointStore(env);

const STORY = { storyId: 'lowtown', storyVersion: '3' };

async function append(identity: Identity, parentId: string | null, overrides: Partial<{ storyVersion: string }> = {}) {
  const result = await store().append({
    identity,
    parentId,
    storyId: STORY.storyId,
    storyVersion: overrides.storyVersion ?? STORY.storyVersion,
    runtimeState: JSON.stringify({ knot: 'start' }),
    continuation: null,
    contextRevision: 'ctx_1',
    activeSkills: ['cloudflare'],
  });
  if (!result.ok) throw new Error(`append failed: ${result.message}`);
  return result.value;
}

const stateOf = async (id: string): Promise<string | undefined> => {
  const row = await env.DB.prepare('SELECT branch_state FROM checkpoints WHERE id = ?')
    .bind(id)
    .first<{ branch_state: string }>();
  return row?.branch_state;
};

describe('appending', () => {
  it('writes nothing durable for a guest but still returns a usable checkpoint', async () => {
    const identity = guest();
    const checkpoint = await append(identity, null);
    expect(checkpoint.sessionId).toBe(identity.sessionId);
    expect(checkpoint.branchState).toBe('current');

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM checkpoints').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('records the story id, version and runtime state a restore needs', async () => {
    const identity = await seedUser();
    const checkpoint = await append(identity, null);

    const row = await env.DB.prepare(
      'SELECT story_id, story_version, runtime_state, context_revision, active_skills FROM checkpoints WHERE id = ?',
    )
      .bind(checkpoint.id)
      .first<Record<string, string>>();
    expect(row?.story_id).toBe('lowtown');
    expect(row?.story_version).toBe('3');
    expect(JSON.parse(row?.runtime_state ?? '{}')).toEqual({ knot: 'start' });
    expect(row?.context_revision).toBe('ctx_1');
    expect(JSON.parse(row?.active_skills ?? '[]')).toEqual(['cloudflare']);
  });

  it('moves the previous head aside instead of erasing it', async () => {
    const identity = await seedUser();
    const first = await append(identity, null);
    const second = await append(identity, first.id);

    expect(await stateOf(first.id)).toBe('inactive');
    expect(await stateOf(second.id)).toBe('current');
  });

  it('leaves exactly one head per session', async () => {
    const identity = await seedUser();
    let parent: string | null = null;
    for (let i = 0; i < 4; i++) parent = (await append(identity, parent)).id;

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM checkpoints WHERE session_id = ? AND branch_state = 'current'",
    )
      .bind(identity.sessionId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('does not disturb the head of another session on the same account', async () => {
    const identity = await seedUser();
    const other = anotherSession(identity);
    const mine = await append(identity, null);
    await append(other, null);

    expect(await stateOf(mine.id)).toBe('current');
  });

  it('starts a fresh chain with a full snapshot', async () => {
    const identity = await seedUser();
    expect((await append(identity, null)).snapshotKind).toBe('full');
  });

  it('takes a full snapshot again once the deltas reach the interval', async () => {
    const identity = await seedUser();
    const kinds: string[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 10; i++) {
      const checkpoint = await append(identity, parent);
      kinds.push(checkpoint.snapshotKind);
      parent = checkpoint.id;
    }
    // A full root, eight deltas, then a full snapshot bounding the replay.
    expect(kinds).toEqual([
      'full',
      'delta',
      'delta',
      'delta',
      'delta',
      'delta',
      'delta',
      'delta',
      'delta',
      'full',
    ]);
  });

  it('points a delta at the parent it is measured from', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    const child = await append(identity, root.id);
    expect(root.snapshotBaseId).toBeNull();
    expect(child.snapshotBaseId).toBe(root.id);
  });
});

describe('loading', () => {
  it('tells a caller the checkpoint is gone rather than returning an empty one', async () => {
    const result = await store().load('ckpt_missing');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('missing-capability');
  });

  it('reads back every field it wrote', async () => {
    const identity = await seedUser();
    const written = await append(identity, null);
    const read = await store().load(written.id);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toEqual({ ...written, branchState: 'current' });
  });
});

describe('branching', () => {
  it('refuses a checkpoint belonging to a different session', async () => {
    const identity = await seedUser();
    const checkpoint = await append(identity, null);

    const result = await store().branchFrom(anotherSession(identity), checkpoint.id, STORY.storyVersion);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('not-authorised');
  });

  it('refuses state the current story version can no longer load, naming both versions', async () => {
    const identity = await seedUser();
    const checkpoint = await append(identity, null, { storyVersion: '2' });

    const result = await store().branchFrom(identity, checkpoint.id, '3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('contract-mismatch');
      expect(result.message).toContain('2');
      expect(result.message).toContain('3');
      expect(result.detail).toEqual({ from: '2', to: '3' });
    }
  });

  it('leaves the abandoned future in place as an inactive branch', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    const abandoned = await append(identity, root.id);

    const result = await store().branchFrom(identity, root.id, STORY.storyVersion);
    expect(result.ok).toBe(true);

    expect(await stateOf(abandoned.id)).toBe('inactive');
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM checkpoints WHERE id = ?')
      .bind(abandoned.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('clears the head so the next append becomes the only current one', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    await append(identity, root.id);
    await store().branchFrom(identity, root.id, STORY.storyVersion);
    const rebranched = await append(identity, root.id);

    const rows = await env.DB.prepare(
      "SELECT id FROM checkpoints WHERE session_id = ? AND branch_state = 'current'",
    )
      .bind(identity.sessionId)
      .all<{ id: string }>();
    expect(rows.results?.map((r) => r.id)).toEqual([rebranched.id]);
  });
});

describe('the branch list', () => {
  it('is empty for a guest, who has no durable history', async () => {
    expect(await store().listBranches(guest())).toEqual([]);
  });

  it('returns the session’s checkpoints newest first', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const head = await append(identity, root.id);

    const branches = await store().listBranches(identity);
    expect(branches.map((b) => b.id)).toEqual([head.id, root.id]);
  });

  it('does not leak a checkpoint from another session', async () => {
    const identity = await seedUser();
    await append(anotherSession(identity), null);
    expect(await store().listBranches(identity)).toEqual([]);
  });
});

describe('branch state changes', () => {
  it('pins a checkpoint so pruning will pass over it', async () => {
    const identity = await seedUser();
    const checkpoint = await append(identity, null);
    expect((await store().setBranchState(identity, checkpoint.id, 'pinned')).ok).toBe(true);
    expect(await stateOf(checkpoint.id)).toBe('pinned');
  });

  it('reports a checkpoint that is not on this account rather than silently doing nothing', async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    const checkpoint = await append(theirs, null);

    const result = await store().setBranchState(mine, checkpoint.id, 'archived');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('missing-capability');
    expect(await stateOf(checkpoint.id)).toBe('current');
  });

  it('refuses a guest outright', async () => {
    expect((await store().setBranchState(guest(), 'ckpt_x', 'archived')).ok).toBe(false);
  });
});

describe('pruning', () => {
  const backdate = async (id: string, days: number) => {
    await env.DB.prepare('UPDATE checkpoints SET created_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - days * 86_400_000).toISOString(), id)
      .run();
  };

  it('refuses a guest', async () => {
    expect((await store().prune(guest(), 30)).ok).toBe(false);
  });

  it('says plainly when nothing was eligible', async () => {
    const identity = await seedUser();
    await append(identity, null);

    const result = await store().prune(identity, 30);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.removed).toBe(0);
      expect(result.value.note).toContain('Nothing was eligible');
    }
  });

  it('keeps a checkpoint that another checkpoint still descends from', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    const child = await append(identity, root.id);
    await backdate(root.id, 90);
    await backdate(child.id, 90);

    const result = await store().prune(identity, 30);
    expect(result.ok && result.value.removed).toBe(0);
    expect(await stateOf(root.id)).toBe('inactive');
  });

  it('keeps a checkpoint a stored turn still refers to', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    const abandoned = await append(identity, root.id);
    await store().branchFrom(identity, root.id, STORY.storyVersion);
    await append(identity, root.id);

    await env.DB.prepare(
      `INSERT INTO turns (id, checkpoint_id, session_id, role, text, created_at)
       VALUES ('t_1', ?, ?, 'user', 'something worth keeping', ?)`,
    )
      .bind(abandoned.id, identity.sessionId, new Date().toISOString())
      .run();
    await backdate(abandoned.id, 90);

    const result = await store().prune(identity, 30);
    expect(result.ok && result.value.removed).toBe(0);
  });

  it('removes an abandoned leaf and says the detail is gone for good', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    const abandoned = await append(identity, root.id);
    await store().branchFrom(identity, root.id, STORY.storyVersion);
    await append(identity, root.id);
    await backdate(abandoned.id, 90);

    const result = await store().prune(identity, 30);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.removed).toBe(1);
      expect(result.value.note).toContain('cannot be recovered');
    }
    expect(await stateOf(abandoned.id)).toBeUndefined();
    expect(await stateOf(root.id)).toBe('inactive');
  });

  it('leaves a recent abandoned branch alone', async () => {
    const identity = await seedUser();
    const root = await append(identity, null);
    const abandoned = await append(identity, root.id);
    await store().branchFrom(identity, root.id, STORY.storyVersion);
    await append(identity, root.id);
    await backdate(abandoned.id, 3);

    expect((await store().prune(identity, 30)).ok).toBe(true);
    expect(await stateOf(abandoned.id)).toBe('inactive');
  });

  it('does not reach into another account', async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    const root = await append(theirs, null);
    const abandoned = await append(theirs, root.id);
    await store().branchFrom(theirs, root.id, STORY.storyVersion);
    await append(theirs, root.id);
    await backdate(abandoned.id, 90);

    const result = await store().prune(mine, 30);
    expect(result.ok && result.value.removed).toBe(0);
    expect(await stateOf(abandoned.id)).toBe('inactive');
  });
});
