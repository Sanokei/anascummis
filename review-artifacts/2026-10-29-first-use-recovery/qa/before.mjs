import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json'),{chromium}=require('playwright-core');
const config=JSON.parse(await readFile('/workspace/.cloud-env/anascummis/first-use/current.json','utf8')),output=config.data+'/before';await mkdir(output,{recursive:true});
const base='http://127.0.0.1:3211',browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
async function until(check,label){const end=Date.now()+30000;do{const value=await check();if(value)return value;await delay(150);}while(Date.now()<end);throw Error('Timed out: '+label);}
async function get(path){const response=await fetch(base+path);assert(response.ok);return response.json();}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Etc/UTC',reducedMotion:'reduce'}),pageErrors=[],responses=[];
 page.on('pageerror',error=>pageErrors.push(error.message));page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/'))responses.push({path:url.pathname,status:response.status()});});
 await page.goto(base,{waitUntil:'networkidle'});await until(()=>page.locator('.orb-control').isEnabled(),'workspace ready');
 async function send(text){let input=page.getByRole('textbox',{name:'Message Anascummis'});if(!await input.isVisible()){await page.locator('.voice-status').click();await page.keyboard.press('Space');await page.keyboard.press('Space');}await input.fill(text);await page.getByRole('button',{name:'Send message',exact:true}).click();}
 async function closeComposer(){const close=page.getByRole('button',{name:'Close text input',exact:true});if(await close.isVisible())await close.click();}
 async function capture(label,panel){
  for(const [name,width,height]of[['desktop',1440,1000],['narrow',360,800]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(panel)await panel.locator('strong,h3').first().scrollIntoViewIfNeeded();
   await page.screenshot({path:output+'/'+label+'-'+name+'.png'});
  }
  await page.setViewportSize({width:1440,height:1000});
 }
 const status=await get('/api/status');assert.equal(status.model.ready,false);
 const workRequest='Change the website title to First Use Recovery Probe and keep the existing sections.';
 const existingWork=await get('/api/jobs');if(![...existingWork.active,...existingWork.history].some(item=>item.request===workRequest))await send(workRequest);else await send('show work');
 const work=await until(async()=>{const x=await get('/api/jobs');return[...x.active,...x.history].find(item=>item.request===workRequest&&item.status!=='running');},'ordinary Work terminal outcome');
 const workCard=page.locator('.work-journal article').filter({has:page.getByText(workRequest,{exact:true})});await workCard.waitFor();await closeComposer();
 const workButtons=await workCard.getByRole('button').allTextContents();await capture('work-failure',workCard);
 const workVisible=await workCard.innerText(),workVoice=await page.locator('.voice-status').innerText();
 await send('show goals');await closeComposer();const goalPanel=page.getByRole('region',{name:'Coordinated goals'});await goalPanel.waitFor();
 const goalRequest='Set the website title to First Use Goal Probe, then explain the saved change.';
 if(!(await get('/api/goals')).some(item=>item.request===goalRequest)){if(await goalPanel.locator('details.goal-create').count())await goalPanel.locator('details.goal-create summary').click();await goalPanel.getByLabel('Goal',{exact:true}).fill(goalRequest);await goalPanel.getByRole('button',{name:'Start coordinated work'}).click();}
 const goal=await until(async()=>{const x=await get('/api/goals');return x.find(item=>item.request===goalRequest&&['needs_input','completed','cancelled'].includes(item.status));},'Goal terminal outcome');
 const goalCard=goalPanel.locator('article.goal-record').first();await until(()=>goalCard.getByRole('button',{name:'Continue remaining work'}).isVisible(),'existing goal recovery');await capture('goal-failure',goalCard);
 const goalVisible=await goalCard.innerText();
 await send('show software work');await closeComposer();const softwarePanel=page.locator('.software-panel');await softwarePanel.waitFor();
 const softwareRequest='Create a counter app titled First Use Software Probe. Count starts at zero, Increment adds one, and reload resets the count.';
 await softwarePanel.getByLabel('Software goal',{exact:true}).fill(softwareRequest);await softwarePanel.getByRole('button',{name:'Build in background'}).click();
 const software=await until(async()=>{const x=await get('/api/software');return x.find(item=>item.goal===softwareRequest&&['needs_input','completed','cancelled'].includes(item.status));},'Software terminal outcome');
 const softwareCard=softwarePanel.locator('[data-software-task-id="'+software.id+'"]');await until(()=>softwareCard.getByRole('button',{name:'Resume checkpoint'}).isVisible(),'existing software recovery');await capture('software-failure',softwareCard);
 await page.getByRole('button',{name:'Download',exact:true}).click();await page.getByRole('dialog').waitFor();const instructions=await page.getByRole('dialog').innerText();await page.screenshot({path:output+'/existing-download-instructions.png'});await page.getByRole('button',{name:'Close download instructions'}).click();
 await writeFile(output+'/audit.json',JSON.stringify({sourceHead:'3a9d642c1e6d8ffc52b4226f040346e27ebce5e0',fixture:'Ordinary production server and real native-unavailable inference/voice failures; isolated data; NO model, voice or API mocking.',status,work:{record:work,visible:workVisible,buttons:workButtons,orbStatus:workVoice},goal:{record:goal,visible:goalVisible},software:{record:software,visible:await softwareCard.innerText()},existingDownloadInstructions:instructions,responses,pageErrors},null,2));
 console.log(JSON.stringify({audit:output+'/audit.json',workStatus:work.status,workOutcome:work.outcome,workButtons,goalStatus:goal.status,softwareStatus:software.status,pageErrors}));
}finally{await browser.close();}
