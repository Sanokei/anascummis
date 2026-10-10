import {object,text,validateSite,checkSite,type Site} from '../core/site';
import {objectSchema,type Tool} from '../core/harness';
export function demoTools(read:()=>Site,write:(site:Site)=>void,assets:string[]):Tool[]{
  const str={type:'string'},save=(raw:unknown)=>{const site=validateSite(raw),checks=checkSite(site,assets);if(!checks.ok)throw new Error(checks.errors.join('; '));write(site);return {site,checks};};
  return [
    {name:'inspect_site',description:'Read current website and uploaded image identifiers.',schema:objectSchema({}),run:async()=>({site:read(),assets,checks:checkSite(read(),assets)})},
    {name:'set_copy',description:'Change business name, hero title or subtitle.',schema:objectSchema({field:{type:'string',enum:['name','title','subtitle']},value:str}),run:async raw=>{const a=object(raw),s=structuredClone(read());if(!['name','title','subtitle'].includes(a.field as string))throw new Error('Invalid copy field');s[a.field as 'name'|'title'|'subtitle']=text(a.value,3000);return save(s);}},
    {name:'set_theme',description:'Set #RRGGBB colors and font.',schema:objectSchema({accent:str,background:str,font:{type:'string',enum:['sans','serif','mono']}}),run:async raw=>{const a=object(raw);return save({...read(),...a});}},
    {name:'put_section',description:'Add or replace a named section. imageId must be uploaded, or empty.',schema:objectSchema({id:str,heading:str,text:str,imageId:str}),run:async raw=>{const a=object(raw),s=structuredClone(read()),i=s.sections.findIndex(x=>x.id===a.id),section={id:text(a.id),heading:text(a.heading),text:text(a.text),...(a.imageId?{imageId:text(a.imageId)}:{})};if(i<0)s.sections.push(section);else s.sections[i]=section;return save(s);}},
    {name:'put_scene_object',description:'Add a BabylonJS primitive with positions in meters.',schema:objectSchema({id:str,kind:{type:'string',enum:['box','sphere','cylinder']},color:str,x:{type:'number'},y:{type:'number'},z:{type:'number'},size:{type:'number'}}),run:async raw=>{const a=object(raw),s=structuredClone(read()),i=s.scene.findIndex(x=>x.id===a.id);if(i<0)s.scene.push(a as any);else s.scene[i]=a as any;return save(s);}}
  ];
}
