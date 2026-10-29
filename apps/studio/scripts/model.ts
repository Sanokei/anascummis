import { mkdir, rename, statfs, unlink, readdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
const root=join(import.meta.dir,'..','.runtime');
const model=join(root,'Qwen3-0.6B-Q4_0.gguf');
const mode=process.argv[2]||'start';
async function download(url:string,path:string,digest?:string){
  if(await Bun.file(path).exists())return;
  console.log(`Downloading ${url}`);
  const r=await fetch(url,{signal:AbortSignal.timeout(15*60_000)}); if(!r.ok||!r.body)throw new Error(`Download failed (${r.status})`);
  const writer=Bun.file(path+'.part').writer();
  const reader=r.body.getReader();
  try{while(true){const {value,done}=await reader.read();if(done)break;writer.write(value);await writer.flush();}await writer.end();}
  catch(e){await writer.end();await unlink(path+'.part').catch(()=>{});throw e;}
  if(digest){const h=createHash('sha256');for await(const chunk of createReadStream(path+'.part'))h.update(chunk);if(`sha256:${h.digest('hex')}`!==digest)throw new Error('Runtime checksum mismatch');}
  await rename(path+'.part',path);
}
if(mode==='setup'){
  await mkdir(root,{recursive:true});
  if(await Bun.file(model).exists()&&await Bun.file(join(root,'llama-server.exe')).exists()){console.log('CPU model and runtime are already installed.');process.exit(0);}
  const space=await statfs(root);
  if(space.bavail*space.bsize<1.5*1024**3)throw new Error('Model setup needs at least 1.5 GB free disk space for weights, runtime and extraction. Free space and retry.');
  // Official ggml-org quantization; 4-bit weights keep the CPU footprint small.
  const info=await(await fetch('https://huggingface.co/api/models/ggml-org/Qwen3-0.6B-GGUF?blobs=true')).json() as any;
  const weight=info.siblings.find((s:any)=>s.rfilename==='Qwen3-0.6B-Q4_0.gguf');
  if(!weight)throw new Error('Official model file not found');
  await download(`https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/${info.sha}/Qwen3-0.6B-Q4_0.gguf`,model,weight.lfs?.sha256?`sha256:${weight.lfs.sha256}`:undefined);
  if(process.platform==='win32'&&process.arch==='x64'){
    const releases=await(await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20')).json() as any[];
    const asset=releases.flatMap(r=>r.assets||[]).find(a=>/bin-win-cpu-x64\.zip$/.test(a.name));
    if(!asset)throw new Error('No CPU runtime release found. Install llama-server manually and set LLAMA_SERVER.');
    const zip=join(root,'llama-cpu.zip');await download(asset.browser_download_url,zip,asset.digest);
    const quoted=(s:string)=>"'"+s.replaceAll("'","''")+"'";
    const command=`Expand-Archive -LiteralPath ${quoted(zip)} -DestinationPath ${quoted(root)} -Force`;
    const p=Bun.spawn(['powershell','-NoProfile','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{stdout:'inherit',stderr:'inherit'});
    if(await p.exited)throw new Error('Runtime extraction failed');
    const executable=(await readdir(root,{recursive:true})).find(p=>p.endsWith('llama-server.exe'));
    if(!executable)throw new Error('CPU runtime archive did not contain llama-server.exe');
    const bin=dirname(join(root,executable));
    if(bin!==root)for(const name of await readdir(bin))if(/\.(exe|dll)$/i.test(name))await copyFile(join(bin,name),join(root,name));
    await Bun.write(join(root,'provenance.json'),JSON.stringify({runtime:asset.browser_download_url,digest:asset.digest,modelRevision:info.sha,model:weight.rfilename,modelDigest:weight.lfs?.sha256},null,2));
  }else console.log('Install llama.cpp for your OS and set LLAMA_SERVER to its llama-server path.');
  console.log('Model setup complete. Start with bun run model:start.');
}else{
  const exe=process.env.LLAMA_SERVER||join(root,'llama-server.exe');
  if(!(await Bun.file(exe).exists())||!(await Bun.file(model).exists()))throw new Error('Run bun run model:setup first');
  const p=Bun.spawn([exe,'-m',model,'--host','127.0.0.1','--port','8081','-ngl','0','-c','2048','-t','4','--parallel','1','--jinja','--reasoning','off','--cors-origins','localhost'],{stdout:'inherit',stderr:'inherit',cwd:root});
  process.on('SIGINT',()=>p.kill()); process.exitCode=await p.exited;
}
