import type { Identity } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { randomId } from '../crypto';

/**
 * Immutable checkpoint DAG.
 *
 * A checkpoint records enough to restore an actual execution position: the
 * exact story id and version, the runtime state, the pending continuation, the
 * context revision, and the active skill versions. A knot name and a few
 * variables would not be enough to resume, so the whole runtime snapshot is
 * stored, with periodic full snapshots bounding the cost of replaying deltas.
 *
 * "Go back" restores a compatible historical checkpoint and creates a new
 * branch. The abandoned future is not erased; it becomes an inactive branch.
 * Ordinary Ink diverts stay cyclic while checkpoint ancestry stays acyclic.
 */

export type BranchState = 'current' | 'inactive' | 'archived' | 'pinned';

export interface Checkpoint {
  id: string;
  sessionId: string;
  parentId: string | null;
  storyId: string;
  storyVersion: string;
  runtimeState: string;
  snapshotKind: 'full' | 'delta';
  snapshotBaseId: string | null;
  continuation: string | null;
  contextRevision: string;
  activeSkills: string[];
  label: string | null;
  summary: string | null;
  branchState: BranchState;
  createdAt: string;
}

/** A full snapshot every N checkpoints, so restoration never walks far. */
const FULL_SNAPSHOT_INTERVAL = 8;

export class CheckpointStore {
  constructor(private readonly env: Env) {}

  async append(input: {
    identity: Identity;
    parentId: string | null;
    storyId: string;
    storyVersion: string;
    runtimeState: string;
    continuation: string | null;
    contextRevision: string;
    activeSkills: string[];
    label?: string | null;
    summary?: string | null;
  }): Promise<Result<Checkpoint>> {
    const depth = input.parentId ? await this.depthSinceFullSnapshot(input.parentId) : FULL_SNAPSHOT_INTERVAL;
    const snapshotKind: 'full' | 'delta' = depth >= FULL_SNAPSHOT_INTERVAL ? 'full' : 'delta';

    const checkpoint: Checkpoint = {
      id: randomId('ckpt'),
      sessionId: input.identity.sessionId,
      parentId: input.parentId,
      storyId: input.storyId,
      storyVersion: input.storyVersion,
      runtimeState: input.runtimeState,
      snapshotKind,
      // Ink state is already compact and self-contained, so a delta here still
      // stores the full state and the marker exists to bound future formats.
      snapshotBaseId: snapshotKind === 'delta' ? input.parentId : null,
      continuation: input.continuation,
      contextRevision: input.contextRevision,
      activeSkills: input.activeSkills,
      label: input.label ?? null,
      summary: input.summary ?? null,
      branchState: 'current',
      createdAt: new Date().toISOString(),
    };

    // Only an authenticated user gets durable history. A guest's HEAD lives in
    // the session coordinator and expires with the session.
    if (input.identity.kind === 'user') {
      await this.env.DB.batch([
        // The previous HEAD stops being current without being erased.
        this.env.DB.prepare(
          `UPDATE checkpoints SET branch_state = 'inactive'
           WHERE session_id = ? AND branch_state = 'current'`,
        ).bind(input.identity.sessionId),
        this.env.DB.prepare(
          `INSERT INTO checkpoints
             (id, session_id, user_id, parent_id, story_id, story_version, runtime_state,
              snapshot_kind, snapshot_base_id, continuation, context_revision, active_skills,
              label, summary, branch_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?)`,
        ).bind(
          checkpoint.id,
          checkpoint.sessionId,
          input.identity.userId,
          checkpoint.parentId,
          checkpoint.storyId,
          checkpoint.storyVersion,
          checkpoint.runtimeState,
          checkpoint.snapshotKind,
          checkpoint.snapshotBaseId,
          checkpoint.continuation,
          checkpoint.contextRevision,
          JSON.stringify(checkpoint.activeSkills),
          checkpoint.label,
          checkpoint.summary,
          checkpoint.createdAt,
        ),
      ]);
    }

    return ok(checkpoint);
  }

  async load(id: string): Promise<Result<Checkpoint>> {
    const row = await this.env.DB.prepare('SELECT * FROM checkpoints WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) return fail('missing-capability', `Checkpoint ${id} no longer exists.`);
    return ok(rowToCheckpoint(row));
  }

  /**
   * Branches from a historical checkpoint.
   *
   * Restoring is only valid against compatible compiled content. When the
   * story version has moved on, the caller is told to migrate or return to a
   * safe checkpoint rather than being handed state that will not load.
   */
  async branchFrom(
    identity: Identity,
    checkpointId: string,
    currentStoryVersion: string,
  ): Promise<Result<Checkpoint>> {
    const found = await this.load(checkpointId);
    if (!found.ok) return found;
    const checkpoint = found.value;

    if (checkpoint.sessionId !== identity.sessionId) {
      return fail('not-authorised', 'That checkpoint belongs to a different session.');
    }
    if (checkpoint.storyVersion !== currentStoryVersion) {
      return fail(
        'contract-mismatch',
        `That point ran story version ${checkpoint.storyVersion}, and the current version is ${currentStoryVersion}. Restoring needs an explicit migration.`,
        { from: checkpoint.storyVersion, to: currentStoryVersion },
      );
    }

    if (identity.kind === 'user') {
      await this.env.DB.prepare(
        `UPDATE checkpoints SET branch_state = 'inactive'
         WHERE session_id = ? AND branch_state = 'current'`,
      )
        .bind(identity.sessionId)
        .run();
    }
    return ok(checkpoint);
  }

  /** The conversation map. Distinguishes current, inactive, archived and pinned. */
  async listBranches(identity: Identity, limit = 60): Promise<Checkpoint[]> {
    if (identity.kind !== 'user') return [];
    const rows = await this.env.DB.prepare(
      `SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(identity.sessionId, limit)
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(rowToCheckpoint);
  }

  async setBranchState(identity: Identity, checkpointId: string, state: BranchState): Promise<Result<true>> {
    if (identity.kind !== 'user') return fail('not-authorised', 'Guests have no durable branches.');
    const res = await this.env.DB.prepare(
      'UPDATE checkpoints SET branch_state = ? WHERE id = ? AND user_id = ?',
    )
      .bind(state, checkpointId, identity.userId)
      .run();
    if (!res.meta.changes) return fail('missing-capability', 'No such checkpoint on this account.');
    return ok(true);
  }

  /**
   * Prunes inactive branches while preserving what retained material still
   * references. Lost detail is marked as lost rather than promised recoverable.
   */
  async prune(identity: Identity, olderThanDays: number): Promise<Result<{ removed: number; note: string }>> {
    if (identity.kind !== 'user') return fail('not-authorised', 'Guests have nothing durable to prune.');
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();

    const res = await this.env.DB.prepare(
      `DELETE FROM checkpoints
       WHERE user_id = ? AND branch_state = 'inactive' AND created_at < ?
         AND id NOT IN (SELECT parent_id FROM checkpoints WHERE parent_id IS NOT NULL)
         AND id NOT IN (SELECT checkpoint_id FROM turns)`,
    )
      .bind(identity.userId, cutoff)
      .run();

    const removed = res.meta.changes ?? 0;
    return ok({
      removed,
      note:
        removed > 0
          ? `${removed} inactive checkpoints were removed. Their exact conversation detail is gone and cannot be recovered.`
          : 'Nothing was eligible for pruning.',
    });
  }

  private async depthSinceFullSnapshot(startId: string): Promise<number> {
    let depth = 0;
    let cursor: string | null = startId;
    while (cursor && depth < FULL_SNAPSHOT_INTERVAL) {
      const row: { snapshot_kind: string; parent_id: string | null } | null = await this.env.DB.prepare(
        'SELECT snapshot_kind, parent_id FROM checkpoints WHERE id = ?',
      )
        .bind(cursor)
        .first<{ snapshot_kind: string; parent_id: string | null }>();
      if (!row) break;
      if (row.snapshot_kind === 'full') return depth;
      depth += 1;
      cursor = row.parent_id;
    }
    return depth;
  }
}

function rowToCheckpoint(row: Record<string, unknown>): Checkpoint {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    storyId: String(row.story_id),
    storyVersion: String(row.story_version),
    runtimeState: String(row.runtime_state),
    snapshotKind: row.snapshot_kind === 'full' ? 'full' : 'delta',
    snapshotBaseId:
      row.snapshot_base_id === null || row.snapshot_base_id === undefined
        ? null
        : String(row.snapshot_base_id),
    continuation:
      row.continuation === null || row.continuation === undefined ? null : String(row.continuation),
    contextRevision: String(row.context_revision ?? ''),
    activeSkills: parseArray(row.active_skills),
    label: row.label === null || row.label === undefined ? null : String(row.label),
    summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
    branchState: (row.branch_state as BranchState) ?? 'inactive',
    createdAt: String(row.created_at),
  };
}

function parseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
