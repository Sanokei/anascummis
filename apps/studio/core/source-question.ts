import {runAnalysis} from './analysis-harness';
import {PublicSourceLedger, type SourceProgress, publicSourceUrl} from './public-source';
import type {Infer} from './model';
import type {GoalExecution, GoalRecord, GoalTask, GoalReview} from './goal-orchestrator';

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
    return {...saved, label: predecessor.id, excerpt: saved.text.slice(0, 800)};
  });
  progress('answering_sources', 'Answering the exact question from the first 800 text positions of each saved source. The full saved text remains inspectable. Requires local inference.');
  const question = goal.request + (goal.guidance ? '\nContinuation guidance: ' + goal.guidance : '');
  const result = await runAnalysis(question, {evidence: selected.map(item => ({id: item.label, text: item.excerpt}))}, signal, infer);
  signal.throwIfAborted();
  const citations = result.answer.citations.map(citation => {
    const saved = selected.find(item => item.label === citation.id)!;
    const offset = saved.excerpt.indexOf(citation.quote);
    if (offset < 0) throw new Error('The answer citation is outside the selected saved-source excerpt.');
    return {sourceId: saved.source.id, label: saved.label, quote: citation.quote, offset, textSha256: saved.source.textSha256};
  });
  return {message: result.message, verified: result.verified, evidence: result.evidence,
    sourceAnswer: {...result.answer, citations, selections: selected.map(item => ({sourceId: item.source.id, label: item.label, start: 0, end: item.excerpt.length, textSha256: item.source.textSha256}))}};
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
