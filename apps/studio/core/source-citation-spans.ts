import {utf16Boundary} from './source-passages';

export type CitationSpan={id:string;sourceId:string;start:number;end:number;text:string};
/** Enumerate all selected non-whitespace text, without question-aware filtering.
 * Sentence boundaries are preferred; long sentences use literal bounded chunks. */
export function citationSpans(sources:{id:string;text:string}[]):CitationSpan[]{
  const spans:CitationSpan[]=[];
  for(const source of sources){let start=0;
    while(start<source.text.length){
      while(start<source.text.length&&/\s/u.test(source.text[start]))start++;
      if(start===source.text.length)break;
      let bound=Math.min(source.text.length,start+160);if(!utf16Boundary(source.text,bound))bound--;
      const available=source.text.slice(start,bound),boundaries=[...available.matchAll(/[.!?](?=\s|$)|\n+/g)].map(match=>match.index!+match[0].length);
      const first=boundaries[0];let length=first!==undefined&&first>=32?first:boundaries.filter(end=>end>=32).at(-1);
      if(length===undefined){if(bound===source.text.length)length=available.length;else{const whitespace=[...available.matchAll(/\s+/g)].at(-1);length=whitespace&&whitespace.index!>0?whitespace.index!:available.length;}}
      let end=start+length;while(end>start&&/\s/u.test(source.text[end-1]))end--;
      if(!utf16Boundary(source.text,end))end--;
      if(end<=start)throw new Error('A selected source span could not be bounded safely.');
      spans.push({id:'span-'+(spans.length+1),sourceId:source.id,start,end,text:source.text.slice(start,end)});start=end;
    }
  }
  if(!spans.length||spans.length>64)throw new Error('The complete selected text exceeds the bounded citation-span catalog. Select a smaller passage; no spans were omitted.');
  return spans;
}
