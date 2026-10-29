import {test,expect} from 'bun:test';
import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {createHash} from 'node:crypto';
import {collectionSkillSpec,groundCollectionScreen,collectionFiles,readCollectionRecipe,validateCollectionRevisionFiles,collectionBrowserContract,validateCollectionBrowserContract,collectionEvidenceMatches,collectionRevisionHeading} from '../core/collection-screen';

const goal='Build a task-list application with heading My Tasks, a text input labelled New task, an Add button, and a Remove button for each task. Add task text to the list, remove individual tasks, and persist remaining tasks after a page reload. Include browser checks and give me the source ZIP.';
const fields={title:'My Tasks',inputLabel:'New task',addButtonLabel:'Add',removeButtonLabel:'Remove'};
const spec={...fields,storageKey:'anascummis.collection.test'};

async function generated<T>(operation:(root:string)=>Promise<T>){
 const root=join(import.meta.dir,'../.test-data/collection-unit-'+crypto.randomUUID());
 try{for(const [path,source]of Object.entries(collectionFiles(spec))){const target=join(root,path);await mkdir(join(target,'..'),{recursive:true});await Bun.write(target,source);}return await operation(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('the full task-list request grounds literal fields while refusing unsupported additional behavior',()=>{
 expect(collectionSkillSpec(goal)).toEqual(fields);
 expect(groundCollectionScreen(goal,{title:'Wrong',inputLabel:'Draft',addButtonLabel:'Save',removeButtonLabel:'Delete'},spec.storageKey)).toEqual(spec);
 expect(collectionSkillSpec(goal.replace('Build a task-list','Create a simple todo').replace('My Tasks','"Shopping, today"').replace('New task','"New item"').replace('an Add button','an "Add item" button'))).toEqual({...fields,title:'Shopping, today',inputLabel:'New item',addButtonLabel:'Add item'});
 for(const extra of [' Add login.',' Edit existing tasks.',' Sort the list.',' Save to a server.',' Export a PDF.',' Include completion checkboxes.',' 还要实时天气。'])expect(collectionSkillSpec(goal+extra)).toBeUndefined();
 for(const change of [goal.replace('persist remaining tasks after a page reload','do not persist remaining tasks after a page reload'),goal.replace('remove individual tasks','remove all tasks'),goal.replace('Add task text','Add a task deadline'),goal.replace('the source ZIP','a Windows executable')])expect(collectionSkillSpec(change)).toBeUndefined();
 expect(()=>groundCollectionScreen(goal+' Add login.',fields,spec.storageKey)).toThrow('full request');
});

test('the generic compiler renders literal data and a server-safe labelled loading state',async()=>{
 await generated(async root=>{
  const {default:Page}=await import(join(root,'app/page.tsx'));
  const html=renderToStaticMarkup(createElement(Page));
  expect(html).toContain('<h1>My Tasks</h1>');expect(html).toContain('<label for="new-task">New task</label>');expect(html).toContain('aria-label="Tasks"');expect(html).toContain('Loading saved tasks');expect(html).not.toContain('role="alert"');
 });
 const hostile={...spec,title:'</script><script>throw Error(1)</script>',inputLabel:'<img onerror=alert(1)>'};
 for(const [path,source]of Object.entries(collectionFiles(hostile)))if(/\.tsx?$/.test(path))expect(new Bun.Transpiler({loader:path.endsWith('tsx')?'tsx':'ts'}).transformSync(source).length).toBeGreaterThan(0);
 expect(collectionFiles(hostile)['app/page.tsx']).not.toContain('dangerouslySetInnerHTML');
 expect(()=>collectionFiles({...spec,addButtonLabel:'Remove'})).toThrow('distinct');
 expect(()=>collectionFiles({...spec,storageKey:'../private'})).toThrow('stable');
});

test('the actual generated storage module preserves separate duplicate identities and rejects invalid saved data',async()=>{
 await generated(async root=>{
  const state=await import(join(root,'lib/collection.ts'));let raw:string|null=null,writes=0;
  const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{writes++;raw=value;}};
  const items=[{id:'a',text:'Same task'},{id:'b',text:'Same task'},{id:'c',text:'Keep me'}];
  state.saveItems(storage,spec.storageKey,items);
  state.saveItems(storage,spec.storageKey,state.loadItems(storage,spec.storageKey).filter((item:{id:string})=>item.id!=='b'));
  expect(state.loadItems(storage,spec.storageKey)).toEqual([items[0],items[2]]);expect(writes).toBe(2);
  const denseItems=Array.from({length:100},()=>({id:crypto.randomUUID(),text:'"'.repeat(200)}));let denseRaw='';const denseStorage={getItem:()=>denseRaw,setItem:(_key:string,value:string)=>{denseRaw=value;}};state.saveItems(denseStorage,spec.storageKey,denseItems);expect(denseRaw.length).toBeGreaterThan(40000);expect(state.loadItems(denseStorage,spec.storageKey)).toEqual(denseItems);
  expect(state.parseItems(JSON.stringify({version:1,items:Array.from({length:100},(_,id)=>({id:String(id),text:'\u0000'.repeat(200)}))}))).toHaveLength(100);
  for(const bad of ['{invalid','null',JSON.stringify({version:2,items:[]}),JSON.stringify({version:1,items:[items[0],items[0]]}),JSON.stringify({version:1,items:Array.from({length:101},(_,id)=>({id:String(id),text:'A'}))}),JSON.stringify({version:1,items:[{id:'a',text:' '}]}),JSON.stringify({version:1,items:[{id:'a',text:'x'.repeat(201)}]}),'x'.repeat(150001)]){
   raw=bad;expect(()=>state.loadItems(storage,spec.storageKey)).toThrow();expect(raw).toBe(bad);expect(writes).toBe(2);
  }
  const prior=raw;
  expect(()=>state.saveItems({setItem:()=>{throw new Error('Quota exceeded');}},spec.storageKey,[items[0]])).toThrow('Quota exceeded');expect(raw).toBe(prior);
  expect(()=>state.loadItems({getItem:()=>{throw new Error('Permission denied');}},spec.storageKey)).toThrow('Permission denied');
 });
});

test('complete known compiler bytes and provenance are required even if a changed file declares its own hash',()=>{
 const bundle=collectionFiles(spec);expect(readCollectionRecipe(bundle)).toEqual(spec);
 expect(JSON.parse(bundle['BUILD-PROVENANCE.json']).authorship).toContain('Trusted host compiler');
 for(const path of ['app/page.tsx','lib/collection.ts','tests/app.test.tsx','tests/collection.test.ts','README.md','BUILD-PROVENANCE.json'])expect(()=>readCollectionRecipe({...bundle,[path]:bundle[path]+'\ncustom'})).toThrow();
 const changed:Record<string,string>={...bundle,'app/page.tsx':bundle['app/page.tsx']+'\n// custom implementation'},manifest=JSON.parse(bundle['BUILD-PROVENANCE.json']);manifest.files['app/page.tsx']=createHash('sha256').update(changed['app/page.tsx']).digest('hex');changed['BUILD-PROVENANCE.json']=JSON.stringify(manifest,null,2)+'\n';expect(()=>readCollectionRecipe(changed)).toThrow('known compiler');
 const after={...spec,title:'My Week'},next=collectionFiles(after);
 expect(validateCollectionRevisionFiles({...bundle,'app/page.tsx':next['app/page.tsx']},spec,after)).toEqual(next);
 expect(()=>validateCollectionRevisionFiles({...bundle,'app/page.tsx':'custom code'},spec,after)).toThrow('checkpoint');
});

test('only a full literal heading amendment preserves the complete collection contract',()=>{
 const contract=collectionBrowserContract(spec);
 expect(collectionRevisionHeading('Change heading to My Week; keep existing add/remove/persistence behavior.')).toBe('My Week');
 expect(collectionRevisionHeading('Set the heading as "Weekend, errands". Preserve the existing add/remove/persistence behaviour.')).toBe('Weekend, errands');
 for(const guidance of ['Change heading to My Week; keep existing add/remove/persistence behavior. Add login.','Remove persistence.','Change heading to My Week and change Add to Save.','Change heading to My Week; remove all tasks.'])expect(collectionRevisionHeading(guidance)).toBeUndefined();
 expect(collectionEvidenceMatches(contract,contract)).toBe(true);
 expect(collectionEvidenceMatches(contract,{...contract,heading:'Other'})).toBe(false);
 expect(collectionEvidenceMatches(contract,{...contract,storageKey:'another-app'})).toBe(false);
 expect(collectionEvidenceMatches(contract,{kind:'counter',label:'Count',button:'Increment'})).toBe(false);
 expect(()=>validateCollectionBrowserContract({...contract,maxItems:10000})).toThrow();
 expect(()=>validateCollectionBrowserContract({...contract,extra:'unsupported'})).toThrow();
});
