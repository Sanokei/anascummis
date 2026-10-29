import type {BriefDraft} from './research-brief-types';
import type {SummaryRequirements} from './research-brief-edit-types';

/** Canonical reading text for comparisons only. Never replaces the saved raw
 * model response or authors the published factual wording. */
export function plainBriefText(value:string):string {
  return value.replace(/\[([^\]\r\n]+)\]\((https:\/\/[^\s()<>]+)\)/gu,'$1')
    .replace(/`([^`\r\n]+)`/gu,'$1').trim();
}
export function visibleSummary(draft:BriefDraft){return draft.paragraphs.map(p=>plainBriefText(p.text)).join('\n\n');}
export function summaryCharacters(draft:BriefDraft){return Array.from(visibleSummary(draft)).length;}

export function summaryRequirements(intent:string,before:BriefDraft):SummaryRequirements|undefined {
  const oneSentence=/\b(?:one|single)\s+(?:short\s+)?sentence\b/iu.test(intent);
  const shorter=/\b(?:shorten|shorter|condense|condensed|concise)\b/iu.test(intent);
  if(!oneSentence&&!shorter)return undefined;
  const text=visibleSummary(before),locations=new Set<string>();
  // Locations already present in the accepted visible summary are protected.
  // Hidden Markdown targets do not create extra requirements; the same exact
  // visible location may appear as a bare path or inside an HTTPS link later.
  for(const match of text.matchAll(/\b(?:https?:\/\/)?[\p{L}\p{N}._-]+(?:\/[\p{L}\p{N}._~%+:#?=&-]+)+\/?|\b[\p{L}\p{N}._-]+\/(?=\s|[.,;!?)\]]|$)/gu)){
    const location=match[0].replace(/^https?:\/\//u,'').replace(/[.,;!?):\]]+$/u,'');
    if(location)locations.add(location);
  }
  return {oneSentence,shorterThanCharacters:shorter?Array.from(text).length:0,locations:[...locations]};
}

export function checkSummaryRequirements(requirements:SummaryRequirements|undefined,draft:BriefDraft):{accepted:boolean;reason:string}|undefined {
  if(!requirements)return undefined;
  const plain=visibleSummary(draft),raw=draft.paragraphs.map(p=>p.text).join('\n\n'),normalized=(raw+'\n'+plain).replace(/https?:\/\//gu,'');
  if(requirements.locations.some(location=>!normalized.includes(location)))return {accepted:false,reason:'The proposed rewrite omits an exact location from the accepted current summary. Both bare locations and matching link targets are allowed; no location was silently replaced.'};
  if(requirements.shorterThanCharacters&&Array.from(plain).length>=requirements.shorterThanCharacters)return {accepted:false,reason:'The rewrite is not shorter than the current readable summary. Removing Markdown syntax alone does not satisfy this request.'};
  if(requirements.oneSentence){
    let sentenceText=plain.replace(/https?:\/\/[^\s<>]+/gu,url=>'location'+(url.match(/[.!?]+$/u)?.[0]||''));
    for(const location of [...requirements.locations].sort((a,b)=>b.length-a.length))sentenceText=sentenceText.split(location).join('location');
    const sentences=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(sentenceText)].filter(part=>part.segment.trim());
    if(draft.paragraphs.length!==1||sentences.length!==1||!/[.!?]$/u.test(sentenceText))return {accepted:false,reason:'The exact request needs one complete sentence. The original native response is preserved; a support-review assertion cannot waive this format requirement.'};
  }
  return {accepted:true,reason:'Host checked the requested single-sentence/shorter format against readable current text and retained its exact locations. This is literal contract checking, not independent semantic or factual verification.'};
}
