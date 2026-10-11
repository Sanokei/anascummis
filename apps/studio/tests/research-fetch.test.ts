import {afterEach,expect,test} from 'bun:test';
import {fetchWithoutRedirects} from '../core/fetch-without-redirects';
import {fetchNews} from '../core/news';
import {fetchVisual} from '../core/visual-context';

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const signal=()=>new AbortController().signal;
const rss='<rss><channel><item><title>Verified headline</title><link>https://news.google.com/articles/test</link><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate><source>Test publisher</source></item></channel></rss>';
function mockFetch(handler:(request:Request,init:RequestInit)=>Response|Promise<Response>){
  const calls:Request[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    expect(init?.redirect).toBe('manual');
    const request=new Request(input,init);calls.push(request);
    return handler(request,init!);
  }) as typeof fetch;
  return calls;
}
function assertPublicRequest(request:Request,origin:string){
  expect(new URL(request.url).origin).toBe(origin);
  expect(request.headers.has('authorization')).toBe(false);
  expect(request.headers.has('cookie')).toBe(false);
  expect(request.headers.has('x-builder-key')).toBe(false);
}

test('news succeeds with a bounded public request and unchanged provenance',async()=>{
  const calls=mockFetch(request=>{assertPublicRequest(request,'https://news.google.com');return new Response(rss);});
  const news=await fetchNews('Latest weather news',signal());
  expect(news.coverage).toBe('headlines');expect(news.results[0].title).toBe('Verified headline');
  expect(news.results[0].publisher).toBe('Test publisher');expect(calls).toHaveLength(1);
});
test('Wikipedia and Commons success keep public-only headers and image attribution',async()=>{
  const calls=mockFetch(request=>{
    if(new URL(request.url).hostname==='en.wikipedia.org'){
      assertPublicRequest(request,'https://en.wikipedia.org');
      return Response.json({query:{pages:{1:{title:'Test topic',extract:'Background evidence'}}}});
    }
    assertPublicRequest(request,'https://commons.wikimedia.org');
    return Response.json({query:{pages:{2:{index:1,imageinfo:[{mime:'image/jpeg',thumburl:'https://upload.wikimedia.org/test.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Test.jpg',extmetadata:{LicenseShortName:{value:'CC BY-SA'},Artist:{value:'Test artist'}}}]}}}});
  });
  const visual=await fetchVisual('Test topic',signal());
  expect(visual.title).toBe('Test topic');expect(visual.image?.credit).toBe('Test artist');
  expect(calls).toHaveLength(2);
});
for(const status of [301,302,303,304,307,308]){
  test('rejects '+status+' and cancels its body before any second request',async()=>{
    let cancelled=false;
    const calls=mockFetch(()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{Location:'https://evil.example/steal'}}));
    await expect(fetchNews('News',signal())).rejects.toThrow('redirects are not allowed');
    expect(calls).toHaveLength(1);expect(cancelled).toBe(true);
  });
}
for(const location of ['https://news.google.com/rss/search','/rss/search','https://evil.example/','http://127.0.0.1/private','https://user:password@evil.example/']){
  test('zero hops rejects loop, relative and unapproved target '+location,async()=>{
    const calls=mockFetch(()=>new Response('redirect',{status:302,headers:{Location:location}}));
    await expect(fetchNews('News',signal())).rejects.toThrow('redirects are not allowed');
    expect(calls).toHaveLength(1);
  });
}
test('a redirect without Location is rejected and cleanup failure cannot hide it',async()=>{
  const calls=mockFetch(()=>new Response(new ReadableStream({cancel(){throw Error('cleanup failed');}}),{status:302}));
  await expect(fetchNews('News',signal())).rejects.toThrow('redirects are not allowed');
  expect(calls).toHaveLength(1);
});
test('first-origin authentication is preserved but never forwarded to a redirect',async()=>{
  const calls=mockFetch(request=>{
    expect(request.headers.get('authorization')).toBe('Bearer test-only');
    return new Response(null,{status:307,headers:{Location:'https://evil.example/'}});
  });
  await expect(fetchWithoutRedirects(new URL('https://api.example/fixed'),{headers:{Authorization:'Bearer test-only'},signal:signal()})).rejects.toThrow('redirects are not allowed');
  expect(calls).toHaveLength(1);expect(new URL(calls[0].url).origin).toBe('https://api.example');
});
test('Wikipedia redirects fail; optional Commons redirects fall back to the article',async()=>{
  let calls=mockFetch(()=>new Response(null,{status:301,headers:{Location:'https://evil.example/'}}));
  await expect(fetchVisual('Test topic',signal())).rejects.toThrow('redirects are not allowed');expect(calls).toHaveLength(1);
  calls=mockFetch(request=>new URL(request.url).hostname==='en.wikipedia.org'?Response.json({query:{pages:{1:{title:'Test topic',extract:'Background'}}}}):new Response(null,{status:302,headers:{Location:'https://evil.example/'}}));
  const visual=await fetchVisual('Test topic',signal());expect(visual.image).toBeUndefined();expect(visual.title).toBe('Test topic');expect(calls).toHaveLength(2);
});
test('HTTP failures retain caller errors and make no retries',async()=>{
  const calls=mockFetch(()=>new Response('unavailable',{status:503}));
  await expect(fetchNews('News',signal())).rejects.toThrow('News retrieval unavailable');
  await expect(fetchVisual('Test topic',signal())).rejects.toThrow('Visual source unavailable');
  expect(calls).toHaveLength(2);
});
test('network failures propagate without retries',async()=>{
  const calls=mockFetch(()=>{throw Error('connection failed');});
  await expect(fetchNews('News',signal())).rejects.toThrow('connection failed');expect(calls).toHaveLength(1);
});
test('news and visual byte limits still cancel oversized responses',async()=>{
  mockFetch(()=>new Response('x'.repeat(500001)));
  await expect(fetchNews('News',signal())).rejects.toThrow('News response too large');
  mockFetch(()=>new Response('x'.repeat(200001)));
  await expect(fetchVisual('Test topic',signal())).rejects.toThrow('Visual response too large');
});
test('aborted requests propagate cancellation through combined deadline signals',async()=>{
  const control=new AbortController();control.abort(new Error('cancelled by user'));
  const calls=mockFetch((_request,init)=>{expect(init.signal?.aborted).toBe(true);init.signal?.throwIfAborted();return new Response(rss);});
  await expect(fetchNews('News',control.signal)).rejects.toThrow('cancelled by user');
  await expect(fetchVisual('Test topic',control.signal)).rejects.toThrow('cancelled by user');expect(calls).toHaveLength(2);
});
