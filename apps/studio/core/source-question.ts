import {runAnalysis} from './analysis-harness';
import {PublicSourceLedger, type SourceProgress, publicSourceUrl} from './public-source';
import type {Infer} from './model';
import type {GoalExecution, GoalRecord, GoalTask, GoalReview} from './goal-orchestrator';
import {objectSchema,validate} from './harness';

function sourceTask(task: GoalTask, goal: GoalRecord) {
  if (!goal.sourceQuestion || !goal.research || goal.documentId) throw new Error('This question has no public-source permission.');
  const index = goal.sourceQuestion.urls.indexOf(task.sourceUrl || '');
  if (task.specialist !== 'research' || index < 0 || task.id !== 'source-' + (index + 1)) throw new Error('Invalid host source-reading milestone.');
  return publicSourceUrl(task.sourceUrl);
}

export async function executeSourceQuestion(ledger: PublicSourceLedger, task: GoalTask, goal: GoalRecord, signal: AbortSignal, infer: Infer, progress: SourceProgress): Promise<GoalExecution> {
  signal.throwIfAborted();
  if (task.sourceUrl) {
    const url = sourceTask(task, goal);
    const source = await ledger.capture(goal.id, task.id, url, signal, progress);
    signal.throwIfAborted();
    return {message: 'Public response and full extracted text saved. Acquisition identity only; no answer or factual verification.', verified: true, sourceId: source.id,
      evidence: ['Saved source ' + source.id + ': ' + source.url, 'Retrieved ' + source.retrievedAt + '; ' + source.bytes + ' bytes; SHA-256 ' + source.sha256,
        'Text SHA-256 ' + source.textSha256 + '; ' + source.textLength + ' text positions; ' + source.normalization]};
  }
  if (!goal.sourceQuestion || !goal.research || goal.documentId || !task.sourceAnswer || task.id !== 'source-answer' || task.specialist !== 'analysis') throw new Error('Invalid host source-answer milestone.');
  const selected = goal.sourceQuestion.urls.map((url, index) => {
    const predecessor = goal.tasks.find(item => item.id === 'source-' + (index + 1));
    if (!predecessor || sourceTask(predecessor, goal) !== url || predecessor.status !== 'verified' || !predecessor.review?.accepted || !predecessor.execution?.verified || !predecessor.execution.sourceId) throw new Error('A source acquisition has not passed its host identity check.');
    const saved = ledger.get(goal.id, predecessor.execution.sourceId);
    if (saved.source.taskId !== predecessor.id || saved.source.requestedUrl !== url) throw new Error('Source ownership does not match the reading milestone.');
    return {...saved, label: predecessor.id};
  });
  const question = goal.request + (goal.guidance ? '\nContinuation guidance: ' + goal.guidance : '');
  const {plan,reused}=ledger.prepareReading(goal.id,task.id,question,goal.sourceQuestion.ranges);
  for(const range of plan.ranges)if(!selected.some(saved=>saved.source.id===range.sourceId))throw new Error('The reading references a source outside this question’s verified acquisitions.');
  progress(reused?'selection_reused':'selection_saved',(reused?'Reusing':'Saved')+' '+plan.mode+' reading '+plan.id+': '+plan.ranges.map(range=>range.label+' '+range.start+'–'+range.end+' ('+range.score+' term matches)').join('; ')+'. Exact question and text ranges are hashed before inference.');
  if(plan.match==='none')return {message:'The local passage selector found no question-term matches in the saved sources. The full sources and reading plan are kept. Refine the question or ask another question using the saved source copies; no answer was guessed.',verified:false,evidence:['Saved reading '+plan.id+'; exact question SHA-256 '+plan.questionSha256]};
  progress('answering_sources','Answering the exact saved question using '+plan.ranges.reduce((sum,range)=>sum+range.text.length,0)+' selected text positions across '+new Set(plan.ranges.map(range=>range.sourceId)).size+' saved sources. Other text remains outside this model decision.');
  let answerable=false,answerabilityReason='';
  const bounded:Infer=async(system,user,schema,modelSignal)=>{
    const properties=schema.properties as Record<string,any>,citation=properties.citations;
    const extended=objectSchema({...properties,response:{...properties.response,maxLength:600},uncertainty:{...properties.uncertainty,maxLength:160},citations:{...citation,maxItems:2,items:objectSchema({...citation.items.properties,quote:{type:'string',maxLength:120}})},answerable:{type:'boolean'},answerabilityReason:{type:'string',maxLength:160}});
    const raw=await infer(system+' Also return answerable and answerabilityReason. answerable is true only if these exact passages explicitly support EVERY requested fact. If any requested location, value or detail is missing, say false and identify that part; acknowledging missing information is not task completion. Do not invent a location or tell the user to look elsewhere instead of answering.',user,extended,modelSignal) as any;
    validate(extended,raw);if(!raw.answerabilityReason.trim())throw new Error('The source answer did not explain whether every requested fact was supported.');
    answerable=raw.answerable;answerabilityReason=raw.answerabilityReason;
    const {answerable:_answerable,answerabilityReason:_reason,...analysis}=raw;return analysis;
  };
  const result = await runAnalysis(question, {evidence: plan.ranges.map(range => ({id: range.label, text: range.text}))}, signal, bounded);
  signal.throwIfAborted();
  const citations = result.answer.citations.map(citation => {
    const range=plan.ranges.find(range=>range.label===citation.id)!;
    const offset = range.text.indexOf(citation.quote);
    if (offset < 0) throw new Error('The answer citation is outside the selected saved-source excerpt.');
    return {sourceId: range.sourceId, label: range.label, quote: citation.quote, offset:range.start+offset, textSha256: range.textSha256};
  });
  return {message:answerable?result.message:'The selected passages do not fully answer the saved question. '+answerabilityReason+'\n\n'+result.message, verified:result.verified&&answerable, evidence:[...result.evidence,'Saved reading '+plan.id+'; question SHA-256 '+plan.questionSha256],
    sourceAnswer: {...result.answer,readingId:plan.id,answerable,answerabilityReason,citations, selections:plan.ranges.map(range=>({sourceId:range.sourceId,label:range.label,start:range.start,end:range.end,textSha256:range.textSha256,rangeSha256:range.rangeSha256,text:range.text}))}};
}

/** Acceptance is deliberately narrower than semantic answer review. No inference is
 * needed to check that actual persisted bytes/text match the acquisition receipt. */
export async function reviewSourceAcquisition(ledger: PublicSourceLedger, task: GoalTask, goal: GoalRecord, execution: GoalExecution, signal: AbortSignal): Promise<GoalReview> {
  signal.throwIfAborted();
  const url = sourceTask(task, goal);
  if (!execution.verified || !execution.sourceId) throw new Error('No persisted acquisition receipt to review.');
  const {source} = ledger.get(goal.id, execution.sourceId);
  if (source.taskId !== task.id || source.requestedUrl !== url) throw new Error('Source receipt belongs to a different reading step.');
  return {accepted: true, reason: 'Host re-read the persisted response and text: ownership, lengths and both SHA-256 hashes match. This accepts acquisition only, not source claims or answer quality.'};
}
