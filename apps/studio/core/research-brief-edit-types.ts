import type {BriefDraft} from './research-brief-types';
export type DocumentEditRequest = {parentGoalId:string;requestKey:string;intent:string;sentenceLabels?:[string,string];documentId:string;baseRevision:number;basePdfSha256:string};
export type DocumentEditArtifact = {operationId:string;documentId:string;revision:number;pages:number;pdfSha256:string;htmlSha256:string;provenanceSha256:string};
export type DocumentEditState = {
  operationId:string;goalId:string;inputSha256:string;created:number;
  phase:'preparing'|'proposal_saved'|'awaiting_approval'|'approved'|'rendered'|'saved'|'rejected';
  before:BriefDraft;proposal?:BriefDraft;proposalSha256?:string;
  writingMode?:'sequential-labelled-sentences-v2';
  sentenceAttempts?:{first?:{raw:unknown;sha256:string;error?:string};second?:{raw:unknown;sha256:string;error?:string}};
  writingAttempt?:{raw:unknown;sha256:string;error?:string;origin?:'aggregate-of-two-native-sentence-decisions-v2';decisionHashes?:{first:string;second:string}};
  projection?:{version:'brief-labelled-sentences-v1'|'brief-labelled-sentences-v2';method:string;rawSha256:string;proposalSha256:string;sentenceSha256?:{first:string;second:string}};
  draftCheck?:{accepted:boolean;reason:string};supportReview?:{supported:boolean;reason:string};
  approvedProposalSha256?:string;artifact?:DocumentEditArtifact;
  preserved:{title:string;notes:string;citations:{number:number;quote:string;label:string;sourceId:string;offset:number;textSha256:string}[]};
  inspectBase:{pages:unknown[];sha256:string};
};
