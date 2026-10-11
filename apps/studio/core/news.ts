import {fetchWithoutRedirects} from './fetch-without-redirects';
import {newsTopic} from './visual-context';
export type NewsItem={title:string;url:string;published:string;publisher:string};
export type NewsPack={retrievedAt:string;coverage:'headlines';results:NewsItem[]};
function unescapeXml(s:string){return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
export function parseNews(xml:string):NewsItem[]{
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,8).map(match=>{
    const field=(name:string)=>unescapeXml(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`).exec(match[1])?.[1]||'').trim();
    const url=field('link');if(!url.startsWith('https://news.google.com/'))throw new Error('Invalid news source link');
    return {title:field('title').slice(0,300),url,published:field('pubDate'),publisher:field('source').slice(0,120)};
  });
}
export async function fetchNews(query:string,signal:AbortSignal):Promise<NewsPack>{
  const url=new URL('https://news.google.com/rss/search');url.searchParams.set('q',(newsTopic(query)||query.slice(0,300))+' when:7d');url.searchParams.set('hl','en-US');url.searchParams.set('gl','US');url.searchParams.set('ceid','US:en');
  const response=await fetchWithoutRedirects(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
  console.info('anascummis-news-diagnostic-v1',JSON.stringify({stage:'response',status:response.status,ok:response.ok,hasBody:Boolean(response.body),contentType:response.headers.get('content-type')}));
  if(!response.ok||!response.body)throw new Error('News retrieval unavailable. I cannot verify current events.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let xml='',bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>500000)throw new Error('News response too large');xml+=decoder.decode(value,{stream:true});}xml+=decoder.decode();}finally{await reader.cancel();}
  const results=parseNews(xml);console.info('anascummis-news-diagnostic-v1',JSON.stringify({stage:'parsed',bytes,results:results.length}));if(!results.length)throw new Error('No recent news sources found.');
  return {retrievedAt:new Date().toISOString(),coverage:'headlines',results};
}

