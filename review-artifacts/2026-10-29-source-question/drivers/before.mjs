import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire('/workspace/anascummis/apps/studio/package.json');
const {chromium}=require('playwright-core');
const output='/workspace/.cloud-env/anascummis/source-question/before';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true,reducedMotion:'reduce'});
 await page.goto('http://127.0.0.1:3211',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Type a message',exact:true}).tap();
 await page.getByRole('textbox',{name:'Message Anascummis'}).fill('show goals');
 await page.getByRole('button',{name:'Send message'}).tap();
 await page.getByRole('region',{name:'Coordinated goals'}).waitFor();
 await page.screenshot({path:output+'/goals-before-desktop.png'});
 await page.setViewportSize({width:360,height:800});
 await page.screenshot({path:output+'/goals-before-narrow.png'});
 await writeFile(output+'/receipt.json',JSON.stringify({fixture:'Ordinary pre-increment server/UI at 25a5379713dafc12df0e59dbc9fef130c087e5d0; no model/API mocks',status:await(await page.request.get('http://127.0.0.1:3211/api/status')).json(),text:await page.locator('.goal-panel').innerText()},null,2));
 console.log('Original Goals before screenshots saved.');
} finally {await browser.close();}
