import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createWriteStream} from 'node:fs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json'),{chromium}=require('playwright-core');
const data=await mkdtemp('/workspace/.cloud-env/anascummis/first-use/native-'),base='http://127.0.0.1:3211',log=createWriteStream(data+'/server.log');
let host,browser;
async function until(check,label,timeout=30000){const end=Date.now()+timeout;do{const value=await check();if(value)return value;await delay(100);}while(Date.now()<end);throw Error('Timed out '+label+'; evidence '+data);}
async function get(path){const response=await fetch(base+path);assert(response.ok,path+':'+response.status);return response.json();}
async function jobs(){const page=await get('/api/jobs?limit=100');return [...page.active,...page.history];}
const errors=[],posts=[];
try{
 const env={...process.env,STUDIO_DATA:data,STUDIO_DEV:'0',STUDIO_PORT:'3211'};delete env.MODEL_URL;
 host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['core/server.ts'],{cwd:'/workspace/anascummis/apps/studio',env,stdio:['ignore','pipe','pipe']});let booted=false;host.stdout.on('data',chunk=>{if(chunk.toString().includes('Anascummis Studio:'))booted=true;});host.stdout.pipe(log,{end:false});host.stderr.pipe(log,{end:false});
 await Promise.race([until(async()=>{if(!booted)return false;try{return(await get('/api/status')).runtime==='local';}catch{return false;}},'normal server'),new Promise((_,reject)=>host.once('exit',code=>reject(Error('Host exited '+code))))]);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 const page=await browser.newPage({viewport:{width:360,height:800},isMobile:true,hasTouch:true,timezoneId:'Etc/UTC',reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(request.method()==='POST'&&['/api/chat','/api/goals','/api/software','/api/answer-stream','/api/speech-stream'].includes(url.pathname))posts.push({path:url.pathname,body:request.postDataJSON()});});
 const input=()=>page.getByRole('textbox',{name:'Message Anascummis'}),work=()=>page.getByRole('region',{name:'Work history',exact:true});
 async function type(text){await page.getByRole('button',{name:'Type a message',exact:true}).tap();await input().fill(text);}
 async function send(text){await type(text);await page.getByRole('button',{name:'Send message',exact:true}).tap();}
 async function closeComposer(){const close=page.getByRole('button',{name:'Close text input',exact:true});if(await close.isVisible())await close.tap();}
 async function snap(label,focus){
  for(const [name,width,height]of[['desktop',1440,1000],['narrow',360,800]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(focus)await focus.scrollIntoViewIfNeeded();await page.screenshot({path:data+'/'+label+'-'+name+'.png'});
  }
  await page.setViewportSize({width:360,height:800});
 }
 await page.goto(base,{waitUntil:'networkidle'});
 const readiness=page.locator('.presence>.local-readiness');await until(async()=>await readiness.getAttribute('data-readiness-model')==='unavailable','honest unavailable model');
 const status=await get('/api/status');assert.equal(status.model.ready,false);
 assert(await page.getByRole('button',{name:'Type a message',exact:true}).isVisible());
 assert(!await page.getByText('First use downloads local speech and model files.',{exact:true}).isVisible());
 await snap('landing-after');
 await readiness.getByRole('button',{name:'Check again',exact:true}).tap();await until(async()=>await readiness.getAttribute('data-readiness-model')==='unavailable','manual model recheck');
 await readiness.getByRole('button',{name:'Setup instructions',exact:true}).tap();const dialog=page.getByRole('dialog');await dialog.waitFor();assert((await dialog.innerText()).includes('bun run model:start'));await page.screenshot({path:data+'/setup-after-narrow.png'});await page.getByRole('button',{name:'Close download instructions'}).tap();
 const request='Change the website title to First Use Recovery Probe.\nKeep the existing sections.\nPreserve this exact multiline request; the final marker is RECOVERY-SUFFIX-Ω.';
 await type(request);assert.equal(await input().inputValue(),request);assert(await input().evaluate(node=>node===document.activeElement));
 await page.getByRole('button',{name:'Send message',exact:true}).tap();
 const original=await until(async()=> (await jobs()).find(row=>row.request===request&&row.status!=='running'),'native Work failure');
 assert.equal(original.status,'failed');assert(original.error.includes('Local AI is unavailable'));
 await closeComposer();const card=work().locator('article').filter({has:page.getByText(request,{exact:true})});await card.getByRole('button',{name:'Edit saved request',exact:true}).waitFor();
 const originalActivity=await get('/api/jobs/'+original.id+'/activity?limit=100');await snap('work-failure-after',card.getByRole('button',{name:'Edit saved request',exact:true}));
 // A changed workspace must not become the retry target.
 const headers={Origin:base,'X-Requested-With':'Anascummis'};
 const alternateResponse=await page.request.post(base+'/api/projects',{headers,data:{name:'Unrelated retry target'}});assert(alternateResponse.ok());const alternate=await alternateResponse.json();
 await page.reload({waitUntil:'networkidle'});await send('show work');await closeComposer();
 const restoredCard=work().locator('article').filter({has:page.getByText(request,{exact:true})});await restoredCard.getByRole('button',{name:'Edit saved request',exact:true}).waitFor();
 await type('Do not overwrite this newer unsent draft.');await closeComposer();
 const postCount=posts.filter(post=>post.path==='/api/chat').length;
 await restoredCard.getByRole('button',{name:'Edit saved request',exact:true}).tap();await until(async()=>await input().isVisible(),'conflicting draft stays visible');assert.equal(await input().inputValue(),'Do not overwrite this newer unsent draft.');assert.equal(posts.filter(post=>post.path==='/api/chat').length,postCount);
 await input().fill('');await closeComposer();await restoredCard.getByRole('button',{name:'Edit saved request',exact:true}).tap();await until(async()=>await input().inputValue()===request,'exact saved multiline recovery');
 await input().tap();assert(await input().evaluate(node=>node===document.activeElement));assert.equal(posts.filter(post=>post.path==='/api/chat').length,postCount);
 await snap('recovered-draft-after',input());
 await page.setViewportSize({width:360,height:420});await input().tap();assert(await input().evaluate(node=>node===document.activeElement));await page.screenshot({path:data+'/composer-keyboard-viewport-after.png'});await page.setViewportSize({width:360,height:800});
 const edited=request+'\nExplicitly reviewed new attempt: KEEP-RETRY-SUFFIX.';await input().fill(edited);await page.getByRole('button',{name:'Send message',exact:true}).tap();
 const retry=await until(async()=> (await jobs()).find(row=>row.request===edited&&row.status!=='running'),'reviewed native retry');assert.notEqual(retry.id,original.id);assert.equal(retry.projectId,original.projectId);assert.notEqual(retry.projectId,alternate.id);assert.equal(posts.filter(post=>post.path==='/api/chat').length,postCount+1);
 assert.deepEqual((await jobs()).find(row=>row.id===original.id),original);assert.deepEqual(await get('/api/jobs/'+original.id+'/activity?limit=100'),originalActivity);assert.equal((await get('/api/projects/'+alternate.id)).revision,0);
 const retryPost=posts.filter(post=>post.path==='/api/chat').at(-1);assert.equal(retryPost.body.project,original.projectId);assert.equal(retryPost.body.text,edited);assert.equal(retryPost.body.research,false);assert.deepEqual(retryPost.body.savedDetails,[]);
 await closeComposer();await snap('retry-record-after',work().getByText(edited,{exact:true}));
 // A lost acceptance response is not proof that the server did not save a run.
 let dropped=false;const lostRequest='Change the website title to Lost Acknowledgement Probe.';
 await page.route('**/api/chat',async route=>{if(!dropped&&route.request().postDataJSON().text===lostRequest){dropped=true;const accepted=await route.fetch();assert(accepted.ok());await route.abort('failed');}else await route.continue();});
 await send(lostRequest);await until(async()=>await page.locator('.request-recovery').isVisible(),'unconfirmed submission notice');assert.equal(await input().inputValue(),lostRequest);
 const lost=await until(async()=> (await jobs()).find(row=>row.request===lostRequest&&row.status!=='running'),'server row after lost response');await delay(2200);assert.equal((await jobs()).filter(row=>row.request===lostRequest).length,1);assert.equal(posts.filter(post=>post.path==='/api/chat'&&post.body.text===lostRequest).length,1);
 assert((await page.locator('.request-recovery').innerText()).includes('may have started'));await snap('unconfirmed-after',page.locator('.request-recovery'));await page.unroute('**/api/chat');
 await input().fill('');const dismiss=page.getByRole('button',{name:'Dismiss notice',exact:true});await dismiss.tap();await closeComposer();
 // Late native reply failure must preserve a newer draft and its kept snapshot.
 let release;const gate=new Promise(resolve=>release=resolve);let held=false;
 await page.route('**/api/answer-stream',async route=>{held=true;await gate;await route.continue();});
 const failedReply='Explain why this local first-use request cannot run yet.';await send(failedReply);await until(()=>held,'held real reply request');await input().fill('A newer draft typed while the older reply is pending.');release();
 await until(async()=>await page.locator('.request-recovery').isVisible(),'late reply failure');assert.equal(await input().inputValue(),'A newer draft typed while the older reply is pending.');assert((await page.locator('.request-recovery pre').textContent()).includes(failedReply));await page.unroute('**/api/answer-stream');
 await input().fill('');await page.getByRole('button',{name:'Edit unconfirmed message',exact:true}).tap();await until(async()=>await input().inputValue()===failedReply,'kept failed text recoverable');assert.equal(posts.filter(post=>post.path==='/api/answer-stream'&&post.body.text===failedReply).length,1);
 await input().fill('');await page.getByRole('button',{name:'Dismiss notice',exact:true}).tap();await closeComposer();
 for(const [command,selector]of[['show goals','.goal-panel'],['show software work','.software-panel'],['show work','.work-journal']]){await send(command);await until(()=>page.locator(selector).isVisible(),command);await closeComposer();}
 assert.equal(posts.filter(post=>post.path==='/api/speech-stream').length,0,'Typed path invoked TTS');assert.deepEqual(errors,[]);
 const finalStatus=await get('/api/status');assert.equal(finalStatus.model.ready,false);
 await writeFile(data+'/lifecycle.json',JSON.stringify({fixture:'Ordinary production server with actual absent native model/voice. No provider/voice response mocking. Two additional cases control only browser request/response delivery and are explicitly recorded.',sourceBase:'5dd2008e6a9ff1072dc2e6ea28de09e76b2b70f8',status:finalStatus,original,retry,oldRecordAndActivityUnchanged:true,alternateProjectRevision:0,exactMultilineAndSuffixRetained:true,conflictingNewerDraftPreserved:true,onlyExplicitRetryPost:true,retryContext:retryPost.body,lostAcceptance:{record:lost,serverRows:1,posts:1,automaticReplay:false},lateReply:{request:failedReply,newerDraftPreserved:true,keptSnapshotRecovered:true,automaticReplay:false},typedVoiceStreamPosts:0,allThreeWindowsAccessible:true,mobileTapWithoutShortcut:true,keyboardHeightViewport:[360,420],readiness:{model:await readiness.getAttribute('data-readiness-model'),voice:await readiness.getAttribute('data-readiness-voice')},pageErrors:errors,posts},null,2));
 console.log('Passed: visible phone typing, truthful native readiness/setup/recheck, exact multiline Work recovery, reviewed distinct retry/original target, old record/history preservation, lost acceptance without replay, late error/newer draft safety, and correct work windows.');console.log('Native evidence:',data);
}catch(error){if(browser)for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:data+'/failure.png'}).catch(()=>{});throw error;}
finally{await browser?.close();if(host&&host.exitCode===null&&host.signalCode===null){const closed=new Promise(resolve=>host.once('exit',resolve));host.kill('SIGTERM');await closed;}log.end();}
