import {test,expect} from 'bun:test';
import {localModelFetch} from '../core/model';

const unavailable='Local AI is unavailable. Open Download for setup instructions, then start or check the local AI server.';
const post={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};

test('a refused loopback connection gives an actionable local-AI error',async()=>{
  const reserve=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('reserved')});
  const url=`http://127.0.0.1:${reserve.port}/tokenize`;
  await reserve.stop(true);
  await expect(localModelFetch(url,post)).rejects.toThrow(unavailable);
});

test('503 is translated once without retrying the POST or issuing a health request',async()=>{
  const paths:string[]=[];
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>{paths.push(new URL(request.url).pathname);return new Response('loading',{status:503});}});
  try{
    await expect(localModelFetch(`http://127.0.0.1:${server.port}/v1/chat/completions`,post)).rejects.toThrow(unavailable);
    expect(paths).toEqual(['/v1/chat/completions']);
  }finally{await server.stop(true);}
});

test('loopback redirects are never followed even when caller options request follow',async()=>{
  let initialRequests=0,targetRequests=0;
  const target=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>{targetRequests++;return Response.json({tokens:[1]});}});
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>{
    initialRequests++;return new Response('Unexpected runtime redirect',{status:302,headers:{Location:`http://127.0.0.1:${target.port}/unexpected-target`}});
  }});
  try{
    const url=`http://127.0.0.1:${server.port}/tokenize`;
    await expect(localModelFetch(url,post)).rejects.toThrow(unavailable);
    expect(initialRequests).toBe(1);expect(targetRequests).toBe(0);
    await expect(localModelFetch(url,{...post,redirect:'follow'})).rejects.toThrow(unavailable);
    expect(initialRequests).toBe(2);expect(targetRequests).toBe(0);
  }finally{await server.stop(true);await target.stop(true);}
});

test('normal structured responses and non-503 HTTP validation responses remain unchanged',async()=>{
  const paths:string[]=[];
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>{
    const path=new URL(request.url).pathname;paths.push(path);
    return path==='/tokenize'?Response.json({tokens:[1,2,3]}):Response.json({error:'invalid schema'},{status:400});
  }});
  try{
    const base=`http://127.0.0.1:${server.port}`;
    expect(await(await localModelFetch(base+'/tokenize',post)).json()).toEqual({tokens:[1,2,3]});
    const rejected=await localModelFetch(base+'/v1/chat/completions',post);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({error:'invalid schema'});
    expect(paths).toEqual(['/tokenize','/v1/chat/completions']);
  }finally{await server.stop(true);}
});

test('streaming response bytes are delivered without a second model request',async()=>{
  let calls=0;
  const body='data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n';
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>{calls++;return new Response(body,{headers:{'Content-Type':'text/event-stream'}});}});
  try{
    const response=await localModelFetch(`http://127.0.0.1:${server.port}/v1/chat/completions`,post);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await response.text()).toBe(body);
    expect(calls).toBe(1);
  }finally{await server.stop(true);}
});

test('caller cancellation preserves its original reason and does not retry',async()=>{
  let seen!:()=>void,release!:()=>void,calls=0;
  const arrived=new Promise<void>(resolve=>seen=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async()=>{calls++;seen();await gate;return Response.json({tokens:[1]});}});
  const controller=new AbortController(),reason=new Error('User stopped the task');
  try{
    const pending=localModelFetch(`http://127.0.0.1:${server.port}/tokenize`,{...post,signal:controller.signal});
    await arrived;controller.abort(reason);
    try{await pending;throw new Error('The request should have been aborted');}catch(error){expect(error).toBe(reason);}
    expect(calls).toBe(1);
  }finally{release();await server.stop(true);}
});

test('a pre-aborted signal never issues a request and keeps the original reason',async()=>{
  let calls=0;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>{calls++;return new Response('unexpected');}});
  const controller=new AbortController(),reason=new Error('Already cancelled');controller.abort(reason);
  try{
    try{await localModelFetch(`http://127.0.0.1:${server.port}/tokenize`,{...post,signal:controller.signal});throw new Error('Expected cancellation');}
    catch(error){expect(error).toBe(reason);}
    expect(calls).toBe(0);
  }finally{await server.stop(true);}
});

test('signal timeouts stay timeouts rather than becoming unavailable errors',async()=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async()=>{await gate;return new Response('late');}});
  const signal=AbortSignal.timeout(40);
  try{
    try{await localModelFetch(`http://127.0.0.1:${server.port}/tokenize`,{...post,signal});throw new Error('Expected timeout');}
    catch(error){expect(signal.aborted).toBe(true);expect(error).toBe(signal.reason);expect((error as Error).name).toBe('TimeoutError');}
  }finally{release();await server.stop(true);}
});

test('invalid request construction and JSON bodies are not relabeled as local-AI transport failures',async()=>{
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('not JSON')});
  try{
    const url=`http://127.0.0.1:${server.port}/tokenize`;
    await expect(localModelFetch(url,{method:'GET',body:'invalid'})).rejects.toThrow(TypeError);
    const response=await localModelFetch(url,post);
    await expect(response.json()).rejects.toThrow(SyntaxError);
    await expect(localModelFetch('https://example.com/tokenize',post)).rejects.toThrow('HTTP loopback');
  }finally{await server.stop(true);}
});
