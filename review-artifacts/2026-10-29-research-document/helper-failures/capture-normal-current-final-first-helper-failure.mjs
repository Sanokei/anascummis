import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '/workspace/anascummis/apps/studio/node_modules/playwright-core/index.mjs';

const origin='http://127.0.0.1:3211',studio='/workspace/anascummis/apps/studio';
const output='/workspace/.cloud-env/anascummis/research-document/normal-current-final';
await mkdir(output); // Refuse to overwrite an earlier attempt.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected={version:'6e8a3764bd5ca06d675e721b910ab9300a56ed0eed5913f097503a8a44b46352',sha256:'2764e1a746c3133f84cae9a4df12001bd14d8485096107b5e767c59bd082636c',source:'c6da6cd77dbeee24d5b0aa6932ef38a6fedff02d'};
const routes=['/api/projects','/api/goals','/api/jobs','/api/software','/api/documents'];
async function apiSnapshot(){const result={};for(const route of routes){const response=await fetch(origin+route);assert(response.ok());result[route]=await response.json();}for(const project of result['/api/projects']){const response=await fetch(origin+'/api/projects/'+project.id);assert(response.ok());result['project:'+project.id]=await response.json();}return result;}
async function processSnapshot(){return Promise.all([62739,18848].map(async pid=>({pid,startTimeTicks:(await readFile('/proc/'+pid+'/stat','utf8')).trim().split(/\s+/)[21]})));}
async function dataSnapshot(){const result=[];for(const name of ['studio.sqlite','studio.sqlite-wal']){const path=join(studio,'.data',name);try{const info=await stat(path);assert(info.isFile());const bytes=await readFile(path);result.push({name,bytes:bytes.length,sha256:sha(bytes)});}catch(error){if(error.code!=='ENOENT')throw error;result.push({name,exists:false});}}return result;}
const receipt={status:'running',startedAt:new Date().toISOString(),origin,scope:'Already-running ordinary Studio. Read-only readiness, empty typing discovery and current Download handoff only; no fixtures, message, goal, app launch, inference, model setup or service change.',productCode:'9ad0fadaf12eab78ae360861ca6c56eeb5d411c1',deliverySource:expected.source,cases:[],screenshots:[],blockedExternalRequests:[],mutationAttempts:[],requests:[],pageErrors:[],limitations:['Chrome desktop/touch emulation; no physical handset or native OS installation proof.','External browser requests are deliberately blocked, including voice initialization/configuration. Voice remains unverified; its unavailable state here is not a new native voice test.','Normal data has no Goals or Software builds. Real work windows and native research/document results are separate owned-instance evidence.','Actual current kit browser bytes are checked; no new extraction, dependency install, setup or native-OS install is performed.','SQLite shared-memory lock bookkeeping is excluded from durable file hashing. API records, main database and WAL bytes are compared.']};
let browser,context,failure,recordsBefore,processesBefore,dataBefore;
async function hit(locator,viewport){await locator.waitFor({state:'visible'});const bounds=await locator.boundingBox();assert(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);assert(await locator.evaluate(node=>{const box=node.getBoundingClientRect(),target=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return target===node||node.contains(target);}));return bounds;}
try{
 recordsBefore=await apiSnapshot();processesBefore=await processSnapshot();dataBefore=await dataSnapshot();
 assert.equal(recordsBefore['/api/projects'].length,1);assert.equal(recordsBefore['/api/goals'].length,0);assert.equal(recordsBefore['/api/software'].length,0);
 const status=await(await fetch(origin+'/api/status')).json();assert.equal(status.model.ready,true);receipt.runtime=status;
 const fetched=await fetch(origin+'/opensource/manifest.json');assert(fetched.ok);const manifest=await fetched.json();receipt.manifest=manifest;
 assert.equal(manifest.version,expected.version);assert.equal(manifest.sha256,expected.sha256);assert.equal(manifest.source.commit,expected.source);assert.equal(manifest.source.dirty,false);assert.equal(manifest.files,258);assert.equal(manifest.bytes,2042573);assert.equal(manifest.filename,'anascummis-studio-6e8a3764bd5ca06d.zip');
 await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const sourceFiles=['out/index.html','out/opensource/manifest.json','out/opensource/'+manifest.filename],sourceBefore=[];
 for(const path of sourceFiles)sourceBefore.push({path,sha256:sha(await readFile(join(studio,path)))});receipt.sourceInputsBefore=sourceBefore;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 for(const[name,viewport]of[['desktop',{width:1440,height:1000}],['narrow',{width:360,height:800}],['short',{width:360,height:420}]]){
  const entry={name,viewport,screenshots:[],closeHits:[],typing:{}};receipt.cases.push(entry);
  context=await browser.newContext({viewport,hasTouch:name!=='desktop',reducedMotion:'reduce',acceptDownloads:true,timezoneId:'America/New_York'});
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url()),item={case:name,method:request.method(),origin:url.origin,path:url.pathname};if(!['GET','HEAD'].includes(request.method())){receipt.mutationAttempts.push(item);return route.abort();}if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){receipt.blockedExternalRequests.push(item);return route.abort();}receipt.requests.push(item);return route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>receipt.pageErrors.push({case:name,error:error.message}));
  const response=await page.goto(origin,{waitUntil:'networkidle'});assert(response?.ok());assert.equal(sha(await response.body()),sourceBefore.find(item=>item.path==='out/index.html').sha256);
  const conversation=page.getByRole('region',{name:'Conversation with Anascummis',exact:true});await conversation.getByText('AI model: Local service reachable.',{exact:true}).waitFor();await conversation.getByText('Voice: Initialization unavailable.',{exact:true}).waitFor();
  async function capture(label){const filename=name+'-'+label+'.png';await page.screenshot({path:join(output,filename)});entry.screenshots.push(filename);receipt.screenshots.push(filename);}
  if(name==='desktop')await capture('normal-ai-ready');
  await page.getByRole('button',{name:'Type a message',exact:true})[name==='desktop'?'click':'tap']();
  const input=page.getByRole('textbox',{name:'Message Anascummis',exact:true});await input.waitFor();assert.equal(await input.inputValue(),'');await page.waitForFunction(()=>document.activeElement?.id==='orb-text');entry.typing={opened:true,focused:true,empty:true,sent:false};
  if(name==='narrow')await capture('empty-typing-no-send');
  await page.getByRole('button',{name:'Close text input',exact:true}).click();await input.waitFor({state:'hidden'});entry.typing.closed=true;
  await page.getByRole('button',{name:'Download',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Anascummis on your computer',exact:true});await dialog.waitFor();
  const kit=dialog.getByRole('region',{name:'Local source kit',exact:true}),link=kit.getByRole('link',{name:'Download local source ZIP',exact:true}),close=dialog.getByRole('button',{name:'Close download instructions',exact:true});
  await link.waitFor();await kit.getByText(manifest.version.slice(0,16),{exact:true}).waitFor();await kit.getByText(manifest.source.commit.slice(0,12),{exact:true}).waitFor();assert.equal(await link.getAttribute('href'),'/opensource/'+manifest.filename);entry.closeHits.push(await hit(close,viewport));
  await capture('current-download-version');
  const currentManifest=await page.request.get(origin+'/opensource/manifest.json');assert(currentManifest.ok());assert.deepEqual(await currentManifest.json(),manifest);
  if(name==='desktop'){
   const head=await page.request.head(origin+'/opensource/'+manifest.filename);assert(head.ok());assert.match(head.headers()['content-type'],/^application\/zip(?:;|$)/);const length=head.headers()['content-length'];if(length!==undefined)assert.equal(Number(length),manifest.bytes);
   const pending=page.waitForEvent('download');await link.click();const download=await pending;assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),manifest.filename);
   const path=join(output,'browser-downloaded-'+manifest.filename);await download.saveAs(path);const bytes=await readFile(path);assert.equal(bytes.length,manifest.bytes);assert.equal(bytes.subarray(0,4).toString('hex'),'504b0304');assert.equal(sha(bytes),manifest.sha256);
   receipt.browserDownload={path:path.slice(output.length+1),filename:download.suggestedFilename(),bytes:bytes.length,sha256:sha(bytes),signature:'PK0304',headContentType:head.headers()['content-type'],headLength:length??null};
  }
  await dialog.getByText('Verify this download',{exact:true}).click();const checksum=dialog.locator('.source-kit-checksum');await checksum.scrollIntoViewIfNeeded();assert.equal((await checksum.innerText()).trim(),manifest.sha256);entry.closeHits.push(await hit(close,viewport));entry.checksumMatches=true;
  const license=dialog.getByText('The kit includes this app, setup scripts, lockfile and licenses. Installed runtimes and private data are excluded.',{exact:true});await license.scrollIntoViewIfNeeded();assert(await license.isVisible());entry.licensesAndPrivateFileExclusionsVisible=true;
  const commands=dialog.locator('.download-local-content pre');await commands.scrollIntoViewIfNeeded();assert.equal((await commands.innerText()).trim(),'bun install --frozen-lockfile\nbun run setup\nbun run build\nbun run start');assert(await commands.isVisible());entry.closeHits.push(await hit(close,viewport));entry.instructionsVisible=true;
  if(name==='short')await capture('instructions-and-reachable-close');
  await close.click();await dialog.waitFor({state:'hidden'});entry.closed=true;assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await context.close();context=undefined;
 }
 for(const file of sourceBefore)assert.equal(sha(await readFile(join(studio,file.path))),file.sha256);receipt.sourceInputsUnchanged=true;
 assert.deepEqual(receipt.mutationAttempts,[]);assert.deepEqual(receipt.pageErrors,[]);assert.equal(receipt.screenshots.length,6);receipt.status='passed';
}catch(error){failure=error;receipt.status='failed';receipt.error={message:error.message,stack:error.stack};}
finally{
 await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
 try{const recordsAfter=await apiSnapshot(),processesAfter=await processSnapshot(),dataAfter=await dataSnapshot();receipt.apiRecordsUnchanged=JSON.stringify(recordsBefore)===JSON.stringify(recordsAfter);receipt.apiRecordHashes=recordsBefore&&Object.fromEntries(Object.entries(recordsBefore).map(([route,value])=>[route,sha(JSON.stringify(value))]));receipt.apiRecordSummary={projects:recordsAfter['/api/projects'].length,goals:recordsAfter['/api/goals'].length,software:recordsAfter['/api/software'].length,documents:recordsAfter['/api/documents'].length,activeJobs:recordsAfter['/api/jobs'].active?.length,historyJobs:recordsAfter['/api/jobs'].history?.length};receipt.processesBefore=processesBefore;receipt.processesAfter=processesAfter;receipt.processesUnchanged=JSON.stringify(processesBefore)===JSON.stringify(processesAfter);receipt.durableFilesBefore=dataBefore;receipt.durableFilesAfter=dataAfter;receipt.durableFileHashesUnchanged=JSON.stringify(dataBefore)===JSON.stringify(dataAfter);assert(receipt.apiRecordsUnchanged);assert(receipt.processesUnchanged);assert(receipt.durableFileHashesUnchanged);}catch(error){failure ||= error;receipt.status='failed';receipt.preservationError={message:error.message,stack:error.stack};}
 receipt.finishedAt=new Date().toISOString();await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({output,status:receipt.status,screenshots:receipt.screenshots,browserDownload:receipt.browserDownload,apiRecordsUnchanged:receipt.apiRecordsUnchanged,durableFileHashesUnchanged:receipt.durableFileHashesUnchanged,processesUnchanged:receipt.processesUnchanged,mutationAttempts:receipt.mutationAttempts.length,error:receipt.error||receipt.preservationError},null,2));
 if(failure){console.error(failure.stack||failure);process.exitCode=1;}
}
