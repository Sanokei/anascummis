import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createWriteStream} from 'node:fs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire('/workspace/anascummis/apps/studio/package.json'),{chromium}=require('playwright-core');
const data=await mkdtemp('/workspace/.cloud-env/anascummis/first-use/pdf-context-'),base='http://127.0.0.1:3211',log=createWriteStream(data+'/server.log');let host,browser;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const make=spawnSync('/workspace/anascummis/apps/studio/.venv/bin/python',['-c',"import fitz,sys\nfor name in ['original','other']:\n d=fitz.open();p=d.new_page();p.insert_text((50,50),name+' fixture PDF target');d.save(sys.argv[1]+'/'+name+'.pdf');d.close()",data],{encoding:'utf8'});assert.equal(make.status,0,make.stderr);
async function until(check,label){const end=Date.now()+30000;do{const x=await check();if(x)return x;await delay(100);}while(Date.now()<end);throw Error('Timed out '+label+'; '+data);}
async function get(path){const response=await fetch(base+path);assert(response.ok);return response.json();}
async function rows(){const x=await get('/api/jobs?limit=100');return [...x.active,...x.history];}
const posts=[],errors=[];
try{
 const env={...process.env,STUDIO_DATA:data,STUDIO_DEV:'0',STUDIO_PORT:'3211'};delete env.MODEL_URL;
 host=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['core/server.ts'],{cwd:'/workspace/anascummis/apps/studio',env,stdio:['ignore','pipe','pipe']});let booted=false;host.stdout.on('data',chunk=>{if(chunk.toString().includes('Anascummis Studio:'))booted=true;});host.stdout.pipe(log,{end:false});host.stderr.pipe(log,{end:false});
 await Promise.race([until(async()=>{if(!booted)return false;try{return(await get('/api/status')).runtime==='local';}catch{return false;}},'ordinary PDF-context host'),new Promise((_,reject)=>host.once('exit',code=>reject(Error('Host exited '+code))))]);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Etc/UTC',reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/chat')posts.push(request.postDataJSON());});
 await page.goto(base,{waitUntil:'networkidle'});const originalProject=(await get('/api/projects'))[0],headers={Origin:base,'X-Requested-With':'Anascummis'};
 async function post(path,body){const response=await page.request.post(base+path,{headers,data:body});assert(response.ok(),path+':'+response.status());return response.json();}
 async function upload(name){const response=await page.request.post(base+'/api/documents',{headers,multipart:{file:{name:name+'.pdf',mimeType:'application/pdf',buffer:await readFile(data+'/'+name+'.pdf')}}});assert(response.ok());return response.json();}
 const originalDoc=await upload('original'),otherDoc=await upload('other'),otherProject=await post('/api/projects',{name:'Unrelated PDF project'});
 const originalText='Inspect the original attached PDF and preserve its wording.\nExact saved target marker: ORIGINAL-PDF-CONTEXT.';
 const old=await post('/api/chat',{project:originalProject.id,document:originalDoc.id,text:originalText,research:false,savedDetails:[]});
 const otherText='Inspect the other attached PDF without changing it.';const other=await post('/api/chat',{project:otherProject.id,document:otherDoc.id,text:otherText,research:false,savedDetails:[]});
 const original=await until(async()=> (await rows()).find(row=>row.id===old.jobId&&row.status!=='running'),'original PDF request failure');await until(async()=> (await rows()).some(row=>row.id===other.jobId&&row.status!=='running'),'other PDF request failure');
 const activity=await get('/api/jobs/'+original.id+'/activity?limit=100'),input=()=>page.getByRole('textbox',{name:'Message Anascummis'});
 async function send(text){await page.getByRole('button',{name:'Type a message',exact:true}).click();await input().fill(text);await page.getByRole('button',{name:'Send message',exact:true}).click();}
 async function close(){const button=page.getByRole('button',{name:'Close text input',exact:true});if(await button.isVisible())await button.click();}
 await page.reload({waitUntil:'networkidle'});await send('show work');await close();
 const work=page.getByRole('region',{name:'Work history',exact:true}),otherCard=work.locator('article').filter({has:page.getByText(otherText,{exact:true})}),oldCard=work.locator('article').filter({has:page.getByText(originalText,{exact:true})});
 await otherCard.getByRole('button',{name:'Open PDF',exact:true}).click();await send('show work');await close();
 await oldCard.getByRole('button',{name:'Edit saved request',exact:true}).click();await until(async()=>await input().inputValue()===originalText,'full original PDF request recovery');assert.equal(posts.length,0);
 const edited=originalText+'\nReviewed new PDF attempt.';await input().fill(edited);await page.getByRole('button',{name:'Send message',exact:true}).click();const retry=await until(async()=> (await rows()).find(row=>row.request===edited&&row.status!=='running'),'explicit PDF retry');
 assert.notEqual(retry.id,original.id);assert.equal(retry.projectId,originalProject.id);assert.equal(retry.documentId,originalDoc.id);assert.equal(posts.length,1);assert.equal(posts[0].project,originalProject.id);assert.equal(posts[0].document,originalDoc.id);assert.deepEqual((await rows()).find(row=>row.id===original.id),original);assert.deepEqual(await get('/api/jobs/'+original.id+'/activity?limit=100'),activity);
 await close();await otherCard.getByRole('button',{name:'Open website',exact:true}).click();await send('show work');await close();await otherCard.getByRole('button',{name:'Open PDF',exact:true}).click();await send('show work');await close();
 await page.route('**/api/documents/'+originalDoc.id,route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Original PDF unavailable in this controlled missing-context case.'})}));
 await oldCard.getByRole('button',{name:'Edit saved request',exact:true}).click();await until(async()=> (await oldCard.innerText()).includes('Nothing was sent'),'missing PDF blocks atomic restoration');assert.equal(posts.length,1);await page.unroute('**/api/documents/'+originalDoc.id);
 const contextProof='Inspect the currently selected PDF after the missing-context guard.';await send(contextProof);await until(()=>posts.length===2,'explicit context proof request');assert.equal(posts[1].project,otherProject.id);assert.equal(posts[1].document,otherDoc.id);
 const docs=[originalDoc,otherDoc];for(const doc of docs){const current=await get('/api/documents/'+doc.id);assert.equal(current.revision,doc.revision);assert.equal(hash(await readFile(data+'/documents/'+doc.id+'/'+doc.revision+'.pdf')),hash(await readFile(data+'/'+(doc.id===originalDoc.id?'original':'other')+'.pdf')));}
 assert.deepEqual(errors,[]);await writeFile(data+'/lifecycle.json',JSON.stringify({fixture:'Ordinary server, actual PyMuPDF imports/native unavailable inference; one explicitly controlled404 delivery for original-PDF metadata tests atomic failure.',status:await get('/api/status'),original,retry,originalActivityUnchanged:true,oldRecordUnchanged:true,restoredProject:originalProject.id,restoredPdf:originalDoc.id,unrelatedProject:otherProject.id,unrelatedPdf:otherDoc.id,missingPdfDidNotPartiallySwitchContext:true,pdfBytesAndRevisionsUnchanged:true,posts,pageErrors:errors},null,2));
 console.log('Passed: exact saved PDF request restored original website/PDF together, explicit new attempt, unchanged old record/history/PDF bytes, and missing PDF never partially switched the selected context.');console.log('PDF-context evidence:',data);
}catch(error){if(browser)for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:data+'/failure.png'}).catch(()=>{});throw error;}
finally{await browser?.close();if(host&&host.exitCode===null&&host.signalCode===null){const closed=new Promise(resolve=>host.once('exit',resolve));host.kill('SIGTERM');await closed;}log.end();}
