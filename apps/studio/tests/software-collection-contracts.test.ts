import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const studio=resolve(import.meta.dir,'..');
const setup=`
 import {strict as assert} from 'node:assert';
 import {join} from 'node:path';import {mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
 const tasks=await import(${JSON.stringify(join(studio,'core/software-task.ts'))});
 const runner=await import(${JSON.stringify(join(studio,'core/software-runner.ts'))});
 const compiler=await import(${JSON.stringify(join(studio,'core/collection-screen.ts'))});
 const {db}=await import(${JSON.stringify(join(studio,'core/storage.ts'))});
 const {zip}=await import(${JSON.stringify(join(studio,'core/zip.ts'))});
 const goal='Build a task-list application with heading My Tasks, a text input labelled New task, an Add button, and a Remove button for each task. Add task text to the list, remove individual tasks, and persist remaining tasks after a page reload. Include browser checks and give me the source ZIP.';
 const guidance='Change heading to My Week; keep existing add/remove/persistence behavior.';
 const spec={...compiler.collectionSkillSpec(goal),storageKey:'anascummis.collection.fixture'};
 const hash=async path=>createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex');
 async function parentFixture(){
  const parent=await tasks.createSoftwareTask(goal,['zip']),root=runner.taskRoot(parent.id),files=compiler.collectionFiles(spec),contract=compiler.collectionBrowserContract(spec);
  for(const [path,source]of Object.entries(files))await runner.writeSource(root,path,source);
  await runner.writeSoftwareRevisionBrowserContract(parent.id,contract);await mkdir(join(root,'artifacts'),{recursive:true});
  const artifact=zip(Object.fromEntries(Object.entries(files).map(([path,source])=>[path,new TextEncoder().encode(source)])));
  await Bun.write(join(root,'artifacts','source.zip'),artifact);
  parent.status='completed';parent.revision=1;parent.collectionContract=contract;parent.planningDone=true;
  parent.requirements=[{id:'collection',description:compiler.collectionRequirement(spec),status:'verified',files:['app/page.tsx','lib/collection.ts'],tests:['tests/app.test.tsx','tests/collection.test.ts'],reviewRevision:1}];
  parent.evidence={revision:1,checks:[{id:'fixture',ok:true,detail:'Fixture metadata for lifecycle guard tests only; this is not a real build claim.',milliseconds:1}],dom:'My Tasks',headings:['My Tasks'],browserContract:contract,artifacts:[{kind:'zip',name:'source.zip',sha256:createHash('sha256').update(artifact).digest('hex'),bytes:artifact.length,smokeTested:true}]};
  db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(parent),parent.id);return parent;
 }
 async function sourceSnapshot(task){const root=runner.taskRoot(task.id);return Object.fromEntries(await Promise.all(compiler.collectionSourcePaths.map(async path=>[path,await hash(join(root,path))])));}
 async function parentSnapshot(task){return {body:db.query('SELECT body FROM software_tasks WHERE id=?').get(task.id).body,source:await sourceSnapshot(task),zip:await hash(join(runner.taskRoot(task.id),'artifacts','source.zip'))};}
`;

async function scenario(source:string){
 const folder=await mkdtemp(join(tmpdir(),'software-collection-'));
 try{
  const child=Bun.spawn([process.execPath,'-e',setup+'\n'+source+'\nconsole.log("collection scenario passed");'],{cwd:studio,env:{...process.env,STUDIO_DATA:folder,STUDIO_TEST_DATA:folder},stdout:'pipe',stderr:'pipe'});
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(code).toBe(0);expect(stderr).toBe('');expect(stdout.trim()).toBe('collection scenario passed');
 }finally{await rm(folder,{recursive:true,force:true});}
}

test('collection browser contracts normalize complete behavior and a literal heading amendment retains its storage identity',async()=>{
 await scenario(`const base=compiler.collectionBrowserContract(spec);assert.deepEqual(runner.validateSoftwareBrowserContract(base),base);assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,guidance),{...base,heading:'My Week'});assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,guidance+' Add login.'),base);assert.equal(base.heading,'My Tasks');assert.throws(()=>runner.validateSoftwareBrowserContract({...base,storageKey:'../bad'}));assert.throws(()=>runner.validateSoftwareBrowserContract({...base,storage:'server'}));assert.equal(compiler.collectionEvidenceMatches(base,{...base,storageKey:'another-app'}),false);`);
});

test('a bounded child changes only known compiler fields, keeps full collection acceptance and leaves its accepted parent byte-identical',async()=>{
 await scenario(`const parent=await parentFixture(),before=await parentSnapshot(parent),child=await tasks.createSoftwareRevision(parent.id,guidance);let calls=0;assert.equal(await tasks.planCollectionRevision(child,new AbortController().signal,async(system,user)=>{calls++;assert.match(system,/trusted host compiler/i);assert.equal(JSON.parse(user).guidance,guidance);return {title:'My Week'};}),true);assert.equal(calls,1);assert.equal(child.revision,1);assert.equal(child.planningDone,true);assert.equal(child.collectionContract.heading,'My Week');assert.equal(child.collectionContract.storageKey,parent.collectionContract.storageKey);assert.equal(child.requirements.length,1);assert.equal(child.requirements[0].description,compiler.collectionRequirement({...spec,title:'My Week'}));assert.equal(child.requirements[0].status,'implemented');assert.equal(child.evidence,undefined);assert.equal(await Bun.file(join(runner.taskRoot(child.id),'artifacts','source.zip')).exists(),false);const expected=compiler.collectionFiles({...spec,title:'My Week'});for(const [path,source]of Object.entries(expected))assert.equal(await Bun.file(join(runner.taskRoot(child.id),path)).text(),source);assert.deepEqual(await parentSnapshot(parent),before);`);
});

test('custom source, tampered provenance or additional accepted criteria cannot be replaced by the heading recipe',async()=>{
 await scenario(`
  const parent=await parentFixture(),before=await parentSnapshot(parent);
  for(const change of ['source','provenance','criterion']){
   const child=await tasks.createSoftwareRevision(parent.id,guidance),root=runner.taskRoot(child.id);
   if(change==='source')await runner.writeSource(root,'app/page.tsx',(await Bun.file(join(root,'app/page.tsx')).text())+'\\n// custom code');
   if(change==='provenance')await runner.writeSource(root,'BUILD-PROVENANCE.json',JSON.stringify({compiler:'model says trusted',spec}));
   if(change==='criterion')child.revisionPlan.criteria.push({id:'extra',description:'Preserve another accepted requirement',files:[],tests:[]});
   const sourceBefore=await sourceSnapshot(child);let calls=0;
   await assert.rejects(tasks.planCollectionRevision(child,new AbortController().signal,async()=>{calls++;return {title:'My Week'};}));
   assert.equal(calls,0);assert.equal(child.status,'needs_input');assert.equal(child.phase,'revision_contract_rejected');assert.deepEqual(await sourceSnapshot(child),sourceBefore);
  }
  assert.deepEqual(await parentSnapshot(parent),before);
 `);
});

test('late cancellation does not save a compiler checkpoint or overwrite copied child source',async()=>{
 await scenario(`const parent=await parentFixture(),before=await parentSnapshot(parent),child=await tasks.createSoftwareRevision(parent.id,guidance),sourceBefore=await sourceSnapshot(child),control=new AbortController(),reason=new Error('Caller stopped');await assert.rejects(tasks.planCollectionRevision(child,control.signal,async()=>{control.abort(reason);return {title:'My Week'};}),error=>error===reason);assert.equal(child.revisionPlan.collectionRecipe,undefined);assert.equal(child.collectionContract,undefined);assert.deepEqual(await sourceSnapshot(child),sourceBefore);const stopped=new AbortController();stopped.abort(reason);await assert.rejects(tasks.planCollectionRevision(child,stopped.signal,async()=>{throw Error('Must not infer');}),error=>error===reason);assert.deepEqual(await parentSnapshot(parent),before);`);
});

test('a persisted compiler checkpoint finishes partial own writes after process reopen without another model call',async()=>{
 await scenario(`
  const parent=await parentFixture(),before=await parentSnapshot(parent),child=await tasks.createSoftwareRevision(parent.id,guidance),after={...spec,title:'My Week'};
  child.revisionPlan.collectionRecipe={before:spec,after,revision:1};
  db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(child),child.id);
  await runner.writeSource(runner.taskRoot(child.id),'app/page.tsx',compiler.collectionFiles(after)['app/page.tsx']);
  const resumeSource='const tasks=await import('+JSON.stringify(${JSON.stringify(join(studio,'core/software-task.ts'))})+');const task=tasks.softwareTask('+JSON.stringify(child.id)+');await tasks.planCollectionRevision(task,new AbortController().signal,async()=>{throw Error("Checkpoint must not repeat inference");});if(task.revision!==1||task.collectionContract.heading!=="My Week")throw Error("Invalid resumed output");';
  const process=Bun.spawn([${JSON.stringify(process.execPath)},'-e',resumeSource],{cwd:${JSON.stringify(studio)},env:{...globalThis.process.env},stdout:'pipe',stderr:'pipe'});
  const [code,errors]=await Promise.all([process.exited,new Response(process.stderr).text()]);assert.equal(code,0,errors);
  const resumed=tasks.softwareTask(child.id);assert.equal(resumed.planningDone,true);assert.equal(resumed.revision,1);assert.equal(resumed.calls,0);assert.equal(resumed.collectionContract.storageKey,spec.storageKey);
  const expected=compiler.collectionFiles(after);for(const [path,source]of Object.entries(expected))assert.equal(await Bun.file(join(runner.taskRoot(child.id),path)).text(),source);
  assert.deepEqual(await parentSnapshot(parent),before);
 `);
});

test('unsupported extra revision guidance keeps the guarded worker path and never receives a typed collection shortcut',async()=>{
 await scenario(`const parent=await parentFixture(),before=await parentSnapshot(parent),child=await tasks.createSoftwareRevision(parent.id,guidance+' Add login.'),sourceBefore=await sourceSnapshot(child);assert.equal(await tasks.planCollectionRevision(child,new AbortController().signal,async()=>{throw Error('Must not infer a partial recipe');}),false);assert.equal(child.collectionContract,undefined);assert.equal(child.planningDone,false);assert.deepEqual(await sourceSnapshot(child),sourceBefore);assert.deepEqual(await parentSnapshot(parent),before);`);
});
