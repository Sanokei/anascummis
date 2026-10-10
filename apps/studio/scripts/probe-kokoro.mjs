import {DecompressionStream} from 'node:stream/web'; Object.assign(globalThis,{DecompressionStream});const {KokoroTTS}=await import('kokoro-js');import {env,StyleTextToSpeech2Model,AutoTokenizer} from '@huggingface/transformers';
env.cacheDir='.runtime/kokoro-cache';env.allowRemoteModels=false;const start=performance.now();const id='onnx-community/Kokoro-82M-v1.0-ONNX';const [network,tokenizer]=await Promise.all([StyleTextToSpeech2Model.from_pretrained(id,{device:'cpu',dtype:'q8',session_options:{intraOpNumThreads:2,interOpNumThreads:1}}),AutoTokenizer.from_pretrained(id)]);const voice=new KokoroTTS(network,tokenizer);console.log('warmMs',Math.round(performance.now()-start));const t=performance.now(),result=await voice.generate("Hi! I'm here. What would you like to create today?",{voice:'af_heart',speed:1});await result.save('.runtime/kokoro-sample.wav');console.log('synthesisMs',Math.round(performance.now()-t));



