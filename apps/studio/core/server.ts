import {softwareRoute,pairedSoftwareRequest,softwareCors,softwareCorsHeaders} from './software-api';
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
import {importMedia,listMedia,listVideoPlans,media,mediaPath,videoPlan,videoTools} from './video';
const port=Number(process.env.STUDIO_PORT||3211),origin=`http://127.0.0.1:${port}`,token=crypto.randomUUID();
const projectJobs=new Map<string,Promise<void>>();
const jobs=new Map<string,{status:string;controller:AbortController;result?:unknown;error?:string;progress?:unknown}>();
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const download=(bytes:Uint8Array,type:string,name:string)=>new Response(bytes as any,{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename="${name.replace(/[^\w.-]/g,'_')}"`,'Cache-Control':'no-store'}});
async function uploaded(req:Request){const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>25_000_000)throw new Error('Choose a file smaller than 25 MB');return {name:file.name,bytes:new Uint8Array(await file.arrayBuffer())};}
async function exportSite(id:string){const p=getProject(id),checks=checkSite(p.site,listAssets().map(a=>a.id));if(!checks.ok)throw new Error(checks.errors.join('; '));const enc=new TextEncoder(),files:Record<string,Uint8Array>={'index.html':enc.encode(renderSite(p.site)),'site.json':enc.encode(JSON.stringify(p.site,null,2)),'scene.json':enc.encode(JSON.stringify(p.site.scene,null,2)),'wrangler.jsonc':enc.encode(JSON.stringify({name:`anascummis-${p.id.slice(0,8)}`,compatibility_date:'2026-10-07',workers_dev:true,assets:{directory:'./public'}},null,2))};files['public/index.html']=files['index.html'];
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
    if(path.startsWith('/api/software')){if(path==='/api/software-pairing'&&!req.headers.get('cookie')?.split(';').some(c=>c.trim()===`studio=${token}`))return json({error:'Open the local app before pairing'},403);const result=await softwareRoute(req);if(result)return result;}
    if(path==='/api/status')return json({runtime:'local',model:await modelStatus(),speech:'Streaming Pocket TTS with local LavaSR enhancement',network:'Opt-in actions only'});
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
    if(path==='/api/chat'&&req.method==='POST'){
      const a=object(await req.json()),request=text(a.text,8000),id=text(a.project,100),pdfId=a.document?text(a.document,100):undefined;
      if(softwareRequested(request)){const task=await createSoftwareTask(request);return json({jobId:'software-'+task.id,softwareTaskId:task.id});}
      const labels=a.savedDetails||[];if(!Array.isArray(labels)||labels.length>20)throw new Error('Choose at most 20 saved details');if(labels.length&&a.research===true)throw new Error('Use saved private details in an offline turn');
      const details=Object.fromEntries(labels.map(label=>{const name=text(label,80);return [name,vault.lookup(name)];}));
      const p=getProject(id);if(pdfId)document(pdfId);if([...jobs.values()].filter(j=>j.status==='running').length>=3)throw new Error('Three local background tasks are already running');
      const jobId=crypto.randomUUID(),controller=new AbortController(),job={status:'running',controller} as {status:string;controller:AbortController;result?:unknown;error?:string;progress?:unknown};jobs.set(jobId,job);
      const context={site:p.site,revision:p.revision,assets:listAssets(),media:listMedia(),videoProjects:listVideoPlans(),savedDetails:details,...(pdfId?{pdf:await inspectPdf(pdfId,[1])}:{}),network:a.research===true?'Research tools enabled by user':'No network tools granted in this turn'};
      db.query('INSERT INTO messages(project,role,content) VALUES(?,?,?)').run(id,'user',request);
      const workspace:Tool={name:'workspace',description:'Request a preview, user file picker or export. Video tools run locally. The client applies requests before speaking.',schema:objectSchema({action:{type:'string',enum:['show_website','show_scene','show_pdf','show_video','preview_video_timeline','close_preview','attach_image','open_pdf','open_media','export']},format:{type:'string',enum:['pdf','png','html','zip','mp4']}}),run:async args=>{validate(workspace.schema,args);return {workspaceRequest:args};}};
      const tools=[...softwareTools(sourceCatalog,readOwnSource,true),...siteTools(id),...(pdfId?pdfTools(pdfId):[]),...videoTools(controller.signal,a.research===true),workspace,...(a.research===true?researchTools():[])];
      const previous=projectJobs.get(id)||Promise.resolve();let release!:()=>void;projectJobs.set(id,new Promise<void>(resolve=>release=resolve));job.progress={phase:'queued',agent:'coordinator'};void (async()=>{await previous;controller.signal.throwIfAborted();const current=getProject(id);context.site=current.site;context.revision=current.revision;return exclusive(id,()=>exclusive(pdfId||'no-pdf',()=>orchestrate(request,context,tools,controller.signal,infer,{onEvent:event=>{job.progress=event;}})));})().then(result=>{job.status='complete';job.result=result;db.query('INSERT INTO messages(project,role,content) VALUES(?,?,?)').run(id,'assistant',JSON.stringify(result));}).catch(e=>{job.status=controller.signal.aborted?'cancelled':'failed';job.error=String(e);}).finally(()=>{release();setTimeout(()=>jobs.delete(jobId),600000).unref();});
      return json({jobId});
    }
    const jobMatch=/^\/api\/jobs\/([\w-]+)(\/stop)?$/.exec(path);if(jobMatch){if(jobMatch[1].startsWith('software-')){const id=jobMatch[1].slice(9);if(jobMatch[2]&&req.method==='POST')stopSoftwareTask(id);return json(softwareJob(id));}const job=jobs.get(jobMatch[1]);if(!job)return json({error:'Job not found'},404);if(jobMatch[2]&&req.method==='POST')job.controller.abort();return json({status:job.status,result:job.result,error:job.error,progress:job.progress});}
    const assetMatch=/^\/api\/assets\/([\w-]+)$/.exec(path);if(assetMatch){const a=asset(assetMatch[1]);return new Response(Bun.file(a.path),{headers:{'Content-Type':a.mime,'Cache-Control':'no-store'}});}
    const projectMatch=/^\/api\/projects\/([\w-]+)(?:\/(history|restore|export|messages|preview))?$/.exec(path);
    if(projectMatch){const id=projectMatch[1],action=projectMatch[2];if(action==='history')return json(history(id));if(action==='restore'&&req.method==='POST'){const a=object(await req.json());return json(await exclusive(id,async()=>restore(id,number(a.revision,0,100000))));}if(action==='export')return exportSite(id);if(action==='messages')return json(db.query('SELECT role,content FROM messages WHERE project=? ORDER BY id').all(id));if(action==='preview')return new Response(renderSite(getProject(id).site,x=>`/api/assets/${x}`),{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox"}});if(!action&&req.method==='POST'){const a=object(await req.json());return json(await exclusive(id,async()=>{const current=getProject(id);if(a.revision!==current.revision)throw new Error('The website changed. Reload before saving.');const site=validateSite(a.site),checks=checkSite(site,listAssets().map(x=>x.id));if(!checks.ok)throw new Error(checks.errors.join('; '));return saveProject(id,site,'Manual edit');}));}if(!action)return json(getProject(id));}
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
if(import.meta.main){const localServer=Bun.serve({hostname:'127.0.0.1',port,maxRequestBodySize:151_000_000,idleTimeout:255,fetch:handle});startSoftwareWorker();console.log(`Anascummis Studio: ${origin}`);const close=()=>{shutdownSoftwareWorker();for(const job of jobs.values())job.controller.abort();void localServer.stop(true);setTimeout(()=>process.exit(0),2000).unref();};process.on('SIGINT',close);process.on('SIGTERM',close);}







