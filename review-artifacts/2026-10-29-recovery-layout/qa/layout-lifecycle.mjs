import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createWriteStream} from 'node:fs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json'),{chromium}=require('playwright-core');
const phase=process.argv[2];assert(['before','after'].includes(phase));const layoutChecks=[];
const data=await mkdtemp('/workspace/.cloud-env/anascummis/recovery-layout/'+phase+'-'),base='http://127.0.0.1:3212',log=createWriteStream(data+'/server.log');
let host,browser;
async function until(check,label,timeout=30000){const end=Date.now()+timeout;do{const value=await check();if(value)return value;await delay(100);}while(Date.now()<end);throw Error('Timed out '+label+'; evidence '+data);}
async function get(path){const response=await fetch(base+path);assert(response.ok,path+':'+response.status);return response.json();}
async function jobs(){const page=await get('/api/jobs?limit=100');return [...page.active,...page.history];}
const errors=[],posts=[],mutations=[];
try{
 const env={...process.env,STUDIO_DATA:data,STUDIO_DEV:'0',STUDIO_PORT:'3212'};delete env.MODEL_URL;
 host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['core/server.ts'],{cwd:'/workspace/anascummis/apps/studio',env,stdio:['ignore','pipe','pipe']});let booted=false;host.stdout.on('data',chunk=>{if(chunk.toString().includes('Anascummis Studio:'))booted=true;});host.stdout.pipe(log,{end:false});host.stderr.pipe(log,{end:false});
 await Promise.race([until(async()=>{if(!booted)return false;try{return(await get('/api/status')).runtime==='local';}catch{return false;}},'normal server'),new Promise((_,reject)=>host.once('exit',code=>reject(Error('Host exited '+code))))]);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 const page=await browser.newPage({viewport:{width:360,height:800},isMobile:true,hasTouch:true,timezoneId:'Etc/UTC',reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(request.method()==='POST')mutations.push(url.pathname);if(request.method()==='POST'&&['/api/chat','/api/goals','/api/software','/api/answer-stream','/api/speech-stream'].includes(url.pathname))posts.push({path:url.pathname,body:request.postDataJSON()});});
 const input=()=>page.getByRole('textbox',{name:'Message Anascummis'}),work=()=>page.getByRole('region',{name:'Work history',exact:true});
 async function type(text){await page.getByRole('button',{name:'Type a message',exact:true}).tap();await input().fill(text);}
 async function send(text){await type(text);await page.getByRole('button',{name:'Send message',exact:true}).tap();}
 async function closeComposer(){const close=page.getByRole('button',{name:'Close text input',exact:true});if(await close.isVisible())await close.tap();}
 async function snap(label,focus){
  for(const [name,width,height]of[['desktop',1440,1000],['narrow',360,800]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(focus)await focus.scrollIntoViewIfNeeded();await delay(350);await page.screenshot({path:data+'/'+label+'-'+name+'.png'});
  }
  await page.setViewportSize({width:360,height:800});
 }

 async function layoutCapture(state){
  for(const height of [800,420]){
   await page.setViewportSize({width:360,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const beforePosts=posts.length,beforeMutations=mutations.length,beforePageScroll=await page.evaluate(()=>scrollY),kept=await input().inputValue();
   if(phase==='before'){
    await input().tap();await delay(350);await page.screenshot({path:data+'/'+state+'-before-360x'+height+'.png'});
    layoutChecks.push({state,height,groupedNotice:await page.locator('.typed-entry .request-recovery').count(),composerOpaque:await page.locator('.typed-entry').evaluate(node=>getComputedStyle(node).backgroundColor),fixture:'ordinary production before source; no API/provider/voice mocks except lost acknowledgement delivery'});continue;
   }
   const panel=page.getByRole('form',{name:'Message composer',exact:true}),scroll=panel.locator('.composer-scroll');
   await panel.waitFor();assert.equal(await work().isVisible(),true);
   await scroll.evaluate(node=>node.scrollTop=0);await input().tap();assert(await input().evaluate(node=>node===document.activeElement));await input().fill('Keyboard line');await page.keyboard.press('Enter');assert.equal(await input().inputValue(),'Keyboard line\n');assert.equal(mutations.length,beforeMutations);await input().fill(kept);
   const metrics=await panel.evaluate(node=>{
    const box=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom}};
    const vv=window.visualViewport,body=node.querySelector('.composer-scroll');
    const result={panel:box(node),viewport:{top:vv?.offsetTop||0,left:vv?.offsetLeft||0,width:vv?.width||innerWidth,height:vv?.height||innerHeight},background:getComputedStyle(node).backgroundColor,bodyOverflow:getComputedStyle(body).overflowY,bodyClientHeight:body.clientHeight,bodyScrollHeight:body.scrollHeight,bodyScrollTop:body.scrollTop,allPartsOwned:['.text-composer','.composer-hint','.request-context'].every(selector=>!!body.querySelector(selector)),workOpen:!!document.querySelector('.work-journal'),workInside:!!node.querySelector('.work-journal'),horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
    result.controls=[...node.querySelectorAll('.composer-header button,.composer-actions button')].map(button=>{const b=button.getBoundingClientRect(),top=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {label:button.getAttribute('aria-label')||button.textContent,box:box(button),hit:top===button||button.contains(top)}});return result;
   });
   assert(metrics.panel.x>=metrics.viewport.left-1);assert(metrics.panel.bottom<=metrics.viewport.top+metrics.viewport.height+1);assert(metrics.panel.y>=metrics.viewport.top-1);assert(metrics.panel.x+metrics.panel.width<=metrics.viewport.left+metrics.viewport.width+1);assert.equal(metrics.background,'rgb(255, 255, 255)');assert.equal(metrics.allPartsOwned,true);assert.equal(metrics.workInside,false);assert.equal(metrics.horizontalOverflow,false);assert.equal(metrics.bodyOverflow,'auto');
   for(const control of metrics.controls){assert(control.hit,control.label+' is obscured');assert(control.box.y>=metrics.viewport.top&&control.box.bottom<=metrics.viewport.top+metrics.viewport.height+1,control.label+' outside visible viewport');}
   if(state==='unconfirmed')assert.equal(await panel.locator('.request-recovery').count(),1);
   await delay(350);await page.screenshot({path:data+'/'+state+'-after-360x'+height+'-message.png'});
   const research=panel.getByRole('checkbox',{name:'Allow public web research for this new request'});await research.scrollIntoViewIfNeeded();await research.tap();assert.equal(await research.isChecked(),true);await research.tap();assert.equal(await research.isChecked(),false);await research.focus();await page.keyboard.press('Space');assert.equal(await research.isChecked(),true);await page.keyboard.press('Space');assert.equal(await research.isChecked(),false);await page.keyboard.press('Enter');await delay(50);assert.equal(mutations.length,beforeMutations,'Enter on research must not submit the request');
   await delay(350);await page.screenshot({path:data+'/'+state+'-after-360x'+height+'-context.png'});
   if(state==='unconfirmed'){
    await scroll.evaluate(body=>{const notice=body.querySelector('.request-recovery');body.scrollTop+=notice.getBoundingClientRect().top-body.getBoundingClientRect().top-12;});await delay(350);await page.screenshot({path:data+'/'+state+'-after-360x'+height+'-warning.png'});
    const details=panel.locator('.request-recovery details');await details.locator('summary').scrollIntoViewIfNeeded();await details.locator('summary').tap();assert((await details.locator('pre').textContent()).includes('Lost Acknowledgement Probe'));
    const edit=panel.getByRole('button',{name:'Edit unconfirmed message',exact:true});await edit.scrollIntoViewIfNeeded();await edit.tap();assert.equal(await input().inputValue(),kept);
    await until(async()=>!await edit.isDisabled(),'edit finished staging');await scroll.evaluate(node=>node.scrollTop=node.scrollHeight);await delay(350);await page.screenshot({path:data+'/'+state+'-after-360x'+height+'-notice.png'});
    const dismiss=panel.getByRole('button',{name:'Dismiss notice',exact:true});await dismiss.scrollIntoViewIfNeeded();await dismiss.focus();assert(await dismiss.evaluate(node=>node===document.activeElement));
    await details.locator('summary').click();
   }
   // Tab from the textarea reaches context/actions; native scrolling must keep focused controls inside the visible body.
   await input().focus();const tabLabels=[];
   for(let i=0;i<12;i++){
    await page.keyboard.press('Tab');const f=await panel.evaluate(node=>{const a=document.activeElement,b=a?.getBoundingClientRect(),body=node.querySelector('.composer-scroll').getBoundingClientRect();return {owned:node.contains(a),label:a?.getAttribute('aria-label')||a?.textContent?.trim()||a?.tagName,tag:a?.tagName,insideBody:node.querySelector('.composer-scroll').contains(a),y:b?.y,bottom:b?.bottom,bodyTop:body.top,bodyBottom:body.bottom}});
    assert(f.owned,'Tab left the composer before Send');if(f.insideBody)assert(f.y>=f.bodyTop-1&&f.bottom<=f.bodyBottom+1,'focused field/action clipped: '+f.label);tabLabels.push(f.label);if(f.label==='Send message')break;
   }
   assert(tabLabels.includes('Send message'));assert(tabLabels.some(label=>label==='Inspect saved work'));assert.equal(await page.evaluate(()=>scrollY),beforePageScroll,'context scrolling escaped to the page');await page.keyboard.press('Tab');await panel.waitFor({state:'hidden'});assert.notEqual(await page.evaluate(()=>document.activeElement?.tagName),'BODY');await page.getByRole('button',{name:'Type a message',exact:true}).tap();assert.equal(await input().inputValue(),kept);
   await panel.getByRole('button',{name:'Close text input',exact:true}).tap();await panel.waitFor({state:'hidden'});await until(async()=>await page.getByRole('button',{name:'Type a message',exact:true}).evaluate(node=>node===document.activeElement),'focus returned to typing entry');
   await page.getByRole('button',{name:'Type a message',exact:true}).tap();assert.equal(await input().inputValue(),kept);await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await until(async()=>await page.getByRole('button',{name:'Type a message',exact:true}).evaluate(node=>node===document.activeElement),'focus returned to typing entry');
   await page.getByRole('button',{name:'Type a message',exact:true}).tap();await panel.getByRole('button',{name:'Inspect saved work',exact:true}).tap();await panel.waitFor({state:'hidden'});await until(async()=>await work().evaluate(node=>node===document.activeElement||node.contains(document.activeElement)),'inspection focused Work');
   await delay(350);await page.screenshot({path:data+'/'+state+'-after-360x'+height+'-inspected-work.png'});
   await page.getByRole('button',{name:'Type a message',exact:true}).tap();assert.equal(await input().inputValue(),kept);assert.equal(posts.length,beforePosts,'scroll/edit/close/reopen/inspect/keyboard created a task');assert.equal(mutations.length,beforeMutations,'closing or inspection mutated server state');
   layoutChecks.push({state,height,...metrics,tabLabels,tabExitClosedEditor:true,closeFocusReturned:true,escapeFocusReturned:true,inspectFocusedWork:true,draftSurvivedClose:true,automaticPosts:0,researchOptInDefaultOff:true,scrollingDoesNotExposeWork:true});
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
 await readiness.getByRole('button',{name:'Setup instructions',exact:true}).tap();const dialog=page.getByRole('dialog');await dialog.waitFor();assert((await dialog.innerText()).includes('bun run model:start'));await delay(350);await page.screenshot({path:data+'/setup-after-narrow.png'});await page.getByRole('button',{name:'Close download instructions'}).tap();
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
 await layoutCapture('recovered');await snap('recovered-draft-after',input());
 await page.setViewportSize({width:360,height:420});await input().tap();assert(await input().evaluate(node=>node===document.activeElement));await delay(350);await page.screenshot({path:data+'/composer-keyboard-viewport-after.png'});await page.setViewportSize({width:360,height:800});
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
 assert((await page.locator('.request-recovery').innerText()).includes('may have started'));await layoutCapture('unconfirmed');await snap('unconfirmed-after',page.locator('.request-recovery'));await page.unroute('**/api/chat');
 await input().fill('');const dismiss=page.getByRole('button',{name:'Dismiss notice',exact:true});await dismiss.tap();await closeComposer();
 // Late native reply failure must preserve a newer draft and its kept snapshot.
 let release;const gate=new Promise(resolve=>release=resolve);let held=false;
 await page.route('**/api/answer-stream',async route=>{held=true;await gate;await route.continue();});
 const failedReply='Explain why this local first-use request cannot run yet.';await type(failedReply);await page.keyboard.press('Control+Enter');await until(()=>held,'held real reply request');await input().fill('A newer draft typed while the older reply is pending.');release();
 await until(async()=>await page.locator('.request-recovery').isVisible(),'late reply failure');assert.equal(await input().inputValue(),'A newer draft typed while the older reply is pending.');assert((await page.locator('.request-recovery pre').textContent()).includes(failedReply));await page.unroute('**/api/answer-stream');
 await input().fill('');await page.getByRole('button',{name:'Edit unconfirmed message',exact:true}).tap();await until(async()=>await input().inputValue()===failedReply,'kept failed text recoverable');assert.equal(posts.filter(post=>post.path==='/api/answer-stream'&&post.body.text===failedReply).length,1);
 await input().fill('');await page.getByRole('button',{name:'Dismiss notice',exact:true}).tap();await closeComposer();
 for(const [command,selector]of[['show goals','.goal-panel'],['show software work','.software-panel'],['show work','.work-journal']]){await send(command);await until(()=>page.locator(selector).isVisible(),command);await closeComposer();}

 if(phase==='after'){
  await page.setViewportSize({width:360,height:800});await type('Keep this layout probe draft.\nNo submit.');const mutationCount=mutations.length;
  const geometry=await page.evaluate(async()=>{
   const vv=window.visualViewport,fields=['height','width','offsetTop','offsetLeft'],original=fields.map(key=>[key,Object.getOwnPropertyDescriptor(vv,key)]),results=[];
   const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   try{
    for(const values of [{height:420,width:360,offsetTop:120,offsetLeft:0},{height:300,width:320,offsetTop:200,offsetLeft:20}]){
     for(const [key,value]of Object.entries(values))Object.defineProperty(vv,key,{configurable:true,value});vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));await wait();
     const node=document.querySelector('.composer-panel'),b=node.getBoundingClientRect();results.push({simulatedVisualViewport:values,panel:{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom},bottomOffset:node.style.getPropertyValue('--composer-bottom-offset'),rightOffset:node.style.getPropertyValue('--composer-right-offset')});
    }
   }finally{for(const [key,descriptor]of original){if(descriptor)Object.defineProperty(vv,key,descriptor);else delete vv[key];}vv.dispatchEvent(new Event('resize'));await wait();}
   return results;
  });
  for(const g of geometry){const v=g.simulatedVisualViewport,b=g.panel;assert(b.x>=v.offsetLeft&&b.x+b.width<=v.offsetLeft+v.width+1);assert(b.y>=v.offsetTop&&b.bottom<=v.offsetTop+v.height+1);}
  await closeComposer();const fallback=await page.evaluate(()=>{const saved=Object.getOwnPropertyDescriptor(window,'visualViewport');window.__layoutViewportDescriptor=saved;Object.defineProperty(window,'visualViewport',{configurable:true,value:undefined});return true;});
  try{await page.setViewportSize({width:360,height:420});await page.getByRole('button',{name:'Type a message',exact:true}).tap();await until(async()=>await page.locator('.composer-panel').evaluate(node=>node.style.getPropertyValue('--composer-viewport-height')==='420px'),'innerHeight fallback');const b=await page.locator('.composer-panel').boundingBox();assert(b.y>=0&&b.y+b.height<=420);}finally{await closeComposer();await page.evaluate(()=>{if(window.__layoutViewportDescriptor)Object.defineProperty(window,'visualViewport',window.__layoutViewportDescriptor);else delete window.visualViewport;delete window.__layoutViewportDescriptor;});}
  assert.equal(mutations.length,mutationCount);layoutChecks.push({case:'Controlled VisualViewport resize/scroll offsets and missing-API fallback; not a physical keyboard test',geometry,fallback,automaticPosts:0});
 }

 if(phase==='after'){
  for(const spec of [{text:'start goal: Explain the unavailable local AI setup.',path:'/api/goals',target:'.goal-panel'},{text:'Create a Bun Nextjs app with a counter and a heading.',path:'/api/software',target:'.software-panel'}]){
   const initialMutations=mutations.length;let accepted;
   await page.route('**'+spec.path,async route=>{if(route.request().method()!=='POST'){await route.continue();return;}const response=await route.fetch();assert(response.ok());accepted=await response.json();await route.abort('failed');});
   await send(spec.text);await until(async()=>!!accepted&&await page.locator('.request-recovery').isVisible(),'unconfirmed '+spec.path);assert.equal(await input().inputValue(),spec.text);
   const panel=page.getByRole('form',{name:'Message composer',exact:true});await panel.getByRole('button',{name:'Inspect saved work',exact:true}).tap();await panel.waitFor({state:'hidden'});const target=page.locator(spec.target);await until(async()=>await target.isVisible()&&await target.evaluate(node=>node===document.activeElement||node.contains(document.activeElement)),'inspection of '+spec.target);
   const actual=await get(spec.path+'/'+accepted.id);assert.equal(actual.id,accepted.id);await until(async()=>(await target.textContent()).includes(spec.path==='/api/goals'?'Explain the unavailable local AI setup.':spec.text),'actual accepted record appears through normal polling');
   await page.getByRole('button',{name:'Type a message',exact:true}).tap();assert.equal(await input().inputValue(),spec.text);await page.getByRole('button',{name:'Dismiss notice',exact:true}).tap();await input().fill('');await closeComposer();await page.unroute('**'+spec.path);assert.equal(mutations.length,initialMutations+1,'inspection or notice dismissal replayed '+spec.path);
   layoutChecks.push({case:'Real accepted '+spec.path+' POST with browser acknowledgement deliberately lost',acceptedId:accepted.id,target:spec.target,actualStatus:actual.status,focusedCorrectWindow:true,retainedDraft:true,explicitPosts:1,automaticReplay:false});
  }
 }
 assert.equal(posts.filter(post=>post.path==='/api/speech-stream').length,0,'Typed path invoked TTS');assert.deepEqual(errors,[]);
 const finalStatus=await get('/api/status');assert.equal(finalStatus.model.ready,false);
 await writeFile(data+'/lifecycle.json',JSON.stringify({fixture:'Ordinary production server with actual absent native model/voice. No provider/voice response mocking. Two additional cases control only browser request/response delivery and are explicitly recorded.',sourceBase:'8788f7545c5091dfaf86dc569304f77e80e66019',phase,layoutChecks,status:finalStatus,original,retry,oldRecordAndActivityUnchanged:true,alternateProjectRevision:0,exactMultilineAndSuffixRetained:true,conflictingNewerDraftPreserved:true,onlyExplicitRetryPost:true,retryContext:retryPost.body,lostAcceptance:{record:lost,serverRows:1,posts:1,automaticReplay:false},lateReply:{request:failedReply,newerDraftPreserved:true,keptSnapshotRecovered:true,automaticReplay:false},typedVoiceStreamPosts:0,allThreeWindowsAccessible:true,mobileTapWithoutShortcut:true,keyboardHeightViewport:[360,420],readiness:{model:await readiness.getAttribute('data-readiness-model'),voice:await readiness.getAttribute('data-readiness-voice')},pageErrors:errors,posts},null,2));
 console.log('Passed: visible phone typing, truthful native readiness/setup/recheck, exact multiline Work recovery, reviewed distinct retry/original target, old record/history preservation, lost acceptance without replay, late error/newer draft safety, and correct work windows.');console.log('Native evidence:',data);
}catch(error){console.error('Focused QA original failure:',error);if(browser){for(const context of browser.contexts()){for(const page of context.pages()){await delay(350);await page.screenshot({path:data+'/failure.png'}).catch(()=>{});}}}throw error;}
finally{await browser?.close();if(host&&host.exitCode===null&&host.signalCode===null){const closed=new Promise(resolve=>host.once('exit',resolve));host.kill('SIGTERM');await closed;}log.end();}
