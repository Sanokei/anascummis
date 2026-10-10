/** OnlineSlop-style indexed choices: the host owns identifiers and contracts;
 * the small model selects an index instead of generating a tool name. */
export function indexedRoute(user:string,schema:Record<string,any>){
  const names=schema.properties?.tool?.enum;
  if(!Array.isArray(names)||!names.length)return undefined;
  let packet:any;try{packet=JSON.parse(user);}catch{return undefined;}
  const tools=Array.isArray(packet.tools)?packet.tools:[];
  const words=(value:string)=>new Set(value.toLowerCase().match(/[a-z][a-z0-9]+/g)?.filter(w=>!new Set('the and for with from this that user website current requested change read use supplied only before after'.split(' ')).has(w)).map(w=>w.replace(/s$/,''))??[]);
  const request=words(String(packet.request??''));
  const candidates=names.filter((name:string)=>name!=='ask'&&name!=='finish').map((name:string)=>({name,action:tools.find((t:any)=>t.name===name)?.description??name}));
  const vocabulary=candidates.map(c=>words(c.action+' '+c.name.replace(/_/g,' ')));
  const ranked=candidates.map((c,i)=>({...c,score:[...request].reduce((n,w)=>n+(vocabulary[i].has(w)?Math.log(1+candidates.length/vocabulary.filter(v=>v.has(w)).length):0),0)})).sort((a,b)=>b.score-a.score);
  // Retrieve a small candidate set as OnlineSlop retrieves eligible passages.
  // No match retains the entire registry; a rank is relevance, not correctness.
  const selected=ranked[0]?.score>0?ranked.slice(0,3):ranked;
  const hasFailure=Array.isArray(packet.recent)&&packet.recent.some((t:any)=>!t.ok);
  const choices=[...selected,...names.filter((name:string)=>name==='finish'||name==='ask'&&(!selected.length||!ranked[0]?.score||hasFailure)).map((name:string)=>({name,action:name==='finish'?'All requested actions have executed successfully':'Required user information is missing'}))].map((c,index)=>({...c,index}));
  return {user:JSON.stringify({request:packet.request,completed:packet.completed??[],recent:packet.recent??[],choices:choices.map(({index,action})=>({index,action}))}),schema:{type:'object',properties:{index:{type:'integer',minimum:0,maximum:choices.length-1},message:schema.properties.message},required:['index','message'],additionalProperties:false},decode:(value:any)=>{if(!Number.isInteger(value.index)||value.index<0||value.index>=choices.length)throw new Error('Decision index is outside the host choices');return {tool:choices[value.index].name,message:value.message};}};
}
