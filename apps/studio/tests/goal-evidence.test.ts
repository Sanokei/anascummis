import {test, expect} from 'bun:test';
import {dependencyEvidence, executionEvidence} from '../core/goal-evidence';
import type {GoalRecord, GoalTask, GoalSpecialist} from '../core/goal-orchestrator';
import type {Trace} from '../core/harness';
import {initialSite} from '../core/site';

function task(id: string, specialist: GoalSpecialist, evidence = ['Host-inspected title: Oak']): GoalTask {
  return {id, specialist, description: 'A bounded task', acceptance: 'Checked output', dependsOn: [], status: 'verified', attempts: 1,
    execution: {verified: true, message: 'UNSUPPORTED-MODEL-SUMMARY', evidence}, review: {accepted: true, reason: 'Host evidence matches.'}};
}
function goal(tasks: GoalTask[], research = false): GoalRecord {
  return {id: crypto.randomUUID(), request: 'A multi-step goal', projectId: crypto.randomUUID(), research, tasks, status: 'running', phase: 'executing', message: '',
    created: 1, updated: 1, events: [], planningOffset: 1, planningDone: true, planningCalls: 1, coverageOffset: 0, coverageDone: false, notes: []};
}
function target(specialist: GoalSpecialist, dependsOn: string[]) {return {...task('step-2', specialist), status: 'pending' as const, dependsOn};}

test('handoffs contain actual host evidence, never the predecessor model summary', () => {
  const source = task('step-1', 'research', ['Actual source https://example.com: Opens at 10 am. Retrieved 2026-10-29.']);
  const result = dependencyEvidence(target('analysis', ['step-1']), goal([source]), false);
  expect(result).toEqual([{id: 'step-1', specialist: 'research', evidence: source.execution!.evidence}]);
  expect(JSON.stringify(result)).not.toContain('UNSUPPORTED-MODEL-SUMMARY');
  result[0].evidence.push('mutated caller copy');
  expect(source.execution!.evidence).toHaveLength(1);
});

test('local roles can consume private accepted work but network roles cannot', () => {
  const privateTask = task('step-1', 'pdf', ['Private PDF excerpt']);
  expect(dependencyEvidence(target('analysis', ['step-1']), goal([privateTask]), false)[0].specialist).toBe('pdf');
  expect(() => dependencyEvidence(target('research', ['step-1']), goal([privateTask], true), true)).toThrow('Private predecessor');
  const publicTask = task('step-1', 'video_sources', ['Captured public source media: public-media-1']);
  expect(dependencyEvidence(target('research', ['step-1']), goal([publicTask], true), true)[0].evidence[0]).toContain('public-media-1');
  expect(() => dependencyEvidence(target('research', ['step-1']), goal([publicTask]), true)).toThrow('does not grant');
});

test('missing, unaccepted, duplicate and oversized dependency packets fail rather than drop evidence', () => {
  expect(() => dependencyEvidence(target('analysis', ['missing']), goal([]), false)).toThrow('accepted host');
  const unreviewed = task('step-1', 'website'); delete unreviewed.review;
  expect(() => dependencyEvidence(target('analysis', ['step-1']), goal([unreviewed]), false)).toThrow('accepted host');
  const source = task('step-1', 'research');
  expect(() => dependencyEvidence(target('analysis', ['step-1', 'step-1']), goal([source]), false)).toThrow('distinct');
  const large = task('step-1', 'research', ['x'.repeat(2600)]);
  expect(() => dependencyEvidence(target('analysis', ['step-1']), goal([large]), false)).toThrow('no receipt was silently omitted');
});

test('research receipts retain actual source text, URL and retrieval time and label long excerpts', () => {
  const page = 'The workshop opens at 10 am on Saturdays. ' + 'Additional source content. '.repeat(100);
  const trace: Trace[] = [{step: 1, tool: 'read_public_page', agent: 'research', ok: true, args: {url: 'https://example.com/workshop'},
    result: {url: 'https://example.com/workshop', retrievedAt: '2026-10-29T12:00:00Z', text: page}}];
  const evidence = executionEvidence(trace, 'research'), receipt = JSON.parse(evidence[0]);
  expect(receipt.result.url).toBe('https://example.com/workshop');
  expect(receipt.result.retrievedAt).toBe('2026-10-29T12:00:00Z');
  expect(receipt.result.text.excerpt).toContain('opens at 10 am');
  expect(receipt.result.text.availableCharacters).toBe(page.length);
  expect(receipt.result.text.offset).toBe(0);
  expect(receipt.result.text.complete).toBe(false);
  expect(receipt.sourceContent).toContain('untrusted');
});

test('a typical website change keeps actual arguments and final inspected state below the complete packet bound', () => {
  const before = initialSite(), after = {...before, title: 'Oak Studio'};
  const trace: Trace[] = [
    {step: 1, tool: 'inspect_site', agent: 'website', ok: true, result: {project: {id: 'site-1', revision: 0, site: before}, assets: [], checks: {ok: true}}},
    {step: 2, tool: 'set_copy', agent: 'website', ok: true, args: {field: 'title', value: 'Oak Studio'}, result: {revision: 1, site: after, checks: {ok: true}}},
    {step: 3, tool: 'inspect_site', agent: 'website', ok: true, result: {project: {id: 'site-1', revision: 1, site: after}, assets: [], checks: {ok: true}}}
  ];
  const evidence = executionEvidence(trace, 'website');
  expect(JSON.stringify(evidence).length).toBeLessThan(2500);
  expect(evidence).toHaveLength(2);
  const write = JSON.parse(evidence[0]), inspection = JSON.parse(evidence[1]);
  expect(write.arguments).toEqual({field: 'title', value: 'Oak Studio'});
  expect(write.result.revision).toBe(1);
  expect(inspection.result.project.site.title).toBe('Oak Studio');
  expect(inspection.inspectionSelection.matchingResults).toBe(2);
  expect(inspection.result.project.revision).toBe(1);
});

test('media handoffs preserve downloaded IDs and actual public provenance', () => {
  const trace: Trace[] = [{step: 1, tool: 'download_video', agent: 'video_sources', ok: true, args: {url: 'https://example.com/source.mp4', name: 'Public clip'},
    result: {downloadedMedia: {id: 'media-public-1', source: 'https://example.com/source.mp4', duration: 4, video: true}}}];
  const receipt = JSON.parse(executionEvidence(trace, 'video_sources')[0]);
  expect(receipt.result.downloadedMedia.id).toBe('media-public-1');
  expect(receipt.result.downloadedMedia.source).toBe('https://example.com/source.mp4');
});

test('PDF receipts identify selected pages, available text and omitted geometry honestly', () => {
  const sourceText = 'Original PDF content. '.repeat(100);
  const trace: Trace[] = [{step: 1, tool: 'inspect_pdf', agent: 'pdf', ok: true, args: {pages: [2]}, result: {
    pageCount: 20, scanned: false, metadata: {title: 'Uploaded document'},
    pages: [{page: 2, width: 595, height: 842, rotation: 0, text: sourceText, spans: [{text: 'Original PDF content.', rect: [0, 0, 20, 30]}], forms: []}]
  }}];
  const receipt = JSON.parse(executionEvidence(trace, 'pdf')[0]);
  expect(receipt.result.projection).toContain('not a full-document read');
  expect(receipt.result.pages[0].page).toBe(2);
  expect(receipt.result.pages[0].text.availableCharacters).toBe(sourceText.length);
  expect(receipt.result.pages[0].availableSpans).toBe(1);
  expect(receipt.result.pages[0].omitted).toContain('span geometry and font details');
});

test('bounded numeric write arguments retain complete rectangle and page coordinates', () => {
  const trace: Trace[] = [{step: 1, tool: 'add_pdf_text', agent: 'pdf', ok: true,
    args: {page: 2, rect: [10, 20, 200, 300], text: 'Updated title', fontSize: 12, color: '#000000'},
    result: {revision: 4, result: {pageCount: 2}}}];
  const receipt = JSON.parse(executionEvidence(trace, 'pdf')[0]);
  expect(receipt.arguments.rect).toEqual([10, 20, 200, 300]);
  expect(receipt.arguments.page).toBe(2);
  expect(receipt.result.revision).toBe(4);
});

test('failed calls, coordinator summaries and internal mixed-context reads are never host source receipts', () => {
  const trace: Trace[] = [
    {step: 1, tool: 'delegate', agent: 'coordinator', ok: true, result: {message: 'UNSUPPORTED-MODEL-SUMMARY'}},
    {step: 2, tool: 'read_handoff', agent: 'research', ok: true, result: {message: 'UNSUPPORTED-MODEL-SUMMARY'}},
    {step: 3, tool: 'read_public_page', agent: 'research', ok: false, result: 'Network failed'}
  ];
  expect(executionEvidence(trace, 'research')).toEqual([]);
});

test('oversized complete receipts pause instead of silently omitting calls or shortening source identities', () => {
  const trace: Trace[] = Array.from({length: 12}, (_, step) => ({step, tool: 'read_public_page', agent: 'research', ok: true,
    result: {url: 'https://example.com/' + step, retrievedAt: '2026-10-29T12:00:00Z', text: 'Source ' + step + ': ' + 'facts '.repeat(80)}}));
  expect(() => executionEvidence(trace, 'research')).toThrow('complete 2,500-character');
  const longUrl = 'https://example.com/' + 'x'.repeat(2600);
  expect(() => executionEvidence([{step: 1, tool: 'read_public_page', agent: 'research', ok: true, result: {url: longUrl, text: 'actual text'}}], 'research')).toThrow('complete 2,500-character');
});
