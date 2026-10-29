import {test,expect} from 'bun:test';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const executable=process.env.STUDIO_BROWSER_EXE||process.env.STUDIO_CHROME||['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browserTest=executable&&existsSync(executable)?test:test.skip;

browserTest('collection QA ignores Next-style shadow announcements but still rejects its own reported storage error',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'software-alert-qa-')),worker=resolve(import.meta.dir,'../worker/software-browser.mjs');
 const contract={kind:'collection',heading:'My Tasks',inputLabel:'New task',addButton:'Add',removeButton:'Remove',listLabel:'Tasks',storage:'localStorage',storageKey:'anascummis.collection.alert-qa',maxItems:100,maxTextLength:200};
 await Bun.write(join(folder,'contract.json'),JSON.stringify(contract));
 try{
  for(const ownError of [false,true]){
   // A small functioning collection isolates the host selector from framework internals.
   // Its outside announcer matches the installed Next app-router-announcer structure.
   const html=`<!doctype html><html><head><meta charset="utf-8"></head><body><main><section aria-label="Task collection"><h1>My Tasks</h1><form><label for="draft">New task</label><input id="draft"><button type="submit">Add</button></form><ul aria-label="Tasks"></ul>${ownError?'<p role="alert">StorageError: changes could not be saved in this browser.</p>':''}</section></main><script>
    const key=${JSON.stringify(contract.storageKey)},list=document.querySelector('ul'),input=document.querySelector('input');
    let items=JSON.parse(localStorage.getItem(key)||'{"items":[]}').items;
    function save(){localStorage.setItem(key,JSON.stringify({version:1,items}));render();}
    function render(){list.replaceChildren();for(const item of items){const row=document.createElement('li'),text=document.createElement('span'),remove=document.createElement('button');text.textContent=item.text;remove.type='button';remove.textContent='Remove';remove.onclick=()=>{items=items.filter(saved=>saved.id!==item.id);save();};row.append(text,remove);list.append(row);}}
    document.querySelector('form').onsubmit=event=>{event.preventDefault();const text=input.value.trim();if(!text)return;items.push({id:crypto.randomUUID(),text});save();input.value='';};render();
    const container=document.createElement('next-route-announcer'),announcer=document.createElement('div');announcer.ariaLive='assertive';announcer.id='__next-route-announcer__';announcer.role='alert';announcer.style.cssText='position:absolute;border:0;height:1px;margin:-1px;padding:0;width:1px;clip:rect(0 0 0 0);overflow:hidden;white-space:nowrap';container.attachShadow({mode:'open'}).append(announcer);document.body.append(container);
   </script></body></html>`;
   const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})}),name=ownError?'own-storage-error':'framework-announcer';
   const child=Bun.spawn([Bun.which('node')!,worker,'http://127.0.0.1:'+server.port,join(folder,name+'.png'),join(folder,name+'.json'),join(folder,'contract.json')],{env:{...process.env,STUDIO_BROWSER_EXE:executable!},stdout:'pipe',stderr:'pipe'});
   try{
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    const report=await Bun.file(join(folder,name+'.json')).json();
    expect(report.dom).toContain('Keep this task');expect(report.dom).toContain('Added after reload');
    if(ownError){expect(code).not.toBe(0);expect(report.errors).toEqual(['The application reported a persistence failure during collection acceptance: StorageError: changes could not be saved in this browser.']);expect(stderr).toContain('StorageError');}
    else{expect(code).toBe(0);expect(report.errors).toEqual([]);expect(report.behavior).toContain('collection acceptance passed');expect(stdout).toContain('Actual browser loaded');}
   }finally{if(child.exitCode===null)child.kill();await server.stop(true);}
  }
 }finally{await rm(folder,{recursive:true,force:true});}
},30000);
