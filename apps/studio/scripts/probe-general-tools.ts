// Real local-model evaluation: isolated storage, actual production tools, observed state.
import {join} from 'node:path';
process.env.STUDIO_DATA=join(import.meta.dir,'../.runtime/tool-probes',crypto.randomUUID());
const {createProject,getProject}=await import('../core/storage');
const {siteTools}=await import('../core/tools');
const {runHarness}=await import('../core/harness');
const {infer}=await import('../core/model');
const cases=[
 {request:'Change the website title to Lantern Repair.',check:(s:any)=>s.title==='Lantern Repair'},
 {request:'Add a section with id hours, heading Opening hours, and text Tuesday through Saturday. Then change the website subtitle to Walk-ins welcome.',check:(s:any)=>s.subtitle==='Walk-ins welcome'&&s.sections.some((x:any)=>x.id==='hours'&&x.heading==='Opening hours'&&x.text==='Tuesday through Saturday')},
 {request:'Add a blue sphere named beacon at x 2, y 1, z 0, size 3. Use color #0044ff.',check:(s:any)=>s.scene.length===1&&s.scene.some((x:any)=>x.id==='beacon'&&x.kind==='sphere'&&x.color==='#0044ff'&&x.x===2&&x.y===1&&x.z===0&&x.size===3)},
];
const results=[];
for(const c of cases){const project=createProject('Tool probe');let calls=0;const start=Date.now();try{const result=await runHarness(c.request,{project},siteTools(project.id),AbortSignal.timeout(120000),async(...args)=>{calls++;return infer(...args);},{maxSteps:6});results.push({request:c.request,passed:c.check(getProject(project.id).site),calls,ms:Date.now()-start,...result});}catch(e){results.push({request:c.request,passed:false,calls,ms:Date.now()-start,error:String(e)});}console.log(JSON.stringify(results.at(-1)));}
const path=join(import.meta.dir,'../.runtime/general-tool-probe-'+Date.now()+'.json');await Bun.write(path,JSON.stringify({model:'Qwen3-0.6B-Q4_0',storage:process.env.STUDIO_DATA,results},null,2));
console.log(path);
