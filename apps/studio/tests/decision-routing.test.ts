import {test,expect} from 'bun:test';
import {indexedRoute} from '../core/decision-routing';

test('software tool decisions retain their goal, requirement and inspected source packet',()=>{
  const packet={goal:'Change the heading to Repair Verified.',requirement:{id:'heading',description:'The heading is Repair Verified.'},lastRead:{path:'app/page.tsx',source:'Repair Baseline'}};
  const encoded=JSON.stringify(packet);
  expect(indexedRoute(encoded,{properties:{tool:{enum:['read_file','replace_text']}}})).toBeUndefined();
  expect(JSON.parse(encoded)).toEqual(packet);
});

test('harness decisions still expose indexed eligible operations and decode to host tool identifiers',()=>{
  const route=indexedRoute(JSON.stringify({request:'Change website title',tools:[{name:'set_copy',description:'Change website title'},{name:'inspect_site',description:'Inspect current website'}]}),{properties:{tool:{enum:['set_copy','inspect_site','finish']},message:{type:'string'}}})!;
  const packet=JSON.parse(route.user),choice=packet.choices.find((entry:any)=>entry.action==='Change website title');
  expect(packet.request).toBe('Change website title');
  expect(route.decode({index:choice.index,message:''})).toEqual({tool:'set_copy',message:''});
});
