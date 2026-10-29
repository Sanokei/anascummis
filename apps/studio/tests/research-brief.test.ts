import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {join,resolve} from 'node:path';
import {mkdtemp,mkdir,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {ResearchBriefStore,BRIEF_WRITER_ROLE} from '../core/research-brief';
import {PublicSourceLedger,describePublicSource,sourceHash} from '../core/public-source';
import type {GoalRecord,GoalTask,SourceAnswer} from '../core/goal-orchestrator';
import type {Infer} from '../core/model';

const signal=()=>new AbortController().signal;
const noop=()=>{};
const question='Where are the compatibility tests and browser results?';
const quote='Compatibility tests live at web-platform-tests/wpt in fetch/. Browser results are at wpt.fyi/results/fetch/.';
const answerText='The compatibility tests are in web-platform-tests/wpt under fetch/. Browser results are displayed at wpt.fyi/results/fetch/.';
async function fixture(options:{real?:boolean;long?:boolean;notes?:string}={}){
  const dir=await mkdtemp(join(tmpdir(),'research-brief-test-')),db=new Database(join(dir,'studio.sqlite'));
  db.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,name TEXT,revision INTEGER,pages INTEGER); CREATE TABLE pdf_versions(doc TEXT,revision INTEGER,label TEXT,PRIMARY KEY(doc,revision));');
  const url='https://example.org/'+(options.long?'evidence'.repeat(90)+'/':'')+'readme',body='# Compatibility guide\n'+quote+'\n',ledger=new PublicSourceLedger(db,async requested=>describePublicSource(requested,{bytes:new TextEncoder().encode(body),type:'text/plain',url:requested}));
  const parent=crypto.randomUUID(),id=crypto.randomUUID(),snapshot=await ledger.capture(parent,'source-1',url,signal(),noop);
  let source:any;db.transaction(()=>{source=ledger.copySnapshots(parent,id,[snapshot.id])[0];})();
  const {plan}=ledger.prepareReading(id,'source-answer',question),range=plan.ranges[0];
  const answer:SourceAnswer={text:answerText,uncertainty:'',limit:'Literal source identity checked; factual accuracy was not independently verified.',readingId:plan.id,answerable:true,supportReview:{supported:true,reason:'The literal quote supplies both requested locations.'},citationMethod:'host-spans-v1',
    citations:[{sourceId:source.id,label:'source-1',quote,offset:body.indexOf(quote),textSha256:source.textSha256,spanId:'source-1:1'}],selections:[{sourceId:source.id,label:'source-1',start:range.start,end:range.end,textSha256:source.textSha256,rangeSha256:range.rangeSha256,text:range.text}]};
  const task:GoalTask={id:'source-brief',specialist:'analysis',sourceBrief:true,description:'Write a brief',acceptance:'Preserve both locations with citations and exact note in a real document.',dependsOn:['source-answer'],status:'running',attempts:1};
  const goal={id,parentGoalId:parent,request:question,projectId:'test-project',research:true,sourceQuestion:{urls:[url]},brief:{parentGoalId:parent,requestKey:crypto.randomUUID(),title:'Fetch compatibility brief',notes:options.notes||''},tasks:[
    {id:'source-1',specialist:'research',sourceUrl:url,status:'verified',execution:{verified:true,sourceId:source.id,evidence:['Synthetic saved source'],message:'saved'},review:{accepted:true,reason:'Synthetic identity check'}},
    {id:'source-answer',specialist:'analysis',sourceAnswer:true,status:'verified',execution:{verified:true,sourceAnswer:answer,evidence:['Synthetic citation'],message:answerText},review:{accepted:true,reason:'Synthetic support acceptance'}},task]} as GoalRecord;
  let renders=0,verifications=0;const calls:{role:string;packet:any}[]=[];
  const engine=async(job:Record<string,any>)=>{
    if(job.op==='research_brief')renders++;else if(job.op==='verify_research_brief')verifications++;
    if(options.real){
      const root=resolve(import.meta.dir,'..'),python=process.env.PYTHON_PATH||join(root,'.venv/bin/python'),proc=Bun.spawn([python,join(root,'worker/pdf_worker.py')],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
      proc.stdin.write(JSON.stringify(job));proc.stdin.end();const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);const value=JSON.parse(out);if(code||!value.ok)throw new Error(value.error||err);return value.result;
    }
    if(job.op==='research_brief')await writeFile(job.output,'%PDF-1.7\nSynthetic renderer receipt, not PDF output acceptance.\n');
    return {pageCount:2,complete:true,contained:true};
  };
  const infer:Infer=async(role,raw)=>{calls.push({role,packet:JSON.parse(raw)});return role===BRIEF_WRITER_ROLE?{paragraphs:[{text:answerText,citations:[1]}]}:{supported:true,reason:'The actual paragraph supplies both locations and is supported by citation 1.'};};
  const store=new ResearchBriefStore(db,ledger,dir,engine);
  return {dir,db,ledger,parent,id,goal,task,answer,source,calls,store,infer,engine,counts:()=>({renders,verifications}),close:async()=>{db.close();await rm(dir,{recursive:true,force:true});}};
}

test('synthetic lifecycle: saved draft survives a stop before review, then one artifact is reused without another writing decision',async()=>{
  const f=await fixture();try{
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,(phase)=>{if(phase==='draft_saved')throw new Error('synthetic stop after saved draft');})).rejects.toThrow('synthetic stop');
    const saved=f.store.state(f.id)!;expect(saved.phase).toBe('draft_saved');expect(saved.draft?.paragraphs[0].text).toBe(answerText);expect(f.calls.length).toBe(1);
    const restarted=new ResearchBriefStore(f.db,f.ledger,f.dir,f.engine),result=await restarted.execute(f.task,f.goal,signal(),f.infer,noop);
    expect(result.verified).toBe(true);expect(result.briefArtifact?.documentId).toBe(saved.id);expect(f.calls.length).toBe(2);expect(f.counts().renders).toBe(1);
    expect(await restarted.review(f.task,f.goal,result,signal())).toMatchObject({accepted:true});expect(await restarted.execute(f.task,f.goal,signal(),f.infer,noop)).toEqual(result);expect(f.calls.length).toBe(2);expect(f.counts().renders).toBe(1);
    expect(f.db.query('SELECT COUNT(*) AS n FROM documents').get()).toEqual({n:1});expect(f.db.query('SELECT COUNT(*) AS n FROM pdf_versions').get()).toEqual({n:1});
  }finally{await f.close();}
});

test('synthetic crash after atomic registration reconciles the same artifact without duplicated writes or native calls',async()=>{
  const f=await fixture();try{
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,(phase)=>{if(phase==='document_saved')throw new Error('synthetic lost completion');})).rejects.toThrow('synthetic lost completion');
    const state=f.store.state(f.id)!;expect(state.phase).toBe('saved');const result=await f.store.execute(f.task,f.goal,signal(),f.infer,noop);expect(result.briefArtifact).toEqual(state.artifact);expect(f.calls.length).toBe(2);expect(f.counts().renders).toBe(1);expect(f.db.query('SELECT COUNT(*) AS n FROM documents').get()).toEqual({n:1});
  }finally{await f.close();}
});

test('synthetic database failure rolls back document, version and artifact together; retry keeps draft and identity',async()=>{
  const f=await fixture();try{
    f.db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON pdf_versions BEGIN SELECT RAISE(ABORT,'synthetic registration failure'); END;");
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('synthetic registration failure');const checkpoint=f.store.state(f.id)!;
    expect(checkpoint.phase).toBe('reviewed');expect(checkpoint.artifact).toBeUndefined();expect(f.db.query('SELECT COUNT(*) AS n FROM documents').get()).toEqual({n:0});
    f.db.exec('DROP TRIGGER fail_registration');const result=await f.store.execute(f.task,f.goal,signal(),f.infer,noop);expect(result.briefArtifact?.documentId).toBe(checkpoint.id);expect(f.calls.length).toBe(2);expect(f.counts().renders).toBe(2);expect(f.db.query('SELECT COUNT(*) AS n FROM pdf_versions').get()).toEqual({n:1});
  }finally{await f.close();}
});

test('a saved negative native support decision stays inspectable and is never silently replaced on retry',async()=>{
  const f=await fixture();try{
    const reject:Infer=async(role,packet,schema,s)=>role===BRIEF_WRITER_ROLE?f.infer(role,packet,schema,s):{supported:false,reason:'The paragraph omits the browser-results location.'};
    await expect(f.store.execute(f.task,f.goal,signal(),reject,noop)).rejects.toThrow('needs more source support');const state=f.store.state(f.id)!;
    expect(state.phase).toBe('rejected');expect(state.supportReview?.supported).toBe(false);expect(state.draft?.paragraphs.length).toBe(1);
    await expect(f.store.execute(f.task,f.goal,signal(),async()=>{throw new Error('must not infer again');},noop)).rejects.toThrow('needs more source support');expect(f.counts().renders).toBe(0);expect(f.store.state(f.id)).toEqual(state);
  }finally{await f.close();}
});

test('changed submitted notes and damaged saved draft fail without overwriting the original checkpoint',async()=>{
  const f=await fixture();try{
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,(phase)=>{if(phase==='draft_saved')throw new Error('pause');})).rejects.toThrow('pause');const saved=f.store.state(f.id)!;
    const changed=structuredClone(f.goal);changed.brief!.notes='A changed submitted note';await expect(f.store.execute(f.task,changed,signal(),f.infer,noop)).rejects.toThrow('input changed');expect(f.store.state(f.id)).toEqual(saved);
    const poison=structuredClone(saved);poison.draft!.paragraphs[0].text='Poisoned';f.db.query('UPDATE research_briefs SET body=? WHERE goal=?').run(JSON.stringify(poison),f.id);expect(()=>f.store.state(f.id)).toThrow('draft changed');expect(f.calls.length).toBe(1);
  }finally{await f.close();}
});

test('source hash, accepted range, citation ownership and accepted dependency are checked before writing',async()=>{
  const f=await fixture();try{
    for(const alter of [(goal:GoalRecord)=>{goal.tasks[1].status='needs_input';},(goal:GoalRecord)=>{goal.tasks[1].execution!.sourceAnswer!.citations[0].offset++;},(goal:GoalRecord)=>{goal.tasks[1].execution!.sourceAnswer!.selections[0].text='changed';},(goal:GoalRecord)=>{goal.parentGoalId=crypto.randomUUID();}]){
      const poisoned=structuredClone(f.goal);alter(poisoned);await expect(f.store.execute(f.task,poisoned,signal(),f.infer,noop)).rejects.toThrow();
    }
    f.db.query('UPDATE goal_sources SET text=? WHERE goal=?').run('altered source',f.id);await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('identity check');expect(f.calls.length).toBe(0);expect(f.store.state(f.id)).toBeUndefined();
  }finally{await f.close();}
});

test('the complete context budget refuses oversized evidence without omission or model submission',async()=>{
  const f=await fixture();try{
    f.goal.tasks[1].execution!.sourceAnswer!.text='Accepted factual answer. '.repeat(160);await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('3,600');expect(f.calls.length).toBe(0);expect(f.store.state(f.id)?.phase).toBe('preparing');
  }finally{await f.close();}
});

test('early HTML/PDF export is read-only and later document edits do not change accepted original downloads',async()=>{
  const f=await fixture();try{
    await expect(f.store.exportHtml(f.goal)).rejects.toThrow('No research brief');await expect(f.store.exportPdf(f.goal)).rejects.toThrow('No research brief');expect(f.db.query('SELECT COUNT(*) AS n FROM research_briefs').get()).toEqual({n:0});
    const result=await f.store.execute(f.task,f.goal,signal(),f.infer,noop),before=await f.store.exportPdf(f.goal);f.db.query('UPDATE documents SET revision=1,pages=9 WHERE id=?').run(result.briefArtifact!.documentId);f.db.query('INSERT INTO pdf_versions VALUES(?,?,?)').run(result.briefArtifact!.documentId,1,'Later edit');await writeFile(join(f.dir,'documents',result.briefArtifact!.documentId,'1.pdf'),'%PDF-a later edit');
    expect(await f.store.exportPdf(f.goal)).toEqual(before);expect(sourceHash(before.bytes)).toBe(result.briefArtifact!.pdfSha256);expect((await f.store.exportHtml(f.goal)).name).toEndWith('.html');
  }finally{await f.close();}
});

test('saved artifact damage and a forged review receipt fail without regeneration',async()=>{
  const f=await fixture();try{
    const result=await f.store.execute(f.task,f.goal,signal(),f.infer,noop),forged=structuredClone(result);forged.briefArtifact!.pdfSha256='a'.repeat(64);await expect(f.store.review(f.task,f.goal,forged,signal())).rejects.toThrow('receipt');
    await writeFile(join(f.dir,'documents',result.briefArtifact!.documentId,'0.pdf'),'%PDF-poison');await expect(f.store.exportHtml(f.goal)).rejects.toThrow('bytes changed');await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('bytes changed');expect(f.calls.length).toBe(2);expect(f.counts().renders).toBe(1);
  }finally{await f.close();}
});

test('synthetic filesystem boundary: a pre-created document-folder symlink is refused',async()=>{
  const f=await fixture(),outside=await mkdtemp(join(tmpdir(),'research-brief-outside-'));try{
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,(phase)=>{if(phase==='draft_saved')throw new Error('pause');})).rejects.toThrow('pause');const id=f.store.state(f.id)!.id;await mkdir(join(f.dir,'documents'));await symlink(outside,join(f.dir,'documents',id));await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('owned directory');expect(f.counts().renders).toBe(0);
  }finally{await f.close();await rm(outside,{recursive:true,force:true});}
});

test('real fixed PDF renderer paginates and preserves every title/note/citation/long URL/hash; HTML is escaped and self-contained',async()=>{
  const note='Literal note <img src="https://example.org/private" onerror="alert(1)"> & keep this exact. CSS url(example) and @import are inert note text.\n'+'User planning note with deliberately repeated words for a real pagination check. '.repeat(12),f=await fixture({real:true,long:true,notes:note});try{
    const result=await f.store.execute(f.task,f.goal,signal(),f.infer,noop),artifact=result.briefArtifact!;expect(artifact.pages).toBeGreaterThan(1);expect(artifact.pages).toBeLessThan(20);
    const exported=await f.store.exportHtml(f.goal),html=new TextDecoder().decode(exported.bytes);expect(sourceHash(exported.bytes)).toBe(artifact.htmlSha256);expect(html).toContain('&lt;img src=&quot;https://example.org/private&quot; onerror=&quot;alert(1)&quot;&gt;');expect(html).not.toContain('<img');expect(html).toContain(f.source.url);expect(html).toContain(f.source.textSha256);expect(html).toContain('Your note — supplied by you, not a source claim');
    const pdf=await readFile(join(f.dir,'documents',artifact.documentId,'0.pdf'));expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(sourceHash(pdf)).toBe(artifact.pdfSha256);expect(await f.store.review(f.task,f.goal,result,signal())).toMatchObject({accepted:true});expect(f.calls.map(c=>c.role===BRIEF_WRITER_ROLE?'writer':'reviewer')).toEqual(['writer','reviewer']);expect(f.calls[0].packet.acceptedAnswer.text).toBe(answerText);expect(f.calls[0].packet.citations[0].quote).toBe(quote);expect(f.calls[0].packet.selectedPassages[0].text).toBe(f.answer.selections[0].text);
  }finally{await f.close();}
},20000);
