import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {command} from '../core/software-runner';

test('generated source commands receive browser/cache settings without proxy or credential bindings',async()=>{
  const root=await mkdtemp(join(process.env.STUDIO_TEST_DATA||tmpdir(),'command-env-'));
  try{
    const result=await command([process.execPath,'-e',"console.log(JSON.stringify({proxy:['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'].some(key=>!!process.env[key]),credential:['GH_TOKEN','GITHUB_TOKEN','BRAVE_SEARCH_KEY'].some(key=>!!process.env[key]),browser:!!process.env.STUDIO_BROWSER_EXE,cache:!!process.env.BUN_INSTALL_CACHE_DIR}))"],root,new AbortController().signal);
    expect(result.ok).toBe(true);
    const observed=JSON.parse(result.detail);
    expect(observed.proxy).toBe(false);expect(observed.credential).toBe(false);
    expect(observed.browser).toBe(!!process.env.STUDIO_BROWSER_EXE);
    expect(observed.cache).toBe(!!process.env.BUN_INSTALL_CACHE_DIR);
  }finally{await rm(root,{recursive:true,force:true});}
});
