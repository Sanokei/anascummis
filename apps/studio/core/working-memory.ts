/** Evidence stays outside the model. The model sees small, explicitly partial
 * views and can request a JSON pointer or text page when it needs detail. */
export class WorkingMemory {
  private records=new Map<string,unknown>();
  put(id:string,value:unknown){this.records.set(id,JSON.parse(JSON.stringify(value??null)));}
  read(id:string,path:string,offset=0){
    if(!this.records.has(id))throw new Error('Unknown evidence reference');
    let value:any=this.records.get(id);
    if(path){if(!path.startsWith('/'))throw new Error('Use a JSON pointer beginning with /');for(const part of path.slice(1).split('/')){const key=part.replace(/~1/g,'/').replace(/~0/g,'~');if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('Evidence path not found');value=value[key];}}
    const encoded=JSON.stringify(value);
    return {id,path,offset,total:encoded.length,partial:offset+900<encoded.length,data:encoded.slice(offset,offset+900),next:offset+900<encoded.length?offset+900:null};
  }
  catalog(id:string){const value:any=this.records.get(id),encoded=JSON.stringify(value);return {id,keys:value&&typeof value==='object'?Object.keys(value).slice(0,24):[],partial:encoded.length>450,preview:encoded.slice(0,450)};}
  view(id:string){const value=this.records.get(id),encoded=JSON.stringify(value);return encoded.length<=900?{id,partial:false,value}:{...this.catalog(id),paths:['',...(value&&typeof value==='object'?Object.keys(value).slice(0,24).map(k=>'/'+k.replace(/~/g,'~0').replace(/\//g,'~1')):[])]};}
  references(){return [...this.records.keys()];}
}
export const CONTEXT_TOKENS=2048;
export function countInputTokens(inputIds:number[]|number[][]){const count=Array.isArray(inputIds[0])?(inputIds[0] as number[]).length:inputIds.length;if(!Number.isInteger(count)||count<1)throw new Error('Tokenizer returned no prompt tokens');return count;}
export function outputBudget(schema:Record<string,any>){return schema.properties?.answer?96:schema.properties?.tool?160:(schema.properties?.content||schema.properties?.component)?768:384;}

