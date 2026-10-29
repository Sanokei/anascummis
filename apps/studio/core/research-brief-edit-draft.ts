export type BriefEditSubmission = {requestKey: string; intent: string};
export type BriefEditFormDraft = BriefEditSubmission & {version: 1; submitted?: BriefEditSubmission};
export type BriefEditApproval = {operationId: string; proposalSha256: string};
const keyPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;

function validSubmission(value: unknown): value is BriefEditSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as BriefEditSubmission;
  return typeof item.requestKey === 'string' && keyPattern.test(item.requestKey)
    && typeof item.intent === 'string' && item.intent.length <= 500;
}

export function readBriefEditDraft(raw: string): BriefEditFormDraft {
  const value: unknown = JSON.parse(raw);
  if (!validSubmission(value) || (value as BriefEditFormDraft).version !== 1
    || ((value as BriefEditFormDraft).submitted !== undefined && !validSubmission((value as BriefEditFormDraft).submitted))) {
    throw new Error('The saved edit draft could not be read. Its stored copy has not been changed.');
  }
  const draft = value as BriefEditFormDraft;
  return {version: 1, requestKey: draft.requestKey, intent: draft.intent,
    ...(draft.submitted ? {submitted: {...draft.submitted}} : {})};
}

export function sameBriefEditSubmission(left: BriefEditSubmission, right: BriefEditSubmission) {
  return left.requestKey === right.requestKey && left.intent === right.intent;
}

export function beginBriefEditSubmission(draft: BriefEditFormDraft): BriefEditFormDraft {
  if (draft.submitted) throw new Error('Inspect the earlier edit submission before sending another one.');
  if (!draft.intent.trim() || draft.intent.length > 500) throw new Error('Describe the requested paragraph change in 1–500 characters.');
  return {...draft, submitted: {requestKey: draft.requestKey, intent: draft.intent}};
}

/** Confirm only the submitted snapshot. An edit made while saving remains unsent. */
export function settleBriefEditSubmission(draft: BriefEditFormDraft, submitted: BriefEditSubmission, newKey: () => string): BriefEditFormDraft | undefined {
  if (!draft.submitted || !sameBriefEditSubmission(draft.submitted, submitted)) throw new Error('This response does not match the pending edit submission.');
  if (draft.intent === submitted.intent) return undefined;
  return {version: 1, requestKey: newKey(), intent: draft.intent};
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
