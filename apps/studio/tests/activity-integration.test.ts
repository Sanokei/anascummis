import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GoalOrchestrator} from '../core/goal-orchestrator';
import {WorkJournal} from '../core/work-journal';
import type {ActivityPage, ActivityEntry} from '../core/activity-journal';

const neverRun = {infer: async () => {throw new Error('The activity test must not run inference');}, execute: async () => {throw new Error('The activity test must not execute tasks');}};
function entries(read: (before?: string) => ActivityPage) {
  const result: ActivityEntry[] = [];
  let before: string | undefined;
  do {const page = read(before); result.push(...page.events); before = page.nextCursor;} while (before);
  return result;
}

test('goal and work resources retain complete isolated activity beyond their bounded recent projections after reopen', () => {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'activity-wiring-'));
  let db = new Database(join(root, 'activity.sqlite'));
  try {
    let goals = new GoalOrchestrator(db, neverRun), work = new WorkJournal(db, () => 1000);
    const goal = goals.create({request: 'Track every orchestration transition.', projectId: 'project-1'});
    work.create({id: goal.id, projectId: 'project-1', request: 'Work in a separate stream sharing the same UUID.'});
    for (let i = 0; i < 180; i++) {
      work.progress(goal.id, {phase: 'working', agent: 'website', taskId: 'same-host-task'});
      if (i % 2 === 0) {goals.stop(goal.id); goals.resume(goal.id);}
    }
    work.fail(goal.id, 'cancelled', 'Explicitly stopped.');
    const stopped = work.activity(goal.id, 100);
    work.fail(goal.id, 'failed', 'Late failure'); work.complete(goal.id, {message: 'Late success', orchestration: {stopReason: 'finished', tasks: []}});
    expect(work.activity(goal.id, 100)).toEqual(stopped);
    expect(goals.get(goal.id).events).toHaveLength(160);
    expect(work.get(goal.id)?.events).toHaveLength(160);
    const goalEvents = entries(before => goals.activity(goal.id, 37, before)), workEvents = entries(before => work.activity(goal.id, 29, before));
    expect(goalEvents).toHaveLength(181);
    expect(workEvents).toHaveLength(182);
    expect(workEvents.filter(event => event.phase === 'working')).toHaveLength(180);
    expect(workEvents.filter(event => event.phase === 'cancelled')).toHaveLength(1);
    expect(new Set([...goalEvents, ...workEvents].map(event => event.sequence)).size).toBe(363);
    expect(goals.activity(goal.id).earlierHistoryMayBeMissing).toBe(false);
    expect(work.activity(goal.id).earlierHistoryMayBeMissing).toBe(false);
    expect(goals.activity(goal.id).importedHistory).toBe(false);
    db.close(); db = new Database(join(root, 'activity.sqlite'));
    goals = new GoalOrchestrator(db, neverRun); work = new WorkJournal(db);
    expect(entries(before => goals.activity(goal.id, 53, before))).toEqual(goalEvents);
    expect(entries(before => work.activity(goal.id, 17, before))).toEqual(workEvents);
  } finally {db.close(); rmSync(root, {recursive: true, force: true});}
});

test('legacy goal/work projections import once before new appends and flag potentially missing earlier history', () => {
  const db = new Database(':memory:');
  try {
    const goals = new GoalOrchestrator(db, neverRun), work = new WorkJournal(db);
    const template = goals.create({request: 'Legacy retained history', projectId: 'project-1'}), id = crypto.randomUUID();
    const retained = Array.from({length: 160}, (_, i) => ({time: i, role: 'coordinator' as const, phase: 'legacy-' + i, detail: 'Retained legacy phase ' + i}));
    const legacy = {...template, id, events: retained};
    db.query('INSERT INTO goal_tasks VALUES(?,?,?)').run(id, JSON.stringify(legacy), legacy.updated);
    goals.stop(id);
    const goalEvents = entries(before => goals.activity(id, 41, before));
    expect(goalEvents).toHaveLength(161);
    expect(goalEvents.at(-1)?.phase).toBe('legacy-0');
    expect(goalEvents.filter(event => event.phase === 'cancelled')).toHaveLength(1);
    expect(goals.activity(id).importedHistory).toBe(true);
    expect(goals.activity(id).earlierHistoryMayBeMissing).toBe(true);
    expect(entries(before => goals.activity(id, 41, before))).toEqual(goalEvents);
    const jobId = crypto.randomUUID(), record = {id: jobId, projectId: 'project-1', request: 'Legacy work', status: 'running', created: 1, updated: 160,
      progress: {phase: 'legacy-159', agent: 'website'}, events: retained.map(({role, ...event}) => ({...event, agent: 'website'}))};
    const body = JSON.stringify(record);
    db.query('INSERT INTO work_journal VALUES(?,?,?,?)').run(jobId, 'running', 160, body);
    expect(work.activity(jobId).importedHistory).toBe(true);
    expect(work.activity(jobId).earlierHistoryMayBeMissing).toBe(true);
    expect((db.query('SELECT body FROM work_journal WHERE id=?').get(jobId) as {body: string}).body).toBe(body);
    work.progress(jobId, {phase: 'current', agent: 'website'});
    expect(entries(before => work.activity(jobId, 31, before))).toHaveLength(161);
    expect(work.get(jobId)?.events).toHaveLength(160);
  } finally {db.close();}
});

test('source insert/update rejection rolls resource records and their activity back together', () => {
  const db = new Database(':memory:');
  try {
    const goals = new GoalOrchestrator(db, neverRun), work = new WorkJournal(db);
    db.exec("CREATE TRIGGER reject_goal_insert BEFORE INSERT ON goal_tasks BEGIN SELECT RAISE(ABORT,'reject goal source'); END;");
    expect(() => goals.create({request: 'This write must roll back.', projectId: 'project-1'})).toThrow('reject goal source');
    expect((db.query('SELECT COUNT(*) AS n FROM activity_entries').get() as {n: number}).n).toBe(0);
    expect((db.query('SELECT COUNT(*) AS n FROM activity_streams').get() as {n: number}).n).toBe(0);
    db.exec('DROP TRIGGER reject_goal_insert');
    const goal = goals.create({request: 'Accepted initial record', projectId: 'project-1'}), before = goals.activity(goal.id, 100);
    db.exec("CREATE TRIGGER reject_goal_update BEFORE UPDATE ON goal_tasks BEGIN SELECT RAISE(ABORT,'reject goal transition'); END;");
    expect(() => goals.stop(goal.id)).toThrow('reject goal transition');
    expect(goals.get(goal.id).status).toBe('queued'); expect(goals.activity(goal.id, 100)).toEqual(before);
    db.exec('DROP TRIGGER reject_goal_update');
    const workId = crypto.randomUUID();
    db.exec("CREATE TRIGGER reject_work_insert BEFORE INSERT ON work_journal BEGIN SELECT RAISE(ABORT,'reject work source'); END;");
    expect(() => work.create({id: workId, projectId: 'project-1', request: 'Rollback new work'})).toThrow('reject work source');
    expect(work.get(workId)).toBeUndefined();
    expect((db.query("SELECT COUNT(*) AS n FROM activity_entries WHERE kind='work'").get() as {n: number}).n).toBe(0);
    expect((db.query("SELECT COUNT(*) AS n FROM activity_streams WHERE kind='work'").get() as {n: number}).n).toBe(0);
  } finally {db.close();}
});

test('software journal writes share creation/link transactions and terminal Stops are idempotent', async () => {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'software-activity-'));
  try {
    const script = `
      import {strict as assert} from 'node:assert';
      const {db}=await import(${JSON.stringify(join(import.meta.dir, '../core/storage.ts'))});
      const manager=await import(${JSON.stringify(join(import.meta.dir, '../core/software-task.ts'))});
      const {taskRoot}=await import(${JSON.stringify(join(import.meta.dir, '../core/software-runner.ts'))});
      const {mkdir}=await import('node:fs/promises');const {join}=await import('node:path');const {createHash}=await import('node:crypto');
      db.exec('CREATE TABLE atomic_links(software TEXT PRIMARY KEY)');
      await assert.rejects(manager.createSoftwareTask('Atomic software activity',['zip'],saved=>{db.query('INSERT INTO atomic_links VALUES(?)').run(saved.id);throw Error('reject source link');}),/reject source link/);
      assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,0);assert.equal(db.query('SELECT COUNT(*) AS n FROM atomic_links').get().n,0);
      assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_entries').get().n,0);assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_streams').get().n,0);
      const task=await manager.createSoftwareTask('Persist every software transition',['zip']);
      for(let i=0;i<90;i++){manager.stopSoftwareTask(task.id);manager.resumeSoftwareTask(task.id);}
      assert.equal(manager.softwareTask(task.id).events.length,160);
      const first=manager.softwareActivity(task.id,100);assert.equal(first.earlierHistoryMayBeMissing,false);assert.equal(first.importedHistory,false);
      let cursor;const events=[];do{const page=manager.softwareActivity(task.id,31,cursor);events.push(...page.events);cursor=page.nextCursor;}while(cursor);assert.equal(events.length,181);
      manager.stopSoftwareTask(task.id);const stopped=manager.softwareActivity(task.id,100);manager.stopSoftwareTask(task.id);assert.deepEqual(manager.softwareActivity(task.id,100),stopped);
      const accepted=manager.softwareTask(task.id);accepted.status='completed';db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(accepted),accepted.id);
      const original=db.query('SELECT body FROM software_tasks WHERE id=?').get(accepted.id).body;
      manager.stopSoftwareTask(accepted.id);assert.equal(db.query('SELECT body FROM software_tasks WHERE id=?').get(accepted.id).body,original);
      assert.deepEqual(manager.softwareActivity(accepted.id,100),stopped);
      const legacy={...accepted,id:crypto.randomUUID(),events:Array.from({length:160},(_,i)=>({time:i,phase:'legacy-'+i,detail:'Retained accepted phase '+i,revision:0}))};
      await mkdir(join(taskRoot(legacy.id),'artifacts'),{recursive:true});const artifact=new Uint8Array([80,75,3,4,7]);await Bun.write(join(taskRoot(legacy.id),'artifacts','source.zip'),artifact);const checksum=createHash('sha256').update(artifact).digest('hex');
      legacy.evidence={revision:0,checks:[{id:'fixture',ok:true,detail:'Fixture accepted bytes for read-only history migration.',milliseconds:1}],dom:'Accepted fixture',artifacts:[{kind:'zip',name:'source.zip',sha256:checksum,bytes:artifact.length,smokeTested:true}]};
      const body=JSON.stringify(legacy);db.query('INSERT INTO software_tasks VALUES(?,?,?)').run(legacy.id,body,legacy.updated);
      assert.equal(manager.softwareActivity(legacy.id,100).importedHistory,true);assert.equal(manager.softwareActivity(legacy.id,100).earlierHistoryMayBeMissing,true);
      assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_entries WHERE kind=? AND stream_id=?').get('software',legacy.id).n,160);
      manager.softwareActivity(legacy.id,100);manager.stopSoftwareTask(legacy.id);
      assert.equal(db.query('SELECT body FROM software_tasks WHERE id=?').get(legacy.id).body,body);assert.equal(createHash('sha256').update(await Bun.file(join(taskRoot(legacy.id),'artifacts','source.zip')).bytes()).digest('hex'),checksum);
      const oldQueued={...legacy,id:crypto.randomUUID(),status:'queued'},queuedBody=JSON.stringify(oldQueued);db.query('INSERT INTO software_tasks VALUES(?,?,?)').run(oldQueued.id,queuedBody,oldQueued.updated);
      db.exec("CREATE TRIGGER reject_software_transition BEFORE UPDATE ON software_tasks BEGIN SELECT RAISE(ABORT,'reject software transition'); END;");
      assert.throws(()=>manager.stopSoftwareTask(oldQueued.id),/reject software transition/);assert.equal(db.query('SELECT body FROM software_tasks WHERE id=?').get(oldQueued.id).body,queuedBody);
      assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_entries WHERE kind=? AND stream_id=?').get('software',oldQueued.id).n,0);assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_streams WHERE kind=? AND id=?').get('software',oldQueued.id).n,0);
      db.exec('DROP TRIGGER reject_software_transition');manager.stopSoftwareTask(oldQueued.id);assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_entries WHERE kind=? AND stream_id=?').get('software',oldQueued.id).n,161);
      console.log('software activity transactions passed');db.close();
    `;
    const child = Bun.spawn([process.execPath, '-e', script], {cwd: join(import.meta.dir, '..'), env: {...process.env, STUDIO_DATA: root, STUDIO_TEST_DATA: root}, stdout: 'pipe', stderr: 'pipe'});
    const code = await child.exited, output = await new Response(child.stdout).text(), errors = await new Response(child.stderr).text();
    expect(errors).toBe(''); expect(code).toBe(0); expect(output.trim()).toBe('software activity transactions passed');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a failed live software event leaves no projection or legacy-import residue when the same record retries', async () => {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'software-activity-retry-'));
  try {
    const script = `
      import {strict as assert} from 'node:assert';
      const {db}=await import(${JSON.stringify(join(import.meta.dir, '../core/storage.ts'))});
      const manager=await import(${JSON.stringify(join(import.meta.dir, '../core/software-task.ts'))});
      const live=await manager.createSoftwareTask('Review an existing revision checkpoint',['zip']);
      Object.assign(live,{status:'needs_input',parentTaskId:crypto.randomUUID(),updated:123,eta:{lowSeconds:7,highSeconds:14,basis:'Prior estimate'},
        requirements:[{id:'kept',description:'Preserve inspected output',status:'verified',reviewRevision:0,files:[],tests:[]}],
        revisionPlan:{criteria:[],criterionOffset:0,guidance:'Preserve inspected output',guidanceOffset:0,stage:'ready',decisions:[],coverageOffset:0,coverageRevision:0},
        evidence:{revision:0,checks:[{id:'fixture',ok:true,detail:'Injected host evidence for transaction testing only',milliseconds:1}],dom:'Preserve inspected output',headings:[],artifacts:[{kind:'zip',name:'source.zip',bytes:1,sha256:'a'.repeat(64),smokeTested:true}]}});
      db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(live),live.id);
      db.query('DELETE FROM activity_entries WHERE kind=? AND stream_id=?').run('software',live.id);db.query('DELETE FROM activity_streams WHERE kind=? AND id=?').run('software',live.id);
      const fields=task=>({events:structuredClone(task.events),phase:task.phase,message:task.message,updated:task.updated,eta:structuredClone(task.eta)}),before=fields(live);let reviews=0;
      db.exec("CREATE TRIGGER reject_live_event BEFORE UPDATE ON software_tasks BEGIN SELECT RAISE(ABORT,'reject live event'); END;");
      await assert.rejects(manager.reviewSoftwareRevisionCoverage(live,new AbortController().signal,async()=>{reviews++;return {satisfied:true,reason:'Injected coverage result'};}),/reject live event/);
      assert.deepEqual(fields(live),before);assert.equal(reviews,0);
      assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_entries WHERE kind=? AND stream_id=?').get('software',live.id).n,0);assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_streams WHERE kind=? AND id=?').get('software',live.id).n,0);
      db.exec('DROP TRIGGER reject_live_event');
      assert.equal(await manager.reviewSoftwareRevisionCoverage(live,new AbortController().signal,async()=>{reviews++;return {satisfied:true,reason:'Injected coverage result'};}),true);
      const tail=id=>manager.softwareActivity(id,100).events.toReversed().map(({sequence,role,...event})=>event);
      assert.equal(reviews,1);assert.equal(live.events.length,before.events.length+1);assert.deepEqual(live.events,tail(live.id));assert.deepEqual(manager.softwareTask(live.id).events,tail(live.id));

      const worker=await manager.createSoftwareTask('Improve the fixture application with durable planning',['zip']);
      db.exec("CREATE TRIGGER reject_first_plan BEFORE UPDATE ON software_tasks WHEN json_extract(NEW.body,'$.phase')='planning' AND json_extract(NEW.body,'$.errors')=0 BEGIN SELECT RAISE(ABORT,'reject first live plan'); END;");
      let calls=0;manager.startSoftwareWorker(async()=>{calls++;manager.shutdownSoftwareWorker();throw Error('End fixture after the successful retry reaches inference');});
      for(let i=0;i<250;i++){const current=manager.softwareTask(worker.id);if(calls===1&&current.status==='queued'&&current.phase==='queued')break;await new Promise(resolve=>setTimeout(resolve,2));}
      manager.shutdownSoftwareWorker();const retried=manager.softwareTask(worker.id);
      assert.equal(calls,1);assert.equal(retried.status,'queued');assert.equal(retried.events.filter(event=>event.phase==='retrying').length,1);assert.equal(retried.events.filter(event=>event.phase==='planning').length,1);
      assert.deepEqual(retried.events,tail(worker.id));assert.equal(tail(worker.id).filter(event=>event.phase==='retrying').length,1);
      db.close();console.log('live software transaction retry passed');
    `;
    const child = Bun.spawn([process.execPath, '-e', script], {cwd: join(import.meta.dir, '..'), env: {...process.env, STUDIO_DATA: root, STUDIO_TEST_DATA: root}, stdout: 'pipe', stderr: 'pipe'});
    const code = await child.exited, output = await new Response(child.stdout).text(), errors = await new Response(child.stderr).text();
    expect(errors).toBe(''); expect(code).toBe(0); expect(output.trim()).toBe('live software transaction retry passed');
  } finally {rmSync(root, {recursive: true, force: true});}
});
