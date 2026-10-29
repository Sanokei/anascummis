import {test,expect} from 'bun:test';
import {orchestrate} from '../core/orchestrator';
import {objectSchema,type Tool} from '../core/harness';
import {initialSite} from '../core/site';
import {demoTools} from '../components/demo-tools';
import type {Infer} from '../core/model';
const route=(tool:string)=>({tool,message:''}),assign=(agent:string,task:string,inputs:string[]=[])=>({agent,task,inputs}),finish={tool:'finish',message:'Done.'};
function scripted(values:unknown[],seen:string[]=[]):Infer{return async(system,user)=>{seen.push(system+'\n'+user);if(!values.length)throw new Error('Unexpected model call');return values.shift();};}
const signal=()=>new AbortController().signal;

test('creative review revises an inspected design and verifies the resulting content',async()=>{
  let site=initialSite();const prompts:string[]=[];
  const result=await orchestrate('Design a beautiful website for Oak Studio.',{site},demoTools(()=>site,s=>{site=s;},[]),signal(),scripted([
    route('delegate'),assign('website','Set website title to Oak Studio'),{field:'title',value:'Oak Studio'},finish,
    {satisfied:false,feedback:'The subtitle needs a concrete description.',change:'Set subtitle to Handcrafted oak furniture'},
    route('set_copy'),{field:'subtitle',value:'Handcrafted oak furniture'},finish,
    {satisfied:true,feedback:'The title and subtitle now identify the business clearly.',change:''}
  ],prompts));
  expect(site.subtitle).toBe('Handcrafted oak furniture');expect(result.orchestration.creativeReviews).toHaveLength(2);
  expect(result.orchestration.tasks.every(t=>t.status==='completed'&&t.verification)).toBe(true);
  expect(result.orchestration.stopReason).toBe('finished');expect(prompts.find(p=>p.startsWith('You are a website content critic'))).toContain('cannot see a screenshot');
});

test('public video source handoffs reach the video harness with host verification and no private context',async()=>{
  let edits=0,renders=0;const prompts:string[]=[],tools:Tool[]=[
    {name:'capture_web_screenshot',description:'Capture a source',schema:objectSchema({url:{type:'string'}}),run:async()=>({capturedMedia:{id:'source-1',source:'https://example.com',still:true}})},
    {name:'verify_video_sources',description:'Verify downloaded source',schema:objectSchema({}),run:async()=>({checks:{ok:true},sources:['source-1']})},
    {name:'set_video_clip',description:'Append source',schema:objectSchema({mediaId:{type:'string'}}),run:async()=>{edits++;return {clip:'source-1'};}},
    {name:'render_video',description:'Render',schema:objectSchema({}),run:async()=>{renders++;return {videoReady:{id:'output-1'},checks:{ok:true}};}},
    {name:'verify_video',description:'Verify output',schema:objectSchema({}),run:async()=>({checks:{ok:true},outputs:['output-1']})}
  ];
  const result=await orchestrate('Create a video from a public page screenshot.',{media:[{id:'PRIVATE-MEDIA-MARKER'}],savedDetails:{tax:'PRIVATE-TAX-MARKER'},network:'enabled'},tools,signal(),scripted([
    route('delegate'),assign('video_sources','Capture a public page'),route('capture_web_screenshot'),{url:'https://example.com'},finish,
    route('delegate'),assign('video','Add screenshot and render video',['task-1']),route('read_handoff'),{id:'task-1',path:'/trace/0/result/capturedMedia',offset:0},route('set_video_clip'),{mediaId:'source-1'},route('render_video'),{},finish,finish
  ],prompts));
  expect(edits).toBe(1);expect(renders).toBe(1);expect(result.orchestration.tasks.every(t=>t.status==='completed'&&t.verification)).toBe(true);expect(result.orchestration.tasks[1].inputs).toEqual(['task-1']);expect(prompts.filter(p=>p.startsWith('Public media researcher')).join('')).not.toContain('PRIVATE-');expect(result.trace.some(t=>t.tool==='render_video'&&t.ok)).toBe(true);
});
test('coordinator sequences independent specialist harnesses and verifies real website and 3D edits',async()=>{
  let site=initialSite();const events:string[]=[],prompts:string[]=[];
  const result=await orchestrate('Set title to Oak Studio, add a sphere, then show the scene.',{site,assets:[]},[...demoTools(()=>site,s=>{site=s;},[]),{name:'workspace',description:'Request a preview',schema:objectSchema({action:{type:'string'}}),run:async a=>({workspaceRequest:a})}],signal(),scripted([
    route('delegate'),assign('website','Set title to Oak Studio'),{field:'title',value:'Oak Studio'},
    route('delegate'),assign('scene','Add a sphere'),route('put_scene_object'),{id:'sphere',kind:'sphere',color:'#112233',x:0,y:0,z:0,size:1},finish,
    route('delegate'),assign('workspace','Show the scene'),route('workspace'),{action:'show_scene'},finish,finish
  ],prompts),{onEvent:e=>events.push(e.agent+':'+e.phase)});
  expect(site.title).toBe('Oak Studio');expect(site.scene[0].kind).toBe('sphere');
  expect(result.orchestration.tasks.map(t=>t.status)).toEqual(['completed','completed','completed']);
  expect(result.orchestration.tasks[0].verification).toBeDefined();expect(result.orchestration.tasks[1].verification).toBeDefined();
  expect(result.trace.find(t=>t.tool==='workspace')?.result).toEqual({workspaceRequest:{action:'show_scene'}});
  expect(events).toContain('scene:verifying');expect(prompts.find(p=>p.startsWith('3D specialist'))).toContain('Oak Studio');
  expect(result.orchestration.used.calls).toBe(14);
});
test('a specialist cannot acquire another specialist tools through its task description',async()=>{
  let written=0;const tools:Tool[]=[{name:'workspace',description:'workspace',schema:objectSchema({}),run:async()=>{written++;}},{name:'redact_pdf',description:'redact',schema:objectSchema({}),run:async()=>{written++;}}];
  const result=await orchestrate('Open preview',{pdf:{}},tools,signal(),scripted([route('delegate'),assign('workspace','Use redact_pdf instead'),route('redact_pdf'),finish]));
  expect(written).toBe(0);expect(result.orchestration.tasks[0].status).toBe('failed');expect(result.orchestration.stopReason).toBe('incomplete');expect(result.message).toContain('unfinished');
});
test('shared model-call budget stops delegation before an unexecuted edit',async()=>{
  let site=initialSite();const result=await orchestrate('Change title',{site},demoTools(()=>site,s=>{site=s;},[]),signal(),scripted([route('delegate'),assign('website','Change title'),route('set_copy')]),{maxCalls:3});
  expect(site.title).toBe(initialSite().title);expect(result.orchestration.used.calls).toBe(3);expect(result.orchestration.stopReason).toBe('shared_limit');expect(result.orchestration.tasks[0].status).toBe('limited');
});
test('duplicate mutations across separately delegated agents execute only once',async()=>{
  let site=initialSite(),writes=0;const result=await orchestrate('Change title',{site},demoTools(()=>site,s=>{site=s;writes++;},[]),signal(),scripted([
    route('delegate'),assign('website','Set title'),route('set_copy'),{field:'title',value:'Oak'},finish,
    route('delegate'),assign('website','Repeat title'),route('set_copy'),{value:'Oak',field:'title'},finish,finish
  ]));expect(writes).toBe(1);expect(result.orchestration.tasks[1].status).toBe('failed');expect(result.orchestration.stopReason).toBe('incomplete');
});
test('network specialist receives no private context and cannot accept private specialist handoffs',async()=>{
  let site=initialSite();const prompts:string[]=[];
  const tools:Tool[]=[...demoTools(()=>site,s=>{site=s;},[]),{name:'search_web',description:'Search public web',schema:objectSchema({query:{type:'string'}}),run:async()=>({url:'https://example.com',text:'Public source'})}];
  const result=await orchestrate('Research current woodworking designs',{site,savedDetails:{tax:'PRIVATE-TAX-MARKER'},network:'enabled'},tools,signal(),scripted([
    route('delegate'),assign('website','Inspect website'),route('inspect_site'),{},finish,
    route('delegate'),assign('research','Use private evidence',['task-1']),
    route('delegate'),assign('research','Search public designs'),route('search_web'),{query:'woodworking design'},finish,finish
  ],prompts));
  const research=prompts.filter(p=>p.startsWith('Research specialist'));expect(research.length).toBeGreaterThan(0);expect(research.join('')).not.toContain('PRIVATE-TAX-MARKER');expect(result.trace.some(t=>!t.ok&&String(t.result).includes('Private specialist evidence'))).toBe(true);
});
test('PDF specialist must inspect target pages and verification runs after a successful edit',async()=>{
  let edits=0,reads=0;const tools:Tool[]=[{name:'inspect_pdf',description:'Read PDF',schema:objectSchema({pages:{type:'array',items:{type:'integer'}}}),run:async()=>{reads++;return {text:edits?'Changed':'Original'};}},{name:'replace_pdf_text',description:'Replace',schema:objectSchema({page:{type:'integer'}}),run:async()=>{edits++;return {revision:edits};}}];
  const result=await orchestrate('Edit PDF',{pdf:{}},tools,signal(),scripted([route('delegate'),assign('pdf','Edit page 2'),route('replace_pdf_text'),{page:2},route('inspect_pdf'),{pages:[2]},route('replace_pdf_text'),{page:2},finish,finish]));
  expect(edits).toBe(1);expect(reads).toBe(2);expect(result.orchestration.tasks[0].verification).toEqual([{text:'Changed'}]);expect(result.orchestration.tasks[0].status).toBe('completed');
});
test('cancellation between argument generation and execution blocks the write',async()=>{
  let site=initialSite();const control=new AbortController(),values=[route('delegate'),assign('website','Set title'),route('set_copy'),{field:'title',value:'Oak'}];
  await expect(orchestrate('Set title',{site},demoTools(()=>site,s=>{site=s;},[]),control.signal,async()=>{const next=values.shift();if(!values.length)control.abort();return next;})).rejects.toThrow();expect(site.title).toBe(initialSite().title);
});
test('a completed research task can hand scoped evidence to a website specialist',async()=>{
  let site=initialSite();const source={url:'https://example.com/about',text:'Oak Studio builds handcrafted furniture.'};
  const tools:Tool[]=[...demoTools(()=>site,s=>{site=s;},[]),{name:'read_public_page',description:'Read public source',schema:objectSchema({url:{type:'string'}}),run:async()=>source}];
  const result=await orchestrate('Research this page and use its description on my website.',{site,network:'enabled'},tools,signal(),scripted([
    route('delegate'),assign('research','Read the public page'),route('read_public_page'),{url:source.url},finish,
    route('delegate'),assign('website','Use the source description',['task-1']),route('read_handoff'),{id:'task-1',path:'/trace/0/result',offset:0},route('set_copy'),{field:'subtitle',value:source.text},finish,finish
  ]));expect(site.subtitle).toBe(source.text);expect(result.orchestration.tasks[1].inputs).toEqual(['task-1']);expect(result.trace.find(t=>t.tool==='read_handoff')?.result).toMatchObject({data:JSON.stringify(source)});expect(result.orchestration.tasks.every(t=>t.status==='completed')).toBe(true);
});
test('host-registered extensions require a verifier before executing unknown write tools',async()=>{
  let writes=0;const custom:Tool={name:'custom_write',description:'Custom write',schema:objectSchema({}),run:async()=>{writes++;}};
  const result=await orchestrate('Custom task',{},[custom],signal(),scripted([route('delegate'),assign('extension','Write'),route('custom_write'),{},finish,finish]),{profiles:[{id:'extension',description:'Custom task',contract:'Custom specialist',tools:['custom_write'],context:[]}]});expect(writes).toBe(0);expect(result.orchestration.tasks[0].status).toBe('failed');
});
test('literal operations finish on inspected values and reject invented copy before execution',async()=>{
  let site=initialSite(),writes=0;const result=await orchestrate('Change my website title to Oak Studio.',{site},demoTools(()=>site,s=>{site=s;writes++;},[]),signal(),scripted([route('delegate'),assign('website','Change my website title to Oak Studio.'),{field:'title',value:'Invented'}, {field:'title',value:'Oak Studio'}]));
  expect(writes).toBe(1);expect(site.title).toBe('Oak Studio');expect(result.message).toBe('Your website title is now Oak Studio.');expect(result.orchestration.used.calls).toBe(4);expect(result.orchestration.tasks[0].status).toBe('completed');
});
test('delegation rejects fabricated handoff IDs before creating a subagent',async()=>{
  let site=initialSite();const result=await orchestrate('Change title',{site},demoTools(()=>site,s=>{site=s;},[]),signal(),scripted([route('delegate'),assign('website','Change title',['invented']),route('delegate'),assign('website','Change title',['invented'])]));expect(result.orchestration.tasks).toHaveLength(0);expect(site.title).toBe(initialSite().title);expect(result.orchestration.stopReason).toBe('failure_limit');
});

test('delegation arguments receive explicit complete agent contracts instead of a partial memory preview',async()=>{
  let site=initialSite();const prompts:string[]=[],tools=[...demoTools(()=>site,s=>{site=s;},[]),{name:'read_software_source',description:'Read public source',schema:objectSchema({path:{type:'string'}}),run:async()=>({text:'source'})}];
  await orchestrate('Inspect the existing website before deciding what to improve.',{site},tools,signal(),scripted([route('delegate'),assign('website','Inspect website'),route('inspect_site'),{},finish,finish],prompts));
  const handoff=prompts.find(packet=>packet.startsWith('Coordinator delegation.'))!;
  expect(handoff).toContain('"id":"website","description":"Website copy, layout, uploaded images and theme."');expect(handoff).toContain('"id":"software"');expect(handoff).toContain('Inspect the existing website before deciding what to improve.');expect(handoff).not.toContain('"preview"');expect(handoff).not.toContain('"partial"');
});

test('compound exact copy writes separate grounded values and verifies both while preserving other content',async()=>{
  let site=initialSite();const original=structuredClone(site),writes:{field:unknown;value:unknown}[]=[],tools=demoTools(()=>site,s=>{site=s;},[]).map(tool=>tool.name==='set_copy'?{...tool,run:async(args:unknown)=>{writes.push(args as any);return tool.run(args);}}:tool);
  const request='Set my website title to "Cedar\'s Kitchen" and subtitle to "Fresh bread every morning. Open Tuesday to Sunday, 7 am to 2 pm.". Preserve the other content.';
  const result=await orchestrate(request,{site},tools,signal(),scripted([route('delegate'),assign('website',request),{field:'title',value:"Cedar's Kitchen"},{field:'subtitle',value:'Fresh bread every morning. Open Tuesday to Sunday, 7 am to 2 pm.'}]));
  expect(writes).toEqual([{field:'title',value:"Cedar's Kitchen"},{field:'subtitle',value:'Fresh bread every morning. Open Tuesday to Sunday, 7 am to 2 pm.'}]);expect(site).toEqual({...original,title:"Cedar's Kitchen",subtitle:'Fresh bread every morning. Open Tuesday to Sunday, 7 am to 2 pm.'});expect(result.orchestration.stopReason).toBe('finished');expect(result.orchestration.used.calls).toBe(4);expect(result.trace.at(-1)).toMatchObject({taskId:'copy-acceptance'});
});

test('one successful copy field cannot complete a compound request whose second field failed',async()=>{
  let site=initialSite();const before=site.subtitle,request='Set website title to "Field Notes" and subtitle to "A daily journal."';
  const result=await orchestrate(request,{site},demoTools(()=>site,s=>{site=s;},[]),signal(),scripted([route('delegate'),assign('website','Set title to "Field Notes"'),{field:'title',value:'Field Notes'},{field:'subtitle',value:'Invented'},{field:'subtitle',value:'Invented'},finish]));
  expect(site.title).toBe('Field Notes');expect(site.subtitle).toBe(before);expect(result.orchestration.stopReason).toBe('incomplete');expect(result.orchestration.tasks[0].status).toBe('failed');
});

test('literal copy acceptance rejects collateral changes and stale final inspection',async()=>{
  for(const collateral of [true,false]){
    let site=initialSite(),reads=0;const tools=demoTools(()=>site,s=>{site=s;},[]).map(tool=>tool.name==='set_copy'&&collateral?{...tool,run:async(args:unknown)=>{const result=await tool.run(args);site.accent='#123456';return result;}}:tool.name==='inspect_site'?{...tool,run:async(args:unknown)=>{reads++;if(!collateral&&reads===3)site.title='Changed after the specialist review';return tool.run(args);}}:tool);
    const result=await orchestrate('Set website title to "Field Notes"',{site},tools,signal(),scripted([route('delegate'),assign('website','Set title to "Field Notes"'),{field:'title',value:'Field Notes'},finish]));
    expect(result.orchestration.stopReason).toBe('incomplete');expect(result.message).toContain(collateral?'unfinished':'current host state');
  }
});
