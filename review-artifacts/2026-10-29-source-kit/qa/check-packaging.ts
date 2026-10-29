import {createSourceKit} from '/workspace/anascummis/apps/studio/scripts/publish-sources';
import {mkdtemp,symlink,writeFile,mkdir,unlink,rename,rm} from 'node:fs/promises';import {join} from 'node:path';import assert from 'node:assert/strict';
const summary=await Bun.file('/workspace/anascummis/apps/studio/out/opensource/manifest.json').json(),data=await mkdtemp('/workspace/.cloud-env/anascummis/distribution/package-check-'),extraction=join(data,'extract');
const p=Bun.spawn([process.env.PYTHON_PATH||'python','/workspace/.cloud-env/anascummis/distribution/audit-kit.py','/workspace/anascummis/apps/studio/out/opensource/'+summary.filename,'/workspace/anascummis/apps/studio/out/opensource/manifest.json',extraction],{stdout:'inherit',stderr:'inherit'});assert.equal(await p.exited,0);
const root=join(extraction,'studio');await symlink('/workspace/anascummis/apps/studio/node_modules',join(root,'node_modules'),'dir');
const one=await createSourceKit(root,join(data,'repacked'));assert.equal(one.version,summary.version);assert.equal(one.sha256,summary.sha256);
const secret=join(data,'sentinel.txt');await writeFile(secret,'PUBLIC QA SENTINEL, NOT A REAL SECRET');
const dummy=['.env','.data/studio.sqlite','.runtime/model.gguf','app/secrets.json','app/test.key','app/cache/trace.ts','worker/__pycache__/compiled.pyc'];
for(const path of dummy){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'PUBLIC QA SENTINEL');}
const filtered=await createSourceKit(root,join(data,'filtered'));assert.equal(filtered.sha256,summary.sha256);
await symlink(secret,join(root,'app/leak.ts'));await assert.rejects(()=>createSourceKit(root,join(data,'unsafe')),/symbolic link/);await unlink(join(root,'app/leak.ts'));
await rename(join(root,'bun.lock'),join(root,'bun.lock.hold'));try{await assert.rejects(()=>createSourceKit(root,join(data,'missing-lock')));}finally{await rename(join(root,'bun.lock.hold'),join(root,'bun.lock'));}
for(const path of ['.env','.data','.runtime','app/secrets.json','app/test.key','app/cache','worker/__pycache__'])await rm(join(root,path),{recursive:true,force:true});
const again=await createSourceKit(root,join(data,'again'));assert.equal(again.sha256,summary.sha256);
const result={version:summary.version,sha256:summary.sha256,cleanExtractionRepackByteIdentical:true,privateDummyInputsExcluded:true,sourceSymlinkRejected:true,missingLockRejected:true,restoredRepackByteIdentical:true,noDependenciesOrModelsDownloaded:true,extraction:root};await Bun.write(join(data,'lifecycle.json'),JSON.stringify(result,null,2)+'\n');console.log('Package checks passed:',data);
