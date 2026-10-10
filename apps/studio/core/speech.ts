import {join} from 'node:path';
import {ROOT} from './storage';
import {text} from './site';
let daemon:ReturnType<typeof Bun.spawn>|undefined,loading:Promise<void>|undefined,lines:AsyncGenerator<string>|undefined,queue=Promise.resolve();
export function stopSpeech(){daemon?.kill();daemon=undefined;loading=undefined;lines=undefined;}
process.on('exit',stopSpeech);
async function* readLines(stream:ReadableStream<Uint8Array>){const reader=stream.getReader(),decoder=new TextDecoder();let pending='';try{for(;;){const {done,value}=await reader.read();if(done)return;pending+=decoder.decode(value,{stream:true});if(pending.length>20000000)throw new Error('Speech output exceeds budget');let end;while((end=pending.indexOf('\n'))>=0){yield pending.slice(0,end);pending=pending.slice(end+1);}}}finally{await reader.cancel().catch(()=>{});}}
export function warmSpeech(){return loading ||= (async()=>{
 const python=process.env.PYTHON_PATH||join(ROOT,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 if(!await Bun.file(python).exists())throw new Error('Run bun run setup and bun run speech:setup for local voice');
 daemon=Bun.spawn([python,'-u',join(ROOT,'worker','pocket_daemon.py')],{cwd:ROOT,stdin:'pipe',stdout:'pipe',stderr:'ignore',env:{...process.env,HF_HUB_OFFLINE:'1'}});
 lines=readLines(daemon.stdout as ReadableStream<Uint8Array>);const ready=await lines.next();if(ready.done||!JSON.parse(ready.value).ready)throw new Error('Run bun run speech:setup: offline Pocket TTS and LavaSR are not ready');
})().catch(error=>{stopSpeech();throw error;});}
export type SpeechPacket={audio:string;rate:number;encoding:'pcm16'};
export async function* streamSpeak(value:unknown,signal:AbortSignal):AsyncGenerator<SpeechPacket>{
 const words=text(value,4000),id=crypto.randomUUID();let release!:()=>void;const previous=queue;queue=new Promise<void>(resolve=>release=resolve);await previous;
 let started=false,done=false,error:unknown,timer:ReturnType<typeof setTimeout>|undefined;
 const cancel=()=>{if(started){const input=daemon?.stdin as import('bun').FileSink|undefined;input?.write(JSON.stringify({cancel:id})+'\n');void input?.flush();}};
 try{signal.throwIfAborted();await warmSpeech();signal.throwIfAborted();signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>stopSpeech(),60000);const input=daemon!.stdin as import('bun').FileSink;input.write(JSON.stringify({id,text:words})+'\n');started=true;await input.flush();
  for(;;){const line=await lines!.next();if(line.done)throw new Error('Speech runtime stopped');const packet=JSON.parse(line.value);if(packet.id!==id)throw new Error('Speech response mismatch');if(packet.done){done=true;break;}if(packet.error){error=new Error(packet.error);continue;}signal.throwIfAborted();if(typeof packet.audio!=='string'||packet.audio.length>300000||packet.rate!==48000||packet.encoding!=='pcm16')throw new Error('Invalid speech chunk');yield packet;}
  if(error)throw error;signal.throwIfAborted();
 }finally{if(started&&!done&&lines){cancel();try{for(;;){const item=await lines.next();if(item.done||JSON.parse(item.value).done)break;}}catch{stopSpeech();}}if(timer)clearTimeout(timer);signal.removeEventListener('abort',cancel);release();}
}
export async function speak(value:unknown,signal:AbortSignal=new AbortController().signal){const chunks:Buffer[]=[];for await(const packet of streamSpeak(value,signal))chunks.push(Buffer.from(packet.audio,'base64'));const pcm=Buffer.concat(chunks),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(48000,24);header.writeUInt32LE(96000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return new Uint8Array(Buffer.concat([header,pcm]));}
