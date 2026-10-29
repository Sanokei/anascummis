import {softwareRoute,pairedSoftwareRequest,softwareCors,softwareCorsHeaders} from './software-api';
import {softwareLaunches} from './software-launch';
import {createSoftwareTask,softwareJob,stopSoftwareTask,startSoftwareWorker,shutdownSoftwareWorker} from './software-task';
import {softwareRequested} from './software-tools';
import {softwareTools} from './software-tools';
import {sourceCatalog,readOwnSource} from './software-source';
import {fetchVisual} from './visual-context';
import {summarizeNews} from './news-answer';
import {fetchNews} from './news';
import {converse,conversational,replyPrompt} from './conversation';
import {join,resolve,sep} from 'node:path';
import {unlink} from 'node:fs/promises';
import {DATA,ROOT,db,createProject,getProject,saveProject,listProjects,listAssets,asset,history,restore,exclusive} from './storage';
import {object,text,number,validateSite,checkSite,renderSite} from './site';
import {document,importPdf,listDocuments,inspectPdf,editPdf,renderPdf,imagesToPdf,pdf} from './pdf';
import {siteTools,pdfTools,researchTools} from './tools';
import * as vault from './vault';
import {objectSchema,validate,type Tool} from './harness';
import {orchestrate} from './orchestrator';
import {infer,modelStatus,streamAnswer} from './model';
import {speak,warmSpeech,streamSpeak} from './speech';
import {cloudflareCommand} from './cloudflare';
import {zip} from './zip';
import {WorkJournal} from './work-journal';
import {GoalOrchestrator,type GoalRecord} from './goal-orchestrator';
import {executeGoalTask} from './goal-executor';
import {PublicSourceLedger,sourceHash} from './public-source';
import {reviewSourceAcquisition} from './source-question';
import {ResearchBriefStore} from './research-brief';
import {ResearchBriefEditStore,validateDocumentEditLabels} from './research-brief-edit';
import {stopGoalSoftware,reconcileGoalSoftware,goalSoftwareLinks} from './goal-software';
import {importMedia,listMedia,listVideoPlans,media,mediaPath,videoPlan,videoTools} from './video';
const port=Number(process.env.STUDIO_PORT||3211),origin=`http://127.0.0.1:${port}`,token=crypto.randomUUID();
const projectJobs=new Map<string,Promise<void>>();
const jobs=new Map<string,{status:string;controller:AbortController;result?:unknown;error?:string;progress?:unknown}>();
const workJournal=new WorkJournal(db);
let shuttingDown=false;
const goalSources=new PublicSourceLedger(db);
const researchBriefs=new ResearchBriefStore(db,goalSources,DATA,pdf);
const researchBriefEdits=new ResearchBriefEditStore(db,researchBriefs,DATA,pdf);
const goals=new GoalOrchestrator(db,{infer,sourceLedger:goalSources,execute:(task,goal,signal,progress)=>task.documentEdit?exclusive(goal.documentId!,()=>researchBriefEdits.execute(task,goal,signal,infer,progress)):task.sourceBrief?researchBriefs.execute(task,goal,signal,infer,progress):executeGoalTask(task,goal,signal,()=>shuttingDown,goalSources,progress),reviewSource:(task,goal,execution,signal)=>reviewSourceAcquisition(goalSources,task,goal,execution,signal),reviewBrief:(task,goal,execution,signal)=>researchBriefs.review(task,goal,execution,signal),reviewDocumentEdit:(task,goal,execution,signal)=>researchBriefEdits.review(task,goal,execution,signal),allowedSpecialists:['analysis','website','pdf','scene','commerce','research','video','video_sources','software']});
function briefEditEligibility(goal:GoalRecord):{canEdit:boolean;reason?:string}|undefined {
  if(!goal.brief)return undefined;
  const task=goal.tasks.find(task=>task.sourceBrief),artifact=task?.execution?.briefArtifact;
  if(goal.status!=='completed'||!goal.coverageDone||!task?.review?.accepted||!artifact)return {canEdit:false,reason:'Finish and accept the original brief before proposing its first summary edit.'};
  try{if(document(artifact.documentId).revision!==0)return {canEdit:false,reason:'This document already has another revision. This bounded editor supports only the first summary edit of the unchanged original brief. Open the PDF or saved edit to inspect its history.'};}
  catch{return {canEdit:false,reason:'The original brief document is unavailable. Inspect its saved goal and files before editing.'};}
  return {canEdit:true};
}
const goalResponse=(goal:GoalRecord)=>{const links=goalSoftwareLinks(goal.id),answer=goal.tasks.find(task=>task.sourceAnswer)?.execution?.sourceAnswer;return {...goal,...(goal.brief?{briefEditEligibility:briefEditEligibility(goal)}:{}),...(goal.brief?{briefState:researchBriefs.state(goal.id)}:{}),...(goal.documentEdit?{documentEditState:researchBriefEdits.state(goal.id)}:{}),...(goal.sourceQuestion?{sources:goalSources.list(goal.id),reading:goalSources.reading(goal.id,'source-answer',answer?.readingId?{id:answer.readingId}:{questionSha256:sourceHash(goal.request+(goal.guidance?'\nContinuation guidance: '+goal.guidance:''))},false)}:{}),tasks:goal.tasks.map(task=>({...task,...(links[task.id]?{softwareTaskId:links[task.id]}:{})}))};};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
function activityPagination(url:URL){const raw=url.searchParams.get('limit');if(raw!==null&&!/^[1-9][0-9]*$/.test(raw))throw new Error('Choose an activity history limit from 1 to 100');return {limit:raw===null?25:Number(raw),before:url.searchParams.get('before')??undefined};}
const download=(bytes:Uint8Array,type:string,name:string)=>new Response(bytes as any,{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename="${name.replace(/[^\w.-]/g,'_')}"`,'Cache-Control':'no-store'}});
async function uploaded(req:Request){const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>25_000_000)throw new Error('Choose a file smaller than 25 MB');return {name:file.name,bytes:new Uint8Array(await file.arrayBuffer())};}
async function exportSite(id:string,format='zip'){const p=getProject(id),checks=checkSite(p.site,listAssets().map(a=>a.id));if(!checks.ok)throw new Error(checks.errors.join('; '));if(!['zip','html'].includes(format))throw new Error('Choose HTML or ZIP for a website export');
  if(format==='html'){
    if(p.site.scene.length)throw new Error('This website includes an interactive 3D scene. Export website as ZIP to keep its bundled renderer.');
    const images:Record<string,string>={};let total=0;
    for(const id of new Set(p.site.sections.flatMap(section=>section.imageId?[section.imageId]:[]))){const source=asset(id),file=Bun.file(source.path);total+=file.size;if(total>50_000_000)throw new Error('Single-file HTML images exceed 50 MB. Export website as ZIP instead.');images[id]='data:'+source.mime+';base64,'+Buffer.from(await file.arrayBuffer()).toString('base64');}
    return download(new TextEncoder().encode(renderSite(p.site,id=>images[id])),'text/html; charset=utf-8',p.name+'.html');
  }
  const enc=new TextEncoder(),files:Record<string,Uint8Array>={'index.html':enc.encode(renderSite(p.site)),'site.json':enc.encode(JSON.stringify(p.site,null,2)),'scene.json':enc.encode(JSON.stringify(p.site.scene,null,2)),'wrangler.jsonc':enc.encode(JSON.stringify({name:`anascummis-${p.id.slice(0,8)}`,compatibility_date:'2026-10-07',workers_dev:true,assets:{directory:'./public'}},null,2))};files['public/index.html']=files['index.html'];
  if(p.site.scene.length){const runtime=Bun.file(join(ROOT,'public','scene.js'));if(!(await runtime.exists()))throw new Error('Build the bundled Babylon scene runtime before exporting a 3D website');files['scene.js']=new Uint8Array(await runtime.arrayBuffer());files['public/scene.js']=files['scene.js'];files['index.html']=enc.encode(renderSite(p.site,undefined,'scene.js'));files['public/index.html']=files['index.html'];}
  for(const id of new Set(p.site.sections.flatMap(s=>s.imageId?[s.imageId]:[]))){const bytes=new Uint8Array(await Bun.file(asset(id).path).arrayBuffer());files[`assets/${id}`]=bytes;files[`public/assets/${id}`]=bytes;}
  if(Object.values(files).reduce((n,b)=>n+b.length,0)>150_000_000)throw new Error('Website export exceeds 150 MB');return download(zip(files),'application/zip',p.name+'.zip');}
async function handleLocal(req:Request):Promise<Response>{
  const url=new URL(req.url),path=url.pathname;
  if(req.headers.get('host')!==`127.0.0.1:${port}`)return json({error:'Invalid host'},403);
  const paired=softwareCors(req)&&pairedSoftwareRequest(req);const sameOrigin=req.headers.get('origin');if(sameOrigin&&sameOrigin!==origin&&!paired)return json({error:'Invalid origin'},403);
  if(req.method!=='GET'&&req.method!=='HEAD'&&!paired&&(sameOrigin!==origin||req.headers.get('X-Requested-With')!=='Anascummis'||!req.headers.get('cookie')?.split(';').some(c=>c.trim()===`studio=${token}`)))return json({error:'Invalid local session'},403);
  if(Number(req.headers.get('content-length')||0)>(path==='/api/media'?151_000_000:30_000_000))return json({error:'Request too large'},413);
  try {
    if(path.startsWith('/api/software')){if((path==='/api/software-pairing'||/^\/api\/software\/[a-f0-9-]{36}\/launch(?:\/|$)/.test(path))&&!req.headers.get('cookie')?.split(';').some(c=>c.trim()===`studio=${token}`))return json({error:'Open the local Studio window before using this action'},403);const result=await softwareRoute(req);if(result)return result;}
    if(path==='/api/status')return json({runtime:'local',model:await modelStatus(),speech:'Streaming Pocket TTS with local LavaSR enhancement',network:'Opt-in actions only'});
    if(path==='/api/goals'){
      if(req.method==='GET')return json(goals.list().map(goalResponse));
      if(req.method==='POST'){const a=object(await req.json()),projectId=text(a.project,100),documentId=a.document?text(a.document,100):undefined;getProject(projectId);if(documentId)document(documentId);return json(goalResponse(goals.create({request:text(a.request,8000),projectId,documentId,research:a.research===true,sourceQuestion:a.sourceQuestion})),202);}
      return json({error:'Unsupported goal operation'},405);
    }
    const editMatch=/^\/api\/goals\/([a-f0-9-]{36})\/document-edit(?:\/(apply|export|preview|provenance))?$/.exec(path);
    if(editMatch){
      const goal=goals.get(editMatch[1]),action=editMatch[2];
      if(action==='apply'){
        if(req.method!=='POST')return json({error:'Applying a proposal requires explicit confirmation'},405);
        const a=object(await req.json());if(Object.keys(a).some(key=>!['operationId','proposalSha256'].includes(key)))throw new Error('Apply accepts only the saved operation and exact proposal identity.');
        if(goal.status==='cancelled')throw new Error('This edit is stopped. Inspect and explicitly Continue before applying its proposal.');
        await researchBriefEdits.approve(goal,{operationId:text(a.operationId,100),proposalSha256:text(a.proposalSha256,64)});
        return json(goalResponse(goals.resume(goal.id)),202);
      }
      if(action){
        if(req.method!=='GET')return json({error:'Saved edit artifacts are read-only'},405);
        const format=url.searchParams.get('format');
        if(action==='export'){
          if(format!=='pdf'&&format!=='html')throw new Error('Choose PDF or HTML for the revised document.');
          const file=await researchBriefEdits.export(goal,format);return download(file.bytes,format==='pdf'?'application/pdf':'text/html; charset=utf-8',file.name);
        }
        if(action==='provenance'&&format!=='html'&&format!=='json')throw new Error('Choose HTML or JSON for full edit provenance.');
        const kind=action==='preview'?'html':format==='json'?'provenance-json':'provenance-html',file=await researchBriefEdits.export(goal,kind);
        if(kind==='provenance-json')return download(file.bytes,'application/json',file.name);
        return new Response(file.bytes as any,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox allow-top-navigation-by-user-activation; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'}});
      }
      if(req.method!=='POST')return json({error:'Use the saved goal to inspect its document edit'},405);
      const a=object(await req.json());if(Object.keys(a).some(key=>!['requestKey','intent','sentenceLabels'].includes(key)))throw new Error('A native edit accepts only its exact intent, optional sentence labels and submission identity.');
      const editIntent=text(a.intent,500),labels=validateDocumentEditLabels(editIntent,a.sentenceLabels),submitted={requestKey:text(a.requestKey,100),intent:editIntent,...(labels?{sentenceLabels:labels}:{})},existing=goals.existingDocumentEdit(goal.id,submitted.requestKey,submitted.intent,submitted.sentenceLabels);
      if(existing)return json(goalResponse(existing),202);
      const prepared=await researchBriefEdits.prepare(goal,submitted);return json(goalResponse(goals.createDocumentEdit(goal.id,prepared)),202);
    }
    const briefMatch=/^\/api\/goals\/([a-f0-9-]{36})\/brief(?:\/(export|preview))?$/.exec(path);
    if(briefMatch){const goal=goals.get(briefMatch[1]);if(briefMatch[2]){if(req.method!=='GET')return json({error:'Document previews and exports are read-only'},405);if(briefMatch[2]==='preview'){const file=await researchBriefs.exportHtml(goal);return new Response(file.bytes as any,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox allow-top-navigation-by-user-activation; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'}});}const format=url.searchParams.get('format');if(format!=='html'&&format!=='pdf')throw new Error('Choose HTML or PDF for a brief export.');const file=format==='pdf'?await researchBriefs.exportPdf(goal):await researchBriefs.exportHtml(goal);return download(file.bytes,format==='pdf'?'application/pdf':'text/html; charset=utf-8',file.name);}if(req.method!=='POST')return json({error:'Use the saved goal to inspect its research brief'},405);const a=object(await req.json());if(Object.keys(a).some(key=>!['title','notes','requestKey'].includes(key)))throw new Error('A brief accepts only its title, notes and submission identity.');return json(goalResponse(goals.createBrief(goal.id,{title:text(a.title,120),notes:a.notes===undefined?'':text(a.notes,2000),requestKey:text(a.requestKey,100)})),202);}
    const readingMatch=/^\/api\/goals\/([a-f0-9-]{36})\/readings(?:\/([a-f0-9-]{36}))?$/.exec(path);
    if(readingMatch){try{if(!goals.get(readingMatch[1]).sourceQuestion)return json({error:'Source question not found'},404);}catch{return json({error:'Goal not found'},404);}if(req.method!=='GET')return json({error:'Saved reading history is read-only'},405);if(readingMatch[2]){const plan=goalSources.reading(readingMatch[1],'source-answer',{id:readingMatch[2]});if(!plan)return json({error:'Saved reading not found in this goal'},404);return json({...plan,result:goalSources.readingResult(readingMatch[1],plan.id),resultCount:goalSources.resultCount(readingMatch[1],plan.id)});}const page=activityPagination(url);return json(goalSources.readingPage(readingMatch[1],url.searchParams.has('limit')?page.limit:10,page.before));}
    const sourceMatch=/^\/api\/goals\/([a-f0-9-]{36})\/sources\/([a-f0-9-]{36})$/.exec(path);
    if(sourceMatch){if(req.method!=='GET')return json({error:'Saved sources are read-only'},405);goals.get(sourceMatch[1]);const raw=url.searchParams.get('offset')||'0';if(!/^(0|[1-9][0-9]*)$/.test(raw))throw new Error('Invalid saved-text position');return json(goalSources.page(sourceMatch[1],sourceMatch[2],Number(raw)));}
    const goalMatch=/^\/api\/goals\/([a-f0-9-]{36})(?:\/(stop|resume|activity))?$/.exec(path);
    if(goalMatch){const id=goalMatch[1];try{goals.get(id);}catch{return json({error:'Goal not found'},404);}if(goalMatch[2]==='activity'){if(req.method!=='GET')return json({error:'Unsupported goal activity operation'},405);const page=activityPagination(url);return json(goals.activity(id,page.limit,page.before));}if(!goalMatch[2]&&req.method==='GET')return json(goalResponse(goals.get(id)));if(goalMatch[2]==='stop'&&req.method==='POST'){const stopped=goals.stop(id);stopGoalSoftware(id);return json(goalResponse(stopped));}if(goalMatch[2]==='resume'&&req.method==='POST'){const a=object(await req.json());return json(goalResponse(goals.resume(id,a.note===undefined?'':text(a.note,2000))));}return json({error:'Unsupported goal operation'},405);}
    if(path==='/api/vault'&&req.method==='GET')return json(await vault.status());
    if(path==='/api/vault'&&req.method==='POST'){const a=object(await req.json());if(a.action==='unlock')return json(await vault.unlock(text(a.password,300)));if(a.action==='lock'){vault.lock();return json({unlocked:false});}if(a.action==='save')return json(await vault.save(text(a.name,80),text(a.value)));if(a.action==='list')return json(vault.all());throw new Error('Unknown vault action');}
    if(path==='/api/projects'&&req.method==='GET')return json(listProjects());
    if(path==='/api/projects'&&req.method==='POST'){const a=object(await req.json());return json(createProject(text(a.name,160)));}
    if(path==='/api/assets'&&req.method==='GET')return json(listAssets());
    if(path==='/api/media'&&req.method==='GET')return json(listMedia());
    if(path==='/api/media'&&req.method==='POST'){const form=await req.formData(),f=form.get('file');if(!(f instanceof File)||!f.size||f.size>150_000_000)throw new Error('Choose video/audio smaller than 150 MB');return json(await importMedia(f.name,new Uint8Array(await f.arrayBuffer())));}
    if(path==='/api/video-projects')return json(listVideoPlans());
    const mt=/^\/api\/media\/([\w-]+)\/transcript$/.exec(path);if(mt&&req.method==='POST'){const m=media(mt[1]);if(!m.audio)throw new Error('This media has no audio');const a=object(await req.json());await Bun.write(join(DATA,'media',m.id,'transcript.txt'),text(a.text,100000));return json({id:m.id,transcribed:true});}
    const vp=/^\/api\/video-projects\/([\w-]+)$/.exec(path);if(vp)return json(videoPlan(vp[1]));
    const mm=/^\/api\/media\/([\w-]+)(?:\/(export|credits))?$/.exec(path);if(mm){const m=media(mm[1]),file=Bun.file(mm[2]==='credits'?join(DATA,'media',m.id,'credits.json'):mediaPath(m.id));if(!await file.exists())throw new Error('Media file unavailable');if(mm[2]==='credits')return new Response(file,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});const type=m.rendered?'video/mp4':m.mime||file.type||'application/octet-stream',headers:Record<string,string>={'Content-Type':type,'Cache-Control':'no-store','Accept-Ranges':'bytes'};if(mm[2]==='export')headers['Content-Disposition']=`attachment; filename="${m.name.replace(/[^\w.-]/g,'_')}"`;const range=req.headers.get('range');if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416});const start=match[1]?Number(match[1]):Math.max(0,file.size-Number(match[2])),end=match[1]?Math.min(file.size-1,match[2]?Number(match[2]):file.size-1):file.size-1;if(start>end||start>=file.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${file.size}`}});headers['Content-Range']=`bytes ${start}-${end}/${file.size}`;headers['Content-Length']=String(end-start+1);return new Response(file.slice(start,end+1),{status:206,headers});}return new Response(file,{headers});}
    if(path==='/api/assets'&&req.method==='POST'){const f=await uploaded(req),id=crypto.randomUUID(),target=join(DATA,'assets',id);await Bun.write(target,f.bytes);try{const info=await pdf({op:'image_info',image:target});if(!['PNG','JPEG'].includes(info.format))throw new Error('Upload PNG or JPEG');db.query('INSERT INTO assets VALUES(?,?,?)').run(id,f.name,info.format==='PNG'?'image/png':'image/jpeg');return json({id,name:f.name});}catch(e){await unlink(target).catch(()=>{});throw e;}}
    if(path==='/api/documents'&&req.method==='GET')return json(listDocuments());
    if(path==='/api/documents'&&req.method==='POST'){const f=await uploaded(req);return json(await importPdf(f.name,f.bytes));}
    if(path==='/api/images-to-pdf'&&req.method==='POST'){const a=object(await req.json());if(!Array.isArray(a.ids))throw new Error('Choose images');return json(await imagesToPdf(a.ids.map(x=>text(x,100)),text(a.name,160)));}
    if(path==='/api/speech/warm'&&req.method==='POST'){await warmSpeech();return json({ready:true});}
    if(path==='/api/speech-stream'&&req.method==='POST'){const a=object(await req.json()),iterator=streamSpeak(a.text,req.signal),encoder=new TextEncoder();return new Response(new ReadableStream({async pull(controller){try{const result=await iterator.next();if(result.done){controller.close();return;}controller.enqueue(encoder.encode(JSON.stringify(result.value)+'\n'));}catch(error){controller.enqueue(encoder.encode(JSON.stringify({error:error instanceof Error?error.message:'Speech failed'})+'\n'));controller.close();}},async cancel(){await iterator.return(undefined);}}),{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'}});}
    if(path==='/api/peer-plan'&&req.method==='POST'){const a=object(await req.json()),goal=text(a.goal,1000),schema=objectSchema({steps:{type:'array',items:{type:'string',maxLength:300},minItems:1,maxItems:3}});const result=await infer('Propose at most three concrete subtasks for this shared goal. Return steps JSON. Do not execute actions or include private local information.',goal,schema,req.signal);validate(schema,result);return json(result);}
    if(path==='/api/speech'&&req.method==='POST')return new Response(await speak(object(await req.json()).text,req.signal) as any,{headers:{'Content-Type':'audio/wav','Cache-Control':'no-store'}});
    if(path==='/api/cloudflare'&&req.method==='POST'){const a=object(await req.json());if(!['login','whoami','deploy'].includes(a.action as string))throw new Error('Unknown Cloudflare action');return json(await exclusive('cloudflare',()=>cloudflareCommand(a.action as any,a.project?text(a.project,100):undefined)));}
    if(path==='/api/answer-stream'&&req.method==='POST'){
      const a=object(await req.json()),words=text(a.text,1200),isNews=a.news===true;
      if(!isNews&&!conversational(words))throw new Error('This request needs the tool harness');
      const signal=AbortSignal.any([req.signal,AbortSignal.timeout(45000)]),news=isNews?await fetchNews(words,signal):undefined,prompt=replyPrompt(words,a.history,news),encoder=new TextEncoder();
      const iterator=streamAnswer(prompt.system,prompt.user,signal);let sourcesSent=false;
      return new Response(new ReadableStream({async pull(controller){try{if(news&&!sourcesSent){sourcesSent=true;controller.enqueue(encoder.encode(JSON.stringify({sources:news})+'\n'));return;}const result=await iterator.next();if(result.done){controller.enqueue(encoder.encode('{"done":true}\n'));controller.close();}else controller.enqueue(encoder.encode(JSON.stringify({text:result.value})+'\n'));}catch(e){controller.enqueue(encoder.encode(JSON.stringify({error:e instanceof Error?e.message:'Reply failed'})+'\n'));controller.close();}},async cancel(){await iterator.return();}}),{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'}});
    }
    if(path==='/api/visual'&&req.method==='POST'){const a=object(await req.json());return json(await fetchVisual(text(a.query,500),req.signal));}
    if(path==='/api/news-answer'&&req.method==='POST'){const a=object(await req.json()),question=text(a.text,500),signal=AbortSignal.any([req.signal,AbortSignal.timeout(45000)]),sources=await fetchNews(question,signal);return json({message:await summarizeNews(question,sources,signal,infer),sources});}
    if(path==='/api/news'&&req.method==='POST'){const a=object(await req.json());return json(await fetchNews(text(a.query,500),req.signal));}
    if(path==='/api/conversation'&&req.method==='POST'){const a=object(await req.json()),words=text(a.text,1200);if(!conversational(words))throw new Error('This request needs the tool harness');return json({message:await converse(words,a.history,AbortSignal.any([req.signal,AbortSignal.timeout(45000)]),infer)});}
    if(path==='/api/jobs'&&req.method==='GET')return json(workJournal.list(Number(url.searchParams.get('limit')||25),url.searchParams.get('before')||undefined));
    if(path==='/api/chat'&&req.method==='POST'){
      const a=object(await req.json()),request=text(a.text,8000),id=text(a.project,100),pdfId=a.document?text(a.document,100):undefined;
      if(softwareRequested(request)){const task=await createSoftwareTask(request);return json({jobId:'software-'+task.id,softwareTaskId:task.id});}
      const labels=a.savedDetails||[];if(!Array.isArray(labels)||labels.length>20)throw new Error('Choose at most 20 saved details');if(labels.length&&a.research===true)throw new Error('Use saved private details in an offline turn');
      const details=Object.fromEntries(labels.map(label=>{const name=text(label,80);return [name,vault.lookup(name)];}));
      const p=getProject(id);if(pdfId)document(pdfId);if([...jobs.values()].filter(j=>j.status==='running').length>=3)throw new Error('Three local background tasks are already running');
      const jobId=crypto.randomUUID(),controller=new AbortController(),job={status:'running',controller} as {status:string;controller:AbortController;result?:unknown;error?:string;progress?:unknown};
      const context={site:p.site,revision:p.revision,assets:listAssets(),media:listMedia(),videoProjects:listVideoPlans(),savedDetails:details,...(pdfId?{pdf:await inspectPdf(pdfId,[1])}:{}),network:a.research===true?'Research tools enabled by user':'No network tools granted in this turn'};
      if([...jobs.values()].filter(j=>j.status==='running').length>=3)throw new Error('Three local background tasks are already running');
      db.query('INSERT INTO messages(project,role,content) VALUES(?,?,?)').run(id,'user',request);
      workJournal.create({id:jobId,projectId:id,documentId:pdfId,request});jobs.set(jobId,job);
      const workspace:Tool={name:'workspace',description:'Request a preview, user file picker or export. Video tools run locally. The client applies requests before speaking.',schema:objectSchema({action:{type:'string',enum:['show_website','show_scene','show_pdf','show_video','preview_video_timeline','close_preview','attach_image','open_pdf','open_media','export']},format:{type:'string',enum:['pdf','png','html','zip','mp4']},target:{type:'string',enum:['website','pdf','video']}},['action','format']),run:async args=>{validate(workspace.schema,args);return {workspaceRequest:args};}};
      const tools=[...softwareTools(sourceCatalog,readOwnSource,true),...siteTools(id),...(pdfId?pdfTools(pdfId):[]),...videoTools(controller.signal,a.research===true),workspace,...(a.research===true?researchTools(controller.signal):[])];
      const previous=projectJobs.get(id)||Promise.resolve();let release!:()=>void;projectJobs.set(id,new Promise<void>(resolve=>release=resolve));job.progress={phase:'queued',agent:'coordinator'};void (async()=>{await previous;controller.signal.throwIfAborted();const current=getProject(id);context.site=current.site;context.revision=current.revision;return exclusive(id,()=>exclusive(pdfId||'no-pdf',()=>orchestrate(request,context,tools,controller.signal,infer,{onEvent:event=>{job.progress=event;workJournal.progress(jobId,event);}})));})().then(result=>{controller.signal.throwIfAborted();workJournal.complete(jobId,result);job.status='complete';job.result=result;db.query('INSERT INTO messages(project,role,content) VALUES(?,?,?)').run(id,'assistant',JSON.stringify(result));}).catch(e=>{job.status=controller.signal.aborted?(shuttingDown?'interrupted':'cancelled'):'failed';job.error=String(e);workJournal.fail(jobId,job.status as 'interrupted'|'cancelled'|'failed',shuttingDown?'The backend stopped before this task finished. Review its progress and saved changes before continuing.':job.error);}).finally(()=>{release();setTimeout(()=>jobs.delete(jobId),600000).unref();});
      return json({jobId});
    }
    const workActivity=/^\/api\/jobs\/([a-f0-9-]{36})\/activity$/.exec(path);if(workActivity){const id=workActivity[1];if(!workJournal.get(id))return json({error:'Job not found'},404);if(req.method!=='GET')return json({error:'Unsupported job activity operation'},405);const page=activityPagination(url);return json(workJournal.activity(id,page.limit,page.before));}
    const jobMatch=/^\/api\/jobs\/([\w-]+)(\/stop)?$/.exec(path);if(jobMatch){if(jobMatch[1].startsWith('software-')){const id=jobMatch[1].slice(9);if(jobMatch[2]&&req.method==='POST')stopSoftwareTask(id);return json(softwareJob(id));}const job=jobs.get(jobMatch[1]),saved=workJournal.get(jobMatch[1]);if(!job&&!saved)return json({error:'Job not found'},404);if(jobMatch[2]&&req.method==='POST'){workJournal.fail(jobMatch[1],'cancelled','Stopped by you. Progress and saved changes are kept.');if(job?.status==='running'){job.status='cancelled';job.controller.abort();}}if(job)return json({status:job.status,result:job.result,error:job.error,progress:job.progress});return json({...saved,result:saved?.status==='complete'?{message:saved.message,trace:[],orchestration:{stopReason:saved.outcome,tasks:saved.specialists||[]}}:undefined});}
    const assetMatch=/^\/api\/assets\/([\w-]+)$/.exec(path);if(assetMatch){const a=asset(assetMatch[1]);return new Response(Bun.file(a.path),{headers:{'Content-Type':a.mime,'Cache-Control':'no-store'}});}
    const projectMatch=/^\/api\/projects\/([\w-]+)(?:\/(history|restore|export|messages|preview))?$/.exec(path);
    if(projectMatch){const id=projectMatch[1],action=projectMatch[2];if(action==='history')return json(history(id));if(action==='restore'&&req.method==='POST'){const a=object(await req.json());return json(await exclusive(id,async()=>restore(id,number(a.revision,0,100000))));}if(action==='export')return await exportSite(id,url.searchParams.get('format')||'zip');if(action==='messages')return json(db.query('SELECT role,content FROM messages WHERE project=? ORDER BY id').all(id));if(action==='preview')return new Response(renderSite(getProject(id).site,x=>`/api/assets/${x}`),{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox"}});if(!action&&req.method==='POST'){const a=object(await req.json());return json(await exclusive(id,async()=>{const current=getProject(id);if(a.revision!==current.revision)throw new Error('The website changed. Reload before saving.');const site=validateSite(a.site),checks=checkSite(site,listAssets().map(x=>x.id));if(!checks.ok)throw new Error(checks.errors.join('; '));return saveProject(id,site,'Manual edit');}));}if(!action)return json(getProject(id));}
    const docMatch=/^\/api\/documents\/([\w-]+)(?:\/(inspect|edit|export|render|history|restore))?$/.exec(path);
    if(docMatch){const id=docMatch[1],action=docMatch[2];
      if(action==='inspect')return json(await inspectPdf(id,[number(Number(url.searchParams.get('page')||1),1,500)]));
      if(action==='edit'&&req.method==='POST'){const a=object(await req.json());return json(await exclusive(id,()=>editPdf(id,text(a.op,40),a.args)));}
      if(action==='history'){document(id);return json(db.query('SELECT revision,label FROM pdf_versions WHERE doc=? ORDER BY revision DESC').all(id));}
      if(action==='restore'&&req.method==='POST'){const a=object(await req.json());return json(await exclusive(id,async()=>{const d=document(id),revision=number(a.revision,0,d.revision),v=db.query('SELECT revision FROM pdf_versions WHERE doc=? AND revision=?').get(id,revision);if(!v)throw new Error('Revision not found');const next=d.revision+1;await Bun.write(join(DATA,'documents',id,`${next}.pdf`),Bun.file(join(DATA,'documents',id,`${revision}.pdf`)));const info=await pdf({op:'inspect',input:join(DATA,'documents',id,`${next}.pdf`),args:{pages:[1]}});db.transaction(()=>{db.query('UPDATE documents SET revision=?,pages=? WHERE id=?').run(next,info.pageCount,id);db.query('INSERT INTO pdf_versions VALUES(?,?,?)').run(id,next,`Restore ${revision}`);})();return document(id);}));}
      if(action==='export'&&url.searchParams.get('format')!=='png'){const d=document(id);return download(new Uint8Array(await Bun.file(d.path).arrayBuffer()),'application/pdf',d.name);}
      if(action==='render'||action==='export'){const page=number(Number(url.searchParams.get('page')||1),1,500),dpi=number(Number(url.searchParams.get('dpi')||144),36,300),file=await renderPdf(id,page,dpi);try{const bytes=new Uint8Array(await Bun.file(file).arrayBuffer());return action==='export'?download(bytes,'image/png',`page-${page}.png`):new Response(bytes as any,{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}});}finally{await unlink(file).catch(()=>{});}}
      if(!action){const d=document(id);return json({id:d.id,name:d.name,pages:d.pages,revision:d.revision});}
    }
    if(path.startsWith('/api/'))return json({error:'Unknown route'},404);
    const out=resolve(ROOT,'out'),candidate=resolve(out,'.'+decodeURIComponent(path)),target=path.endsWith('/')?join(candidate,'index.html'):candidate;
    let response:Response;
    if(!target.startsWith(out+sep))return json({error:'Invalid path'},403);
    if(await Bun.file(target).exists())response=new Response(Bun.file(target));
    else if(process.env.STUDIO_DEV==='1')response=await fetch(`http://127.0.0.1:3212${path}${url.search}`,{headers:{accept:req.headers.get('accept')||'*/*'}});
    else response=new Response('Build the Next.js studio first: cd apps/studio && bun install && bun run build',{status:503});
    const headers=new Headers(response.headers);headers.set('Set-Cookie',`studio=${token}; HttpOnly; SameSite=Strict; Path=/`);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');return new Response(response.body,{status:response.status,headers});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},400);}
}
export async function handle(req:Request):Promise<Response>{if(softwareCors(req)&&req.headers.get('host')===`127.0.0.1:${port}`){if(req.method==='OPTIONS')return new Response(null,{headers:softwareCorsHeaders()});if(!pairedSoftwareRequest(req))return json({error:'Pair this computer before starting builds'},403);const response=await handleLocal(req),headers=new Headers(response.headers);for(const [key,value]of Object.entries(softwareCorsHeaders()))headers.set(key,value);return new Response(response.body,{status:response.status,headers});}return handleLocal(req);}
if(import.meta.main){const localServer=Bun.serve({hostname:'127.0.0.1',port,maxRequestBodySize:151_000_000,idleTimeout:255,fetch:handle});softwareLaunches.initialize();workJournal.interruptRunning();goals.start();reconcileGoalSoftware(goals.list());startSoftwareWorker();console.log(`Anascummis Studio: ${origin}`);const close=()=>{if(shuttingDown)return;shuttingDown=true;goals.shutdown();shutdownSoftwareWorker();for(const job of jobs.values())job.controller.abort();void softwareLaunches.shutdown().catch(error=>console.error('App shutdown was not confirmed:',error instanceof Error?error.message:String(error))).finally(()=>{void localServer.stop(true);setTimeout(()=>process.exit(0),2000).unref();});};process.on('SIGINT',close);process.on('SIGTERM',close);}







