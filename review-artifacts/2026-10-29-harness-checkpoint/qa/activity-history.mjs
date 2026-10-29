import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createWriteStream} from 'node:fs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json');
const {chromium}=require('playwright-core');
const base='http://127.0.0.1:3211',run=randomUUID();
const data=process.env.ACTIVITY_FIXTURE_DATA||await mkdtemp('/workspace/.cloud-env/anascummis/activity-history/run-');assert(data.startsWith('/workspace/.cloud-env/anascummis/activity-history/run-'));
const log=createWriteStream(data+'/server.log');
let host,browser;
async function until(check,label,timeout=30000){
 const end=Date.now()+timeout;
 do{if(await check())return;await delay(100);}while(Date.now()<end);
 throw new Error('Timed out: '+label+'; artifacts '+data);
}
async function get(path){const response=await fetch(base+path,{signal:AbortSignal.timeout(5000)});assert(response.ok,path+': '+response.status);return response.json();}
async function all(path){
 const events=[];let cursor,first;
 do{const page=await get(path+'?limit=23'+(cursor?'&before='+cursor:''));first??=page;events.push(...page.events);cursor=page.nextCursor;}while(cursor);
 assert.equal(new Set(events.map(event=>event.sequence)).size,events.length);
 assert(events.every((event,index)=>!index||events[index-1].sequence>event.sequence));
 return {events,importedHistory:first.importedHistory,earlierHistoryMayBeMissing:first.earlierHistoryMayBeMissing};
}
async function start(){
 host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['/workspace/.cloud-env/anascummis/activity-history/fixture-host.ts'],{cwd:'/workspace/anascummis/apps/studio',env:{...process.env,STUDIO_DATA:data,FIXTURE_RUN_ID:run},stdio:['ignore','pipe','pipe']});
 host.stdout.pipe(log,{end:false});host.stderr.pipe(log,{end:false});
 await Promise.race([until(async()=>{try{return(await get('/fixture/ready')).run===run;}catch{return false;}},'isolated history host'),new Promise((_,reject)=>host.once('exit',code=>reject(Error('Fixture exited '+code))))]);
}
async function stop(signal='SIGTERM'){
 if(!host||host.exitCode!==null||host.signalCode!==null)return;
 const closed=new Promise(resolve=>host.once('exit',resolve));host.kill(signal);await closed;
}
const errors=[];
async function newPage(command){
 const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Etc/UTC',reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/speech-stream',route=>route.fulfill({contentType:'application/x-ndjson',body:''}));
 await page.goto(base,{waitUntil:'networkidle'});
 await until(()=>page.locator('.orb-control').isEnabled(),'initial page readiness');
 if(command)await say(page,command);
 return page;
}
async function say(page,command){
 if(!await page.getByRole('textbox',{name:'Message Anascummis'}).isVisible()){await page.locator('.voice-status').click();await page.keyboard.press('Space');await page.keyboard.press('Space');}
 await page.getByRole('textbox',{name:'Message Anascummis'}).fill(command);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 const close=page.getByRole('button',{name:'Close text input',exact:true});if(await close.isVisible())await close.click();
}
async function openHistory(card){
 const history=card.locator('details.activity-history'),summary=history.locator('summary');await summary.focus();await summary.press('Space');
 await until(async()=>await history.locator('[data-activity-sequence]').count()>0,'first activity page');assert.equal(await card.page().getByRole('textbox',{name:'Message Anascummis'}).isVisible(),false);return history;
}
async function loadAll(history){
 for(let index=0;index<30;index++){
   const button=history.getByRole('button',{name:'Show earlier activity',exact:true});
   if(!await button.isVisible())break;
   const count=await history.locator('[data-activity-sequence]').count();
   await button.click({timeout:5000});
   await until(async()=>await history.locator('[data-activity-sequence]').count()>count,'earlier activity page');
 }
 return history.locator('[data-activity-sequence]').evaluateAll(nodes=>nodes.map(node=>Number(node.getAttribute('data-activity-sequence'))));
}
async function capture(page,history,label){
 for(const [suffix,width,height] of [['desktop',1440,1000],['narrow',360,800]]){
   await page.setViewportSize({width,height});
   await until(async()=>{const box=await page.locator('.flexlayout__float_window').filter({has:history}).boundingBox();return box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1;},'visible history float after viewport resize');
   await history.evaluate(node=>node.scrollIntoView({block:'start'}));
   await history.locator('.activity-history-entries').evaluate(node=>{node.scrollTop=node.scrollHeight;});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document overflow');
   await page.screenshot({path:data+'/'+label+'-'+suffix+'.png'});
 }
 await page.setViewportSize({width:1440,height:1000});
}
try{
 await start();const ids=await get('/fixture/ready'),session=(await fetch(base+'/')).headers.get('set-cookie')?.split(';')[0];assert(session);
 const paths={goal:'/api/goals/'+ids.goalId+'/activity',work:'/api/jobs/'+ids.workId+'/activity',software:'/api/software/'+ids.softwareId+'/activity'};
 const baseline={};
 for(const [kind,path] of Object.entries(paths)){baseline[kind]=await all(path);assert(baseline[kind].events.length>160);assert.equal(baseline[kind].earlierHistoryMayBeMissing,false);}
 const apiChecks=[];
 for(const path of Object.values(paths)){
   for(const query of ['?limit=101','?limit=0','?before=0','?before=1.5','?before=9007199254740992','?before=']){
     const response=await fetch(base+path+query);assert.equal(response.status,400,path+query);apiChecks.push({path:path+query,status:response.status});
   }
   const response=await fetch(base+path,{method:'POST',headers:{Cookie:session,Origin:base,'X-Requested-With':'Anascummis','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,405);apiChecks.push({path,method:'POST',status:response.status});
 }
 for(const kind of ['goals','jobs','software']){const path='/api/'+kind+'/'+randomUUID()+'/activity',response=await fetch(base+path);assert.equal(response.status,404);apiChecks.push({path,status:response.status});}
 const noPair=await fetch(base+paths.software,{headers:{Origin:'https://anascummis.com'}});assert.equal(noPair.status,403);
 const pair=(await readFile(data+'/software-pairing.key','utf8')).trim();
 const paired=await fetch(base+paths.software,{headers:{Origin:'https://anascummis.com','X-Anascummis-Pair':pair}});assert.equal(paired.status,200);assert.equal(paired.headers.get('access-control-allow-origin'),'https://anascummis.com');
 const wrongOrigin=await fetch(base+paths.software,{headers:{Origin:'https://example.com','X-Anascummis-Pair':pair}});assert.equal(wrongOrigin.status,403);
 const projection={goal:(await get('/api/goals/'+ids.goalId)).events.length,work:(await get('/api/jobs')).history.find(item=>item.id===ids.workId).events.length,software:(await get('/api/software/'+ids.softwareId)).events.length};
 assert.equal(projection.goal,160);assert.equal(projection.work,160);assert(projection.software<=160);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 const goalPage=await newPage('show goals'),goalCard=goalPage.locator('.goal-panel .goal-record').first();
 const draft='Retain this unsent continuation while I inspect earlier activity.';
 await goalCard.getByLabel('Guidance for continuing',{exact:true}).fill(draft);
 const goalHistory=await openHistory(goalCard),initialSequences=await loadAll(goalHistory);
 assert.deepEqual(initialSequences,baseline.goal.events.map(event=>event.sequence));
 assert((await goalHistory.locator('.activity-history-count').innerText()).startsWith(initialSequences.length+' saved activity entries shown'));
 const appended=await fetch(base+'/fixture/append',{method:'POST'});assert(appended.ok);
 await delay(2300); // Allow the production parent's normal two-second poll to update.
 assert.equal(await goalCard.getByLabel('Guidance for continuing',{exact:true}).inputValue(),draft);
 assert.deepEqual(await goalHistory.locator('[data-activity-sequence]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.activitySequence))),initialSequences);
 await goalHistory.getByRole('button',{name:'Refresh activity',exact:true}).click();
 const updatedGoal=await all(paths.goal);
 await until(async()=>Number(await goalHistory.locator('[data-activity-sequence]').first().getAttribute('data-activity-sequence'))===updatedGoal.events[0].sequence,'explicit history refresh');
 assert.deepEqual(await loadAll(goalHistory),updatedGoal.events.map(event=>event.sequence));
 assert.equal(await goalCard.getByLabel('Guidance for continuing',{exact:true}).inputValue(),draft);
 await capture(goalPage,goalHistory,'goals-earliest-retained');
 const workPage=await newPage('show work'),workCard=workPage.locator('.work-journal article').first(),workHistory=await openHistory(workCard);
 assert.deepEqual(await loadAll(workHistory),baseline.work.events.map(event=>event.sequence));await capture(workPage,workHistory,'work-earliest-retained');
 const softwarePage=await newPage('show software work'),softwareCard=softwarePage.locator('[data-software-task-id="'+ids.softwareId+'"]');
 await softwareCard.getByRole('button',{name:'Open parent build',exact:true}).waitFor();
 await softwareCard.getByRole('button',{name:'Open parent build',exact:true}).scrollIntoViewIfNeeded();await softwarePage.screenshot({path:data+'/software-current-lineage-desktop.png'});
 const softwareHistory=await openHistory(softwareCard),updatedSoftware=await all(paths.software);
 assert.deepEqual(await loadAll(softwareHistory),updatedSoftware.events.map(event=>event.sequence));await capture(softwarePage,softwareHistory,'software-earliest-retained');
 const beforeRestart={goal:updatedGoal,work:baseline.work,software:updatedSoftware};
 await stop('SIGKILL');await start();
 for(const [kind,path] of Object.entries(paths))assert.deepEqual(await all(path),beforeRestart[kind]);
 assert.equal(await goalCard.getByLabel('Guidance for continuing',{exact:true}).inputValue(),draft);
 await goalPage.reload({waitUntil:'networkidle'});await say(goalPage,'show goals');
 const restoredHistory=await openHistory(goalPage.locator('.goal-panel .goal-record').first());
 assert.deepEqual(await loadAll(restoredHistory),updatedGoal.events.map(event=>event.sequence));
 await capture(goalPage,restoredHistory,'goals-after-restart');
 assert.deepEqual(errors,[]);
 await writeFile(data+'/lifecycle.json',JSON.stringify({fixture:ids.fixture,ids,sourceProjectionCounts:projection,retainedCounts:Object.fromEntries(Object.entries(beforeRestart).map(([kind,value])=>[kind,value.events.length])),activity:beforeRestart,apiChecks,softwarePairing:{unpaired:noPair.status,paired:paired.status,unrelatedOrigin:wrongOrigin.status},ui:{exactApiSequencesVisible:true,oldestBeyond160Visible:true,unsentGuidancePreservedDuringPollPaginationRefreshAndHostRestart:true,explicitRefreshIncludesNewAppends:true,desktopAndNarrowWindowBounds:true,pageErrors:errors},restart:'SIGKILL of the owned host; exact journal sequence/payload persisted and UI reload retrieved full history.',model:(await get('/api/status')).model},null,2));
 console.log('Passed: three real activity APIs retain >160 events, strict pagination/origin guards, exact API-to-DOM history, drafts during live polls, explicit refresh, SIGKILL/reload persistence and desktop/narrow bounds.');
 console.log('History evidence:',data);
}catch(error){
 if(browser){let index=0;for(const context of browser.contexts())for(const page of context.pages()){
   await page.screenshot({path:data+'/failure-page-'+index+'.png'}).catch(()=>{});
   const floats=await page.locator('.flexlayout__float_window').evaluateAll(nodes=>nodes.map(node=>({text:node.querySelector('.flexlayout__tab_button_content')?.textContent,rectangle:node.getBoundingClientRect().toJSON(),zIndex:getComputedStyle(node).zIndex}))).catch(()=>[]);
   await writeFile(data+'/failure-floats-'+index+'.json',JSON.stringify(floats,null,2));index++;
 }}
 throw error;
}finally{await browser?.close();await stop();log.end();}
