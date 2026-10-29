import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GoalOrchestrator,type GoalRecord} from '../core/goal-orchestrator';
import {PublicSourceLedger,describePublicSource,sourceHash} from '../core/public-source';
import {executeSourceQuestion,reviewSourceAcquisition} from '../core/source-question';
import type {Infer} from '../core/model';

const url='https://example.com/public-guide.txt';
const first='Compatibility tests live at https://example.com/tests.';
const second='Browser results are published at https://example.com/results.';
const content='This repository hosts the Example Standard.\n'+'General background. '.repeat(100)+'\n'+first+'\n'+'Additional background. '.repeat(110)+'\n'+second+'\n'+'Appendix. '.repeat(100);
const question='Where do compatibility tests live and where are browser results published?';
const input={request:question,projectId:'original-project',research:true,sourceQuestion:{urls:[url]}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,3));
async function wait(queue:GoalOrchestrator,id:string,predicate:(goal:GoalRecord)=>boolean){for(let i=0;i<1000;i++){const goal=queue.get(id);if(predicate(goal))return goal;await tick();}throw new Error('Reading goal did not reach expected state: '+JSON.stringify(queue.get(id)));}
function host(db:Database,ledger:PublicSourceLedger,infer:Infer){return new GoalOrchestrator(db,{infer,sourceLedger:ledger,execute:(task,goal,signal,progress)=>executeSourceQuestion(ledger,task,goal,signal,infer,progress),reviewSource:(task,goal,execution,signal)=>reviewSourceAcquisition(ledger,task,goal,execution,signal)});}
function ledgerFor(db:Database,onRead=()=>{}){return new PublicSourceLedger(db,async()=>{onRead();return describePublicSource(url,{url,type:'text/plain',bytes:new TextEncoder().encode(content)});});}
const answer:Infer=async(_system,packet,schema)=>{
  if(!(schema.properties as any).citations)return {accepted:true,reason:'Every requested location is present in the concrete answer and selected passages.'};
  const source=JSON.parse(packet).sources as {id:string;text:string}[];
  const citations=[first,second].map(quote=>({id:source.find(item=>item.text.includes(quote))!.id,quote}));
  return {response:'Compatibility tests: https://example.com/tests. Browser results: https://example.com/results.',citations,uncertainty:'',answerable:true,answerabilityReason:'Both exact locations are present in the selected passages.'};
};

test('selected passages are durable before inference and both acceptance and coverage see the actual question, snippets and answer',async()=>{
  const db=new Database(':memory:'),ledger=ledgerFor(db),packets:{role:string;value:any}[]=[];let id='';
  const infer:Infer=async(...args)=>{const reading=ledger.reading(id);expect(reading?.questionSha256).toBe(sourceHash(question));packets.push({role:args[0],value:JSON.parse(args[1])});return answer(...args);};
  const queue=host(db,ledger,infer);
  try{const created=queue.create(input);id=created.id;queue.start();const goal=await wait(queue,id,item=>item.status==='completed'),reading=ledger.reading(id)!;
    expect(reading.ranges).toHaveLength(2);expect(reading.ranges.every(range=>range.end-range.start<=800)).toBe(true);expect(reading.ranges.reduce((n,range)=>n+range.text.length,0)).toBeLessThanOrEqual(1600);
    const result=goal.tasks.find(task=>task.sourceAnswer)!.execution!.sourceAnswer!;
    expect(result.citations.map(citation=>citation.offset)).toEqual([content.indexOf(first),content.indexOf(second)]);expect(result.citations.every(citation=>citation.offset>800)).toBe(true);expect(result.readingId).toBe(reading.id);
    for(const role of ['Independent source-answer','Independent goal coverage']){const packet=packets.find(item=>item.role.startsWith(role))!.value;expect(packet.exactQuestion).toBe(question);expect(packet.answer.text).toContain('https://example.com/tests');expect(packet.selectedPassages.map((range:any)=>range.text).join('\n')).toContain(second);expect(JSON.stringify(packet).length).toBeLessThanOrEqual(4500);}
    expect(goal.events.some(event=>event.phase==='selection_saved')).toBe(true);
  }finally{queue.shutdown();await tick();db.close();}
});

test('source-insufficient output cannot complete even if a later reviewer would blindly accept',async()=>{
  const db=new Database(':memory:'),ledger=ledgerFor(db);let reviews=0;
  const infer:Infer=async(_role,packet,schema)=>{if(!(schema.properties as any).citations){reviews++;return {accepted:true,reason:'This must not be reached.'};}const source=JSON.parse(packet).sources[0];return {response:'The selected excerpt mentions compatibility tests.',citations:[{id:source.id,quote:first}],uncertainty:'The postal address is not provided.',answerable:false,answerabilityReason:'The requested postal address is absent from these passages.'};};
  const queue=host(db,ledger,infer);
  try{const created=queue.create({...input,request:'Which postal address is listed next to the compatibility tests?'});queue.start();const goal=await wait(queue,created.id,item=>item.status==='needs_input');expect(goal.message).toContain('do not fully answer');expect(goal.tasks.find(task=>task.sourceAnswer)!.execution?.sourceAnswer?.answerable).toBe(false);expect(reviews).toBe(0);expect(ledger.reading(goal.id)).toBeDefined();expect(goal.tasks[0].status).toBe('verified');}
  finally{queue.shutdown();await tick();db.close();}
});

test('independent source review rejects an unanswered question while a supported negative factual answer remains valid',async()=>{
  for(const negative of [false,true]){
    const db=new Database(':memory:'),text=negative?'The table explicitly lists no postal address.':content,ledger=new PublicSourceLedger(db,async()=>describePublicSource(url,{url,type:'text/plain',bytes:new TextEncoder().encode(text)}));
    const infer:Infer=async(role,packet,schema)=>{if((schema.properties as any).citations){const source=JSON.parse(packet).sources[0];return {response:negative?'The table does not provide a postal address.':'Look in the documentation for the requested address.',citations:[{id:source.id,quote:negative?text:first}],uncertainty:negative?'A postal address is not provided.':'The requested address is not provided.',answerable:true,answerabilityReason:negative?'The explicit negative statement answers the yes/no question.':'A generic direction is not sufficient evidence.'};}return {accepted:negative||!role.startsWith('Independent source-answer'),reason:negative?'The explicit negative fact answers the complete question.':'The actual answer does not give the requested postal address.'};};
    const queue=host(db,ledger,infer);
    try{const goal=queue.create({...input,request:negative?'Does the table list a postal address?':'Which postal address is listed next to compatibility tests?'});queue.start();const saved=await wait(queue,goal.id,item=>['completed','needs_input'].includes(item.status));expect(saved.status).toBe(negative?'completed':'needs_input');if(!negative)expect(saved.tasks.find(task=>task.sourceAnswer)!.review?.accepted).toBe(false);}
    finally{queue.shutdown();await tick();db.close();}
  }
});

test('unfinished Continue creates immutable per-guidance readings and B to C to B reuses the exact prior plan',async()=>{
  const db=new Database(':memory:');let reads=0;const ledger=ledgerFor(db,()=>reads++),queue=host(db,ledger,async()=>{throw new Error('Inference unavailable for this fixture.');});
  try{const created=queue.create(input);queue.start();await wait(queue,created.id,item=>item.status==='needs_input');const base=ledger.reading(created.id)!;await tick();queue.resume(created.id,'Clarify compatibility tests B');await wait(queue,created.id,item=>item.status==='needs_input');const b=ledger.reading(created.id)!;await tick();queue.resume(created.id,'Clarify browser results C');await wait(queue,created.id,item=>item.status==='needs_input');const c=ledger.reading(created.id)!;await tick();queue.resume(created.id,'Clarify compatibility tests B');await wait(queue,created.id,item=>item.status==='needs_input');
    expect(new Set([base.id,b.id,c.id]).size).toBe(3);expect(ledger.readings(created.id)).toHaveLength(3);expect(ledger.reading(created.id,'source-answer',{questionSha256:b.questionSha256})).toEqual(b);expect(ledger.readings(created.id).find(plan=>plan.id===base.id)).toEqual(base);expect(reads).toBe(1);expect(queue.get(created.id).events.some(event=>event.phase==='selection_reused')).toBe(true);
  }finally{queue.shutdown();await tick();db.close();}
});

test('linked questions copy immutable verified sources and persist manual ranges atomically without fetching or changing the accepted parent',async()=>{
  const db=new Database(':memory:');let reads=0;const ledger=ledgerFor(db,()=>reads++),queue=host(db,ledger,answer);
  try{const parent=queue.create(input);queue.start();await wait(queue,parent.id,item=>item.status==='completed');await tick();const original=(db.query('SELECT body FROM goal_tasks WHERE id=?').get(parent.id) as {body:string}).body,snapshot=ledger.list(parent.id)[0],reading=ledger.reading(parent.id)!;
    const ranges=[first,second].map(quote=>({sourceId:snapshot.id,start:content.indexOf(quote),end:content.indexOf(quote)+quote.length,textSha256:snapshot.textSha256}));
    const child=queue.create({...input,sourceQuestion:{urls:[url],reuseGoalId:parent.id,ranges}});const copied=ledger.list(child.id)[0],plan=ledger.reading(child.id)!;expect(child.parentGoalId).toBe(parent.id);expect(copied.id).not.toBe(snapshot.id);expect(copied.copiedFrom).toEqual({goalId:parent.id,sourceId:snapshot.id});expect(copied.textSha256).toBe(snapshot.textSha256);expect(copied.sha256).toBe(snapshot.sha256);expect(copied.retrievedAt).toBe(snapshot.retrievedAt);expect(ledger.get(child.id,copied.id).body).toEqual(ledger.get(parent.id,snapshot.id).body);expect(plan.mode).toBe('manual');expect(plan.ranges.map(range=>range.sourceId)).toEqual([copied.id,copied.id]);expect(new Set(plan.ranges.map(range=>range.label)).size).toBe(2);
    const done=await wait(queue,child.id,item=>item.status==='completed');expect(done.tasks[0].attempts).toBe(0);expect(done.events.some(event=>event.phase==='fetching_source')).toBe(false);expect(done.events.some(event=>event.phase==='source_reused')).toBe(true);expect(reads).toBe(1);expect((db.query('SELECT body FROM goal_tasks WHERE id=?').get(parent.id) as {body:string}).body).toBe(original);expect(ledger.reading(parent.id)).toEqual(reading);
  }finally{queue.shutdown();await tick();db.close();}
});

test('source/reading copies roll back with rejected child source save and invalid reuse never reaches inference',async()=>{
  const db=new Database(':memory:'),ledger=ledgerFor(db),queue=host(db,ledger,answer);
  try{const parent=queue.create(input);queue.start();await wait(queue,parent.id,item=>item.status==='completed');await tick();queue.shutdown();const original=JSON.stringify(queue.get(parent.id)),snapshot=ledger.list(parent.id)[0];
    expect(()=>queue.create({...input,projectId:'different-project',sourceQuestion:{urls:[url],reuseGoalId:parent.id}})).toThrow('original');expect(()=>queue.create({...input,sourceQuestion:{urls:[url+'/other'],reuseGoalId:parent.id}})).toThrow('original');expect(()=>queue.create({...input,sourceQuestion:{urls:[url],reuseGoalId:parent.id,ranges:[{sourceId:snapshot.id,start:0,end:1601,textSha256:snapshot.textSha256}]}})).toThrow('1,600');
    db.exec("CREATE TRIGGER reject_child BEFORE INSERT ON goal_tasks BEGIN SELECT RAISE(ABORT,'reject child record'); END;");expect(()=>queue.create({...input,sourceQuestion:{urls:[url],reuseGoalId:parent.id}})).toThrow('reject child record');
    for(const table of ['goal_tasks','goal_sources','goal_source_readings'])expect((db.query('SELECT COUNT(*) AS n FROM '+table).get() as {n:number}).n).toBe(1);expect(JSON.stringify(queue.get(parent.id))).toBe(original);
  }finally{queue.shutdown();await tick();db.close();}
});

test('range identity checks reject overlap, split characters and corrupted reading text; reopen preserves earlier plans and migrates their unique key',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'source-reading-')),path=join(directory,'state.sqlite');let db=new Database(path);
  try{let ledger=new PublicSourceLedger(db,async()=>describePublicSource(url,{url,type:'text/plain',bytes:new TextEncoder().encode('😀 color blue. '+content)}));const source=await ledger.capture('goal','source-1',url,new AbortController().signal,()=>{}),base={sourceId:source.id,textSha256:source.textSha256};
    expect(()=>ledger.validateRanges('goal',[{...base,start:1,end:3}])).toThrow('complete characters');expect(()=>ledger.validateRanges('goal',[{...base,start:0,end:20},{...base,start:10,end:30}])).toThrow('overlap');expect(()=>ledger.validateRanges('goal',[{...base,start:0,end:20,textSha256:'0'.repeat(64)}])).toThrow('identity');
    const plan=ledger.prepareReading('goal','source-answer',question).plan,body=JSON.stringify(plan);db.exec('ALTER TABLE goal_source_readings RENAME TO current_readings; CREATE TABLE goal_source_readings(id TEXT PRIMARY KEY,goal TEXT NOT NULL,task TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(goal,task)); INSERT INTO goal_source_readings SELECT id,goal,task,body FROM current_readings; DROP TABLE current_readings');db.close();db=new Database(path);ledger=new PublicSourceLedger(db);
    expect(ledger.reading('goal')).toEqual(plan);expect((db.query('SELECT body FROM goal_source_readings WHERE id=?').get(plan.id) as {body:string}).body).toBe(body);expect(ledger.prepareReading('goal','source-answer',question+' extra guidance').plan.id).not.toBe(plan.id);expect(ledger.readings('goal')).toHaveLength(2);
    const altered={...plan,ranges:plan.ranges.map(range=>({...range,text:'corrupt'}))};db.query('UPDATE goal_source_readings SET body=? WHERE id=?').run(JSON.stringify(altered),plan.id);expect(()=>ledger.reading('goal','source-answer',{id:plan.id})).toThrow('range changed');
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('stop discards late answer output and restart requires explicit continuation with the exact cached reading',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reading-stop-')),path=join(directory,'state.sqlite');let db=new Database(path),started=false,release!:()=>void,first=true,reads=0;let ledger=ledgerFor(db,()=>reads++);
  const infer:Infer=async(...args)=>{if(first&&(args[2].properties as any).citations){first=false;started=true;await new Promise<void>(resolve=>release=resolve);}return answer(...args);};let queue=host(db,ledger,infer);
  try{const created=queue.create(input);queue.start();await wait(queue,created.id,()=>started);const plan=ledger.reading(created.id)!;queue.stop(created.id);release();await tick();await tick();expect(queue.get(created.id).status).toBe('cancelled');expect(queue.get(created.id).tasks.find(task=>task.sourceAnswer)!.execution).toBeUndefined();queue.shutdown();await tick();db.close();db=new Database(path);ledger=ledgerFor(db,()=>reads++);queue=host(db,ledger,answer);queue.start();await tick();expect(queue.get(created.id).status).toBe('cancelled');queue.resume(created.id);await wait(queue,created.id,item=>item.status==='completed');expect(ledger.reading(created.id)).toEqual(plan);expect(reads).toBe(1);
  }finally{queue.shutdown();await tick();db.close();rmSync(directory,{recursive:true,force:true});}
});

test('no term match saves an inspectable plan and pauses without making an inference call',async()=>{
  const db=new Database(':memory:'),ledger=ledgerFor(db);let calls=0;const queue=host(db,ledger,async()=>{calls++;throw new Error('No-match must not invoke inference.');});
  try{const goal=queue.create({...input,request:'zebra quartz'});queue.start();await wait(queue,goal.id,item=>item.status==='needs_input');expect(ledger.reading(goal.id)?.match).toBe('none');expect(calls).toBe(0);expect(queue.get(goal.id).message).toContain('no question-term matches');}
  finally{queue.shutdown();await tick();db.close();}
});

test('new guidance after accepted answer but rejected coverage archives and regenerates only the read-only answer atomically',async()=>{
  const db=new Database(':memory:'),ledger=ledgerFor(db);let allowCoverage=false,answers=0;
  const infer:Infer=async(...args)=>{if((args[2].properties as any).citations)answers++;if(args[0].startsWith('Independent goal coverage')&&!allowCoverage)return {accepted:false,reason:'The original answer needs a clearer explanation of both requested locations.'};return answer(...args);};
  const queue=host(db,ledger,infer);
  try{const created=queue.create(input);queue.start();const paused=await wait(queue,created.id,item=>item.status==='needs_input');await tick();expect(paused.phase).toBe('coverage_rejected');const oldTask=paused.tasks.find(task=>task.sourceAnswer)!,oldSource=JSON.stringify(paused.tasks[0]),oldReading=ledger.reading(created.id)!,oldBody=(db.query('SELECT body FROM goal_tasks WHERE id=?').get(created.id) as {body:string}).body;
    db.exec("CREATE TRIGGER reject_resume BEFORE UPDATE ON goal_tasks BEGIN SELECT RAISE(ABORT,'reject continuation'); END;");expect(()=>queue.resume(created.id,'Explain both requested locations explicitly.')).toThrow('reject continuation');expect((db.query('SELECT COUNT(*) AS n FROM goal_source_answer_history').get() as {n:number}).n).toBe(0);expect((db.query('SELECT body FROM goal_tasks WHERE id=?').get(created.id) as {body:string}).body).toBe(oldBody);db.exec('DROP TRIGGER reject_resume');
    allowCoverage=true;queue.resume(created.id,'Explain both requested locations explicitly.');const completed=await wait(queue,created.id,item=>item.status==='completed');expect(answers).toBe(2);expect(JSON.stringify(completed.tasks[0])).toBe(oldSource);expect(ledger.readings(created.id)).toHaveLength(2);expect(ledger.readingResult(created.id,oldReading.id)?.execution).toEqual(oldTask.execution);expect(ledger.readingResult(created.id,oldReading.id)?.review).toEqual(oldTask.review);expect(ledger.readingResult(created.id,oldReading.id)?.question).toBe(question);expect(ledger.reading(created.id)!.question).toContain('Explain both requested locations explicitly.');
    const immutable=JSON.stringify(completed);expect(JSON.stringify(queue.resume(created.id,'Do not change an accepted parent.'))).toBe(immutable);
  }finally{queue.shutdown();await tick();db.close();}
});

test('unfinished verified legacy answer can explicitly Continue without a receipt loop while preserving the old answer evidence',async()=>{
  const db=new Database(':memory:'),ledger=ledgerFor(db),queue=host(db,ledger,answer);
  try{const created=queue.create(input);queue.start();const saved=await wait(queue,created.id,item=>item.status==='completed');await tick();const legacy=structuredClone(saved),task=legacy.tasks.find(task=>task.sourceAnswer)!;legacy.status='needs_input';legacy.phase='coverage_rejected';delete task.execution!.sourceAnswer!.readingId;delete task.execution!.sourceAnswer!.answerable;for(const range of task.execution!.sourceAnswer!.selections)delete range.text;const original=structuredClone(task.execution);db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(legacy),created.id);
    queue.resume(created.id);const completed=await wait(queue,created.id,item=>item.status==='completed');expect(completed.tasks.find(task=>task.sourceAnswer)!.attempts).toBe(2);expect(completed.tasks[0].attempts).toBe(1);const archived=JSON.parse((db.query('SELECT body FROM goal_source_answer_history WHERE goal=?').get(created.id) as {body:string}).body);expect(archived.readingId).toBeUndefined();expect(archived.execution).toEqual(original);expect(archived.question).toBe(question);
  }finally{queue.shutdown();await tick();db.close();}
});

test('reading history is bounded metadata, while explicit owned reading inspection verifies sources',async()=>{
  const db=new Database(':memory:'),ledger=ledgerFor(db);
  try{await ledger.capture('goal','source-1',url,new AbortController().signal,()=>{});const first=ledger.prepareReading('goal','source-answer',question).plan;ledger.prepareReading('goal','source-answer',question+' compatibility details');ledger.prepareReading('goal','source-answer',question+' browser details');const originalGet=ledger.get.bind(ledger);ledger.get=()=>{throw new Error('History metadata must not read full source BLOBs.');};
    const recent=ledger.readingPage('goal',1);expect(recent.readings).toHaveLength(1);expect(recent.readings[0].ranges.every(range=>!('text'in range))).toBe(true);expect(recent.nextCursor).toBeDefined();expect(ledger.readingPage('goal',1,recent.nextCursor).readings[0].id).not.toBe(recent.readings[0].id);expect(ledger.reading('goal','source-answer',{id:first.id},false)?.id).toBe(first.id);expect(()=>ledger.reading('goal','source-answer',{id:first.id})).toThrow('full source BLOBs');ledger.get=originalGet;expect(ledger.reading('other','source-answer',{id:first.id})).toBeUndefined();
    for(const cursor of ['0','01','-1','1e2','9007199254740992',''])expect(()=>ledger.readingPage('goal',1,cursor)).toThrow('cursor');expect(()=>ledger.readingPage('goal',26)).toThrow('limit');
  }finally{db.close();}
});
