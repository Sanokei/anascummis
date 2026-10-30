import type {DocumentEditTarget} from './research-brief-edit-types';
import {validateDocumentEditTarget} from './research-brief-target';

export type BriefEditSubmission = {requestKey: string; intent: string; sentenceLabels?: [string, string]; target?: DocumentEditTarget};
/** Partial choices remain separate from the submitted, fully clarified target. */
export type BriefEditTargetDraft = {section?: 'summary' | 'notes'; paragraph?: number; paragraphSha256?: string; format?: 'shorter-single-sentence' | 'clearer-plain-paragraph'};
export type BriefEditFormDraft = BriefEditSubmission & {version: 1; labelDraft?: [string, string]; targetDraft?: BriefEditTargetDraft; submitted?: BriefEditSubmission};
export type BriefEditApproval = {operationId: string; proposalSha256: string};
const keyPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;

function ordinary(value: unknown): value is Record<string, unknown> {return !!value && typeof value === 'object' && !Array.isArray(value);}
export function validBriefEditTarget(value: unknown): value is DocumentEditTarget {
  try {return !!validateDocumentEditTarget(value);} catch {return false;}
}
function validTargetDraft(value: unknown): value is BriefEditTargetDraft {
  return ordinary(value) && Object.keys(value).every(key => ['section', 'paragraph', 'paragraphSha256', 'format'].includes(key))
    && (value.section === undefined || value.section === 'summary' || value.section === 'notes')
    && (value.paragraph === undefined || (Number.isInteger(value.paragraph) && Number(value.paragraph) >= 0 && Number(value.paragraph) < 100))
    && (value.paragraphSha256 === undefined || (typeof value.paragraphSha256 === 'string' && hashPattern.test(value.paragraphSha256)))
    && (value.format === undefined || value.format === 'shorter-single-sentence' || value.format === 'clearer-plain-paragraph');
}
export function sameBriefEditTarget(left: DocumentEditTarget | undefined, right: DocumentEditTarget | undefined) {
  if (!left || !right) return left === right;
  return left.section === right.section && left.format === right.format
    && (left.section !== 'notes' || (right.section === 'notes' && left.paragraph === right.paragraph && left.paragraphSha256 === right.paragraphSha256));
}

function validLabels(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every(label => typeof label === 'string' && label.length <= 32 && !/[\u0000-\u001f\u007f]/u.test(label));
}

export function validBriefEditLabels(labels: [string, string]) {
  return validLabels(labels) && labels.every(label => label.trim() && label === label.trim()) && labels[0] !== labels[1];
}

function validSubmission(value: unknown, submitted = false): value is BriefEditSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as BriefEditSubmission;
  return typeof item.requestKey === 'string' && keyPattern.test(item.requestKey)
    && typeof item.intent === 'string' && item.intent.length <= 500
    && (item.sentenceLabels === undefined || (validLabels(item.sentenceLabels) && (!submitted || validBriefEditLabels(item.sentenceLabels))))
    && (item.target === undefined || validBriefEditTarget(item.target))
    && (!submitted || !item.target || !item.sentenceLabels);
}

export function readBriefEditDraft(raw: string): BriefEditFormDraft {
  const value: unknown = JSON.parse(raw);
  if (!validSubmission(value) || (value as BriefEditFormDraft).version !== 1
    || ((value as BriefEditFormDraft).labelDraft !== undefined && !validLabels((value as BriefEditFormDraft).labelDraft))
    || ((value as BriefEditFormDraft).targetDraft !== undefined && !validTargetDraft((value as BriefEditFormDraft).targetDraft))
    || ((value as BriefEditFormDraft).submitted !== undefined && !validSubmission((value as BriefEditFormDraft).submitted, true))) {
    throw new Error('The saved edit draft could not be read. Its stored copy has not been changed.');
  }
  const draft = value as BriefEditFormDraft;
  return {version: 1, requestKey: draft.requestKey, intent: draft.intent,
    ...(draft.sentenceLabels ? {sentenceLabels: [...draft.sentenceLabels]} : {}),
    ...(draft.labelDraft ? {labelDraft: [...draft.labelDraft]} : {}),
    ...(draft.target ? {target: {...draft.target}} : {}), ...(draft.targetDraft ? {targetDraft: {...draft.targetDraft}} : {}),
    ...(draft.submitted ? {submitted: {...draft.submitted, ...(draft.submitted.sentenceLabels ? {sentenceLabels: [...draft.submitted.sentenceLabels]} : {}), ...(draft.submitted.target ? {target: {...draft.submitted.target}} : {})}} : {})};
}

export function sameBriefEditSubmission(left: BriefEditSubmission, right: BriefEditSubmission) {
  return left.requestKey === right.requestKey && left.intent === right.intent
    && JSON.stringify(left.sentenceLabels) === JSON.stringify(right.sentenceLabels) && sameBriefEditTarget(left.target, right.target);
}

export function beginBriefEditSubmission(draft: BriefEditFormDraft): BriefEditFormDraft {
  if (draft.submitted) throw new Error('Inspect the earlier edit submission before sending another one.');
  if (!draft.intent.trim() || draft.intent.length > 500) throw new Error('Describe the requested paragraph change in 1–500 characters.');
  if (draft.sentenceLabels && !validBriefEditLabels(draft.sentenceLabels)) throw new Error('Enter two different nonempty sentence labels, at most 32 characters each, without leading or trailing spaces.');
  if (draft.target && !validBriefEditTarget(draft.target)) throw new Error('Choose the intended section, exact paragraph and supported format before submitting.');
  if (draft.targetDraft && Object.values(draft.targetDraft).some(value => value !== undefined)
    && (!validBriefEditTarget(draft.targetDraft) || !sameBriefEditTarget(draft.targetDraft, draft.target))) {
    throw new Error('Choose the intended section, exact paragraph and supported format before submitting. Incomplete or newer choices have not been replaced.');
  }
  if (draft.target && draft.sentenceLabels) throw new Error('Keep the saved sentence labels aside before submitting a separately selected section and format.');
  return {...draft, submitted: {requestKey: draft.requestKey, intent: draft.intent, ...(draft.sentenceLabels ? {sentenceLabels: [...draft.sentenceLabels]} : {}), ...(draft.target ? {target: {...draft.target}} : {})}};
}

/** Confirm only the submitted snapshot. An edit made while saving remains unsent. */
export function settleBriefEditSubmission(draft: BriefEditFormDraft, submitted: BriefEditSubmission, newKey: () => string): BriefEditFormDraft | undefined {
  if (!draft.submitted || !sameBriefEditSubmission(draft.submitted, submitted)) throw new Error('This response does not match the pending edit submission.');
  const choicesMatch = !draft.targetDraft || Object.values(draft.targetDraft).every(value => value === undefined)
    || (validBriefEditTarget(draft.targetDraft) && sameBriefEditTarget(draft.targetDraft, submitted.target));
  if (sameBriefEditSubmission(draft, submitted) && choicesMatch && !draft.labelDraft?.some(label => label.length)) return undefined;
  return {version: 1, requestKey: newKey(), intent: draft.intent,
    ...(draft.sentenceLabels ? {sentenceLabels: [...draft.sentenceLabels]} : {}), ...(draft.labelDraft ? {labelDraft: [...draft.labelDraft]} : {}),
    ...(draft.target ? {target: {...draft.target}} : {}), ...(draft.targetDraft ? {targetDraft: {...draft.targetDraft}} : {})};
}

export function readBriefEditApproval(raw: string): BriefEditApproval {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as BriefEditApproval).operationId !== 'string' || typeof (value as BriefEditApproval).proposalSha256 !== 'string'
    || !keyPattern.test((value as BriefEditApproval).operationId)
    || !hashPattern.test((value as BriefEditApproval).proposalSha256)) {
    throw new Error('The pending edit approval could not be read. Inspect this saved edit before applying anything.');
  }
  return {operationId: (value as BriefEditApproval).operationId, proposalSha256: (value as BriefEditApproval).proposalSha256};
}

export function sameBriefEditApproval(left: BriefEditApproval, right: BriefEditApproval) {
  return left.operationId === right.operationId && left.proposalSha256 === right.proposalSha256;
}
