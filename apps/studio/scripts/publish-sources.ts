import {createHash} from 'node:crypto';
// Publish corresponding source alongside the Etro-containing browser bundle.
// Explicit folders exclude personal data, model weights, credentials and generated output.
import {join} from 'node:path';
import {readdir,stat,mkdir} from 'node:fs/promises';
import {zip} from '../core/zip';
const root=join(import.meta.dir,'..'),files:Record<string,Uint8Array>={};
async function add(base:string,path:string,prefix:string){const full=join(base,path);if(path.split(/[\\/]/).includes('__pycache__')||/\.py[co]$/.test(path))return;if((await stat(full)).isDirectory()){for(const child of await readdir(full))await add(base,join(path,child),prefix);}else files[prefix+'/'+path.replaceAll('\\','/')]=new Uint8Array(await Bun.file(full).arrayBuffer());}
for(const folder of ['app','components','core','scripts','licenses','worker','acceptance','tests'])await add(root,folder,'studio');
if(await Bun.file(join(root,'public','orb-embed.jpg')).exists())await add(root,'public/orb-embed.jpg','studio');
await add(root,'public/voice-capture.js','studio');
for(const name of ['package.json','bun.lock','requirements.txt','LOCAL-INSTALL.md','tsconfig.core.json','tsconfig.json','next-env.d.ts','PROVENANCE.md','next.config.ts','VIDEO.md','SMALL-MODEL.md','SURFACES.md','REALTIME.md','PEERS.md','SOFTWARE.md','tsconfig.worker.json','wrangler.demo.jsonc','.env.example'])if(await Bun.file(join(root,name)).exists())await add(root,name,'studio');
// Make the extracted studio independent of the monorepo's ../../src alias.
const packagedTypes=join(root,'shared','types.ts'),sharedTypes=await Bun.file(packagedTypes).exists()?packagedTypes:join(root,'..','..','src','shared','types.ts');
files['studio/shared/types.ts']=new Uint8Array(await Bun.file(sharedTypes).arrayBuffer());
const config=JSON.parse(new TextDecoder().decode(files['studio/tsconfig.json']));
config.compilerOptions.paths={...config.compilerOptions.paths,'@shared/types':['./shared/types.ts']};
files['studio/tsconfig.json']=new TextEncoder().encode(JSON.stringify(config,null,2)+'\n');
const etro=join(root,'node_modules','etro');for(const name of ['src','LICENSE','README.md','package.json','rollup.config.js','tsconfig.json'])await add(etro,name,'dependencies/etro');
files['README.txt']=new TextEncoder().encode('Anascummis Studio local source kit for this deployment. Start with studio/LOCAL-INSTALL.md. Bun and Python are required; install dependencies and models before running. This is not a prebuilt desktop installer. Etro 0.14.1 is GPL-3.0; its full license and corresponding source are included in dependencies/etro. No personal data, credentials, model weights or downloaded media are included.');
const output=join(root,'.demo-assets','opensource');await mkdir(output,{recursive:true});await Bun.write(join(output,'anascummis-studio-source.zip'),zip(files));await Bun.write(join(output,'etro-GPL-3.0.txt'),Bun.file(join(etro,'LICENSE')));console.log('Published corresponding source and Etro license.');

const catalog=Object.fromEntries(Object.entries(files).filter(([path])=>/^studio\/(core|components)\/[-\w]+\.(ts|tsx)$/.test(path)).map(([path,body])=>[path.slice(7),{source:new TextDecoder().decode(body),sha256:createHash('sha256').update(body).digest('hex')}]));await Bun.write(join(output,'source-catalog.json'),JSON.stringify(catalog));
