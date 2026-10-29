import {test,expect} from 'bun:test';
import {copyFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// These are scripted launcher checks, not native inference or model-quality
// checks. The copied launcher gets isolated placeholder weights; its spawn is
// redirected to a real, short-lived Bun child that never listens on a port.
for(const code of [0,23]){
  test(`model launcher preserves child exit code ${code}`,async()=>{
    const folder=await mkdtemp(join(process.env.STUDIO_TEST_DATA||tmpdir(),'model-launcher-'));
    try{
      const scripts=join(folder,'scripts'),runtime=join(folder,'.runtime');
      await mkdir(scripts);await mkdir(runtime);
      const launcher=join(scripts,'model.ts'),weights=join(runtime,'Qwen3-0.6B-Q4_0.gguf');
      await copyFile(join(import.meta.dir,'../scripts/model.ts'),launcher);
      await Bun.write(weights,'isolated launcher fixture, not model weights');
      const fakeChild=join(folder,'fake-child.ts');
      await Bun.write(fakeChild,`console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.exit(${code});`);
      const entry=`
        const spawn=Bun.spawn.bind(Bun);
        let calls=0;
        Bun.spawn=(args,options)=>{
          if(++calls!==1||args[0]!==process.execPath)throw new Error('Unexpected launcher child');
          return spawn([process.execPath,${JSON.stringify(fakeChild)},...args.slice(1)],options);
        };
        await import(${JSON.stringify(launcher)});
      `;
      const child=Bun.spawn([process.execPath,'-e',entry],{
        cwd:folder,env:{...process.env,LLAMA_SERVER:process.execPath},stdout:'pipe',stderr:'pipe'
      });
      const [actual,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
      expect(stderr).toBe('');
      expect(actual).toBe(code);
      const received=JSON.parse(stdout.trim()) as {args:string[];cwd:string};
      expect(received.args.slice(0,2)).toEqual(['-m',weights]);
      expect(received.cwd).toBe(runtime);
    }finally{await rm(folder,{recursive:true,force:true});}
  });
}
