import { join } from 'node:path';
const root=join(import.meta.dir,'..');
const pythonPath=join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const run=async(args:string[])=>{const p=Bun.spawn(args,{cwd:root,stdout:'inherit',stderr:'inherit'});if(await p.exited)throw new Error(`${args[0]} failed`);};
if(Bun.which('uv')){
  if(!(await Bun.file(pythonPath).exists()))await run(['uv','venv','.venv']);
  await run(['uv','pip','install','--python',process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python','-r','requirements.txt']);
}else{
  if(!(await Bun.file(pythonPath).exists()))await run(['python','-m','venv','.venv']);
  await run([process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python','-m','pip','install','-r','requirements.txt']);
}
console.log('PDF engine ready. Next: bun run model:setup, then bun run start.');
