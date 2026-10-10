/** Capture raw PCM on the audio thread; no recording container or decode pass. */
class Capture extends AudioWorkletProcessor {
  constructor(){super();this.chunk=new Float32Array(1600);this.n=0;this.sum=0;this.count=0;this.phase=0;}
  process(inputs){const channels=inputs[0];if(!channels?.[0])return true;
    for(let i=0;i<channels[0].length;i++){
      let sample=0;for(const channel of channels)sample+=channel[i];sample/=channels.length;
      this.sum+=sample;this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){this.phase-=sampleRate;this.chunk[this.n++]=this.sum/this.count;this.sum=0;this.count=0;
        if(this.n===this.chunk.length){this.port.postMessage(this.chunk,[this.chunk.buffer]);this.chunk=new Float32Array(1600);this.n=0;}}
    }return true;
  }
}
registerProcessor('anascummis-capture',Capture);
