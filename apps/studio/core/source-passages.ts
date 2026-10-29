export type PassageSource={id:string;label:string;text:string};
export type SelectedPassage={sourceId:string;label:string;start:number;end:number;score:number;matchedTerms:string[]};
const stop=new Set('a an the and or but to of in on at for from with by as is are was were be been it its this that these those what which where when why how does do did can could would should will you your we our they their have has had only supplied source sources excerpt excerpts question answer according please http https www com org'.split(' '));
export function sourceTerms(text:string){
  const result=new Set<string>();
  for(const token of text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]){
    if(stop.has(token))continue;
    const cjk=token.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu);
    if(cjk){for(const run of cjk){const characters=Array.from(run);if(characters.length===1)result.add(run);for(let i=0;i<characters.length-1;i++)result.add(characters[i]+characters[i+1]);}continue;}
    const word=/^[a-z]+$/.test(token)&&token.length>3&&!token.endsWith('ss')?token.replace(/s$/,''):token;
    if(!stop.has(word)&&(Array.from(word).length>=2||/^\d+$/.test(word)))result.add(word);
  }
  return [...result];
}
export function utf16Boundary(text:string,at:number){return !(at>0&&at<text.length&&/[\uD800-\uDBFF]/.test(text[at-1])&&/[\uDC00-\uDFFF]/.test(text[at]));}
function floorBoundary(text:string,at:number){return utf16Boundary(text,at)?at:at-1;}

/** Local lexical retrieval scans the complete saved text. Scores are relevance
 * hints, never factual verification or an assertion that the whole source was read. */
export function selectSourcePassages(question:string,sources:PassageSource[]):{ranges:SelectedPassage[];match:'matched'|'none'}{
  if(!sources.length||sources.length>2)throw new Error('Select one or two saved public sources.');
  const wanted=sourceTerms(question),budget=800;
  const candidates=sources.map(source=>{
    const starts=new Set<number>([0]);
    for(let offset=200;offset<source.text.length;offset+=200){let start=floorBoundary(source.text,offset),previous=source.text.slice(Math.max(0,start-80),start).search(/[^\s]*$/);start=Math.max(0,start-80)+previous;starts.add(floorBoundary(source.text,start));}
    const choices:SelectedPassage[]=[];
    for(const start of [...starts].sort((a,b)=>a-b)){
      const end=floorBoundary(source.text,Math.min(source.text.length,start+budget));if(end<=start)continue;
      const present=new Set(sourceTerms(source.text.slice(start,end))),matchedTerms=wanted.filter(term=>present.has(term));
      const candidate={sourceId:source.id,label:source.label,start,end,score:matchedTerms.length,matchedTerms};
      choices.push(candidate);
    }
    if(!choices.length)throw new Error('The saved source has no selectable text.');
    return choices.sort((a,b)=>b.score-a.score||a.start-b.start);
  });
  const ranges=candidates.map(choices=>choices[0]);
  if(sources.length===1){const first=ranges[0],covered=new Set(first.matchedTerms),second=candidates[0].filter(range=>(range.end<=first.start||range.start>=first.end)&&range.matchedTerms.some(term=>!covered.has(term))).sort((a,b)=>b.matchedTerms.filter(term=>!covered.has(term)).length-a.matchedTerms.filter(term=>!covered.has(term)).length||b.score-a.score||a.start-b.start)[0];if(second)ranges.push(second);ranges.sort((a,b)=>a.start-b.start);}
  return {ranges,match:ranges.some(range=>range.score>0)?'matched':'none'};
}
