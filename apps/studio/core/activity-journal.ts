import type {Database} from 'bun:sqlite';

export type ActivityKind = 'goal' | 'software' | 'work';
export type ActivityInput = {
  time: number;
  role: string;
  phase: string;
  detail?: string;
  taskId?: string;
  revision?: number;
};
export type ActivityEntry = ActivityInput & {sequence: number};
export type ActivityPage = {
  events: ActivityEntry[];
  nextCursor?: string;
  importedHistory: boolean;
  earlierHistoryMayBeMissing: boolean;
};
type StreamFlags = Pick<ActivityPage, 'importedHistory' | 'earlierHistoryMayBeMissing'>;
type StreamRow = {imported_history: number | bigint; earlier_history_may_be_missing: number | bigint};
const kinds = new Set<ActivityKind>(['goal', 'software', 'work']);

function identity(kind: ActivityKind, id: string) {
  if (!kinds.has(kind) || typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('Invalid activity stream identity');
}

function input(event: ActivityInput): ActivityInput {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || !Number.isSafeInteger(event.time) || event.time < 0
    || typeof event.role !== 'string' || !event.role.trim()
    || typeof event.phase !== 'string' || !event.phase.trim()
    || event.detail !== undefined && typeof event.detail !== 'string'
    || event.taskId !== undefined && (typeof event.taskId !== 'string' || !event.taskId.trim() || event.taskId.length > 200)
    || event.revision !== undefined && (!Number.isSafeInteger(event.revision) || event.revision < 0)) {
    throw new Error('Invalid activity event');
  }
  // Only approved activity fields enter this journal. Tool arguments, model
  // context and other extra properties on a source record are never copied.
  return {
    time: event.time, role: event.role, phase: event.phase,
    ...(event.detail === undefined ? {} : {detail: event.detail}),
    ...(event.taskId === undefined ? {} : {taskId: event.taskId}),
    ...(event.revision === undefined ? {} : {revision: event.revision})
  };
}

function sequence(value: number | bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Activity sequence exceeds the supported cursor range');
  return number;
}

/** Append-only event storage. Source records may retain a small projection;
 * their authoritative journal append must share the source-write transaction. */
export class ActivityJournal {
  constructor(private database: Database) {
    database.exec(`CREATE TABLE IF NOT EXISTS activity_streams(
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      imported_history INTEGER NOT NULL,
      earlier_history_may_be_missing INTEGER NOT NULL,
      PRIMARY KEY(kind,id)
    );
    CREATE TABLE IF NOT EXISTS activity_entries(
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      FOREIGN KEY(kind,stream_id) REFERENCES activity_streams(kind,id)
    );
    CREATE INDEX IF NOT EXISTS activity_entries_stream_sequence ON activity_entries(kind,stream_id,sequence DESC)`);
  }

  private flags(kind: ActivityKind, id: string): StreamFlags | undefined {
    const row = this.database.query('SELECT imported_history,earlier_history_may_be_missing FROM activity_streams WHERE kind=? AND id=?')
      .get(kind, id) as StreamRow | null;
    return row ? {
      importedHistory: Number(row.imported_history) === 1,
      earlierHistoryMayBeMissing: Number(row.earlier_history_may_be_missing) === 1
    } : undefined;
  }

  private insert(kind: ActivityKind, id: string, event: ActivityInput): ActivityEntry {
    const result = this.database.query('INSERT INTO activity_entries(kind,stream_id,event_json) VALUES(?,?,?)')
      .run(kind, id, JSON.stringify(event));
    return {...event, sequence: sequence(result.lastInsertRowid)};
  }

  /** Import a source's retained projection once, in its existing order. Nested
   * transactions are synchronous SQLite savepoints and roll back with a caller. */
  ensureStream(kind: ActivityKind, id: string, legacyEvents: ActivityInput[] = []): StreamFlags {
    identity(kind, id);
    return this.database.transaction(() => {
      const existing = this.flags(kind, id);
      if (existing) return existing;
      if (!Array.isArray(legacyEvents)) throw new Error('Invalid retained activity history');
      const events = legacyEvents.map(input);
      const flags = {importedHistory: events.length > 0, earlierHistoryMayBeMissing: events.length >= 160};
      this.database.query('INSERT INTO activity_streams(kind,id,imported_history,earlier_history_may_be_missing) VALUES(?,?,?,?)')
        .run(kind, id, Number(flags.importedHistory), Number(flags.earlierHistoryMayBeMissing));
      for (const event of events) this.insert(kind, id, event);
      return flags;
    })();
  }

  /** legacyEvents must contain only events preceding this append. Equal times
   * and identical payloads represent separate events and are never deduplicated. */
  append(kind: ActivityKind, id: string, event: ActivityInput, legacyEvents: ActivityInput[] = []): ActivityEntry {
    if (!this.database.inTransaction) throw new Error('Activity append must share its source-record transaction');
    identity(kind, id);
    const normalized = input(event);
    this.ensureStream(kind, id, legacyEvents);
    return this.insert(kind, id, normalized);
  }

  /** Does not initialize an absent stream: history reads must first supply the
   * source's retained events to ensureStream so migration cannot be skipped. */
  list(kind: ActivityKind, id: string, limit = 25, before?: string): ActivityPage {
    identity(kind, id);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose an activity history limit from 1 to 100');
    let cursor: number | undefined;
    if (before !== undefined) {
      if (typeof before !== 'string' || before.length > 16 || !/^[1-9][0-9]*$/.test(before)) throw new Error('Invalid activity history cursor');
      cursor = Number(before);
      if (!Number.isSafeInteger(cursor) || cursor < 1) throw new Error('Invalid activity history cursor');
    }
    const rows = (cursor === undefined
      ? this.database.query('SELECT sequence,event_json FROM activity_entries WHERE kind=? AND stream_id=? ORDER BY sequence DESC LIMIT ?').all(kind, id, limit + 1)
      : this.database.query('SELECT sequence,event_json FROM activity_entries WHERE kind=? AND stream_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?').all(kind, id, cursor, limit + 1)
    ) as {sequence: number | bigint; event_json: string}[];
    const events = rows.slice(0, limit).map(row => ({...input(JSON.parse(row.event_json)), sequence: sequence(row.sequence)}));
    const last = events.at(-1);
    return {
      events, nextCursor: rows.length > limit && last ? String(last.sequence) : undefined,
      ...(this.flags(kind, id) || {importedHistory: false, earlierHistoryMayBeMissing: false})
    };
  }
}
