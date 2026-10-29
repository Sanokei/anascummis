import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const studio=resolve(import.meta.dir,'..');
// State-machine tests use injected fake packages/process handles. Real process,
// IPC, browser-boundary and accepted-ZIP proofs belong to their separate suites.
const setup=`
import {strict as assert} from 'node:assert';
import {Database} from 'bun:sqlite';
import {SoftwareLaunchManager} from ${JSON.stringify(join(studio,'core/software-launch.ts'))};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check,label='state change'){for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,1));}throw new Error('Timed out: '+label);}
function harness(){
 const database=new Database(':memory:');
 const tasks=new Map(),metadata=new Map(),processes=[],calls={prepare:0,start:0,reserve:0,stop:0};
 let prepareHook,startHook,port=48100,pid=900000;
 function fixture(kind='collection',parent,changes={}){
  const id=crypto.randomUUID(),now=Date.now(),task={id,goal:'Synthetic state-machine fixture; no native inference or real app execution is claimed.',status:'completed',phase:'completed',revision:1,requirements:[],events:[],created:now,updated:now,calls:7,errors:0,message:'Accepted test fixture',milestoneMs:[],milestoneStarted:now,planOffset:0,planningDone:true,targets:['zip'],...(parent?{parentTaskId:parent.id}:{}),...changes};
  tasks.set(id,structuredClone(task));metadata.set(id,{supported:true,kind,title:'Fixture '+id,storageKey:kind==='collection'?(parent?metadata.get(parent.id).storageKey:'items:'+id):undefined,zipSha256:id.replaceAll('-','').padEnd(64,'0'),revision:task.revision});return task;
 }
 function prepared(task){const info=metadata.get(task.id);return {root:'/synthetic/state-machine-package/'+task.id,manifest:{format:'anascummis.trusted-browser-runtime.v1',id:'runtime:'+task.id,taskId:task.id,revision:task.revision,zipSha256:info.zipSha256,kind:info.kind,title:info.title,storageKey:info.storageKey,wrapperVersion:1,reactVersion:'synthetic',sourceFiles:[],files:[]}};}
 function fakeProcess(options,onExit){
  const ended=deferred();let stopping;
  const record={pid:++pid,port:options.port,origin:'http://127.0.0.1:'+options.port,runtimeId:options.manifest.id,manifestSha256:'synthetic',startedAt:Date.now(),exited:ended.promise,boundary:{requests:0,credentialRequests:0,sanitizedCredentialRequests:0,responseCookieHeaders:0,rejectedRequests:0},closed:false,onExit,stopGate:undefined,
   stop(){if(stopping)return stopping;calls.stop++;stopping=(async()=>{if(record.stopGate)await record.stopGate.promise;record.closed=true;ended.resolve(0);onExit?.({pid:record.pid,code:0,expected:true,detail:'Synthetic owned stop'});})();return stopping;},
   crash(){record.closed=true;ended.resolve(17);onExit?.({pid:record.pid,code:17,expected:false,detail:'Synthetic unexpected exit'});}
  };processes.push(record);return record;
 }
 const deps={
  task(id){const value=tasks.get(id);if(!value)throw new Error('Software task not found');return structuredClone(value);},
  async inspect(task){return structuredClone(metadata.get(task.id));},
  async prepare(task,signal){calls.prepare++;if(prepareHook)return prepareHook(task,signal);return prepared(task);},
  async startProcess(options,signal,onExit){calls.start++;if(startHook)return startHook(options,signal,onExit);return fakeProcess(options,onExit);},
  async reservePort(){calls.reserve++;return ++port;}
 };
 const manager=new SoftwareLaunchManager(database,'http://127.0.0.1:3211',deps);
 const row=id=>{const r=database.query('SELECT body FROM software_launches WHERE lineage_id=?').get(id);return r?JSON.parse(r.body):undefined;};
 const events=id=>database.query('SELECT event_json FROM activity_entries WHERE kind=? AND stream_id=? ORDER BY sequence').all('software',id).map(x=>JSON.parse(x.event_json));
 return {database,tasks,metadata,processes,calls,deps,manager,fixture,prepared,fakeProcess,row,events,setPrepare(fn){prepareHook=fn;},setStart(fn){startHook=fn;}};
}
`;

async function scenario(source:string){
 const folder=await mkdtemp(join(tmpdir(),'software-launch-state-'));
 try{
  const child=Bun.spawn([process.execPath,'-e',setup+'\n'+source+'\nconsole.log("software launch state scenario passed");'],{cwd:studio,env:{...process.env,STUDIO_DATA:folder,STUDIO_TEST_DATA:folder},stdout:'pipe',stderr:'pipe'});
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(code,stderr||stdout).toBe(0);expect(stderr).toBe('');expect(stdout.trim()).toBe('software launch state scenario passed');
 }finally{await rm(folder,{recursive:true,force:true});}
}

test('explicit Start persists preparation; reads and repeated Start never duplicate work, and Stop waits for preparation',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture(),before=JSON.stringify(h.tasks.get(task.id)),gate=deferred();
  h.setPrepare(async(task,signal)=>{await gate.promise;return h.prepared(task);});
  const started=await h.manager.start(task.id);assert.equal(started.state,'preparing');assert.equal(started.activeTaskId,task.id);assert.equal(started.revision,1);assert.equal(started.zipSha256,h.metadata.get(task.id).zipSha256);
  const address=started.origin;assert(address);assert.notEqual(address,'http://127.0.0.1:3211');
  for(let i=0;i<4;i++){assert.equal((await h.manager.view(task.id)).launchId,started.launchId);assert.equal((await h.manager.start(task.id)).launchId,started.launchId);}
  assert.equal(h.calls.prepare,1);assert.equal(h.calls.start,0);assert.equal(h.calls.reserve,1);
  let stopped=false;const stopping=h.manager.stop(task.id).then(value=>{stopped=true;return value;});await until(()=>h.row(task.id).state==='stopping');assert.equal(stopped,false);
  gate.resolve();const ended=await stopping;assert.equal(ended.state,'stopped');assert.equal(ended.origin,address);assert.equal(h.calls.start,0);assert.equal(h.calls.stop,0);assert.equal(JSON.stringify(h.tasks.get(task.id)),before);
  assert.deepEqual(h.events(task.id).map(x=>x.phase),['app_preparing','app_stopping','app_stopped']);
 `);
});

test('running identity survives GET/reopen; Stop awaits owned exit and explicit restart retains its exact origin',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture();await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');
  const running=await h.manager.view(task.id),process=h.processes[0];assert.equal(running.processId,process.pid);assert.equal(running.startedAt,process.startedAt);assert.equal(running.runtimeId,process.runtimeId);assert.equal(running.kind,'collection');
  for(let i=0;i<5;i++)assert.equal((await h.manager.view(task.id)).launchId,running.launchId);assert.equal(h.calls.prepare,1);assert.equal(h.calls.start,1);
  process.stopGate=deferred();let stopped=false;const pending=h.manager.stop(task.id).then(value=>{stopped=true;return value;});await until(()=>h.row(task.id).state==='stopping');assert.equal(stopped,false);assert.equal(process.closed,false);
  process.stopGate.resolve();const result=await pending;assert.equal(result.state,'stopped');assert.equal(result.processId,undefined);assert.equal(process.closed,true);assert.equal(result.origin,running.origin);
  await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');const restarted=await h.manager.view(task.id);assert.equal(restarted.origin,running.origin);assert.notEqual(restarted.launchId,running.launchId);assert.notEqual(restarted.processId,running.processId);assert.equal(h.calls.reserve,1);assert.equal(h.calls.prepare,2);assert.equal(h.calls.start,2);await h.manager.shutdown();
 `);
});

test('Stop during an unconfirmed process startup closes the late owned handle without publishing Running',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture(),startup=deferred();h.setStart(async(options,signal,onExit)=>{await startup.promise;return h.fakeProcess(options,onExit);});
  await h.manager.start(task.id);await until(()=>h.calls.start===1);let stopped=false;const pending=h.manager.stop(task.id).then(value=>{stopped=true;return value;});await until(()=>h.row(task.id).state==='stopping');assert.equal(stopped,false);
  startup.resolve();const result=await pending;assert.equal(result.state,'stopped');assert.equal(h.processes.length,1);assert.equal(h.processes[0].closed,true);assert.equal(h.calls.stop,1);assert.equal(h.events(task.id).some(x=>x.phase==='app_running'),false);
 `);
});

test('compatible child launch requires explicit parent Stop, reuses lineage address/storage identity and never rewrites accepted records',async()=>{
 await scenario(`
  const h=harness(),parent=h.fixture(),child=h.fixture('collection',parent,{revision:2}),before=JSON.stringify([...h.tasks]);
  await h.manager.start(parent.id);await until(()=>h.row(parent.id).state==='running');const prior=await h.manager.view(parent.id);
  const selected=await h.manager.view(child.id);assert.equal(selected.taskId,child.id);assert.equal(selected.lineageId,parent.id);assert.equal(selected.activeTaskId,parent.id);assert.equal(selected.origin,prior.origin);
  await assert.rejects(()=>h.manager.start(child.id),/Stop the running version/);assert.equal(h.calls.prepare,1);assert.equal(h.calls.start,1);
  await h.manager.stop(child.id);assert.equal(h.processes[0].closed,true);await h.manager.start(child.id);await until(()=>h.row(parent.id).state==='running');
  const current=await h.manager.view(child.id);assert.equal(current.activeTaskId,child.id);assert.equal(current.revision,2);assert.equal(current.origin,prior.origin);assert.equal(current.storageKey,prior.storageKey);assert.equal(current.zipSha256,h.metadata.get(child.id).zipSha256);assert.equal(h.calls.reserve,1);assert.equal(JSON.stringify([...h.tasks]),before);
  assert(h.events(parent.id).some(x=>x.phase==='app_stopped'));assert(h.events(child.id).some(x=>x.phase==='app_running'));assert.equal(JSON.stringify([...h.tasks]),before);await h.manager.shutdown();
 `);
});

test('incompatible/unsupported lineages and the third active app fail before spawning, while accepted records remain intact',async()=>{
 await scenario(`
  const h=harness(),parent=h.fixture(),otherKind=h.fixture('counter',parent),otherKey=h.fixture('collection',parent),unsupported=h.fixture('collection');h.metadata.get(otherKey.id).storageKey='different-key';h.metadata.set(unsupported.id,{supported:false,reason:'No matching installed dependency. Use manual instructions.'});
  for(const task of [otherKind,otherKey])await assert.rejects(()=>h.manager.start(task.id),/compatible trusted app lineage/);await assert.rejects(()=>h.manager.start(unsupported.id),/manual instructions/);assert.equal(h.calls.prepare,0);assert.equal(h.calls.start,0);assert.equal(h.database.query('SELECT COUNT(*) AS n FROM software_launches').get().n,0);
  const a=h.fixture('counter'),b=h.fixture('counter'),c=h.fixture('counter');await h.manager.start(a.id);await h.manager.start(b.id);await until(()=>h.row(a.id).state==='running'&&h.row(b.id).state==='running');await assert.rejects(()=>h.manager.start(c.id),/Two apps are already active/);assert.equal(h.calls.prepare,2);assert.equal(h.calls.start,2);assert.equal(h.row(c.id),undefined);await h.manager.shutdown();
 `);
});

test('launch-row and activity SQL failures roll back together before any package or process starts',async()=>{
 await scenario(`
  for(const table of ['software_launches','activity_entries']){
   const h=harness(),task=h.fixture(),before=JSON.stringify([...h.tasks]);h.database.exec('CREATE TRIGGER reject_launch BEFORE INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'launch transaction rejected'); END");
   await assert.rejects(()=>h.manager.start(task.id),/launch transaction rejected/);assert.equal(h.database.query('SELECT COUNT(*) AS n FROM software_launches').get().n,0);assert.equal(h.database.query('SELECT COUNT(*) AS n FROM activity_entries').get().n,0);assert.equal(h.database.query('SELECT COUNT(*) AS n FROM activity_streams').get().n,0);assert.equal(h.calls.prepare,0);assert.equal(h.calls.start,0);assert.equal(JSON.stringify([...h.tasks]),before);
   h.database.exec('DROP TRIGGER reject_launch');await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');await h.manager.shutdown();
  }
 `);
});

test('startup reconciliation records interruption without starting or killing a persisted PID; explicit continuation retains the origin',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture();await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');const old=await h.manager.view(task.id),counts={...h.calls};
  const reopened=new SoftwareLaunchManager(h.database,'http://127.0.0.1:3211',h.deps);reopened.initialize();const inspected=await reopened.view(task.id);assert.equal(inspected.state,'interrupted');assert.equal(inspected.origin,old.origin);assert.equal(inspected.processId,undefined);assert.deepEqual(h.calls,counts);assert.equal(h.processes[0].closed,false);assert(h.events(task.id).some(x=>x.phase==='app_interrupted'));
  // The old handle is a fake owned by the simulated dead manager, not an OS PID.
  // Reconciliation must neither reattach it nor signal anything from storage.
  await reopened.start(task.id);await until(()=>h.row(task.id).state==='running');assert.equal((await reopened.view(task.id)).origin,old.origin);assert.equal(h.calls.reserve,1);assert.equal(h.calls.start,2);await reopened.shutdown();
 `);
});

test('stale exit callbacks cannot overwrite a new launch, and a live crash stays failed until explicit Start',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture();await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');const original=h.processes[0],oldLaunch=h.row(task.id).launchId;await h.manager.stop(task.id);await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');const current=h.row(task.id);assert.notEqual(current.launchId,oldLaunch);
  original.onExit({pid:original.pid,code:91,expected:false,detail:'Late callback from old generation'});assert.equal(h.row(task.id).state,'running');assert.equal(h.row(task.id).launchId,current.launchId);assert.equal(h.row(task.id).processId,h.processes[1].pid);
  h.processes[1].crash();assert.equal(h.row(task.id).state,'failed');assert.equal(h.row(task.id).processId,undefined);for(let i=0;i<4;i++)assert.equal((await h.manager.view(task.id)).state,'failed');assert.equal(h.calls.start,2);assert.equal(h.calls.prepare,2);assert.match(h.row(task.id).message,/use Start app to retry/);
  await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');assert.equal(h.calls.start,3);assert.equal(h.calls.reserve,1);await h.manager.shutdown();
 `);
});

test('package tamper and occupied-address failures keep the saved origin and source identity without a fallback start',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture(),before=JSON.stringify([...h.tasks]);h.setPrepare(async()=>{throw new Error('Runtime checksum changed');});await h.manager.start(task.id);await until(()=>h.row(task.id).state==='failed');const failed=await h.manager.view(task.id);assert.match(failed.message,/Runtime checksum changed/);assert.match(failed.message,/checked ZIP and browser data were kept/);assert.equal(h.calls.start,0);
  h.setPrepare(undefined);h.setStart(async()=>{throw new Error('Saved address is occupied by an unrelated listener');});await h.manager.start(task.id);await until(()=>h.row(task.id).state==='failed');const occupied=await h.manager.view(task.id);assert.equal(occupied.origin,failed.origin);assert.equal(occupied.zipSha256,failed.zipSha256);assert.equal(h.calls.reserve,1);assert.equal(h.calls.start,1);assert.match(occupied.message,/unrelated listener/);assert.equal(h.processes.length,0);assert.equal(JSON.stringify([...h.tasks]),before);
  h.setStart(undefined);await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');assert.equal((await h.manager.view(task.id)).origin,failed.origin);assert.equal(h.calls.reserve,1);await h.manager.shutdown();
 `);
});

test('shutdown waits for owned cleanup, blocks new starts, and does not resume a request still undergoing eligibility checks',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture();await h.manager.start(task.id);await until(()=>h.row(task.id).state==='running');h.processes[0].stopGate=deferred();let done=false;const shutdown=h.manager.shutdown().then(()=>{done=true;});await until(()=>h.row(task.id).state==='stopping');assert.equal(done,false);await assert.rejects(()=>h.manager.start(task.id),/Studio is stopping/);h.processes[0].stopGate.resolve();await shutdown;assert.equal(h.row(task.id).state,'stopped');assert.equal(h.processes[0].closed,true);
  const pending=harness(),other=pending.fixture(),checking=deferred();pending.deps.inspect=async()=>{await checking.promise;return pending.metadata.get(other.id);};const request=pending.manager.start(other.id);await Promise.resolve();await pending.manager.shutdown();checking.resolve();await assert.rejects(()=>request,/Studio is stopping/);assert.equal(pending.calls.prepare,0);assert.equal(pending.calls.start,0);assert.equal(pending.row(other.id),undefined);
 `);
});

test('explicit Stop retries failed prior cleanup and never records Stopped before the owned exit is confirmed',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture(),before=JSON.stringify([...h.tasks]),startup=deferred(),exit=deferred();let attempts=0,owned;
  h.setStart(async(options,signal,onExit)=>{
   await startup.promise;owned=h.fakeProcess(options,onExit);owned.exited=exit.promise;
   owned.stop=()=>{attempts++;return attempts<=3?Promise.reject(new Error('Synthetic cleanup attempt '+attempts+' was not confirmed')):Promise.resolve();};return owned;
  });
  await h.manager.start(task.id);await until(()=>h.calls.start===1);const origin=h.row(task.id).origin;
  // The first deliberate Stop is already awaiting startup, so its handler also
  // observes the rejected preparation/start cleanup work instead of suppressing it.
  const first=h.manager.stop(task.id).then(()=>undefined,error=>error);await until(()=>h.row(task.id).state==='stopping');startup.resolve();const rejected=await first;
  assert.match(rejected.message,/cleanup attempt 3/);assert.equal(attempts,3);assert.equal(owned.closed,false);assert.equal(h.row(task.id).state,'stopping');assert.equal(h.events(task.id).some(x=>x.phase==='app_stopped'),false);
  let finished=false;const retry=h.manager.stop(task.id).then(value=>{finished=true;return value;});await until(()=>attempts===4);await new Promise(resolve=>setTimeout(resolve,2));
  // Even a successfully returned stop() call is not an exit receipt.
  assert.equal(finished,false);assert.equal(h.row(task.id).state,'stopping');assert.equal(h.events(task.id).some(x=>x.phase==='app_stopped'),false);assert.equal(h.calls.start,1);assert.equal(h.calls.prepare,1);
  owned.closed=true;owned.onExit({pid:owned.pid,code:0,expected:true,detail:'Synthetic owned exit finally confirmed'});exit.resolve(0);
  const stopped=await retry;assert.equal(stopped.state,'stopped');assert.equal(stopped.origin,origin);assert.equal(stopped.processId,undefined);assert.equal(h.events(task.id).filter(x=>x.phase==='app_stopped').length,1);assert.equal(h.events(task.id).some(x=>x.phase==='app_running'),false);assert.equal(JSON.stringify([...h.tasks]),before);
 `);
});

test('shutdown waits for every owned Stop even when one rejects, retaining failed cleanup for explicit retry',async()=>{
 await scenario(`
  const h=harness(),a=h.fixture(),b=h.fixture(),before=JSON.stringify([...h.tasks]);await h.manager.start(a.id);await h.manager.start(b.id);await until(()=>h.row(a.id).state==='running'&&h.row(b.id).state==='running');
  const first=h.processes[0],second=h.processes[1],retryableStop=first.stop;let rejectedStops=0;first.stop=async()=>{rejectedStops++;throw new Error('Synthetic first owned stop failed');};second.stopGate=deferred();
  let settled=false;const ending=h.manager.shutdown().then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});await until(()=>rejectedStops===1&&h.row(b.id).state==='stopping');await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(settled,false);assert.equal(first.closed,false);assert.equal(second.closed,false);assert.equal(h.row(a.id).state,'stopping');assert.equal(h.row(b.id).state,'stopping');assert.equal(h.events(a.id).some(x=>x.phase==='app_stopped'),false);assert.equal(h.events(b.id).some(x=>x.phase==='app_stopped'),false);
  second.stopGate.resolve();const result=await ending;assert.match(result.error.message,/One or more owned app stops were not confirmed/);assert.equal(second.closed,true);assert.equal(h.row(b.id).state,'stopped');assert.equal(first.closed,false);assert.equal(h.row(a.id).state,'stopping');assert.equal(JSON.stringify([...h.tasks]),before);
  first.stop=retryableStop;const retried=await h.manager.stop(a.id);assert.equal(retried.state,'stopped');assert.equal(first.closed,true);assert.equal(h.events(a.id).filter(x=>x.phase==='app_stopped').length,1);await assert.rejects(()=>h.manager.start(a.id),/Studio is stopping/);assert.equal(JSON.stringify([...h.tasks]),before);
 `);
});

test('a cleanup rejection without an attached Stop is observed and retains the owned handle for later confirmed Stop',async()=>{
 await scenario(`
  const h=harness(),task=h.fixture(),before=JSON.stringify([...h.tasks]),exit=deferred(),unhandled=[];let attempts=0,owned;
  const observe=error=>unhandled.push(String(error));process.on('unhandledRejection',observe);
  h.database.exec("CREATE TRIGGER reject_running BEFORE UPDATE OF body ON software_launches WHEN json_extract(NEW.body,'$.state')='running' BEGIN SELECT RAISE(ABORT,'synthetic running publication failed'); END");
  h.setStart(async(options,signal,onExit)=>{
   owned=h.fakeProcess(options,onExit);owned.exited=exit.promise;
   owned.stop=()=>{attempts++;return attempts===1?Promise.reject(new Error('Synthetic initial owned cleanup failed')):Promise.resolve();};return owned;
  });
  await h.manager.start(task.id);await until(()=>attempts===1);await new Promise(resolve=>setTimeout(resolve,5));
  // No Stop promise has observed startup work yet. The manager itself must
  // observe its rejected work while retaining the original promise and handle.
  assert.deepEqual(unhandled,[]);const inspected=await h.manager.view(task.id);assert.equal(inspected.state,'stopping');assert.match(inspected.message,/cleanup was not confirmed/);assert.equal(owned.closed,false);assert.equal(h.events(task.id).some(x=>x.phase==='app_running'||x.phase==='app_stopped'),false);
  const retained=h.events(task.id).find(x=>x.phase==='app_cleanup_unconfirmed');assert(retained);assert.match(retained.detail,/Synthetic initial owned cleanup failed/);
  let stopped=false;const retry=h.manager.stop(task.id).then(value=>{stopped=true;return value;});await until(()=>attempts===2);await new Promise(resolve=>setTimeout(resolve,2));assert.equal(stopped,false);assert.equal(h.row(task.id).state,'stopping');assert.equal(h.calls.prepare,1);assert.equal(h.calls.start,1);
  owned.closed=true;owned.onExit({pid:owned.pid,code:0,expected:true,detail:'Synthetic late owned exit confirmed'});exit.resolve(0);const result=await retry;
  assert.equal(result.state,'stopped');assert.equal(result.origin,inspected.origin);assert.equal(h.events(task.id).filter(x=>x.phase==='app_stopped').length,1);assert.equal(JSON.stringify([...h.tasks]),before);assert.deepEqual(unhandled,[]);process.off('unhandledRejection',observe);
 `);
});

test('old active apps stay pinned beyond twenty builds through Stop and restart recovery without automatic execution',async()=>{
 await scenario(`
  const {listedSoftwareTasks}=await import(${JSON.stringify(join(studio,'core/software-api.ts'))});
  const h=harness(),parent=h.fixture(),child=h.fixture('collection',parent),accepted=JSON.stringify([h.tasks.get(parent.id),h.tasks.get(child.id)]);
  for(let i=0;i<30;i++)h.fixture('counter');const recent=[...h.tasks.values()].slice(-20).reverse();assert.equal(recent.length,20);assert.equal(recent.some(task=>task.id===child.id),false);
  const preparing=deferred();h.setPrepare(async(task,signal)=>{await preparing.promise;return h.prepared(task);});await h.manager.start(child.id);assert.equal(h.row(parent.id).state,'preparing');
  const rowsBefore=h.database.query('SELECT * FROM software_launches ORDER BY lineage_id').all(),historyBefore=h.events(child.id),countsBefore={...h.calls};
  for(let i=0;i<4;i++)assert.deepEqual(h.manager.pinnedTaskIds(),[child.id]);assert.deepEqual(h.database.query('SELECT * FROM software_launches ORDER BY lineage_id').all(),rowsBefore);assert.deepEqual(h.events(child.id),historyBefore);assert.deepEqual(h.calls,countsBefore);
  const listed=listedSoftwareTasks(recent,h.manager.pinnedTaskIds(),h.deps.task);assert.deepEqual(listed.slice(0,20),recent);assert.equal(listed[20].id,child.id);assert.equal(listed.length,21);
  const stopping=h.manager.stop(child.id);await until(()=>h.row(parent.id).state==='stopping');assert.deepEqual(h.manager.pinnedTaskIds(),[child.id]);preparing.resolve();await stopping;assert.deepEqual(h.manager.pinnedTaskIds(),[]);
  h.setPrepare(undefined);await h.manager.start(child.id);await until(()=>h.row(parent.id).state==='running');assert.deepEqual(h.manager.pinnedTaskIds(),[child.id]);
  let current=h.manager;
  const reopen=async()=>{const before={...h.calls};await new Promise(resolve=>setTimeout(resolve,2));const next=new SoftwareLaunchManager(h.database,'http://127.0.0.1:3211',h.deps);next.initialize();assert.deepEqual(h.calls,before);current=next;return next;};
  await reopen();assert.equal(h.row(parent.id).state,'interrupted');assert.deepEqual(current.pinnedTaskIds(),[child.id]);assert.equal(h.processes[0].closed,false);
  const second=h.fixture('counter');await current.start(second.id);await until(()=>h.row(second.id).state==='running');await reopen();
  const third=h.fixture('counter');await current.start(third.id);await until(()=>h.row(third.id).state==='running');await reopen();assert.deepEqual(current.pinnedTaskIds(),[third.id,second.id]);assert.equal(current.pinnedTaskIds().includes(child.id),false);
  const active=h.fixture('counter'),lastGate=deferred();h.setPrepare(async(task,signal)=>{await lastGate.promise;return h.prepared(task);});await current.start(active.id);assert.deepEqual(current.pinnedTaskIds(),[active.id,third.id,second.id]);
  const lastStop=current.stop(active.id);await until(()=>h.row(active.id).state==='stopping');assert.deepEqual(current.pinnedTaskIds(),[active.id,third.id,second.id]);lastGate.resolve();await lastStop;assert.deepEqual(current.pinnedTaskIds(),[third.id,second.id]);assert.equal(JSON.stringify([h.tasks.get(parent.id),h.tasks.get(child.id)]),accepted);
  // Reopened fake managers model host loss only; no real persisted PID or OS
  // process is attached/killed by any pin/reconciliation read in this scenario.
 `);
});

test('merging pinned builds preserves recent order and object identity, reads only missing IDs and never mutates inputs',async()=>{
 await scenario(`
  const {listedSoftwareTasks}=await import(${JSON.stringify(join(studio,'core/software-api.ts'))});
  const h=harness(),oldActive=Object.freeze(h.fixture('collection')),oldInterrupted=Object.freeze(h.fixture('counter')),recent=Object.freeze(Array.from({length:20},()=>Object.freeze(h.fixture('counter'))).reverse());
  const pinned=Object.freeze([recent[7].id,oldActive.id,oldActive.id,recent[0].id,oldInterrupted.id,oldActive.id,oldInterrupted.id]),beforeRecent=JSON.stringify(recent),beforePins=JSON.stringify(pinned),beforeOld=JSON.stringify([oldActive,oldInterrupted]),reads=[];
  const old=new Map([[oldActive.id,oldActive],[oldInterrupted.id,oldInterrupted]]);const merged=listedSoftwareTasks(recent,pinned,id=>{reads.push(id);assert(old.has(id),'Recent tasks must never be reread');return old.get(id);});
  assert.notEqual(merged,recent);assert.equal(merged.length,22);for(let i=0;i<recent.length;i++)assert.equal(merged[i],recent[i]);assert.equal(merged[20],oldActive);assert.equal(merged[21],oldInterrupted);assert.deepEqual(reads,[oldActive.id,oldInterrupted.id]);assert.equal(new Set(merged.map(task=>task.id)).size,merged.length);
  assert.equal(JSON.stringify(recent),beforeRecent);assert.equal(JSON.stringify(pinned),beforePins);assert.equal(JSON.stringify([oldActive,oldInterrupted]),beforeOld);
  const unchanged=listedSoftwareTasks(recent,[recent[2].id,recent[2].id],()=>{throw new Error('Unexpected reread of a recent task');});assert.notEqual(unchanged,recent);assert.equal(unchanged.length,20);for(let i=0;i<recent.length;i++)assert.equal(unchanged[i],recent[i]);
 `);
});
