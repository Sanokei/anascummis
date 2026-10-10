export type VisualContext={title:string;url:string;excerpt:string;image?:{url:string;source:string;credit:string;license:string}};
export function newsTopic(question:string){return question.replace(/[?!.,]/g,' ').replace(/\b(what|whats|is|are|the|a|an|current|currently|latest|today|right|now|recent|situation|like|in|on|about|tell|me|please|news|happening|can|you|give|update)\b/gi,' ').replace(/\s+/g,' ').trim().slice(0,150);}
async function smallJson(url:URL,signal:AbortSignal){const response=await fetch(url,{headers:{'User-Agent':'Anascummis/1.0 (https://anascummis.com; visual context)'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});if(!response.ok||!response.body)throw new Error('Visual source unavailable');let raw='',bytes=0;const reader=response.body.getReader(),decoder=new TextDecoder();try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>200000)throw new Error('Visual response too large');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();return JSON.parse(raw);}finally{await reader.cancel();}}
const plain=(value:unknown)=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,250);
export async function fetchVisual(question:string,signal:AbortSignal):Promise<VisualContext>{
  const topic=newsTopic(question);if(!topic)throw new Error('No visual topic');
  const url=new URL('https://en.wikipedia.org/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:topic,gsrlimit:'1',gsrnamespace:'0',prop:'pageimages|extracts',piprop:'thumbnail|name',pithumbsize:'640',pilicense:'free',exintro:'1',explaintext:'1',exchars:'500'}).toString();
  const data=await smallJson(url,signal),page=Object.values(data.query?.pages||{})[0] as any;if(!page?.title)throw new Error('No visual source found');
  const visual:VisualContext={title:page.title,url:'https://en.wikipedia.org/wiki/'+encodeURIComponent(page.title.replaceAll(' ','_')),excerpt:String(page.extract||'').slice(0,500)};
  const info=new URL('https://commons.wikimedia.org/w/api.php');info.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:topic+' photograph',gsrnamespace:'6',gsrlimit:'3',prop:'imageinfo',iiprop:'url|extmetadata|mime',iiurlwidth:'640'}).toString();
  try{const result=await smallJson(info,signal),files=Object.values(result.query?.pages||{}) as any[];
    const file=files.sort((a,b)=>(a.index||0)-(b.index||0)).find(f=>['image/jpeg','image/png'].includes(f.imageinfo?.[0]?.mime)),image=file?.imageinfo?.[0],metadata=image?.extmetadata;
    if(image?.thumburl&&/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(image.thumburl)&&metadata?.LicenseShortName?.value&&image.descriptionurl?.startsWith('https://commons.wikimedia.org/'))visual.image={url:image.thumburl,source:image.descriptionurl,credit:plain(metadata.Artist?.value)||'Wikimedia Commons contributor',license:plain(metadata.LicenseShortName.value)};
  }catch{signal.throwIfAborted();}
  return visual;
}
