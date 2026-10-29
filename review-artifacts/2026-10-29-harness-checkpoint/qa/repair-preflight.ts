import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createSoftwareTask,softwareTask} from '/workspace/anascummis/apps/studio/core/software-task';
import {taskRoot,writeSource,verifyRuntime} from '/workspace/anascummis/apps/studio/core/software-runner';
import {compileNumericScreen} from '/workspace/anascummis/apps/studio/core/react-screen';
import {db} from '/workspace/anascummis/apps/studio/core/storage';

const parent=process.env.REPAIR_PARENT_ID?softwareTask(process.env.REPAIR_PARENT_ID):await createSoftwareTask('Create a Bun Nextjs React app with heading Repair Baseline and a counter that starts at zero, increments by one, and resets on reload.',['zip']);
const root=taskRoot(parent.id);
await writeSource(root,'app/page.tsx',compileNumericScreen({title:'Repair Baseline',outputLabel:'Count',buttonLabel:'Increment',initial:0,delta:1}));
await writeSource(root,'tests/app.test.tsx',`import {test,expect} from 'bun:test';import {renderToStaticMarkup} from 'react-dom/server';import Page from '../app/page';test('baseline heading and counter controls render',()=>{const html=renderToStaticMarkup(<Page/>);expect(html).toContain('Repair Baseline');expect(html).toContain('aria-label="Count"');expect(html).toContain('Increment');});`);
await mkdir(join(root,'.qa'),{recursive:true});
await Bun.write(join(root,'.qa','browser-contract.json'),JSON.stringify({kind:'counter',label:'Count',button:'Increment'}));
const manifest=await Bun.file(join(root,'package.json')).json();if(manifest.dependencies.next!=='16.4.3')throw new Error('Security fixture must start on patched Next 16.4.3');
console.log('parent fixture',parent.id,root);
const evidence=await verifyRuntime(parent.id,1,new AbortController().signal,phase=>console.log('phase',phase),true,['zip']);
await Bun.write('/workspace/.cloud-env/anascummis/security-upgrade/preflight-evidence.json',JSON.stringify({parentId:parent.id,root,evidence},null,2));
console.log(JSON.stringify(evidence.checks.map(check=>({id:check.id,ok:check.ok,detail:check.ok?check.detail.slice(0,100):check.detail.slice(-2000)})),null,2));
if(evidence.checks.some(check=>!check.ok)||!evidence.artifacts.some(artifact=>artifact.smokeTested))process.exit(1);
if(!evidence.headings?.includes('Repair Baseline'))throw new Error('Accepted parent needs its actual baseline heading');
parent.revision=1;parent.status='completed';parent.phase='completed';parent.message='Accepted fixture: real production build, counter browser behavior and source ZIP passed.';parent.planningDone=true;parent.evidence=evidence;parent.counterContract=true;
parent.requirements=[
 {id:'heading',description:'The main heading is Repair Baseline.',status:'verified',files:['app/page.tsx'],tests:['tests/app.test.tsx'],reviewRevision:1,note:'Actual production heading inspected.'},
 {id:'counter',description:'Count starts at zero, Increment produces one then two, and reload resets it to zero.',status:'verified',files:['app/page.tsx'],tests:['tests/app.test.tsx'],reviewRevision:1,note:'Actual production browser counter contract passed.'}
];
db.query('UPDATE software_tasks SET body=?,updated=? WHERE id=?').run(JSON.stringify(parent),Date.now(),parent.id);
await Bun.write('/workspace/.cloud-env/anascummis/security-upgrade/repair-parent.json',JSON.stringify({parentId:parent.id,root,data:process.env.STUDIO_DATA},null,2));
console.log('Accepted fixture saved with real checked artifacts');
