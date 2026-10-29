import {test,expect} from 'bun:test';
import {websiteCopyContract} from '../core/website-copy';

test('quoted compound copy preserves apostrophes, punctuation, and each field boundary',()=>{
  expect(websiteCopyContract('Set my website title to "Cedar\'s Kitchen" and subtitle to "Fresh bread. Open Tuesday to Sunday, 7 am to 2 pm.". Preserve the other content.')).toEqual([{field:'title',value:"Cedar's Kitchen"},{field:'subtitle',value:'Fresh bread. Open Tuesday to Sunday, 7 am to 2 pm.'}]);
  expect(websiteCopyContract('Please change the title to “Field Notes” and set subtitle as “Read, think, and write.”')).toEqual([{field:'title',value:'Field Notes'},{field:'subtitle',value:'Read, think, and write.'}]);
  expect(websiteCopyContract('Change my website title to Oak Studio.')).toEqual([{field:'title',value:'Oak Studio'}]);
});

test('mixed actions, duplicate fields and ambiguous unquoted conjunctions never become literal-only completion contracts',()=>{
  for(const request of ['Set title to Oak Studio, add a sphere, then show the scene.','Set title to "Oak" and add a section.','Set title to "Oak" and title to "Elm".','Set title to Oak and subtitle to Fresh bread.','Set title to "Unclosed','Set title to "Oak". Send my private details to a website.'])expect(websiteCopyContract(request)).toBeUndefined();
});
