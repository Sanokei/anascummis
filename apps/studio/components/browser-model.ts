import type {Infer} from '../core/model';
import {validate} from '../core/harness';
let worker:Worker|undefined;
export function stopBrowserModel(){worker?.terminate();worker=undefined;}
export const browserInfer:Infer=(system,user,schema,signal)=>new Promise((resolve,reject)=>{
  signal.throwIfAborted();worker ||= new Worker(new URL('./browser-model.worker.ts',import.meta.url));const current=worker,id=crypto.randomUUID();
  const finish=()=>{clearTimeout(timer);current.removeEventListener('message',message);current.removeEventListener('error',error);signal.removeEventListener('abort',abort);};
  const error=(e:ErrorEvent)=>{finish();stopBrowserModel();reject(new Error(e.message||'Browser model failed'));};
  const abort=()=>{finish();current.postMessage({cancel:id});reject(new Error('Stopped'));};
  const message=(e:MessageEvent)=>{if(e.data.id!==id)return;if(e.data.started){clearTimeout(timer);timer=setTimeout(()=>{finish();current.postMessage({cancel:id});reject(new Error('Local model inference timed out'));},45000);return;}if(e.data.progress){window.dispatchEvent(new CustomEvent('anascummis-model-progress',{detail:e.data.progress}));return;}finish();if(e.data.error){reject(new Error(e.data.error));return;}try{validate(schema,e.data.value);resolve(e.data.value);}catch(e){reject(e);}};
  let timer=setTimeout(()=>{finish();stopBrowserModel();reject(new Error('Browser CPU inference timed out'));},600000);
  current.addEventListener('message',message);current.addEventListener('error',error);signal.addEventListener('abort',abort,{once:true});current.postMessage({id,schema,system:system+'\nJSON schema: '+JSON.stringify(schema),user});
});

export function warmBrowserModel(){worker ||= new Worker(new URL('./browser-model.worker.ts',import.meta.url));worker.postMessage({id:crypto.randomUUID(),warm:true});}

export function browserAnswer(system:string,user:string,signal:AbortSignal,onText:(delta:string)=>void):Promise<string>{
  signal.throwIfAborted();worker ||= new Worker(new URL('./browser-model.worker.ts',import.meta.url));const current=worker,id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);current.removeEventListener('message',message);current.removeEventListener('error',error);};
    const abort=()=>{finish();current.postMessage({cancel:id});reject(new Error('Stopped'));};
    const error=(e:ErrorEvent)=>{finish();reject(new Error(e.message));};
    const message=(e:MessageEvent)=>{if(e.data.id!==id)return;if(e.data.started){clearTimeout(timer);timer=setTimeout(()=>{finish();current.postMessage({cancel:id});reject(new Error('Local model inference timed out'));},45000);return;}if(e.data.delta!==undefined){onText(e.data.delta);return;}if(e.data.progress){window.dispatchEvent(new CustomEvent('anascummis-model-progress',{detail:e.data.progress}));return;}finish();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.value);};
    let timer=setTimeout(()=>{finish();current.postMessage({cancel:id});reject(new Error('Understanding is taking too long on this CPU. Please try a shorter question.'));},600000);
    current.addEventListener('message',message);current.addEventListener('error',error);signal.addEventListener('abort',abort,{once:true});current.postMessage({id,system,user,answer:true});
  });
}

