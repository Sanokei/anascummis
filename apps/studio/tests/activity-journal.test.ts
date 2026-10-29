import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ActivityJournal, type ActivityEntry, type ActivityInput, type ActivityKind} from '../core/activity-journal';

const event = (detail: string, time = 1000): ActivityInput => ({time, role: 'executor', phase: 'working', detail});
function append(db: Database, journal: ActivityJournal, kind: ActivityKind, id: string, value: ActivityInput, legacy: ActivityInput[] = []) {
  return db.transaction(() => journal.append(kind, id, value, legacy))();
}
function all(journal: ActivityJournal, kind: ActivityKind, id: string, limit = 25): ActivityEntry[] {
  const events: ActivityEntry[] = [];
  let before: string | undefined;
  do {
    const page = journal.list(kind, id, limit, before);
    events.push(...page.events); before = page.nextCursor;
  } while (before);
  return events;
}

test('activity preserves more than 160 identical/time-equal events without pagination gaps', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db), identical = event('same event');
    db.transaction(() => {for (let i = 0; i < 233; i++) journal.append('goal', 'goal-1', identical);})();
    const history = all(journal, 'goal', 'goal-1', 17);
    expect(history).toHaveLength(233);
    expect(new Set(history.map(entry => entry.sequence)).size).toBe(233);
    expect(history.every(entry => entry.time === 1000 && entry.detail === 'same event')).toBe(true);
    expect(history.map(entry => entry.sequence)).toEqual(Array.from({length: 233}, (_, i) => 233 - i));
    expect(journal.list('goal', 'goal-1').importedHistory).toBe(false);
    expect(journal.list('goal', 'goal-1').earlierHistoryMayBeMissing).toBe(false);
  } finally {db.close();}
});

test('new appends do not shift old-page traversal and SQL always filters kind and stream ID', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db), expected: number[] = [];
    for (let i = 0; i < 30; i++) {
      expected.push(append(db, journal, 'work', 'shared-id', event('work-' + i)).sequence);
      append(db, journal, 'software', 'shared-id', event('software-only'));
      append(db, journal, 'work', 'other-id', event('other-work-only'));
    }
    const first = journal.list('work', 'shared-id', 7);
    const added = append(db, journal, 'work', 'shared-id', event('new work'));
    const older = [...first.events];
    let cursor = first.nextCursor;
    while (cursor) {const page = journal.list('work', 'shared-id', 7, cursor); older.push(...page.events); cursor = page.nextCursor;}
    expect(older.map(entry => entry.sequence)).toEqual(expected.reverse());
    expect(older.every(entry => entry.detail?.startsWith('work-'))).toBe(true);
    expect(journal.list('work', 'shared-id').events[0].sequence).toBe(added.sequence);
    const scoped = journal.list('software', 'shared-id', 100, String(added.sequence));
    expect(scoped.events).toHaveLength(30);
    expect(scoped.events.every(entry => entry.detail === 'software-only')).toBe(true);
  } finally {db.close();}
});

test('legacy imports survive disk reopen, remain idempotent and report unrecoverable earlier-history limits', () => {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'activity-journal-'));
  let db = new Database(join(root, 'journal.sqlite'));
  try {
    let journal = new ActivityJournal(db);
    const legacy = Array.from({length: 160}, (_, i) => event('retained-' + i));
    journal.ensureStream('software', 'legacy-build', legacy);
    append(db, journal, 'software', 'legacy-build', event('new event'), legacy);
    db.close(); db = new Database(join(root, 'journal.sqlite')); journal = new ActivityJournal(db);
    journal.ensureStream('software', 'legacy-build', [...legacy, event('must not be imported twice')]);
    const page = journal.list('software', 'legacy-build', 100);
    expect(page.importedHistory).toBe(true);
    expect(page.earlierHistoryMayBeMissing).toBe(true);
    const history = all(journal, 'software', 'legacy-build');
    expect(history).toHaveLength(161);
    expect(history[0].detail).toBe('new event');
    expect(history.some(entry => entry.detail === 'must not be imported twice')).toBe(false);
    journal.ensureStream('goal', 'short-legacy', [event('one'), event('one')]);
    expect(journal.list('goal', 'short-legacy').importedHistory).toBe(true);
    expect(journal.list('goal', 'short-legacy').earlierHistoryMayBeMissing).toBe(false);
    expect(journal.list('goal', 'short-legacy').events).toHaveLength(2);
  } finally {db.close(); rmSync(root, {recursive: true, force: true});}
});

test('append imports only preceding retained events and preserves a matching new occurrence', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db), same = event('identical');
    append(db, journal, 'work', 'old-work', same, [same, same]);
    expect(all(journal, 'work', 'old-work')).toHaveLength(3);
    append(db, journal, 'work', 'old-work', same, [same, same, same]);
    expect(all(journal, 'work', 'old-work')).toHaveLength(4);
  } finally {db.close();}
});

test('source state, legacy initialization and new event roll back atomically', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db);
    db.exec("CREATE TABLE source_state(id TEXT PRIMARY KEY,status TEXT); INSERT INTO source_state VALUES('one','queued')");
    expect(() => db.transaction(() => {
      db.query('UPDATE source_state SET status=? WHERE id=?').run('running', 'one');
      journal.append('goal', 'one', event('starting'), [event('queued')]);
      throw new Error('source operation failed');
    })()).toThrow('source operation failed');
    expect((db.query('SELECT status FROM source_state WHERE id=?').get('one') as {status: string}).status).toBe('queued');
    expect(journal.list('goal', 'one').events).toHaveLength(0);
    expect(journal.list('goal', 'one').importedHistory).toBe(false);
    append(db, journal, 'goal', 'one', event('starting'), [event('queued')]);
    expect(all(journal, 'goal', 'one').map(entry => entry.detail)).toEqual(['starting', 'queued']);
  } finally {db.close();}
});

test('append requires the caller transaction and invalid legacy imports leave no partial stream', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db);
    expect(() => journal.append('software', 'one', event('outside transaction'), [event('legacy')])).toThrow('source-record transaction');
    expect(journal.list('software', 'one').events).toHaveLength(0);
    expect(() => journal.ensureStream('software', 'one', [event('valid'), {...event('invalid'), time: NaN}])).toThrow('Invalid activity event');
    journal.ensureStream('software', 'one', [event('valid retry')]);
    expect(all(journal, 'software', 'one').map(entry => entry.detail)).toEqual(['valid retry']);
  } finally {db.close();}
});

test('nested ensureStream participates in outer rollback and an empty read does not suppress migration', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db);
    expect(journal.list('work', 'late-import').events).toHaveLength(0);
    expect(() => db.transaction(() => {
      journal.ensureStream('work', 'late-import', [event('legacy')]);
      throw new Error('rollback');
    })()).toThrow('rollback');
    journal.ensureStream('work', 'late-import', [event('legacy')]);
    expect(journal.list('work', 'late-import').events).toHaveLength(1);
    expect(journal.list('work', 'late-import').importedHistory).toBe(true);
    journal.ensureStream('goal', 'new-goal');
    journal.ensureStream('goal', 'new-goal', Array.from({length: 160}, () => event('ignored later projection')));
    expect(journal.list('goal', 'new-goal')).toEqual({events: [], nextCursor: undefined, importedHistory: false, earlierHistoryMayBeMissing: false});
  } finally {db.close();}
});

test('activity cursors accept only canonical positive safe integers and limits are bounded', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db);
    append(db, journal, 'goal', 'one', event('event'));
    for (const cursor of ['', '0', '00', '01', '-1', '+1', ' 1', '1 ', '1.0', '1e2', 'Infinity', 'NaN', '9007199254740992', '١', '1:goal']) {
      expect(() => journal.list('goal', 'one', 25, cursor)).toThrow('Invalid activity history cursor');
    }
    for (const limit of [0, -1, 101, 1.5, NaN, Infinity]) expect(() => journal.list('goal', 'one', limit)).toThrow('limit');
    expect(journal.list('goal', 'one', 1, '9007199254740991').events).toHaveLength(1);
    expect(journal.list('goal', 'one', 1, '1').events).toHaveLength(0);
  } finally {db.close();}
});

test('only activity fields persist and stream IDs remain bound SQL values', () => {
  const db = new Database(':memory:');
  try {
    const journal = new ActivityJournal(db), id = "one' OR 1=1 --";
    const extra = {...event('retained detail'), taskId: 'step-1', revision: 0, context: 'PRIVATE-MODEL-CONTEXT', toolArgs: {secret: 'PRIVATE-TOOL-CONTEXT'}};
    append(db, journal, 'work', id, extra);
    append(db, journal, 'work', 'other', event('other stream'));
    const page = journal.list('work', id);
    expect(page.events).toHaveLength(1);
    expect(page.events[0].revision).toBe(0);
    expect(page.events[0].taskId).toBe('step-1');
    expect(JSON.stringify(page)).not.toContain('PRIVATE-');
    expect(journal.list('goal', id).events).toHaveLength(0);
  } finally {db.close();}
});
