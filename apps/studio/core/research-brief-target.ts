import type {DocumentEditTarget} from './research-brief-edit-types';

/** Offsets refer to the exact saved UTF-16 string. Blank-line separators and all
 * unselected bytes remain outside the chosen range and are never reconstructed. */
export function noteParagraphs(notes:string):{index:number;start:number;end:number;text:string}[] {
  const result:{index:number;start:number;end:number;text:string}[]=[];
  const separators=/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/gu;
  let start=0;
  const add=(end:number)=>{const text=notes.slice(start,end);if(text.trim())result.push({index:result.length,start,end,text});};
  for(const match of notes.matchAll(separators)){add(match.index);start=match.index+match[0].length;}
  add(notes.length);return result;
}

/** A clarification is deliberate, separate context. Never infer a section or
 * format from an ambiguous original request or fill a missing choice silently. */
export function validateDocumentEditTarget(value:unknown):DocumentEditTarget|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Choose the intended section and format before saving an edit. The original request is kept.');
  const item=value as Record<string,unknown>;
  if(item.section==='summary'&&item.format==='shorter-single-sentence'&&Object.keys(item).every(key=>['section','format'].includes(key)))return {section:'summary',format:'shorter-single-sentence'};
  if(item.section==='notes'&&item.format==='clearer-plain-paragraph'&&Number.isInteger(item.paragraph)&&Number(item.paragraph)>=0&&Number(item.paragraph)<100&&typeof item.paragraphSha256==='string'&&/^[a-f0-9]{64}$/u.test(item.paragraphSha256)&&Object.keys(item).every(key=>['section','paragraph','paragraphSha256','format'].includes(key)))return {section:'notes',paragraph:Number(item.paragraph),paragraphSha256:item.paragraphSha256,format:'clearer-plain-paragraph'};
  throw new Error('Choose an explicit supported section, paragraph and format before saving an edit. The original request is kept; no section or format was inferred.');
}

/** A narrow literal conflict check, not general intent classification. Explicit
 * preservation/negative clauses do not authorize changing that named section. */
export function documentEditTargetMismatch(intent:string,target:DocumentEditTarget|undefined):string|undefined {
  if(!target)return;
  const action=/\b(?:rewrite|revise|edit|change|shorten|condense|simplify|rephrase|clarify|improve|expand|make)\s+(?:(?:the|this|my|our|current|accepted|existing|original|factual|personal)\s+){0,5}(summary|factual\s+paragraph|notes?(?:\s+paragraph)?)\b/giu;
  const sectionOf=(name:string)=>/^(?:summary|factual\s+paragraph)$/iu.test(name)?'summary':'notes';
  const preserved=(section:string)=>'The original request explicitly preserves '+(section==='summary'?'the summary':'personal notes')+' unchanged, while that section is selected for rewriting. Clarify the intended section before saving. The complete request and current choices are kept; nothing was submitted.';
  for(const clause of intent.split(/[;,.!?\n]|\b(?:but|however|instead)\b/iu)){
    const preservation=/\b(?:keep|leave)\s+(?:(?:the|this|my|our|current|accepted|existing|original|factual|personal)\s+){0,5}(summary|factual\s+paragraph|notes?)\s+(?:unchanged|untouched|as\s+is|the\s+same)\b/giu;
    for(const match of clause.matchAll(preservation)){const section=sectionOf(match[1]);if(section===target.section)return preserved(section);}
    for(const match of clause.matchAll(action)){
      const prefix=clause.slice(0,match.index),section=sectionOf(match[1]);
      if(/\b(?:do\s+not|don['’]t|never|without)\b(?:(?!\b(?:and|then)\b).)*$/iu.test(prefix)){if(section===target.section)return preserved(section);continue;}
      if(section!==target.section)return 'The original request explicitly asks to change '+(section==='summary'?'the summary':'personal notes')+', while the selected section is '+(target.section==='summary'?'Summary':'Personal notes')+'. Clarify the intended section before saving. The complete request and current choices are kept; nothing was submitted.';
    }
  }
}

/** Compatibility only for the earlier summary editor. New explicit section
 * choices remain separate from this literal old-format detection. */
export function hasLegacySummaryIntent(intent:string){
  if(documentEditTargetMismatch(intent,{section:'summary',format:'shorter-single-sentence'}))return false;
  return /\b(?:summary|factual\s+paragraph)\b/iu.test(intent)||/\b(?:give|write|rewrite|format|present|start)\b[^;.!?\n]{0,160}\b(?:facts?|sentences?)\b/iu.test(intent);
}

/** A literal change guard, not a judgement of clarity or semantic equivalence. */
export function noteWords(value:string){return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
