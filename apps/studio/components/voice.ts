let workers:Partial<Record<'listen'|'speak',Worker>>={};
export function stopVoice(){Object.values(workers).forEach(w=>w?.terminate());workers={};}
export function voiceRequest(action:'listen'|'speak',payload:Record<string,unknown>,signal:AbortSignal,progress:(text:string)=>void):Promise<any>{
  signal.throwIfAborted();const current=workers[action] ||= new Worker(new URL('./voice.worker.ts',import.meta.url)),id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);current.removeEventListener('message',message);current.removeEventListener('error',error);signal.removeEventListener('abort',abort);};
    const abort=()=>{finish();current.postMessage({cancel:id});reject(new Error('Stopped'));};
    const error=(e:ErrorEvent)=>{finish();current.terminate();delete workers[action];reject(new Error(e.message||'Voice runtime failed'));};
    const message=(e:MessageEvent)=>{if(e.data.id!==id)return;if(e.data.progress){progress(e.data.progress);return;}finish();e.data.error?reject(new Error(e.data.error)):resolve(e.data);};
    const timer=setTimeout(()=>{finish();current.postMessage({cancel:id});reject(new Error('Speech is taking too long. Please try a shorter turn.'));},payload.warm?600000:45000);
    current.addEventListener('message',message);current.addEventListener('error',error);signal.addEventListener('abort',abort,{once:true});current.postMessage({id,action,...payload});
  });
}
export async function warmVoice(signal:AbortSignal,progress:(text:string)=>void){
  await voiceRequest('listen',{warm:true},signal,progress);
  await voiceRequest('speak',{warm:true},signal,progress);
}
