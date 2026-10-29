import {createHash} from 'node:crypto';
import {objectSchema,validate} from './harness';

/** A trusted compiler for one bounded text collection, not arbitrary model-written code. */
export const collectionScreenSchema=objectSchema({title:{type:'string',maxLength:80},inputLabel:{type:'string',maxLength:60},addButtonLabel:{type:'string',maxLength:60},removeButtonLabel:{type:'string',maxLength:60}});
export type CollectionFields={title:string;inputLabel:string;addButtonLabel:string;removeButtonLabel:string};
export type CollectionScreen=CollectionFields&{storageKey:string};
export type CollectionBrowserContract={kind:'collection';heading:string;inputLabel:string;addButton:string;removeButton:string;listLabel:'Tasks';storage:'localStorage';storageKey:string;maxItems:100;maxTextLength:200};
export const collectionSourcePaths=['app/page.tsx','lib/collection.ts','tests/app.test.tsx','tests/collection.test.ts','README.md','BUILD-PROVENANCE.json'] as const;

const literal='(?:"([^"\\r\\n]+)"|“([^”\\r\\n]+)”|\'([^\'\\r\\n]+)\'|([^,.;!?\\r\\n]+))';
function capture(match:RegExpMatchArray,start:number){return (match[start]??match[start+1]??match[start+2]??match[start+3]).trim();}
function fields(raw:unknown):CollectionFields{
 validate(collectionScreenSchema,raw);const value=raw as CollectionFields;
 if(Object.values(value).some(text=>!text.trim())||value.addButtonLabel===value.removeButtonLabel)throw new Error('Collection controls require distinct, nonempty accessible labels');
 return {...value};
}
export function validateCollectionScreen(raw:unknown):CollectionScreen{
 const value=raw as CollectionScreen;
 if(!value||typeof value.storageKey!=='string'||!/^[-a-zA-Z0-9._:]{1,120}$/.test(value.storageKey))throw new Error('Collection storage needs a stable bounded application key');
 const {storageKey,...rest}=value;return {...fields(rest),storageKey};
}

/** The entire request must fit this grammar. Extra features never acquire recipe acceptance. */
export function collectionSkillSpec(goal:string):CollectionFields|undefined{
 if(typeof goal!=='string'||goal.length>1000)return;
 const expression='^\\s*(?:build|create|make)\\s+(?:(?:a|an)\\s+)?(?:(?:small|simple)\\s+)?(?:task[- ]list|to-?do)\\s+(?:app|application)\\s+with\\s+(?:the\\s+)?heading\\s+'+literal+',\\s+a\\s+text\\s+input\\s+label(?:led|ed)\\s+'+literal+',\\s+an?\\s+'+literal+'\\s+button,\\s+and\\s+an?\\s+'+literal+'\\s+button\\s+for\\s+each\\s+task\\.\\s+Add\\s+task\\s+text\\s+to\\s+the\\s+list,\\s+remove\\s+individual\\s+tasks,\\s+and\\s+persist\\s+remaining\\s+tasks\\s+after\\s+a\\s+page\\s+reload\\.\\s*(?:Include\\s+browser\\s+(?:checks|tests)\\s+and\\s+(?:give\\s+me|provide)\\s+the\\s+source\\s+ZIP\\.?)?\\s*$';
 const match=goal.match(new RegExp(expression,'i'));if(!match)return;
 try{return fields({title:capture(match,1),inputLabel:capture(match,5),addButtonLabel:capture(match,9),removeButtonLabel:capture(match,13)});}catch{return;}
}
export function groundCollectionScreen(goal:string,proposal:unknown,storageKey:string):CollectionScreen{
 fields(proposal);const requested=collectionSkillSpec(goal);if(!requested)throw new Error('The full request is outside the bounded collection contract');
 return validateCollectionScreen({...requested,storageKey});
}
export function collectionBrowserContract(raw:CollectionScreen):CollectionBrowserContract{
 const spec=validateCollectionScreen(raw);return {kind:'collection',heading:spec.title,inputLabel:spec.inputLabel,addButton:spec.addButtonLabel,removeButton:spec.removeButtonLabel,listLabel:'Tasks',storage:'localStorage',storageKey:spec.storageKey,maxItems:100,maxTextLength:200};
}
export function validateCollectionBrowserContract(raw:unknown):CollectionBrowserContract{
 const value=raw as CollectionBrowserContract;
 if(!value||value.kind!=='collection'||value.listLabel!=='Tasks'||value.storage!=='localStorage'||value.maxItems!==100||value.maxTextLength!==200||Object.keys(value).some(key=>!['kind','heading','inputLabel','addButton','removeButton','listLabel','storage','storageKey','maxItems','maxTextLength'].includes(key)))throw new Error('Unsupported bounded collection browser contract; it cannot be dropped silently');
 return collectionBrowserContract({title:value.heading,inputLabel:value.inputLabel,addButtonLabel:value.addButton,removeButtonLabel:value.removeButton,storageKey:value.storageKey});
}
export function collectionScreenFromContract(raw:unknown):CollectionScreen{
 const value=validateCollectionBrowserContract(raw);return {title:value.heading,inputLabel:value.inputLabel,addButtonLabel:value.addButton,removeButtonLabel:value.removeButton,storageKey:value.storageKey};
}
export function collectionEvidenceMatches(expected:CollectionBrowserContract,actual:unknown){
 try{return JSON.stringify(validateCollectionBrowserContract(expected))===JSON.stringify(validateCollectionBrowserContract(actual));}catch{return false;}
}
/** Only a complete heading-only amendment may reuse trusted collection compilation. */
export function collectionRevisionHeading(guidance:string):string|undefined{
 if(typeof guidance!=='string'||guidance.length>400)return;
 const match=guidance.match(new RegExp('^\\s*(?:change|set)\\s+(?:the\\s+)?heading\\s+(?:to|as)\\s+'+literal+'[;.]\\s*(?:keep|preserve)\\s+(?:the\\s+)?existing\\s+add/remove/persistence\\s+behavio(?:u)?r\\.?\\s*$','i'));
 if(!match)return;const heading=capture(match,1);return heading&&heading.length<=80?heading:undefined;
}
export function collectionRequirement(spec:CollectionScreen){return 'Show exactly '+JSON.stringify(spec.title)+' with labelled input '+JSON.stringify(spec.inputLabel)+', '+JSON.stringify(spec.addButtonLabel)+' and per-item '+JSON.stringify(spec.removeButtonLabel)+'. Add nonblank text, remove only its selected item (including duplicates), and persist the remaining collection after reload.';}

const stateSource=`export type Item={id:string;text:string};
export const MAX_ITEMS=100,MAX_TEXT=200;
export function parseItems(raw:string|null):Item[]{
 if(raw===null)return [];
 if(raw.length>150000)throw new Error('Saved tasks exceed this application limit. Existing data was kept.');
 const value=JSON.parse(raw);
 if(!value||value.version!==1||!Array.isArray(value.items)||value.items.length>MAX_ITEMS)throw new Error('Saved tasks have an unsupported format. Existing data was kept.');
 const ids=new Set<string>();
 for(const item of value.items){if(!item||typeof item.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(item.id)||ids.has(item.id)||typeof item.text!=='string'||!item.text.trim()||item.text.length>MAX_TEXT)throw new Error('Saved tasks have an unsupported item. Existing data was kept.');ids.add(item.id);}
 return value.items.map((item:Item)=>({id:item.id,text:item.text}));
}
export function loadItems(storage:Pick<Storage,'getItem'>,key:string):Item[]{return parseItems(storage.getItem(key));}
export function saveItems(storage:Pick<Storage,'setItem'>,key:string,items:Item[]):void{const raw=JSON.stringify({version:1,items});parseItems(raw);storage.setItem(key,raw);}
`;

export function compileCollectionScreen(raw:CollectionScreen){
 const spec=validateCollectionScreen(raw);
 return `'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {loadItems,saveItems,MAX_ITEMS,MAX_TEXT,type Item} from '../lib/collection';
const spec=${JSON.stringify(spec)};
export default function Page(){
 const [items,setItems]=useState<Item[]>([]),[draft,setDraft]=useState(''),[ready,setReady]=useState(false),[error,setError]=useState('');
 const current=useRef<Item[]>([]);
 useEffect(()=>{try{const saved=loadItems(window.localStorage,spec.storageKey);current.current=saved;setItems(saved);setReady(true);}catch{setError('Saved tasks could not be read. Existing browser data was kept; check browser storage permissions or recover the saved data before editing.');}},[]);
 function commit(next:Item[]){try{saveItems(window.localStorage,spec.storageKey,next);current.current=next;setItems(next);setError('');return true;}catch{setError('Changes could not be saved in this browser. Your text and existing tasks were kept. Check browser storage permissions or free space, then try again.');return false;}}
 function add(event:FormEvent){event.preventDefault();const text=draft.trim();if(!ready||!text||text.length>MAX_TEXT||current.current.length>=MAX_ITEMS)return;const next=[...current.current,{id:crypto.randomUUID(),text}];if(commit(next))setDraft('');}
 return <main className="collection-screen"><style>{${JSON.stringify('.collection-screen{min-height:100dvh;box-sizing:border-box;background:#f4f7fb;color:#14243b;font:16px/1.5 system-ui,sans-serif;padding:clamp(16px,5vw,64px)}.collection-card{box-sizing:border-box;max-width:680px;margin:0 auto;background:white;border:1px solid #d9e2ed;border-radius:20px;padding:clamp(20px,5vw,40px);box-shadow:0 12px 40px #18344d0d}.collection-card h1{font-size:clamp(28px,6vw,40px);line-height:1.15;margin:0 0 12px;overflow-wrap:anywhere}.collection-note{color:#4d6075;font-size:14px}.collection-form{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.collection-field{flex:1 1 200px;min-width:0}.collection-field label{display:block;font-weight:650;margin-bottom:6px}.collection-field input{box-sizing:border-box;display:block;width:100%;min-width:0;min-height:46px;border:1px solid #91a3ba;border-radius:9px;padding:10px;font:inherit}.collection-screen button{min-height:46px;border:1px solid #164c8b;border-radius:9px;background:#164c8b;color:white;padding:10px 18px;font:inherit;font-weight:650;cursor:pointer}.collection-form button{align-self:flex-end}.collection-screen button:disabled{cursor:default;opacity:.5}.collection-screen :is(input,button):focus-visible{outline:3px solid #26a7dc;outline-offset:3px}.collection-list{list-style:none;margin:0;padding:0}.collection-item{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid #e2e8f0;padding:14px 0}.collection-item span{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}.collection-item button{flex:none;background:white;color:#9c2020;border-color:#d6a7a7}.collection-error{padding:12px;border:1px solid #c74747;border-radius:9px;background:#fff1f1;color:#821919}.collection-empty{color:#4d6075}')} }</style><section className="collection-card" aria-label="Task collection"><h1>{spec.title}</h1><p className="collection-note">Saved in this browser. Up to {MAX_ITEMS} tasks, {MAX_TEXT} characters each.</p><form className="collection-form" onSubmit={add}><div className="collection-field"><label htmlFor="new-task">{spec.inputLabel}</label><input id="new-task" value={draft} maxLength={MAX_TEXT} disabled={!ready} onChange={event=>setDraft(event.target.value)}/></div><button type="submit" disabled={!ready||!draft.trim()||items.length>=MAX_ITEMS}>{spec.addButtonLabel}</button></form>{error&&<p className="collection-error" role="alert">{error}</p>}{!ready&&!error&&<p role="status">Loading saved tasks…</p>}<ul className="collection-list" aria-label="Tasks">{items.map(item=><li className="collection-item" key={item.id}><span>{item.text}</span><button type="button" onClick={()=>{if(ready)commit(current.current.filter(saved=>saved.id!==item.id));}}>{spec.removeButtonLabel}</button></li>)}</ul>{ready&&!items.length&&<p className="collection-empty">No tasks yet. Add your first task above.</p>}{items.length>=MAX_ITEMS&&<p role="status">This list is full. Remove a task before adding another.</p>}</section></main>;
}
`;
}

export function collectionFiles(raw:CollectionScreen):Record<string,string>{
 const spec=validateCollectionScreen(raw);
 const result:Record<string,string>={
  'app/page.tsx':compileCollectionScreen(spec),
  'lib/collection.ts':stateSource,
  'tests/app.test.tsx':`import {test,expect} from 'bun:test';import {renderToStaticMarkup} from 'react-dom/server';import Page from '../app/page';const spec=${JSON.stringify(spec)};test('requested collection has an exact heading and labelled accessible controls before hydration',()=>{const html=renderToStaticMarkup(<Page/>);expect(html).toContain(renderToStaticMarkup(<h1>{spec.title}</h1>));expect(html).toContain(renderToStaticMarkup(<label htmlFor="new-task">{spec.inputLabel}</label>));expect(html).toContain('aria-label="Tasks"');expect(html).toContain(spec.addButtonLabel);expect(html).toContain('Loading saved tasks');});\n`,
  'tests/collection.test.ts':`import {test,expect} from 'bun:test';import {loadItems,saveItems,parseItems} from '../lib/collection';test('stable identity preserves duplicate task text and removes only a selected item',()=>{let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_key:string,next:string)=>{raw=next;}};const items=[{id:'first',text:'Same task'},{id:'second',text:'Same task'},{id:'third',text:'Another task'}];saveItems(storage,'tasks',items);const remaining=loadItems(storage,'tasks').filter(item=>item.id!=='second');saveItems(storage,'tasks',remaining);expect(loadItems(storage,'tasks')).toEqual([items[0],items[2]]);});test('invalid storage is rejected without writing and write failures propagate before publishing success',()=>{const bad='{invalid';expect(()=>loadItems({getItem:()=>bad},'tasks')).toThrow();expect(()=>parseItems(JSON.stringify({version:1,items:[{id:'same',text:'A'},{id:'same',text:'B'}]}))).toThrow();expect(()=>saveItems({setItem:()=>{throw new Error('Storage unavailable');}},'tasks',[{id:'one',text:'Kept draft'}])).toThrow('Storage unavailable');});\n`,
  'README.md':'# '+spec.title+'\n\nThis is a bounded persistent text-collection application compiled by the trusted Anascummis collection compiler (version 1). Native model inference supplies a schema-checked behavior decision; the host grounds literal user fields and generates the implementation and tests. It is not evidence of arbitrary model-authored source. See BUILD-PROVENANCE.json.\n\nRun `bun install --frozen-lockfile`, `bun test`, `bun run build`, then `bun run start --port 3216` and open http://127.0.0.1:3216 (or choose another free port). Bun, Node 20.9+ and an installed browser are separate prerequisites. This pure collection app runs locally without the Studio AI model. The source ZIP contains source and its saved dependency lock; dependencies and model weights are excluded.\n\nAdd nonblank text (at most 200 characters) to the initially empty list, up to 100 items. Each Remove button deletes only its own item, even with duplicate text. Items persist across reloads at the same browser origin using localStorage. A heading-only revision retains the same application key. Independently hosted ports/origins do not share browser data. Browser storage can be cleared or denied; failures are shown without clearing the draft or overwriting unreadable saved records. Account sync, collaboration, concurrent-tab conflict resolution, item editing, completion states and remote storage are outside this contract.\n\nThe host separately verifies actual production browser interactions, reload persistence, screenshots, build checks and the source snapshot. Passing this contract establishes only those bounded behaviors.\n'
 };
 result['BUILD-PROVENANCE.json']=JSON.stringify({format:'anascummis.bounded-collection.v1',compiler:{id:'persistent-text-collection',version:1},spec,authorship:'Trusted host compiler; native model supplies a real schema-checked decision. Literal user fields and persistence limits are host-grounded. This is not arbitrary model-authored code.',behavior:{initialItems:0,stableItemIdentity:true,duplicateText:true,maxItems:100,maxTextLength:200,storage:'same-origin localStorage',concurrentTabConflictResolution:false},files:Object.fromEntries(Object.entries(result).map(([path,source])=>[path,createHash('sha256').update(source).digest('hex')]))},null,2)+'\n';
 return result;
}
/** Require the complete known compiler bundle, not a model-written provenance assertion. */
export function readCollectionRecipe(files:Record<string,string>):CollectionScreen{
 let manifest:{spec?:unknown};try{manifest=JSON.parse(files['BUILD-PROVENANCE.json']);}catch{throw new Error('The accepted collection compiler provenance is missing or unreadable');}
 const spec=validateCollectionScreen(manifest?.spec),expected=collectionFiles(spec);
 if(collectionSourcePaths.some(path=>files[path]!==expected[path]))throw new Error('Accepted collection source/provenance hashes differ from the known compiler; automatic recipe replacement was stopped');
 return spec;
}
/** A saved before/after checkpoint can finish only its own exact compiler writes. */
export function validateCollectionRevisionFiles(files:Record<string,string>,before:CollectionScreen,after:CollectionScreen){
 const oldFiles=collectionFiles(before),newFiles=collectionFiles(after);
 if(collectionSourcePaths.some(path=>files[path]!==oldFiles[path]&&files[path]!==newFiles[path]))throw new Error('Collection revision source changed outside its saved compiler checkpoint');
 return newFiles;
}
