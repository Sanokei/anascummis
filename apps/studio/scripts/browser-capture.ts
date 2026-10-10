// This optional adapter runs under Node: Playwright transport is unreliable under Bun 1.3 on Windows.
import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import {safeFetch} from '../core/network';
const [url,output]=process.argv.slice(2),signal=AbortSignal.timeout(45000);
const initial=await safeFetch(url,2_000_000,signal);if(initial.type!=='text/html')throw new Error('Choose a public HTML page');
const browser=await chromium.launch({headless:true,timeout:15000,...(process.env.STUDIO_BROWSER_EXE?{executablePath:process.env.STUDIO_BROWSER_EXE}:{channel:process.platform==='win32'?'msedge':'chrome'})});
const abort=()=>{void browser.close();};signal.addEventListener('abort',abort,{once:true});
try{const context=await browser.newContext({viewport:{width:1280,height:720},javaScriptEnabled:false,serviceWorkers:'block'});let requests=0,bytes=0;await context.route('**/*',async route=>{try{if(++requests>50||bytes>20_000_000)throw new Error('Screenshot resource budget reached');const r=await safeFetch(route.request().url(),2_000_000,signal);bytes+=r.bytes.length;await route.fulfill({status:200,contentType:r.type,body:Buffer.from(r.bytes)});}catch{await route.abort().catch(()=>{});}});const page=await context.newPage();await page.goto(url,{waitUntil:'load',timeout:25000});signal.throwIfAborted();const screenshot=await page.screenshot({type:'png',timeout:10000});await writeFile(output,screenshot);console.log(JSON.stringify({source:page.url(),title:await page.title(),width:1280,height:720}));}finally{signal.removeEventListener('abort',abort);await browser.close();}
