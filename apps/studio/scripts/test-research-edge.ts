import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {strict as assert} from 'node:assert';

// Run the actual demo handler in workerd. Only the upstream is a deterministic
// fixture; native Request validates the redirect mode before the fixture runs.
const root=resolve(import.meta.dir,'..'),allowed=join(root,'.test-data');
await mkdir(allowed,{recursive:true});
const temp=await mkdtemp(join(allowed,'research-edge-'));
if(!resolve(temp).startsWith(allowed+sep))throw Error('Unsafe test directory');
const entry=String.raw`
import demo from '../../worker/demo';
export {PeerRoom} from '../../worker/peer-room';
export {GoalDirectory} from '../../worker/goal-directory';
const rss='<rss><channel><item><title>Verified headline</title><link>https://news.google.com/articles/test</link><source>Test publisher</source></item></channel></rss>';
export default {async fetch(request:Request,env:Env){
  if(new URL(request.url).pathname==='/health')return new Response(null,{status:204});
  const scenario=await request.json() as {route?:string;status?:number;location?:string;failure?:string;commonsRedirect?:boolean;legacy?:boolean;deny?:boolean};
  if(scenario.legacy){try{new Request('https://news.google.com/',{redirect:'error'});return Response.json({legacyRejected:false});}catch(e){return Response.json({legacyRejected:String(e).includes('Invalid redirect value')});}}
  const calls:{url:string;redirect:string;authorization:string|null;cookie:string|null;builder:string|null}[]=[];let cancelled=false;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const upstream=new Request(input,init);
    calls.push({url:upstream.url,redirect:upstream.redirect,authorization:upstream.headers.get('authorization'),cookie:upstream.headers.get('cookie'),builder:upstream.headers.get('x-builder-key')});
    if(scenario.failure==='network')throw Error('fixture connection failed');
    if(scenario.status)return new Response(scenario.status===304?null:new ReadableStream({cancel(){cancelled=true;}}),{status:scenario.status,headers:scenario.location?{Location:scenario.location}:{}});
    if(scenario.failure==='size')return new Response('x'.repeat(500001));
    if(upstream.url.startsWith('https://news.google.com/'))return new Response(rss);
    if(upstream.url.startsWith('https://en.wikipedia.org/'))return Response.json({query:{pages:{1:{title:'Test topic',extract:'Background'}}}});
    if(scenario.commonsRedirect)return new Response(null,{status:302,headers:{Location:'https://evil.example/'}});
    return Response.json({query:{pages:{2:{imageinfo:[{mime:'image/jpeg',thumburl:'https://upload.wikimedia.org/test.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Test.jpg',extmetadata:{LicenseShortName:{value:'CC BY-SA'},Artist:{value:'Test artist'}}}]}}}});
  }) as typeof fetch;
  try{
    const client=new Request('https://anascummis.com'+(scenario.route||'/api/news'),{method:'POST',headers:{Origin:scenario.deny?'https://evil.example':'https://anascummis.com','X-Requested-With':'Anascummis',Authorization:'Bearer test-client-only',Cookie:'test-client-only=1','X-Builder-Key':'test-client-only','Content-Type':'application/json'},body:JSON.stringify({query:'Test topic'})});
    const response=await demo.fetch(client,env);
    return Response.json({status:response.status,body:await response.json(),calls,cancelled});
  }finally{globalThis.fetch=originalFetch;}
}};
`;
await Bun.write(join(temp,'entry.ts'),entry);
await Bun.write(join(temp,'wrangler.jsonc'),JSON.stringify({name:'anascummis-research-test',main:'entry.ts',compatibility_date:'2026-10-07',workers_dev:false,observability:{enabled:false},durable_objects:{bindings:[{name:'PEER_ROOMS',class_name:'PeerRoom'},{name:'GOAL_DIRECTORY',class_name:'GoalDirectory'}]},migrations:[{tag:'test-v1',new_sqlite_classes:['PeerRoom','GoalDirectory']}]},null,2));
const proc=Bun.spawn(['node',join(root,'node_modules','wrangler','bin','wrangler.js'),'dev','--local','--config',join(temp,'wrangler.jsonc'),'--port','17891','--inspector-port','17892','--show-interactive-dev-session=false'],{cwd:root,stdout:'inherit',stderr:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const endpoint='http://127.0.0.1:17891';
let count=0;
async function probe(value:Record<string,unknown>){const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);count++;return await response.json() as any;}
function boundary(result:any){for(const request of result.calls){assert.equal(request.redirect,'manual');assert.equal(request.authorization,null);assert.equal(request.cookie,null);assert.equal(request.builder,null);assert.ok(/^https:\/\/(news\.google\.com|en\.wikipedia\.org|commons\.wikimedia\.org)\//.test(request.url));}}
try{
  let ready=false;for(let attempt=0;attempt<60;attempt++){if(proc.exitCode!==null)throw Error('Worker test process exited');try{ready=(await fetch(endpoint+'/health',{signal:AbortSignal.timeout(500)})).status===204;if(ready)break;}catch{}await Bun.sleep(500);}
  if(!ready)throw Error('Local workerd did not start');
  assert.equal((await probe({legacy:true})).legacyRejected,true);
  let result=await probe({});assert.equal(result.status,200);assert.equal(result.body.results[0].title,'Verified headline');assert.equal(result.calls.length,1);boundary(result);
  result=await probe({route:'/api/visual'});assert.equal(result.status,200);assert.equal(result.body.image.credit,'Test artist');assert.equal(result.calls.length,2);boundary(result);
  for(const status of [301,302,303,304,307,308]){result=await probe({status,location:'https://evil.example/'});assert.equal(result.status,502);assert.match(result.body.error,/redirects are not allowed/);assert.equal(result.calls.length,1);if(status!==304)assert.equal(result.cancelled,true);boundary(result);}
  for(const location of ['https://news.google.com/rss/search','/rss/search','http://127.0.0.1/private']){result=await probe({status:302,location});assert.equal(result.status,502);assert.equal(result.calls.length,1);boundary(result);}
  result=await probe({route:'/api/visual',commonsRedirect:true});assert.equal(result.status,200);assert.equal(result.body.image,undefined);assert.equal(result.calls.length,2);boundary(result);
  result=await probe({failure:'network'});assert.equal(result.status,502);assert.match(result.body.error,/connection failed/);assert.equal(result.calls.length,1);
  result=await probe({status:503});assert.equal(result.status,502);assert.match(result.body.error,/News retrieval unavailable/);assert.equal(result.calls.length,1);
  result=await probe({failure:'size'});assert.equal(result.status,502);assert.match(result.body.error,/News response too large/);
  result=await probe({deny:true});assert.equal(result.status,403);assert.equal(result.calls.length,0);
  console.log(count+' workerd probes passed, including reproduction of the unsupported legacy mode and authentication boundaries.');
}finally{
  if(process.platform==='win32')await Bun.spawn(['taskkill','/PID',String(proc.pid),'/T','/F'],{stdout:'ignore',stderr:'ignore'}).exited;else proc.kill();await proc.exited;
  if(!resolve(temp).startsWith(allowed+sep))throw Error('Unsafe test cleanup');
  await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:300}).catch(error=>console.warn('Test temporary files retained: '+error.code));
}
