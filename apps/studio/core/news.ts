import {fetchWithoutRedirects} from './fetch-without-redirects';
import {newsTopic} from './visual-context';
export type NewsItem={title:string;url:string;published:string;publisher:string};
export type NewsPack={retrievedAt:string;coverage:'headlines';provider?:'bbc-rss';results:NewsItem[]};
function unescapeXml(s:string){return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
export function parseNews(xml:string):NewsItem[]{
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,8).map(match=>{
    const field=(name:string)=>unescapeXml(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`).exec(match[1])?.[1]||'').trim();
    const url=field('link');if(!url.startsWith('https://news.google.com/'))throw new Error('Invalid news source link');
    return {title:field('title').slice(0,300),url,published:field('pubDate'),publisher:field('source').slice(0,120)};
  });
}

const unavailable='News retrieval unavailable. I cannot verify current events.';
async function readNewsResponse(response:Response){
  const reader=response.body!.getReader(),decoder=new TextDecoder();let xml='',bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>500000)throw new Error('News response too large');xml+=decoder.decode(value,{stream:true});}xml+=decoder.decode();}finally{await reader.cancel();}
  return xml;
}
const bbcFeeds=[
  {words:/\b(science|scientific|environment|climate|space|nasa|physics|biology)\b/i,path:'science_and_environment'},
  {words:/\b(technology|tech|software|computer|internet|ai|cyber)\b/i,path:'technology'},
  {words:/\b(business|economy|economic|finance|markets)\b/i,path:'business'},
  {words:/\b(politics|political|election|government)\b/i,path:'politics'},
];
function bbcFeed(topic:string){return bbcFeeds.find(feed=>feed.words.test(topic))?.path||'world';}
export function parseBbcNews(xml:string,topic:string,now=Date.now()):NewsItem[]{
  const broad=/^(science|scientific research|technology|tech|business|economy|politics|world)$/i.test(topic);
  const words=topic.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  const keywords=words.filter(word=>!['how','does','do','with','has','have','any','some','from','and','of','to','for','updates'].includes(word)).slice(0,16);
  const items:NewsItem[]=[];
  for(const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)){
    const field=(name:string)=>unescapeXml(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>').exec(match[1])?.[1]||'').trim();
    const title=field('title'),published=field('pubDate'),date=Date.parse(published);
    if(!title||!Number.isFinite(date)||date<now-7*86400000||date>now+300000)continue;
    const text=(title+' '+field('description').replace(/<[^>]*>/g,' ')).toLowerCase();
    if(!broad&&keywords.some(word=>!new RegExp('(?:^|[^\\p{L}\\p{N}])'+word+'(?:$|[^\\p{L}\\p{N}])','u').test(text)))continue;
    let url:URL;try{url=new URL(field('link'));}catch{throw Error('Invalid BBC source link');}
    if(url.protocol!=='https:'||url.username||url.password||url.port||!['bbc.com','www.bbc.com','bbc.co.uk','www.bbc.co.uk'].includes(url.hostname))throw Error('Invalid BBC source link');
    items.push({title:title.slice(0,300),url:url.href,published,publisher:'BBC News'});
  }
  return items.sort((a,b)=>Date.parse(b.published)-Date.parse(a.published)).slice(0,8);
}
async function fetchBbcNews(topic:string,signal:AbortSignal):Promise<NewsPack>{
  signal.throwIfAborted();
  const url=new URL('https://feeds.bbci.co.uk/news/'+bbcFeed(topic)+'/rss.xml');
  const response=await fetchWithoutRedirects(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw Error(unavailable);}
  const results=parseBbcNews(await readNewsResponse(response),topic);
  if(!results.length)throw Error('No recent matching BBC news sources found.');
  return {retrievedAt:new Date().toISOString(),coverage:'headlines',provider:'bbc-rss',results};
}
export async function fetchNews(query:string,signal:AbortSignal):Promise<NewsPack>{
  const topic=newsTopic(query),url=new URL('https://news.google.com/rss/search');url.searchParams.set('q',(topic||query.slice(0,300))+' when:7d');url.searchParams.set('hl','en-US');url.searchParams.set('gl','US');url.searchParams.set('ceid','US:en');
  const response=await fetchWithoutRedirects(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
  // Google's edge egress can receive HTTP 503 automated-traffic protection.
  // Use one independently published RSS feed; never follow a redirect or retry the restriction.
  if(response.status===503){await response.body?.cancel().catch(()=>{});return fetchBbcNews(topic,signal);}
  if(!response.ok||!response.body)throw Error(unavailable);
  const results=parseNews(await readNewsResponse(response));if(!results.length)throw Error('No recent news sources found.');
  return {retrievedAt:new Date().toISOString(),coverage:'headlines',results};
}
