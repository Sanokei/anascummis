import {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const original=process.env.STUDIO_TEST_DATA!;
const db=new Database(join(original,'studio.sqlite'),{readonly:true});
const api=await import('/workspace/anascummis/apps/studio/core/app-launch-package.ts');
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const rows=db.query('SELECT id,body FROM software_tasks').all() as {id:string;body:string}[];
const results=[];
for(const row of rows){const task=JSON.parse(row.body);if(task.status!=='completed')continue;const source=join(original,'software',task.id),before={zip:await hash(join(source,'artifacts','source.zip')),page:await hash(join(source,'app/page.tsx')),body:row.body};const eligibility=await api.inspectLaunchEligibility(task);if(!eligibility.supported)throw Error(JSON.stringify(eligibility));const prepared=await api.prepareLaunchPackage(task,new AbortController().signal),again=await api.prepareLaunchPackage(task,new AbortController().signal);if(JSON.stringify(prepared.manifest)!==JSON.stringify(again.manifest))throw Error('Nondeterministic package');const after={zip:await hash(join(source,'artifacts','source.zip')),page:await hash(join(source,'app/page.tsx')),body:(db.query('SELECT body FROM software_tasks WHERE id=?').get(task.id) as {body:string}).body};if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Accepted task/artifact changed');results.push({taskId:task.id,revision:task.revision,kind:eligibility.kind,originalModelCalls:task.calls,title:eligibility.title,manifest:prepared.manifest,root:prepared.root,acceptedSourceAndTaskUnchanged:true,deterministicSecondPreparation:true});}
const receipt={scope:'Real accepted native-generated task artifacts, fixed trusted Page runtime preparation only. No new inference, browser, Next build, app server, install or model quality claim.',results};
await mkdir(process.env.STUDIO_DATA!,{recursive:true});await writeFile(join(process.env.STUDIO_DATA!,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({prepared:results.map(x=>({id:x.taskId,kind:x.kind,title:x.title,react:x.manifest.reactVersion})),unchanged:true}));
