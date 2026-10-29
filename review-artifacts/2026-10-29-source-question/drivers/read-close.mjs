import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {writeFile} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';import assert from 'node:assert/strict';
const root='/workspace/anascummis/apps/studio',scratch='/workspace/.cloud-env/anascummis/source-question',require=createRequire(root+'/package.json'),{chromium}=require('playwright-core'),base='http://127.0.0.1:3213',label=process.argv[2]||'before';
const env={...process.env,STUDIO_PORT:'3213',STUDIO_DATA:scratch+'/evidence-sgJ6lY',STUDIO_DEV:'0'};delete env.MODEL_URL;
const child=spawn('/workspace/.cloud-tools/node_modules/.bin/bun',['core/server.ts'],{cwd:root,env,stdio:'ignore'});let browser,page;
const receipt={label,fixture:'Real saved-source API and ordinary server; one protected saved-text GET response is deliberately delayed in the browser. No public refetch or model fixture.',outcome:'pending'};
try {
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/status')).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});page=await browser.newPage({viewport:{width:360,height:800},hasTouch:true,reducedMotion:'reduce'});await page.goto(base,{waitUntil:'networkidle'});
 const source=page.getByRole('article',{name:'Saved source source-1',exact:true});await source.getByRole('button',{name:'Inspect saved text',exact:true}).tap();await source.getByRole('button',{name:'Close saved text',exact:true}).waitFor();
 let release,held;const pending=new Promise(resolve=>{held=resolve;});
 await page.route('**/sources/*?offset=1000',async route=>{const response=await route.fetch();held();await new Promise(resolve=>{release=resolve;});try{await route.fulfill({response});}catch(error){receipt.routeDelivery=String(error);}});
 await source.getByRole('button',{name:'Next text',exact:true}).tap();await pending;await source.getByRole('button',{name:'Close saved text',exact:true}).tap();
 assert.equal(await source.locator('pre').count(),0);release();await delay(300);
 receipt.reopened=await source.locator('pre').count()>0;await page.screenshot({path:scratch+'/read-close-'+label+'.png'});
 assert.equal(receipt.reopened,false,'A late saved-text response must not reopen a closed reader.');
 await source.getByRole('button',{name:'Inspect saved text',exact:true}).tap();await source.locator('pre').waitFor();assert((await source.locator('pre').innerText()).startsWith('This repository hosts'));receipt.manualReopenWorks=true;receipt.outcome='passed';console.log('PASS close during pending saved-text read.');
}catch(error){receipt.error=String(error);receipt.outcome='failed';console.error(error);process.exitCode=1;}
finally {await writeFile(scratch+'/read-close-'+label+'.json',JSON.stringify(receipt,null,2));await browser?.close();if(child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}}
