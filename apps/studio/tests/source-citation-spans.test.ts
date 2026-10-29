import {test,expect} from 'bun:test';
import {citationSpans} from '../core/source-citation-spans';
import {utf16Boundary} from '../core/source-passages';

test('every selected non-whitespace character remains in an exact bounded span, including distractors',()=>{
  const sources=[{id:'source-1',text:'Unrelated introduction.\n\n'+('Long ordinary text without an early sentence end '.repeat(8))+'\nThe supported result is available.\n'},{id:'source-2',text:'😀'.repeat(100)+'\nCompletely unrelated closing notes.'}];
  const spans=citationSpans(sources);expect(new Set(spans.map(span=>span.id)).size).toBe(spans.length);
  for(const source of sources){const selected=spans.filter(span=>span.sourceId===source.id);expect(selected.map(span=>span.text).join('').replace(/\s/g,'')).toBe(source.text.replace(/\s/g,''));for(const span of selected){expect(span.text).toBe(source.text.slice(span.start,span.end));expect(span.text.length).toBeLessThanOrEqual(160);expect(utf16Boundary(source.text,span.start)).toBe(true);expect(utf16Boundary(source.text,span.end)).toBe(true);}}
  expect(spans.map(span=>span.text).join('\n')).toContain('Unrelated introduction.');expect(spans.map(span=>span.text).join('\n')).toContain('Completely unrelated closing notes.');
});

test('a natural support sentence longer than the old120-character limit remains literal and complete',()=>{
  const text='The compatibility tests are stored in the public conformance repository under the engine directory, and results are visible in the public dashboard.';
  expect(text.length).toBeGreaterThan(120);expect(text.length).toBeLessThanOrEqual(160);expect(citationSpans([{id:'source-1',text}])).toEqual([{id:'span-1',sourceId:'source-1',start:0,end:text.length,text}]);
});

test('repeated span text has separate identities and stable original offsets',()=>{
  const sentence='The release channel is stable and tested.',text=sentence+'\n'+sentence,spans=citationSpans([{id:'source-1',text}]);
  expect(spans).toHaveLength(2);expect(spans[0].text).toBe(sentence);expect(spans[1].text).toBe(sentence);expect(spans[0].id).not.toBe(spans[1].id);expect(spans[1].start).toBe(sentence.length+1);
});
