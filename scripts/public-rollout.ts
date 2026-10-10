import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const account='0355a48bdcf68a5e308d3eb51082eafe',appId='7df296d4-25e5-4a35-bd78-a5bb2d02a160',hostname='anascummis.com',zone='990375682216d6fb5f587ffedb57ddbe';
const backup=join(import.meta.dir,'..','.deploy-backups');await mkdir(backup,{recursive:true});
const token=process.env.CLOUDFLARE_API_TOKEN;if(!token)throw new Error('CLOUDFLARE_API_TOKEN is required');
async function api(path:string,method='GET',body?:unknown){const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await response.json() as any;if(!response.ok||!data.success)throw new Error(JSON.stringify({status:response.status,errors:data.errors}));return data.result;}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scope=(a:any)=>({id:a.id,name:a.name,domain:a.domain,policies:a.policies});
const mode=process.argv[2];
if(mode==='snapshot'){
  const apps=await api('/access/apps'),target=apps.find((a:any)=>a.id===appId);
  if(target?.domain!==hostname||target.self_hosted_domains.some((d:string)=>d!==hostname))throw new Error('Access application scope differs from the public hostname');
  const domains=await api('/workers/domains'),domain=domains.find((d:any)=>d.hostname===hostname);
  await Bun.write(join(backup,'before.json'),JSON.stringify({at:new Date().toISOString(),app:target,domain,otherApps:apps.filter((a:any)=>a.id!==appId).map((a:any)=>({id:a.id,name:a.name,hash:hash(scope(a))}))},null,2));
  console.log(JSON.stringify({saved:true,hostname,previousService:domain.service,accessPolicies:target.policies.map((p:any)=>({name:p.name,decision:p.decision})),otherApps:apps.length-1}));
}else if(mode==='domain'){
  if(!(await Bun.file(join(backup,'before.json')).exists()))throw new Error('Take a snapshot first');
  await api('/workers/scripts/anascummis-demo/domains/records','PUT',{override_scope:false,override_existing_origin:true,override_existing_dns_record:false,origins:[{hostname,zone_id:zone}]});
  const result=(await api('/workers/domains')).find((d:any)=>d.hostname===hostname);
  if(result?.service!=='anascummis-demo')throw new Error('Custom domain was not attached to the demo');
  await Bun.write(join(backup,'domain-after.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({hostname:result.hostname,service:result.service}));
}else if(mode==='public-access'){
  const current=await api(`/access/apps/${appId}`);if(current.domain!==hostname||current.self_hosted_domains.some((d:string)=>d!==hostname))throw new Error('Access scope changed');
  const before=await Bun.file(join(backup,'before.json')).json();
  const existing=current.policies.find((p:any)=>p.name==='Public Anascummis demo'&&p.decision==='bypass');
  const policy=existing||await api(`/access/apps/${appId}/policies`,'POST',{name:'Public Anascummis demo',decision:'bypass',include:[{everyone:{}}],exclude:[],require:[],precedence:0});
  await Bun.write(join(backup,'public-policy.json'),JSON.stringify(policy,null,2));
  const apps=await api('/access/apps');const unchanged=before.otherApps.every((old:any)=>{const now=apps.find((a:any)=>a.id===old.id);return now&&hash(scope(now))===old.hash;});
  console.log(JSON.stringify({hostname,policyId:policy.id,decision:policy.decision,otherAccessAppsUnchanged:unchanged}));if(!unchanged)throw new Error('Another Access application changed during rollout; inspect before continuing');
}else if(mode==='verify'){
  const apps=await api('/access/apps'),target=apps.find((a:any)=>a.id===appId),domains=await api('/workers/domains');console.log(JSON.stringify({domain:domains.find((d:any)=>d.hostname===hostname)?.service,policies:target.policies.map((p:any)=>({id:p.id,name:p.name,decision:p.decision,include:p.include}))}));
}else throw new Error('Choose snapshot, domain, public-access or verify');

