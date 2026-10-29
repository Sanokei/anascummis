import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorkJournal, type WorkRecord} from '../core/work-journal';

function input(request = 'Change the website title to Oak Studio') {
  return {id: crypto.randomUUID(), projectId: crypto.randomUUID(), request};
}
const completed = {message: 'The change was checked.', orchestration: {stopReason: 'finished', tasks: []}};

test('work goals, specialist progress and completion survive closing and reopening the database', () => {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'work-journal-'));
  let db = new Database(join(root, 'work.sqlite'));
  try {
    let clock = 1000;
    let journal = new WorkJournal(db, () => clock++);
    const goal = {...input('Full goal: ' + 'acceptance requirement; '.repeat(250)), documentId: crypto.randomUUID()};
    journal.create(goal);
    journal.progress(goal.id, {phase: 'verifying', agent: 'pdf', taskId: 'task-1'});
    const result = {message: 'Saved and checked.', trace: [{result: 'PRIVATE-TOOL-PAYLOAD'}], orchestration: {
      stopReason: 'finished', tasks: [{id: 'task-1', agent: 'pdf', task: 'Update the selected PDF', status: 'completed', message: 'Verified.', trace: ['PRIVATE-TOOL-PAYLOAD']}]
    }};
    journal.complete(goal.id, result);
    db.close();
    db = new Database(join(root, 'work.sqlite'));
    journal = new WorkJournal(db);
    journal.interruptRunning();
    const saved = journal.get(goal.id)!;
    expect(saved.request).toBe(goal.request);
    expect(saved.documentId).toBe(goal.documentId);
    expect(saved.status).toBe('complete');
    expect(saved.outcome).toBe('finished');
    expect(saved.events.at(-2)?.phase).toBe('verifying');
    expect(saved.events.at(-1)?.phase).toBe('complete');
    expect(saved.specialists?.[0].status).toBe('completed');
    expect(JSON.stringify(saved)).not.toContain('PRIVATE-TOOL-PAYLOAD');
    expect(journal.list().history[0].id).toBe(goal.id);
  } finally {db.close(); rmSync(root, {recursive: true, force: true});}
});

test('restart recovery marks unfinished work interrupted without replaying edits or changing completed work', () => {
  const db = new Database(':memory:');
  try {
    const first = new WorkJournal(db), pending = input(), done = input();
    first.create(pending);
    first.progress(pending.id, {phase: 'verifying', agent: 'website'});
    first.create(done);
    first.complete(done.id, completed);
    const restarted = new WorkJournal(db);
    restarted.interruptRunning();
    expect(restarted.get(pending.id)?.status).toBe('interrupted');
    expect(restarted.get(pending.id)?.progress.phase).toBe('verifying');
    expect(restarted.get(pending.id)?.error).toContain('Review its progress and saved changes');
    expect(restarted.get(done.id)?.status).toBe('complete');
    expect(restarted.list().active).toHaveLength(0);
  } finally {db.close();}
});

test('cancellation cannot be overwritten by late progress, success or errors', () => {
  const db = new Database(':memory:');
  try {
    let time = 1000;
    const journal = new WorkJournal(db, () => time++), goal = input();
    journal.create(goal);
    journal.progress(goal.id, {phase: 'working', agent: 'website'});
    journal.fail(goal.id, 'cancelled', 'Stopped by you.');
    const stopped = journal.get(goal.id);
    journal.progress(goal.id, {phase: 'finished', agent: 'coordinator'});
    journal.complete(goal.id, completed);
    journal.fail(goal.id, 'failed', 'A late abort error');
    expect(journal.get(goal.id)).toEqual(stopped);
    expect(journal.list().active).toHaveLength(0);
  } finally {db.close();}
});

test('history pagination retains all tasks with tied timestamps and always includes active work', () => {
  const db = new Database(':memory:');
  try {
    const journal = new WorkJournal(db, () => 1000), ids: string[] = [];
    const working = journal.create(input('A long running goal'));
    for (let i = 0; i < 37; i++) {
      const record = journal.create(input('Archived goal ' + i));
      journal.complete(record.id, {...completed, orchestration: {stopReason: i === 0 ? 'shared_limit' : 'finished', tasks: []}});
      ids.push(record.id);
    }
    const history: WorkRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = journal.list(7, cursor);
      expect(page.active.map(record => record.id)).toEqual([working.id]);
      history.push(...page.history);
      cursor = page.nextCursor;
    } while (cursor);
    expect(history).toHaveLength(ids.length);
    expect(new Set(history.map(record => record.id))).toEqual(new Set(ids));
    expect(history.find(record => record.id === ids[0])?.outcome).toBe('shared_limit');
    expect(() => journal.list(7, 'not-a-cursor')).toThrow('cursor');
    expect(() => journal.list(0)).toThrow('limit');
  } finally {db.close();}
});
