import {join} from 'node:path';
const root=join(import.meta.dir,'..'),production=process.argv.includes('--production');
const children:ReturnType<typeof Bun.spawn>[]=[];
if(!production){const next=join(root,'node_modules','next','dist','bin','next');if(!(await Bun.file(next).exists()))throw new Error('Run bun install inside apps/studio first');children.push(Bun.spawn([process.execPath,next,'dev','--hostname','127.0.0.1','--port','3212'],{cwd:root,stdout:'inherit',stderr:'inherit'}));}
children.push(Bun.spawn([process.execPath,join(root,'core','server.ts')],{cwd:root,stdout:'inherit',stderr:'inherit',env:{...process.env,STUDIO_DEV:production?'0':'1'}}));
const stop=()=>{for(const c of children)c.kill();};process.on('SIGINT',stop);process.on('SIGTERM',stop);await Promise.race(children.map(c=>c.exited));stop();
