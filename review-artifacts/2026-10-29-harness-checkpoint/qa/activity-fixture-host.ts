// Isolated host/API pagination fixture. No model or worker execution is claimed.
import {strict as assert} from 'node:assert';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {Database} from 'bun:sqlite';
import {handle} from '/workspace/anascummis/apps/studio/core/server';
import {db,DATA,createProject} from '/workspace/anascummis/apps/studio/core/storage';
import {WorkJournal} from '/workspace/anascummis/apps/studio/core/work-journal';

const base='http://127.0.0.1:3211',marker=join(DATA,'activity-fixture-ids.json');
const shell=await handle(new Request(base+'/',{headers:{Host:'127.0.0.1:3211'}}));assert(shell.ok);const session=shell.headers.get('set-cookie')?.split(';')[0];assert(session);
async function post(path:string,body:unknown={}){
 const response=await handle(new Request(base+path,{method:'POST',headers:{Host:'127.0.0.1:3211',Cookie:session,Origin:base,'Content-Type':'application/json','X-Requested-With':'Anascummis'},body:JSON.stringify(body)}));
 const value=await response.json();assert(response.ok,JSON.stringify({path,status:response.status,value}));return value;
}
let ids:any;
if(await Bun.file(marker).exists())ids=await Bun.file(marker).json();
else{
 const accepted=JSON.parse(await readFile('/workspace/.cloud-env/anascummis/security-upgrade/repair-parent.json','utf8'));
 const parentDb=new Database(join(accepted.data,'studio.sqlite'),{readonly:true});
 const row=parentDb.query('SELECT body,updated FROM software_tasks WHERE id=?').get(accepted.parentId) as {body:string;updated:number};assert(row);parentDb.close();
 const parentRoot=join(DATA,'software',accepted.parentId);await mkdir(parentRoot,{recursive:true});
 await cp(accepted.root,parentRoot,{recursive:true,filter:(source)=>!relative(accepted.root,source).split(/[\\/]/).some(part=>['node_modules','.next','.git','.qa'].includes(part))});
 await mkdir(join(parentRoot,'.qa'),{recursive:true});
 const parent=JSON.parse(row.body);
 for(const name of ['browser-contract.json',parent.evidence.screenshot])if(name)await cp(join(accepted.root,'.qa',name),join(parentRoot,'.qa',name));
 db.query('INSERT INTO software_tasks(id,body,updated) VALUES(?,?,?)').run(accepted.parentId,row.body,row.updated);
 const project=createProject('Activity retention fixture');
 const goal=await post('/api/goals',{project:project.id,request:'Fixture: retain the full history of repeated goal continuation and Stop controls. No model work is performed in this history fixture.'});
 for(let index=0;index<90;index++){await post('/api/goals/'+goal.id+'/stop');await post('/api/goals/'+goal.id+'/resume',{note:'Fixture continuation round '+(index+1)});}
 await post('/api/goals/'+goal.id+'/stop');
 const work=new WorkJournal(db),workId=crypto.randomUUID();
 work.create({id:workId,projectId:project.id,request:'Fixture: 180 host progress samples for retention and pagination. These samples are not executed specialist work.'});
 for(let index=0;index<180;index++)work.progress(workId,{phase:'fixture-sample-'+String(index).padStart(3,'0'),agent:'fixture-recorder'});
 work.fail(workId,'interrupted','Fixture sampling ended. No specialist edits were performed.');
 const child=await post('/api/software/'+accepted.parentId+'/revise',{note:'Fixture history sampling: preserve this accepted counter while testing Stop and Resume controls. No builder is executing in this host.'});
 for(let index=0;index<90;index++){await post('/api/software/'+child.id+'/stop');await post('/api/software/'+child.id+'/resume',{note:''});}
 await post('/api/software/'+child.id+'/stop');
 ids={projectId:project.id,goalId:goal.id,workId,softwareId:child.id,parentId:accepted.parentId,fixture:'Actual host API state controls and journal persistence; workers deliberately not started, no model/execution claim.'};
 await writeFile(marker,JSON.stringify(ids,null,2));
}
const server=Bun.serve({hostname:'127.0.0.1',port:3211,idleTimeout:255,async fetch(request){
 const path=new URL(request.url).pathname;
 if(path==='/fixture/ready')return Response.json({run:process.env.FIXTURE_RUN_ID,...ids});
 if(path==='/fixture/append'&&request.method==='POST'){
   await post('/api/goals/'+ids.goalId+'/resume',{note:'Fixture appended activity after pagination began.'});await post('/api/goals/'+ids.goalId+'/stop');
   await post('/api/software/'+ids.softwareId+'/resume',{note:''});await post('/api/software/'+ids.softwareId+'/stop');
   return Response.json({appended:true});
 }
 return handle(request);
}});
console.log('Isolated activity fixture ready; workers are not started.');
const close=()=>{void server.stop(true);db.close();process.exit(0);};process.on('SIGTERM',close);process.on('SIGINT',close);
