import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {join,resolve} from 'node:path';
import {mkdtemp,rm,readFile,writeFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {ResearchBriefStore,BRIEF_WRITER_ROLE} from '../core/research-brief';
import {ResearchBriefEditStore,DOCUMENT_EDIT_ROLE,DOCUMENT_EDIT_LABELLED_ROLE,DOCUMENT_EDIT_SENTENCE_ROLE,validateDocumentEditLabels} from '../core/research-brief-edit';
import {PublicSourceLedger,describePublicSource,sourceHash} from '../core/public-source';
import {GROUNDED_DOCUMENT_SENTENCE_ROLE} from '../core/research-brief-edit-selection';
import {GoalOrchestrator,type GoalRecord,type GoalTask,type SourceAnswer} from '../core/goal-orchestrator';
import type {Infer} from '../core/model';

const signal=()=>new AbortController().signal,noop=()=>{};
const question='Where are the Fetch tests kept and where are browser results displayed?';
const quoteTests='Fetch tests are in `fetch/` in [`web-platform-tests/wpt`](https://github.com/web-platform-tests/wpt).';
const quoteResults='Browser results are at [wpt.fyi/results/fetch](https://wpt.fyi/results/fetch).';
const quote=quoteTests+' '+quoteResults;
const before='Fetch tests are kept in fetch/ in web-platform-tests/wpt. Browser results are displayed at wpt.fyi/results/fetch.';
const after='Tests: Fetch tests are kept in fetch/ in web-platform-tests/wpt. Browser results: results are displayed at wpt.fyi/results/fetch.';
const intent='Rewrite the summary as two short sentences beginning Tests: and Browser results:. Keep both exact locations and citations.';

async function fixture(real=false,separateCitations=false){
  const dir=await mkdtemp(join(tmpdir(),'research-brief-edit-')),db=new Database(join(dir,'studio.sqlite'));
  db.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,name TEXT,revision INTEGER,pages INTEGER); CREATE TABLE pdf_versions(doc TEXT,revision INTEGER,label TEXT,PRIMARY KEY(doc,revision)); CREATE TABLE goal_tasks(id TEXT PRIMARY KEY,body TEXT,updated INTEGER);');
  const url='https://example.org/fetch-guide',body='# Fetch guide\n'+quote,ledger=new PublicSourceLedger(db,async requested=>describePublicSource(requested,{bytes:new TextEncoder().encode(body),type:'text/plain',url:requested}));
  const ancestor=crypto.randomUUID(),parentId=crypto.randomUUID(),source=await ledger.capture(ancestor,'source-1',url,signal(),noop);
  let copy:any;db.transaction(()=>{copy=ledger.copySnapshots(ancestor,parentId,[source.id])[0];})();
  const {plan}=ledger.prepareReading(parentId,'source-answer',question),range=plan.ranges[0];
  const answer:SourceAnswer={text:before,uncertainty:'',limit:'These saved source claims have not been independently fact checked.',readingId:plan.id,answerable:true,supportReview:{supported:true,reason:'Both requested locations occur in the saved passage.'},citationMethod:'host-spans-v1',
    citations:(separateCitations?[quoteTests,quoteResults]:[quote]).map((text,index)=>({sourceId:copy.id,label:'source-1',quote:text,offset:body.indexOf(text),textSha256:copy.textSha256,spanId:'source-1:'+(index+1)})),selections:[{sourceId:copy.id,label:'source-1',start:range.start,end:range.end,textSha256:copy.textSha256,rangeSha256:range.rangeSha256,text:range.text}]};
  const notes=Array.from({length:34},(_,i)=>`Personal handoff ${String(i+1).padStart(2,'0')}: preserve this entire exact note.`).join('\n');
  const briefTask:GoalTask={id:'source-brief',specialist:'analysis',sourceBrief:true,description:'Write brief',acceptance:'Keep complete notes and evidence',dependsOn:['source-answer'],status:'running',attempts:1};
  const parent={id:parentId,parentGoalId:ancestor,request:question,projectId:'test-workspace',research:true,sourceQuestion:{urls:[url]},brief:{parentGoalId:ancestor,requestKey:crypto.randomUUID(),title:'Fetch contributor brief',notes},status:'running',phase:'executing',coverageDone:false,tasks:[
    {id:'source-1',specialist:'research',sourceUrl:url,status:'verified',execution:{verified:true,sourceId:copy.id,evidence:['Synthetic identity fixture'],message:'saved'},review:{accepted:true,reason:'Hash-checked fixture'}},
    {id:'source-answer',specialist:'analysis',sourceAnswer:true,status:'verified',execution:{verified:true,sourceAnswer:answer,evidence:['Synthetic answer fixture'],message:before},review:{accepted:true,reason:'Injected support acceptance'}},briefTask]} as GoalRecord;
  let renders=0,inspections=0;const calls:{role:string;packet:any}[]=[];
  const engine=async(job:Record<string,any>)=>{
    if(job.op==='research_brief')renders++;if(job.op==='inspect')inspections++;
    if(real){
      const root=resolve(import.meta.dir,'..'),python=process.env.PYTHON_PATH||join(root,'.venv/bin/python');
      // Keep the actual PDF worker and assertions. In the mixed browser-test
      // host Bun.spawn's exited promise twice hung with an already-zombie child;
      // the stdlib callback also owns exit/error/timeout and drains both streams.
      return await new Promise<any>((resolve,reject)=>{
        const child=execFile(python,[join(root,'worker/pdf_worker.py')],{encoding:'utf8',maxBuffer:4_000_000,timeout:10_000,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}},(error,out,err)=>{
          if(error){reject(new Error('Fixture PDF '+String(job.op)+' subprocess failed: '+(err||error.message),{cause:error}));return;}
          try{const value=JSON.parse(out);if(!value.ok)throw new Error(value.error||err||'Fixture PDF worker failed');resolve(value.result);}catch(error){reject(error);}
        });
        child.stdin!.end(JSON.stringify(job));
      });
    }
    if(job.op==='research_brief')await writeFile(job.output,'%PDF-1.7\nSynthetic render '+renders+'; native quality and real PDF rendering are not established by this fixture.\n');
    if(job.op==='inspect')return {pageCount:2,pages:[{page:1,text:before},{page:2,text:notes}]};
    return {pageCount:2,complete:true,contained:true,links:job.args?.expectedLinks||[],linksContained:true};
  };
  const briefs=new ResearchBriefStore(db,ledger,dir,engine),briefInfer:Infer=async role=>role===BRIEF_WRITER_ROLE?{paragraphs:[{text:before,citations:separateCitations?[1,2]:[1]}]}:{supported:true,reason:'Injected source support, not native quality.'};
  const original=await briefs.execute(briefTask,parent,signal(),briefInfer,noop);Object.assign(briefTask,{status:'verified',execution:original,review:{accepted:true,reason:'Host original fixture acceptance'}});Object.assign(parent,{status:'completed',coverageDone:true});
  db.query('INSERT INTO goal_tasks VALUES(?,?,?)').run(parent.id,JSON.stringify(parent),Date.now());
  const store=new ResearchBriefEditStore(db,briefs,dir,engine),request=await store.prepare(parent,{requestKey:crypto.randomUUID(),intent});
  const task:GoalTask={id:'native-brief-edit',specialist:'pdf',documentEdit:true,description:'Propose summary edit',acceptance:'Keep original notes and citations; apply only after approval',dependsOn:[],status:'running',attempts:1};
  const goal={id:crypto.randomUUID(),parentGoalId:parent.id,request:intent,projectId:parent.projectId,documentId:request.documentId,documentEdit:request,status:'running',tasks:[task]} as GoalRecord;
  db.query('INSERT INTO goal_tasks VALUES(?,?,?)').run(goal.id,JSON.stringify(goal),Date.now());
  const infer:Infer=async(role,raw)=>{calls.push({role,packet:JSON.parse(raw)});return role===DOCUMENT_EDIT_ROLE?{paragraphs:[{text:after,citations:[1]}]}:{supported:true,reason:'Injected review: the two requested labelled sentences retain both exact locations and the literal citation.'};};
  const originalPdf=await readFile(join(dir,'documents',request.documentId,'0.pdf')),originalHtml=await readFile(join(dir,'documents',request.documentId,'brief.html'));
  return {dir,db,ledger,parent,goal,task,store,briefs,engine,infer,calls,notes,originalPdf,originalHtml,counts:()=>({renders,inspections}),restart:()=>new ResearchBriefEditStore(db,briefs,dir,engine),close:async()=>{db.close();await rm(dir,{recursive:true,force:true});}};
}

async function propose(f:Awaited<ReturnType<typeof fixture>>){await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('proposal is ready');f.goal.status='needs_input';f.db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(f.goal),f.goal.id);const state=f.store.state(f.goal.id)!;expect(state.phase).toBe('awaiting_approval');return state;}
async function approve(f:Awaited<ReturnType<typeof fixture>>){f.db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(f.goal),f.goal.id);const state=f.store.state(f.goal.id)!;return await f.store.approve(f.goal,{operationId:state.operationId,proposalSha256:state.proposalSha256!});}

test('proposal is durable read-only work; Continue does not approve and exact approval creates one version without another native decision',async()=>{
  const f=await fixture();try{
    const state=await propose(f);expect(f.calls.length).toBe(2);expect(state.before.paragraphs[0].text).toBe(before);expect(state.proposal?.paragraphs[0].text).toBe(after);expect(state.preserved.notes).toBe(f.notes);expect(state.inspectBase.pages.length).toBe(2);
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:1});
    await expect(f.restart().execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('proposal is ready');expect(f.calls.length).toBe(2);expect(f.store.state(f.goal.id)!.operationId).toBe(state.operationId);
    await approve(f);const result=await f.restart().execute(f.task,f.goal,signal(),f.infer,noop);expect(result.verified).toBe(true);expect(result.documentEditArtifact).toMatchObject({operationId:state.operationId,documentId:f.goal.documentId!,revision:1});
    expect((await f.store.review(f.task,f.goal,result,signal())).accepted).toBe(true);expect(f.calls.length).toBe(2);expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:2});
    expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'brief.html'))).toEqual(f.originalHtml);
    const provenance=JSON.parse(new TextDecoder().decode((await f.store.export(f.goal,'provenance-json')).bytes));expect(provenance.evidence.originalBrief.input.notes).toBe(f.notes);expect(provenance.evidence.originalBrief.input.answer.citations[0].quote).toBe(quote);expect(provenance.evidence.nativeEdit.raw).toEqual(state.writingAttempt!.raw);
    const count=f.counts().renders;expect(await f.store.execute(f.task,f.goal,signal(),f.infer,noop)).toEqual(result);expect(f.counts().renders).toBe(count);expect(f.calls.length).toBe(2);
    for(const call of f.calls){expect(call.packet.acceptedAnswer).toBe(before);expect(call.packet.citations[0].quote).toBe(quote);expect(JSON.stringify(call.packet)).not.toContain(f.notes);}
  }finally{await f.close();}
});

test('interruption immediately after saving the native proposal reuses it and performs only the missing support decision',async()=>{
  const f=await fixture();try{
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,phase=>{if(phase==='edit_proposal_saved')throw new Error('injected proposal interruption');})).rejects.toThrow('injected proposal interruption');const saved=f.store.state(f.goal.id)!;expect(saved.phase).toBe('proposal_saved');expect(f.calls.length).toBe(1);
    await expect(f.restart().execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('proposal is ready');expect(f.calls.length).toBe(2);expect(f.store.state(f.goal.id)!.writingAttempt).toEqual(saved.writingAttempt);expect(f.store.state(f.goal.id)!.proposalSha256).toBe(saved.proposalSha256);expect(f.counts().renders).toBe(1);
  }finally{await f.close();}
});

test('interrupted rendered-files checkpoint adopts the exact bytes and registers one revision without rerendering or repeat inference',async()=>{
  const f=await fixture();try{
    await propose(f);await approve(f);await expect(f.store.execute(f.task,f.goal,signal(),f.infer,phase=>{if(phase==='edit_rendered')throw new Error('injected rendered interruption');})).rejects.toThrow('injected rendered interruption');
    const state=f.store.state(f.goal.id)!,rendered=await readFile(join(f.dir,'documents',f.goal.documentId!,'edits',state.operationId,'revised.pdf'));expect(state.phase).toBe('rendered');expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});const count=f.counts().renders;
    const result=await f.restart().execute(f.task,f.goal,signal(),f.infer,noop);expect(result.documentEditArtifact?.pdfSha256).toBe(sourceHash(rendered));expect(f.counts().renders).toBe(count);expect(f.calls.length).toBe(2);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'1.pdf'))).toEqual(rendered);expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=1').get()).toEqual({n:1});
  }finally{await f.close();}
});

test('lost completion and a rolled-back SQL registration retain the same operation and rendered files',async()=>{
  const f=await fixture();try{
    await propose(f);await approve(f);f.db.exec("CREATE TRIGGER fail_edit_registration BEFORE INSERT ON pdf_versions WHEN NEW.revision=1 BEGIN SELECT RAISE(ABORT,'injected registration failure'); END;");
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('injected registration failure');const state=f.store.state(f.goal.id)!;expect(state.phase).toBe('rendered');expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});const count=f.counts().renders;
    f.db.exec('DROP TRIGGER fail_edit_registration');await expect(f.restart().execute(f.task,f.goal,signal(),f.infer,phase=>{if(phase==='document_edit_saved')throw new Error('injected lost completion');})).rejects.toThrow('injected lost completion');expect(f.store.state(f.goal.id)!.phase).toBe('saved');
    const result=await f.restart().execute(f.task,f.goal,signal(),f.infer,noop);expect(result.documentEditArtifact?.operationId).toBe(state.operationId);expect(f.counts().renders).toBe(count);expect(f.calls.length).toBe(2);expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:2});
  }finally{await f.close();}
});

test('approval binds the exact operation and proposal; stopped goals and changed intent cannot publish',async()=>{
  const f=await fixture();try{
    const state=await propose(f);for(const wrong of [{operationId:crypto.randomUUID(),proposalSha256:state.proposalSha256!},{operationId:state.operationId,proposalSha256:'a'.repeat(64)}])await expect(Promise.resolve().then(()=>f.store.approve(f.goal,wrong))).rejects.toThrow('does not match');
    f.goal.status='cancelled';await expect(Promise.resolve().then(()=>approve(f))).rejects.toThrow();f.goal.status='needs_input';
    const changed=structuredClone(f.goal);changed.documentEdit!.intent='A different unsaved intent';changed.request=changed.documentEdit!.intent;await expect(f.store.execute(f.task,changed,signal(),f.infer,noop)).rejects.toThrow('request changed');expect(f.calls.length).toBe(2);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});
  }finally{await f.close();}
});

test('source-support rejection stays inspectable and cannot be turned into silent regeneration or approval',async()=>{
  const f=await fixture();try{
    const reject:Infer=async(role,packet,schema,sig)=>role===DOCUMENT_EDIT_ROLE?f.infer(role,packet,schema,sig):{supported:false,reason:'The proposed wording does not satisfy the exact requested intent.'};
    await expect(f.store.execute(f.task,f.goal,signal(),reject,noop)).rejects.toThrow('needs support');const state=f.store.state(f.goal.id)!;expect(state.phase).toBe('rejected');expect(state.proposal?.paragraphs[0].text).toBe(after);expect(state.supportReview?.supported).toBe(false);
    await expect(f.restart().execute(f.task,f.goal,signal(),async()=>{throw new Error('must not infer again');},noop)).rejects.toThrow('needs support');f.goal.status='needs_input';await expect(Promise.resolve().then(()=>approve(f))).rejects.toThrow();expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.counts().renders).toBe(1);
  }finally{await f.close();}
});

test('introduced URLs and changed citation selection fail before native over-acceptance or publication',async()=>{
  for(const draft of [{paragraphs:[{text:after+' Read https://invented.example/new.',citations:[1]}]},{paragraphs:[{text:after,citations:[2]}]}]){
    const f=await fixture();try{let calls=0;await expect(f.store.execute(f.task,f.goal,signal(),async()=>{calls++;return draft;},noop)).rejects.toThrow('host check');const state=f.store.state(f.goal.id)!;expect(state.phase).toBe('rejected');expect(state.writingAttempt?.raw).toEqual(draft);expect(state.supportReview).toBeUndefined();expect(calls).toBe(1);expect(f.counts().renders).toBe(1);}finally{await f.close();}
  }
});

test('original-file tampering and a conflicting revision are detected after a proposal without overwriting accepted files',async()=>{
  for(const conflict of ['original','revision'] as const){const f=await fixture();try{
    await propose(f);if(conflict==='original')await writeFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'),'%PDF-1.7\nmodified outside edit');else{f.db.query('UPDATE documents SET revision=1 WHERE id=?').run(f.goal.documentId!);f.db.query('INSERT INTO pdf_versions VALUES(?,?,?)').run(f.goal.documentId!,1,'Unknown external revision');await writeFile(join(f.dir,'documents',f.goal.documentId!,'1.pdf'),'EXTERNAL REVISION MUST STAY');}
    await expect(Promise.resolve().then(()=>approve(f))).rejects.toThrow();expect(f.calls.length).toBe(2);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'brief.html'))).toEqual(f.originalHtml);if(conflict==='revision')expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'1.pdf'),'utf8')).toBe('EXTERNAL REVISION MUST STAY');
  }finally{await f.close();}}
});

test('damaged native response, proposal or complete-note checkpoint is rejected while its original saved bytes remain inspectable',async()=>{
  for(const damage of ['native','proposal','notes'] as const){const f=await fixture();try{
    await propose(f);const row=f.db.query('SELECT body FROM research_brief_edits WHERE goal=?').get(f.goal.id) as {body:string},body=JSON.parse(row.body);if(damage==='native')body.writingAttempt.raw={paragraphs:[{text:'changed',citations:[1]}]};else if(damage==='proposal')body.proposal.paragraphs[0].text='changed';else body.preserved.notes='shortened';
    f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(JSON.stringify(body),f.goal.id);expect(()=>f.store.state(f.goal.id)).toThrow();expect(f.calls.length).toBe(2);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);
  }finally{await f.close();}}
});

test('real renderer: revised multi-page PDF/HTML retains complete notes and exact raw citations in separate provenance',async()=>{
  const f=await fixture(true);try{
    const state=await propose(f);expect(state.inspectBase.pages.length).toBeGreaterThanOrEqual(2);await approve(f);const result=await f.store.execute(f.task,f.goal,signal(),f.infer,noop);expect(result.documentEditArtifact?.pages).toBeGreaterThanOrEqual(2);
    const pdf=await f.store.export(f.goal,'pdf'),html=new TextDecoder().decode((await f.store.export(f.goal,'html')).bytes),provenance=JSON.parse(new TextDecoder().decode((await f.store.export(f.goal,'provenance-json')).bytes));expect(new TextDecoder().decode(pdf.bytes.slice(0,5))).toBe('%PDF-');expect(html).toContain('Tests:');expect(html).toContain('Browser results:');expect(html).not.toContain('Response SHA-256:');expect(html).not.toContain('Snapshot:');expect(html).not.toContain('](https://');expect(html).toContain('https://github.com/web-platform-tests/wpt');expect(provenance.evidence.originalBrief.input.notes).toBe(f.notes);expect(provenance.evidence.originalBrief.input.answer.citations[0].quote).toBe(quote);expect(provenance.evidence.originalBrief.state.artifact.pdfSha256).toBe(sourceHash(f.originalPdf));
    expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'brief.html'))).toEqual(f.originalHtml);expect(f.calls.length).toBe(2);const beforeEntries=await readdir(join(f.dir,'documents',f.goal.documentId!,'edits',state.operationId));await f.store.export(f.goal,'pdf');expect(await readdir(join(f.dir,'documents',f.goal.documentId!,'edits',state.operationId))).toEqual(beforeEntries);
  }finally{await f.close();}
},30000);


test('duplicated citation numbers are rejected before support review, approval or document revision',async()=>{
  const f=await fixture();try{
    const duplicated={paragraphs:[{text:after,citations:[1,1]}]};let calls=0;
    await expect(f.store.execute(f.task,f.goal,signal(),async()=>{calls++;return duplicated;},noop)).rejects.toThrow('without duplicates');
    const state=f.store.state(f.goal.id)!;expect(state.phase).toBe('rejected');expect(state.writingAttempt?.raw).toEqual(duplicated);expect(state.draftCheck?.accepted).toBe(false);expect(state.supportReview).toBeUndefined();
    f.goal.status='needs_input';await expect(approve(f)).rejects.toThrow();expect(calls).toBe(1);expect(f.counts().renders).toBe(1);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:1});
  }finally{await f.close();}
});

test('an unregistered unknown revision file is preserved and never claimed as this edit after publication collision',async()=>{
  const f=await fixture();try{
    const proposed=await propose(f);await approve(f);const path=join(f.dir,'documents',f.goal.documentId!,'1.pdf'),unknown=Buffer.from('%PDF-1.7\nUnknown existing revision, preserve exactly.\n');await writeFile(path,unknown,{flag:'wx'});
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('No file was replaced');
    const state=f.store.state(f.goal.id)!;expect(state.phase).toBe('rendered');expect(state.operationId).toBe(proposed.operationId);expect(state.artifact?.pdfSha256).not.toBe(sourceHash(unknown));expect(await readFile(path)).toEqual(unknown);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=1').get()).toEqual({n:0});
    const renders=f.counts().renders;await expect(f.restart().execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('No file was replaced');expect(f.counts().renders).toBe(renders);expect(f.calls.length).toBe(2);expect(await readFile(path)).toEqual(unknown);await expect(f.store.export(f.goal,'pdf')).rejects.toThrow('finish this reviewed edit');expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);
  }finally{await f.close();}
});

test('an impossible saved phase without its artifact cannot become a false completed revision',async()=>{
  const f=await fixture();try{
    await propose(f);const row=f.db.query('SELECT body FROM research_brief_edits WHERE goal=?').get(f.goal.id) as {body:string},body=JSON.parse(row.body);body.phase='saved';body.approvedProposalSha256=body.proposalSha256;delete body.artifact;
    f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(JSON.stringify(body),f.goal.id);
    expect(()=>f.store.state(f.goal.id)).toThrow('artifact identity');await expect(f.store.export(f.goal,'pdf')).rejects.toThrow('artifact identity');await expect(f.restart().execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('artifact identity');
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:1});expect(f.counts().renders).toBe(1);expect(f.calls.length).toBe(2);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);
  }finally{await f.close();}
});

test('a symlink at the prospective revision path cannot overwrite its target or register an edit',async()=>{
  const f=await fixture();try{
    await propose(f);await approve(f);const target=join(f.dir,'unrelated-protected-file.txt'),sentinel='This unrelated file must never be overwritten.';await writeFile(target,sentinel);await symlink(target,join(f.dir,'documents',f.goal.documentId!,'1.pdf'));
    await expect(f.store.execute(f.task,f.goal,signal(),f.infer,noop)).rejects.toThrow('ordinary owned file');expect(await readFile(target,'utf8')).toBe(sentinel);expect(f.store.state(f.goal.id)!.phase).toBe('rendered');expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=1').get()).toEqual({n:0});expect(f.calls.length).toBe(2);
  }finally{await f.close();}
});

test('Stop during asynchronous original verification or page inspection creates no late edit checkpoint or native decision',async()=>{
  for(const boundary of ['snapshot','inspect'] as const){
    const f=await fixture();let release!:()=>void,entered!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
    try{
      let intercepted=false;
      const gated=async(job:Record<string,any>)=>{
        if(!intercepted&&job.op===(boundary==='snapshot'?'verify_research_brief':'inspect')){intercepted=true;entered();await blocked;}
        return f.engine(job);
      };
      const briefs=new ResearchBriefStore(f.db,f.ledger,f.dir,gated),store=new ResearchBriefEditStore(f.db,briefs,f.dir,gated),control=new AbortController();
      const running=store.execute(f.task,f.goal,control.signal,f.infer,noop);await waiting;
      expect(store.state(f.goal.id)).toBeUndefined();f.goal.status='cancelled';f.db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(f.goal),f.goal.id);
      control.abort(new Error('Stopped during '+boundary));release();
      await expect(running).rejects.toThrow('Stopped during '+boundary);
      expect(store.state(f.goal.id)).toBeUndefined();expect(f.db.query('SELECT COUNT(*) n FROM research_brief_edits').get()).toEqual({n:0});expect(f.calls.length).toBe(0);
      expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:1});expect(f.counts().renders).toBe(1);
      expect(f.counts().inspections).toBe(boundary==='snapshot'?0:1);expect((JSON.parse((f.db.query('SELECT body FROM goal_tasks WHERE id=?').get(f.goal.id) as {body:string}).body) as GoalRecord).status).toBe('cancelled');
      expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'brief.html'))).toEqual(f.originalHtml);
    }finally{release();await f.close();}
  }
});

test('Stop while Apply verifies the original wins over its stale needs-input snapshot and cannot save approval',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
  try{
    const proposed=await propose(f);let intercepted=false;
    const gated=async(job:Record<string,any>)=>{if(!intercepted&&job.op==='verify_research_brief'){intercepted=true;entered();await blocked;}return f.engine(job);};
    const briefs=new ResearchBriefStore(f.db,f.ledger,f.dir,gated),store=new ResearchBriefEditStore(f.db,briefs,f.dir,gated),stale=structuredClone(f.goal);
    const applying=store.approve(stale,{operationId:proposed.operationId,proposalSha256:proposed.proposalSha256!});await waiting;
    f.goal.status='cancelled';f.db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(f.goal),f.goal.id);release();
    await expect(applying).rejects.toThrow('This edit is stopped');
    const saved=store.state(f.goal.id)!;expect(saved.phase).toBe('awaiting_approval');expect(saved.approvedProposalSha256).toBeUndefined();expect(saved.proposalSha256).toBe(proposed.proposalSha256);expect(saved.writingAttempt).toEqual(proposed.writingAttempt);
    expect((JSON.parse((f.db.query('SELECT body FROM goal_tasks WHERE id=?').get(f.goal.id) as {body:string}).body) as GoalRecord).status).toBe('cancelled');expect(f.calls.length).toBe(2);expect(f.counts().renders).toBe(1);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:1});
    expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'brief.html'))).toEqual(f.originalHtml);
  }finally{release();await f.close();}
});

async function requestLabels(f:Awaited<ReturnType<typeof fixture>>,editIntent=intent,sentenceLabels:[string,string]=['Tests:','Browser results:']){
  const request=await f.store.prepare(f.parent,{requestKey:crypto.randomUUID(),intent:editIntent,sentenceLabels});
  f.goal.documentEdit=request;f.goal.request=editIntent;f.db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(f.goal),f.goal.id);return request;
}

// Injected model decisions and an injected process boundary: genuine native
// writing/host SIGKILL acceptance is recorded separately by the browser journey.
test('grounded sentence checkpoints preserve the exact host selection and first response across interruption before completing one version',async()=>{
  const f=await fixture(true,true);try{
    await requestLabels(f);
    const raw={first:{text:'  Tests: Fetch tests are kept in fetch/ in web-platform-tests/wpt.  ',citations:[1]},second:{text:'Browser results: Browser results are displayed at wpt.fyi/results/fetch.',citations:[2]}};
    const calls:string[]=[],writers:{prompt:string;schema:Record<string,any>}[]=[],reviews:any[]=[];
    const infer:Infer=async(role,packet,schema)=>{
      if(role===GROUNDED_DOCUMENT_SENTENCE_ROLE){
        const slot=packet.startsWith('Requested topic: Tests:\n')?'first':'second';calls.push(slot);writers.push({prompt:packet,schema});return raw[slot];
      }
      calls.push('review');reviews.push(JSON.parse(packet));return {supported:true,reason:'Injected support accepts both literal source facts and user labels; this is not native model-quality proof.'};
    };
    await expect(f.store.execute(f.task,f.goal,signal(),infer,phase=>{if(phase==='first_sentence_saved')throw new Error('injected first-sentence stop');})).rejects.toThrow('first-sentence stop');
    const first=f.store.state(f.goal.id)!;
    expect(first.phase).toBe('preparing');expect(first.writingMode).toBe('grounded-labelled-sentences-v3');
    expect(first.sentenceAttempts?.first?.raw).toEqual(raw.first);expect(first.sentenceAttempts?.first?.sha256).toBe(sourceHash(JSON.stringify(raw.first)));
    expect(first.sentenceAttempts?.second).toBeUndefined();expect(first.writingAttempt).toBeUndefined();expect(calls).toEqual(['first']);
    const selected=first.sentenceSelections!.first!;
    expect(selected.selectedNumber).toBe(1);expect(selected.selectedQuote).toBe(quoteTests);expect(selected.selectedQuoteSha256).toBe(sourceHash(quoteTests));
    expect(selected.candidates.map(candidate=>candidate.number)).toEqual([1,2]);
    const originalCitations=f.parent.tasks.find(task=>task.sourceAnswer)!.execution!.sourceAnswer!.citations;
    expect(selected.candidates[0]).toMatchObject({sourceId:originalCitations[0].sourceId,offset:originalCitations[0].offset,textSha256:originalCitations[0].textSha256,quoteSha256:sourceHash(quoteTests)});
    expect(selected.queryTerms).toEqual(['test']);expect(first.sentenceSelections?.second).toBeUndefined();
    await expect(f.restart().execute(f.task,f.goal,signal(),infer,noop)).rejects.toThrow('proposal is ready');
    const saved=f.store.state(f.goal.id)!,projected='Tests: Fetch tests are kept in fetch/ in web-platform-tests/wpt. Browser results: Browser results are displayed at wpt.fyi/results/fetch.';
    expect(calls).toEqual(['first','second','review']);expect(saved.sentenceAttempts?.first).toEqual(first.sentenceAttempts?.first);expect(saved.sentenceSelections?.first).toEqual(first.sentenceSelections?.first);
    expect(saved.sentenceSelections?.second).toMatchObject({label:'Browser results:',queryTerms:['browser','result'],selectedNumber:2,selectedQuote:quoteResults,selectedQuoteSha256:sourceHash(quoteResults)});
    expect(saved.sentenceAttempts?.second?.raw).toEqual(raw.second);expect(saved.writingAttempt?.raw).toEqual(raw);expect(saved.writingAttempt?.origin).toBe('aggregate-of-two-grounded-native-decisions-v3');
    expect(saved.writingAttempt?.decisionHashes).toEqual({first:sourceHash(JSON.stringify(raw.first)),second:sourceHash(JSON.stringify(raw.second))});
    expect(saved.proposal).toEqual({paragraphs:[{text:projected,citations:[1,2]}]});expect(saved.projection).toMatchObject({version:'brief-grounded-labelled-sentences-v3',rawSha256:sourceHash(JSON.stringify(raw)),proposalSha256:sourceHash(JSON.stringify(saved.proposal)),sentenceSha256:saved.writingAttempt?.decisionHashes});
    expect(saved.projection?.method).toContain('not model evidence choice');expect(saved.projection?.method).toContain('No factual text is authored or rewritten');
    expect(writers.length).toBe(2);
    for(const [index,writer] of writers.entries()){
      expect(writer.prompt).toContain(index===0?quoteTests:quoteResults);expect(writer.prompt).not.toContain(index===0?quoteResults:quoteTests);
      expect(writer.prompt).not.toContain(intent);expect(writer.prompt).not.toContain(before);expect(writer.prompt).not.toContain(f.notes);
      expect((writer.schema.properties.citations as any).items.enum).toEqual([index+1]);
    }
    expect(reviews.length).toBe(1);expect(reviews[0].intent).toBe(intent);expect(reviews[0].acceptedAnswer).toBe(before);expect(reviews[0].originalParagraphs).toEqual(saved.before.paragraphs);
    expect(reviews[0].citations).toEqual([{number:1,quote:quoteTests},{number:2,quote:quoteResults}]);expect(reviews[0].selectedPassages).toBeUndefined();expect(JSON.stringify(reviews[0])).not.toContain(f.notes);
    f.goal.status='needs_input';await approve(f);const result=await f.restart().execute(f.task,f.goal,signal(),infer,noop);
    expect(result.documentEditArtifact?.revision).toBe(1);expect(result.documentEditArtifact?.pages).toBeGreaterThanOrEqual(2);expect(calls).toEqual(['first','second','review']);
    const actualPdf=await f.store.export(f.goal,'pdf'),actualHtml=new TextDecoder().decode((await f.store.export(f.goal,'html')).bytes);expect(new TextDecoder().decode(actualPdf.bytes.slice(0,5))).toBe('%PDF-');expect(actualHtml).toContain(f.notes.replace(/\n/g,'<br>'));expect(actualHtml).toContain('https://github.com/web-platform-tests/wpt');expect(actualHtml).toContain('https://wpt.fyi/results/fetch');
    const provenance=JSON.parse(new TextDecoder().decode((await f.store.export(f.goal,'provenance-json')).bytes));
    expect(provenance.evidence.nativeEdit.raw).toEqual(raw);expect(provenance.evidence.sentenceAttempts).toEqual(saved.sentenceAttempts);expect(provenance.evidence.sentenceSelections).toEqual(saved.sentenceSelections);expect(provenance.evidence.projection).toEqual(saved.projection);
    expect(provenance.evidence.originalBrief.input.notes).toBe(f.notes);expect(provenance.evidence.request.sentenceLabels).toEqual(['Tests:','Browser results:']);
    expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'brief.html'))).toEqual(f.originalHtml);
  }finally{await f.close();}
},20000);

test('a historical native-like single-sentence proposal and false positive model review cannot waive exact quoted prefixes on Apply or Continue',async()=>{
  const f=await fixture();try{
    const exactIntent='Rewrite the brief summary into two short sentences. Start the first sentence with “Tests:” and the second with “Browser results:”. Keep both exact locations and citation numbers; do not change my notes or evidence.';
    f.goal.documentEdit!.intent=exactIntent;f.goal.request=exactIntent;f.db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(f.goal),f.goal.id);
    const bad={paragraphs:[{text:'Tests: The Fetch Standard’s tests are kept in the `fetch/` directory of `web-platform-tests/wpt` and can be seen at [wpt.fyi/results/fetch](https://wpt.fyi/results/fetch).',citations:[1]}]};let calls=0;
    await expect(f.store.execute(f.task,f.goal,signal(),async()=>{calls++;return bad;},noop)).rejects.toThrow('exact requested sentence prefix');
    const row=f.db.query('SELECT body FROM research_brief_edits WHERE goal=?').get(f.goal.id) as {body:string},historical=JSON.parse(row.body);
    historical.phase='awaiting_approval';historical.draftCheck={accepted:true,reason:'Injected historical pre-fix guard accepted changed prose.'};historical.supportReview={supported:true,reason:'Injected false positive: it claims a second Browser results: prefix exists.'};
    f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(JSON.stringify(historical),f.goal.id);f.goal.status='needs_input';f.db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(f.goal),f.goal.id);
    await expect(f.store.approve(f.goal,{operationId:historical.operationId,proposalSha256:historical.proposalSha256})).rejects.toThrow('current literal edit requirements');
    expect(f.store.state(f.goal.id)?.phase).toBe('rejected');expect(f.store.state(f.goal.id)?.draftCheck?.accepted).toBe(false);
    await expect(f.restart().execute(f.task,f.goal,signal(),async()=>{throw new Error('must never replace the rejected native response');},noop)).rejects.toThrow('exact requested sentence prefix');
    const rejected=f.store.state(f.goal.id)!;expect(rejected.phase).toBe('rejected');expect(rejected.writingAttempt?.raw).toEqual(bad);expect(rejected.supportReview).toEqual(historical.supportReview);expect(rejected.approvedProposalSha256).toBeUndefined();expect(calls).toBe(1);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:1});
  }finally{await f.close();}
});

test('sequential formatting rejects empty, repeated-label, multi-sentence and duplicated-citation raw fields without authored fallback',async()=>{
  const good={first:{text:'Fetch tests are kept in fetch/ in web-platform-tests/wpt.',citations:[1]},second:{text:'Browser results are displayed at wpt.fyi/results/fetch.',citations:[1]}};
  for(const [slot,change] of [
    ['first',(raw:typeof good)=>{raw.first.text='   ';}],
    ['first',(raw:typeof good)=>{raw.first.text='Tests:';}],
    ['first',(raw:typeof good)=>{raw.first.text='Tests: Tests: '+raw.first.text;}],
    ['second',(raw:typeof good)=>{raw.second.text+=' This is another sentence.';}],
    ['first',(raw:typeof good)=>{raw.first.citations=[1,1];}]
  ] as const){
    const f=await fixture();try{await requestLabels(f);const raw=structuredClone(good);change(raw);const calls:string[]=[];await expect(f.store.execute(f.task,f.goal,signal(),async(_role,packet)=>{const which=packet.startsWith('Requested topic: Tests:\n')?'first':'second';calls.push(which);return raw[which];},noop)).rejects.toThrow('sentence decision is unusable');const saved=f.store.state(f.goal.id)!;expect(saved.phase).toBe('rejected');expect(saved.sentenceAttempts?.[slot]?.raw).toEqual(raw[slot]);expect(saved.sentenceAttempts?.[slot]?.error).toBeTruthy();expect(saved.proposal).toBeUndefined();expect(saved.writingAttempt).toBeUndefined();expect(saved.supportReview).toBeUndefined();expect(calls).toEqual(slot==='first'?['first']:['first','second']);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});}finally{await f.close();}
  }
});

test('the previous two-field native failure remains exact and cannot be regenerated by the new sequential writer',async()=>{
  const f=await fixture();try{
    await requestLabels(f);await expect(f.store.execute(f.task,f.goal,signal(),async()=>({text:' ',citations:[1]}),noop)).rejects.toThrow('sentence decision is unusable');
    const row=f.db.query('SELECT body FROM research_brief_edits WHERE goal=?').get(f.goal.id) as {body:string},state=JSON.parse(row.body);
    const raw={first:{text:'Tests: The Fetch Standard’s tests are kept in the `fetch/` directory of `web-platform-tests/wpt` and can be seen at [wpt.fyi/results/fetch](https://wpt.fyi/results/fetch).',citations:[1,2]},second:{text:'Browser results: The names are sorted lexicographically, and tests for the Fetch Standard can be found in the `fetch/` directory of `web-platform-tests/wpt`.',citations:[1,2]}};
    delete state.writingMode;delete state.sentenceAttempts;delete state.sentenceSelections;state.writingAttempt={raw,sha256:sourceHash(JSON.stringify(raw)),error:'Error: Each native labelled field must contain one nonempty factual sentence ending in punctuation, without a repeated host label or duplicated citations. Its raw response is preserved.'};state.phase='rejected';
    expect(state.writingAttempt.sha256).toBe('4082d2efae63c27b15819b1aeceb76fa65fb2830bbea1ccca6e1ad786559c322');const original=JSON.stringify(state);f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(original,f.goal.id);
    await expect(f.restart().execute(f.task,f.goal,signal(),async()=>{throw new Error('must never regenerate the historical failed native writing');},noop)).rejects.toThrow('original edit response is unusable');expect(JSON.stringify(f.store.state(f.goal.id))).toBe(original);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});
  }finally{await f.close();}
});

test('sentence labels are explicit, bounded and part of the exact submission identity',async()=>{
  const f=await fixture();try{
    for(const labels of [['','Browser results:'],['Tests:','Tests:'],[' Tests:','Browser results:'],['a'.repeat(33),'b'],['Tests:\n','b'],['one']] as unknown[]){await expect(f.store.prepare(f.parent,{requestKey:crypto.randomUUID(),intent,sentenceLabels:labels as [string,string]})).rejects.toThrow('two distinct');}
    const literal='Start the first sentence with “Tests:” and the second with “Browser results:”.';expect(validateDocumentEditLabels(literal,['Tests:','Browser results:'])).toEqual(['Tests:','Browser results:']);expect(()=>validateDocumentEditLabels(literal,['Other:','Results:'])).toThrow('conflict');
    const request=await f.store.prepare(f.parent,{requestKey:crypto.randomUUID(),intent,sentenceLabels:['Tests:','Browser results:']}),goals=new GoalOrchestrator(f.db,{infer:f.infer,execute:async()=>{throw new Error('must not run');},reviewDocumentEdit:async()=>({accepted:true,reason:'Injected registration fixture'})});
    const child=goals.createDocumentEdit(f.parent.id,request);expect(goals.createDocumentEdit(f.parent.id,request).id).toBe(child.id);expect(()=>goals.createDocumentEdit(f.parent.id,{...request,sentenceLabels:['Changed:','Browser results:']})).toThrow('another intent or sentence format');expect(()=>goals.createDocumentEdit(f.parent.id,{...request,sentenceLabels:undefined})).toThrow('another intent or sentence format');expect(child.documentEdit?.sentenceLabels).toEqual(['Tests:','Browser results:']);expect(f.calls.length).toBe(0);
  }finally{await f.close();}
});

test('a crash-window partial raw response stays inspectable and Continue rejects it without another native request',async()=>{
  const f=await fixture();try{
    await requestLabels(f);await expect(f.store.execute(f.task,f.goal,signal(),async()=>{throw new Error('injected process exit before first response');},noop)).rejects.toThrow('process exit before first response');
    const row=f.db.query('SELECT body FROM research_brief_edits WHERE goal=?').get(f.goal.id) as {body:string},body=JSON.parse(row.body),raw={text:'   ',citations:[1]};
    body.sentenceAttempts={first:{raw,sha256:sourceHash(JSON.stringify(raw))}};body.phase='preparing';
    // Exact on-disk window after saving raw output and before shape validation.
    f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(JSON.stringify(body),f.goal.id);
    const restarted=f.restart(),inspected=restarted.state(f.goal.id)!;expect(inspected.phase).toBe('preparing');expect(inspected.sentenceAttempts?.first?.raw).toEqual(raw);expect(inspected.sentenceAttempts?.first?.error).toBeUndefined();expect(inspected.writingAttempt).toBeUndefined();
    let calls=0;await expect(restarted.execute(f.task,f.goal,signal(),async()=>{calls++;throw new Error('must never replace a saved malformed native decision');},noop)).rejects.toThrow('first sentence decision is unusable');
    const rejected=restarted.state(f.goal.id)!;expect(rejected.phase).toBe('rejected');expect(rejected.sentenceAttempts?.first?.raw).toEqual(raw);expect(rejected.sentenceAttempts?.first?.sha256).toBe(inspected.sentenceAttempts?.first?.sha256);expect(rejected.sentenceAttempts?.first?.error).toBeTruthy();expect(calls).toBe(0);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});
  }finally{await f.close();}
});


test('no matching label evidence remains a persisted needs-input goal without any native request or document write',async()=>{
  const f=await fixture(false,true);let queue:GoalOrchestrator|undefined;
  try{
    // Use the real durable orchestrator for this host-flow outcome; its model
    // callback is forbidden, not replaced by a claim of native completion.
    f.db.query('DELETE FROM goal_tasks WHERE id=?').run(f.goal.id);
    const request=await f.store.prepare(f.parent,{requestKey:crypto.randomUUID(),intent:'Write two sourced sentences about telephone details and browser results.',sentenceLabels:['Telephone:','Browser results:']});
    let nativeCalls=0;const forbidden:Infer=async()=>{nativeCalls++;throw new Error('unmatched evidence must not reach native inference');};
    queue=new GoalOrchestrator(f.db,{infer:forbidden,execute:(task,goal,sig,progress)=>f.store.execute(task,goal,sig,forbidden,progress),reviewDocumentEdit:(task,goal,execution,sig)=>f.store.review(task,goal,execution,sig)});
    const child=queue.createDocumentEdit(f.parent.id,request);queue.start();
    let current=queue.get(child.id);for(let i=0;i<300&&current.status!=='needs_input';i++){await new Promise(resolve=>setTimeout(resolve,3));current=queue.get(child.id);}
    expect(current.status).toBe('needs_input');expect(current.coverageDone).toBe(false);expect(current.message).toContain('No saved literal citation matches');expect(current.message).toContain('more precise label');
    const state=f.store.state(child.id)!;expect(state.sentenceSelections?.first).toMatchObject({outcome:'none',queryTerms:['telephone']});expect(state.sentenceSelections?.first?.candidates.every(candidate=>candidate.score===0)).toBe(true);
    expect(state.sentenceSelections?.first?.selectedQuote).toBeUndefined();expect(state.sentenceAttempts).toEqual({});expect(state.proposal).toBeUndefined();expect(state.artifact).toBeUndefined();expect(nativeCalls).toBe(0);
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions').get()).toEqual({n:1});expect(f.counts().renders).toBe(1);
    expect(await readFile(join(f.dir,'documents',request.documentId,'0.pdf'))).toEqual(f.originalPdf);expect(await readFile(join(f.dir,'documents',request.documentId,'brief.html'))).toEqual(f.originalHtml);
  }finally{queue?.shutdown();await new Promise(resolve=>setTimeout(resolve,0));await f.close();}
});

test('an unmatched second label keeps the saved first native response and never requests or fabricates the missing sentence',async()=>{
  const f=await fixture(false,true);try{
    await requestLabels(f,'Write two sourced sentences about tests and telephone details.',['Tests:','Telephone:']);
    const first={text:'Fetch tests are kept in the fetch/ directory of web-platform-tests/wpt.',citations:[1]};let nativeCalls=0;
    const infer:Infer=async(role,prompt)=>{nativeCalls++;expect(role).toBe(GROUNDED_DOCUMENT_SENTENCE_ROLE);expect(prompt).toContain(quoteTests);expect(prompt).not.toContain(quoteResults);return first;};
    await expect(f.store.execute(f.task,f.goal,signal(),infer,noop)).rejects.toThrow('No saved literal citation matches the second');
    const state=f.store.state(f.goal.id)!;expect(state.sentenceAttempts?.first?.raw).toEqual(first);expect(state.sentenceAttempts?.first?.sha256).toBe(sourceHash(JSON.stringify(first)));
    expect(state.sentenceSelections?.second).toMatchObject({label:'Telephone:',outcome:'none'});expect(state.sentenceAttempts?.second).toBeUndefined();expect(state.writingAttempt).toBeUndefined();expect(state.supportReview).toBeUndefined();expect(nativeCalls).toBe(1);
    await expect(f.restart().execute(f.task,f.goal,signal(),infer,noop)).rejects.toThrow('No saved literal citation matches the second');
    expect(f.store.state(f.goal.id)?.sentenceAttempts?.first).toEqual(state.sentenceAttempts?.first);expect(nativeCalls).toBe(1);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.counts().renders).toBe(1);
  }finally{await f.close();}
});

test('changed candidate provenance or a rehashed selected quote cannot retarget an interrupted native sentence',async()=>{
  for(const damage of ['offset','rank','source-hash','selected-quote'] as const){
    const f=await fixture(false,true);try{
      await requestLabels(f);let calls=0;
      await expect(f.store.execute(f.task,f.goal,signal(),async()=>{calls++;throw new Error('injected process exit before first response');},noop)).rejects.toThrow('process exit');
      const row=f.db.query('SELECT body FROM research_brief_edits WHERE goal=?').get(f.goal.id) as {body:string},body=JSON.parse(row.body),selection=body.sentenceSelections.first;
      if(damage==='offset')selection.candidates[0].offset++;
      else if(damage==='rank')selection.candidates[0].score+=100;
      else if(damage==='source-hash')selection.candidates[0].textSha256='a'.repeat(64);
      else{selection.selectedQuote='A different quotation with a self-consistent replacement hash.';selection.selectedQuoteSha256=sourceHash(selection.selectedQuote);selection.candidates[0].quoteSha256=selection.selectedQuoteSha256;}
      f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(JSON.stringify(body),f.goal.id);
      expect(()=>f.store.state(f.goal.id)).toThrow('host sentence-evidence selection changed');
      await expect(f.restart().execute(f.task,f.goal,signal(),async()=>{calls++;throw new Error('must never infer from changed evidence');},noop)).rejects.toThrow('host sentence-evidence selection changed');
      expect(calls).toBe(1);expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(f.counts().renders).toBe(1);expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);
    }finally{await f.close();}
  }
});

test('an existing v2 sequential checkpoint retains its original broader reading contract instead of silently switching evidence mode',async()=>{
  const f=await fixture();try{
    await requestLabels(f);
    await expect(f.store.execute(f.task,f.goal,signal(),async()=>{throw new Error('must not infer before historical fixture is installed');},phase=>{if(phase==='sentence_evidence_selected')throw new Error('installing historical checkpoint');})).rejects.toThrow('installing historical checkpoint');
    const row=f.db.query('SELECT body FROM research_brief_edits WHERE goal=?').get(f.goal.id) as {body:string},body=JSON.parse(row.body);
    body.writingMode='sequential-labelled-sentences-v2';delete body.sentenceSelections;f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(JSON.stringify(body),f.goal.id);
    const raw={first:{text:'Fetch tests are kept in fetch/ in web-platform-tests/wpt.',citations:[1]},second:{text:'Browser results are displayed at wpt.fyi/results/fetch.',citations:[1]}},calls:string[]=[];
    const infer:Infer=async(role,packet)=>{const parsed=JSON.parse(packet);if(role===DOCUMENT_EDIT_SENTENCE_ROLE){calls.push(parsed.sentence);expect(parsed.originalParagraphs).toEqual(body.before.paragraphs);expect(parsed.acceptedAnswer).toBe(before);expect(parsed.citations).toEqual([{number:1,quote}]);return raw[parsed.sentence as 'first'|'second'];}calls.push('review');return {supported:true,reason:'Injected historical-mode support only.'};};
    await expect(f.restart().execute(f.task,f.goal,signal(),infer,noop)).rejects.toThrow('proposal is ready');const saved=f.store.state(f.goal.id)!;
    expect(calls).toEqual(['first','second','review']);expect(saved.writingMode).toBe('sequential-labelled-sentences-v2');expect(saved.sentenceSelections).toBeUndefined();expect(saved.writingAttempt?.raw).toEqual(raw);expect(saved.writingAttempt?.origin).toBe('aggregate-of-two-native-sentence-decisions-v2');expect(saved.projection?.version).toBe('brief-labelled-sentences-v2');expect(saved.projection?.method).not.toContain('Host evidence retrieval chose');
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision:0});expect(await readFile(join(f.dir,'documents',f.goal.documentId!,'0.pdf'))).toEqual(f.originalPdf);
  }finally{await f.close();}
});
