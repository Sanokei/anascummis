import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createWriteStream} from 'node:fs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json'),{chromium}=require('playwright-core');
const data=await mkdtemp('/workspace/.cloud-env/anascummis/first-use/partial-'),base='http://127.0.0.1:3211',log=createWriteStream(data+'/server.log');
let mode='fail-after-write',title='Retained After Provider Failure',projectId,observedFailureRevision,host,browser;
const modelCalls=[],posts=[],errors=[];
async function get(path){const response=await fetch(base+path);assert(response.ok,path+':'+response.status);return response.json();}
async function until(check,label,timeout=30000){const end=Date.now()+timeout;do{const x=await check();if(x)return x;await delay(100);}while(Date.now()<end);throw Error('Timed out '+label+'; '+data);}
async function rows(){const x=await get('/api/jobs?limit=100');return [...x.active,...x.history];}
// Test-only provider. It intentionally fails AFTER a measured real host write.
const model=createServer(async(req,res)=>{
 try{
  if(mode==='fail-after-write'&&projectId){const saved=await get('/api/projects/'+projectId);if(saved.revision>=1){observedFailureRevision=saved.revision;mode='unavailable';}}
  modelCalls.push({path:req.url,mode});res.setHeader('Content-Type','application/json');
  if(mode==='unavailable'){res.statusCode=503;res.end(JSON.stringify({error:'Deliberate provider failure after host mutation'}));return;}
  if(req.url==='/health'){res.end('{}');return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:[1,2,3]}));return;}
  const body=JSON.parse(raw),schema=body.response_format.json_schema.schema,packet=JSON.parse(body.messages[1].content.replace(/\n\/no_think$/,''));let value;
  if(schema.properties.index){const finish=packet.choices.find(choice=>choice.action.startsWith('All requested actions')),write=packet.choices.find(choice=>/\bset_copy\b/.test(choice.action));value={index:packet.completed?.length&&finish?finish.index:write?.index??0,message:packet.completed?.length?'Done.':''};}
  else if(schema.properties.agent)value={agent:'website',task:mode==='fail-after-write'?'Update the website title and subtitle from the requested copy.':'Set website title to '+title,inputs:[]};
  else if(schema.properties.field)value={field:'title',value:schema.properties.value.enum?.[0]||title};
  else throw Error('Unexpected scripted schema '+JSON.stringify(schema));
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
 }catch(error){console.error('Scripted provider error:',String(error));res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
try{
 host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['core/server.ts'],{cwd:'/workspace/anascummis/apps/studio',env:{...process.env,STUDIO_DATA:data,STUDIO_DEV:'0',STUDIO_PORT:'3211',MODEL_URL:'http://127.0.0.1:'+model.address().port},stdio:['ignore','pipe','pipe']});let booted=false;host.stdout.on('data',chunk=>{if(chunk.toString().includes('Anascummis Studio:'))booted=true;});host.stdout.pipe(log,{end:false});host.stderr.pipe(log,{end:false});
 await Promise.race([until(async()=>{if(!booted)return false;try{return(await get('/api/status')).model.ready;}catch{return false;}},'scripted provider server startup'),new Promise((_,reject)=>host.once('exit',code=>reject(Error('Host exited '+code))))]);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Etc/UTC',reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/chat')posts.push(request.postDataJSON());});
 const input=()=>page.getByRole('textbox',{name:'Message Anascummis'});
 async function send(text){await page.getByRole('button',{name:'Type a message',exact:true}).click();await input().fill(text);await page.getByRole('button',{name:'Send message',exact:true}).click();}
 async function closeComposer(){const close=page.getByRole('button',{name:'Close text input',exact:true});if(await close.isVisible())await close.click();}
 async function snap(label,card){for(const [name,width,height]of[['desktop',1440,1000],['narrow',360,800]]){await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));if(card)await card.scrollIntoViewIfNeeded();await page.screenshot({path:data+'/'+label+'-'+name+'.png'});}await page.setViewportSize({width:1440,height:1000});}
 await page.goto(base,{waitUntil:'networkidle'});projectId=(await get('/api/projects'))[0].id;
 const request='Update the website title and subtitle. Set title to '+title+', then set subtitle to Pending after title.';
 await send(request);
 const first=await until(async()=> (await rows()).find(row=>row.request===request&&row.status!=='running'),'saved outcome after actual host write');
 assert.equal(observedFailureRevision,1);const retained=await get('/api/projects/'+projectId);assert.equal(retained.revision,1);assert.equal(retained.site.title,title);assert(first.status!=='complete'||first.outcome!=='finished','Provider failure must not become successful completion');
 await closeComposer();const work=page.getByRole('region',{name:'Work history',exact:true}),card=work.locator('article').filter({has:page.getByText(request,{exact:true})});await card.getByRole('button',{name:'Edit saved request',exact:true}).waitFor();await snap('partial-failure',card.getByRole('button',{name:'Edit saved request',exact:true}));
 const firstActivity=await get('/api/jobs/'+first.id+'/activity?limit=100');
 await until(async()=>await page.locator('.presence>.local-readiness').getAttribute('data-readiness-model')==='unavailable','automatic readiness update after provider failure');
 const readinessBeforeManualCheck=await page.locator('.presence>.local-readiness').getAttribute('data-readiness-model');
 // Restore a different selected workspace before editing this saved request.
 const headers={Origin:base,'X-Requested-With':'Anascummis'},response=await page.request.post(base+'/api/projects',{headers,data:{name:'Unrelated partial-run project'}});assert(response.ok());const unrelated=await response.json();
 await page.reload({waitUntil:'networkidle'});await send('show work');await closeComposer();
 const oldCard=page.getByRole('region',{name:'Work history',exact:true}).locator('article').filter({has:page.getByText(request,{exact:true})});await oldCard.getByRole('button',{name:'Edit saved request',exact:true}).click();await until(async()=>await input().inputValue()===request,'saved partial-run request');
 assert.equal(posts.length,1);assert.equal((await get('/api/projects/'+projectId)).revision,1,'Editing replayed the write');assert.deepEqual((await rows()).find(row=>row.id===first.id),first);
 title='Explicit Retry Verified';mode='ready';
 const edited='Set website title to '+title;
 const readiness=page.locator('.presence>.local-readiness');await readiness.getByRole('button',{name:'Check again',exact:true}).click();await until(async()=>await readiness.getAttribute('data-readiness-model')==='ready','explicit fixture readiness recovery');
 await input().fill(edited);await page.getByRole('button',{name:'Send message',exact:true}).click();
 const second=await until(async()=> (await rows()).find(row=>row.request===edited&&row.status==='complete'&&row.outcome==='finished'),'explicit new verified attempt');assert.notEqual(second.id,first.id);assert.equal(second.projectId,projectId);assert.equal(posts.length,2);assert.equal(posts[1].project,projectId);assert.equal((await get('/api/projects/'+unrelated.id)).revision,0);
 const final=await get('/api/projects/'+projectId);assert.equal(final.revision,2);assert.equal(final.site.title,title);assert.deepEqual((await rows()).find(row=>row.id===first.id),first);assert.deepEqual(await get('/api/jobs/'+first.id+'/activity?limit=100'),firstActivity);
 await closeComposer();await send('show work');await closeComposer();const secondCard=page.getByRole('region',{name:'Work history',exact:true}).locator('article').filter({has:page.getByText(edited,{exact:true})});await secondCard.getByText('Done',{exact:true}).waitFor();await snap('explicit-retry-success',secondCard);
 await secondCard.getByRole('button',{name:'Open website',exact:true}).click();await page.frameLocator('iframe[title="Website preview"]').getByText(title,{exact:true}).first().waitFor();await snap('verified-output',page.locator('iframe[title="Website preview"]'));
 assert.deepEqual(errors,[]);
 await writeFile(data+'/lifecycle.json',JSON.stringify({fixture:'Scripted loopback inference with actual source mutation, provider503 after measured revision1, real persistence/context restoration and explicit verified new attempt. Native Qwen/voice not established; no speech mocking.',first,second,observedFailureRevision,retainedTitle:retained.site.title,finalRevision:final.revision,finalTitle:final.site.title,oldRecordAndActivityUnchanged:true,unrelatedProjectRevision:0,posts,readinessAfterFailureBeforeManualCheck:readinessBeforeManualCheck,modelCalls,pageErrors:errors},null,2));
 console.log('Passed: real host write followed by provider failure, preserved partial result/history, no replay from Edit, restored original target, explicit distinct new verified run and actual website output.');console.log('Supplemental evidence:',data);
}catch(error){if(browser)for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:data+'/failure.png'}).catch(()=>{});throw error;}
finally{await browser?.close();if(host&&host.exitCode===null&&host.signalCode===null){const stopped=new Promise(resolve=>host.once('exit',resolve));host.kill('SIGTERM');await stopped;}model.closeAllConnections();await new Promise(resolve=>model.close(resolve));log.end();}
