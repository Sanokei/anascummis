import {join,relative,dirname} from 'node:path';
import {mkdir,readdir,copyFile,stat} from 'node:fs/promises';
const root=join(import.meta.dir,'..'),input=join(root,'out'),output=join(root,'.demo-assets');
await mkdir(output,{recursive:true});const headers:string[]=[];
for(const name of await readdir(input,{recursive:true})){
  const source=join(input,name);if(!(await stat(source)).isFile())continue;
  const destination=join(output,name);await mkdir(dirname(destination),{recursive:true});
  const size=(await stat(source)).size;
  if(size>25*1024**2){
    if(!name.endsWith('.wasm'))throw new Error(`Asset exceeds Cloudflare's limit: ${name}`);
    const compressed=Bun.gzipSync(new Uint8Array(await Bun.file(source).arrayBuffer()));
    if(compressed.length>25*1024**2)throw new Error(`Compressed asset still exceeds limit: ${name}`);
    await Bun.write(destination,compressed);
    headers.push('/'+relative(output,destination).replaceAll('\\','/'),'  Content-Encoding: gzip','  Content-Type: application/wasm','');
    console.log(`Compressed WASM: ${size} → ${compressed.length} bytes`);
  }else await copyFile(source,destination);
}
await Bun.write(join(output,'_headers'),headers.join('\n'));
