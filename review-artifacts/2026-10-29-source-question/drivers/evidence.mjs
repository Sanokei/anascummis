import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {createWriteStream} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';import assert from 'node:assert/strict';
const root='/workspace/anascummis/apps/studio',scratch='/workspace/.cloud-env/anascummis/source-question',require=createRequire(root+'/package.json'),{chromium}=require('playwright-core'),base='http://127.0.0.1:3213';
const data=await mkdtemp(scratch+'/evidence-');await mkdir(data+'/screenshots');await writeFile(scratch+'/active-evidence-path',data+'\n');
const env={...process.env,STUDIO_PORT:'3213',STUDIO_DATA:data,STUDIO_DEV:'0'};delete env.MODEL_URL;
const log=createWriteStream(data+'/host.log'),host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['core/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});host.stdout.pipe(log);host.stderr.pipe(log);let browser,page;
const receipt={source:'4c66da150296b9710ba04c05f5119185fe5367e2',fixture:'Fresh ordinary production host, real public URL and persistence. No model, tokenization, voice, API or viewport mocks. Chromium desktop/touch emulation is not a physical handset test.',pid:host.pid,startedAt:new Date().toISOString(),data,checks:[],screenshots:[]};
async function until(check,label){for(let i=0;i<250;i++){if(await check())return;await delay(100);}throw Error('Timed out '+label);}
async function snap(name,target){if(target)await target.evaluate(node=>{const body=node.closest('.floating-panel-content');body.scrollTop+=node.getBoundingClientRect().top-body.getBoundingClientRect().top-8;});await delay(150);await page.screenshot({path:data+'/screenshots/'+name+'.png'});receipt.screenshots.push(name+'.png');}
async function command(text){await page.getByRole('button',{name:'Type a message',exact:true}).tap();await page.getByRole('textbox',{name:'Message Anascummis'}).fill(text);await page.getByRole('button',{name:'Send message'}).tap();const close=page.getByRole('button',{name:'Close text input'});if(await close.isVisible())await close.tap();}
async function getGoal(id){return (await page.request.get(base+'/api/goals/'+id)).json();}
try {
 await until(async()=>{try{return(await fetch(base+'/api/status')).ok;}catch{return false;}},'host');browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true,reducedMotion:'reduce',timezoneId:'Etc/UTC'});
 await page.goto(base,{waitUntil:'networkidle'});receipt.status=await(await page.request.get(base+'/api/status')).json();assert.equal(receipt.status.model.ready,false);
 await command('show goals');await page.getByRole('checkbox',{name:'Question from public sources',exact:true}).tap();await page.getByRole('textbox',{name:'Exact question',exact:true}).fill('Which standard does this repository host?\nUse only the saved source excerpt.');await page.getByRole('textbox',{name:'Public source URLs',exact:true}).fill('https://raw.githubusercontent.com/whatwg/fetch/main/README.md');await page.getByRole('checkbox',{name:'Allow public web research for this goal',exact:true}).tap();await page.getByRole('button',{name:'Save question and read sources',exact:true}).tap();
 let goal;await until(async()=>{const list=await(await page.request.get(base+'/api/goals')).json();goal=list[0];return goal?.status==='needs_input';},'native goal');
 assert.equal(goal.tasks[0].status,'verified');assert.equal(goal.tasks[1].execution,undefined);const baseline=goal.sources;
 await until(async()=>(await page.locator('.goal-record').innerText()).includes('Local AI is unavailable'),'native UI');
 const source=page.getByRole('article',{name:'Saved source source-1',exact:true}),sources=page.getByRole('region',{name:'Question sources and answer',exact:true});
 await source.locator('summary').tap();await snap('normal-saved-source-identity-desktop',source);
 await page.setViewportSize({width:360,height:800});await snap('normal-saved-source-identity-narrow',source);
 await snap('normal-no-answer-retry-narrow',sources.locator('>p').last());
 await command('show work');await command('show goals');
 await snap('normal-retry-with-work-narrow',page.getByRole('textbox',{name:'Guidance for continuing',exact:true}));
 for(const height of [800,420]){
  await page.setViewportSize({width:360,height});
  const resume=page.getByRole('button',{name:'Continue remaining work',exact:true});await resume.focus();
  const bounds=await resume.evaluate(node=>{const b=node.getBoundingClientRect(),t=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,hit:t===node||node.contains(t),focused:node===document.activeElement,documentOverflow:document.documentElement.scrollWidth>innerWidth};});
  assert(bounds.x>=0&&bounds.right<=360&&bounds.y>=0&&bounds.bottom<=height&&bounds.hit&&bounds.focused&&!bounds.documentOverflow,JSON.stringify(bounds));
  await snap('normal-focused-retry-360x'+height);receipt.checks.push({height,workOpen:await page.locator('.work-journal').count()>0,resume:bounds});
 }
 const before=goal.tasks[1].attempts;await page.keyboard.press('Space');await until(async()=>{goal=await getGoal(goal.id);return goal.status==='needs_input'&&goal.tasks[1].attempts===before+1;},'keyboard explicit retry');assert.deepEqual(goal.sources,baseline);assert.equal(goal.tasks[0].attempts,1);
 await page.setViewportSize({width:360,height:800});await source.getByRole('button',{name:'Inspect saved text',exact:true}).tap();await source.getByRole('button',{name:'Next text',exact:true}).focus();await page.keyboard.press('Space');await until(async()=>(await source.innerText()).includes('1000–2000'),'keyboard next text');await snap('normal-focused-saved-text-narrow',source.getByRole('button',{name:'Next text',exact:true}));
 await page.getByRole('tab',{name:'Goals',exact:true}).focus();await page.keyboard.press('Control+Delete');await page.locator('.goal-panel').waitFor({state:'hidden'});await command('show goals');await page.locator('.goal-panel').waitFor();assert.deepEqual((await getGoal(goal.id)).sources,baseline);
 receipt.checks.push({keyboardSpaceRetry:true,keyboardTextPaging:true,keyboardCloseAndReopen:true,acceptedAcquisitionAttempt:1,sourceSnapshotUnchanged:true});receipt.goal=goal;receipt.outcome='passed';console.log('PASS fresh native evidence '+data);
} catch(error){receipt.error=String(error);receipt.outcome='failed';console.error(error);process.exitCode=1;if(page)await page.screenshot({path:data+'/failure.png'}).catch(()=>{});}
finally {await writeFile(data+'/receipt.json',JSON.stringify(receipt,null,2));await browser?.close();if(host.exitCode===null){const closed=new Promise(r=>host.once('exit',r));host.kill('SIGTERM');await closed;}log.end();}
