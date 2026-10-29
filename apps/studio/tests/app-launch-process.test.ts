import {afterEach,expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {appCredentialHeaders,appResponseHeaders,sanitizedAppRequest,sanitizedAppResponse,startAppProcess,type OwnedAppProcess} from '../core/app-launch-process';
import type {LaunchPackageManifest} from '../core/app-launch-package';

const folders:string[]=[],owned:OwnedAppProcess[]=[];
afterEach(async()=>{for(const app of owned.splice(0))await app.stop();for(const folder of folders.splice(0))await rm(folder,{recursive:true,force:true});});
function port(){const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('test port')});const result=server.port!;void server.stop(true);return result;}
function rawRequest(port:number,request:string){return new Promise<string>((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port});let result='';socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('Raw app request timed out.'));});socket.on('connect',()=>socket.write(request));socket.on('data',chunk=>{result+=chunk.toString();});socket.on('error',reject);socket.on('end',()=>resolve(result));});}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'app-process-'));folders.push(root);
 const bodies={'index.html':'<!doctype html><html><body><h1>Owned process fixture</h1><script type="module" src="/app.js"></script></body></html>','app.js':'document.body.dataset.ready="true";'};
 const manifest:LaunchPackageManifest={format:'anascummis.trusted-browser-runtime.v1',id:'a'.repeat(64),taskId:crypto.randomUUID(),revision:1,zipSha256:'b'.repeat(64),kind:'counter',title:'Owned process fixture',wrapperVersion:1,reactVersion:'19.2.7',sourceFiles:[],files:Object.entries(bodies).map(([path,body])=>({path:path as 'index.html'|'app.js',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}))};
 await Promise.all(Object.entries(bodies).map(([path,body])=>Bun.write(join(root,path),body)));await Bun.write(join(root,'manifest.json'),JSON.stringify(manifest));return {root,manifest,bodies};
}
test('fixed asset boundary drops all browser credentials and response cookies',()=>{
 const headers=Object.fromEntries(appCredentialHeaders.map(header=>[header,'fixture credential']));headers['x-unknown-secret']='fixture other';
 const sanitized=sanitizedAppRequest(new Request('http://127.0.0.1:35001/app.js',{headers}));
 expect([...sanitized.headers]).toEqual([]);
 const response=sanitizedAppResponse(new Response('fixed',{headers:{'Set-Cookie':'studio=poison','Location':'https://example.com','Access-Control-Allow-Origin':'*','Content-Type':'text/html'}}),appResponseHeaders('text/javascript',5,'http://127.0.0.1:3211'));
 expect(response.headers.has('set-cookie')).toBe(false);expect(response.headers.has('location')).toBe(false);expect(response.headers.has('access-control-allow-origin')).toBe(false);
 expect(response.headers.get('content-security-policy')).toContain("frame-ancestors http://127.0.0.1:3211");expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");
});
test('real owned IPC bind, immutable assets, strict HTTP boundary and awaited Stop',async()=>{
 const f=await fixture(),reserved=port(),events:unknown[]=[];const app=await startAppProcess({...f,port:reserved,studioOrigin:'http://127.0.0.1:3211'},undefined,event=>events.push(event));owned.push(app);
 expect(app.port).toBe(reserved);expect(app.runtimeId).toBe(f.manifest.id);
 const response=await fetch(app.origin,{headers:{Cookie:'studio=fixture',Authorization:'Bearer fixture','X-Anascummis-Pair':'fixture'}});
 expect(await response.text()).toBe(f.bodies['index.html']);expect(response.headers.has('set-cookie')).toBe(false);
 await Bun.write(join(f.root,'app.js'),'changed after successful load');expect(await (await fetch(app.origin+'/app.js')).text()).toBe(f.bodies['app.js']);
 expect((await fetch(app.origin+'/../manifest.json')).status).toBe(404);expect((await fetch(app.origin,{method:'POST',body:'ignored'})).status).toBe(405);expect((await fetch(app.origin,{headers:{Origin:'https://example.com'}})).status).toBe(403);
 const raw=await rawRequest(reserved,'TRACE / HTTP/1.1\r\nHost: 127.0.0.1:'+reserved+'\r\nConnection: close\r\n\r\n');expect(raw).toContain('405');expect(raw.toLowerCase()).toContain('content-security-policy:');
 for(let i=0;i<20&&app.boundary.credentialRequests===0;i++)await Bun.sleep(10);
 expect(app.boundary.credentialRequests).toBeGreaterThan(0);expect(app.boundary.sanitizedCredentialRequests).toBe(0);expect(app.boundary.responseCookieHeaders).toBe(0);
 await app.stop();expect(await app.exited).toBe(0);expect(events).toHaveLength(1);expect(events[0]).toMatchObject({pid:app.pid,expected:true,code:0});
 await expect(fetch(app.origin)).rejects.toThrow();
});
test('unrelated HTTP200 occupying saved address cannot impersonate readiness',async()=>{
 const f=await fixture(),occupied=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('unrelated200')});
 try{await expect(startAppProcess({...f,port:occupied.port!,studioOrigin:'http://127.0.0.1:3211'})).rejects.toThrow();expect(await (await fetch(occupied.url)).text()).toBe('unrelated200');}finally{await occupied.stop(true);}
});
test('tampered runtime asset fails before readiness and same-origin Studio is forbidden',async()=>{
 const f=await fixture();await Bun.write(join(f.root,'app.js'),'tampered');await expect(startAppProcess({...f,port:port(),studioOrigin:'http://127.0.0.1:3211'})).rejects.toThrow('runtime asset');
 await expect(startAppProcess({...f,port:3211,studioOrigin:'http://127.0.0.1:3211'})).rejects.toThrow('separate origin');
});
test('aborted preparation does not leave an owned app running',async()=>{
 const f=await fixture(),controller=new AbortController(),reserved=port();controller.abort();
 await expect(startAppProcess({...f,port:reserved,studioOrigin:'http://127.0.0.1:3211'},controller.signal)).rejects.toThrow();
 const replacement=Bun.serve({hostname:'127.0.0.1',port:reserved,fetch:()=>new Response('still free')});await replacement.stop(true);
});
test('worker disables Bun dotenv loading as well as inherited environment values',async()=>{
 const f=await fixture(),marker='ANASCUMMIS_APP_LAUNCH_ENV_PROBE';await Bun.write(join(f.root,'.env'),marker+'=synthetic-fixture-only\n');
 // This isolated host-owned probe proves that the fixture would otherwise be
 // autoloaded. It reports presence only, never the synthetic value or env dump.
 const probe=Bun.spawn([process.execPath,'-e',"console.log(JSON.stringify({markerPresent:Object.hasOwn(process.env,'"+marker+"')}));"],{cwd:f.root,env:{PATH:process.env.PATH||''},stdout:'pipe',stderr:'pipe'});
 const [code,out,err]=await Promise.all([probe.exited,new Response(probe.stdout).text(),new Response(probe.stderr).text()]);expect(code).toBe(0);expect(err).toBe('');expect(JSON.parse(out).markerPresent).toBe(true);
 const app=await startAppProcess({...f,port:port(),studioOrigin:'http://127.0.0.1:3211'});owned.push(app);
 expect(app.environmentKeys).not.toContain(marker);expect(app.environmentKeys.some(key=>/STUDIO|SECRET|TOKEN|API_KEY/i.test(key))).toBe(false);
});
