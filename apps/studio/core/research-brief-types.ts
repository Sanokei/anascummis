export type BriefRequest = {parentGoalId: string; requestKey: string; title: string; notes: string};
export type BriefDraft = {paragraphs: {text: string; citations: number[]}[]};
export type BriefArtifact = {
  id: string; documentId: string; title: string; created: number; pages: number;
  inputSha256: string; draftSha256: string; pdfSha256: string; htmlSha256: string;
  presentationVersion?: 'brief-inline-v1'; presentationSha256?: string;
};
export type BriefState = {
  id: string; goalId: string; inputSha256: string; created: number;
  phase: 'preparing' | 'draft_saved' | 'reviewed' | 'rejected' | 'saved';
  draft?: BriefDraft; draftSha256?: string;
  writingAttempt?: {raw: unknown; sha256: string; error?: string};
  presentation?: {version: 'brief-inline-v1'; draft: BriefDraft; sha256: string; method: string};
  draftCheck?: {accepted: boolean; reason: string};
  supportReview?: {supported: boolean; reason: string}; artifact?: BriefArtifact;
};
