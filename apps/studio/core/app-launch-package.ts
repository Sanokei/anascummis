import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm} from 'node:fs/promises';
import type {SoftwareTask} from './software-task';
import {collectionBrowserContract,readCollectionRecipe} from './collection-screen';
import {compileNumericScreen,counterSkillEvidenceMatches,type NumericScreen} from './react-screen';

export type LaunchFileIdentity={path:string;bytes:number;sha256:string};
export type LaunchPackageManifest={
 format:'anascummis.trusted-browser-runtime.v1';id:string;taskId:string;revision:number;zipSha256:string;
 kind:'counter'|'collection';title:string;storageKey?:string;wrapperVersion:1;reactVersion:string;
 sourceFiles:LaunchFileIdentity[];files:LaunchFileIdentity[];
};
export type LaunchEligibility={supported:true;kind:'counter'|'collection';title:string;storageKey?:string;zipSha256:string;revision:number}|{supported:false;reason:string};
type KnownSource={kind:'counter'|'collection';title:string;storageKey?:string;executed:Record<string,string>};
const ROOT=resolve(import.meta.dir,'..'),DATA=resolve(process.env.STUDIO_DATA||join(ROOT,'.data'));
const BUILDS=resolve(process.env.STUDIO_TEST_DATA||DATA,'software');
const MAX_ZIP=8*1024*1024,MAX_FILE=2*1024*1024;
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const requiredChecks=['install','typecheck','tests','build','browser','source_zip'];
const layout="import type {ReactNode} from 'react';\nexport default function Layout({children}:{children:ReactNode}){return <html lang=\"en\"><body>{children}</body></html>;}\n";
const nextConfig="export default {output:'standalone',outputFileTracingRoot:process.cwd(),images:{unoptimized:true},experimental:{cpus:1}};\n";
const allowedPaths=new Set(['BUILD-EVIDENCE.json','BUILD-PROVENANCE.json','README.md','app/layout.tsx','app/page.tsx','bun.lock','lib/collection.ts','next-env.d.ts','next.config.ts','package.json','tests/app.test.tsx','tests/collection.test.ts','tsconfig.json','tsconfig.tsbuildinfo']);
const wrapper="import {createRoot} from 'react-dom/client';\nimport Page from './app/page';\ncreateRoot(document.getElementById('app')!).render(<Page/>);\n";
const html=(title:string)=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+title.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))+'</title></head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>\n';
const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function crc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function fail(message:string):never{throw new Error(message+' Use the checked source ZIP and manual run instructions.');}

/** Read only this host's bounded, stored ZIP format. No archive extraction or code execution. */
export function readStoredLaunchZip(bytes:Uint8Array):Record<string,string>{
 if(bytes.length<22||bytes.length>MAX_ZIP)fail('The accepted source ZIP exceeds the local preview limit.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
 const u16=(n:number)=>view.getUint16(n,true),u32=(n:number)=>view.getUint32(n,true);
 if(u32(end)!==0x06054b50||u16(end+4)!==0||u16(end+6)!==0||u16(end+20)!==0)fail('The source ZIP is not the supported host archive format.');
 const count=u16(end+10),offset=u32(end+16),size=u32(end+12);
 if(!count||count>32||u16(end+8)!==count||offset+size!==end)fail('The source ZIP directory is invalid.');
 let central=offset,local=0,total=0;const result:Record<string,string>=Object.create(null);
 for(let index=0;index<count;index++){
  if(central+46>end||u32(central)!==0x02014b50||u16(central+8)!==0x800||u16(central+10)!==0||u16(central+12)!==0||u16(central+14)!==0)fail('The source ZIP contains unsupported entries.');
  const length=u16(central+28),extra=u16(central+30),comment=u16(central+32),packed=u32(central+20),unpacked=u32(central+24),checksum=u32(central+16),start=u32(central+42);
  if(!length||length>180||extra||comment||u16(central+34)!==0||u32(central+38)!==0||packed!==unpacked||unpacked>MAX_FILE||start!==local||central+46+length>end)fail('The source ZIP contains an invalid file record.');
  const name=decoder.decode(bytes.subarray(central+46,central+46+length));
  if(!/^[-a-zA-Z0-9_./]+$/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..')||Object.hasOwn(result,name))fail('The source ZIP contains unsafe or duplicate paths.');
  if(local+30>offset||u32(local)!==0x04034b50||u16(local+6)!==0x800||u16(local+8)!==0||u16(local+10)!==0||u16(local+12)!==0||u32(local+14)!==checksum||u32(local+18)!==packed||u32(local+22)!==unpacked||u16(local+26)!==length||u16(local+28)!==0)fail('The source ZIP local file record does not match its directory.');
  const from=local+30+length,to=from+unpacked;
  if(to>offset||decoder.decode(bytes.subarray(local+30,from))!==name)fail('The source ZIP file range is invalid.');
  const content=bytes.subarray(from,to);if(crc(content)!==checksum)fail('The source ZIP file checksum is invalid.');
  result[name]=decoder.decode(content);total+=unpacked;if(total>MAX_ZIP)fail('The source ZIP exceeds the local preview limit.');
  local=to;central+=46+length;
 }
 if(central!==end||local!==offset)fail('The source ZIP contains unaccounted data.');
 return result;
}

/** The exact known client component is used; unknown app/layout/server code never runs. */
export function recognizeLaunchSource(files:Record<string,string>,task:SoftwareTask):KnownSource{
 if(Object.keys(files).some(path=>!allowedPaths.has(path))||files['app/layout.tsx']!==layout||files['next.config.ts']!==nextConfig)fail('This build has source outside the supported trusted preview recipes.');
 let saved:SoftwareTask['evidence'];try{saved=JSON.parse(files['BUILD-EVIDENCE.json']);}catch{fail('The accepted source has no readable build evidence.');}
 if(!saved||saved.revision!==task.revision||!requiredChecks.every(id=>saved!.checks?.some(c=>c.id===id&&c.ok))||saved.checks.some(c=>!c.ok)||JSON.stringify(saved.browserContract)!==JSON.stringify(task.evidence?.browserContract))fail('The accepted source build evidence does not match this revision.');
 if(task.collectionContract){
  const spec=readCollectionRecipe(files),contract=collectionBrowserContract(spec);
  if(JSON.stringify(contract)!==JSON.stringify(task.collectionContract)||JSON.stringify(contract)!==JSON.stringify(task.evidence?.browserContract))fail('The accepted collection contract does not match its source.');
  return {kind:'collection',title:spec.title,storageKey:spec.storageKey,executed:{'app/page.tsx':files['app/page.tsx'],'lib/collection.ts':files['lib/collection.ts']}};
 }
 if(task.counterContract&&counterSkillEvidenceMatches(task.goal,task.evidence?.browserContract)){
  const page=files['app/page.tsx']||'',match=/^const spec=(\{[^\n]*\});$/m.exec(page);let spec:NumericScreen;
  try{spec=JSON.parse(match?.[1]||'');if(compileNumericScreen(spec)!==page)fail('The counter source differs from the trusted compiler.');}catch{fail('The counter source differs from the trusted compiler.');}
  const contract=task.evidence!.browserContract!;
  if(contract.kind!=='counter'||spec.outputLabel!==contract.label||spec.buttonLabel!==contract.button||spec.initial!==(contract.initial??0)||spec.delta!==(contract.delta??1)||spec.resetButtonLabel!==contract.resetButton||contract.heading!==undefined&&spec.title!==contract.heading)fail('The accepted counter contract does not match its source.');
  return {kind:'counter',title:spec.title,executed:{'app/page.tsx':page}};
 }
 fail('Only checked trusted counter and collection builds support an in-window preview.');
}

async function regular(path:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||await realpath(path)!==resolve(path))fail('Linked or missing local preview files are not supported.');return stat;}
async function safeDirectory(path:string){await mkdir(path,{recursive:true});const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==resolve(path))fail('The local preview directory is linked or unavailable.');}
function checkedTask(task:SoftwareTask){
 if(!task||!idPattern.test(task.id)||!Number.isSafeInteger(task.revision)||task.revision<1||task.status!=='completed'||task.evidence?.revision!==task.revision||!requiredChecks.every(id=>task.evidence!.checks.some(c=>c.id===id&&c.ok))||task.evidence.checks.some(c=>!c.ok)||!task.requirements.length||task.requirements.some(r=>r.status!=='verified'||r.reviewRevision!==task.revision))fail('This build has no completed current-revision acceptance.');
 const artifact=task.evidence.artifacts.find(a=>a.kind==='zip'&&a.smokeTested);
 if(!artifact||!/^[-a-zA-Z0-9_.]+\.zip$/.test(artifact.name)||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<22||artifact.bytes>MAX_ZIP||!/^[a-f0-9]{64}$/.test(artifact.sha256))fail('A checked source ZIP is required for local preview.');
 return artifact;
}
async function acceptedSource(task:SoftwareTask){
 const artifact=checkedTask(task),taskRoot=join(BUILDS,task.id),path=join(taskRoot,'artifacts',artifact.name);const stat=await regular(path);
 if(stat.size!==artifact.bytes)fail('The accepted source ZIP bytes are unavailable.');const bytes=await readFile(path);if(sha(bytes)!==artifact.sha256)fail('The source ZIP no longer matches its accepted checksum.');
 const files=readStoredLaunchZip(bytes),source=recognizeLaunchSource(files,task);let pkg:{dependencies?:Record<string,string>};try{pkg=JSON.parse(files['package.json']);}catch{fail('The source dependency declaration is unreadable.');}
 const reactVersion=pkg.dependencies?.react;if(!reactVersion||pkg.dependencies?.['react-dom']!==reactVersion||!/^\d+\.\d+\.\d+$/.test(reactVersion))fail('The source React dependency versions are unsupported.');
 const installed=join(taskRoot,'node_modules');
 try{for(const name of ['react','react-dom']){const dep=JSON.parse(await readFile(join(installed,name,'package.json'),'utf8'));if(dep.version!==reactVersion)fail('Matching installed React dependencies are unavailable.');}Bun.resolveSync('react-dom/client',taskRoot);Bun.resolveSync('react/jsx-runtime',taskRoot);}catch{fail('Matching installed React dependencies are unavailable; no packages were installed.');}
 return {artifact,taskRoot,files,source,reactVersion};
}
export async function inspectLaunchEligibility(task:SoftwareTask):Promise<LaunchEligibility>{try{const {artifact,source}=await acceptedSource(task);return {supported:true,kind:source.kind,title:source.title,...(source.storageKey?{storageKey:source.storageKey}:{}),zipSha256:artifact.sha256,revision:task.revision};}catch(error){return {supported:false,reason:error instanceof Error?error.message:String(error)};}}
function manifestId(manifest:Omit<LaunchPackageManifest,'id'>){return sha(JSON.stringify(manifest));}
/** Hash coherence alone cannot attest a cache; callers must supply a trusted expected receipt. */
export async function validateLaunchPackage(root:string,expected:LaunchPackageManifest):Promise<LaunchPackageManifest>{
 const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==resolve(root))fail('The prepared local preview directory is unavailable.');
 await regular(join(root,'manifest.json'));const raw=await readFile(join(root,'manifest.json'),'utf8');let m:LaunchPackageManifest;try{m=JSON.parse(raw);}catch{fail('The prepared local preview manifest is unreadable.');}
 const {id,...identity}=m;
 if(!expected||m.format!=='anascummis.trusted-browser-runtime.v1'||m.wrapperVersion!==1||!idPattern.test(m.taskId)||!Number.isSafeInteger(m.revision)||m.revision<1||!/^[a-f0-9]{64}$/.test(m.zipSha256)||!['counter','collection'].includes(m.kind)||typeof m.title!=='string'||m.title.length>80||typeof m.reactVersion!=='string'||!Array.isArray(m.sourceFiles)||!Array.isArray(m.files)||m.files.length!==2||m.files.map(f=>f.path).sort().join('|')!=='app.js|index.html'||m.id!==manifestId(identity)||raw!==canonical(m)||JSON.stringify(m)!==JSON.stringify(expected))fail('The prepared local preview identity no longer matches its receipt.');
 if((await readdir(root)).sort().join('|')!=='app.js|index.html|manifest.json')fail('The prepared local preview contains unexpected files.');
 for(const file of m.files){await regular(join(root,file.path));const bytes=await readFile(join(root,file.path));if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)fail('Prepared local preview files no longer match their receipt.');}
 return m;
}

/** Every explicit preparation rederives the bundle from accepted source, rather than trusting a cache to attest itself. */
export async function prepareLaunchPackage(task:SoftwareTask,signal:AbortSignal):Promise<{root:string;manifest:LaunchPackageManifest}>{
 signal.throwIfAborted();const {artifact,taskRoot,files,source,reactVersion}=await acceptedSource(task);signal.throwIfAborted();
 for(const dir of [DATA,join(DATA,'app-launch'),join(DATA,'app-launch','runtimes')])await safeDirectory(dir);
 const parent=join(DATA,'app-launch','runtimes'),root=join(parent,artifact.sha256+'-'+task.id+'-'+task.revision),temporary=await mkdtemp(join(parent,'.prepare-'));
 try{
  const input=join(temporary,'source');await mkdir(join(input,'app'),{recursive:true});
  for(const [path,sourceText]of Object.entries(source.executed)){const at=join(input,path);await mkdir(resolve(at,'..'),{recursive:true});await Bun.write(at,sourceText);}
  const entry=join(input,'entry.tsx');await Bun.write(entry,wrapper);signal.throwIfAborted();
  const result=await Bun.build({entrypoints:[entry],target:'browser',format:'esm',minify:true,sourcemap:'none',splitting:false,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'installed-accepted-react',setup(build){build.onResolve({filter:/^(?:react|react-dom)(?:\/.*)?$/},args=>({path:Bun.resolveSync(args.path,taskRoot)}));}}]});
  signal.throwIfAborted();if(!result.success||result.outputs.length!==1)fail('The installed dependencies could not prepare the trusted browser component.');
  const script=new Uint8Array(await result.outputs[0].arrayBuffer()),document=encoder.encode(html(source.title));if(script.length>4*1024*1024)fail('The prepared browser component exceeds its runtime limit.');
  const identities=[{path:'index.html',bytes:document.length,sha256:sha(document)},{path:'app.js',bytes:script.length,sha256:sha(script)}];
  const identity:Omit<LaunchPackageManifest,'id'>={format:'anascummis.trusted-browser-runtime.v1',taskId:task.id,revision:task.revision,zipSha256:artifact.sha256,kind:source.kind,title:source.title,...(source.storageKey?{storageKey:source.storageKey}:{}),wrapperVersion:1,reactVersion,sourceFiles:Object.keys(files).sort().map(path=>({path,bytes:encoder.encode(files[path]).length,sha256:sha(files[path])})),files:identities};
  const {format,...rest}=identity,manifest:LaunchPackageManifest={format,id:manifestId(identity),...rest};
  await Bun.write(join(temporary,'index.html'),document);await Bun.write(join(temporary,'app.js'),script);await Bun.write(join(temporary,'manifest.json'),canonical(manifest));await rm(input,{recursive:true});signal.throwIfAborted();
  let exists=true;try{await lstat(root);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;exists=false;}
  if(exists)await validateLaunchPackage(root,manifest);
  else try{await rename(temporary,root);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code||''))throw error;await validateLaunchPackage(root,manifest);}
  await validateLaunchPackage(root,manifest);signal.throwIfAborted();return {root,manifest};
 }finally{await rm(temporary,{recursive:true,force:true});}
}
