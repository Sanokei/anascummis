import {describe, expect, test} from 'bun:test';
import {beginBriefSubmission, readBriefDraft, settleBriefSubmission, type BriefFormDraft} from '../core/research-brief-draft';

const key = 'a455cbb1-00c5-4c84-bf4d-c16eca8b570c', newer = '52e0ad7f-bb8a-4aba-b9c4-1248185c1218';
const original = (): BriefFormDraft => ({version: 1, requestKey: key, title: 'Fetch contributor notes', notes: 'Keep my literal note: <a> & café.\nNo source claim.'});

describe('local brief draft and uncertain delivery', () => {
  test('retains exact title, notes and sent identity across a reload', () => {
    const pending = beginBriefSubmission(original());
    expect(readBriefDraft(JSON.stringify(pending))).toEqual(pending);
    expect(pending.submitted?.notes).toBe(original().notes);
  });
  test('acknowledgement clears only its unchanged submitted snapshot', () => {
    const pending = beginBriefSubmission(original());
    expect(settleBriefSubmission(pending, pending.submitted!, () => newer)).toBeUndefined();
  });
  test('newer edits survive a late acknowledgement with a fresh unsent identity', () => {
    const pending = beginBriefSubmission(original()), edited = {...pending, title: 'New heading', notes: 'Newer unsent notes'};
    expect(settleBriefSubmission(edited, pending.submitted!, () => newer)).toEqual({version: 1, requestKey: newer, title: 'New heading', notes: 'Newer unsent notes'});
  });
  test('an acknowledgement for another payload cannot discard the pending draft', () => {
    const pending = beginBriefSubmission(original());
    expect(() => settleBriefSubmission(pending, {...pending.submitted!, notes: 'Different note'}, () => newer)).toThrow('does not match');
    expect(pending.submitted?.notes).toBe(original().notes);
  });
  test('uncertain submission cannot become another save before inspection', () => {
    const pending = beginBriefSubmission(original());
    expect(() => beginBriefSubmission(pending)).toThrow('Inspect');
    expect(readBriefDraft(JSON.stringify({...pending, notes: 'New text'})).submitted).toEqual(pending.submitted);
  });
  test('invalid or over-limit storage is rejected without truncation', () => {
    for (const draft of [{...original(), requestKey: 'bad'}, {...original(), notes: 'a'.repeat(2001)}, {...original(), title: 'a'.repeat(121)}, {...original(), submitted: {requestKey: key, title: 'x', notes: 3}}]) expect(() => readBriefDraft(JSON.stringify(draft))).toThrow('could not be read');
    expect(() => beginBriefSubmission({...original(), title: '  '})).toThrow('title');
  });
});
