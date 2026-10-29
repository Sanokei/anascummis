'use client';
import {useEffect,useRef,useState} from 'react';

export type SoftwareLaunchView={
 taskId:string;lineageId:string;supported:boolean;reason?:string;
 state:'stopped'|'preparing'|'running'|'stopping'|'interrupted'|'failed';
 activeTaskId?:string;revision?:number;zipSha256?:string;runtimeId?:string;
 origin?:string;message:string;updated:number;startedAt?:number;processId?:number;
 launchId?:string;kind?:'counter'|'collection';title?:string;storageKey?:string;
};
type Request=(path:string,body?:unknown,signal?:AbortSignal)=>Promise<unknown>;
const changedEvent='anascummis-app-launch-changed';
const activeStates=new Set(['preparing','running','stopping']);
const states=new Set(['stopped','preparing','running','stopping','interrupted','failed']);
const localSessionError=(detail:string)=>/open the local Studio window before using this action|invalid local session/i.test(detail);

function readView(value:unknown,taskId:string):SoftwareLaunchView{
 const view=value as SoftwareLaunchView;
 if(!view||view.taskId!==taskId||typeof view.lineageId!=='string'||typeof view.supported!=='boolean'||!states.has(view.state)||typeof view.message!=='string'||view.message.length>20000||typeof view.updated!=='number'||!Number.isFinite(view.updated))throw new Error('The app status response could not be verified.');
 for(const key of ['reason','activeTaskId','zipSha256','runtimeId','origin','launchId','title','storageKey'] as const)if(view[key]!==undefined&&(typeof view[key]!=='string'||view[key]!.length>4000))throw new Error('The app identity response could not be verified.');
 for(const key of ['revision','startedAt','processId'] as const)if(view[key]!==undefined&&(typeof view[key]!=='number'||!Number.isFinite(view[key])))throw new Error('The app runtime response could not be verified.');
 return view;
}
function frameOrigin(value:unknown){
 if(typeof value!=='string'||typeof window==='undefined')return;
 try{const url=new URL(value);if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.origin!==location.origin&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash)return url.origin;}catch{}
}

/** Read-only inspection on mount/reopen. Process mutations only follow buttons. */
export function SoftwareLaunch({taskId,title,local,selected=false,request,onSelectTask}:{taskId:string;title:string;local:boolean;selected?:boolean;request:Request;onSelectTask?:(id:string)=>void}){
 const [view,setView]=useState<SoftwareLaunchView>(),[readError,setReadError]=useState(''),[notice,setNotice]=useState('');
 const [checking,setChecking]=useState(false),[busy,setBusy]=useState<'start'|'stop'>(),[unconfirmed,setUnconfirmed]=useState<'start'|'stop'>();
 const [reconnectSuggested,setReconnectSuggested]=useState(false),[reconnecting,setReconnecting]=useState(false);
 const [frameError,setFrameError]=useState(false),[frameReload,setFrameReload]=useState(0),[hideFrame,setHideFrame]=useState(false);
 const [frameSize,setFrameSize]=useState({height:280,barHeight:0});
 const current=useRef<SoftwareLaunchView|undefined>(undefined),requestRef=useRef(request),alive=useRef(false),epoch=useRef(0),readSequence=useRef(0);
 const mutation=useRef<'start'|'stop'|undefined>(undefined),controls=useRef<HTMLButtonElement|null>(null),readControls=useRef(new Set<AbortController>()),manualRead=useRef<number|undefined>(undefined);
 const reconnectControl=useRef<AbortController|undefined>(undefined);
 const launchElement=useRef<HTMLElement|null>(null),barElement=useRef<HTMLDivElement|null>(null),frameElement=useRef<HTMLIFrameElement|null>(null);
 requestRef.current=request;
 const endpoint='/software/'+encodeURIComponent(taskId)+'/launch';

 function accept(next:SoftwareLaunchView){current.current=next;setView(next);}
 async function checkStatus(manual=false){
  if(!local||!alive.current)return;
  if(reconnectControl.current&&!manual)return;
  if(!manual&&readControls.current.size)return;
  if(manual&&manualRead.current!==undefined)return;
  if(manual)for(const control of readControls.current)control.abort();
  const sequence=++readSequence.current,atEpoch=epoch.current,control=new AbortController();readControls.current.add(control);
  const deadline=setTimeout(()=>control.abort(new Error('App status request timed out.')),15000);
  if(manual){manualRead.current=sequence;setChecking(true);}
  try{
   const next=readView(await requestRef.current(endpoint,undefined,control.signal),taskId);
   if(!alive.current||sequence!==readSequence.current||atEpoch!==epoch.current)return;
   accept(next);setReadError('');setReconnectSuggested(false);
   if(manual){setUnconfirmed(undefined);setHideFrame(false);setNotice('App status checked.');}
  }catch(error){if(alive.current&&sequence===readSequence.current&&atEpoch===epoch.current){const detail=String(error);setReadError(detail);if(localSessionError(detail))setReconnectSuggested(true);}}
  finally{clearTimeout(deadline);readControls.current.delete(control);if(manual&&manualRead.current===sequence){manualRead.current=undefined;if(alive.current)setChecking(false);}}
 }

 useEffect(()=>{
  if(!local)return;
  alive.current=true;current.current=undefined;mutation.current=undefined;manualRead.current=undefined;setView(undefined);setReadError('');setNotice('');setUnconfirmed(undefined);setHideFrame(false);setBusy(undefined);setChecking(false);setReconnectSuggested(false);setReconnecting(false);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=()=>{if(!alive.current)return;if(current.current&&activeStates.has(current.current.state)&&!mutation.current)void checkStatus();timer=setTimeout(poll,2500);};
  const refresh=()=>{if(!mutation.current)void checkStatus();};
  window.addEventListener(changedEvent,refresh);void checkStatus();timer=setTimeout(poll,2500);
  return()=>{alive.current=false;epoch.current++;readSequence.current++;if(timer)clearTimeout(timer);for(const control of readControls.current)control.abort();readControls.current.clear();reconnectControl.current?.abort();reconnectControl.current=undefined;window.removeEventListener(changedEvent,refresh);};
 },[local,taskId]);
 useEffect(()=>{if(local&&selected&&!mutation.current)void checkStatus();},[local,selected,taskId]);
 useEffect(()=>{
  const panel=launchElement.current?.closest<HTMLElement>('.software-panel'),bar=barElement.current;
  if(!local||!panel||!bar||!frameElement.current)return;
  const measure=()=>{const barHeight=Math.ceil(bar.getBoundingClientRect().height),height=Math.max(120,Math.min(480,Math.floor(panel.clientHeight-barHeight-12)));setFrameSize(current=>current.height===height&&current.barHeight===barHeight?current:{height,barHeight});};
  const observer=new ResizeObserver(measure);observer.observe(panel);observer.observe(bar);window.addEventListener('resize',measure);measure();
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[local,taskId,view?.state,view?.activeTaskId,view?.origin,view?.launchId,hideFrame,frameReload]);

 function focusAppView(){
  const frame=frameElement.current,panel=launchElement.current?.closest<HTMLElement>('.software-panel'),bar=barElement.current;
  if(!frame||!panel||!bar)return;
  const top=frame.getBoundingClientRect().top-panel.getBoundingClientRect().top-panel.clientTop-bar.getBoundingClientRect().height-8;
  panel.scrollTop+=top;frame.focus({preventScroll:true});
 }

 async function act(action:'start'|'stop'){
  if(!local||mutation.current||unconfirmed)return;
  mutation.current=action;const atEpoch=++epoch.current;setBusy(action);setNotice(action==='start'?'Start requested. Preparing the checked app…':'Stop requested. Waiting for the owned app to exit…');
  if(action==='stop')setHideFrame(true);
  try{
   const next=readView(await requestRef.current(endpoint+'/'+action,{},AbortSignal.timeout(30000)),taskId);
   if(!alive.current||atEpoch!==epoch.current)return;
   accept(next);setReadError('');setUnconfirmed(undefined);setHideFrame(action==='stop');setNotice(action==='start'?'Start accepted. The saved app state will show when it is ready.':'Stop accepted. Browser data and checked downloads are kept.');
  }catch(error){if(alive.current&&atEpoch===epoch.current){const detail=String(error);setUnconfirmed(action);if(localSessionError(detail))setReconnectSuggested(true);setNotice((action==='start'?'Start':'Stop')+' was not confirmed. Check app status before trying again. '+detail);}}
  finally{
   if(alive.current&&atEpoch===epoch.current){mutation.current=undefined;epoch.current++;setBusy(undefined);window.dispatchEvent(new Event(changedEvent));}
  }
 }

 async function reconnect(){
  if(!local||!alive.current||mutation.current||reconnectControl.current||manualRead.current!==undefined)return;
  const atEpoch=++epoch.current,control=new AbortController();reconnectControl.current=control;setReconnecting(true);setNotice('Reconnecting this tab to Studio…');
  const deadline=setTimeout(()=>control.abort(new Error('Studio reconnect timed out.')),15000);
  try{
   if(location.protocol!=='http:'||location.hostname!=='127.0.0.1')throw new Error('Reconnect requires the ordinary local Studio address.');
   const response=await fetch(new URL('/',location.href),{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'text/html'},signal:control.signal});
   if(!response.ok||new URL(response.url).origin!==location.origin||!/^text\/html(?:;|$)/i.test(response.headers.get('Content-Type')||''))throw new Error('The ordinary Studio page could not be verified.');
   await response.body?.cancel();
   if(!alive.current||atEpoch!==epoch.current)return;
   reconnectControl.current=undefined;setReconnecting(false);setNotice('Studio reconnected. Checking saved app status…');await checkStatus(true);
  }catch(error){if(alive.current&&atEpoch===epoch.current){setReadError('Studio could not reconnect. '+String(error));setReconnectSuggested(true);setNotice('Reconnect was not confirmed. No app was started.');}}
  finally{clearTimeout(deadline);if(reconnectControl.current===control)reconnectControl.current=undefined;if(alive.current&&atEpoch===epoch.current)setReconnecting(false);}
 }

 if(!local)return null;
 const otherVersion=!!view?.activeTaskId&&view.activeTaskId!==taskId&&activeStates.has(view.state);
 const runningHere=view?.state==='running'&&view.activeTaskId===taskId;
 const origin=frameOrigin(view?.origin),showFrame=runningHere&&!!origin&&!hideFrame;
 const appTitle=view?.title||title;
 const canStart=!!view?.supported&&!activeStates.has(view.state)&&!busy&&!unconfirmed&&!readError&&!reconnectSuggested&&!reconnecting;
 const canStop=!!view&&activeStates.has(view.state)&&!busy&&!unconfirmed&&!reconnectSuggested&&!reconnecting;
 const canReload=showFrame&&!readError&&!unconfirmed&&!reconnectSuggested&&!reconnecting&&!busy;
 return <section ref={launchElement} className="software-launch" aria-label="Open checked app" data-app-launch-task-id={taskId}>
  <h3>Open checked app</h3>
  {!view?<p role="status">{readError?'App availability could not be checked.':'Checking app availability…'}</p>:<>
   <p className="software-launch-state" role="status"><strong>{readError?'Last checked state: ':''}{view.state.replace('_',' ')}</strong> · {view.message}</p>
   {!view.supported&&<p className="software-launch-fallback">{view.reason||'This build uses the manual download and run path.'} Use its checked source ZIP and run instructions below.</p>}
   {otherVersion&&<div className="software-launch-other"><p>A different version of this app is {view.state}. Stop it before starting this version. Both versions use the same saved-data address.</p>{onSelectTask&&<button type="button" onClick={()=>onSelectTask(view.activeTaskId!)}>Open running build</button>}</div>}
  </>}
  {readError&&<p className="software-launch-warning" role="alert">App status could not be checked. {readError}</p>}
  {notice&&<p className={unconfirmed?'software-launch-warning':'software-launch-notice'} role={unconfirmed?'alert':'status'}>{notice}</p>}
  {reconnectSuggested&&<p className="software-launch-lifetime">Studio may have restarted. Reconnect to refresh this tab’s local session and check saved app status. Reconnecting does not start an app.</p>}
  <div ref={barElement} className="software-launch-bar" role="region" aria-label="App controls">
   {showFrame&&<div className="software-launch-bar-title"><strong title={appTitle}>{appTitle}</strong><span>{readError?'Last checked: ':''}{view.state}</span></div>}
   <div className="software-launch-actions">
   {reconnectSuggested&&<button type="button" disabled={reconnecting||!!busy||checking} onClick={()=>void reconnect()}>{reconnecting?'Reconnecting to Studio…':'Reconnect to Studio'}</button>}
   {view?.supported&&!activeStates.has(view.state)&&<button type="button" ref={controls} disabled={!canStart} onClick={()=>void act('start')}>{busy==='start'?'Starting app…':'Start app'}</button>}
   {view&&activeStates.has(view.state)&&<button type="button" ref={controls} disabled={!canStop} onClick={()=>void act('stop')}>{busy==='stop'?'Stopping app…':view.state==='stopping'?'Retry stop':'Stop running app'}</button>}
   <button type="button" disabled={checking||!!busy||reconnecting} onClick={()=>void checkStatus(true)}>{checking?'Checking app status…':'Check app status'}</button>
   {showFrame&&<button type="button" disabled={!canReload} onClick={()=>{if(!canReload)return;setFrameError(false);setFrameReload(value=>value+1);}}>Reload app view</button>}
   {showFrame&&<button type="button" onClick={focusAppView}>Focus app view</button>}
   </div>
  </div>
  {view?.supported&&<p className="software-launch-lifetime">Starting is deliberate. Closing Software work keeps its process running. Reopening reloads the view: saved browser data stays, unsaved input is lost, and a counter returns to its initial value.</p>}
  {runningHere&&!origin&&<p className="software-launch-warning" role="alert">The app address could not be verified. Its view stays closed. Check app status or use the source ZIP and run instructions.</p>}
  {showFrame&&<>
   {frameError&&<p className="software-launch-warning" role="alert">The app view could not load. Check its status or reload this view.</p>}
   <iframe ref={frameElement} key={(view.launchId||view.runtimeId||taskId)+':'+origin+':'+frameReload} className="software-launch-frame" style={{height:frameSize.height,scrollMarginTop:frameSize.barHeight+8}} src={origin+'/'} title={'Running app: '+appTitle} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" onLoad={()=>setFrameError(false)} onError={()=>setFrameError(true)}/>
   <button type="button" className="software-launch-return" onClick={()=>controls.current?.focus()}>Back to app controls</button>
  </>}
  {view&&(view.origin||view.runtimeId||view.zipSha256||view.launchId)&&<details className="software-launch-identity"><summary>Runtime identity and saved-data address</summary>
   <p>This local preview runs the checked counter or task-list page from its accepted source ZIP. Other applications use the download and run instructions.</p>
   <dl>
    {view.activeTaskId&&<><dt>Active build</dt><dd><code>{view.activeTaskId}</code></dd></>}
    {view.revision!==undefined&&<><dt>Source revision</dt><dd>{view.revision}</dd></>}
    {view.zipSha256&&<><dt>Accepted ZIP SHA-256</dt><dd><code>{view.zipSha256}</code></dd></>}
    {view.runtimeId&&<><dt>Runtime identity</dt><dd><code>{view.runtimeId}</code></dd></>}
    {view.launchId&&<><dt>Launch identity</dt><dd><code>{view.launchId}</code></dd></>}
    {view.processId!==undefined&&<><dt>Owned process</dt><dd>{view.processId}</dd></>}
    {view.startedAt!==undefined&&<><dt>Started</dt><dd>{new Date(view.startedAt).toLocaleString()}</dd></>}
    {view.origin&&<><dt>Saved-data address</dt><dd><code>{view.origin}</code></dd></>}
   </dl>
   <small>Browser storage belongs to this app’s address. Stopping does not clear it; a new browser or a different address has separate data.</small>
  </details>}
 </section>;
}
