import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {zip} from '../core/zip';
import {readStoredLaunchZip,recognizeLaunchSource,inspectLaunchEligibility} from '../core/app-launch-package';
import {compileNumericScreen} from '../core/react-screen';
import {collectionFiles,collectionBrowserContract} from '../core/collection-screen';
import type {SoftwareTask} from '../core/software-task';

const studio=resolve(import.meta.dir,'..');
const layout="import type {ReactNode} from 'react';\nexport default function Layout({children}:{children:ReactNode}){return <html lang=\"en\"><body>{children}</body></html>;}\n";
const config="export default {output:'standalone',outputFileTracingRoot:process.cwd(),images:{unoptimized:true},experimental:{cpus:1}};\n";
const checks=['install','typecheck','tests','build','browser','source_zip'].map(id=>({id,ok:true,detail:'Synthetic acceptance metadata for package guard tests; not a real build claim.',milliseconds:0}));
const spec={title:'My Counter',outputLabel:'Count',buttonLabel:'Increment',initial:0,delta:1};
function fixture(){
 const evidence={revision:1,checks:structuredClone(checks),dom:'fixture',browserContract:{kind:'counter',label:'Count',button:'Increment',heading:spec.title},artifacts:[]};
 const task={id:'12345678-1234-1234-1234-123456789abc',goal:'Build a counter app with heading My Counter, starts at zero and an Increment button that adds one.',status:'completed',revision:1,counterContract:true,requirements:[{status:'verified',reviewRevision:1}],evidence} as unknown as SoftwareTask;
 return {task,files:{'app/layout.tsx':layout,'next.config.ts':config,'app/page.tsx':compileNumericScreen(spec),'BUILD-EVIDENCE.json':JSON.stringify(evidence)}};
}
const bytes=(files:Record<string,string>)=>zip(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,new TextEncoder().encode(text)])));
function replaceNames(input:Uint8Array,from:string,to:string){const b=Buffer.from(input),a=Buffer.from(from),z=Buffer.from(to);if(a.length!==z.length)throw Error('Fixture names must retain length');let at=0;for(;;){at=b.indexOf(a,at);if(at<0)break;z.copy(b,at);at+=a.length;}return new Uint8Array(b);}

test('stored ZIP reader accounts for every path and CRC, rejecting duplicates, traversal, compression, links and trailing data',()=>{
 const good=bytes({'app/page.tsx':'hello','lib/state.ts':'world'});expect({...readStoredLaunchZip(good)}).toEqual({'app/page.tsx':'hello','lib/state.ts':'world'});
 const corrupt=good.slice();corrupt[30+'app/page.tsx'.length]^=1;expect(()=>readStoredLaunchZip(corrupt)).toThrow();
 expect(()=>readStoredLaunchZip(replaceNames(bytes({'a/b':'text'}),'a/b','../'))).toThrow();
 expect(()=>readStoredLaunchZip(replaceNames(bytes({'a.ts':'one','b.ts':'two'}),'b.ts','a.ts'))).toThrow();
 const method=good.slice(),v=new DataView(method.buffer);v.setUint16(8,8,true);const central=v.getUint32(method.length-6,true);v.setUint16(central+10,8,true);expect(()=>readStoredLaunchZip(method)).toThrow();
 const linked=good.slice(),l=new DataView(linked.buffer);l.setUint32(central+38,0xa1ff0000,true);expect(()=>readStoredLaunchZip(linked)).toThrow();
 expect(()=>readStoredLaunchZip(new Uint8Array([...good,0]))).toThrow();
});

test('counter recognition requires exact known Page/layout, matching current browser contract and full-revision checks',()=>{
 const {task,files}=fixture();expect(recognizeLaunchSource(files,task)).toMatchObject({kind:'counter',title:'My Counter'});
 expect(()=>recognizeLaunchSource({...files,'app/page.tsx':files['app/page.tsx']+'\nfetch("/api/private");'},task)).toThrow();
 expect(()=>recognizeLaunchSource({...files,'app/layout.tsx':layout+'// custom'},task)).toThrow();
 expect(()=>recognizeLaunchSource({...files,'app/api/route.ts':'export function GET(){}'},task)).toThrow();
 const amended=structuredClone(task);(amended.evidence!.browserContract as any).delta=2;expect(()=>recognizeLaunchSource(files,amended)).toThrow();
 expect(()=>recognizeLaunchSource({...files,'BUILD-EVIDENCE.json':JSON.stringify({...task.evidence,revision:2})},task)).toThrow();
});

test('collection recognition retains the accepted key and refuses custom code or forged provenance',()=>{
 const {task,files}=fixture(),spec={title:'My Tasks',inputLabel:'New task',addButtonLabel:'Add',removeButtonLabel:'Remove',storageKey:'fixture.collection'};
 delete task.counterContract;task.collectionContract=collectionBrowserContract(spec);task.evidence!.browserContract=task.collectionContract;
 Object.assign(files,collectionFiles(spec),{'BUILD-EVIDENCE.json':JSON.stringify(task.evidence)});
 expect(recognizeLaunchSource(files,task)).toMatchObject({kind:'collection',title:'My Tasks',storageKey:'fixture.collection'});
 expect(()=>recognizeLaunchSource({...files,'lib/collection.ts':files['lib/collection.ts' as keyof typeof files]+'\n// custom'},task)).toThrow();
 expect(()=>recognizeLaunchSource({...files,'BUILD-PROVENANCE.json':JSON.stringify({spec,compiler:'model claims trusted'})},task)).toThrow();
});

test('incomplete, stale and unchecked builds remain unsupported before any preparation',async()=>{
 for(const amend of [(t:SoftwareTask)=>{t.status='needs_input';},(t:SoftwareTask)=>{t.revision=2;},(t:SoftwareTask)=>{t.evidence!.checks[0].ok=false;},(t:SoftwareTask)=>{t.requirements[0].reviewRevision=0;}]){
  const {task}=fixture();amend(task);const result=await inspectLaunchEligibility(task);expect(result.supported).toBe(false);expect('reason' in result&&result.reason).toContain('manual run instructions');
 }
});

async function scenario(body:string){
 const folder=await mkdtemp(join(tmpdir(),'launch-package-'));
 const setup=`import {strict as assert} from 'node:assert';import {join} from 'node:path';import {mkdir,symlink,readFile,writeFile,rm,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
 const api=await import(${JSON.stringify(join(studio,'core/app-launch-package.ts'))});
 const {zip}=await import(${JSON.stringify(join(studio,'core/zip.ts'))});
 const {compileNumericScreen}=await import(${JSON.stringify(join(studio,'core/react-screen.ts'))});
 const base=${JSON.stringify(fixture())};const task=base.task,files=base.files,root=join(process.env.STUDIO_DATA,'software',task.id);
 const installed=JSON.parse(await readFile(${JSON.stringify(join(studio,'node_modules/react/package.json'))},'utf8')).version;
 files['package.json']=JSON.stringify({dependencies:{react:installed,'react-dom':installed}});
 await mkdir(join(root,'artifacts'),{recursive:true});
 const raw=zip(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,new TextEncoder().encode(text)])));
 const artifact={kind:'zip',name:'source.zip',bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),smokeTested:true};
 task.evidence.artifacts=[artifact];await writeFile(join(root,'artifacts/source.zip'),raw);
 const link=()=>symlink(${JSON.stringify(join(studio,'node_modules'))},join(root,'node_modules'),'dir');
 `;
 try{const child=Bun.spawn([process.execPath,'-e',setup+'\n'+body+'\nconsole.log("package guard scenario passed");'],{cwd:studio,env:{...process.env,STUDIO_DATA:folder,STUDIO_TEST_DATA:folder},stdout:'pipe',stderr:'pipe'});const [code,out,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);if(code!==0)throw new Error(error||out||'Package scenario failed');expect(code).toBe(0);expect(error).toBe('');expect(out.trim()).toBe('package guard scenario passed');}finally{await rm(folder,{recursive:true,force:true});}
}

test('explicit preparation uses exact ZIP code, is deterministic, and does not mutate accepted source or install dependencies',async()=>{
 await scenario(`await link();const before=await readFile(join(root,'artifacts/source.zip'));assert.equal((await api.inspectLaunchEligibility(task)).supported,true);const one=await api.prepareLaunchPackage(task,new AbortController().signal),two=await api.prepareLaunchPackage(task,new AbortController().signal);assert.equal(one.root,two.root);assert.deepEqual(one.manifest,two.manifest);assert.equal(one.manifest.kind,'counter');assert.equal(one.manifest.zipSha256,artifact.sha256);assert.equal(one.manifest.sourceFiles.find(f=>f.path==='app/page.tsx').sha256,createHash('sha256').update(files['app/page.tsx']).digest('hex'));assert.deepEqual((await readdir(one.root)).sort(),['app.js','index.html','manifest.json']);assert.deepEqual(await readFile(join(root,'artifacts/source.zip')),before);assert.equal((await api.validateLaunchPackage(one.root,one.manifest)).id,one.manifest.id);`);
});

test('poisoned bundle and self-consistent forged cache metadata cannot attest a runtime; accepted ZIP remains intact',async()=>{
 await scenario(`await link();const one=await api.prepareLaunchPackage(task,new AbortController().signal),file=join(one.root,'app.js');await writeFile(file,'alert("forged")');const fake=structuredClone(one.manifest);fake.files.find(f=>f.path==='app.js').bytes=15;fake.files.find(f=>f.path==='app.js').sha256=createHash('sha256').update('alert("forged")').digest('hex');const {id,...identity}=fake;fake.id=createHash('sha256').update(JSON.stringify(identity)).digest('hex');await writeFile(join(one.root,'manifest.json'),JSON.stringify(fake,null,2)+'\\n');await assert.rejects(api.prepareLaunchPackage(task,new AbortController().signal));assert.equal((await readFile(file,'utf8')),'alert("forged")');assert.equal(createHash('sha256').update(await readFile(join(root,'artifacts/source.zip'))).digest('hex'),artifact.sha256);`);
});

test('missing dependencies, changed archive, linked files and cancellation fail without silent repair',async()=>{
 await scenario(`let result=await api.inspectLaunchEligibility(task);assert.equal(result.supported,false);assert.match(result.reason,/no packages were installed/);assert.equal(await Bun.file(join(root,'node_modules/react/package.json')).exists(),false);await link();const stopped=new AbortController();stopped.abort(new Error('Stopped explicitly'));await assert.rejects(api.prepareLaunchPackage(task,stopped.signal),/Stopped explicitly/);await writeFile(join(root,'artifacts/source.zip'),new Uint8Array([1,2,3]));result=await api.inspectLaunchEligibility(task);assert.equal(result.supported,false);assert.match(result.reason,/bytes are unavailable/);await writeFile(join(root,'artifacts/source.zip'),raw);await rm(join(root,'artifacts/source.zip'));await writeFile(join(root,'other.zip'),raw);await symlink(join(root,'other.zip'),join(root,'artifacts/source.zip'));assert.equal((await api.inspectLaunchEligibility(task)).supported,false);`);
});
