import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {writeFile} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';import assert from 'node:assert/strict';
const root='/workspace/anascummis/apps/studio',scratch='/workspace/.cloud-env/anascummis/source-question',{chromium}=createRequire(root+'/package.json')('playwright-core'),base='http://127.0.0.1:3213';
const env={...process.env,STUDIO_PORT:'3213',STUDIO_DATA:scratch+'/lifecycle-9EeKnu',STUDIO_DEV:'0'};delete env.MODEL_URL;
const host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['core/server.ts'],{cwd:root,env,stdio:'ignore'});let browser;
try {
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/status')).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true,reducedMotion:'reduce',timezoneId:'Etc/UTC'});await page.goto(base,{waitUntil:'networkidle'});
 const status=await(await page.request.get(base+'/api/status')).json(),goal=(await(await page.request.get(base+'/api/goals')).json())[0];assert.equal(status.model.ready,false);assert.equal(goal.status,'completed');assert.equal(goal.tasks[2].execution.sourceAnswer.citations.length,2);
 const answer=page.getByRole('region',{name:'Source-grounded answer'});await answer.waitFor();
 for(const [label,width,height]of [['desktop',1440,1000],['narrow',360,800]]){await page.setViewportSize({width,height});await answer.locator('h4').evaluate(n=>{const body=n.closest('.floating-panel-content');body.scrollTop+=n.getBoundingClientRect().top-body.getBoundingClientRect().top-8;});await delay(150);await page.screenshot({path:scratch+'/accepted-answer-start-'+label+'.png'});}
 await writeFile(scratch+'/accepted-inspection.json',JSON.stringify({source:'75dd7f01a49909a470522165a71c0acbe558e3ab',fixture:'Read-only reopen of the real persisted scripted-inference result on an ordinary host with no model fixture running. This tests result retention and display, not native model quality.',status,goalId:goal.id,completed:true,citations:2,sourceAcquisitionAttempts:goal.tasks.slice(0,2).map(t=>t.attempts)},null,2));
 console.log('PASS retained scripted answer inspectable after restart with native model unavailable.');
}finally{await browser?.close();if(host.exitCode===null){const closed=new Promise(r=>host.once('exit',r));host.kill('SIGTERM');await closed;}}
