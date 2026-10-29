import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {LaunchPackageManifest} from './app-launch-package';

export type AppBoundaryAudit={requests:number;credentialRequests:number;sanitizedCredentialRequests:number;responseCookieHeaders:number;rejectedRequests:number};
export type AppProcessExit={pid:number;code:number;expected:boolean;detail:string};
export type OwnedAppProcess={pid:number;port:number;origin:string;runtimeId:string;manifestSha256:string;startedAt:number;exited:Promise<number>;readonly environmentKeys:readonly string[];readonly boundary:AppBoundaryAudit;stop():Promise<void>};
export type AppProcessOptions={port:number;studioOrigin:string;root:string;manifest:LaunchPackageManifest};
export const appCredentialHeaders=['cookie','authorization','proxy-authorization','x-anascummis-pair','x-requested-with'] as const;
export function launchManifestHash(manifest:LaunchPackageManifest){return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');}
/** The fixed asset handler receives no browser/session headers. There is no
 * generated app server or arbitrary request forwarding in this runtime. */
export function sanitizedAppRequest(request:Request){return new Request(request.url,{method:request.method==='HEAD'?'HEAD':'GET',headers:{}});}
export function appResponseHeaders(contentType:string,length:number,studioOrigin:string){return new Headers({
 'Content-Type':contentType,'Content-Length':String(length),'Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors "+studioOrigin+"; sandbox allow-scripts allow-same-origin allow-forms",
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
});}
/** Response headers are host-owned too: app cookies/redirects/CORS never cross
 * this boundary, even if a future fixed asset implementation adds headers. */
export function sanitizedAppResponse(response:Response,securityHeaders:Headers){return new Response(response.body,{status:response.status,headers:securityHeaders});}

export async function startAppProcess(options:AppProcessOptions,signal?:AbortSignal,onExit?:(exit:AppProcessExit)=>void):Promise<OwnedAppProcess>{
 signal?.throwIfAborted();
 if(!Number.isInteger(options.port)||options.port<1024||options.port>65535)throw new Error('The saved app address is invalid.');
 const studio=new URL(options.studioOrigin);
 if(studio.protocol!=='http:'||studio.hostname!=='127.0.0.1'||!studio.port||studio.origin!==options.studioOrigin||studio.username||studio.password)throw new Error('The app needs the exact local Studio origin.');
 const origin='http://127.0.0.1:'+options.port;
 if(origin===studio.origin)throw new Error('The app must have a separate origin from Studio.');
 const nonce=crypto.randomUUID(),manifestSha256=launchManifestHash(options.manifest),worker=resolve(import.meta.dir,'../worker/app-launch.ts');
 let readyResolve!:(value:OwnedAppProcess)=>void,readyReject!:(error:Error)=>void,stopping=false,ready=false,detail='',stopPromise:Promise<void>|undefined;
 let environmentKeys:string[]=[];
 let boundary:AppBoundaryAudit={requests:0,credentialRequests:0,sanitizedCredentialRequests:0,responseCookieHeaders:0,rejectedRequests:0};
 const readiness=new Promise<OwnedAppProcess>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const minimalEnv=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].flatMap(key=>process.env[key]?[[key,process.env[key]!]]:[]));
 const child=Bun.spawn([process.execPath,'--no-env-file','--no-install',worker],{cwd:resolve(options.root),env:minimalEnv,stdin:'ignore',stdout:'ignore',stderr:'pipe',serialization:'json',
  ipc(message:unknown){
   const value=message as Record<string,unknown>;
   if(!value||value.nonce!==nonce)return;
   if(value.type==='ready'){
    if(ready||stopping)return;
    if(value.pid!==child.pid||value.port!==options.port||value.runtimeId!==options.manifest.id||value.manifestSha256!==manifestSha256){readyReject(new Error('The owned app process returned a different runtime identity.'));void stop();return;}
    if(!Array.isArray(value.environmentKeys)||value.environmentKeys.some(key=>typeof key!=='string'||key.length>200)){readyReject(new Error('The owned app did not report its environment boundary.'));void stop();return;}
    environmentKeys=[...value.environmentKeys];
    ready=true;readyResolve(owned);
   }else if(value.type==='failed'){
    detail=typeof value.detail==='string'?value.detail.slice(0,2000):'The owned app could not start.';readyReject(new Error(detail));void stop();
   }else if(value.type==='boundary'){
    const incoming=value.audit as AppBoundaryAudit;
    if(incoming&&['requests','credentialRequests','sanitizedCredentialRequests','responseCookieHeaders','rejectedRequests'].every(key=>Number.isSafeInteger(incoming[key as keyof AppBoundaryAudit])&&incoming[key as keyof AppBoundaryAudit]>=0))boundary={...incoming};
   }
  }
 });
 const collect=async()=>{const reader=child.stderr.getReader(),decoder=new TextDecoder();for(;;){const next=await reader.read();if(next.done)break;detail=(detail+decoder.decode(next.value,{stream:true})).slice(-2000);}};
 void collect().catch(()=>{});
 const exited=child.exited.then(code=>{
  clearTimeout(startupTimer);signal?.removeEventListener('abort',abort);
  if(!ready)readyReject(new Error(detail||'The owned app exited before reporting readiness.'));
  try{onExit?.({pid:child.pid,code,expected:stopping,detail:detail||(!stopping?'The app process exited.':'App stopped.')});}catch{}
  return code;
 });
 async function stop(){
  if(stopPromise)return stopPromise;stopping=true;
  stopPromise=(async()=>{
   if(child.exitCode===null){try{child.send({type:'stop',nonce});}catch{}}
   let timer:ReturnType<typeof setTimeout>|undefined;
   const ended=await Promise.race([exited.then(()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),2000);})]);if(timer)clearTimeout(timer);
   if(!ended&&child.exitCode===null)child.kill('SIGTERM');
   let hardTimer:ReturnType<typeof setTimeout>|undefined;
   const graceful=await Promise.race([exited.then(()=>true),new Promise<false>(resolve=>{hardTimer=setTimeout(()=>resolve(false),2000);})]);if(hardTimer)clearTimeout(hardTimer);
   if(!graceful&&child.exitCode===null)child.kill('SIGKILL');
   await exited;
  })();return stopPromise;
 }
 const owned:OwnedAppProcess={pid:child.pid,port:options.port,origin,runtimeId:options.manifest.id,manifestSha256,startedAt:Date.now(),exited,get environmentKeys(){return [...environmentKeys];},get boundary(){return {...boundary};},stop};
 const abort=()=>{readyReject(new Error('App launch was cancelled.'));void stop();};
 const startupTimer=setTimeout(()=>{readyReject(new Error('The owned app did not report readiness in time.'));void stop();},10000);
 signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)abort();
 try{
  child.send({type:'start',nonce,port:options.port,studioOrigin:studio.origin,root:resolve(options.root),manifest:options.manifest,manifestSha256});
  const result=await readiness;clearTimeout(startupTimer);return result;
 }catch(error){await stop();throw error;}
}
