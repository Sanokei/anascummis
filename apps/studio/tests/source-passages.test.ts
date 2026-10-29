import {test,expect} from 'bun:test';
import {selectSourcePassages,utf16Boundary} from '../core/source-passages';

test('local question terms select supporting passages beyond the original prefix without modifying source offsets',()=>{
  const source='Welcome and general background. '.repeat(90)+'\nCompatibility tests live in the platform suite. Browser results are published on the dashboard.\n'+'Unrelated appendix. '.repeat(100);
  const selected=selectSourcePassages('Where do compatibility tests live and where are browser results published?',[{id:'one',label:'source-1',text:source}]);
  expect(selected.match).toBe('matched');const range=selected.ranges[0],text=source.slice(range.start,range.end);expect(range.start).toBeGreaterThan(0);expect(range.end-range.start).toBeLessThanOrEqual(1600);expect(text).toContain('Compatibility tests live in the platform suite.');expect(text).toContain('Browser results are published on the dashboard.');expect(range.matchedTerms).toContain('browser');expect(selected).toEqual(selectSourcePassages('Where do compatibility tests live and where are browser results published?',[{id:'one',label:'source-1',text:source}]));
});

test('two saved sources share the fixed budget and no-match selection is explicit',()=>{
  const sources=[{id:'one',label:'source-1',text:'alpha '.repeat(400)},{id:'two',label:'source-2',text:'beta '.repeat(400)}];
  const selected=selectSourcePassages('Compare alpha and beta.',sources);expect(selected.ranges).toHaveLength(2);expect(selected.ranges.reduce((n,range)=>n+range.end-range.start,0)).toBeLessThanOrEqual(1600);expect(selected.ranges.every(range=>range.end-range.start<=800)).toBe(true);
  const none=selectSourcePassages('zebra quartz',sources);expect(none.match).toBe('none');expect(none.ranges.every(range=>range.score===0&&range.start===0)).toBe(true);
});

test('candidate boundaries never split UTF-16 surrogate pairs',()=>{
  const source='😀'.repeat(999)+'\nThe telescope observes galaxies. '+'😀'.repeat(1000),selected=selectSourcePassages('Which telescope observes galaxies?',[{id:'one',label:'source-1',text:source}]);
  for(const range of selected.ranges){expect(utf16Boundary(source,range.start)).toBe(true);expect(utf16Boundary(source,range.end)).toBe(true);expect(source.slice(range.start,range.end)).toContain('telescope');}
});

test('a second nonoverlapping passage covers distinct question terms thousands of positions away',()=>{
  const source='Opening notes. '.repeat(100)+'\nCompatibility tests live in the platform suite.\n'+'General prose. '.repeat(250)+'\nBrowser results are published on the dashboard.\n'+'Closing notes. '.repeat(100);
  const {ranges}=selectSourcePassages('Where do compatibility tests live and where are browser results published?',[{id:'one',label:'source-1',text:source}]);
  expect(ranges).toHaveLength(2);expect(ranges[0].end).toBeLessThanOrEqual(ranges[1].start);expect(ranges.every(range=>range.end-range.start<=800)).toBe(true);expect(ranges.map(range=>source.slice(range.start,range.end)).join('\n')).toContain('Compatibility tests live in the platform suite.');expect(ranges.map(range=>source.slice(range.start,range.end)).join('\n')).toContain('Browser results are published on the dashboard.');
});

test('English stopwords do not survive stemming and short code and CJK terms remain selectable',()=>{
  const none=selectSourcePassages('What does this do?',[{id:'one',label:'source-1',text:'This does nothing related to the question.'}]);expect(none.match).toBe('none');
  const code='Opening. '.repeat(150)+'\nThe li element is a list item.';const selected=selectSourcePassages('Explain li.',[{id:'one',label:'source-1',text:code}]);expect(selected.ranges[0].matchedTerms).toContain('li');expect(selected.ranges[0].start).toBeGreaterThan(0);
  const chinese='开场介绍。'.repeat(400)+'颜色是蓝色。';const multilingual=selectSourcePassages('颜色是什么？',[{id:'one',label:'source-1',text:chinese}]);expect(multilingual.match).toBe('matched');expect(multilingual.ranges[0].matchedTerms).toContain('颜色');expect(chinese.slice(multilingual.ranges[0].start,multilingual.ranges[0].end)).toContain('颜色是蓝色');
});
