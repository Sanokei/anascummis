export type BriefSubmission = {requestKey: string; title: string; notes: string};
export type BriefFormDraft = BriefSubmission & {version: 1; submitted?: BriefSubmission};
const keyPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function validSubmission(value: unknown): value is BriefSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as BriefSubmission;
  return typeof item.requestKey === 'string' && keyPattern.test(item.requestKey)
    && typeof item.title === 'string' && item.title.length <= 120
    && typeof item.notes === 'string' && item.notes.length <= 2000;
}

export function readBriefDraft(raw: string): BriefFormDraft {
  const value: unknown = JSON.parse(raw);
  if (!validSubmission(value) || (value as BriefFormDraft).version !== 1
    || ((value as BriefFormDraft).submitted !== undefined && !validSubmission((value as BriefFormDraft).submitted))) {
    throw new Error('The saved brief draft could not be read. Its stored copy has not been changed.');
  }
  const draft = value as BriefFormDraft;
  return {version: 1, requestKey: draft.requestKey, title: draft.title, notes: draft.notes,
    ...(draft.submitted ? {submitted: {...draft.submitted}} : {})};
}

export function sameBriefSubmission(left: BriefSubmission, right: BriefSubmission) {
  return left.requestKey === right.requestKey && left.title === right.title && left.notes === right.notes;
}

export function beginBriefSubmission(draft: BriefFormDraft): BriefFormDraft {
  if (draft.submitted) throw new Error('Inspect the earlier submission before sending another brief.');
  if (!draft.title.trim()) throw new Error('Give the brief a title.');
  return {...draft, submitted: {requestKey: draft.requestKey, title: draft.title, notes: draft.notes}};
}

/** A late response acknowledges only the snapshot actually sent, never newer edits. */
export function settleBriefSubmission(draft: BriefFormDraft, submitted: BriefSubmission, newKey: () => string): BriefFormDraft | undefined {
  if (!draft.submitted || !sameBriefSubmission(draft.submitted, submitted)) throw new Error('This response does not match the pending brief submission.');
  if (draft.title === submitted.title && draft.notes === submitted.notes) return undefined;
  return {version: 1, requestKey: newKey(), title: draft.title, notes: draft.notes};
}
