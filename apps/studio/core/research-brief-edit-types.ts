import type {BriefDraft} from './research-brief-types';
export type DocumentEditRequest = {parentGoalId:string;requestKey:string;intent:string;documentId:string;baseRevision:number;basePdfSha256:string};
export type DocumentEditArtifact = {operationId:string;documentId:string;revision:number;pages:number;pdfSha256:string;htmlSha256:string;provenanceSha256:string};
export type DocumentEditState = {
  operationId:string;goalId:string;inputSha256:string;created:number;
  phase:'preparing'|'proposal_saved'|'awaiting_approval'|'approved'|'rendered'|'saved'|'rejected';
  before:BriefDraft;proposal?:BriefDraft;proposalSha256?:string;
  writingAttempt?:{raw:unknown;sha256:string;error?:string};
  draftCheck?:{accepted:boolean;reason:string};supportReview?:{supported:boolean;reason:string};
  approvedProposalSha256?:string;artifact?:DocumentEditArtifact;
  preserved:{title:string;notes:string;citations:{number:number;quote:string;label:string;sourceId:string;offset:number;textSha256:string}[]};
  inspectBase:{pages:unknown[];sha256:string};
};
