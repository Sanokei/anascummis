import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,join} from 'node:path';
import {strict as assert} from 'node:assert';
import {initialSite} from '../core/site';

const root=resolve(process.cwd()),assets=resolve(root,'.demo-assets'),evidence=resolve(root,'qa-evidence');
await mkdir(evidence,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url!,'http://localhost').pathname;
    if(pathname.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');
      if(pathname==='/api/projects')res.end(JSON.stringify([{id:'test'}]));
      else if(pathname==='/api/projects/test')res.end(JSON.stringify({id:'test',site:initialSite()}));
      else if(pathname==='/api/speech-stream'){res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({audio:Buffer.alloc(16000*2*30).toString('base64'),rate:16000})+'\n');}
      else res.end('[]');
      return;
    }
    const path=resolve(assets,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
    if(!path.startsWith(assets+sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
});
await new Promise<void>(r=>server.listen(18829,'127.0.0.1',r));
const origin='http://127.0.0.1:18829';
console.log('Local fixture listening');
const browser=await chromium.launch({timeout:15000,headless:true,executablePath:process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
console.log('Browser started');
const results=[];
try{
  const context=await browser.newContext();
  await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin!==origin||url.pathname.startsWith('/runtime/')?route.abort():route.continue();});
  for(const [viewport,width,height]of [['desktop',1440,900],['mobile',390,844]] as const){
    console.log('Checking '+viewport);
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>console.error('Test page error: '+error.message));await page.setViewportSize({width,height});await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('.orb-control')?.hasAttribute('disabled')===false,null,{timeout:15000});
    const trigger=page.getByRole('button',{name:'Download',exact:true}),dialog=page.getByRole('dialog'),close=page.getByRole('button',{name:'Close download instructions'});
    const bounds=(await trigger.boundingBox())!;assert.ok(bounds.y>=8&&width-bounds.x-bounds.width<40);
    for(const key of ['Space','Enter']){
      await trigger.focus();await page.keyboard.press(key);await dialog.waitFor({state:'visible'});
      const size=(await dialog.boundingBox())!;assert.ok(size.x>=0&&size.x+size.width<=width&&size.y>=0&&size.y+size.height<=height);
      await close.focus();await page.keyboard.press(key);await dialog.waitFor({state:'hidden'});
      assert.equal(await page.locator('.text-composer').count(),0);
    }
    console.log(viewport+': native Download keyboard checks passed');
    // Start a real local audio playback with deterministic silent PCM. No mic,
    // model download or personal data is used; the application's speak path runs.
    await page.locator('body').evaluate(element=>{(element as HTMLElement).tabIndex=-1;(element as HTMLElement).focus();});
    await page.keyboard.press('Space');await page.keyboard.press('Space');
    const input=page.getByRole('textbox',{name:'Message Anascummis'});await input.fill('Who are you?');await page.getByRole('button',{name:'Send message'}).click();
    console.log(viewport+': waiting for speech');
    await page.waitForFunction(()=>document.querySelector('.voice-status')?.textContent==='Speaking',null,{timeout:15000});
    assert.equal(await page.locator('.orb-control').getAttribute('aria-label'),'Stop Anascummis');
    await trigger.click();await dialog.waitFor({state:'visible'});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    assert.equal(await page.locator('.voice-status').innerText(),'Speaking');assert.equal(await page.locator('.orb-control').getAttribute('aria-label'),'Stop Anascummis');
    await trigger.click();await close.focus();await page.keyboard.press('Space');await dialog.waitFor({state:'hidden'});
    assert.equal(await page.locator('.voice-status').innerText(),'Speaking');
    await page.screenshot({path:join(evidence,viewport+'-active-speech.png')});
    await page.locator('body').evaluate(element=>{(element as HTMLElement).tabIndex=-1;(element as HTMLElement).focus();});await page.keyboard.press('Escape');
    assert.ok((await page.locator('.voice-status').innerText()).startsWith('Stopped.'));
    results.push({viewport,spaceEnterOpen:true,spaceEnterClose:true,escapePreservesActiveSpeech:true,spaceClosePreservesActiveSpeech:true,outsideEscapeStillStops:true});
    await page.close();
  }
  await writeFile(join(evidence,'download-keyboard.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{console.log('Closing browser');await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
