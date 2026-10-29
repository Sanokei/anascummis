import {resolve,sep} from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
const root=resolve(import.meta.dir,'..'),allowed=resolve(root,'.test-data'),temp=resolve(allowed,crypto.randomUUID());
if(!temp.startsWith(allowed+sep))throw new Error('Unsafe test directory');await mkdir(temp,{recursive:true});
const child=Bun.spawn([process.execPath,'test','tests'],{cwd:root,stdout:'inherit',stderr:'inherit',env:{...process.env,STUDIO_TEST_DATA:temp,STUDIO_DATA:temp}});
const code=await child.exited;
// Windows closes Bun's SQLite handles only when the test process has exited.
await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});process.exit(code);
