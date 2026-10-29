import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {startAppProcess,type OwnedAppProcess} from '../core/app-launch-process';
import type {LaunchPackageManifest} from '../core/app-launch-package';

// An isolated fixed-client ownership/browser-boundary spike. This is not a
// generated app, accepted ZIP, native inference or product UI acceptance claim.
const evidenceRoot=resolve(import.meta.dir,'../.test-data');await mkdir(evidenceRoot,{recursive:true});
const output=process.argv[2]?resolve(process.argv[2]):await mkdtemp(join(evidenceRoot,'ownership-spike-'));
await mkdir(output,{recursive:true});const root=join(output,'runtime');await mkdir(root,{recursive:true});
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const html='<!doctype html><html lang="en"><body><h1>Owned runtime spike</h1><form><label for="task">Task</label><input id="task"><button>Add</button></form><ul aria-label="Saved tasks"></ul><button id="boundary" type="button">Test browser boundary</button><output id="proof"></output><script type="module" src="/app.js"></script></body></html>';
const script=`
const key='anascummis-owned-runtime-spike';let items=JSON.parse(localStorage.getItem(key)||'[]');
function render(){document.querySelector('ul').replaceChildren(...items.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));}render();
document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const input=document.querySelector('input');items.push(input.value);localStorage.setItem(key,JSON.stringify(items));input.value='';render();});
window.boundaryProof={parentDOMBlocked:false,parentStorageBlocked:false,topNavigationBlocked:false,popupBlocked:false,fetchBlocked:false,fetchTargetParsed:false,cookieVisible:false};
try{void parent.document.body;}catch{window.boundaryProof.parentDOMBlocked=true;}
try{void parent.localStorage.getItem('studio-only');}catch{window.boundaryProof.parentStorageBlocked=true;}
window.boundaryProof.cookieVisible=document.cookie.includes('studio=');
document.cookie='studio=child-rewrite; Path=/';
document.querySelector('#boundary').addEventListener('click',async()=>{
try{parent.location.href=document.referrer+'escaped';}catch{window.boundaryProof.topNavigationBlocked=true;}
window.boundaryProof.popupBlocked=window.open(location.origin+'/popup')===null;
const target=new URL('/leak',document.referrer);window.boundaryProof.fetchTargetParsed=target.origin!==location.origin;
try{await fetch(target,{credentials:'include'});}catch{window.boundaryProof.fetchBlocked=true;}
document.querySelector('#proof').textContent=JSON.stringify(window.boundaryProof);
});`;
await Bun.write(join(root,'index.html'),html);await Bun.write(join(root,'app.js'),script);
const manifest:LaunchPackageManifest={format:'anascummis.trusted-browser-runtime.v1',id:hash(html+script),taskId:crypto.randomUUID(),revision:1,zipSha256:hash('ownership spike only, not a ZIP'),kind:'collection',title:'Owned runtime spike',storageKey:'anascummis-owned-runtime-spike',wrapperVersion:1,reactVersion:'not used by fixed spike',sourceFiles:[],files:[{path:'index.html',bytes:Buffer.byteLength(html),sha256:hash(html)},{path:'app.js',bytes:Buffer.byteLength(script),sha256:hash(script)}]};
await Bun.write(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const reserve=()=>{const temporary=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('owned reservation')});const port=temporary.port!;void temporary.stop(true);return port;};
const appPort=reserve(),studioPort=reserve(),studioOrigin='http://127.0.0.1:'+studioPort,appOrigin='http://127.0.0.1:'+appPort;
const cookie=crypto.randomUUID();let leakRequests=0;
const studio=Bun.serve({hostname:'127.0.0.1',port:studioPort,fetch(request){
 if(new URL(request.url).pathname==='/leak')leakRequests++;
 return new Response(`<!doctype html><html><body><h1>Owned Studio fixture</h1><button id="close">Close app</button><button id="reopen">Reopen app</button><div id="slot"></div><script>localStorage.setItem('studio-only','parent-only-fixture');function open(){if(document.querySelector('iframe'))return;const frame=document.createElement('iframe');frame.title='Owned app';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');frame.src=${JSON.stringify(appOrigin)};document.querySelector('#slot').append(frame);}document.querySelector('#close').onclick=()=>document.querySelector('iframe')?.remove();document.querySelector('#reopen').onclick=open;open();</script></body></html>`,{headers:{'Content-Type':'text/html','Set-Cookie':'studio='+cookie+'; HttpOnly; SameSite=Strict; Path=/'}});
}});
const report:any={scope:'Host-owned fixed-client spike only; no accepted ZIP, native inference or product integration proof.',startedAt:new Date().toISOString(),origin:appOrigin,studioOrigin,checks:[],ownedProcesses:[],limitations:['Installed Chromium, not a physical handset or native OS distribution proof.','Cookies reach the host-owned edge because ports do not isolate cookies; fixed asset handlers receive sanitized requests.']};
let app:OwnedAppProcess|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,helper:ReturnType<typeof Bun.spawn>|undefined;
const check=(name:string,detail:unknown)=>report.checks.push({name,passed:true,detail});
const until=async(check:()=>Promise<boolean>|boolean,label:string)=>{for(let i=0;i<100;i++){if(await check())return;await Bun.sleep(50);}throw new Error('Timed out: '+label);};
try{
 app=await startAppProcess({port:appPort,studioOrigin,root,manifest});report.ownedProcesses.push({stage:'first Start',pid:app.pid});
 browser=await chromium.launch({executablePath:process.env.STUDIO_BROWSER_EXE||'/usr/bin/chromium',headless:true});const context=await browser.newContext({viewport:{width:360,height:800},hasTouch:true});const page=await context.newPage();
 const externalRequests:string[]=[];await context.route('**/*',route=>{const url=new URL(route.request().url());if(![studioOrigin,appOrigin].includes(url.origin)){externalRequests.push(url.origin);return route.abort();}return route.continue();});
 await page.goto(studioOrigin);const frame=page.frameLocator('iframe');await frame.getByRole('heading',{name:'Owned runtime spike'}).waitFor();await frame.getByLabel('Task',{exact:true}).fill('Keep this task');await frame.getByLabel('Task',{exact:true}).press('Enter');assert.equal(await frame.getByRole('list').innerText(),'Keep this task');
 await frame.getByRole('button',{name:'Test browser boundary'}).click();await until(async()=>!!(await frame.locator('#proof').textContent()),'browser boundary result');const proof=JSON.parse((await frame.locator('#proof').textContent())!);assert.deepEqual(proof,{parentDOMBlocked:true,parentStorageBlocked:true,topNavigationBlocked:true,popupBlocked:true,fetchBlocked:true,fetchTargetParsed:true,cookieVisible:false});assert.equal(page.url(),studioOrigin+'/');assert.equal(leakRequests,0);assert.equal(context.pages().length,1);
 const session=await context.cookies(studioOrigin);assert.equal(session.find(item=>item.name==='studio')?.value,cookie);check('actual separate-origin iframe, storage and session boundary',{proof,sessionCookieUnchanged:true,parentLeakRequests:0,externalRequests});
 const firstPid=app.pid;await page.getByRole('button',{name:'Close app'}).click();await page.getByRole('button',{name:'Reopen app'}).click();await frame.getByRole('list').waitFor();assert.equal(await frame.getByRole('list').innerText(),'Keep this task');await page.reload();await frame.getByRole('list').waitFor();assert.equal(await frame.getByRole('list').innerText(),'Keep this task');assert.equal(app.pid,firstPid);check('close/reopen/reload reuse the same process and browser storage',{pid:firstPid,items:['Keep this task']});
 await fetch(appOrigin+'/app.js',{headers:{Cookie:'studio=fixture-only',Authorization:'Bearer fixture-only','X-Anascummis-Pair':'fixture-only'}});await until(()=>app!.boundary.credentialRequests>0,'boundary aggregate');assert.equal(app.boundary.sanitizedCredentialRequests,0);assert.equal(app.boundary.responseCookieHeaders,0);check('credentials observed only at edge; no app-facing credentials or response cookies',app.boundary);
 const environment=app.environmentKeys;assert(!environment.some(key=>/STUDIO|SECRET|TOKEN|API_KEY|AUTHORIZATION/i.test(key)));const command=(await readFile('/proc/'+app.pid+'/cmdline')).toString().split('\0');assert(command.includes('--no-env-file')&&command.includes('--no-install'));check('worker receives only minimal environment with dotenv and auto-install disabled',{names:environment,noEnvFileFlag:true,noInstallFlag:true});
 await page.getByRole('button',{name:'Close app'}).click();await app.stop();assert.equal(await app.exited,0);await assert.rejects(fetch(appOrigin));
 app=await startAppProcess({port:appPort,studioOrigin,root,manifest});report.ownedProcesses.push({stage:'explicit same-origin restart',pid:app.pid});await page.getByRole('button',{name:'Reopen app'}).click();await frame.getByRole('list').waitFor();assert.equal(await frame.getByRole('list').innerText(),'Keep this task');check('awaited Stop and explicit Start retain stable address/items',{origin:appOrigin,oldPid:firstPid,newPid:app.pid,items:['Keep this task']});
 await page.getByRole('button',{name:'Close app'}).click();await app.stop();
 const options={port:appPort,studioOrigin,root,manifest};const helperPath=join(output,'owned-parent.ts');await Bun.write(helperPath,`import {startAppProcess} from ${JSON.stringify(resolve(import.meta.dir,'../core/app-launch-process.ts'))};const app=await startAppProcess(${JSON.stringify(options)});console.log(JSON.stringify({pid:app.pid,origin:app.origin}));await app.exited;`);
 helper=Bun.spawn([process.execPath,helperPath],{stdin:'ignore',stdout:'pipe',stderr:'pipe',env:{PATH:process.env.PATH||''}});const outputStream=helper.stdout;assert(outputStream&&typeof outputStream!=='number','Owned parent stdout is a pipe');const reader=outputStream.getReader();let ready='';while(!ready.includes('\n')){const next=await reader.read();assert(!next.done,'Owned parent exited before readiness');ready+=new TextDecoder().decode(next.value);assert(ready.length<10000);}const nested=JSON.parse(ready.split('\n')[0]);const startTick=(await readFile('/proc/'+nested.pid+'/stat','utf8')).split(' ')[21];report.ownedProcesses.push({stage:'nested parent SIGKILL proof',parent:helper.pid,pid:nested.pid});helper.kill('SIGKILL');await helper.exited;
 await until(async()=>{try{await fetch(appOrigin,{signal:AbortSignal.timeout(200)});return false;}catch{return true;}},'owned worker exits after parent SIGKILL');
 let childState='absent';try{const stat=(await readFile('/proc/'+nested.pid+'/stat','utf8')).split(' ');assert.equal(stat[21],startTick);childState=stat[2];assert.equal(childState,'Z');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 check('actual parent SIGKILL closes IPC and removes the owned listener',{parentPid:helper.pid,workerPid:nested.pid,childState,origin:appOrigin});
 app=await startAppProcess(options);report.ownedProcesses.push({stage:'explicit restart after parent death',pid:app.pid});await page.getByRole('button',{name:'Reopen app'}).click();await frame.getByRole('list').waitFor();assert.equal(await frame.getByRole('list').innerText(),'Keep this task');check('explicit post-interruption Start preserves same-origin items',{items:['Keep this task'],origin:appOrigin});await page.getByRole('button',{name:'Close app'}).click();await app.stop();
 const unrelated=Bun.serve({hostname:'127.0.0.1',port:appPort,fetch:()=>new Response('unrelated200')});try{await assert.rejects(startAppProcess(options));assert.equal(await (await fetch(appOrigin)).text(),'unrelated200');check('occupied saved address and unrelated HTTP200 are refused',{unrelatedServerUntouched:true});}finally{await unrelated.stop(true);}
 assert.equal(hash(await readFile(join(root,'app.js'))),manifest.files.find(file=>file.path==='app.js')!.sha256);report.status='passed';
}catch(error){report.status='failed';report.error=error instanceof Error?error.stack:String(error);process.exitCode=1;}
finally{if(helper&&helper.exitCode===null){helper.kill('SIGTERM');await helper.exited;}if(app)await app.stop();if(browser)await browser.close();await studio.stop(true);report.finishedAt=new Date().toISOString();report.sharedServicesTouched=false;await Bun.write(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:join(output,'report.json'),error:report.error}));}
