import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const studio=resolve(import.meta.dir,'..');
const setup=`
 import {strict as assert} from 'node:assert';import {join} from 'node:path';import {mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
 const tasks=await import(${JSON.stringify(join(studio,'core/software-task.ts'))});
 const runner=await import(${JSON.stringify(join(studio,'core/software-runner.ts'))});
 const {summary}=await import(${JSON.stringify(join(studio,'core/software-api.ts'))});
 const {db}=await import(${JSON.stringify(join(studio,'core/storage.ts'))});
 const fullLog='original check log: '+('retained evidence '.repeat(900))+' END-OF-ORIGINAL-LOG';
 async function fixture(){
  const task=await tasks.createSoftwareTask('Validation retry fixture; no real build or inference is claimed.',['zip']);
  task.status='needs_input';task.phase='needs_input';task.revision=3;task.calls=7;task.errors=3;task.planningDone=true;task.planOffset=task.goal.length;
  task.requirements=[{id:'fixture',description:'Keep the saved application behavior',status:'implemented',files:['app/page.tsx'],tests:['tests/app.test.tsx']}];
  task.evidence={revision:3,checks:[{id:'install',ok:true,detail:fullLog,milliseconds:1},{id:'build',ok:true,detail:fullLog,milliseconds:2},{id:'browser',ok:false,detail:fullLog+' Original browser validation failed.',milliseconds:3}],dom:'Full saved DOM from the failed validation.',headings:['Fixture app'],screenshot:'revision-3.png',browserContract:{kind:'counter',label:'Count',button:'Increment'},artifacts:[]};
  await mkdir(join(runner.taskRoot(task.id),'.qa'),{recursive:true});await Bun.write(join(runner.taskRoot(task.id),'.qa','revision-3.png'),new Uint8Array([137,80,78,71,3]));
  db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);return task;
 }
 const row=id=>db.query('SELECT body FROM software_tasks WHERE id=?').get(id).body;
 const history=id=>db.query('SELECT sequence,event_json FROM activity_entries WHERE kind=? AND stream_id=? ORDER BY sequence').all('software',id);
 const fileHash=async path=>createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex');
 async function files(task){const root=runner.taskRoot(task.id);return {page:await fileHash(join(root,'app/page.tsx')),test:await fileHash(join(root,'tests/app.test.tsx')),screenshot:await fileHash(join(root,'.qa','revision-3.png'))};}
`;

async function scenario(source:string){
 const folder=await mkdtemp(join(tmpdir(),'software-validation-retry-'));
 try{
  const child=Bun.spawn([process.execPath,'-e',setup+'\n'+source+'\nconsole.log("validation retry scenario passed");'],{cwd:studio,env:{...process.env,STUDIO_DATA:folder,STUDIO_TEST_DATA:folder},stdout:'pipe',stderr:'pipe'});
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(code).toBe(0);expect(stderr).toBe('');expect(stdout.trim()).toBe('validation retry scenario passed');
 }finally{await rm(folder,{recursive:true,force:true});}
}

test('explicit Resume archives a full text-only failed receipt while queuing unchanged saved source for real revalidation',async()=>{
 await scenario(`
  const task=await fixture(),priorFiles=await files(task),oldEvidence=structuredClone(task.evidence);
  const resumed=tasks.resumeSoftwareTask(task.id);
  assert.equal(resumed.status,'queued');assert.equal(resumed.evidence,undefined);assert.equal(resumed.revision,3);assert.equal(resumed.calls,7);assert.equal(resumed.planningDone,true);assert.equal(resumed.goal,task.goal);assert.deepEqual(resumed.requirements,task.requirements);assert.deepEqual(await files(task),priorFiles);
  const archived=tasks.softwareActivity(task.id,25).events.find(event=>event.phase==='validation_retry');assert(archived);assert.equal(archived.revision,3);
  const receipt=JSON.parse(archived.detail);assert.equal(receipt.format,'anascummis.failed-validation.v1');assert.equal(receipt.taskId,task.id);assert.equal(receipt.sourceRevision,3);assert.match(receipt.retention,/Text-only/);assert.match(receipt.retention,/screenshot reference is omitted/);delete oldEvidence.screenshot;assert.deepEqual(receipt.receipt,oldEvidence);assert.equal(receipt.receipt.screenshot,undefined);assert(receipt.receipt.checks[2].detail.endsWith('Original browser validation failed.'));
  const projected=resumed.events.find(event=>event.phase==='validation_retry');assert(projected.detail.length<250);assert(!projected.detail.includes(fullLog));assert(JSON.stringify(summary(resumed)).length<5000);assert(!JSON.stringify(summary(resumed)).includes('END-OF-ORIGINAL-LOG'));
  tasks.resumeSoftwareTask(task.id);assert.equal(tasks.softwareActivity(task.id,25).events.filter(event=>event.phase==='validation_retry').length,1);
  const verify='const tasks=await import('+JSON.stringify(${JSON.stringify(join(studio,'core/software-task.ts'))})+');const task=tasks.softwareTask('+JSON.stringify(task.id)+');const event=tasks.softwareActivity(task.id,25).events.find(event=>event.phase==="validation_retry");if(task.evidence!==undefined||!JSON.parse(event.detail).receipt.checks[2].detail.includes("END-OF-ORIGINAL-LOG"))throw Error("Historical receipt did not survive process reopen");';
  const reopened=Bun.spawn([${JSON.stringify(process.execPath)},'-e',verify],{cwd:${JSON.stringify(studio)},env:{...process.env},stdout:'pipe',stderr:'pipe'});const [code,errors]=await Promise.all([reopened.exited,new Response(reopened.stderr).text()]);assert.equal(code,0,errors);
 `);
});

test('failed checks stay cached without explicit Resume, and passing/stale evidence or completed parents are untouched',async()=>{
 await scenario(`
  const failed=await fixture(),failedBefore=row(failed.id);let modelCalls=0;tasks.startSoftwareWorker(async()=>{modelCalls++;throw Error('No implicit retry');});await new Promise(resolve=>setTimeout(resolve,5));tasks.shutdownSoftwareWorker();assert.equal(modelCalls,0);assert.equal(row(failed.id),failedBefore);assert.equal(tasks.softwareActivity(failed.id,25).events.some(event=>event.phase==='validation_retry'),false);
  const passed=await fixture();passed.evidence.checks=passed.evidence.checks.map(check=>({...check,ok:true}));db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(passed),passed.id);const passingEvidence=structuredClone(passed.evidence),passingFiles=await files(passed);assert.deepEqual(tasks.resumeSoftwareTask(passed.id).evidence,passingEvidence);assert.deepEqual(await files(passed),passingFiles);assert.equal(tasks.softwareActivity(passed.id,25).events.some(event=>event.phase==='validation_retry'),false);
  const parent=await fixture();parent.status='completed';parent.evidence.checks=parent.evidence.checks.map(check=>({...check,ok:true}));await mkdir(join(runner.taskRoot(parent.id),'artifacts'),{recursive:true});await Bun.write(join(runner.taskRoot(parent.id),'artifacts','source.zip'),'accepted parent artifact fixture');parent.evidence.artifacts=[{kind:'zip',name:'source.zip',sha256:await fileHash(join(runner.taskRoot(parent.id),'artifacts','source.zip')),bytes:Bun.file(join(runner.taskRoot(parent.id),'artifacts','source.zip')).size,smokeTested:true}];db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(parent),parent.id);const parentBefore=row(parent.id),parentHistory=history(parent.id),parentFiles=await files(parent),zipBefore=await fileHash(join(runner.taskRoot(parent.id),'artifacts','source.zip'));tasks.resumeSoftwareTask(parent.id,'Ignored for accepted parent');assert.equal(row(parent.id),parentBefore);assert.deepEqual(history(parent.id),parentHistory);assert.deepEqual(await files(parent),parentFiles);assert.equal(await fileHash(join(runner.taskRoot(parent.id),'artifacts','source.zip')),zipBefore);
  const stale=await fixture();stale.evidence.revision=2;db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(stale),stale.id);assert.deepEqual(tasks.resumeSoftwareTask(stale.id).evidence,stale.evidence);assert.equal(tasks.softwareActivity(stale.id,25).events.some(event=>event.phase==='validation_retry'),false);
 `);
});

test('a queued-state SQL failure rolls back the archive, evidence clearing and retry projection together',async()=>{
 await scenario(`
  const task=await fixture(),before=row(task.id),events=history(task.id),priorFiles=await files(task);
  db.exec("CREATE TRIGGER reject_validation_retry_queue BEFORE UPDATE OF body ON software_tasks WHEN NEW.id='"+task.id+"' AND json_extract(NEW.body,'$.phase')='queued' BEGIN SELECT RAISE(ABORT,'queue failure after archive'); END");
  assert.throws(()=>tasks.resumeSoftwareTask(task.id),/queue failure after archive/);assert.equal(row(task.id),before);assert.deepEqual(history(task.id),events);assert.deepEqual(await files(task),priorFiles);
  db.exec('DROP TRIGGER reject_validation_retry_queue');assert.equal(tasks.resumeSoftwareTask(task.id).evidence,undefined);assert.equal(tasks.softwareActivity(task.id,25).events.filter(event=>event.phase==='validation_retry').length,1);
 `);
});

test('archive SQL failures and invalid guidance cannot clear the only saved failure receipt',async()=>{
 await scenario(`
  const task=await fixture(),before=row(task.id),events=history(task.id);
  db.exec("CREATE TRIGGER reject_validation_retry_archive BEFORE INSERT ON activity_entries WHEN NEW.kind='software' AND NEW.stream_id='"+task.id+"' AND json_extract(NEW.event_json,'$.phase')='validation_retry' BEGIN SELECT RAISE(ABORT,'archive failure'); END");
  assert.throws(()=>tasks.resumeSoftwareTask(task.id),/archive failure/);assert.equal(row(task.id),before);assert.deepEqual(history(task.id),events);
  db.exec('DROP TRIGGER reject_validation_retry_archive');assert.throws(()=>tasks.resumeSoftwareTask(task.id,'x'.repeat(4001)),/goal limit/);assert.equal(row(task.id),before);assert.deepEqual(history(task.id),events);
 `);
});
