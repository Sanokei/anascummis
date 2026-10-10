import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {ROOT,DATA,getProject,asset,listAssets} from './storage';
import {renderSite,checkSite} from './site';
const wrangler=join(ROOT,'node_modules','wrangler','bin','wrangler.js');
export async function cloudflareCommand(action:'login'|'whoami'|'deploy',project?:string){
  if(!(await Bun.file(wrangler).exists()))throw new Error('Install the studio dependencies first');
  let args:string[],cwd=ROOT;
  if(action==='deploy'){
    if(!project)throw new Error('Choose a website');const p=getProject(project),checks=checkSite(p.site,listAssets().map(a=>a.id));if(!checks.ok)throw new Error(checks.errors.join('; '));
    cwd=join(DATA,'exports',`site-${p.id}-v${p.revision}`);await mkdir(join(cwd,'public','assets'),{recursive:true});
    const imageIds=[...new Set(p.site.sections.flatMap(s=>s.imageId?[s.imageId]:[]))];
    for(const id of imageIds)await Bun.write(join(cwd,'public','assets',id),Bun.file(asset(id).path));
    if(p.site.scene.length){const runtime=Bun.file(join(ROOT,'public','scene.js'));if(!(await runtime.exists()))throw new Error('Build the bundled 3D runtime first');await Bun.write(join(cwd,'public','scene.js'),runtime);}
    await Bun.write(join(cwd,'public','index.html'),renderSite(p.site,undefined,p.site.scene.length?'scene.js':undefined));
    await Bun.write(join(cwd,'wrangler.jsonc'),JSON.stringify({name:`anascummis-${p.id.slice(0,8)}`,compatibility_date:'2026-10-07',workers_dev:true,assets:{directory:'./public'}},null,2));
    args=['deploy','--config',join(cwd,'wrangler.jsonc')];
  }else args=[action];
  // Fixed executable and argument arrays. No model-authored shell text.
  const proc=Bun.spawn([process.execPath,wrangler,...args],{cwd,stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>proc.kill(),180000);
  try{const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);if(code)throw new Error((err||out).slice(-1500));return {action,output:out.slice(-3000),...(project?{revision:getProject(project).revision}:{})};}finally{clearTimeout(timer);}
}
