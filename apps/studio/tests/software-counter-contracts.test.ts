import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('Reset and literal-heading host contracts validate and evolve in a child without changing their parent',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'software-counter-contract-'));
 try{
  const module=resolve(import.meta.dir,'../core/software-runner.ts');
  const source=`import {strict as assert} from 'node:assert';
    const {validateSoftwareBrowserContract,deriveSoftwareRevisionBrowserContract}=await import(${JSON.stringify(module)});
    const base={kind:'counter',label:'Count',button:'Increment',heading:'Bakery Orders',resetButton:'Reset'};
    assert.deepEqual(validateSoftwareBrowserContract(base),base);
    assert.deepEqual(deriveSoftwareRevisionBrowserContract(base,'Change the heading to Fresh Bakery and keep the counter.'),{...base,heading:'Fresh Bakery'});
    assert.deepEqual(deriveSoftwareRevisionBrowserContract(base,'Increment by two.'),{...base,delta:2});
    assert.deepEqual(deriveSoftwareRevisionBrowserContract(base,'Remove the counter.'),{kind:'counter_absent',label:'Count',button:'Increment',heading:'Bakery Orders',resetButton:'Reset'});
    assert.deepEqual(base,{kind:'counter',label:'Count',button:'Increment',heading:'Bakery Orders',resetButton:'Reset'});
    assert.throws(()=>validateSoftwareBrowserContract({...base,resetButton:'Increment'}));
    assert.throws(()=>validateSoftwareBrowserContract({...base,resetButton:' '}));
    assert.throws(()=>validateSoftwareBrowserContract({...base,heading:' '}));
    console.log('counter contract checks passed');`;
  const child=Bun.spawn([process.execPath,'-e',source],{cwd:resolve(import.meta.dir,'..'),env:{...process.env,STUDIO_DATA:folder,STUDIO_TEST_DATA:folder},stdout:'pipe',stderr:'pipe'});
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(code).toBe(0);expect(stderr).toBe('');expect(stdout).toContain('counter contract checks passed');
 }finally{await rm(folder,{recursive:true,force:true});}
});
