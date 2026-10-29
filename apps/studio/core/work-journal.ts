import type {Database} from 'bun:sqlite';
import {ActivityJournal, type ActivityInput, type ActivityPage} from './activity-journal';

export type WorkStatus = 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
export type WorkProgress = {phase: string; agent: string; taskId?: string};
type Specialist = {id: string; agent: string; task: string; status: string; message: string};
export type WorkRecord = {
  id: string;
  projectId: string;
  documentId?: string;
  request: string;
  status: WorkStatus;
  created: number;
  updated: number;
  progress: WorkProgress;
  events: (WorkProgress & {time: number; detail?: string})[];
  message?: string;
  error?: string;
  outcome?: string;
  specialists?: Specialist[];
};
export type WorkPage = {active: WorkRecord[]; history: WorkRecord[]; nextCursor?: string};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** A durable activity log; only the live host owns execution and cancellation. */
export class WorkJournal {
  private activityJournal: ActivityJournal;
  constructor(private db: Database, private now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS work_journal(
      id TEXT PRIMARY KEY, status TEXT NOT NULL, updated INTEGER NOT NULL, body TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS work_journal_status_updated ON work_journal(status,updated DESC,id DESC);
    CREATE INDEX IF NOT EXISTS work_journal_updated ON work_journal(updated DESC,id DESC)`);
    this.activityJournal = new ActivityJournal(db);
  }

  private save(record: WorkRecord) {
    this.db.transaction(() => {
      this.activityJournal.ensureStream('work', record.id, this.legacy(record));
      this.db.query('INSERT INTO work_journal VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated=excluded.updated,body=excluded.body')
        .run(record.id, record.status, record.updated, JSON.stringify(record));
    })();
    return record;
  }

  private legacy(record: WorkRecord): ActivityInput[] {
    return record.events.map(({agent, ...event}) => ({...event, role: agent}));
  }

  private event(record: WorkRecord, progress: WorkProgress, detail?: string) {
    const previous = this.legacy(record), event = {...progress, time: record.updated, ...(detail !== undefined ? {detail} : {})};
    const staged = {...record, events: [...record.events, event].slice(-160)};
    this.db.transaction(() => {
      this.activityJournal.append('work', record.id, {time: event.time, role: event.agent, phase: event.phase, taskId: event.taskId, detail}, previous);
      this.save(staged);
    })();
    return Object.assign(record, staged);
  }

  get(id: string): WorkRecord | undefined {
    const row = this.db.query('SELECT body FROM work_journal WHERE id=?').get(id) as {body: string} | null;
    return row ? JSON.parse(row.body) as WorkRecord : undefined;
  }

  create(input: {id: string; projectId: string; documentId?: string; request: string}) {
    if (!uuid.test(input.id) || !input.request.trim() || input.request.length > 8000) throw new Error('Invalid work record');
    if (this.get(input.id)) throw new Error('Work record already exists');
    const time = this.now(), progress = {phase: 'queued', agent: 'coordinator'};
    return this.event({...input, status: 'running', created: time, updated: time, progress, events: []}, progress);
  }

  progress(id: string, progress: WorkProgress) {
    const record = this.get(id);
    if (!record || record.status !== 'running') return record;
    // Persist host progress only, never tool arguments, private context or tool results.
    record.progress = {phase: progress.phase, agent: progress.agent, taskId: progress.taskId};
    record.updated = this.now();
    return this.event(record, record.progress);
  }

  complete(id: string, result: {message: string; orchestration: {stopReason: string; tasks: Specialist[]}}) {
    const record = this.get(id);
    if (!record || record.status !== 'running') return record;
    record.status = 'complete';
    record.outcome = result.orchestration.stopReason;
    record.message = result.message.slice(0, 4000);
    record.specialists = result.orchestration.tasks.map(task => ({
      id: task.id, agent: task.agent, task: task.task, status: task.status, message: task.message.slice(0, 1000)
    }));
    record.updated = this.now();
    return this.event(record, {phase: record.outcome === 'finished' ? 'complete' : 'needs_input', agent: 'coordinator'}, record.message);
  }

  fail(id: string, status: 'failed' | 'cancelled' | 'interrupted', error: string) {
    const record = this.get(id);
    if (!record || record.status !== 'running') return record;
    record.status = status;
    record.error = error.slice(0, 2000);
    record.updated = this.now();
    return this.event(record, {phase: status, agent: 'coordinator'}, record.error);
  }

  activity(id: string, limit = 25, before?: string): ActivityPage {
    const record = this.get(id);
    if (!record) throw new Error('Job not found');
    this.activityJournal.ensureStream('work', id, this.legacy(record));
    return this.activityJournal.list('work', id, limit, before);
  }

  interruptRunning() {
    // Replaying arbitrary edits after a crash could repeat an already completed mutation.
    const rows = this.db.query("SELECT id FROM work_journal WHERE status='running'").all() as {id: string}[];
    for (const row of rows) this.fail(row.id, 'interrupted', 'The backend restarted before this task finished. Review its progress and saved changes before continuing.');
  }

  list(limit = 25, cursor?: string): WorkPage {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose a work history limit from 1 to 100');
    const params: (number | string)[] = [];
    let before = '';
    if (cursor) {
      const [time, id, extra] = cursor.split(':');
      const updated = Number(time);
      if (!time || !Number.isSafeInteger(updated) || updated < 0 || !uuid.test(id || '') || extra !== undefined) throw new Error('Invalid work history cursor');
      before = ' AND (updated < ? OR (updated = ? AND id < ?))';
      params.push(updated, updated, id);
    }
    const active = this.db.query("SELECT body FROM work_journal WHERE status='running' ORDER BY updated DESC,id DESC").all() as {body: string}[];
    const rows = this.db.query("SELECT body FROM work_journal WHERE status!='running'" + before + ' ORDER BY updated DESC,id DESC LIMIT ?')
      .all(...params, limit + 1) as {body: string}[];
    const history = rows.slice(0, limit).map(row => JSON.parse(row.body) as WorkRecord);
    const last = history.at(-1);
    return {
      active: active.map(row => JSON.parse(row.body) as WorkRecord), history,
      nextCursor: rows.length > limit && last ? `${last.updated}:${last.id}` : undefined
    };
  }
}
