// Integration probe: actual loopback Qwen, disposable in-memory website.
import {orchestrate} from '../core/orchestrator';
import {infer,modelStatus} from '../core/model';
import {initialSite} from '../core/site';
import {demoTools} from '../components/demo-tools';
if(!(await modelStatus()).ready)throw new Error('Start the local Qwen runtime first');
let site=initialSite();const calls:unknown[]=[],start=performance.now();
const result=await orchestrate('Change my website title to Oak Studio.',{site,assets:[]},demoTools(()=>site,s=>{site=s;},[]),AbortSignal.timeout(120000),async(...args)=>{
  const started=performance.now(),value=await infer(...args);calls.push({milliseconds:Math.round(performance.now()-started),value});console.log(JSON.stringify(calls.at(-1)));return value;
},{maxCalls:16,maxActions:8,onEvent:event=>console.log(event.agent,event.phase)});
const proof={model:'Qwen3-0.6B Q4_0, llama.cpp, CPU, four threads',milliseconds:Math.round(performance.now()-start),title:site.title,passed:site.title==='Oak Studio'&&result.orchestration.tasks.some(t=>t.status==='completed'&&t.verification),calls,result};
if(process.argv[2])await Bun.write(process.argv[2],JSON.stringify(proof,null,2));
console.log(JSON.stringify({passed:proof.passed,title:proof.title,milliseconds:proof.milliseconds,statuses:result.orchestration.tasks.map(t=>t.status)}));
if(!proof.passed)process.exitCode=1;
