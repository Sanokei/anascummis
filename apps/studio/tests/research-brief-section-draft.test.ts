import {describe, expect, test} from 'bun:test';
import {
  beginBriefEditSubmission, readBriefEditApproval, readBriefEditDraft, sameBriefEditSubmission,
  sameBriefEditTarget, settleBriefEditSubmission, validBriefEditTarget,
  type BriefEditFormDraft, type BriefEditSubmission, type BriefEditTargetDraft
} from '../core/research-brief-edit-draft';

const key = '1b1dbf5f-a172-4c95-a9ee-0686511fb7bd';
const nextKey = '0251bd32-8134-4bce-8748-1d4dd81eb80e';
const intent = '  Make this clearer for a newcomer.\nKeep café & my planned actions.  ';
const draft = (): BriefEditFormDraft => ({version: 1, requestKey: key, intent});
const note = (paragraph = 1, paragraphSha256 = 'a'.repeat(64)): NonNullable<BriefEditSubmission['target']> =>
  ({section: 'notes', paragraph, paragraphSha256, format: 'clearer-plain-paragraph'});
const summary = (): NonNullable<BriefEditSubmission['target']> => ({section: 'summary', format: 'shorter-single-sentence'});

describe('explicit section choices and uncertain document-edit snapshots', () => {
  test('an ambiguous exact request and each incomplete choice reload without inventing a target or format', () => {
    const incomplete: (BriefEditTargetDraft | undefined)[] = [undefined, {}, {section: 'notes'},
      {section: 'notes', paragraph: 1, paragraphSha256: 'a'.repeat(64)}, {section: 'summary'}];
    for (const targetDraft of incomplete) {
      const original = {...draft(), ...(targetDraft ? {targetDraft} : {})};
      const restored = readBriefEditDraft(JSON.stringify(original));
      expect(restored).toEqual(original);
      expect(restored.intent).toBe(intent);
      expect(restored.target).toBeUndefined();
      expect(restored.submitted).toBeUndefined();
      expect(restored.targetDraft?.format).toBeUndefined();
      if (targetDraft?.section) expect(() => beginBriefEditSubmission(restored)).toThrow('Choose the intended section');
    }
  });

  test('complete selected paragraph and format are snapshotted separately from later unsent choices', () => {
    const selected: BriefEditFormDraft = {...draft(), target: note(), targetDraft: {...note()}};
    const pending = beginBriefEditSubmission(selected);
    expect(pending.submitted).toEqual({requestKey: key, intent, target: note()});
    expect(pending.submitted?.target).not.toBe(selected.target);
    const newer: BriefEditFormDraft = {...pending, intent: 'Newer unsent request, still not performed.', target: note(0, 'b'.repeat(64)),
      targetDraft: {section: 'notes', paragraph: 0, paragraphSha256: 'b'.repeat(64), format: 'clearer-plain-paragraph'}};
    const restored = readBriefEditDraft(JSON.stringify(newer));
    expect(restored).toEqual(newer);
    expect(restored.submitted).toEqual({requestKey: key, intent, target: note()});
    expect(restored.target).not.toBe(restored.submitted?.target);
    expect(() => beginBriefEditSubmission(restored)).toThrow('Inspect');
    expect(settleBriefEditSubmission(restored, restored.submitted!, () => nextKey)).toEqual({
      version: 1, requestKey: nextKey, intent: newer.intent, target: newer.target, targetDraft: newer.targetDraft
    });
  });

  test('a matching acknowledgement clears only the selected snapshot; changed target identity cannot confirm it', () => {
    const pending = beginBriefEditSubmission({...draft(), target: note(), targetDraft: {...note()}});
    expect(settleBriefEditSubmission(pending, pending.submitted!, () => nextKey)).toBeUndefined();
    for (const target of [note(0), note(1, 'b'.repeat(64)), summary()]) {
      expect(sameBriefEditSubmission(pending.submitted!, {...pending.submitted!, target})).toBe(false);
      expect(() => settleBriefEditSubmission(pending, {...pending.submitted!, target}, () => nextKey)).toThrow('does not match');
    }
    expect(() => settleBriefEditSubmission(pending, {...pending.submitted!, intent: intent.trim()}, () => nextKey)).toThrow('does not match');
  });

  test('legacy acknowledgement does not erase a newer incomplete clarification choice', () => {
    const legacy = beginBriefEditSubmission(draft());
    const newer: BriefEditFormDraft = {...legacy, targetDraft: {section: 'notes'}};
    expect(readBriefEditDraft(JSON.stringify(newer))).toEqual(newer);
    expect(settleBriefEditSubmission(newer, legacy.submitted!, () => nextKey)).toEqual({
      version: 1, requestKey: nextKey, intent, targetDraft: {section: 'notes'}
    });
    const changed: BriefEditFormDraft = {...beginBriefEditSubmission({...draft(), target: note()}), target: undefined,
      targetDraft: {section: 'summary'}};
    expect(settleBriefEditSubmission(changed, changed.submitted!, () => nextKey)).toEqual({
      version: 1, requestKey: nextKey, intent, targetDraft: {section: 'summary'}
    });
  });

  test('target identity is structural but every section, paragraph, hash and format remains significant', () => {
    const reordered = {format: 'clearer-plain-paragraph' as const, paragraphSha256: 'a'.repeat(64), paragraph: 1, section: 'notes' as const};
    expect(validBriefEditTarget(reordered)).toBe(true);
    expect(sameBriefEditTarget(note(), reordered)).toBe(true);
    expect(sameBriefEditSubmission({...draft(), target: note()}, {...draft(), target: reordered})).toBe(true);
    expect(sameBriefEditTarget(undefined, undefined)).toBe(true);
    for (const target of [undefined, note(0), note(1, 'c'.repeat(64)), summary()]) expect(sameBriefEditTarget(note(), target)).toBe(false);
    expect(sameBriefEditTarget(summary(), summary())).toBe(true);
    expect(sameBriefEditSubmission({...draft(), target: note()}, {...draft(), requestKey: nextKey, target: note()})).toBe(false);
  });

  test('malformed selected or partial target data remains unreadable instead of being truncated or retargeted', () => {
    const malformed: unknown[] = [null, [], 'notes', {section: 'other', format: 'clearer-plain-paragraph'},
      {section: 'notes', format: 'clearer-plain-paragraph'}, {...note(), paragraph: -1}, {...note(), paragraph: .5},
      {...note(), paragraph: 100}, {...note(), paragraph: 200}, {...note(), paragraph: '1'}, {...note(), paragraphSha256: 'a'.repeat(63)},
      {...note(), paragraphSha256: 'A'.repeat(64)}, {...note(), format: 'shorter-single-sentence'},
      {...note(), unexpected: 'must not be dropped'}, {...summary(), paragraph: 1}, {...summary(), format: 'clearer-plain-paragraph'}];
    for (const target of malformed) {
      expect(validBriefEditTarget(target)).toBe(false);
      expect(() => readBriefEditDraft(JSON.stringify({...draft(), target}))).toThrow('could not be read');
      expect(() => readBriefEditDraft(JSON.stringify({...draft(), submitted: {requestKey: key, intent, target}}))).toThrow('could not be read');
    }
    for (const targetDraft of [[], {section: 'other'}, {paragraph: -1}, {paragraph: 100}, {paragraph: 200}, {paragraphSha256: 'short'},
      {format: 'invent-completed-work'}, {section: 'notes', hidden: 'must not be dropped'}]) {
      expect(() => readBriefEditDraft(JSON.stringify({...draft(), targetDraft}))).toThrow('could not be read');
    }
  });

  test('conflicting submitted formats cannot become a retry while old no-target drafts and approvals remain readable', () => {
    const labels: [string, string] = ['Tests:', 'Browser results:'];
    const old = beginBriefEditSubmission({...draft(), sentenceLabels: labels});
    expect(readBriefEditDraft(JSON.stringify(old))).toEqual(old);
    expect(old.submitted).toEqual({requestKey: key, intent, sentenceLabels: labels});
    expect(readBriefEditDraft(JSON.stringify(draft()))).toEqual(draft());
    const approval = {operationId: key, proposalSha256: 'd'.repeat(64)};
    expect(readBriefEditApproval(JSON.stringify(approval))).toEqual(approval);
    expect(() => beginBriefEditSubmission({...draft(), sentenceLabels: labels, target: note()})).toThrow('labels aside');
    expect(() => readBriefEditDraft(JSON.stringify({...draft(), submitted: {requestKey: key, intent, sentenceLabels: labels, target: note()}}))).toThrow('could not be read');
    const keptLabels = beginBriefEditSubmission({...draft(), target: note(), labelDraft: labels});
    expect(keptLabels.submitted).toEqual({requestKey: key, intent, target: note()});
    expect(settleBriefEditSubmission(keptLabels, keptLabels.submitted!, () => nextKey)).toEqual({
      version: 1, requestKey: nextKey, intent, target: note(), labelDraft: labels
    });
  });
});
