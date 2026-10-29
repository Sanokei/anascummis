
import {strict as assert} from 'node:assert';
import {Database} from 'bun:sqlite';
import {SoftwareLaunchManager} from "/workspace/anascummis/apps/studio/core/software-launch.ts";
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
const h=harness(),task=h.fixture();
h.database.exec("CREATE TRIGGER reject_running BEFORE UPDATE OF body ON software_launches WHEN json_extract(NEW.body,'$.state')='running' BEGIN SELECT RAISE(ABORT,'synthetic running publication failed'); END");
h.setStart(async(options,signal,onExit)=>{const child=h.fakeProcess(options,onExit);child.stop=async()=>{throw new Error('synthetic owned cleanup failed');};return child;});
await h.manager.start(task.id);
await new Promise(resolve=>setTimeout(resolve,50));
console.log('Host remained available for explicit Stop recovery');
