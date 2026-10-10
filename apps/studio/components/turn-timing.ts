/** Silence is a turn boundary only after sustained speech, never on startup. */
export class TurnBoundary {
  private voiced=0;private quiet=0;
  push(rms:number,elapsedMs:number){if(rms>=0.018){this.voiced+=elapsedMs;this.quiet=0;}else if(this.voiced>=200)this.quiet+=elapsedMs;else this.voiced=0;return this.voiced>=200&&this.quiet>=650;}
}
export function speechChunks(text:string){
  const chunks:string[]=[];let rest=text.trim();
  while(rest){const limit=150;if(rest.length<=limit){chunks.push(rest);break;}const part=rest.slice(0,limit),sentence=part.search(/[.!?]\s/);let end=sentence>=15?sentence+1:part.lastIndexOf(' ');if(end<1)end=limit;chunks.push(rest.slice(0,end));rest=rest.slice(end).trim();}
  return chunks;
}

