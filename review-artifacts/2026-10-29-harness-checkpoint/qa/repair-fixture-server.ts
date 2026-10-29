import {handle} from '/workspace/anascummis/apps/studio/core/server';
import {startSoftwareWorker,shutdownSoftwareWorker} from '/workspace/anascummis/apps/studio/core/software-task';
import type {Infer} from '/workspace/anascummis/apps/studio/core/model';

let blocked=false,pageEdited=false,testEdited=false;
const hold=process.env.REPAIR_HOLD==='1';
const generate:Infer=async(system,raw,schema,signal)=>{
  signal.throwIfAborted();
  const packet=JSON.parse(raw);
  console.log('inference role',system.split('. ')[0]);
  if(system.startsWith('Revision acceptance planner')){
    if(hold&&packet.criterion.id==='counter'){
      blocked=true;
      await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    }
    return packet.criterion.id==='heading'
      ?{action:'replace',description:'The main heading is Repair Verified.',reason:'The new guidance explicitly replaces the old heading.'}
      :{action:'keep',description:packet.criterion.description,reason:'The counter behavior must stay unchanged.'};
  }
  if(system.startsWith('Revision requirement planner'))return {requirements:[]};
  if(system.startsWith('Acceptance reviewer.')){
    const heading=/heading/i.test(packet.requirement);
    const satisfied=heading?packet.dom.includes('Repair Verified')&&packet.source.some((item:any)=>item.source.includes('Repair Verified')):packet.browser.includes('counter acceptance passed');
    return {satisfied,reason:satisfied?'The actual source/tests and production browser evidence support this criterion.':'The required new output is not present yet.'};
  }
  if(system.startsWith('Revision completion reviewer.')){
    const actual=packet.evidence;
    const satisfied=actual.headings.includes('Repair Verified')&&actual.checks.every((check:any)=>check.ok)&&actual.checks.some((check:any)=>check.id==='browser'&&check.detail.includes('counter acceptance passed'))&&actual.artifacts.some((artifact:any)=>artifact.kind==='zip'&&artifact.smokeTested);
    return {satisfied,reason:satisfied?'The fresh production heading, retained counter behavior and accepted ZIP cover the full revision guidance.':'The complete requested revision is not supported by actual output and fresh QA.'};
  }
  if(system.startsWith('Software worker.')){
    let tool:string;
    if(!pageEdited)tool=packet.lastRead?.path==='app/page.tsx'?'replace_text':'read_file';
    else if(!testEdited)tool=packet.lastRead?.path==='tests/app.test.tsx'?'replace_text':'read_file';
    else tool=packet.requirement?.status==='pending'?'mark_implemented':'run_checks';
    if(!(schema as any).properties.tool.enum.includes(tool))throw new Error('Fixture tool is unavailable: '+tool);
    return {tool};
  }
  if(system.startsWith('Produce arguments for read_file'))return {path:pageEdited?'tests/app.test.tsx':'app/page.tsx',offset:0};
  if(system.startsWith('Produce arguments for replace_text')){
    const path=packet.lastRead.path;
    if(path==='app/page.tsx')pageEdited=true;else if(path==='tests/app.test.tsx')testEdited=true;else throw new Error('Unexpected fixture target');
    return {path,before:'Repair Baseline',after:'Repair Verified'};
  }
  if(system.startsWith('Produce arguments for mark_implemented'))return {files:['app/page.tsx'],tests:['tests/app.test.tsx']};
  if(system.startsWith('Produce arguments for run_checks'))return {};
  throw new Error('Unexpected fixture inference role: '+system.slice(0,150));
};
const server=Bun.serve({hostname:'127.0.0.1',port:3211,idleTimeout:255,fetch:request=>{
  const path=new URL(request.url).pathname;
  if(path==='/fixture/ready')return Response.json({fixture:process.env.FIXTURE_RUN_ID,blocked});
  return handle(request);
}});
startSoftwareWorker(generate);
console.log('Scripted software fixture ready; real compiler/browser/artifact checks enabled');
const close=()=>{shutdownSoftwareWorker();void server.stop(true);setTimeout(()=>process.exit(0),1000).unref();};
process.on('SIGINT',close);process.on('SIGTERM',close);
