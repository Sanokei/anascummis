import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {appCredentialHeaders,appResponseHeaders,launchManifestHash,sanitizedAppRequest,sanitizedAppResponse,type AppBoundaryAudit} from '../core/app-launch-process';
import type {LaunchPackageManifest} from '../core/app-launch-package';

type Start={type:'start';nonce:string;port:number;studioOrigin:string;root:string;manifest:LaunchPackageManifest;manifestSha256:string};
let server:ReturnType<typeof Bun.serve>|undefined,configuration:Start|undefined,closing=false,started=false;
const audit:AppBoundaryAudit={requests:0,credentialRequests:0,sanitizedCredentialRequests:0,responseCookieHeaders:0,rejectedRequests:0};
const send=(message:Record<string,unknown>)=>{if(process.connected)process.send?.({...message,nonce:configuration?.nonce});};
async function close(){if(closing)return;closing=true;clearTimeout(initializationTimeout);if(server)await server.stop(true);process.exit(0);}
process.on('disconnect',()=>{void close();});
process.on('SIGTERM',()=>{void close();});process.on('SIGINT',()=>{void close();});
const initializationTimeout=setTimeout(()=>{process.exit(1);},10000);
process.on('message',(message:unknown)=>{
 const value=message as Start|{type:'stop';nonce:string};
 if(value?.type==='stop'&&value.nonce===configuration?.nonce){void close();return;}
 if(value?.type!=='start'||started)return;started=true;configuration=value;
 void start(value).catch(error=>{send({type:'failed',detail:error instanceof Error?error.message:'The trusted runtime could not start.'});void close();});
});
async function start(config:Start){
 if(!/^[a-f0-9-]{36}$/.test(config.nonce)||!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw new Error('Invalid app process configuration.');
 const studio=new URL(config.studioOrigin),origin='http://127.0.0.1:'+config.port;
 if(studio.protocol!=='http:'||studio.hostname!=='127.0.0.1'||!studio.port||studio.origin!==config.studioOrigin||origin===studio.origin)throw new Error('A separate local app origin is required.');
 const root=resolve(config.root);
 if(await realpath(root)!==root||(await lstat(root)).isSymbolicLink())throw new Error('Linked runtime directories are unsupported.');
 const manifestPath=join(root,'manifest.json'),manifestInfo=await lstat(manifestPath);
 if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||manifestInfo.size>100000)throw new Error('The runtime identity is unavailable.');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as LaunchPackageManifest;
 if(manifest.format!=='anascummis.trusted-browser-runtime.v1'||launchManifestHash(manifest)!==config.manifestSha256||JSON.stringify(manifest)!==JSON.stringify(config.manifest))throw new Error('The runtime identity changed before launch.');
 if(!Array.isArray(manifest.files)||manifest.files.length!==2||new Set(manifest.files.map(file=>file.path)).size!==2||manifest.files.some(file=>!['index.html','app.js'].includes(file.path)))throw new Error('Unsupported runtime asset list.');
 const assets=new Map<string,{bytes:Uint8Array<ArrayBuffer>;type:string}>();
 for(const entry of manifest.files){
  if(!Number.isInteger(entry.bytes)||entry.bytes<1||entry.bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Invalid runtime asset identity.');
  const path=join(root,entry.path),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==entry.bytes)throw new Error('A verified runtime asset is unavailable.');
  const bytes=new Uint8Array(await readFile(path));
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('A runtime asset changed before launch.');
  assets.set('/'+entry.path,{bytes,type:entry.path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});
 }
 if(closing)return;
 server=Bun.serve({hostname:'127.0.0.1',port:config.port,maxRequestBodySize:1024,idleTimeout:10,fetch(request){
  audit.requests++;if(appCredentialHeaders.some(name=>request.headers.has(name)))audit.credentialRequests++;
  const url=new URL(request.url),requestOrigin=request.headers.get('origin');
  let status=200,asset=assets.get(url.pathname==='/'?'/index.html':url.pathname);
  if(request.headers.get('host')!=='127.0.0.1:'+config.port||requestOrigin&&requestOrigin!==origin&&requestOrigin!==studio.origin)status=403;
  else if(!['GET','HEAD'].includes(request.method))status=405;
  else if(url.search||!asset)status=404;
  if(status!==200)audit.rejectedRequests++;
  // Raw headers stop here. The known client application only receives fixed
  // assets; it has no generated server, proxy target or request handler.
  const sanitized=sanitizedAppRequest(request);
  if(appCredentialHeaders.some(name=>sanitized.headers.has(name)))audit.sanitizedCredentialRequests++;
  const bytes=status===200?asset!.bytes:new TextEncoder().encode(status===403?'App request refused.':status===405?'This app accepts GET and HEAD only.':'App asset not found.');
  const headers=appResponseHeaders(status===200?asset!.type:'text/plain; charset=utf-8',bytes.length,studio.origin);
  const response=sanitizedAppResponse(new Response(sanitized.method==='HEAD'?null:bytes,{status}),headers);
  if(response.headers.has('set-cookie'))audit.responseCookieHeaders++;
  send({type:'boundary',audit:{...audit}});return response;
 }});
 if(server.port!==config.port){await server.stop(true);throw new Error('The app did not bind its saved address.');}
 clearTimeout(initializationTimeout);
 send({type:'ready',pid:process.pid,port:server.port,runtimeId:manifest.id,manifestSha256:config.manifestSha256,environmentKeys:Object.keys(process.env).sort()});
}
