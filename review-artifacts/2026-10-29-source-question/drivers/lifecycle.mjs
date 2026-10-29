import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json'),{chromium}=require('playwright-core');
const root='/workspace/anascummis/apps/studio',scratch='/workspace/.cloud-env/anascummis/source-question';
const data=await mkdtemp(scratch+'/lifecycle-'),base='http://127.0.0.1:3213',bun='/workspace/.cloud-tools/node_modules/.bin/bun';
await mkdir(data+'/screenshots');await writeFile(scratch+'/active-lifecycle-path',data+'\n');
const question='Which standards do these two repositories host?\nName each using the supplied source excerpts.';
const urls=['https://raw.githubusercontent.com/whatwg/fetch/main/README.md','https://raw.githubusercontent.com/whatwg/html/main/README.md'];
const receipt={fixture:'Ordinary production Bun host and real public fetch/SQLite/UI. Native model absent. Later scripted loopback tokenization/inference separately checks host handoff/recovery, not native readiness or answer quality.',data,question,urls,processes:[],steps:[],modelRequests:[],browserErrors:[],mutations:[],screenshots:[]};
let host,browser,page,modelMode='hold',pending=[],counter=0;
async function until(check,label){for(let i=0;i<400;i++){if(await check())return;await delay(100);}throw Error('Timed out: '+label);}
const model=createServer(async(req,res)=>{
 if(req.url==='/health'){res.setHeader('content-type','application/json');res.end('{"status":"ok","fixture":"SCRIPTED_NOT_NATIVE"}');return;}
 const chunks=[];for await(const part of req)chunks.push(part);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
 if(req.url==='/tokenize'){res.setHeader('content-type','application/json');res.end('{"tokens":[1]}');return;}
 if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
 const system=body.messages?.[0]?.content||'',raw=(body.messages?.[1]?.content||'').replace(/\n\/no_think$/,'');
 const packet=JSON.parse(raw);receipt.modelRequests.push({time:new Date().toISOString(),role:system.split('.')[0],packet,mode:modelMode});
 const answer=system.startsWith('Analysis specialist')?{response:'The supplied repositories host the Fetch Standard and the HTML Standard.',citations:packet.sources.map(source=>({id:source.id,quote:source.text.split('\n')[0].slice(0,160)})),uncertainty:'This scripted host-flow answer uses only the selected excerpts; genuine model quality is untested.'}:{accepted:true,reason:'Scripted reviewer accepts the recorded literal citations and bounded criterion; this is host-flow QA, not factual validation.'};
 const finish=()=>{if(!res.destroyed){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]}));}};
 if(modelMode==='hold'&&system.startsWith('Analysis specialist'))pending.push(finish);else finish();
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));const modelUrl='http://127.0.0.1:'+model.address().port;
async function start(scripted=false){
 const log=createWriteStream(data+'/host-'+(++counter)+'.log'),env={...process.env,STUDIO_DATA:data,STUDIO_DEV:'0',STUDIO_PORT:'3213'};
 delete env.MODEL_URL;if(scripted)env.MODEL_URL=modelUrl;
 host=spawn(bun,['core/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});const child=host;
 receipt.processes.push({pid:child.pid,startedAt:new Date().toISOString(),command:'bun core/server.ts',port:3213,scriptedModel:scripted});
 let booted=false;child.stdout.on('data',b=>{if(b.toString().includes('Anascummis Studio:'))booted=true;});child.stdout.pipe(log);child.stderr.pipe(log);child.once('exit',()=>log.end());
 await until(async()=>{if(child.exitCode!==null)throw Error('Host exited '+child.exitCode);if(!booted)return false;return (await fetch(base+'/api/status')).ok;},'host ready');
 console.log('Active ordinary host PID '+child.pid+'; scripted model='+scripted+'; data='+data);
}
async function stop(signal='SIGTERM') {if(host&&host.exitCode===null){const closed=new Promise(resolve=>host.once('exit',resolve));host.kill(signal);await closed;}}
async function get(path){const r=await page.request.get(base+path);assert(r.ok(),await r.text());return r.json();}
async function post(path,body={}){return page.evaluate(async({path,body})=>{const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'Anascummis'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{path,body});}
async function command(text){const trigger=page.getByRole('button',{name:'Type a message',exact:true});await trigger.tap();await page.getByRole('textbox',{name:'Message Anascummis'}).fill(text);await page.getByRole('button',{name:'Send message',exact:true}).tap();const close=page.getByRole('button',{name:'Close text input',exact:true});if(await close.isVisible())await close.tap();}
async function snap(name,target){if(target)await target.scrollIntoViewIfNeeded();await delay(150);await page.screenshot({path:data+'/screenshots/'+name+'.png'});receipt.screenshots.push(name+'.png');}
async function contained(){const value=await page.locator('.floating-panel-content[aria-label="Goals"]').evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,viewport:innerWidth,horizontalOverflow:node.scrollWidth>node.clientWidth+1,documentOverflow:document.documentElement.scrollWidth>innerWidth};});assert(value.x>=0&&value.right<=value.viewport+1&&!value.horizontalOverflow&&!value.documentOverflow,JSON.stringify(value));return value;}
try {
 await start();browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true,reducedMotion:'reduce',timezoneId:'Etc/UTC'});page.setDefaultTimeout(12000);
 page.on('pageerror',error=>receipt.browserErrors.push(error.message));page.on('request',req=>{const u=new URL(req.url());if(u.origin===base&&req.method()==='POST')receipt.mutations.push({path:u.pathname,time:new Date().toISOString()});});
 await page.goto(base,{waitUntil:'networkidle'});receipt.nativeStatus=await get('/api/status');assert.equal(receipt.nativeStatus.model.ready,false);
 await command('show goals');await page.locator('.goal-panel').waitFor();
 await page.getByRole('checkbox',{name:'Question from public sources',exact:true}).tap();
 await page.getByRole('textbox',{name:'Exact question',exact:true}).fill(question);await page.getByRole('textbox',{name:'Public source URLs',exact:true}).fill(urls.join('\n'));
 assert(await page.getByRole('button',{name:'Save question and read sources',exact:true}).isDisabled());
 await page.getByRole('checkbox',{name:'Allow public web research for this goal',exact:true}).focus();await page.keyboard.press('Space');
 await snap('source-question-form-desktop');await page.setViewportSize({width:360,height:800});await snap('source-question-form-narrow');await contained();
 let releaseAck,accepted,held=false;const ack=new Promise(resolve=>{accepted=resolve;});
 await page.route('**/api/goals',async route=>{if(route.request().method()!=='POST'||held){await route.continue();return;}held=true;const response=await route.fetch();accepted();await new Promise(resolve=>{releaseAck=resolve;});await route.fulfill({response});});
 await page.getByRole('button',{name:'Save question and read sources',exact:true}).tap();await ack;
 await page.getByRole('textbox',{name:'Exact question',exact:true}).fill('Keep this newer unsent question.');await page.getByRole('textbox',{name:'Public source URLs',exact:true}).fill(urls[1]);releaseAck();
 await until(async()=>!!(await get('/api/goals')).length,'saved goal');let goal=(await get('/api/goals'))[0],id=goal.id;
 await until(async()=>{goal=await get('/api/goals/'+id);return goal.status==='needs_input';},'native needs_input after real source acquisition');
 assert.equal(goal.request,question);assert.equal(goal.sources.length,2);assert.deepEqual(goal.tasks.map(t=>t.status),['verified','verified','needs_input']);assert.equal(goal.tasks[2].execution,undefined);
 await until(async()=>await page.locator('.goal-record').count()===1,'goal card');assert.equal(await page.getByRole('textbox',{name:'Exact question',exact:true}).inputValue(),'Keep this newer unsent question.');assert.equal(await page.getByRole('textbox',{name:'Public source URLs',exact:true}).inputValue(),urls[1]);
 receipt.steps.push({name:'pending-save preserves newer full question and URL drafts',result:'passed'});
 await page.locator('details.goal-create>summary').tap();
 await until(async()=>(await page.locator('.goal-record').innerText()).includes('Local AI is unavailable'),'native UI failure visible');
 await snap('native-needs-input-narrow',page.locator('.goal-record h3'));await contained();await page.setViewportSize({width:1440,height:1000});await snap('native-needs-input-desktop',page.locator('.goal-record h3'));
 const baseline=goal.sources;receipt.nativeAcquisition=goal;
 const source=page.getByRole('article',{name:'Saved source source-1',exact:true});await source.getByRole('button',{name:'Inspect saved text',exact:true}).tap();
 await source.getByRole('button',{name:'Next text',exact:true}).tap();await until(async()=>(await source.innerText()).includes('1000–2000'),'saved source second page');
 await source.locator('summary').tap();await snap('saved-source-identity-desktop',source);await page.setViewportSize({width:360,height:800});await snap('saved-source-text-narrow',source.getByRole('button',{name:'Next text',exact:true}));await contained();
 const forged=await post('/api/goals',{request:'No opt-in',project:goal.projectId,sourceQuestion:{urls:[urls[0]]}});assert.equal(forged.status,400);assert.equal((await get('/api/goals')).length,1);
 const wrongGoal=await page.request.get(base+'/api/goals/00000000-0000-4000-8000-000000000000/sources/'+baseline[0].id);assert(!wrongGoal.ok());
 const priorPosts=receipt.mutations.length;
 const closeButtons=await page.locator('.flexlayout__float_window').filter({has:page.locator('.goal-panel')}).locator('button').evaluateAll(nodes=>nodes.map(n=>({title:n.title,label:n.getAttribute('aria-label'),text:n.textContent})));receipt.goalWindowButtons=closeButtons.slice(0,5);
 await page.locator('.floating-panel-content[aria-label="Goals"]').evaluate(n=>n.scrollTop=0);
 const closeWindow=page.locator('.flexlayout__float_window').filter({has:page.locator('.goal-panel')}).locator('[title="Close"]').first();
 await closeWindow.tap();await page.locator('.goal-panel').waitFor({state:'hidden'});await command('show goals');await page.locator('.goal-record').waitFor();
 await page.reload({waitUntil:'networkidle'});await page.locator('.goal-record').waitFor();
 assert.equal(receipt.mutations.length,priorPosts,'close/reload must not replay create/resume');assert.deepEqual((await get('/api/goals/'+id)).sources,baseline);
 await page.locator('.goal-record').getByRole('button',{name:'Continue remaining work',exact:true}).tap();
 await until(async()=>{goal=await get('/api/goals/'+id);return goal.status==='needs_input'&&goal.tasks[2].attempts===2;},'explicit native retry');assert.deepEqual(goal.sources,baseline);assert.deepEqual(goal.tasks.slice(0,2).map(t=>t.attempts),[1,1]);
 receipt.nativeRetry=goal;receipt.steps.push({name:'real public source acquisition, close/reopen/reload/explicit native retry',result:'passed; identical snapshots/retrieval/hashes; acquisitions remain attempt1; native answer needs_input'});
 await command('show work');await page.locator('.work-journal').waitFor();await command('show goals');
 await snap('native-retry-work-open-narrow',page.locator('.goal-record h3'));await contained();
 // Deliberate local scripted inference begins here, with the same real goal/source records.
 await stop();await start(true);await page.reload({waitUntil:'networkidle'});await page.locator('.goal-record').waitFor();
 await page.locator('.goal-record').getByRole('button',{name:'Continue remaining work',exact:true}).tap();
 await until(async()=>pending.length>0,'scripted answer in flight');
 await page.locator('.goal-record').getByRole('button',{name:'Stop goal',exact:true}).tap();
 await until(async()=>(await get('/api/goals/'+id)).status==='cancelled','explicit stop');pending.splice(0).forEach(f=>f());await delay(150);
 goal=await get('/api/goals/'+id);assert.equal(goal.tasks[2].execution,undefined);assert.deepEqual(goal.sources,baseline);
 await snap('scripted-stopped-narrow',page.locator('.goal-record h3'));receipt.stopped=goal;
 await page.locator('.goal-record').getByRole('button',{name:'Continue remaining work',exact:true}).tap();await until(async()=>pending.length>0,'second scripted answer in flight');
 receipt.beforeHardRestart=await get('/api/goals/'+id);assert.equal(receipt.beforeHardRestart.tasks[2].status,'running');
 await stop('SIGKILL');pending.splice(0).forEach(f=>f());modelMode='answer';const modelCalls=receipt.modelRequests.length;
 await start(true);await page.reload({waitUntil:'networkidle'});await page.locator('.goal-record').waitFor();await delay(300);
 goal=await get('/api/goals/'+id);assert.equal(goal.status,'needs_input');assert.equal(goal.phase,'interrupted');assert.equal(receipt.modelRequests.length,modelCalls,'restart must not automatically replay analysis');assert.deepEqual(goal.sources,baseline);
 await snap('scripted-interrupted-narrow',page.locator('.goal-record h3'));receipt.interrupted=goal;
 await page.locator('.goal-record').getByRole('button',{name:'Continue remaining work',exact:true}).tap();
 await until(async()=>{goal=await get('/api/goals/'+id);return goal.status==='completed';},'scripted answer and acceptance completion');
 assert.deepEqual(goal.sources,baseline);assert.deepEqual(goal.tasks.slice(0,2).map(t=>t.attempts),[1,1]);
 const answer=goal.tasks[2].execution.sourceAnswer;assert.equal(answer.citations.length,2);
 for(const citation of answer.citations){const saved=await get('/api/goals/'+id+'/sources/'+citation.sourceId+'?offset=0');assert.equal(saved.text.slice(citation.offset,citation.offset+citation.quote.length),citation.quote);assert.equal(citation.textSha256,saved.source.textSha256);}
 assert(!JSON.stringify(receipt.modelRequests).includes('private-project-not-sent'));
 await until(async()=>(await page.locator('.goal-record').innerText()).includes('Completed'),'completed UI');
 await page.setViewportSize({width:1440,height:1000});await snap('scripted-accepted-answer-desktop',page.getByRole('region',{name:'Source-grounded answer'}));await page.setViewportSize({width:360,height:800});await snap('scripted-accepted-answer-narrow',page.getByRole('region',{name:'Source-grounded answer'}));await contained();
 const history=page.locator('.goal-record details.activity-history');await history.locator('summary').tap();await page.locator('.activity-history-entries').waitFor();await snap('scripted-history-narrow',history);
 receipt.completed=goal;receipt.steps.push({name:'scripted inference host flow only: stop/late response, hard restart, no automatic replay, explicit Continue, citation/acceptance/coverage',result:'passed; source acquisition attempts and snapshots unchanged'});
 assert.deepEqual(receipt.browserErrors,[]);receipt.outcome='passed';console.log('PASS source-question browser/real-fetch/persistence lifecycle: '+data);
} catch(error) {receipt.outcome='failed';receipt.error=String(error);if(page)await page.screenshot({path:data+'/failure.png'}).catch(()=>{});console.error(error);process.exitCode=1;}
finally {await writeFile(data+'/receipt.json',JSON.stringify(receipt,null,2));await browser?.close();await stop();pending.splice(0).forEach(f=>f());model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
