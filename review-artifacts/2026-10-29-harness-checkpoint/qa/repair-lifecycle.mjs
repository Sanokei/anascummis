import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json');
const {chromium}=require('playwright-core');
const parent=JSON.parse(await readFile('/workspace/.cloud-env/anascummis/security-upgrade/repair-parent.json','utf8'));
const base='http://127.0.0.1:3211',run=randomUUID(),evidence='/workspace/.cloud-env/anascummis/security-upgrade/repair-'+run;
await mkdir(evidence,{recursive:true});
const log=createWriteStream(evidence+'/server.log');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let host,browser;
async function until(check,description,timeout=30000){
  const end=Date.now()+timeout;
  do{try{if(await check())return;}catch(error){if(error?.fatal)throw error;}await delay(150);}while(Date.now()<end);
  throw new Error('Timed out: '+description+'; evidence '+evidence);
}
async function startHost(hold){
  host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['/workspace/.cloud-env/anascummis/repair-server.ts'],{cwd:'/workspace/anascummis/apps/studio',env:{...process.env,STUDIO_DATA:parent.data,FIXTURE_RUN_ID:run,REPAIR_HOLD:hold?'1':'0'},stdio:['ignore','pipe','pipe']});
  host.stdout.pipe(log,{end:false});host.stderr.pipe(log,{end:false});
  await Promise.race([until(async()=>{const response=await fetch(base+'/fixture/ready');return response.ok&&(await response.json()).fixture===run;},'fixture startup'),new Promise((_,reject)=>host.once('exit',code=>reject(new Error('Fixture host exited: '+code))))]);
}
async function stopHost(signal='SIGTERM'){
  if(!host||host.exitCode!==null||host.signalCode!==null)return;
  const stopped=new Promise(resolve=>host.once('exit',resolve));host.kill(signal);await stopped;
}
try{
  await startHost(true);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/New_York',reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  const parentBefore=await(await page.request.get(base+'/api/software/'+parent.parentId)).json();
  const parentSource=await readFile(parent.root+'/app/page.tsx'),parentTests=await readFile(parent.root+'/tests/app.test.tsx');
  const parentZip=await readFile(parent.root+'/artifacts/source.zip');
  const parentRow=page.locator('[data-software-task-id="'+parent.parentId+'"]');
  await parentRow.getByRole('button',{name:'Download source ZIP'}).waitFor();
  await parentRow.getByLabel('Revision guidance',{exact:true}).fill('Change the heading to Repair Verified and keep the counter working.');
  const createdResponse=page.waitForResponse(response=>response.url().endsWith('/api/software/'+parent.parentId+'/revise')&&response.request().method()==='POST');
  await parentRow.getByRole('button',{name:'Create revised build'}).click();
  const created=await createdResponse;assert.equal(created.status(),202);
  const child=await created.json();assert.notEqual(child.id,parent.parentId);assert.equal(child.parentTaskId,parent.parentId);assert.equal(child.parentRevision,parentBefore.revision);
  assert(!child.evidence,'Queued child must not inherit accepted evidence');
  assert.equal((await page.request.get(base+'/api/software/'+child.id+'/artifacts/source.zip')).status(),409);
  let childRow=page.locator('[data-software-task-id="'+child.id+'"]');
  await childRow.getByRole('button',{name:'Open parent build'}).waitFor();
  await until(async()=>{const x=await(await page.request.get(base+'/fixture/ready')).json();return x.blocked;},'persisted planning interruption');
  let checkpoint=await(await page.request.get(base+'/api/software/'+child.id)).json();
  assert.equal(checkpoint.revisionPlan.criterionOffset,1);
  await page.screenshot({path:evidence+'/child-planning-desktop.png'});
  await page.setViewportSize({width:360,height:800});
  await until(async()=>{const box=await page.locator('.software-panel').boundingBox();return box&&box.x>=0&&box.y>=0&&box.x+box.width<=361&&box.y<800;},'visible software window after shrinking desktop');
  await childRow.locator('strong').first().scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow page overflow');
  await page.screenshot({path:evidence+'/child-planning-narrow.png'});
  await stopHost('SIGKILL');await startHost(false);
  await page.reload({waitUntil:'networkidle'});
  await page.setViewportSize({width:1440,height:1000});
  let current;
  await until(async()=>{
    current=await(await page.request.get(base+'/api/software/'+child.id)).json();
    if(current.status==='needs_input'){const error=new Error(current.message);error.fatal=true;throw error;}
    return current.status==='completed';
  },'real repaired build and fresh ZIP acceptance',300000);
  assert.equal(current.id,child.id);assert.equal(current.parentTaskId,parent.parentId);assert.equal(current.evidence.revision,current.revision);
  assert(current.evidence.checks.every(check=>check.ok));assert(current.evidence.headings.includes('Repair Verified'));
  assert(current.evidence.checks.some(check=>check.id==='browser'&&check.detail.includes('counter acceptance passed')));
  assert(current.evidence.artifacts.some(artifact=>artifact.kind==='zip'&&artifact.smokeTested));
  const parentAfter=await(await page.request.get(base+'/api/software/'+parent.parentId)).json();
  assert.deepEqual(parentAfter,parentBefore,'Accepted parent metadata changed');
  assert.equal(sha(await readFile(parent.root+'/app/page.tsx')),sha(parentSource));
  assert.equal(sha(await readFile(parent.root+'/tests/app.test.tsx')),sha(parentTests));
  assert.equal(sha(await readFile(parent.root+'/artifacts/source.zip')),sha(parentZip));
  const downloaded=await page.request.get(base+'/api/software/'+child.id+'/artifacts/source.zip');assert.equal(downloaded.status(),200);
  const zip=Buffer.from(await downloaded.body()),artifact=current.evidence.artifacts.find(a=>a.kind==='zip');assert.equal(sha(zip),artifact.sha256);
  await writeFile(evidence+'/child-source.zip',zip);await writeFile(evidence+'/accepted-parent-source.zip',parentZip);
  await writeFile(evidence+'/lifecycle.json',JSON.stringify({fixture:'Scripted inference, real compiler/browser/ZIP checks',parentId:parent.parentId,childId:child.id,childCheckpoint:checkpoint,child:current,parentSourceSha:sha(parentSource),parentZipSha:sha(parentZip),childZipSha:sha(zip),parentUnchanged:true},null,2));
  childRow=page.locator('[data-software-task-id="'+child.id+'"]');
  await childRow.getByRole('button',{name:'Download source ZIP'}).waitFor();
  await childRow.locator('strong').first().scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/child-completed-desktop.png'});
  await page.setViewportSize({width:360,height:800});await until(async()=>{const box=await page.locator('.software-panel').boundingBox();return box&&box.x>=0&&box.x+box.width<=361;},'visible completed software window on narrow screen');await childRow.locator('strong').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:evidence+'/child-completed-narrow.png'});
  await childRow.getByRole('button',{name:'Open parent build'}).click();
  await parentRow.getByRole('button',{name:'Download source ZIP'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Passed: distinct UI-created child, unavailable stale download, checkpoint restart, real rebuilt heading/counter/ZIP, unchanged accepted parent, desktop+narrow lineage and downloads');
  console.log('Review evidence:',evidence);
}finally{await browser?.close();await stopHost();log.end();}
