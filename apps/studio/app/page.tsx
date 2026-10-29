'use client';
import {taskVoice,identityReply} from '../core/character';
import {softwareRequested} from '../core/software-tools';
import {browserSoftwareTools} from '../components/software-tools';
import {SoftwarePanel,buildApi,builderPair} from '../components/SoftwarePanel';
import {WorkPanel} from '../components/WorkPanel';
import {GoalPanel} from '../components/GoalPanel';
import {DownloadLocal,LocalReadiness,type LocalRuntimeState} from '../components/DownloadLocal';
import {PeerPanel} from '../components/PeerPanel';
import {Microphone} from '../components/microphone';
import {conversational,converse,replyPrompt} from '../core/conversation';
import {newsQuestion} from '../core/request-intent';
import {summarizeNews} from '../core/news-answer';
import type {VisualContext} from '../core/visual-context';
import type {NewsPack} from '../core/news';
import type {WorkRecord} from '../core/work-journal';
import {useEffect,useRef,useState} from 'react';
import {Orb,type OrbState} from '../components/Orb';
import {voiceRequest,stopVoice} from '../components/voice';
import {speechChunks} from '../components/turn-timing';
import {browserInfer,stopBrowserModel,warmBrowserModel,browserAnswer} from '../components/browser-model';
import {demoTools} from '../components/demo-tools';
import {objectSchema,type Tool} from '../core/harness';
import {orchestrate} from '../core/orchestrator';
import {initialSite,renderSite,validateSite,type Site} from '../core/site';
import dynamic from 'next/dynamic';
import {requestsOnlineTools} from '../core/request-intent';
import {transcribeRecording} from '../components/transcribe-recording';
const FloatingPanels=dynamic(()=>import('../components/FloatingPanels').then(m=>m.FloatingPanels),{ssr:false});
const BabylonPreview=dynamic(()=>import('../components/BabylonPreview').then(m=>m.BabylonPreview),{ssr:false});
const EtroPreview=dynamic(()=>import('../components/EtroPreview').then(m=>m.EtroPreview),{ssr:false});
type PreviewKind='website'|'pdf'|'scene'|'video'|'timeline';
type Asset={id:string;name:string;url?:string};
type Doc={id:string;name:string;pages:number;revision:number};
type BackgroundTask={id:string;request:string;status:'running'|'complete'|'failed'|'cancelled';progress:string;message?:string;agents?:{id:string;agent:string;status:string;message:string}[]};
type Transfer={id:string;name:string;percent:number;phase:'uploading'|'processing'|'attached'|'failed';detail?:string};
type Delivery='voice'|'text';
type RequestContext={projectId:string;documentId?:string};
type RecoveredRequest={context:RequestContext;workId?:string;unconfirmed?:boolean};
type FailedDraft={attempt:number;text:string;message:string;context?:RequestContext};
async function api(path:string,body?:unknown,signal?:AbortSignal){const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',signal,headers:body instanceof FormData?{'X-Requested-With':'Anascummis'}:{'Content-Type':'application/json','X-Requested-With':'Anascummis'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Local app unavailable');return data;}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function progressLabel(event:{agent:string;phase:string}){const item=({website:'website',pdf:'PDF',scene:'3D scene',commerce:'payment link',research:'research',workspace:'files',video:'video',video_sources:'video sources'} as Record<string,string>)[event.agent];return event.phase==='verifying'?`Checking your ${item||'changes'}…`:event.agent==='coordinator'?'Planning your request…':`Working on your ${item||'request'}…`;}
export default function Anascummis(){
  const [textOpen,setTextOpen]=useState(false),[draft,setDraft]=useState(''),[dragging,setDragging]=useState(false),[transfers,setTransfers]=useState<Transfer[]>([]);
  const draftRef=useRef(''),draftVersion=useRef(0),draftAttempt=useRef(0),recoveredRequestRef=useRef<RecoveredRequest|undefined>(undefined);
  const [failedDraft,setFailedDraft]=useState<FailedDraft>(),[recoveredRequest,setRecoveredRequest]=useState<RecoveredRequest>(),[recoveryResearch,setRecoveryResearch]=useState(false),[sendingText,setSendingText]=useState(false),[stagingRequest,setStagingRequest]=useState(false);
  const stagingRef=useRef(false),mounted=useRef(true),readinessCheck=useRef<{id:number;control?:AbortController}>({id:0}),voiceAttemptId=useRef(0),contextLoad=useRef<AbortController|undefined>(undefined);
  const [runtimeState,setRuntimeState]=useState<LocalRuntimeState>({model:'unknown',voice:'unknown'}),[checkingRuntime,setCheckingRuntime]=useState(false),[setupRequest,setSetupRequest]=useState(0);
  const [peersOpen,setPeersOpen]=useState(false),[softwareOpen,setSoftwareOpen]=useState(false),[softwareGoal,setSoftwareGoal]=useState(''),[workOpen,setWorkOpen]=useState(false),[goalsOpen,setGoalsOpen]=useState(false);
  const [softwareSelection,setSoftwareSelection]=useState<{id:string;key:number}>();
  const [hiddenPanels,setHiddenPanels]=useState<Set<string>>(()=>new Set());
  const [panelRaise,setPanelRaise]=useState<{id:string;key:number}>();
  function raisePanel(id:string){setPanelRaise(current=>({id,key:(current?.key||0)+1}));}
  const [openSurfaces,setOpenSurfaces]=useState<PreviewKind[]>([]);
  function setSurface(next:PreviewKind|null){if(next)setHiddenPanels(current=>new Set([...current].filter(id=>id!=='preview-'+next)));selectSurface(next);setOpenSurfaces(current=>next?current.includes(next)?current:[...current,next]:current.filter(p=>p!==surface));}
  const [backgroundTasks,setBackgroundTasks]=useState<BackgroundTask[]>([]),taskControls=useRef(new Map<string,{control:AbortController;jobId?:string}>());
  const textInput=useRef<HTMLTextAreaElement|null>(null),spaceTime=useRef<number|null>(null),dragDepth=useRef(0);
  const [local,setLocal]=useState(false),[workspaceReady,setWorkspaceReady]=useState(false),[state,setState]=useState<OrbState>('idle'),[level,setLevel]=useState(0),[status,setStatus]=useState('Touch the orb to talk, or type a message.'),[caption,setCaption]=useState(''),[site,setSite]=useState<Site>(initialSite),[assets,setAssets]=useState<Asset[]>([]),[doc,setDoc]=useState<Doc|null>(null),[video,setVideo]=useState<{id:string;name:string;projectId?:string}|null>(null),[timeline,setTimeline]=useState<string|null>(null),[surface,selectSurface]=useState<PreviewKind|null>(null),[size,setSize]=useState(300),[reduced,setReduced]=useState(false);
  const timings=useRef<Record<string,number>>({}),[lastTiming,setLastTiming]=useState<Record<string,number>>({});
  const mic=useRef<Microphone|null>(null),conversation=useRef(false),warm=useRef<Promise<void>|null>(null),history=useRef<{role:string;content:string}[]>([]);
  const [newsSources,setNewsSources]=useState<NewsPack|null>(null),[visualContext,setVisualContext]=useState<VisualContext|null>(null),[researchOpen,setResearchOpen]=useState(false);
  const siteRef=useRef(site),project=useRef<any>(null),controller=useRef<AbortController|null>(null),job=useRef<string|null>(null),audio=useRef<AudioContext|null>(null),source=useRef<AudioBufferSourceNode|null>(null),player=useRef<HTMLAudioElement|null>(null),recording=useRef<boolean>(false),busy=useRef(false),fileInput=useRef<HTMLInputElement|null>(null),fileKind=useRef<'image'|'pdf'|'media'>('image'),micCancelled=useRef(false),pendingFile=useRef(false),videoRef=useRef(video);
  const documentRef=useRef(doc);documentRef.current=doc;
  videoRef.current=video;
  siteRef.current=site;
  function writeDraft(text:string){draftRef.current=text;draftVersion.current++;setDraft(text);}
  function setDraftRecovery(value:RecoveredRequest|undefined){recoveredRequestRef.current=value;setRecoveredRequest(value);setRecoveryResearch(false);}
  function setDocument(value:Doc|null){documentRef.current=value;setDoc(value);}
  function openText(){setTextOpen(true);requestAnimationFrame(()=>{textInput.current?.focus();textInput.current?.scrollIntoView({block:'center',behavior:'smooth'});});}
  function openSetup(){setSetupRequest(current=>current+1);}
  function openWorkHistory(){setWorkOpen(true);raisePanel('background-work');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='background-work')));}
  function inspectUnconfirmed(){if(failedDraft&&softwareRequested(failedDraft.text)){setSoftwareOpen(true);raisePanel('software-work');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='software-work')));}else if(failedDraft&&/^\s*(?:please\s+)?(?:plan|pursue|start|work on)\s+(?:this |a |my )?(?:goal|long task)\s*:/i.test(failedDraft.text)){setGoalsOpen(true);raisePanel('coordinated-goals');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='coordinated-goals')));}else openWorkHistory();}
  async function checkRuntime(){
    if(location.hostname!=='127.0.0.1')return;
    readinessCheck.current.control?.abort();const control=new AbortController(),id=readinessCheck.current.id+1;readinessCheck.current={id,control};
    setCheckingRuntime(true);setRuntimeState(current=>({...current,model:'checking',error:undefined}));
    try{const result=await api('/status',undefined,control.signal);if(!mounted.current||control.signal.aborted||readinessCheck.current.id!==id)return;
      if(typeof result.model?.ready!=='boolean')throw new Error('The local app could not confirm AI service status.');
      setRuntimeState(current=>({...current,model:result.model.ready?'ready':'unavailable',error:result.model.ready?undefined:'The local AI service is unavailable. Open local setup and check again when it is running.'}));
    }catch(error){if(mounted.current&&!control.signal.aborted&&readinessCheck.current.id===id)setRuntimeState(current=>({...current,model:'unknown',error:'The local app could not check the AI service. Check your connection and try again.'}));}
    finally{if(mounted.current&&readinessCheck.current.id===id)setCheckingRuntime(false);}
  }
  async function voiceAttempt<T>(run:()=>Promise<T>,signal:AbortSignal):Promise<T>{
    const id=++voiceAttemptId.current;if(mounted.current)setRuntimeState(current=>({...current,voice:'checking'}));
    try{const value=await run();signal.throwIfAborted();if(mounted.current&&id===voiceAttemptId.current)setRuntimeState(current=>({...current,voice:'ready'}));return value;}
    catch(error){if(mounted.current&&id===voiceAttemptId.current)setRuntimeState(current=>({...current,voice:signal.aborted?'unknown':'unavailable'}));throw error;}
  }
  function warmLocalVoice(isLocal:boolean,signal:AbortSignal){
    if(warm.current)return warm.current;
    const pending=voiceAttempt(async()=>{await voiceRequest('listen',{warm:true},signal,()=>{});if(isLocal)await api('/speech/warm',{},signal);else await voiceRequest('speak',{warm:true},signal,()=>{});},signal);
    warm.current=pending;void pending.catch(()=>{if(warm.current===pending)warm.current=null;});return pending;
  }
  const writeSite=(next:Site)=>{siteRef.current=next;setSite(next);try{localStorage.setItem('anascummis.demo.site',JSON.stringify(next));}catch{setStatus('Storage is full. Ask me to export your website.');}};
  useEffect(()=>{
    mounted.current=true;const initialize=new AbortController();
    const isLocal=location.hostname==='127.0.0.1';setLocal(isLocal);
    if(isLocal)void checkRuntime();
    const resize=()=>setSize(Math.max(160,Math.round(Math.min(innerWidth*.65,innerHeight*.48,360))));resize();window.addEventListener('resize',resize);setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches);
    void (async()=>{try{if(isLocal){const projects=await api('/projects',undefined,initialize.signal),current=projects.length?await api('/projects/'+projects[0].id,undefined,initialize.signal):await api('/projects',{name:'My business'},initialize.signal),loadedAssets=await api('/assets',undefined,initialize.signal),builds=await api('/software',undefined,initialize.signal);if(initialize.signal.aborted)return;project.current=current;setSite(current.site);setAssets(loadedAssets);if(builds.length)setSoftwareOpen(true);}else{const raw=localStorage.getItem('anascummis.demo.site');if(raw)setSite(validateSite(JSON.parse(raw)));}if(initialize.signal.aborted)return;setWorkspaceReady(true);void warmLocalVoice(isLocal,initialize.signal).catch(()=>{});}catch(e){if(!initialize.signal.aborted)setStatus(String(e));}})();
    if(location.hash.startsWith('#goal='))setPeersOpen(true);
    const key=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(document.querySelector('dialog.download-local-dialog[open]')||target?.closest('.download-local-trigger')){spaceTime.current=null;return;}if(e.key==='Escape'){setTextOpen(false);spaceTime.current=null;stop();}if(e.code!=='Space'||e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;if(target?.closest('input,textarea,select,button,summary,a[href],[role="button"],[role="link"],[tabindex]:not([tabindex="-1"]),[contenteditable="true"]')){spaceTime.current=null;return;}e.preventDefault();e.stopPropagation();const now=performance.now();if(spaceTime.current!==null&&now-spaceTime.current<=450){spaceTime.current=null;openText();}else spaceTime.current=now;};window.addEventListener('keydown',key,true);
    const progress=(e:Event)=>{if(!busy.current)setStatus((e as CustomEvent<string>).detail);};window.addEventListener('anascummis-model-progress',progress);
    return()=>{mounted.current=false;initialize.abort();readinessCheck.current.control?.abort();contextLoad.current?.abort();voiceAttemptId.current++;warm.current=null;window.removeEventListener('resize',resize);window.removeEventListener('keydown',key,true);window.removeEventListener('anascummis-model-progress',progress);controller.current?.abort();for(const task of taskControls.current.values())task.control.abort();stopVoice();stopBrowserModel();mic.current?.close();source.current?.stop();player.current?.pause();void audio.current?.close();};
  },[]);
  useEffect(()=>{if(!local)return;const control=new AbortController();void api('/jobs?limit=1',undefined,control.signal).then(page=>{if(!control.signal.aborted&&(page.active.length||page.history.length))setWorkOpen(true);}).catch(()=>{});void api('/goals',undefined,control.signal).then(goals=>{if(!control.signal.aborted&&Array.isArray(goals)&&goals.length)setGoalsOpen(true);}).catch(()=>{});return()=>control.abort();},[local]);
  function stop(){conversation.current=false;micCancelled.current=true;controller.current?.abort();try{source.current?.stop();}catch{}source.current=null;player.current?.pause();mic.current?.close();recording.current=false;if(job.current)void api('/jobs/'+job.current+'/stop',{}).catch(()=>{});busy.current=false;setLevel(0);setState('idle');setStatus('Stopped. Touch the orb to talk.');}
  function prepareVoice(signal:AbortSignal){if(!local)warmBrowserModel();return warmLocalVoice(local,signal);}
  async function playPcm(pcm:Float32Array,rate:number,signal:AbortSignal){
    const ctx=audio.current ||= new AudioContext();await ctx.resume();signal.throwIfAborted();const buffer=ctx.createBuffer(1,pcm.length,rate);buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>,0);const src=ctx.createBufferSource(),analyser=ctx.createAnalyser();analyser.fftSize=256;src.buffer=buffer;src.connect(analyser);analyser.connect(ctx.destination);source.current=src;setState('speaking');setStatus('Speaking');let frame=0;const values=new Uint8Array(analyser.fftSize);const tick=()=>{analyser.getByteTimeDomainData(values);setLevel(Math.min(1,Math.sqrt(values.reduce((n,v)=>n+((v-128)/128)**2,0)/values.length)*4));frame=requestAnimationFrame(tick);};tick();
    await new Promise<void>(resolve=>{const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',cancel);source.current=null;src.disconnect();analyser.disconnect();resolve();};const cancel=()=>{try{src.stop();}catch{}done();};src.onended=done;signal.addEventListener('abort',cancel,{once:true});if(!timings.current.firstAudio){timings.current.firstAudio=performance.now();const metrics={firstAudioMs:Math.round(timings.current.firstAudio-(timings.current.inputEnd||timings.current.requestStart)),...(timings.current.firstText?{firstTextMs:Math.round(timings.current.firstText-timings.current.requestStart)}:{})};setLastTiming(metrics);window.dispatchEvent(new CustomEvent('anascummis-timing',{detail:metrics}));}src.start();});
  }
  function speak(text:string,signal:AbortSignal){return voiceAttempt(()=>synthesizeSpeech(text,signal),signal);}
  async function synthesizeSpeech(text:string,signal:AbortSignal){
    setCaption(text);setState('considering');setStatus('Preparing voice…');
    if(local){const response=await fetch('/api/speech-stream',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Anascummis'},body:JSON.stringify({text}),signal});if(!response.ok||!response.body)throw new Error('Local voice is unavailable. Run bun run speech:setup.');const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',playback=Promise.resolve(),failure:unknown;
      try{for(;;){const result=await reader.read();if(result.done)break;pending+=decoder.decode(result.value,{stream:true});let end;while((end=pending.indexOf('\n'))>=0){const packet=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);if(packet.error)throw new Error(packet.error);const binary=atob(packet.audio),bytes=new Uint8Array(binary.length);for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);const view=new DataView(bytes.buffer),pcm=new Float32Array(bytes.length/2);for(let i=0;i<pcm.length;i++)pcm[i]=view.getInt16(i*2,true)/32768;playback=playback.then(async()=>{if(failure)return;try{await playPcm(pcm,packet.rate,signal);}catch(error){failure=error;}});}}await playback;if(failure)throw failure;}finally{await reader.cancel();}signal.throwIfAborted();setLevel(0);setState('idle');setStatus(conversation.current?'Listening…':'Touch the orb to reply.');return;
    }
    const chunks=speechChunks(text);
    const synthesize=(words:string)=>voiceRequest('speak',{text:words},signal,()=>{});
    let pending=chunks.length?synthesize(chunks[0]):null;
    for(let i=0;i<chunks.length;i++){signal.throwIfAborted();const result=await pending;pending=i+1<chunks.length?synthesize(chunks[i+1]):null;pending?.catch(()=>{});await playPcm(result.audio,result.rate,signal);}
    signal.throwIfAborted();setLevel(0);setState('idle');setStatus(conversation.current?'Listening…':'Touch the orb to reply.');
  }
  async function deliver(message:string,signal:AbortSignal,delivery:Delivery){
    signal.throwIfAborted();setCaption(message);
    if(delivery==='text'){setLevel(0);setState('idle');setStatus(message);return;}
    try{await speak(message,signal);}catch(error){signal.throwIfAborted();setLevel(0);setState('uncertain');setStatus(message+' Voice is unavailable; the response is shown here.');}
  }
  async function exportFile(format:string){
    if(format==='mp4'){if(!local||!videoRef.current)throw new Error('Create a video in the local app before exporting MP4.');const m=videoRef.current,r=await fetch('/api/media/'+m.id+'/export');if(!r.ok)throw new Error('Video export failed');download(await r.blob(),m.name);return;}
    if(local){const path=doc?`/documents/${doc.id}/export?format=${format==='png'?'png':'pdf'}&page=1&dpi=144`:`/projects/${project.current.id}/export`;const r=await fetch('/api'+path);if(!r.ok)throw new Error('Export failed');download(await r.blob(),doc?(format==='png'?'page-1.png':doc.name):siteRef.current.name+'.zip');}
    else{if(siteRef.current.sections.some(s=>s.imageId&&!assets.some(a=>a.id===s.imageId)))throw new Error('Attach the missing images again before exporting.');download(new Blob([renderSite(siteRef.current,id=>assets.find(a=>a.id===id)?.url||'')],{type:'text/html'}),siteRef.current.name+'.html');}
  }
  async function workspaceAction(action:string,format='pdf'){
    if(action==='show_website'){setSurface('website');return 'The website preview is open.';}
    if(action==='show_scene'){setSurface('scene');return 'The 3D preview is open.';}
    if(action==='show_pdf'){if(!doc)throw new Error('Ask me to open a PDF first.');setSurface('pdf');return 'The PDF preview is open.';}
    if(action==='show_video'){if(!videoRef.current)throw new Error('Create a video first.');setSurface('video');return 'The video preview is open.';}
    if(action==='preview_video_timeline'){if(!local)throw new Error('Video editing needs the local app.');const plans=await api('/video-projects');const id=videoRef.current?.projectId||plans[0]?.id;if(!id)throw new Error('Create a video timeline first.');setTimeline(id);setSurface('timeline');return 'The Etro timeline preview is open.';}
    if(action==='close_preview'){setSurface(null);return 'The preview is closed.';}
    if(action==='attach_image'||action==='open_pdf'||action==='open_media'){if(action!=='attach_image'&&!local)throw new Error('PDF and video editing need the local app.');fileKind.current=action==='open_pdf'?'pdf':action==='open_media'?'media':'image';if(fileInput.current){fileInput.current.accept=fileKind.current==='pdf'?'application/pdf':fileKind.current==='media'?'video/*,audio/*,image/png,image/jpeg':'image/png,image/jpeg';pendingFile.current=true;}return 'Touch the orb to choose your file.';}
    if(action==='export'){await exportFile(format);return 'Your export is ready to download.';}
    throw new Error('Unknown workspace action');
  }
  const workspaceTools:Tool[]=[{name:'workspace',description:'Show or close a requested preview, open a user file picker, or export. PDF/video tools require the local app.',schema:objectSchema({action:{type:'string',enum:['show_website','show_scene','show_pdf','show_video','preview_video_timeline','close_preview','attach_image','open_pdf','open_media','export']},format:{type:'string',enum:['pdf','png','html','zip','mp4']}}),run:async raw=>{const a=raw as {action:string;format:string};return workspaceAction(a.action,a.format);}}];
  async function reply(text:string,signal:AbortSignal,news?:NewsPack,isNews=false,delivery:Delivery='voice'){
    const identity=!isNews&&identityReply(text);if(identity){await deliver(identity,signal,delivery);return identity;}
    let whole='',pending='',playback=Promise.resolve(),voiceFailure:unknown;
    const queue=(chunk:string)=>{playback=playback.then(async()=>{if(voiceFailure)return;try{await speak(chunk,signal);}catch(e){voiceFailure=e;}});};
    const receive=(delta:string)=>{
      signal.throwIfAborted();if(!timings.current.firstText)timings.current.firstText=performance.now();whole+=delta;setCaption(whole);if(delivery==='text'){setStatus(whole);return;}pending+=delta;
      const sentence=pending.search(/[.!?](?:\s|$)/);
      if(sentence>=15){queue(pending.slice(0,sentence+1));pending=pending.slice(sentence+1).trimStart();}
      else if(pending.length>=140){const end=pending.slice(0,140).lastIndexOf(' ');if(end>15){queue(pending.slice(0,end));pending=pending.slice(end).trimStart();}}
    };
    try{
      if(local){const response=await fetch('/api/answer-stream',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Anascummis'},body:JSON.stringify({text,history:history.current,news:isNews}),signal});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'The local reply service is unavailable');}if(!response.body)throw new Error('The local reply stream is unavailable');
        const reader=response.body.getReader(),decoder=new TextDecoder();let lines='';
        try{for(;;){const {done,value}=await reader.read();if(done)break;lines+=decoder.decode(value,{stream:true});let at;while((at=lines.indexOf('\n'))>=0){const line=lines.slice(0,at);lines=lines.slice(at+1);if(!line.trim())continue;const event=JSON.parse(line);if(event.error)throw new Error(event.error);if(event.sources)setNewsSources(event.sources);if(event.text)receive(event.text);}}}finally{await reader.cancel();}
      }else{const prompt=replyPrompt(text,history.current,news);await browserAnswer(prompt.system,prompt.user,signal,receive);}
      if(pending.trim())queue(pending.trim());await playback;
      if(delivery==='text')await deliver(whole.trim(),signal,delivery);
      else if(voiceFailure){signal.throwIfAborted();setState('uncertain');setCaption(whole);setStatus(whole.trim()+' Voice is unavailable; the response is shown here.');}
      return whole.trim();
    }catch(e){await playback;throw e;}
  }
  async function launchBackground(text:string,signal:AbortSignal,onAccepted?:()=>void,research?:boolean){
    if(softwareRequested(text)){setSoftwareOpen(true);raisePanel('software-work');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='software-work')));if(!local&&!builderPair()){setSoftwareGoal(text);return 'I’ve kept your goal here. Connect the local builder and I can put it to work.';}await buildApi('/software',local,{goal:text},signal);onAccepted?.();setSoftwareGoal('');return 'I’ve saved the whole goal and queued the build. You can keep talking to me; its progress and checked downloads will appear here.';}

    if([...taskControls.current.values()].filter(t=>!t.control.signal.aborted).length>=3)throw new Error('Three background tasks are already running. Let one finish or stop it.');
    const id=crypto.randomUUID(),control=new AbortController(),task:{control:AbortController;jobId?:string}={control};taskControls.current.set(id,task);
    const update=(patch:Partial<BackgroundTask>)=>setBackgroundTasks(current=>current.map(t=>t.id===id?{...t,...patch}:t));
    openWorkHistory();setBackgroundTasks(current=>[...current,{id,request:text.slice(0,300),status:'running',progress:'Starting specialist…'}]);
    const targetProject=project.current?.id,targetDocument=documentRef.current?.id;let started:any;
    try{if(local){started=await api('/chat',{project:targetProject,document:targetDocument,text,research:research??requestsOnlineTools(text),savedDetails:[]},signal);if(typeof started.jobId!=='string'||!started.jobId)throw new Error('The local app did not confirm a saved job. Inspect Work history before trying again.');task.jobId=started.jobId;onAccepted?.();}}catch(e){taskControls.current.delete(id);update({status:'failed',progress:'Submission not confirmed',message:String(e)});throw e;}
    void (async()=>{
      try{
        let result:any;
        if(local){for(;;){control.signal.throwIfAborted();const j=await api('/jobs/'+started.jobId,undefined,control.signal);if(j.status==='complete'){result=j.result;break;}if(j.status!=='running')throw new Error(j.error||'Stopped');if(j.progress)update({progress:progressLabel(j.progress)});await new Promise(r=>setTimeout(r,250));}
          if(project.current?.id===targetProject&&documentRef.current?.id===targetDocument){const previousProject=project.current,previousDocument=documentRef.current;const [updatedProject,updatedDocument]=await Promise.all([api('/projects/'+targetProject),targetDocument?api('/documents/'+targetDocument):Promise.resolve(null)]);if(project.current===previousProject&&documentRef.current===previousDocument){project.current=updatedProject;siteRef.current=updatedProject.site;setSite(updatedProject.site);setDocument(updatedDocument);}}
        }else{if(!softwareRequested(text)&&/\b(create|make|edit|trim|combine|render|cut)\b[\s\S]*\b(video|audio|recording|montage|narration)\b/i.test(text))throw new Error('Video editing needs the downloaded local app with FFmpeg.');
          result=await orchestrate(text,{site:siteRef.current,assets:assets.map(a=>({id:a.id,name:a.name}))},[...browserSoftwareTools(),...demoTools(()=>siteRef.current,writeSite,assets.map(a=>a.id)),...workspaceTools],control.signal,browserInfer,{onEvent:event=>update({progress:progressLabel(event)})});
        }
        const sameWorkspace=!local||project.current?.id===targetProject&&documentRef.current?.id===targetDocument;
        if(sameWorkspace){for(const entry of result.trace||[]){if(entry.ok&&(entry.result as any)?.videoReady){const v=entry.result as any,next={...v.videoReady,projectId:v.projectId};videoRef.current=next;setVideo(next);setSurface('video');}if(entry.ok&&(entry.result as any)?.workspaceRequest){const w=(entry.result as any).workspaceRequest;await workspaceAction(w.action,w.format);}}
          if((result.trace||[]).some((t:any)=>t.ok&&['set_copy','set_theme','put_section','remove_section','set_payment_link'].includes(t.tool)))setSurface('website');
          if(targetDocument&&(result.trace||[]).some((t:any)=>t.ok&&/pdf/.test(t.tool)&&!t.tool.startsWith('inspect')))setSurface('pdf');}
        const complete=result.orchestration?.stopReason==='finished';update({status:complete?'complete':'failed',progress:complete?'Verified result ready':'Needs attention',message:result.message,agents:result.orchestration?.tasks});
        if(local&&!complete&&!control.signal.aborted)void checkRuntime();
        if(!busy.current)setStatus(complete?'Your background result is ready.':'Background work needs attention.');
      }catch(e){update({status:control.signal.aborted?'cancelled':'failed',progress:control.signal.aborted?'Stopped':'Needs attention',message:e instanceof Error?e.message:String(e)});if(local&&!control.signal.aborted)void checkRuntime();}finally{taskControls.current.delete(id);}
    })();
    return "I'll work on that in the background. You can keep talking to me.";
  }
  function stopBackground(id:string){const task=taskControls.current.get(id);task?.control.abort();if(task?.jobId)void api('/jobs/'+task.jobId+'/stop',{}).catch(()=>{});}
  async function openWorkProject(id:string){try{const value=await api('/projects/'+id);project.current=value;setSite(value.site);setSurface('website');raisePanel('preview-website');}catch(error){setStatus(String(error));}}
  async function openWorkDocument(id:string){try{setDocument(await api('/documents/'+id));setSurface('pdf');raisePanel('preview-pdf');}catch(error){setStatus(String(error));}}
  async function stageSavedRequest(text:string,context:RequestContext|undefined,recovery:Omit<RecoveredRequest,'context'>={}){
    if(busy.current)throw new Error('A foreground request is active. Finish or stop it before editing a saved request.');
    if(stagingRef.current)throw new Error('Another saved request is still loading its original workspace.');
    const previousDraft=draftRef.current,previousDraftVersion=draftVersion.current;
    if(previousDraft&&previousDraft!==text){openText();throw new Error('Your composer already contains a different unsent message. Keep or clear it before editing this saved request.');}
    if(!local||!context?.projectId)throw new Error('The original local website workspace is unavailable. This request has not been staged or sent.');
    const previousProject=project.current,previousDocument=documentRef.current,control=new AbortController();contextLoad.current=control;stagingRef.current=true;setStagingRequest(true);
    try{
      const [originalProject,originalDocument]=await Promise.all([api('/projects/'+encodeURIComponent(context.projectId),undefined,control.signal),context.documentId?api('/documents/'+encodeURIComponent(context.documentId),undefined,control.signal):Promise.resolve(null)]);
      if(control.signal.aborted||!mounted.current)throw new Error('Loading the saved request was stopped. Nothing was sent.');
      if(originalProject.id!==context.projectId||!originalProject.site||context.documentId&&originalDocument?.id!==context.documentId)throw new Error('The original website or PDF is unavailable. Nothing was staged or sent.');
      if(busy.current||draftVersion.current!==previousDraftVersion||project.current!==previousProject||documentRef.current!==previousDocument)throw new Error('Your draft or current workspace changed while the saved request was loading. They were kept; stage the saved request again when ready.');
      project.current=originalProject;siteRef.current=originalProject.site;setSite(originalProject.site);setDocument(originalDocument);writeDraft(text);setDraftRecovery({...recovery,context});openText();setStatus('The saved request is ready to edit in its original workspace. Send starts a new run; review earlier changes first.');
    }catch(error){if(control.signal.aborted)throw error;throw new Error('Could not restore the original website and PDF together. Nothing was sent. '+(error instanceof Error?error.message:String(error)));}
    finally{if(contextLoad.current===control)contextLoad.current=undefined;stagingRef.current=false;if(mounted.current)setStagingRequest(false);}
  }
  async function editWorkRequest(record:WorkRecord){await stageSavedRequest(record.request,{projectId:record.projectId,documentId:record.documentId},{workId:record.id});}
  async function editFailedDraft(){if(!failedDraft)return;try{await stageSavedRequest(failedDraft.text,failedDraft.context,{unconfirmed:true});}catch(error){setStatus(error instanceof Error?error.message:String(error));}}
  function openGoalSoftware(id:string){raisePanel('software-work');setSoftwareSelection(current=>({id,key:(current?.key||0)+1}));setSoftwareOpen(true);setHiddenPanels(current=>new Set([...current].filter(panelId=>panelId!=='software-work')));}
  async function planPeerGoal(goal:string){const schema=objectSchema({steps:{type:'array',items:{type:'string',maxLength:300},minItems:1,maxItems:3}}),signal=AbortSignal.timeout(45000);const prompt='Propose at most three concrete subtasks for this shared goal. Return steps JSON. Do not execute actions or include private local information.';const value:any=local?await api('/peer-plan',{goal},signal):await browserInfer(prompt,goal,schema,signal);return value.steps.join('\n');}
  async function runPeerTask(task:string){if(!local){const result=await orchestrate(task,{site:siteRef.current,assets:[]},demoTools(()=>siteRef.current,writeSite,[]),AbortSignal.timeout(120000),browserInfer);return result.message;}
    setWorkOpen(true);raisePanel('background-work');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='background-work')));const signal=AbortSignal.timeout(120000),started=await api('/chat',{project:project.current.id,text:task,research:requestsOnlineTools(task),savedDetails:[]},signal);for(;;){const result=await api('/jobs/'+started.jobId,undefined,signal);if(result.status==='complete'){project.current=await api('/projects/'+project.current.id);setSite(project.current.site);return result.result.message;}if(result.status!=='running')throw new Error(result.error||'Peer task stopped');await new Promise(resolve=>setTimeout(resolve,250));}}
  async function request(text:string,signal:AbortSignal,delivery:Delivery='voice',onAccepted?:()=>void,research?:boolean){
    signal.throwIfAborted();timings.current={inputEnd:timings.current.inputEnd||performance.now(),requestStart:performance.now()};setCaption(text);setState('considering');setStatus('Thinking…');
    const command=text.toLowerCase().replace(/[.!?]+$/,'').trim();let action:string|undefined;
    const goalRequest=/^\s*(?:please\s+)?(?:plan|pursue|start|work on)\s+(?:this |a |my )?(?:goal|long task)\s*:\s*([\s\S]+)$/i.exec(text);
    if(goalRequest){if(!local)throw new Error('Coordinated goals need the downloaded local app.');setGoalsOpen(true);raisePanel('coordinated-goals');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='coordinated-goals')));await api('/goals',{request:goalRequest[1],project:project.current.id,document:documentRef.current?.id,research:research??requestsOnlineTools(goalRequest[1])},signal);onAccepted?.();await deliver('The full goal is saved. Its plan, specialist work and acceptance reviews will appear in the goals window.',signal,delivery);return;}
    if(/\b(collaborat(?:e|ion)|shared goal|peer instances|work together)\b/i.test(command)){setPeersOpen(true);setHiddenPanels(current=>new Set([...current].filter(id=>id!=='shared-goal')));await deliver('The shared goal panel is open. Create an invite or join a collaborator’s goal.',signal,delivery);return;}
    if(/^(please )?(show|preview|let me see)( me)? (the |my )?(website|site)$/.test(command))action='show_website';
    else if(/^(please )?(show|preview)( me)? (the |my )?(3d|three dimensional|scene)( preview)?$/.test(command))action='show_scene';
    else if(/^(please )?(show|preview)( me)? (the |my )?pdf$/.test(command))action='show_pdf';
    else if(/^(please )?(show|preview)( me)? (the |my )?video$/.test(command))action='show_video';
    else if(/^(please )?(show|preview)( me)? (the |my )?(video )?timeline$/.test(command))action='preview_video_timeline';
    else if(/^(please )?(close|hide) (the )?(preview|website|pdf|scene)$/.test(command))action='close_preview';
    else if(/^(please )?(open|attach|upload|add) (a |an |my |the )?(pdf|image|picture|photo|video|audio|recording|narration)$/.test(command))action=command.endsWith('pdf')?'open_pdf':/\b(video|audio|recording|narration)$/.test(command)?'open_media':'attach_image';
    else if(/^(please )?export( (the |my )?(website|site|pdf|file|video))?( as (png|pdf|html|zip|mp4))?$/.test(command))action='export';
    let message:string,spoken=false;
    if(/^(?:please )?(?:show|open) (?:my |the )?(?:goals|goal progress|long tasks|coordinated goals)$/.test(command)){if(!local){await deliver('Coordinated goals run in the downloaded local app.',signal,delivery);return;}setGoalsOpen(true);raisePanel('coordinated-goals');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='coordinated-goals')));await deliver('Your coordinated goals window is open.',signal,delivery);return;}
    if(/^(?:please )?(?:show|open) (?:my |the )?(?:work|tasks|work history|task history|background work)$/.test(command)){openWorkHistory();await deliver(local?'Your saved work history is open.':'Your background work panel is open.',signal,delivery);return;}
    if(/^(?:please )?(?:show|open) (?:my |the )?(?:software work|builds|build tasks|software tasks|builder)$/.test(command)){setSoftwareOpen(true);raisePanel('software-work');setHiddenPanels(current=>new Set([...current].filter(id=>id!=='software-work')));await deliver('Your persistent software work panel is open.',signal,delivery);return;}
    if(/\b(?:build|app|task)\b/.test(command)&&/\b(?:progress|status|how long|remaining|finished|done)\b/.test(command)){const tasks=await buildApi('/software',local);const task=tasks[0];await deliver(task?taskVoice(task):'There are no software builds yet.',signal,delivery);return;}

    if(action)message=await workspaceAction(action,/\b(mp4|video)$/.test(command)?'mp4':command.endsWith('png')?'png':'pdf');
    else if(softwareRequested(text))message=await launchBackground(text,signal,onAccepted,research);
    else if(newsQuestion(text)){setStatus('Looking up recent sources…');setResearchOpen(true);setHiddenPanels(current=>new Set([...current].filter(id=>!id.startsWith('research-'))));void api('/visual',{query:text},signal).then(result=>{if(!signal.aborted)setVisualContext(result);}).catch(()=>{});
      if(local)message=await reply(text,signal,undefined,true,delivery);else{const pack=await api('/news',{query:text},signal) as NewsPack;setNewsSources(pack);setStatus('Reading recent headlines…');message=await reply(text,signal,pack,true,delivery);}spoken=true;
    }
    else if(conversational(text)){setStatus('Answering…');message=await reply(text,signal,undefined,false,delivery);spoken=true;}
    else message=await launchBackground(text,signal,onAccepted,research);
    onAccepted?.();job.current=null;history.current=[...history.current,{role:'user',content:text},{role:'assistant',content:message}].slice(-4);if(!spoken)await deliver(message,signal,delivery);
  }
  async function toggleOrb(){
    if(pendingFile.current&&!busy.current){pendingFile.current=false;fileInput.current?.click();return;}
    if(recording.current){mic.current?.finish();return;}
    if(busy.current)stop();
    conversation.current=true;micCancelled.current=false;busy.current=true;
    const control=new AbortController();controller.current=control;
    try{
      const ctx=audio.current ||= new AudioContext();await ctx.resume();void prepareVoice(control.signal)?.catch(()=>{});
      const input=mic.current ||= new Microphone(ctx);await input.open();control.signal.throwIfAborted();
      while(conversation.current&&!control.signal.aborted){
        setState('listening');setStatus('Listening. Pause when finished; Escape stops.');recording.current=true;
        let speculative:Promise<any>|undefined,proposed=-1,inflight=false;
        const captured=await input.listen(control.signal,setLevel,(pcm,revision)=>{
          if(inflight)return;inflight=true;proposed=revision;
          speculative=voiceAttempt(()=>voiceRequest('listen',{audio:pcm},control.signal,()=>{}),control.signal).finally(()=>{inflight=false;});speculative.catch(()=>{});
        });
        timings.current={inputEnd:performance.now()};recording.current=false;setState('considering');setStatus('Understanding your voice…');
        const result=proposed===captured.revision&&speculative?await speculative:await voiceAttempt(()=>voiceRequest('listen',{audio:captured.pcm},control.signal,setStatus),control.signal);
        control.signal.throwIfAborted();const text=result.text?.trim();
        if(!text){setStatus('I did not catch that. Please try again.');continue;}
        const turn=new AbortController(),turnSignal=AbortSignal.any([control.signal,turn.signal]);
        input.watchSpeech(()=>{turn.abort();if(job.current)void api('/jobs/'+job.current+'/stop',{}).catch(()=>{});try{source.current?.stop();}catch{}setState('listening');setStatus('Listening…');});
        try{await request(text,turnSignal);}catch(e){if(!turn.signal.aborted||control.signal.aborted)throw e;}finally{input.watchSpeech();}
        if(turn.signal.aborted&&!control.signal.aborted)continue;
        // Discard the assistant's playback and echo tail before rearming the same microphone.
        await new Promise<void>(resolve=>setTimeout(resolve,180));
      }
    }catch(e){if(!control.signal.aborted){setState('uncertain');setStatus(e instanceof Error?e.message:String(e));}}
    finally{if(controller.current===control){conversation.current=false;recording.current=false;mic.current?.close();busy.current=false;}}
  }
  async function sendText(){
    const submitted=draftRef.current,text=submitted;if(!text.trim()||!workspaceReady)return;
    if(busy.current||stagingRef.current){setStatus('Finish the active request or wait for its workspace to load before sending this message. Your draft is kept.');return;}
    const recovery=recoveredRequestRef.current,context=local&&project.current?.id?{projectId:project.current.id,documentId:documentRef.current?.id}:undefined;
    if(recovery&&(!context||context.projectId!==recovery.context.projectId||context.documentId!==recovery.context.documentId)){setStatus('The original website or PDF for this draft is no longer selected. Stage the saved request again before sending it. Nothing was sent.');return;}
    if(recovery&&!recoveryResearch&&newsQuestion(text)){setStatus('Public web research is off for this recovered request. Enable it explicitly below or edit the message before sending. Nothing was sent.');return;}
    const control=new AbortController(),attempt=++draftAttempt.current;controller.current=control;busy.current=true;setSendingText(true);timings.current={inputEnd:performance.now()};writeDraft('');let accepted=false;
    try{await request(text,control.signal,'text',()=>{accepted=true;},recovery?recoveryResearch:undefined);if(controller.current===control&&attempt===draftAttempt.current&&!draftRef.current)setDraftRecovery(undefined);}
    catch(error){
      const message=error instanceof Error?error.message:String(error),active=mounted.current&&controller.current===control&&attempt===draftAttempt.current;
      if(!accepted&&mounted.current){setFailedDraft(current=>current&&current.attempt>attempt?current:{attempt,text:submitted,message,context});
        if(active&&(!draftRef.current||draftRef.current===submitted)){writeDraft(submitted);if(context)setDraftRecovery({context,unconfirmed:true});}
      }
      if(active){setState('uncertain');setStatus(accepted?'The request was saved. Inspect its work window for the current result. '+message:(control.signal.aborted?'Stopped waiting. ':'')+'Submission was not confirmed. Inspect saved work before sending again; it may have started. Your message is kept. '+message);if(local&&!control.signal.aborted)void checkRuntime();}
    }finally{if(controller.current===control)busy.current=false;if(mounted.current&&attempt===draftAttempt.current)setSendingText(false);}
  }
  const updateTransfer=(id:string,patch:Partial<Transfer>)=>setTransfers(current=>current.map(t=>t.id===id?{...t,...patch}:t));
  function uploadFile(path:string,file:File,id:string,signal:AbortSignal):Promise<any>{return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest(),form=new FormData();form.append('file',file);xhr.open('POST','/api'+path);xhr.setRequestHeader('X-Requested-With','Anascummis');xhr.withCredentials=true;const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});xhr.upload.onprogress=e=>{if(e.lengthComputable)updateTransfer(id,{percent:Math.round(e.loaded/e.total*100)});};xhr.upload.onload=()=>updateTransfer(id,{phase:'processing',percent:100});xhr.onload=()=>{signal.removeEventListener('abort',abort);try{const data=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw new Error(data.error||'Upload failed');resolve(data);}catch(e){reject(e);}};xhr.onerror=()=>{signal.removeEventListener('abort',abort);reject(new Error('File transfer failed'));};xhr.onabort=()=>{signal.removeEventListener('abort',abort);reject(new Error('Transfer stopped'));};if(signal.aborted){reject(new Error('Transfer stopped'));return;}xhr.send(form);});}
  async function attach(files:FileList|File[]|null,detect=false){if(!files?.length)return;if(busy.current)stop();const control=new AbortController();controller.current=control;busy.current=true;const received:string[]=[];try{for(const file of Array.from(files)){control.signal.throwIfAborted();const id=crypto.randomUUID(),kind=detect?(file.type==='application/pdf'||/\.pdf$/i.test(file.name)?'pdf':/^(audio|video)\//.test(file.type)||/\.(mp4|webm|mkv|mov|avi|mp3|wav|m4a|ogg|flac)$/i.test(file.name)?'media':'image'):fileKind.current;let note:string|undefined;setTransfers(current=>[...current.slice(-5),{id,name:file.name,percent:0,phase:'uploading'}]);setState('considering');setStatus(`Receiving ${file.name}…`);try{if(local){const result=await uploadFile(kind==='pdf'?'/documents':kind==='media'?'/media':'/assets',file,id,control.signal);if(kind==='pdf'){setDocument(result);setSurface('pdf');}if(kind==='media'&&result.audio&&!result.video){updateTransfer(id,{detail:'Transcribing locally…'});try{const transcript=await transcribeRecording(file,control.signal,setStatus);if(transcript)await api('/media/'+result.id+'/transcript',{text:transcript});}catch(e){control.signal.throwIfAborted();note='Attached; transcription unavailable';}}setAssets(await api('/assets'));const builds=await api('/software');if(builds.length)setSoftwareOpen(true);}else{if(kind!=='image')throw new Error('PDF, audio and video attachments require the local app.');if(!['image/png','image/jpeg'].includes(file.type)||file.size>5000000)throw new Error('Choose a PNG or JPEG smaller than 5 MB.');const url=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onprogress=e=>{if(e.lengthComputable)updateTransfer(id,{percent:Math.round(e.loaded/e.total*100)});};r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('File could not be read'));r.readAsDataURL(file);});control.signal.throwIfAborted();setAssets(current=>[...current,{id:crypto.randomUUID(),name:file.name,url}]);}received.push(file.name);updateTransfer(id,{phase:'attached',percent:100,detail:note||(kind==='media'?'Ready for your edit':undefined)});}catch(e){updateTransfer(id,{phase:'failed',detail:e instanceof Error?e.message:String(e)});if(control.signal.aborted)throw e;}}
      if(received.length){const message=`I've received ${received.length===1?received[0].slice(0,100):`${received.length} files`}. Tell me what you'd like to do with ${received.length===1?'it':'them'}.`;setCaption(message);await speak(message,control.signal);}else{setState('uncertain');setStatus('The file could not be attached. See the transfer details below.');}
    }catch(e){if(!control.signal.aborted){setState('uncertain');setStatus(String(e));}}finally{if(controller.current===control)busy.current=false;if(fileInput.current)fileInput.current.value='';}}
  const visibleStatus=local&&runtimeState.voice==='unavailable'&&['Touch the orb to talk, or type a message.','Touch the orb to reply.','Ready. Touch the orb to talk.'].includes(status)?'Voice is unavailable. Type a message or open setup instructions.':status;
  return <main data-latency={JSON.stringify(lastTiming)} className={`orb-room${dragging?" drag-active":""}`} onDragEnter={e=>{if(!Array.from(e.dataTransfer.types).includes("Files"))return;e.preventDefault();dragDepth.current++;setDragging(true);}} onDragOver={e=>{if(Array.from(e.dataTransfer.types).includes("Files")){e.preventDefault();e.dataTransfer.dropEffect="copy";}}} onDragLeave={e=>{e.preventDefault();if(--dragDepth.current<=0){dragDepth.current=0;setDragging(false);}}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragging(false);void attach(Array.from(e.dataTransfer.files),true);}}>
    <DownloadLocal local={local} openRequest={setupRequest} state={runtimeState} checking={checkingRuntime} onCheck={checkRuntime}/>
    <section className="presence" aria-label="Conversation with Anascummis">
      <button className="orb-control" aria-label={state==='listening'?'Finish speaking':busy.current?'Stop Anascummis':'Talk to Anascummis'} disabled={!workspaceReady} onClick={()=>void toggleOrb()}><Orb state={state} level={level} reducedMotion={reduced} size={size}/></button>
      {dragging&&<div className="drop-hint" role="status">Drop your files here</div>}
      <p role="status" className="voice-status">{visibleStatus}</p>
      <button className="type-message-button" type="button" aria-expanded={textOpen} aria-controls="orb-composer" onClick={openText}>Type a message</button>
      {textOpen&&<div className="typed-entry">
        <form id="orb-composer" className="text-composer" onSubmit={event=>{event.preventDefault();void sendText();}}>
          <label className="sr-only" htmlFor="orb-text">Message Anascummis</label>
          <textarea id="orb-text" ref={textInput} value={draft} onChange={event=>writeDraft(event.target.value)} placeholder="Tell me what you need…" autoComplete="off" maxLength={8000} rows={3} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();void sendText();}}}/>
          <button type="submit" disabled={!draft.trim()||!workspaceReady||sendingText||stagingRequest} aria-label="Send message">{sendingText?'…':'↑'}</button>
          <button type="button" aria-label="Close text input" onClick={()=>setTextOpen(false)}>×</button>
        </form>
        <p className="composer-hint">Enter adds a line. Send or Ctrl/Command+Enter submits.</p>
        {recoveredRequest&&<div className="request-context">
          <p>{recoveredRequest.unconfirmed?'A previous submission was not confirmed. Inspect saved work before sending again.':'Editing a saved request in its original website'+(recoveredRequest.context.documentId?' and PDF':'')+'. Send starts a new run; review earlier changes first.'}</p>
          <label><input type="checkbox" checked={recoveryResearch} onChange={event=>setRecoveryResearch(event.target.checked)}/>Allow public web research for this new request</label>
          <small>Research is off unless you enable it here. Saved private details are not restored.</small>
        </div>}
      </div>}
      {failedDraft&&<aside className="request-recovery">
        <p>Submission was not confirmed. It may have started. Inspect saved work before sending again.</p>
        <details><summary>Kept message</summary><pre>{failedDraft.text}</pre><p>{failedDraft.message}</p></details>
        <button type="button" disabled={stagingRequest||sendingText} onClick={()=>void editFailedDraft()}>Edit unconfirmed message</button>
        <button type="button" onClick={inspectUnconfirmed}>Inspect saved work</button>
        <button type="button" onClick={()=>setFailedDraft(undefined)}>Dismiss notice</button>
      </aside>}
      {transfers.length>0&&<div className="file-transfers" aria-label="File transfers" aria-live="polite">{transfers.map(transfer=><div key={transfer.id} className={`file-transfer ${transfer.phase}`}><span className="file-symbol" aria-hidden="true">{transfer.phase==='attached'?'✓':transfer.phase==='failed'?'!':'↓'}</span><div><span className="file-name">{transfer.name}</span><span className="file-detail">{transfer.phase==='uploading'?`Receiving · ${transfer.percent}%`:transfer.phase==='processing'?transfer.detail||'Preparing your file…':transfer.phase==='attached'?'Received · '+(transfer.detail||'ready'):transfer.detail}</span>{transfer.phase==='uploading'&&<progress max={100} value={transfer.percent} aria-label={`Receiving ${transfer.name}`}/>}</div></div>)}</div>}
      {local&&<LocalReadiness state={runtimeState} checking={checkingRuntime} onCheck={checkRuntime} onSetup={openSetup}/>}
      <p className="setup-note">Double-Space also opens typing. Drop files onto the orb.</p>
      <span className="sr-only" aria-live="polite">{caption}</span>
    </section><FloatingPanels raiseRequest={panelRaise} panels={[
    ...(peersOpen?[{id:'shared-goal',version:'peer-session',title:'Shared goal',reason:'Collaborators need to review a shared plan and proposed tasks.',content:<PeerPanel run={runPeerTask} plan={planPeerGoal}/>}]:[]),
    ...(softwareOpen?[{id:'software-work',version:JSON.stringify({local,softwareGoal,softwareSelection}),title:'Software work',reason:'Persistent software builds, actual verification screenshots and tested downloads.',content:<SoftwarePanel local={local} initialGoal={softwareGoal} selectedTaskId={softwareSelection?.id} selectionKey={softwareSelection?.key} onSelectTask={openGoalSoftware} onUpdate={task=>{if(!busy.current&&task.status==='completed')setStatus('Your verified software build is ready to download.');}}/>}]:[]),
    ...(local&&goalsOpen?[{id:'coordinated-goals',version:JSON.stringify({project:project.current?.id,document:doc?.id}),title:'Goals',reason:'A saved goal needs a visible plan, specialist results and acceptance evidence.',content:<GoalPanel projectId={project.current?.id} documentId={doc?.id} documentName={doc?.name} onOpenProject={id=>void openWorkProject(id)} onOpenDocument={id=>void openWorkDocument(id)} onOpenSoftware={openGoalSoftware}/>}]:[]),
    ...((local?workOpen:backgroundTasks.length||workOpen)?[{id:'background-work',version:local?'saved-work':JSON.stringify(backgroundTasks),title:local?'Work history':'Background work',reason:'Specialists are working while conversation remains available.',content:local?<WorkPanel onOpenProject={id=>void openWorkProject(id)} onOpenDocument={id=>void openWorkDocument(id)} onEditRequest={editWorkRequest} onOpenSetup={openSetup}/>:<div className="background-tasks">{backgroundTasks.map(task=><article key={task.id}><strong>{task.request}</strong><p>{task.progress}</p>{task.message&&<p>{task.message}</p>}{task.agents?.map(agent=><small key={agent.id}>{agent.agent} · {agent.status} · {agent.message}</small>)}{task.status==='running'&&<button onClick={()=>stopBackground(task.id)}>Stop task</button>}</article>)}</div>}]:[]),
    ...openSurfaces.map(kind=>({id:'preview-'+kind,version:JSON.stringify({kind,site,doc,video,timeline,assets}),title:({website:'Website',pdf:'PDF',scene:'3D scene',video:'Video',timeline:'Timeline'})[kind],reason:'A requested or updated artifact is available to inspect.',content:<section className="panel-preview">{kind==='website'&&<iframe title="Website preview" srcDoc={renderSite(site,id=>assets.find(a=>a.id===id)?.url||`/api/assets/${id}`)} sandbox=""/>}{kind==='scene'&&<BabylonPreview objects={site.scene}/>}{kind==='pdf'&&doc&&<img alt="PDF page 1" src={`/api/documents/${doc.id}/render?page=1&revision=${doc.revision}`}/ >}{kind==='video'&&video&&<video controls playsInline src={`/api/media/${video.id}`} aria-label="Finished video"/>}{kind==='timeline'&&timeline&&<EtroPreview planId={timeline}/>}</section>})),
    ...(researchOpen&&newsSources?[{id:'research-headlines',version:newsSources.retrievedAt,title:'Recent news',reason:'Current information needs visible sources and dates.',content:newsSources&&<div className="news-sources"><span>Recent headlines · checked {new Date(newsSources.retrievedAt).toLocaleTimeString()}</span>{newsSources.results.slice(0,5).map(item=><a key={item.url} href={item.url} target="_blank" rel="noreferrer">{item.title}<small>{item.publisher} · {new Date(item.published).toLocaleDateString()}</small></a>)}</div>}]:[]),
    ...(researchOpen&&visualContext?[{id:'research-background',version:JSON.stringify(visualContext),title:visualContext.title,reason:'A sourced image and article provide background context.',content:visualContext&&<article className="visual-context">{visualContext.image&&<figure><img src={visualContext.image.url} alt={`${visualContext.title} — background context`} loading="lazy"/><figcaption>Background image · <a href={visualContext.image.source} target="_blank" rel="noreferrer">{visualContext.image.credit} · {visualContext.image.license}</a></figcaption></figure>}<a className="article-title" href={visualContext.url} target="_blank" rel="noreferrer">{visualContext.title} ↗</a><p>{visualContext.excerpt}</p><small>Background article · Wikipedia · not a current news report</small></article>}]:[])
  ].filter(panel=>!hiddenPanels.has(panel.id))} onDismiss={id=>{setHiddenPanels(current=>new Set([...current,id]));if(id.startsWith('preview-'))setOpenSurfaces(current=>current.filter(kind=>'preview-'+kind!==id));else if(id==='coordinated-goals')setGoalsOpen(false);else if(id==='background-work')setWorkOpen(false);else if(id==='software-work')setSoftwareOpen(false);else if(id==='shared-goal')setPeersOpen(false);else if(id==='research-headlines')setNewsSources(null);else if(id==='research-background')setVisualContext(null);}}/><input ref={fileInput} className="sr-only" type="file" tabIndex={-1} aria-hidden="true" onChange={e=>void attach(e.target.files)}/></main>;
}






