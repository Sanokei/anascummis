import type {Database} from 'bun:sqlite';
import {ActivityJournal} from './activity-journal';
import {db} from './storage';
import {softwareTask, type SoftwareTask} from './software-task';
import {inspectLaunchEligibility, prepareLaunchPackage} from './app-launch-package';
import {startAppProcess, type OwnedAppProcess} from './app-launch-process';

export type LaunchState='stopped'|'preparing'|'running'|'stopping'|'interrupted'|'failed';
export type LaunchView={taskId:string;lineageId:string;supported:boolean;reason?:string;state:LaunchState;activeTaskId?:string;revision?:number;zipSha256?:string;runtimeId?:string;origin?:string;message:string;updated:number;launchId?:string;processId?:number;startedAt?:number;kind?:'counter'|'collection';title?:string;storageKey?:string};
type LaunchRow=Omit<LaunchView,'taskId'|'supported'|'reason'>&{activeTaskId:string;revision:number;zipSha256:string;port:number;launchId:string;created:number};
type Eligibility={supported:boolean;reason?:string;kind?:'counter'|'collection';title?:string;storageKey?:string;zipSha256?:string;revision?:number};
type Dependencies={task:(id:string)=>SoftwareTask;inspect:(task:SoftwareTask)=>Promise<Eligibility>;prepare:typeof prepareLaunchPackage;startProcess:typeof startAppProcess;reservePort:()=>Promise<number>};
type Active={launchId:string;controller:AbortController;stopRequested:boolean;work?:Promise<void>;child?:OwnedAppProcess};
const activeStates=new Set<LaunchState>(['preparing','running','stopping']);

async function reservePort(){const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(null,{status:503})});const port=server.port!;await server.stop(true);return port;}

/** Launches have their own durable records. Accepted software bodies/artifacts
 * are read-only; no saved PID is ever reattached, signalled or treated as proof. */
export class SoftwareLaunchManager{
 private activity:ActivityJournal;
 private active=new Map<string,Active>();
 private checking=new Set<string>();
 private closing=false;
 constructor(private database:Database,private studioOrigin:string,private deps:Dependencies){
  const origin=new URL(studioOrigin);if(origin.origin!==studioOrigin||origin.hostname!=='127.0.0.1'||origin.protocol!=='http:')throw new Error('App launch requires the ordinary loopback Studio');
  database.exec('CREATE TABLE IF NOT EXISTS software_launches(lineage_id TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL)');this.activity=new ActivityJournal(database);
 }
 private row(id:string):LaunchRow|undefined{const value=this.database.query('SELECT body FROM software_launches WHERE lineage_id=?').get(id) as {body:string}|null;return value?JSON.parse(value.body):undefined;}
 private lineage(task:SoftwareTask){const seen=new Set<string>();let root=task;for(let depth=0;;depth++){if(seen.has(root.id)||depth>30)throw new Error('Software parent links cannot establish a launch lineage');seen.add(root.id);if(!root.parentTaskId)return root;root=this.deps.task(root.parentTaskId);}}
 private save(row:LaunchRow,phase:string,detail:string){
  row={...row,updated:Date.now()};const task=this.deps.task(row.activeTaskId);
  this.database.transaction(()=>{
   this.database.query('INSERT INTO software_launches(lineage_id,body,updated) VALUES(?,?,?) ON CONFLICT(lineage_id) DO UPDATE SET body=excluded.body,updated=excluded.updated').run(row.lineageId,JSON.stringify(row),row.updated);
   this.activity.append('software',task.id,{time:row.updated,role:'app launch',phase,detail,revision:row.revision},task.events.map(event=>({...event,role:'software'})));
  })();return row;
 }
 private patch(lineageId:string,launchId:string,fields:Partial<LaunchRow>,phase:string,detail:string){const row=this.row(lineageId);if(!row||row.launchId!==launchId)return;return this.save({...row,...fields},phase,detail);}
 private async eligibility(task:SoftwareTask):Promise<Eligibility>{try{return await this.deps.inspect(task);}catch(error){return {supported:false,reason:error instanceof Error?error.message:String(error)};}}
 /** Keep live launch controls discoverable when accepted build history grows
  * beyond its normal recent-page limit. This inspection never starts anything. */
 pinnedTaskIds(){const rows=(this.database.query('SELECT body FROM software_launches ORDER BY updated DESC').all() as {body:string}[]).map(item=>JSON.parse(item.body) as LaunchRow);return [...new Set([...rows.filter(row=>activeStates.has(row.state)),...rows.filter(row=>row.state==='interrupted').slice(0,2)].map(row=>row.activeTaskId))];}
 async view(id:string):Promise<LaunchView>{const task=this.deps.task(id),root=this.lineage(task),eligible=await this.eligibility(task),row=this.row(root.id);return {taskId:id,lineageId:root.id,supported:eligible.supported,...(eligible.reason?{reason:eligible.reason}:{}),state:'stopped',message:eligible.supported?'Ready to open this checked app. Start is deliberate; reopening this window does not start it.':eligible.reason||'Use the checked ZIP and manual run instructions for this build.',updated:0,...row,...(!row?{kind:eligible.kind,title:eligible.title,storageKey:eligible.storageKey}:{} )};}
 /** Called once on host startup. Restart records interruption without executing
  * apps or attempting to kill/attach to a persisted process identifier. */
 initialize(){this.closing=false;for(const item of this.database.query('SELECT body FROM software_launches').all() as {body:string}[]){const row=JSON.parse(item.body) as LaunchRow;if(activeStates.has(row.state))this.save({...row,state:'interrupted',processId:undefined,message:'Studio restarted. The previous app session was interrupted. Your browser data is kept; use Start app to continue at the same address.'},'app_interrupted','Host restart interrupted the prior launch. No app was automatically started.');}}
 async start(id:string):Promise<LaunchView>{
  if(this.closing)throw new Error('Studio is stopping. Inspect app status after it restarts.');
  const task=this.deps.task(id),root=this.lineage(task),existing=this.row(root.id);
  if(existing&&activeStates.has(existing.state)){if(existing.activeTaskId===id)return this.view(id);throw new Error('Another version of this app is active. Stop the running version before starting this checked version at its saved address.');}
  if(this.checking.has(root.id))throw new Error('This app request is being checked. Inspect app status before trying again.');
  this.checking.add(root.id);
  try{
   const eligible=await this.eligibility(task);if(!eligible.supported||!eligible.zipSha256||!eligible.kind)throw new Error(eligible.reason||'Only checked trusted counter and collection pages can open here. Use the source ZIP instructions.');
   const original=task.id===root.id?eligible:await this.eligibility(root);
   if(!original.supported||original.kind!==eligible.kind||eligible.kind==='collection'&&original.storageKey!==eligible.storageKey)throw new Error('This version does not have a compatible trusted app lineage. Use its manual source instructions; saved browser data was kept.');
   const old=this.row(root.id),port=old?.port??await this.deps.reservePort();
   if(!Number.isInteger(port)||port<1||port>65535||`http://127.0.0.1:${port}`===this.studioOrigin)throw new Error('A separate app address could not be reserved');
   if(this.closing)throw new Error('Studio is stopping. No app was started.');
   const now=Date.now(),launchId=crypto.randomUUID(),row:LaunchRow={lineageId:root.id,activeTaskId:id,revision:task.revision,zipSha256:eligible.zipSha256,port,origin:`http://127.0.0.1:${port}`,state:'preparing',launchId,created:old?.created??now,updated:now,kind:eligible.kind,title:eligible.title,storageKey:eligible.storageKey,message:'Preparing the exact checked client page with existing matching dependencies. No model or dependency download is needed.'};
   this.database.transaction(()=>{const count=(this.database.query('SELECT body FROM software_launches').all() as {body:string}[]).filter(item=>activeStates.has((JSON.parse(item.body) as LaunchRow).state)).length;if(count>=2)throw new Error('Two apps are already active. Stop one before starting another.');this.save(row,'app_preparing',`Explicit Start accepted for revision ${row.revision}, ZIP ${row.zipSha256}, saved address ${row.origin}.`);})();
   const entry:Active={launchId,controller:new AbortController(),stopRequested:false};this.active.set(root.id,entry);entry.work=Promise.resolve().then(()=>this.run(row,task,entry));
   // Observe cleanup failure immediately without replacing the rejected work
   // promise or losing the owned handle needed by a deliberate Stop retry.
   void entry.work.catch(error=>{try{this.patch(root.id,launchId,{state:'stopping',message:'App cleanup was not confirmed. Check app status and retry Stop; the checked ZIP and saved browser data are kept.'},'app_cleanup_unconfirmed',error instanceof Error?error.message:String(error));}catch{/* Keep the original work/handle available if storage itself is unavailable. */}});
   return this.view(id);
  }finally{this.checking.delete(root.id);}
 }
 private async run(row:LaunchRow,task:SoftwareTask,entry:Active){
  try{
   const prepared=await this.deps.prepare(task,entry.controller.signal);entry.controller.signal.throwIfAborted();
   if(prepared.manifest.taskId!==task.id||prepared.manifest.revision!==row.revision||prepared.manifest.zipSha256!==row.zipSha256)throw new Error('Prepared runtime does not match the accepted source identity');
   this.patch(row.lineageId,entry.launchId,{runtimeId:prepared.manifest.id},'app_runtime_checked','Accepted ZIP and exact trusted page were prepared into a separate, hash-verified browser runtime.');
   const child=await this.deps.startProcess({port:row.port,studioOrigin:this.studioOrigin,...prepared},entry.controller.signal,exit=>{
    if(entry.stopRequested||this.active.get(row.lineageId)!==entry)return;
    this.patch(row.lineageId,entry.launchId,{state:'failed',processId:undefined,message:'The app process exited. Browser data and checked source are kept. Inspect status, then use Start app to retry.'},'app_failed',`Owned app process exited (${exit.code}). No automatic restart occurred.`);this.active.delete(row.lineageId);
   });entry.child=child;
   if(entry.stopRequested||entry.controller.signal.aborted||this.active.get(row.lineageId)!==entry){await child.stop();return;}
   this.patch(row.lineageId,entry.launchId,{state:'running',runtimeId:child.runtimeId,processId:child.pid,startedAt:child.startedAt,message:'App is running. Closing this window leaves it running; Stop app ends this session and keeps browser data.'},'app_running',`Owned process ${child.pid} confirmed its bind and runtime ${child.runtimeId} at ${child.origin}.`);
  }catch(error){
   if(entry.child)await entry.child.stop();
   if(!entry.stopRequested){const detail=error instanceof Error?error.message:String(error);this.patch(row.lineageId,entry.launchId,{state:'failed',processId:undefined,message:detail+'. Your checked ZIP and browser data were kept. No automatic retry occurred.'},'app_failed',detail);if(this.active.get(row.lineageId)===entry)this.active.delete(row.lineageId);}
  }
 }
 async stop(id:string):Promise<LaunchView>{const task=this.deps.task(id),root=this.lineage(task),row=this.row(root.id);if(!row||!activeStates.has(row.state))return this.view(id);const entry=this.active.get(root.id);
  if(!entry){this.save({...row,state:'interrupted',processId:undefined,message:'There is no owned live process in this Studio session. Inspect the saved address before explicitly starting again.'},'app_interrupted','No live owned handle exists; no persisted PID was signalled.');return this.view(id);}
  entry.stopRequested=true;entry.controller.abort(new Error('Stopped by you'));
  this.patch(root.id,entry.launchId,{state:'stopping',message:'Stopping the owned app session. Browser data and accepted source are kept.'},'app_stopping','Explicit Stop requested; waiting for owned process exit.');
  let workError:unknown;try{await entry.work;}catch(error){workError=error;}
  // An earlier preparation/start cleanup failure must not bypass a later
  // deliberate retry of the live owned handle. Stop is confirmed only by exit.
  if(entry.child){await entry.child.stop();await entry.child.exited;}else if(workError)throw workError;
  this.patch(root.id,entry.launchId,{state:'stopped',processId:undefined,message:'App stopped. Its browser data is kept at the same address. Start app deliberately to continue.'},'app_stopped','Owned process exit confirmed. No app or model was regenerated.');if(this.active.get(root.id)===entry)this.active.delete(root.id);return this.view(id);
 }
 async shutdown(){this.closing=true;const results=await Promise.allSettled([...this.active.keys()].map(async id=>{const row=this.row(id);if(row)await this.stop(row.activeTaskId);}));if(results.some(result=>result.status==='rejected'))throw new Error('One or more owned app stops were not confirmed. Their records remain available for inspection.');}
}

export const softwareLaunches=new SoftwareLaunchManager(db,`http://127.0.0.1:${Number(process.env.STUDIO_PORT||3211)}`,{task:softwareTask,inspect:inspectLaunchEligibility,prepare:prepareLaunchPackage,startProcess:startAppProcess,reservePort});
