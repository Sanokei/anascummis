import {test, expect} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const studio = join(import.meta.dir, '..');
const imports = `
  import {strict as assert} from 'node:assert';
  import {join} from 'node:path';
  const studio=${JSON.stringify(studio)};
  import {mkdir,readdir,symlink} from 'node:fs/promises';
  import {createHash} from 'node:crypto';
  const {db}=await import(${JSON.stringify(join(studio, 'core/storage.ts'))});
  const tasks=await import(${JSON.stringify(join(studio, 'core/software-task.ts'))});
  const runner=await import(${JSON.stringify(join(studio, 'core/software-runner.ts'))});
  const {compileNumericScreen}=await import(${JSON.stringify(join(studio, 'core/react-screen.ts'))});
  const {zip}=await import(${JSON.stringify(join(studio, 'core/zip.ts'))});
  const note='Change the heading to Repair Verified and keep the counter working.';
  const hash=async path=>createHash('sha256').update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest('hex');
  const sleep=()=>new Promise(resolve=>setTimeout(resolve,2));
  async function parentFixture(){
    const parent=await tasks.createSoftwareTask('Create an app with heading Repair Baseline and a working counter.',['zip']);
    const root=runner.taskRoot(parent.id);
    await runner.writeSource(root,'app/page.tsx',compileNumericScreen({title:'Repair Baseline',outputLabel:'Count',buttonLabel:'Increment',initial:0,delta:1}));
    await runner.writeSource(root,'tests/app.test.tsx','import {test,expect} from "bun:test";test("heading",()=>expect("Repair Baseline").toBe("Repair Baseline"));');
    await mkdir(join(root,'.qa'),{recursive:true});
    await Bun.write(join(root,'.qa','browser-contract.json'),JSON.stringify({kind:'counter',label:'Count',button:'Increment'}));
    await Bun.write(join(root,'.qa','revision-7.png'),new Uint8Array([137,80,78,71,7]));
    await Bun.write(join(root,'.qa','browser-7.json'),JSON.stringify({dom:'Repair Baseline 0 Increment',headings:['Repair Baseline'],errors:[],behavior:'counter acceptance passed'}));
    await mkdir(join(root,'artifacts'),{recursive:true});
    const artifact=zip({'app/page.tsx':new Uint8Array(await Bun.file(join(root,'app/page.tsx')).arrayBuffer())});
    await Bun.write(join(root,'artifacts','source.zip'),artifact);
    parent.status='completed';parent.phase='completed';parent.revision=7;parent.literalTitle='Repair Baseline';parent.counterContract=true;
    parent.requirements=[
      {id:'heading',description:'Render exactly heading Repair Baseline',status:'verified',files:['app/page.tsx'],tests:['tests/app.test.tsx'],reviewRevision:7},
      {id:'counter',description:'Counter displays 0, increments to 1 then 2, and reload resets to 0',status:'verified',files:['app/page.tsx'],tests:['tests/app.test.tsx'],reviewRevision:7}
    ];
    parent.evidence={revision:7,checks:[{id:'fixture',ok:true,detail:'Fixture metadata for revision persistence tests, not a real build claim.',milliseconds:1}],dom:'Repair Baseline 0 Increment',headings:['Repair Baseline'],screenshot:'revision-7.png',artifacts:[{kind:'zip',name:'source.zip',sha256:createHash('sha256').update(artifact).digest('hex'),bytes:artifact.length,smokeTested:true}]};
    parent.reads=['7:app/page.tsx:0'];parent.lastRead={path:'app/page.tsx',offset:0,source:'Old inspected source'};parent.lastResult={old:true};parent.editHistory=['old-source-mutation'];
    db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(parent),parent.id);
    return parent;
  }
  async function snapshot(parent){const root=runner.taskRoot(parent.id);return {body:db.query('SELECT body FROM software_tasks WHERE id=?').get(parent.id).body,source:await hash(join(root,'app/page.tsx')),test:await hash(join(root,'tests/app.test.tsx')),zip:await hash(join(root,'artifacts','source.zip')),screenshot:await hash(join(root,'.qa','revision-7.png'))};}
  async function coverageFixture(child,heading='Repair Baseline'){
    const root=runner.taskRoot(child.id);await mkdir(join(root,'artifacts'),{recursive:true});const artifact=zip({'app/page.tsx':new Uint8Array(await Bun.file(join(root,'app/page.tsx')).arrayBuffer())});await Bun.write(join(root,'artifacts','source.zip'),artifact);
    child.planningDone=true;child.revisionPlan.stage='ready';child.revisionPlan.guidanceOffset=child.revisionPlan.guidance.length;
    child.requirements=[{id:'counter',description:'Counter behavior remains verified',status:'verified',files:['app/page.tsx'],tests:['tests/app.test.tsx'],reviewRevision:child.revision,note:'Fixture criterion proof for coverage-control tests.'}];
    child.evidence={revision:child.revision,checks:[{id:'fixture',ok:true,detail:'Fixture metadata for coverage-control tests, not a real build claim.',milliseconds:1},{id:'browser',ok:true,detail:'counter acceptance passed',milliseconds:1}],dom:heading+' 0 Increment',headings:[heading],artifacts:[{kind:'zip',name:'source.zip',sha256:createHash('sha256').update(artifact).digest('hex'),bytes:artifact.length,smokeTested:true}]};
    db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(child),child.id);
  }
`;

async function scenario(body: string) {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'software-revision-'));
  try {
    const child = Bun.spawn([process.execPath, '-e', imports + '\n' + body + '\nconsole.log("revision scenario passed");'], {
      cwd: studio, env: {...process.env, STUDIO_DATA: root, STUDIO_TEST_DATA: root}, stdout: 'pipe', stderr: 'pipe'
    });
    const code = await child.exited, output = await new Response(child.stdout).text(), errors = await new Response(child.stderr).text();
    expect(errors).toBe('');
    expect(code).toBe(0);
    expect(output.trim()).toBe('revision scenario passed');
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('revision creation clones editable input while leaving the accepted parent and release bytes unchanged', async () => {
  await scenario(`
    const parent=await parentFixture(),root=runner.taskRoot(parent.id),before=await snapshot(parent);
    await Bun.write(join(root,'.env'),'SYNTHETIC_PRIVATE_MARKER=do-not-copy');
    await Bun.write(join(root,'private.key'),'synthetic private file');
    await mkdir(join(root,'node_modules','fixture'),{recursive:true});await Bun.write(join(root,'node_modules','fixture','index.js'),'cached dependency');
    await Bun.write(join(root,'outside-target.txt'),'synthetic linked input');await symlink(join(root,'outside-target.txt'),join(root,'linked-source.ts'));
    const child=await tasks.createSoftwareRevision(parent.id,note),childRoot=runner.taskRoot(child.id);
    assert.notEqual(child.id,parent.id);assert.equal(child.parentTaskId,parent.id);assert.equal(child.parentRevision,7);assert.equal(child.revisionNote,note);
    assert.equal(child.status,'queued');assert.equal(child.revision,0);assert(child.goal.includes(parent.goal)&&child.goal.includes(note));
    assert.equal(child.evidence,undefined);assert.equal(child.literalTitle,undefined);assert.equal(child.counterContract,undefined);assert.equal(child.lastRead,undefined);assert.equal(child.lastResult,undefined);assert.equal(child.reads,undefined);assert.equal(child.editHistory,undefined);
    assert.deepEqual(child.requirements,[]);assert(!JSON.stringify(child.revisionPlan.criteria).includes('reviewRevision'));
    assert.equal(await hash(join(childRoot,'app/page.tsx')),before.source);assert.equal(await hash(join(childRoot,'tests/app.test.tsx')),before.test);
    for(const path of ['.env','private.key','linked-source.ts','node_modules/fixture/index.js','artifacts/source.zip','.qa/revision-7.png','.qa/browser-7.json'])assert.equal(await Bun.file(join(childRoot,path)).exists(),false,path);
    assert.deepEqual(await Bun.file(join(childRoot,'.qa','browser-contract.json')).json(),{kind:'counter',label:'Count',button:'Increment'});
    assert.deepEqual(await snapshot(parent),before);
  `);
});

test('a failed synchronous parent-link callback rolls back the child and cleans only its owned workspace', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent);db.exec('CREATE TABLE revision_links(parent TEXT,child TEXT)');let childId;
    await assert.rejects(tasks.createSoftwareRevision(parent.id,note,child=>{childId=child.id;assert.equal(db.inTransaction,true);db.query('INSERT INTO revision_links VALUES(?,?)').run(parent.id,child.id);throw Error('reject revision link');}),/reject revision link/);
    assert(childId);assert.equal(await Bun.file(join(runner.taskRoot(childId),'package.json')).exists(),false);
    assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_entries WHERE kind=? AND stream_id=?').get('software',childId).n,0);assert.equal(db.query('SELECT COUNT(*) AS n FROM activity_streams WHERE kind=? AND id=?').get('software',childId).n,0);
    assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,1);assert.equal(db.query('SELECT COUNT(*) AS n FROM revision_links').get().n,0);
    assert.deepEqual(await snapshot(parent),before);
    const child=await tasks.createSoftwareRevision(parent.id,note,saved=>{assert.equal(db.inTransaction,true);db.query('INSERT INTO revision_links VALUES(?,?)').run(parent.id,saved.id);});
    assert.equal(db.query('SELECT child FROM revision_links').get().child,child.id);assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,2);
    assert.deepEqual(await snapshot(parent),before);
  `);
});

test('revision acceptance replaces the old heading, keeps unaffected counter criteria, and discards old review stamps', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note);
    tasks.applySoftwareRevisionDecision(child,{action:'replace',description:'Render exactly heading Repair Verified',reason:'The new heading supersedes Repair Baseline.'});
    tasks.applySoftwareRevisionDecision(child,{action:'keep',description:'',reason:'The user explicitly retained counter behavior.'});
    assert.deepEqual(child.requirements.map(item=>item.status),['pending','implemented']);
    assert(!child.requirements.some(item=>item.description.includes('Repair Baseline')));assert(child.requirements[0].description.includes('Repair Verified'));
    assert(child.requirements.every(item=>item.reviewRevision===undefined));assert.equal(child.revisionPlan.criterionOffset,2);assert.equal(child.revisionPlan.stage,'guidance');
    assert.deepEqual(child.revisionPlan.decisions.map(item=>item.action),['replace','keep']);assert.deepEqual(await snapshot(parent),before);
    const retired=await tasks.createSoftwareRevision(parent.id,'Remove the heading, keep the counter.');
    tasks.applySoftwareRevisionDecision(retired,{action:'retire',description:'',reason:'The heading was explicitly removed.'});
    assert.equal(retired.requirements.length,0);assert.equal(tasks.softwareTask(parent.id).requirements.length,2);
  `);
});

test('invalid guidance, changed accepted artifacts, and unsupported browser contracts create no child', async () => {
  await scenario(`
    const parent=await parentFixture(),root=runner.taskRoot(parent.id),before=await snapshot(parent);
    for(const note of ['', ' ', 'x'.repeat(2001)])await assert.rejects(tasks.createSoftwareRevision(parent.id,note),/2000/);
    await Bun.write(join(root,'artifacts','source.zip'),'changed artifact');
    await assert.rejects(tasks.createSoftwareRevision(parent.id,'Change the heading.'),/artifact changed/);
    assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,1);
    const source=zip({'app/page.tsx':new Uint8Array(await Bun.file(join(root,'app/page.tsx')).arrayBuffer())});await Bun.write(join(root,'artifacts','source.zip'),source);
    await Bun.write(join(root,'.qa','browser-contract.json'),JSON.stringify({kind:'unknown'}));
    const dirs=await readdir(runner.BUILD_ROOT);await assert.rejects(tasks.createSoftwareRevision(parent.id,'Change the heading.'),/unsupported/);
    assert.deepEqual(await readdir(runner.BUILD_ROOT),dirs);assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,1);
    assert.equal((await snapshot(parent)).body,before.body);
  `);
});

test('queued revision cancellation and continuation preserve the same child and copied source checkpoint', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note);
    const source=await hash(join(runner.taskRoot(child.id),'app/page.tsx'));
    tasks.stopSoftwareTask(child.id);assert.equal(tasks.softwareTask(child.id).status,'cancelled');
    const resumed=tasks.resumeSoftwareTask(child.id,note);assert.equal(resumed.id,child.id);assert.equal(resumed.parentTaskId,parent.id);assert.equal(resumed.goal,child.goal);assert.equal(resumed.status,'queued');assert.equal(resumed.evidence,undefined);
    assert.equal(resumed.latestGuidance,note);
    tasks.stopSoftwareTask(child.id);const guidance='Keep Repair Verified and inspect the copied heading test before changing it.';
    tasks.resumeSoftwareTask(child.id,guidance);const reloaded=tasks.softwareTask(child.id);
    assert.equal(reloaded.latestGuidance,guidance);assert.equal(reloaded.revisionPlan.guidance,guidance);assert.equal(reloaded.revisionNote,note);
    assert.equal(await hash(join(runner.taskRoot(child.id),'app/page.tsx')),source);assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,2);
    assert.deepEqual(await snapshot(parent),before);
  `);
});

test('late revision-planning responses cannot change a cancelled child or its accepted parent', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note);let release;
    tasks.startSoftwareWorker(async()=>new Promise(resolve=>{release=resolve;}));
    for(let i=0;i<100&&!release;i++)await sleep();assert(release);
    tasks.stopSoftwareTask(child.id);const stoppedActivity=tasks.softwareActivity(child.id,100);release({action:'replace',description:'A late criterion must not be applied',reason:'late model response'});
    await sleep();await sleep();tasks.shutdownSoftwareWorker();
    const stopped=tasks.softwareTask(child.id);assert.equal(stopped.status,'cancelled');assert.deepEqual(stopped.requirements,[]);assert.equal(stopped.revisionPlan.criterionOffset,0);assert.equal(stopped.evidence,undefined);assert.deepEqual(tasks.softwareActivity(child.id,100),stoppedActivity);
    assert.deepEqual(await snapshot(parent),before);
  `);
});

test('a restarted revision resumes its saved acceptance checkpoint without fresh-app seeding', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note),root=runner.taskRoot(child.id);
    tasks.applySoftwareRevisionDecision(child,{action:'replace',description:'Render exactly heading Repair Verified',reason:'The revised heading replaces the old one.'});
    child.status='running';child.revision=1;await Bun.write(join(root,'app/page.tsx'),(await Bun.file(join(root,'app/page.tsx')).text())+String.fromCharCode(10)+'// CHILD_SOURCE_CHECKPOINT');
    db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(child),child.id);const checkpoint=await hash(join(root,'app/page.tsx'));
    const resumedSource=\`
      import {strict as assert} from 'node:assert';
      const tasks=await import(\${JSON.stringify(join(studio, 'core/software-task.ts'))});
      const runner=await import(\${JSON.stringify(join(studio, 'core/software-runner.ts'))});
      let observed;
      tasks.startSoftwareWorker(async(system,user)=>{observed={system,packet:JSON.parse(user)};tasks.stopSoftwareTask(\${JSON.stringify(child.id)});return {action:'keep',description:'',reason:'Keep the saved counter criterion.'};});
      for(let i=0;i<100&&!observed;i++)await new Promise(resolve=>setTimeout(resolve,2));
      assert(observed);assert(observed.system.startsWith('Revision acceptance planner'));assert.equal(observed.packet.criterion.id,'counter');
      assert((await Bun.file(runner.taskRoot(\${JSON.stringify(child.id)})+'/app/page.tsx').text()).includes('CHILD_SOURCE_CHECKPOINT'));
      tasks.shutdownSoftwareWorker();console.log('restarted revision passed');
    \`;
    const restarted=Bun.spawn([process.execPath,'-e',resumedSource],{cwd:${JSON.stringify(studio)},env:{...process.env},stdout:'pipe',stderr:'pipe'});
    assert.equal(await restarted.exited,0,await new Response(restarted.stderr).text());assert.equal((await new Response(restarted.stdout).text()).trim(),'restarted revision passed');
    assert.equal(await hash(join(root,'app/page.tsx')),checkpoint);assert.equal(tasks.softwareTask(child.id).parentTaskId,parent.id);assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,2);
    assert.deepEqual(await snapshot(parent),before);
  `);
});

test('counter revision decisions retain inspected edit tools while fresh numeric tasks keep their typed recipe', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note);
    const fresh=await tasks.createSoftwareTask('Create a custom counter application.',['zip']);fresh.revision=1;
    for(const task of [child,fresh]){
      task.planningDone=true;task.requirements=[{id:'counter',description:'Keep the counter working while repairing its presentation',status:'pending',files:['app/page.tsx'],tests:['tests/app.test.tsx'],note:'Inspect and repair the pending counter criterion.'}];
      task.evidence={revision:task.revision,checks:[{id:'fixture',ok:true,detail:'Fixture baseline permits route inspection only.',milliseconds:1}],dom:'0 Increment',artifacts:[]};
      task.lastRead={path:'app/page.tsx',offset:0,source:(await Bun.file(join(runner.taskRoot(task.id),'app/page.tsx')).text()).slice(0,650)};
      db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);
    }
    const observed={};
    tasks.startSoftwareWorker(async(system,user,schema)=>{
      assert(system.startsWith('Software worker.'));const packet=JSON.parse(user),id=packet.parentTaskId?child.id:fresh.id;
      observed[id]=schema.properties.tool.enum;tasks.stopSoftwareTask(id);return {tool:'read_file'};
    });
    for(let i=0;i<100&&Object.keys(observed).length<2;i++)await sleep();
    tasks.shutdownSoftwareWorker();assert.equal(Object.keys(observed).length,2);
    for(const name of ['write_file','append_file','replace_text']){assert(observed[child.id].includes(name),name);assert(!observed[fresh.id].includes(name),name);}
    assert(!observed[child.id].includes('build_numeric_screen'));assert(observed[fresh.id].includes('build_numeric_screen'));
    assert.deepEqual(await Bun.file(join(runner.taskRoot(child.id),'.qa','browser-contract.json')).json(),{kind:'counter',label:'Count',button:'Increment'});
    assert.deepEqual(await snapshot(parent),before);
  `);
});

test('continuation guidance B to C to B uses the current plan rather than suppressing the original note', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note);
    tasks.stopSoftwareTask(child.id);const changed='Change the heading to Repair Alternative and keep the counter working.';
    tasks.resumeSoftwareTask(child.id,changed);assert.equal(tasks.softwareTask(child.id).revisionPlan.guidance,changed);
    tasks.stopSoftwareTask(child.id);tasks.resumeSoftwareTask(child.id,note);
    const resumed=tasks.softwareTask(child.id);assert.equal(resumed.revisionPlan.guidance,note);assert.equal(resumed.latestGuidance,note);assert.equal(resumed.revisionNote,note);assert(resumed.goal.endsWith(note));assert(resumed.goal.includes(changed));assert.deepEqual(await snapshot(parent),before);
  `);
});

test('host-derived counter amendments ground numeric steps and starts while preserving unrelated contracts', async () => {
  await scenario(`
    const base={kind:'counter',label:'Count',button:'Increment'};
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'Change the heading and keep the counter working.'),base);
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'Change the heading to "Counter starts at five and increment by two" and keep the counter working.'),base);
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'Change the heading to Counter starts at five and keep the counter working.'),base);
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'The counter starts at five and increment by two.'),{...base,initial:5,delta:2});
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'Counter starts at 5; increment by 2.'),{...base,initial:5,delta:2});
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'Decrement by two.'),{...base,delta:-2});
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'Remove the counter.'),{kind:'counter_absent',label:'Count',button:'Increment'});
    assert.deepEqual(runner.deriveSoftwareRevisionBrowserContract(base,'Do not remove the counter; change only the heading.'),base);
    for(const guidance of ['Increment by two and increment by three.','Counter starts at 5; counter starts at 6.','Remove the counter and increment by two.','Counter starts at one hundred.','Increment by two after three clicks.','Increment by Infinity.','Counter starts at 1e309.','Set the counter behavior to faster.','Hide the counter.'])assert.throws(()=>runner.deriveSoftwareRevisionBrowserContract(base,guidance),/counter|Counter|Unsupported|Conflicting/);
    assert.throws(()=>runner.deriveSoftwareRevisionBrowserContract(undefined,'Increment by 2.'),/known host/);
  `);
});

test('numeric and removal QA amendments are persisted only in their child and never delete the host contract', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),root=runner.taskRoot(parent.id),base=await Bun.file(join(root,'.qa','browser-contract.json')).json();
    const numeric=await tasks.createSoftwareRevision(parent.id,'The counter starts at five and increment by two.');
    const amended=runner.deriveSoftwareRevisionBrowserContract(numeric.revisionPlan.browserContract,numeric.revisionNote);await runner.writeSoftwareRevisionBrowserContract(numeric.id,amended);
    assert.deepEqual(await Bun.file(join(runner.taskRoot(numeric.id),'.qa','browser-contract.json')).json(),{kind:'counter',label:'Count',button:'Increment',initial:5,delta:2});
    const removed=await tasks.createSoftwareRevision(parent.id,'Remove the counter.');const absent=runner.deriveSoftwareRevisionBrowserContract(removed.revisionPlan.browserContract,removed.revisionNote);await runner.writeSoftwareRevisionBrowserContract(removed.id,absent);
    assert.deepEqual(await Bun.file(join(runner.taskRoot(removed.id),'.qa','browser-contract.json')).json(),{kind:'counter_absent',label:'Count',button:'Increment'});
    assert.deepEqual(await Bun.file(join(root,'.qa','browser-contract.json')).json(),base);assert.deepEqual(await snapshot(parent),before);
  `);
});

test('retiring a changed heading cannot complete a revision from only kept counter proof', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note);await coverageFixture(child);
    child.revisionPlan.decisions=[{id:'heading',action:'retire',description:'',reason:'Incorrectly removed the old heading without implementing the requested one.'},{id:'counter',action:'keep',description:'',reason:'Keep the counter.'}];
    db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(child),child.id);
    let reviews=0;tasks.startSoftwareWorker(async(system,user,schema)=>{
      assert(system.startsWith('Revision completion reviewer.'));reviews++;const packet=JSON.parse(user);assert(packet.guidancePage.text.includes('Repair Verified'));assert.deepEqual(packet.evidence.headings,['Repair Baseline']);assert(packet.acceptanceChanges.some(item=>item.id==='heading'&&item.action==='retire'));assert(schema.properties.satisfied);
      return {satisfied:false,reason:'The requested Repair Verified heading is absent; keeping the counter does not implement it.'};
    });
    for(let i=0;i<100&&tasks.softwareTask(child.id).status!=='needs_input';i++)await sleep();tasks.shutdownSoftwareWorker();
    const blocked=tasks.softwareTask(child.id);assert.equal(blocked.status,'needs_input');assert.equal(blocked.phase,'revision_coverage_rejected');assert.equal(blocked.revisionPlan.coverageRejected,true);assert.equal(reviews,1);assert.equal(blocked.requirements[0].status,'verified');
    const resumed=tasks.resumeSoftwareTask(child.id);assert.equal(resumed.planningDone,false);assert.equal(resumed.revisionPlan.guidance,note);assert.equal(resumed.revisionPlan.coverageOffset,0);assert.deepEqual(await snapshot(parent),before);
  `);
});

test('coverage pagination resumes from persisted offset without replaying accepted writes and stale review revisions reset', async () => {
  await scenario(`
    const parent=await parentFixture(),before=await snapshot(parent),guidance='Change the heading to Repair Verified. '+('Keep all the existing checked behavior. '.repeat(35));
    const child=await tasks.createSoftwareRevision(parent.id,guidance);await coverageFixture(child,'Repair Verified');
    child.revisionPlan.coverageRevision=-1;child.revisionPlan.coverageOffset=guidance.length;db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(child),child.id);
    let firstOffset;assert.equal(await tasks.reviewSoftwareRevisionCoverage(child,new AbortController().signal,async(system,user)=>{assert(system.startsWith('Revision completion reviewer.'));firstOffset=JSON.parse(user).guidancePage.offset;return {satisfied:true,reason:'This exact guidance page is represented by current output and checks.'};}),false);
    assert.equal(firstOffset,0);assert.equal(tasks.softwareTask(child.id).revisionPlan.coverageOffset,650);
    const checkpoint=await hash(join(runner.taskRoot(child.id),'app/page.tsx'));
    const resumedSource=\`
      import {strict as assert} from 'node:assert';
      const tasks=await import(\${JSON.stringify(join(studio, 'core/software-task.ts'))});
      const offsets=[];tasks.startSoftwareWorker(async(system,user)=>{assert(system.startsWith('Revision completion reviewer.'));offsets.push(JSON.parse(user).guidancePage.offset);return {satisfied:true,reason:'This remaining guidance page is represented by the same checked revision.'};});
      for(let i=0;i<100&&tasks.softwareTask(\${JSON.stringify(child.id)}).status!=='completed';i++)await new Promise(resolve=>setTimeout(resolve,2));
      tasks.shutdownSoftwareWorker();const current=tasks.softwareTask(\${JSON.stringify(child.id)});assert.equal(current.status,'completed');assert.equal(offsets[0],650);assert.equal(current.revisionPlan.coverageOffset,current.revisionPlan.guidance.length);console.log('coverage checkpoint passed');
    \`;
    const restarted=Bun.spawn([process.execPath,'-e',resumedSource],{cwd:${JSON.stringify(studio)},env:{...process.env},stdout:'pipe',stderr:'pipe'});assert.equal(await restarted.exited,0,await new Response(restarted.stderr).text());assert.equal((await new Response(restarted.stdout).text()).trim(),'coverage checkpoint passed');
    assert.equal(await hash(join(runner.taskRoot(child.id),'app/page.tsx')),checkpoint);assert.deepEqual(await snapshot(parent),before);
  `);
});

test('public binary runtime assets and extensionless scripts survive a revision clone byte for byte', async () => {
  await scenario(`
    const parent=await parentFixture(),root=runner.taskRoot(parent.id);await mkdir(join(root,'public'),{recursive:true});await mkdir(join(root,'scripts'),{recursive:true});
    const wasm=new Uint8Array([0,97,115,109,1,0,0,0,255,37]),compressed=Bun.gzipSync(wasm),media=new Uint8Array([0,0,0,24,102,116,121,112]);
    await Bun.write(join(root,'public','runtime.wasm'),wasm);await Bun.write(join(root,'public','runtime.wasm.gz'),compressed);await Bun.write(join(root,'public','sample.mp4'),media);await Bun.write(join(root,'scripts','run-helper'),'#!/usr/bin/env sh'+String.fromCharCode(10)+'echo preserved');
    const source={};for(const path of await runner.workspaceFiles(root))source[path]=new Uint8Array(await Bun.file(runner.buildPath(root,path)).arrayBuffer());const archive=zip(source);await Bun.write(join(root,'artifacts','source.zip'),archive);
    parent.evidence.artifacts[0].sha256=createHash('sha256').update(archive).digest('hex');parent.evidence.artifacts[0].bytes=archive.length;db.query('UPDATE software_tasks SET body=? WHERE id=?').run(JSON.stringify(parent),parent.id);
    const before=await snapshot(parent),child=await tasks.createSoftwareRevision(parent.id,note),target=runner.taskRoot(child.id);
    for(const path of ['public/runtime.wasm','public/runtime.wasm.gz','public/sample.mp4','scripts/run-helper'])assert.equal(await hash(join(target,path)),await hash(join(root,path)),path);
    assert.deepEqual(new Uint8Array(await Bun.file(join(target,'public','runtime.wasm')).arrayBuffer()),wasm);assert.deepEqual(Bun.gunzipSync(new Uint8Array(await Bun.file(join(target,'public','runtime.wasm.gz')).arrayBuffer())),wasm);assert.deepEqual(await snapshot(parent),before);
  `);
});

test('an unsupported eligible input fails the clone cleanly instead of silently losing application files', async () => {
  await scenario(`
    const parent=await parentFixture(),root=runner.taskRoot(parent.id),before=await snapshot(parent);await mkdir(join(root,'public'),{recursive:true});await Bun.write(join(root,'public','unsupported source.asset'),'This input must not disappear.');
    const directories=await readdir(runner.BUILD_ROOT);await assert.rejects(tasks.createSoftwareRevision(parent.id,note),/Unsupported revision source path: public\\/unsupported source.asset/);
    assert.deepEqual(await readdir(runner.BUILD_ROOT),directories);assert.equal(db.query('SELECT COUNT(*) AS n FROM software_tasks').get().n,1);assert.equal(await Bun.file(join(root,'public','unsupported source.asset')).text(),'This input must not disappear.');assert.deepEqual(await snapshot(parent),before);
  `);
});
