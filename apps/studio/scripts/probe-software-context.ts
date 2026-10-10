import {runHarness} from '../core/harness';
import {softwareTools} from '../core/software-tools';
import {sourceCatalog,readOwnSource} from '../core/software-source';
import {infer,modelStatus} from '../core/model';
if(!(await modelStatus()).ready)throw new Error('Start local Qwen first');
const started=performance.now(),result=await runHarness('Read the first page of core/harness.ts to understand the existing tool loop. Then check software build capabilities. Do not build or claim an app is finished.',{requestedSource:'core/harness.ts',offset:0},softwareTools(sourceCatalog,readOwnSource),AbortSignal.timeout(120000),infer,{maxSteps:1,singleAction:'read_software_source',canFinish:()=>false,canAsk:()=>false,onTrace:entry=>console.log(entry.tool,entry.ok)}).catch(error=>({error:String(error),trace:[]}));
const report={model:'local Qwen3-0.6B',elapsedMs:Math.round(performance.now()-started),sourceInspected:result.trace.some(t=>t.tool==='read_software_source'&&t.ok),result};await Bun.write('.runtime/software-context-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify({sourceInspected:report.sourceInspected,elapsedMs:report.elapsedMs,result:'error' in result?result.error:result.stopReason}));
