import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GoalOrchestrator,type GoalRecord,type GoalExecution,type GoalOrchestratorOptions} from '../core/goal-orchestrator';
import {PublicSourceLedger,describePublicSource} from '../core/public-source';
import {executeSourceQuestion,reviewSourceAcquisition} from '../core/source-question';
import type {Infer} from '../core/model';
import type {BriefArtifact} from '../core/research-brief-types';

// Synthetic host-flow fixtures only: no public fetch, native inference, PDF
// rendering or artifact-byte validation. Those have separate acceptance gates.
const url='https://example.org/host-flow-fixture.txt';
const quote='This repository hosts the Fetch Standard.';
const content=quote+'\nThe fixture keeps the whole accepted answer and literal source identity.\n'+'Saved background. '.repeat(90);
const question='Which standard does this repository host?';
const fullAnswer='The repository hosts the Fetch Standard. '+
  'This synthetic answer deliberately keeps all of its accepted text during the document handoff. '.repeat(4)+
  'END-OF-ACCEPTED-ANSWER';
const sourceInput={request:question,projectId:'fixture-project',research:true,sourceQuestion:{urls:[url]}};
const briefInput=()=>({title:'My complete research brief',notes:'My own note <must stay literal> & separate from source claims.',requestKey:crypto.randomUUID()});
const tick=()=>new Promise(resolve=>setTimeout(resolve,3));
async function wait(queue:GoalOrchestrator,id:string,predicate:(goal:GoalRecord)=>boolean){
  for(let count=0;count<1000;count++){const goal=queue.get(id);if(predicate(goal))return goal;await tick();}
  throw new Error('Synthetic host goal timed out: '+JSON.stringify(queue.get(id)));
}
const body=(db:Database,id:string)=>(db.query('SELECT body FROM goal_tasks WHERE id=?').get(id) as {body:string}).body;
const count=(db:Database,table:string)=>(db.query('SELECT COUNT(*) AS n FROM '+table).get() as {n:number}).n;
const artifact=(goal:GoalRecord):BriefArtifact=>({id:'fixture-artifact-'+goal.id,documentId:'fixture-document-'+goal.id,title:goal.brief!.title,created:1,pages:2,inputSha256:'1'.repeat(64),draftSha256:'2'.repeat(64),pdfSha256:'3'.repeat(64),htmlSha256:'4'.repeat(64)});
const savedExecution=(goal:GoalRecord):GoalExecution=>({verified:true,message:'Synthetic checked artifact descriptor; no actual file is claimed by this host-flow test.',evidence:['Synthetic host artifact receipt.'],briefArtifact:artifact(goal)});
type Hooks={executeBrief?:(goal:GoalRecord,signal:AbortSignal)=>Promise<GoalExecution>;reviewBrief?:GoalOrchestratorOptions['reviewBrief']};
function host(db:Database,hooks:Hooks={},counters={reads:0,inferences:0,briefExecutions:0,reviews:0}){
  const ledger=new PublicSourceLedger(db,async()=>{counters.reads++;return describePublicSource(url,{url,type:'text/plain',bytes:new TextEncoder().encode(content)});});
  const infer:Infer=async(_role,packet,schema)=>{
    counters.inferences++;const properties=schema.properties as Record<string,unknown>;
    if(properties.supported)return {supported:true,reason:'Synthetic fixture accepts the chosen literal statement for the complete question.'};
    if(properties.citations){const spans=JSON.parse(packet).sources.flatMap((source:{spans:{id:string;text:string}[]})=>source.spans),chosen=spans.find((span:{text:string})=>span.text===quote);if(!chosen)throw new Error('Expected literal fixture span missing.');return {response:fullAnswer,citations:[chosen.id],uncertainty:'',answerable:true,answerabilityReason:'The synthetic source explicitly names the standard.'};}
    return {accepted:true,reason:'Synthetic review accepts the complete saved fixture question and answer.'};
  };
  const queue=new GoalOrchestrator(db,{infer,sourceLedger:ledger,
    execute:async(task,goal,signal,progress)=>{if(task.sourceBrief){counters.briefExecutions++;return hooks.executeBrief?hooks.executeBrief(goal,signal):savedExecution(goal);}return executeSourceQuestion(ledger,task,goal,signal,infer,progress);},
    reviewSource:(task,goal,execution,signal)=>reviewSourceAcquisition(ledger,task,goal,execution,signal),
    reviewBrief:async(...args)=>{counters.reviews++;return hooks.reviewBrief?hooks.reviewBrief(...args):{accepted:true,reason:'Synthetic artifact-check callback approves the fixture descriptor.'};}
  });return {queue,ledger,counters};
}
async function acceptedParent(context:ReturnType<typeof host>){const created=context.queue.create(sourceInput);context.queue.start();const parent=await wait(context.queue,created.id,goal=>goal.status==='completed');context.queue.shutdown();await tick();await tick();return parent;}
async function close(queue:GoalOrchestrator,db:Database){queue.shutdown();await tick();await tick();db.close();}

test('synthetic brief handoff preserves exact accepted parent, complete answer and remapped reading; child never re-fetches or re-answers',async()=>{
  const db=new Database(':memory:'),context=host(db),{queue,ledger,counters}=context;
  try{
    const parent=await acceptedParent(context),parentBody=body(db,parent.id),parentReading=ledger.reading(parent.id)!,parentSource=ledger.list(parent.id)[0],parentAnswer=parent.tasks.find(task=>task.sourceAnswer)!.execution!.sourceAnswer!,input=briefInput();
    const baseline={...counters},child=queue.createBrief(parent.id,input),copy=ledger.list(child.id)[0],reading=ledger.reading(child.id)!,answer=child.tasks.find(task=>task.sourceAnswer)!.execution!.sourceAnswer!;
    expect(child.parentGoalId).toBe(parent.id);expect(child.brief).toEqual({parentGoalId:parent.id,...input});
    expect(copy.id).not.toBe(parentSource.id);expect(copy.copiedFrom).toEqual({goalId:parent.id,sourceId:parentSource.id});
    expect(ledger.get(child.id,copy.id).body).toEqual(ledger.get(parent.id,parentSource.id).body);expect(ledger.get(child.id,copy.id).text).toBe(content);
    expect(copy.sha256).toBe(parentSource.sha256);expect(copy.textSha256).toBe(parentSource.textSha256);expect(copy.retrievedAt).toBe(parentSource.retrievedAt);
    expect(reading.id).not.toBe(parentReading.id);expect(reading.question).toBe(parentReading.question);expect(reading.ranges.map(range=>range.sourceId)).toEqual([copy.id]);
    expect(answer).toEqual({...parentAnswer,readingId:reading.id,selections:parentAnswer.selections.map(range=>({...range,sourceId:copy.id})),citations:parentAnswer.citations.map(citation=>({...citation,sourceId:copy.id}))});
    expect(answer.text).toBe(fullAnswer);expect(answer.text.endsWith('END-OF-ACCEPTED-ANSWER')).toBe(true);
    expect(child.tasks.find(task=>task.sourceBrief)!.dependsOn).toEqual(['source-answer']);expect(child.tasks.filter(task=>!task.sourceBrief).every(task=>task.status==='verified'&&task.attempts===0)).toBe(true);
    queue.start();const completed=await wait(queue,child.id,goal=>goal.status==='completed');
    expect(completed.tasks.find(task=>task.sourceBrief)!.attempts).toBe(1);expect(counters.reads).toBe(baseline.reads);expect(counters.inferences).toBe(baseline.inferences);expect(counters.briefExecutions).toBe(1);
    expect(completed.events.some(event=>event.phase==='fetching_source'||event.phase==='answering_sources')).toBe(false);
    expect(body(db,parent.id)).toBe(parentBody);expect(ledger.reading(parent.id)).toEqual(parentReading);
  }finally{await close(queue,db);}
});

test('synthetic uncertain submission reconciles exact request identity and refuses changed notes or title',async()=>{
  const db=new Database(':memory:'),context=host(db),{queue,counters}=context;
  try{
    const parent=await acceptedParent(context),input=briefInput(),child=queue.createBrief(parent.id,input),saved=body(db,child.id),baseline={...counters};
    expect(queue.createBrief(parent.id,input).id).toBe(child.id);expect(body(db,child.id)).toBe(saved);
    expect(count(db,'goal_tasks')).toBe(2);expect(count(db,'goal_sources')).toBe(2);expect(count(db,'goal_brief_requests')).toBe(1);
    expect(()=>queue.createBrief(parent.id,{...input,title:'Changed title'})).toThrow('different notes or a title');expect(()=>queue.createBrief(parent.id,{...input,notes:'Changed notes'})).toThrow('different notes or a title');
    expect(counters).toEqual(baseline);expect(count(db,'goal_tasks')).toBe(2);
  }finally{await close(queue,db);}
});

test('synthetic handoff refuses unfinished/rejected parent work and corrupted citation or persisted reading',async()=>{
  const db=new Database(':memory:'),context=host(db),{queue,ledger}=context;
  try{
    const parent=await acceptedParent(context),original=body(db,parent.id),reading=ledger.reading(parent.id)!,readingBody=(db.query('SELECT body FROM goal_source_readings WHERE id=?').get(reading.id) as {body:string}).body;
    const corruptions=[(goal:GoalRecord)=>{goal.status='needs_input';},(goal:GoalRecord)=>{goal.coverageDone=false;},(goal:GoalRecord)=>{goal.tasks.find(task=>task.sourceAnswer)!.review={accepted:false,reason:'Rejected fixture answer.'};},(goal:GoalRecord)=>{goal.tasks.find(task=>task.sourceAnswer)!.execution!.sourceAnswer!.citations[0].quote='Invented quote.';}];
    for(const change of corruptions){const altered=JSON.parse(original) as GoalRecord;change(altered);db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(altered),parent.id);expect(()=>queue.createBrief(parent.id,briefInput())).toThrow();expect(count(db,'goal_tasks')).toBe(1);expect(count(db,'goal_brief_requests')).toBe(0);}
    db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(original,parent.id);
    const alteredReading={...reading,ranges:reading.ranges.map(range=>({...range,text:'Corrupted saved selection.'}))};db.query('UPDATE goal_source_readings SET body=? WHERE id=?').run(JSON.stringify(alteredReading),reading.id);
    expect(()=>queue.createBrief(parent.id,briefInput())).toThrow('range changed');expect(count(db,'goal_sources')).toBe(1);expect(count(db,'goal_brief_requests')).toBe(0);
    db.query('UPDATE goal_source_readings SET body=? WHERE id=?').run(readingBody,reading.id);expect(body(db,parent.id)).toBe(original);
  }finally{await close(queue,db);}
});

test('synthetic corrupted handoff refuses changed selection text and a literal citation outside its accepted reading',async()=>{
  for(const kind of ['selection-text','citation-outside-reading']){
    const db=new Database(':memory:'),context=host(db),{queue,ledger}=context;
    try{
      const parent=await acceptedParent(context),original=body(db,parent.id),altered=JSON.parse(original) as GoalRecord,answer=altered.tasks.find(task=>task.sourceAnswer)!.execution!.sourceAnswer!;
      if(kind==='selection-text')answer.selections[0].text='Changed accepted selection, despite an unchanged source hash.';
      else{const outside='Saved background.',offset=content.lastIndexOf(outside);expect(offset).toBeGreaterThan(ledger.reading(parent.id)!.ranges[0].end);answer.citations[0]={...answer.citations[0],quote:outside,offset};}
      db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(altered),parent.id);
      expect(()=>queue.createBrief(parent.id,briefInput())).toThrow();
      expect(count(db,'goal_tasks')).toBe(1);expect(count(db,'goal_sources')).toBe(1);expect(count(db,'goal_brief_requests')).toBe(0);
    }finally{await close(queue,db);}
  }
});

test('synthetic late handoff transaction failure rolls back child, copied sources/readings and request identity together',async()=>{
  const db=new Database(':memory:'),context=host(db),{queue,counters}=context;
  try{
    const parent=await acceptedParent(context),original=body(db,parent.id),baseline={...counters},input=briefInput();
    db.exec("CREATE TRIGGER reject_brief_request BEFORE INSERT ON goal_brief_requests BEGIN SELECT RAISE(ABORT,'late brief fixture rollback'); END");
    expect(()=>queue.createBrief(parent.id,input)).toThrow('late brief fixture rollback');
    for(const table of ['goal_tasks','goal_sources','goal_source_readings'])expect(count(db,table)).toBe(1);
    expect(count(db,'goal_brief_requests')).toBe(0);expect(body(db,parent.id)).toBe(original);expect(counters).toEqual(baseline);
    db.exec('DROP TRIGGER reject_brief_request');expect(queue.createBrief(parent.id,input).parentGoalId).toBe(parent.id);expect(count(db,'goal_brief_requests')).toBe(1);
  }finally{await close(queue,db);}
});

test('synthetic review approval cannot complete a brief lacking its saved artifact descriptor',async()=>{
  const db=new Database(':memory:'),context=host(db,{executeBrief:async()=>({verified:true,message:'Fixture claims execution without an artifact.',evidence:['Synthetic evidence does not replace the required artifact.']})}),{queue}=context;
  try{
    const parent=await acceptedParent(context),parentBody=body(db,parent.id),child=queue.createBrief(parent.id,briefInput());queue.start();const paused=await wait(queue,child.id,goal=>goal.status==='needs_input');
    expect(paused.status).not.toBe('completed');expect(paused.coverageDone).toBe(false);expect(paused.message).toContain('accepted saved document');expect(body(db,parent.id)).toBe(parentBody);
  }finally{await close(queue,db);}
});

test('synthetic Stop then shutdown/reopen needs explicit Continue and reviews checked execution without redoing accepted work',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'brief-handoff-')),path=join(directory,'state.sqlite');let db=new Database(path),holdReview=true,pendingReviews=0;
  const counters={reads:0,inferences:0,briefExecutions:0,reviews:0};
  const hooks:Hooks={reviewBrief:async(_task,_goal,_execution,signal)=>{if(holdReview){pendingReviews++;try{await new Promise<void>((_resolve,reject)=>{signal.throwIfAborted();signal.addEventListener('abort',()=>reject(new Error('Synthetic review interrupted.')),{once:true});});}finally{pendingReviews--;}}return {accepted:true,reason:'Synthetic fixture re-read the existing immutable artifact descriptor.'};}};
  let context=host(db,hooks,counters),queue=context.queue;
  try{
    const parent=await acceptedParent(context),parentBody=body(db,parent.id),input=briefInput(),child=queue.createBrief(parent.id,input),sources=JSON.stringify(context.ledger.list(child.id)),reading=JSON.stringify(context.ledger.reading(child.id)),acceptedCopies=JSON.stringify(child.tasks.filter(task=>!task.sourceBrief)),baseline={...counters};
    queue.start();await wait(queue,child.id,goal=>pendingReviews===1&&!!goal.tasks.find(task=>task.sourceBrief)?.execution?.briefArtifact);const execution=queue.get(child.id).tasks.find(task=>task.sourceBrief)!.execution;
    queue.stop(child.id);await tick();await tick();expect(pendingReviews).toBe(0);expect(queue.get(child.id).status).toBe('cancelled');
    const cancelledBody=body(db,child.id);expect(()=>queue.resume(child.id,'Change the accepted requirements.')).toThrow('saved title, notes');expect(body(db,child.id)).toBe(cancelledBody);
    queue.resume(child.id);await wait(queue,child.id,()=>pendingReviews===1);expect(counters.briefExecutions).toBe(1);
    queue.shutdown();await wait(queue,child.id,goal=>goal.status==='needs_input'&&pendingReviews===0);await tick();db.close();
    db=new Database(path);context=host(db,hooks,counters);queue=context.queue;holdReview=false;
    const beforeResume={...counters};queue.start();await tick();await tick();expect(queue.get(child.id).status).toBe('needs_input');expect(counters).toEqual(beforeResume);
    expect(JSON.stringify(context.ledger.list(child.id))).toBe(sources);expect(JSON.stringify(context.ledger.reading(child.id))).toBe(reading);
    queue.resume(child.id);const completed=await wait(queue,child.id,goal=>goal.status==='completed');
    expect(completed.tasks.find(task=>task.sourceBrief)!.execution).toEqual(execution);expect(completed.tasks.find(task=>task.sourceBrief)!.attempts).toBe(1);expect(JSON.stringify(completed.tasks.filter(task=>!task.sourceBrief))).toBe(acceptedCopies);
    expect(counters.briefExecutions).toBe(1);expect(counters.reads).toBe(baseline.reads);expect(counters.inferences).toBe(baseline.inferences);expect(completed.brief).toEqual({parentGoalId:parent.id,...input});expect(body(db,parent.id)).toBe(parentBody);expect(count(db,'goal_brief_requests')).toBe(1);
  }finally{await close(queue,db);rmSync(directory,{recursive:true,force:true});}
});
