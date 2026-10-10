import {pipeline,env,InterruptableStoppingCriteria,TextStreamer} from '@huggingface/transformers';
import {prepareRuntime} from './browser-runtime';
import {CONTEXT_TOKENS,outputBudget,countInputTokens} from '../core/working-memory';
let generator:any;
env.allowLocalModels=false;
let active:string|undefined,activeAnswer=false,preempted:string|undefined,running=false;
const pending:MessageEvent[]=[],cancelled=new Set<string>(),stopping=new InterruptableStoppingCriteria();
self.onmessage=(event:MessageEvent)=>{if(event.data.cancel){cancelled.add(event.data.cancel);if(active===event.data.cancel)stopping.interrupt();return;}
  if(event.data.answer){pending.unshift(event);if(active&&!activeAnswer){preempted=active;stopping.interrupt();}}else pending.push(event);void drain();};
async function drain(){if(running)return;running=true;try{while(pending.length)await run(pending.shift()!);}finally{running=false;}}
async function run(event:MessageEvent){
  const {id,system,user,schema,warm,answer}=event.data;
  if(cancelled.delete(id))return;active=id;activeAnswer=!!answer;stopping.reset();
  try{
    await prepareRuntime();
    if(!generator)generator=await pipeline('text-generation','onnx-community/Qwen3-0.6B-ONNX',{device:'wasm',dtype:'q8',progress_callback:(p:any)=>self.postMessage({id,progress:`Preparing understanding: ${p.status}${p.progress?` ${Math.round(p.progress)}%`:''}`})});
    if(cancelled.has(id))return;if(warm){self.postMessage({id,value:{}});return;}
    self.postMessage({id,started:true});
    const messages=[{role:'system',content:system+(answer?'\nAnswer in plain text. /no_think':'\nReturn JSON only. /no_think')},{role:'user',content:user+'\n/no_think'}];
    const tokens=generator.tokenizer.apply_chat_template(messages,{tokenize:true,return_tensor:false,return_dict:true,add_generation_prompt:true,enable_thinking:false});
    const maxTokens=answer?96:outputBudget(schema);
    if(countInputTokens(tokens.input_ids)+maxTokens>CONTEXT_TOKENS)throw new Error('This decision exceeds the 2,048-token budget. Ask for a smaller step or a specific page.');
    const streamer=answer?new TextStreamer(generator.tokenizer,{skip_prompt:true,callback_function:(delta:string)=>{if(!cancelled.has(id))self.postMessage({id,delta});}}):undefined;
    const result=await generator(messages,{streamer,stopping_criteria:[stopping],max_new_tokens:maxTokens,tokenizer_kwargs:{enable_thinking:false},do_sample:false,return_full_text:false});
    if(preempted===id){preempted=undefined;pending.push(event);return;}if(cancelled.has(id))return;
    const generated=result[0]?.generated_text;
    const output=typeof generated==='string'?generated:generated?.at(-1)?.content;
    const clean=String(output).replace(/<think>[\s\S]*?<\/think>/g,'').replace(/^```(?:json)?\s*|\s*```$/g,'').trim();
    self.postMessage({id,value:answer?clean:JSON.parse(clean)});
  }catch(e){if(preempted===id){preempted=undefined;pending.push(event);return;}if(!cancelled.has(id))self.postMessage({id,error:String(e)});}
  finally{cancelled.delete(id);active=undefined;}
}


