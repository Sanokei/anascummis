/** One resident model. Foreground speech can preempt a background decision before any tool executes. */
export class ModelScheduler {
  private pending:{priority:number;resolve:(lease:{signal:AbortSignal;release:()=>void})=>void}[]=[];
  private active?:{priority:number;controller:AbortController};
  acquire(priority:number){return new Promise<{signal:AbortSignal;release:()=>void}>(resolve=>{
    this.pending.push({priority,resolve});this.pending.sort((a,b)=>a.priority-b.priority);
    if(priority===0&&this.active?.priority===1)this.active.controller.abort('foreground');
    this.advance();
  });}
  private advance(){if(this.active||!this.pending.length)return;const next=this.pending.shift()!,controller=new AbortController();this.active={priority:next.priority,controller};let released=false;next.resolve({signal:controller.signal,release:()=>{if(released)return;released=true;this.active=undefined;this.advance();}});}
}
