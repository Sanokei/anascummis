/** Continuous microphone, raw 16 kHz capture, bounded utterances. */
export class Microphone {
  private stream?:MediaStream;private node?:AudioWorkletNode;private input?:MediaStreamAudioSourceNode;
  private watcher?:()=>void;private watchVoiced=0;private recent:Float32Array[]=[];private lead:Float32Array[]=[];
  private consume?: (pcm:Float32Array)=>void;private loaded=false;private generation=0;private mute?:GainNode;
  constructor(private ctx:AudioContext){}
  async open(){
    if(this.stream?.active)return;
    const generation=++this.generation;const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1},video:false});
    try{if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw new Error("Stopped");}if(!this.loaded){await this.ctx.audioWorklet.addModule('/voice-capture.js');this.loaded=true;}if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw new Error('Stopped');}
      this.stream=stream;this.input=this.ctx.createMediaStreamSource(stream);this.node=new AudioWorkletNode(this.ctx,'anascummis-capture');
      this.node.port.onmessage=e=>{const pcm=e.data as Float32Array;this.recent.push(pcm);if(this.recent.length>6)this.recent.shift();
        if(this.consume)this.consume(pcm);else if(this.watcher){const rms=Math.sqrt(pcm.reduce((n,v)=>n+v*v,0)/pcm.length);this.watchVoiced=rms>=.04?this.watchVoiced+pcm.length/16:0;if(this.watchVoiced>=300){this.lead=this.recent.slice();const callback=this.watcher;this.watcher=undefined;callback();}}};this.input.connect(this.node);
      const mute=this.mute=this.ctx.createGain();mute.gain.value=0;this.node.connect(mute);mute.connect(this.ctx.destination);
    }catch(e){stream.getTracks().forEach(t=>t.stop());throw e;}
  }
  listen(signal:AbortSignal,level:(n:number)=>void,candidate:(pcm:Float32Array,revision:number)=>void){
    signal.throwIfAborted();
    return new Promise<{pcm:Float32Array;revision:number}>((resolve,reject)=>{
      let chunks:Float32Array[]=[],samples=0,voiced=0,quiet=0,revision=0,proposed=-1;
      const snapshot=()=>{const pcm=new Float32Array(samples);let at=0;for(const c of chunks){pcm.set(c,at);at+=c.length;}return pcm;};
      const cleanup=()=>{this.consume=undefined;signal.removeEventListener('abort',abort);clearTimeout(timer);level(0);};
      const finish=()=>{if(voiced<200)return;const pcm=snapshot();cleanup();resolve({pcm,revision});};
      const abort=()=>{cleanup();reject(new Error('Stopped'));};
      const timer=setTimeout(()=>{if(voiced>=200)finish();else{cleanup();reject(new Error('No speech heard. Touch the orb to try again.'));}},45000);
      signal.addEventListener('abort',abort,{once:true});
      this.consume=pcm=>{
        const ms=pcm.length/16,rms=Math.sqrt(pcm.reduce((n,v)=>n+v*v,0)/pcm.length);level(Math.min(1,rms*4));
        if(rms>=.018){voiced+=ms;quiet=0;revision++;}else if(voiced>=200)quiet+=ms;else voiced=0;
        // Keep only a short lead-in while waiting for speech, rather than transcribing room silence.
        chunks.push(pcm);samples+=pcm.length;
        if(!voiced&&samples>8000){samples-=chunks.shift()!.length;}
        if(voiced>=200&&quiet>=200&&proposed!==revision){proposed=revision;candidate(snapshot(),revision);}
        if(voiced>=200&&quiet>=650||samples>=16000*30)finish();
      };
      this.finish=finish;const lead=this.lead;this.lead=[];for(const pcm of lead)this.consume?.(pcm);
    });
  }
  watchSpeech(callback?:()=>void){this.watcher=callback;this.watchVoiced=0;}
  finish=()=>{};
  close(){this.generation++;this.watcher=undefined;this.recent=[];this.lead=[];this.mute?.disconnect();this.consume=undefined;this.finish=()=>{};this.node?.disconnect();this.input?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.stream=undefined;}
}
