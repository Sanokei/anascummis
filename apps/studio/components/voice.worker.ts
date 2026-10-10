import {pipeline,env} from '@huggingface/transformers';
import {prepareRuntime} from './browser-runtime';
import {KokoroTTS} from 'kokoro-js';
env.allowLocalModels=false;
let recognizer:any,synthesizer:any;
let queue=Promise.resolve();const cancelled=new Set<string>();
self.onmessage=(event:MessageEvent)=>{if(event.data.cancel){cancelled.add(event.data.cancel);return;}queue=queue.then(()=>run(event)).catch(()=>{});};
async function run(event:MessageEvent){
    const {id,action,audio,text,timestamps,warm}=event.data;
  if(cancelled.delete(id))return;
  const progress=(p:any)=>self.postMessage({id,progress:`Preparing ${action==='listen'?'listening':'voice'}: ${p.status}${p.progress?` ${Math.round(p.progress)}%`:''}`});
  try{
    await prepareRuntime();
    if(action==='listen'){
      recognizer ||= await pipeline('automatic-speech-recognition','Xenova/whisper-tiny.en',{device:'wasm',dtype:'q8',progress_callback:progress});
      if(cancelled.has(id))return;
      if(warm){self.postMessage({id,ready:true});return;}const result=await recognizer(audio,{chunk_length_s:30,stride_length_s:5,...(timestamps?{return_timestamps:true}:{})});self.postMessage({id,text:result.text,...(timestamps?{chunks:result.chunks}:{})});
    }else{
      synthesizer ||= await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{device:'wasm',dtype:'q8',progress_callback:progress});
      if(cancelled.has(id))return;
      self.postMessage({id,progress:'Preparing your spoken reply…'});
      if(warm){await synthesizer.generate('Hello.',{voice:'af_heart',speed:1});self.postMessage({id,ready:true});return;}const result=await synthesizer.generate(text,{voice:'af_heart',speed:1});self.postMessage({id,audio:result.audio,rate:result.sampling_rate},[result.audio.buffer]);
    }
  }catch(e){if(!cancelled.has(id))self.postMessage({id,error:String(e)});}
  finally{cancelled.delete(id);}
}


