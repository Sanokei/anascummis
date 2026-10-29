import {describe, expect, test} from 'bun:test';
import {beginBriefEditSubmission, readBriefEditApproval, readBriefEditDraft, settleBriefEditSubmission, type BriefEditFormDraft} from '../core/research-brief-edit-draft';

const key = 'a455cbb1-00c5-4c84-bf4d-c16eca8b570c', newer = '52e0ad7f-bb8a-4aba-b9c4-1248185c1218';
const original = (): BriefEditFormDraft => ({version: 1, requestKey: key, intent: 'Use two sentences: Tests: and Browser results:. Keep café & exact links.'});

describe('document edit browser drafts and uncertain approvals', () => {
  test('reload keeps the exact submitted intent separately from newer edits', () => {
    const pending = beginBriefEditSubmission(original()), newerDraft = {...pending, intent: 'Newer unsent change'};
    expect(readBriefEditDraft(JSON.stringify(newerDraft))).toEqual(newerDraft);
    expect(newerDraft.submitted).toEqual({requestKey: key, intent: original().intent});
    expect(() => beginBriefEditSubmission(newerDraft)).toThrow('Inspect');
  });
  test('acknowledging the submitted intent clears only that snapshot', () => {
    const pending = beginBriefEditSubmission(original());
    expect(settleBriefEditSubmission(pending, pending.submitted!, () => newer)).toBeUndefined();
    expect(settleBriefEditSubmission({...pending, intent: 'Newer unsent change'}, pending.submitted!, () => newer)).toEqual({version: 1, requestKey: newer, intent: 'Newer unsent change'});
    expect(() => settleBriefEditSubmission(pending, {...pending.submitted!, intent: 'Other'}, () => newer)).toThrow('does not match');
  });
  test('invalid or oversized storage cannot silently truncate a request', () => {
    for (const value of [{...original(), intent: 'a'.repeat(501)}, {...original(), requestKey: 'bad'}, {...original(), submitted: {requestKey: key, intent: 4}}, {...original(), version: 2}]) expect(() => readBriefEditDraft(JSON.stringify(value))).toThrow('could not be read');
    expect(() => beginBriefEditSubmission({...original(), intent: '   '})).toThrow('1–500');
  });
  test('an unconfirmed approval retains its exact operation and proposal hash', () => {
    const approval = {operationId: key, proposalSha256: 'a'.repeat(64)};
    expect(readBriefEditApproval(JSON.stringify(approval))).toEqual(approval);
    for (const value of [{...approval, operationId: 'other'}, {...approval, proposalSha256: 'a'.repeat(63)}, null, []]) expect(() => readBriefEditApproval(JSON.stringify(value))).toThrow('Inspect');
  });
  test('optional sentence format keeps incomplete labels and an exact submitted snapshot', () => {
    expect(readBriefEditDraft(JSON.stringify(original()))).toEqual(original()); // Earlier v1 drafts remain free prose.
    const partial: BriefEditFormDraft = {...original(), sentenceLabels: ['Tests:', '']};
    expect(readBriefEditDraft(JSON.stringify(partial))).toEqual(partial);
    expect(() => beginBriefEditSubmission(partial)).toThrow('different nonempty');
    expect(() => beginBriefEditSubmission({...partial, sentenceLabels: ['Tests:', 'Tests:']})).toThrow('different nonempty');
    const spaced: BriefEditFormDraft = {...partial, sentenceLabels: [' Tests:', 'Browser results:']};
    expect(readBriefEditDraft(JSON.stringify(spaced))).toEqual(spaced);
    expect(() => beginBriefEditSubmission(spaced)).toThrow('leading or trailing spaces');
    const labelled: BriefEditFormDraft = {...original(), sentenceLabels: ['Tests:', 'Browser results:']}, pending = beginBriefEditSubmission(labelled);
    expect(pending.submitted?.sentenceLabels).toEqual(['Tests:', 'Browser results:']);
    expect(readBriefEditDraft(JSON.stringify(pending))).toEqual(pending);
    expect(settleBriefEditSubmission(pending, pending.submitted!, () => newer)).toBeUndefined();
    expect(settleBriefEditSubmission({...pending, sentenceLabels: ['Checks:', 'Browser results:']}, pending.submitted!, () => newer)).toEqual({...labelled, requestKey: newer, sentenceLabels: ['Checks:', 'Browser results:']});
    expect(() => settleBriefEditSubmission(pending, {...pending.submitted!, sentenceLabels: ['Other:', 'Results:']}, () => newer)).toThrow('does not match');
  });
  test('unchecked unsent labels survive acknowledgement and invalid labels are not silently shortened', () => {
    const cached: BriefEditFormDraft = {...original(), labelDraft: ['Tests:', 'Browser results:']}, pending = beginBriefEditSubmission(cached);
    expect(pending.submitted).toEqual({requestKey: key, intent: cached.intent});
    expect(readBriefEditDraft(JSON.stringify(cached))).toEqual(cached);
    expect(settleBriefEditSubmission(pending, pending.submitted!, () => newer)).toEqual({...cached, requestKey: newer});
    for (const value of [{...original(), sentenceLabels: ['a'.repeat(33), 'Results:']}, {...original(), sentenceLabels: ['Only one']}, {...original(), labelDraft: ['Tests:', 3]}, {...original(), submitted: {...original(), sentenceLabels: ['', '']}}]) expect(() => readBriefEditDraft(JSON.stringify(value))).toThrow('could not be read');
  });
});
