import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GoalSoftwareBridge, type GoalSoftwareStore} from '../core/goal-software';
import type {GoalRecord, GoalTask} from '../core/goal-orchestrator';
import type {SoftwareTask} from '../core/software-task';

const task = (extra: Partial<GoalTask> = {}): GoalTask => ({id: 'step-1', specialist: 'software', description: 'Build the requested application', acceptance: 'All requested application behaviors pass checks', dependsOn: [], status: 'running', attempts: 1, ...extra});
function goal(extra: Partial<GoalRecord> = {}): GoalRecord {
  return {id: crypto.randomUUID(), request: 'Build one complete application with a counter and reset button.', projectId: 'project-1', research: false,
    status: 'running', phase: 'executing', message: '', tasks: [task()], created: 1, updated: 1, events: [], planningOffset: 0,
    planningDone: true, planningCalls: 0, coverageOffset: 0, coverageDone: false, notes: [], ...extra};
}
function software(id = crypto.randomUUID(), status: SoftwareTask['status'] = 'completed'): SoftwareTask {
  return {id, goal: 'A whole application', status, phase: status, revision: 1, requirements: [], events: [], created: 1, updated: 1, calls: 1,
    errors: 0, message: status === 'completed' ? 'All recorded application checks passed.' : 'Build is queued.', milestoneMs: [], milestoneStarted: 1,
    planOffset: 0, planningDone: true, targets: ['zip'], evidence: {revision: 1, dom: '<main>Actual checked output</main>',
      checks: [{id: 'runtime', ok: true, detail: 'A browser check passed.', milliseconds: 10}],
      artifacts: [{kind: 'zip', name: 'source.zip', sha256: 'fixture', bytes: 100, smokeTested: true}]}};
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2));

function fixture() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE software_tasks(id TEXT PRIMARY KEY,body TEXT NOT NULL)');
  const calls = {creates: 0, resumes: [] as string[], stops: [] as string[]};
  const settings = {failAfterCallback: false, newStatus: 'completed' as SoftwareTask['status'], delayCreation: false};
  const write = (build: SoftwareTask) => {db.query('INSERT INTO software_tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(build.id, JSON.stringify(build)); return build;};
  const get = (id: string) => {
    const row = db.query('SELECT body FROM software_tasks WHERE id=?').get(id) as {body: string} | null;
    if (!row) throw new Error('Software task not found');
    return JSON.parse(row.body) as SoftwareTask;
  };
  const store: GoalSoftwareStore = {
    create: async (request, targets, onSaved) => {
      calls.creates++;
      if (settings.delayCreation) await pause();
      const build = {...software(undefined, settings.newStatus), goal: request, targets};
      db.transaction(() => {write(build); onSaved(build); if (settings.failAfterCallback) throw new Error('Simulated transaction failure');})();
      return build;
    }, get,
    resume: (id, note) => {calls.resumes.push(note); const build = get(id); build.status = 'completed'; return write(build);},
    stop: id => {calls.stops.push(id); const build = get(id); build.status = 'cancelled'; return write(build);}
  };
  const bridge = new GoalSoftwareBridge(db, store, pause);
  const link = (parent: GoalRecord, build: SoftwareTask, milestone = 'step-1') => {write(build); db.query('INSERT INTO goal_software_links VALUES(?,?,?)').run(parent.id, milestone, build.id);};
  const count = (table: string) => (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {count: number}).count;
  return {db, bridge, store, calls, settings, write, link, count};
}

test('actual software creation rolls task and parent link back together before a successful retry', async () => {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'goal-software-'));
  try {
    const source = `
      import {strict as assert} from 'node:assert';
      const {db}=await import(${JSON.stringify(join(import.meta.dir, '../core/storage.ts'))});
      const {createSoftwareTask}=await import(${JSON.stringify(join(import.meta.dir, '../core/software-task.ts'))});
      db.exec('CREATE TABLE callback_links(software TEXT PRIMARY KEY)');
      let seen=0;
      await assert.rejects(createSoftwareTask('Create one test application',['zip'],saved=>{
        assert.equal(db.inTransaction,true);seen++;db.query('INSERT INTO callback_links VALUES(?)').run(saved.id);throw Error('rollback callback');
      }),/rollback callback/);
      assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,0);
      assert.equal(db.query('SELECT COUNT(*) AS n FROM callback_links').get().n,0);
      const task=await createSoftwareTask('Create one test application',['zip'],saved=>{
        assert.equal(db.inTransaction,true);seen++;db.query('INSERT INTO callback_links VALUES(?)').run(saved.id);
      });
      assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,1);
      assert.equal(db.query('SELECT software FROM callback_links').get().software,task.id);
      assert.equal(seen,2);console.log(JSON.stringify({savedTasks:1,savedLinks:1,callbackCalls:seen}));db.close();
    `;
    const child = Bun.spawn([process.execPath, '-e', source], {cwd: join(import.meta.dir, '..'), env: {...process.env, STUDIO_DATA: root, STUDIO_TEST_DATA: root}, stdout: 'pipe', stderr: 'pipe'});
    const code = await child.exited, output = await new Response(child.stdout).text(), errors = await new Response(child.stderr).text();
    expect(errors).toBe('');
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual({savedTasks: 1, savedLinks: 1, callbackCalls: 2});
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a failed atomic link leaves no queued build and retries reuse the committed whole-app build', async () => {
  const f = fixture(), parent = goal();
  try {
    f.settings.failAfterCallback = true;
    await expect(f.bridge.execute(task(), parent, 'Complete the whole app.', new AbortController().signal, () => false)).rejects.toThrow('transaction failure');
    expect(f.count('software_tasks')).toBe(0);
    expect(f.count('goal_software_links')).toBe(0);
    f.settings.failAfterCallback = false;
    const first = await f.bridge.execute(task(), parent, 'Complete the whole app.', new AbortController().signal, () => false);
    const second = await f.bridge.execute(task({attempts: 2, retryReason: 'interrupted'}), parent, 'Complete the whole app.', new AbortController().signal, () => false);
    expect(first.verified).toBe(true);
    expect(first.evidence.some(item=>item.includes('Actual checked output'))).toBe(true);
    expect(second.evidence[0]).toBe(first.evidence[0]);
    expect(f.calls.creates).toBe(2);
    expect(f.count('software_tasks')).toBe(1);
    expect(f.count('goal_software_links')).toBe(1);
    const row = f.db.query('SELECT body FROM software_tasks').get() as {body: string};
    expect(JSON.parse(row.body).goal).toContain(parent.request);
  } finally {f.db.close();}
});

test('concurrent duplicate creation commits only one child and both monitors use that child', async () => {
  const f = fixture(), parent = goal();
  try {
    f.settings.delayCreation = true;
    const results = await Promise.all([1, 2].map(() => f.bridge.execute(task(), parent, 'Build the complete app.', new AbortController().signal, () => false)));
    expect(f.calls.creates).toBe(2);
    expect(f.count('software_tasks')).toBe(1);
    expect(f.count('goal_software_links')).toBe(1);
    expect(results[0].evidence[0]).toBe(results[1].evidence[0]);
    expect(results.every(result => result.verified)).toBe(true);
  } finally {f.db.close();}
});

test('completed linked output is not presented as a newly repaired build after rejected acceptance', async () => {
  const f = fixture(), parent = goal({guidance: 'Implement the missing reset button.'}), build = software();
  try {
    f.link(parent, build);
    const result = await f.bridge.execute(task({attempts: 2, retryReason: 'acceptance_rejected'}), parent, 'Apply the repair guidance.', new AbortController().signal, () => false);
    expect(result.verified).toBe(false);
    expect(result.message).toContain('the guidance was not applied');
    expect(result.evidence).toEqual(['Unchanged completed software build: ' + build.id]);
    expect(f.calls.creates).toBe(0);
    expect(f.calls.resumes).toHaveLength(0);
    expect(f.store.get(build.id).status).toBe('completed');
  } finally {f.db.close();}
});

test('guided repair atomically links a distinct completed child while preserving its accepted parent',async()=>{
  const f=fixture(),parent=goal({guidance:'Change the heading and preserve the counter.'}),accepted=software();
  try{
    f.link(parent,accepted);let revisions=0;
    f.store.revise=async(id,note,onSaved)=>{
      expect(id).toBe(accepted.id);expect(note).toBe(parent.guidance!);revisions++;
      const child={...software(),parentTaskId:id,parentRevision:accepted.revision,revisionNote:note};
      f.db.transaction(()=>{f.write(child);onSaved(child);})();return child;
    };
    const result=await f.bridge.execute(task({attempts:2,retryReason:'acceptance_rejected'}),parent,'Apply the requested repair.',new AbortController().signal,()=>false);
    expect(result.verified).toBe(true);expect(result.softwareTaskId).not.toBe(accepted.id);
    expect(f.bridge.links(parent.id)['step-1']).toBe(result.softwareTaskId!);
    expect(f.store.get(accepted.id)).toEqual(accepted);expect(f.count('software_tasks')).toBe(2);
    await f.bridge.execute(task({attempts:3,retryReason:'interrupted'}),parent,'Review the same child.',new AbortController().signal,()=>false);
    expect(revisions).toBe(1);
  }finally{f.db.close();}
});

test('cancelled revision staging rolls its child and link back and never changes the accepted parent',async()=>{
  const f=fixture(),parent=goal({guidance:'Apply the missing behavior.'}),accepted=software(),control=new AbortController();
  try{
    f.link(parent,accepted);
    f.store.revise=async(id,note,onSaved)=>{
      const child={...software(),parentTaskId:id,revisionNote:note};
      control.abort();f.db.transaction(()=>{f.write(child);onSaved(child);})();return child;
    };
    await expect(f.bridge.execute(task({attempts:2,retryReason:'acceptance_rejected'}),parent,'Repair.',control.signal,()=>false)).rejects.toThrow();
    expect(f.count('software_tasks')).toBe(1);expect(f.bridge.links(parent.id)['step-1']).toBe(accepted.id);
    expect(f.store.get(accepted.id)).toEqual(accepted);
  }finally{f.db.close();}
});

test('a completed build requires explicit repair guidance before a child can be created',async()=>{
  const f=fixture(),parent=goal(),accepted=software();
  try{
    f.link(parent,accepted);let revisions=0;
    f.store.revise=async()=>{revisions++;return software();};
    const result=await f.bridge.execute(task({attempts:2,retryReason:'acceptance_rejected'}),parent,'Repair.',new AbortController().signal,()=>false);
    expect(result.verified).toBe(false);expect(result.message).toContain('specific revision guidance');expect(revisions).toBe(0);
    expect(f.bridge.links(parent.id)['step-1']).toBe(accepted.id);
  }finally{f.db.close();}
});

test('startup reconciliation stops unfinished children of paused/cancelled parents and preserves completed children', () => {
  const f = fixture();
  try {
    const paused = goal({status: 'needs_input'}), cancelled = goal({status: 'cancelled'}), active = goal(), completedParent = goal({status: 'needs_input'});
    const queued = software(undefined, 'queued'), running = software(undefined, 'running'), activeChild = software(undefined, 'queued'), completedChild = software();
    f.link(paused, queued); f.link(cancelled, running); f.link(active, activeChild); f.link(completedParent, completedChild);
    f.bridge.reconcile([paused, cancelled, active, completedParent]);
    expect(f.store.get(queued.id).status).toBe('cancelled');
    expect(f.store.get(running.id).status).toBe('cancelled');
    expect(f.store.get(activeChild.id).status).toBe('queued');
    expect(f.store.get(completedChild.id).status).toBe('completed');
    f.bridge.stopGoal(active.id);
    expect(f.store.get(activeChild.id).status).toBe('cancelled');
    f.bridge.stopGoal(completedParent.id);
    expect(f.store.get(completedChild.id).status).toBe('completed');
  } finally {f.db.close();}
});

test('shutdown leaves a recoverable checkpoint that startup reconciliation pauses until explicit continuation', async () => {
  const f = fixture(), parent = goal(), control = new AbortController();
  try {
    f.settings.newStatus = 'queued';
    let shuttingDown = false;
    const pending = f.bridge.execute(task(), parent, 'Build the complete app.', control.signal, () => shuttingDown);
    await pause();
    const link = f.db.query('SELECT software FROM goal_software_links').get() as {software: string};
    shuttingDown = true; control.abort('shutdown');
    await expect(pending).rejects.toThrow();
    expect(f.calls.stops).toHaveLength(0);
    expect(f.store.get(link.software).status).toBe('queued');
    parent.status = 'needs_input';
    f.bridge.reconcile([parent]);
    expect(f.store.get(link.software).status).toBe('cancelled');
    parent.status = 'running'; parent.guidance = 'The saved checkpoint was reviewed; finish its checks.';
    const result = await f.bridge.execute(task({attempts: 2, retryReason: 'interrupted'}), parent, 'Continue this same application.', new AbortController().signal, () => false);
    expect(result.verified).toBe(true);
    expect(f.calls.creates).toBe(1);
    expect(f.calls.resumes).toEqual([parent.guidance]);
    expect(f.count('software_tasks')).toBe(1);
  } finally {f.db.close();}
});

test('explicit cancellation stops a live child and missing artifact checks cannot certify completion', async () => {
  const f = fixture(), parent = goal(), control = new AbortController();
  try {
    f.settings.newStatus = 'running';
    const pending = f.bridge.execute(task(), parent, 'Build the app.', control.signal, () => false);
    await pause();
    const link = f.db.query('SELECT software FROM goal_software_links').get() as {software: string};
    control.abort('cancelled');
    await expect(pending).rejects.toThrow();
    expect(f.store.get(link.software).status).toBe('cancelled');
    const build = f.store.get(link.software); build.status = 'completed'; build.targets = ['zip', 'exe']; f.write(build);
    const incomplete = await f.bridge.execute(task({attempts: 2, retryReason: 'interrupted'}), parent, 'Inspect the saved application.', new AbortController().signal, () => false);
    expect(incomplete.verified).toBe(false);
    build.targets=['zip'];build.evidence!.revision=0;f.write(build);
    const stale=await f.bridge.execute(task({attempts:3,retryReason:'interrupted'}),parent,'Inspect current revision proof.',new AbortController().signal,()=>false);
    expect(stale.verified).toBe(false);
  } finally {f.db.close();}
});
