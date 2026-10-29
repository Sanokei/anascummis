import {test,expect} from 'bun:test';
import {documentRewriteInfer,infer,streamAnswer,DOCUMENT_REWRITE_PROFILE} from '../core/model';

// Captured transport fixtures only: no native inference or rewrite-quality claim.
const schema={type:'object',properties:{text:{type:'string',maxLength:600},citations:{type:'array',items:{type:'integer'}}},required:['text','citations'],additionalProperties:false};
const response={text:'Injected output remains unchanged.',citations:[1,2]};
type Completion={body:Record<string,any>;request:Request};
async function captured(run:(completions:Completion[])=>Promise<void>,handle?:(entry:Completion,index:number)=>Promise<Response>){
  const original=globalThis.fetch,completions:Completion[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const request=input instanceof Request?input:new Request(input,init),path=new URL(request.url).pathname;
    expect(new URL(request.url).hostname).toBe('127.0.0.1');expect(request.redirect).toBe('error');
    if(path==='/tokenize')return Response.json({tokens:[1,2,3]});
    if(path!=='/v1/chat/completions')throw new Error('Unexpected profile-test endpoint: '+path);
    const entry={body:await request.json() as Record<string,any>,request};completions.push(entry);
    if(handle)return handle(entry,completions.length);
    return Response.json({choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}]});
  }) as typeof fetch;
  try{await run(completions);}finally{globalThis.fetch=original;}
}
function assertProfile(body:Record<string,any>){
  for(const [name,value] of Object.entries(DOCUMENT_REWRITE_PROFILE.parameters))expect(body[name]).toEqual(value);
  expect(body).not.toHaveProperty('id');expect(body).not.toHaveProperty('parameters');expect(body.max_tokens).toBe(384);expect(body.stream).toBe(false);
  expect(body.response_format.json_schema.schema).toEqual(schema);
}

test('only the explicit document writer sends the measured profile; later ordinary inference retains its original defaults',async()=>{
  await captured(async completions=>{
    expect(await documentRewriteInfer('Rewrite the current summary.','Exact saved request',schema,new AbortController().signal)).toEqual(response);
    expect(await infer('Review the saved evidence.','Exact review packet',schema,new AbortController().signal)).toEqual(response);
    expect(completions.length).toBe(2);assertProfile(completions[0].body);
    expect(completions[0].body.messages[0].content).toContain('Rewrite the current summary.');expect(completions[0].body.messages[1].content).toBe('Exact saved request\n/no_think');
    const ordinary=completions[1].body;expect(ordinary.temperature).toBe(0);for(const key of ['top_p','top_k','min_p','seed','chat_template_kwargs'])expect(ordinary).not.toHaveProperty(key);
    expect(Object.isFrozen(DOCUMENT_REWRITE_PROFILE)).toBe(true);expect(Object.isFrozen(DOCUMENT_REWRITE_PROFILE.parameters)).toBe(true);expect(Object.isFrozen(DOCUMENT_REWRITE_PROFILE.parameters.chat_template_kwargs)).toBe(true);
  });
});

test('foreground preemption retries a background rewrite with the same profile and exact request rather than falling back to default decoding',async()=>{
  let arrived!:()=>void;const started=new Promise<void>(resolve=>arrived=resolve);let backgroundRequests=0;
  await captured(async completions=>{
    const rewrite=documentRewriteInfer('Rewrite the current summary.','Kept request',schema,new AbortController().signal);await started;
    const chunks:string[]=[];for await(const chunk of streamAnswer('Brief foreground reply.','Hello',new AbortController().signal))chunks.push(chunk);
    expect(chunks).toEqual(['Hello']);expect(await rewrite).toEqual(response);
    const background=completions.filter(entry=>!entry.body.stream);expect(background.length).toBe(2);for(const entry of background){assertProfile(entry.body);expect(entry.body.messages[1].content).toBe('Kept request\n/no_think');}
    expect(completions.filter(entry=>entry.body.stream).length).toBe(1);
  },async entry=>{
    if(entry.body.stream)return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
    backgroundRequests++;
    if(backgroundRequests===1){arrived();return new Promise<Response>((_resolve,reject)=>{const aborted=()=>reject(entry.request.signal.reason);if(entry.request.signal.aborted)aborted();else entry.request.signal.addEventListener('abort',aborted,{once:true});});}
    return Response.json({choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}]});
  });
});

test('a cancelled document writer or a provider failure is not retried as a different profile',async()=>{
  const stopped=new AbortController(),reason=new Error('Explicit document stop');stopped.abort(reason);
  await captured(async completions=>{await expect(documentRewriteInfer('Writer','Request',schema,stopped.signal)).rejects.toBe(reason);expect(completions.length).toBe(0);});
  await captured(async completions=>{await expect(documentRewriteInfer('Writer','Request',schema,new AbortController().signal)).rejects.toThrow('Local Qwen runtime returned 500');expect(completions.length).toBe(1);assertProfile(completions[0].body);},async()=>Response.json({error:'Injected provider format failure'},{status:500}));
});
