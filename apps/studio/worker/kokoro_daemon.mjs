import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {KokoroTTS} from 'kokoro-js';
import {env,StyleTextToSpeech2Model,AutoTokenizer} from '@huggingface/transformers';
env.cacheDir=resolve('.runtime/kokoro-cache');env.allowRemoteModels=false;
const modelId='onnx-community/Kokoro-82M-v1.0-ONNX';
const [network,tokenizer]=await Promise.all([StyleTextToSpeech2Model.from_pretrained(modelId,{device:'cpu',dtype:'q8',session_options:{intraOpNumThreads:2,interOpNumThreads:1}}),AutoTokenizer.from_pretrained(modelId)]);
const model=new KokoroTTS(network,tokenizer);
let enhancer,enhancedLines;
if(process.env.SPEECH_ENHANCE!=='0'){
  enhancer=spawn(process.env.PYTHON_PATH||resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python'),['-u',resolve('worker/enhance_daemon.py')],{stdio:['pipe','pipe','inherit']});
  enhancedLines=createInterface({input:enhancer.stdout})[Symbol.asyncIterator]();
  const ready=await enhancedLines.next();if(ready.done||!JSON.parse(ready.value).ready)throw new Error('Speech enhancer failed to start');
}
process.on('exit',()=>enhancer?.kill());
console.log(JSON.stringify({ready:true}));
for await(const line of createInterface({input:process.stdin})){
 try{const {text}=JSON.parse(line);if(typeof text!=='string'||text.length>4000)throw new Error('Invalid speech text');
 const started=performance.now();const audio=await model.generate(text,{voice:'af_heart',speed:1});let encoded=Buffer.from(await audio.toBlob().arrayBuffer()).toString('base64');
 const synthesized=performance.now();if(enhancer){enhancer.stdin.write(JSON.stringify({audio:encoded})+'\n');const result=await enhancedLines.next();if(result.done)throw new Error('Enhancer stopped');const value=JSON.parse(result.value);if(value.error)throw new Error(value.error);encoded=value.audio;}
 console.log(JSON.stringify({audio:encoded,synthesisMs:Math.round(synthesized-started),enhancementMs:Math.round(performance.now()-synthesized)}));
 }catch(error){console.log(JSON.stringify({error:String(error).slice(0,300)}));}
}



