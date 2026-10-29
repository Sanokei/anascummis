import {createHash} from 'node:crypto';
import {join,resolve,relative,sep} from 'node:path';
import {readdir,lstat,mkdir,realpath,rename,readFile} from 'node:fs/promises';
import {zip} from '../core/zip';
import type {SourceKitSummary} from '../core/source-kit-manifest';

type Origin={commit:string|null;dirty:boolean|null};
type Entry={path:string;bytes:number;sha256:string};
const roots=['app','components','core','scripts','licenses','worker','acceptance','tests'];
const names=['package.json','bun.lock','requirements.txt','LOCAL-INSTALL.md','tsconfig.core.json','tsconfig.json','next-env.d.ts','PROVENANCE.md','next.config.ts','VIDEO.md','SMALL-MODEL.md','SURFACES.md','REALTIME.md','PEERS.md','SOFTWARE.md','tsconfig.worker.json','wrangler.demo.jsonc','.env.example'];
const sha=(body:Uint8Array|string)=>createHash('sha256').update(body).digest('hex');
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value,null,2)+'\n');
const safeCode=/\.(?:ts|tsx|mjs|js|css|py|md|txt|json|yaml)$/i;
const privatePart=/^(?:\..+|node_modules|__pycache__|data|cache|(?:credentials?|secrets?|private)(?:\..*)?|models?|weights?)$/i;
const privateFile=/\.(?:pyc|pyo|sqlite(?:-wal|-shm)?|db|key|pem|gguf|onnx|safetensors|bin|part)$/i;

/** Complete public source only: no environments, local state, caches or downloaded runtimes. */
export async function createSourceKit(root:string,output=join(root,'out','opensource')){
  root=resolve(root);output=resolve(output);const files:Record<string,Uint8Array>={},inputs:string[]=[];
  async function add(base:string,path:string,prefix:string,explicit=false){
    const parts=path.split(/[\\/]/);if(!explicit&&(parts.some(p=>privatePart.test(p))||privateFile.test(path)))return;
    const full=join(base,path),info=await lstat(full);
    if(info.isSymbolicLink())throw new Error(`Source kit refuses a symbolic link: ${prefix}/${path}`);
    if(info.isDirectory()){for(const child of (await readdir(full)).sort())await add(base,join(path,child),prefix);return;}
    if(!info.isFile())throw new Error(`Source kit input is not a regular file: ${path}`);
    if(!explicit&&!safeCode.test(path)&&!/(?:^|[/\\])LICENSE$/.test(path))throw new Error(`Unsupported source-kit input: ${path}`);
    if(info.size>2*1024**2)throw new Error(`Source-kit input is too large: ${path}`);
    const key=prefix+'/'+parts.join('/');files[key]=new Uint8Array(await readFile(full));if(base===root)inputs.push(full);
  }
  for(const folder of roots)await add(root,folder,'studio');
  for(const name of names)await add(root,name,'studio',true);
  for(const name of ['public/orb-embed.jpg','public/voice-capture.js'])await add(root,name,'studio',true);
  const shared=await Bun.file(join(root,'shared','types.ts')).exists()?join(root,'shared','types.ts'):resolve(root,'../../src/shared/types.ts');
  const sharedInfo=await lstat(shared);if(!sharedInfo.isFile()||sharedInfo.isSymbolicLink())throw new Error('Shared types must be a regular source file');
  files['studio/shared/types.ts']=new Uint8Array(await readFile(shared));inputs.push(shared);
  const config=JSON.parse(new TextDecoder().decode(files['studio/tsconfig.json']));config.compilerOptions.paths={...config.compilerOptions.paths,'@shared/types':['./shared/types.ts']};files['studio/tsconfig.json']=encode(config);
  const etro=await realpath(join(root,'node_modules','etro')),dependency=await Bun.file(join(etro,'package.json')).json();
  if(dependency.version!=='0.14.1')throw new Error('Install the locked Etro0.14.1 dependency before packaging');
  for(const name of ['src','LICENSE','README.md','package.json','rollup.config.js','tsconfig.json'])await add(etro,name,'dependencies/etro',true);
  files['README.txt']=new TextEncoder().encode('Anascummis Studio local source kit.\n\nOpen studio/SOURCE-KIT.json for the exact version, source provenance and payload hashes. Start with studio/LOCAL-INSTALL.md. This is source, not a prebuilt desktop installer. Bun, Node and Python are installed separately; dependency/model downloads require connectivity. The UI can build/start before model/voice setup, and reports unavailable services honestly. No personal data, credentials, caches, installed dependencies, model weights or runtime binaries are included.\n\nEtro0.14.1 is GPL-3.0; its full corresponding source and license are in dependencies/etro. Preserve studio/licenses and the LavaSR license/source. Model and speech licenses apply to their separate downloads.\n');
  const entries:Entry[]=Object.keys(files).sort().map(path=>({path,bytes:files[path].length,sha256:sha(files[path])}));
  if(entries.length>2000||entries.reduce((n,f)=>n+f.bytes,0)>20*1024**2)throw new Error('Source kit exceeds its bounded source payload');
  let source:Origin={commit:null,dirty:null};
  const git=async(args:string[])=>{try{const p=Bun.spawn(['git','-C',root,...args],{stdout:'pipe',stderr:'ignore'});const text=await new Response(p.stdout).text();return await p.exited===0?text.trim():null;}catch{return null;}};
  const gitRoot=await git(['rev-parse','--show-toplevel']);
  if(gitRoot&&inputs.every(path=>path===gitRoot||path.startsWith(gitRoot+sep))){
    // Artifact-only commits do not relabel identical application source.
    const paths=inputs.map(path=>relative(root,path)),commit=await git(['log','-1','--format=%H','--',...paths]),status=await git(['status','--porcelain','--untracked-files=all','--',...paths]);
    if(commit&&/^[a-f0-9]{40}$/.test(commit)&&status!==null)source={commit,dirty:status.length>0};
  }else{
    // A clean extraction can retain declared source provenance without requiring Git.
    try{const prior=await Bun.file(join(root,'SOURCE-KIT.json')).json();if(prior.format===1&&JSON.stringify(prior.files)===JSON.stringify(entries)&&prior.source&&(prior.source.commit===null||/^[a-f0-9]{40}$/.test(prior.source.commit))&&[true,false,null].includes(prior.source.dirty))source=prior.source;else if(prior.source?.commit)source={commit:prior.source.commit,dirty:true};}catch{}
  }
  const pkg=JSON.parse(new TextDecoder().decode(files['studio/package.json'])),installedNext=await Bun.file(join(root,'node_modules','next','package.json')).json();
  if(installedNext.version!==pkg.dependencies.next)throw new Error('Install the locked Next.js dependency before packaging');
  const dependencies={next:installedNext.version,etro:dependency.version};
  const payload={format:1,source,dependencies,files:entries},version=sha(encode(payload));
  files['studio/SOURCE-KIT.json']=encode({...payload,version});
  const archive=zip(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0))),filename=`anascummis-studio-${version.slice(0,16)}.zip`;
  const manifest:SourceKitSummary={format:1,version,filename,sha256:sha(archive),bytes:archive.length,files:entries.length,source,dependencies};
  await mkdir(output,{recursive:true});
  async function write(name:string,body:Uint8Array|string){const temporary=join(output,name+'.part');await Bun.write(temporary,body);await rename(temporary,join(output,name));}
  await write(filename,archive);await write(filename+'.sha256',manifest.sha256+'  '+filename+'\n');
  await write('etro-GPL-3.0.txt',files['dependencies/etro/LICENSE']);
  const catalog=Object.fromEntries(Object.entries(files).filter(([path])=>/^studio\/(core|components)\/[-\w]+\.(ts|tsx)$/.test(path)).map(([path,body])=>[path.slice(7),{source:new TextDecoder().decode(body),sha256:sha(body)}]));await write('source-catalog.json',encode(catalog));
  await write('manifest.json',encode(manifest));return manifest;
}
if(import.meta.main){const manifest=await createSourceKit(resolve(import.meta.dir,'..'));console.log(`Source kit ${manifest.version.slice(0,16)}: ${manifest.filename}\nSHA-256 ${manifest.sha256}\n${manifest.files} payload files; ${manifest.bytes} bytes; source ${manifest.source.commit||'unversioned'}${manifest.source.dirty?' (working changes)':''}`);}
