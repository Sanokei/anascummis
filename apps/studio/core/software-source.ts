import {resolve,join} from 'node:path';
import {readdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dir,'..');
const roots=['core','components'];
/** Read-only capability: public project source only. No vault, .data, env, dependencies or arbitrary paths. */
export async function sourceCatalog(){const files:{path:string;characters:number;sha256:string}[]=[];for(const folder of roots){for(const entry of await readdir(join(root,folder),{withFileTypes:true})){if(!entry.isFile()||!/^[-\w]+\.(?:ts|tsx)$/.test(entry.name))continue;const path=folder+'/'+entry.name,full=join(root,path);if(await realpath(full)!==full)continue;const body=await Bun.file(full).text();if(body.length>100000)continue;files.push({path,characters:body.length,sha256:createHash('sha256').update(body).digest('hex')});}}return files;}
export async function readOwnSource(path:string,offset=0){const item=(await sourceCatalog()).find(item=>item.path===path);if(!item)throw new Error('Source is not in the public source catalog');if(!Number.isInteger(offset)||offset<0||offset>=item.characters)throw new Error('Invalid source offset');const body=await Bun.file(join(root,path)).text();return {...item,offset,source:body.slice(offset,offset+900),partial:offset+900<body.length,next:offset+900<body.length?offset+900:null};}
