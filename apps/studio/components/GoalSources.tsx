'use client';
import {useEffect, useRef, useState} from 'react';
import type {GoalRecord, SourceAnswer} from '../core/goal-orchestrator';
import type {SourceReadingPlan, SourceReadingResult, SourceReadingSummary, SourceSnapshot} from '../core/public-source';

type Selection = {sourceId: string; label: string; start: number; end: number; textSha256: string; rangeSha256?: string; text?: string; matchedTerms?: string[]; score?: number};
type SavedText = {offset: number; end: number; text: string; selected?: boolean; readingId?: string; rangeVerified?: boolean};
type ReadingDetail = SourceReadingPlan & {result?: SourceReadingResult; resultCount: number};

function AnswerSupportChecks({answer}: {answer: SourceAnswer}) {
  const draft = answer.draftAssessment, review = answer.supportReview;
  const rejected = answer.answerable === false || review?.supported === false || !!answer.supportError;
  if (!draft && !review && !answer.supportError && !rejected) return null;
  return <details className="goal-answer-checks">
    <summary>Answer support checks</summary>
    <p>The draft self-assessment is separate from the later model review of the final answer and only its chosen literal citation spans. This review does not independently verify source claims.</p>
    {draft ? <>
      <p>Draft self-assessment: {draft.answerable ? 'marked answerable' : 'marked not answerable'}.</p>
      <p>Recorded draft reason: {draft.reason}</p>
      <p>Recorded draft uncertainty: {draft.uncertainty || '(empty)'}</p>
      <details><summary>Original model draft</summary><p>{draft.text}</p></details>
    </> : <p>No separate draft self-assessment was recorded for this older answer.</p>}
    {review ? <><p>Citation support review: {review.supported ? 'supported' : 'not supported'}.</p><p>Recorded support-review reason: {review.reason}</p></> : <p>No citation support decision was recorded.</p>}
    {answer.supportError && <p>Support review did not complete: {answer.supportError}</p>}
    {draft && review && draft.answerable !== review.supported && <p>The two model checks disagree.</p>}
    {!draft && rejected && <details><summary>Original model draft</summary><p>{answer.text}</p><p>{answer.answerabilityReason}</p><p>{answer.uncertainty}</p></details>}
    {answer.answerabilityReason && <p>Recorded final assessment: {answer.answerabilityReason}</p>}
  </details>;
}

function SourceAnswerContent({answer}: {answer: SourceAnswer}) {
  const rejected = answer.answerable === false || answer.supportReview?.supported === false || !!answer.supportError;
  const notice = answer.supportReview?.supported === false ? 'The selected citations do not support the complete answer.' : answer.supportError ? 'The citation support review did not complete. No support decision was recorded.' : 'The saved model draft was not accepted as a complete answer.';
  return <>
    {rejected ? <p role="status">{notice}</p> : <p>{answer.text}</p>}
    <AnswerSupportChecks answer={answer}/>
    {!!answer.citations.length && <ul>{answer.citations.map((citation, index) => <li key={index}>
      <blockquote>“{citation.quote}”</blockquote>
      <small>[{citation.label}] text {citation.offset}–{citation.offset + citation.quote.length} · snapshot {citation.sourceId} · text SHA-256 {citation.textSha256}</small>
    </li>)}</ul>}
    {!rejected && answer.uncertainty && <p>{answer.uncertainty}</p>}
    <p>{answer.limit}</p>
  </>;
}

function ReadingHistory({goalId, currentId, onSelect}: {goalId: string; currentId?: string; onSelect: (plan: ReadingDetail, trigger: HTMLElement) => void}) {
  const [plans, setPlans] = useState<SourceReadingSummary[]>([]), [initialized, setInitialized] = useState(false), [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState<'page' | 'plan'>(), [error, setError] = useState('');
  const details = useRef<HTMLDetailsElement>(null), active = useRef<AbortController | undefined>(undefined);
  const failed = useRef<{kind: 'page'; before?: string; replace: boolean} | {kind: 'plan'; id: string} | undefined>(undefined);
  useEffect(() => () => {active.current?.abort(); active.current = undefined;}, []);
  function close() {active.current?.abort(); active.current = undefined; setLoading(undefined);}
  async function page(before?: string, replace = false) {
    if (active.current) return;
    const control = new AbortController(); active.current = control; setLoading('page'); setError('');
    try {
      const response = await fetch('/api/goals/' + encodeURIComponent(goalId) + '/readings?limit=10' + (before ? '&before=' + encodeURIComponent(before) : ''), {credentials: 'same-origin', cache: 'no-store', signal: control.signal});
      const value = await response.json();
      if (control.signal.aborted || active.current !== control || !details.current?.open) return;
      if (!response.ok) throw new Error(value.error || 'Saved reading history is unavailable.');
      if (!Array.isArray(value.readings) || value.readings.some((plan: SourceReadingSummary) => plan.goalId !== goalId || typeof plan.id !== 'string' || typeof plan.question !== 'string') || (value.nextCursor !== undefined && (typeof value.nextCursor !== 'string' || !/^[1-9][0-9]*$/.test(value.nextCursor) || !Number.isSafeInteger(Number(value.nextCursor))))) throw new Error('The saved reading history response is invalid.');
      if (before && value.nextCursor !== undefined && Number(value.nextCursor) >= Number(before)) throw new Error('The saved reading cursor did not advance.');
      setPlans(current => replace ? value.readings : [...new Map([...current, ...value.readings].map(plan => [plan.id, plan])).values()]);
      setNextCursor(value.nextCursor); setInitialized(true); failed.current = undefined;
    } catch (failure) {
      if (!control.signal.aborted && active.current === control) {setError(String(failure)); failed.current = {kind: 'page', before, replace};}
    } finally {if (active.current === control) {active.current = undefined; setLoading(undefined);}}
  }
  async function inspect(id: string, trigger: HTMLElement) {
    if (active.current) return;
    const control = new AbortController(); active.current = control; setLoading('plan'); setError('');
    try {
      const response = await fetch('/api/goals/' + encodeURIComponent(goalId) + '/readings/' + encodeURIComponent(id), {credentials: 'same-origin', cache: 'no-store', signal: control.signal});
      const value = await response.json();
      if (control.signal.aborted || active.current !== control || !details.current?.open) return;
      if (!response.ok) throw new Error(value.error || 'The saved reading plan is unavailable.');
      if (value.id !== id || value.goalId !== goalId || typeof value.question !== 'string' || !Array.isArray(value.ranges) || !Number.isSafeInteger(value.resultCount) || value.resultCount < 0 || (value.result && (value.result.goalId !== goalId || value.result.readingId !== id || !value.result.execution))) throw new Error('The saved reading identity changed.');
      onSelect(value as ReadingDetail, trigger); failed.current = undefined;
    } catch (failure) {if (!control.signal.aborted && active.current === control) {setError(String(failure)); failed.current = {kind: 'plan', id};}}
    finally {if (active.current === control) {active.current = undefined; setLoading(undefined);}}
  }
  function retry(trigger: HTMLElement) {const attempt = failed.current; if (attempt?.kind === 'plan') void inspect(attempt.id, trigger); else if (attempt) void page(attempt.before, attempt.replace);}
  return <details ref={details} className="goal-reading-history" onToggle={event => {if (!event.currentTarget.open) close(); else if (!initialized && !active.current) void page();}}>
    <summary>Reading plan history</summary>
    <p>Earlier exact questions and passage identities stay saved. History loads only when opened; inspecting a plan reads its verified saved ranges.</p>
    {loading && <p role="status">{loading === 'plan' ? 'Reading saved plan…' : 'Loading saved reading history…'}</p>}
    {error && <p role="status">{error}</p>}
    {initialized && !plans.length && <p>No reading plans have been saved yet.</p>}
    {!!plans.length && <ol tabIndex={0} aria-label="Saved reading plan history">{plans.map(plan => <li key={plan.id} data-reading-id={plan.id}>
      <small>{new Date(plan.created).toLocaleString()} · {plan.mode} · {plan.match}{plan.id === currentId ? ' · current reading' : ''}</small>
      <p>{plan.question.length > 180 ? plan.question.slice(0, 180).trimEnd() + '…' : plan.question}</p>
      <button type="button" disabled={!!loading} aria-label={'Inspect saved reading plan ' + plan.id} onClick={event => void inspect(plan.id, event.currentTarget)}>Inspect saved reading plan</button>
    </li>)}</ol>}
    <div className="goal-actions">
      {nextCursor && <button type="button" disabled={!!loading} onClick={() => void page(nextCursor)}>Show earlier reading plans</button>}
      {initialized && <button type="button" disabled={!!loading} onClick={() => void page(undefined, true)}>Refresh reading plans</button>}
      {error && <button type="button" disabled={!!loading} onClick={event => retry(event.currentTarget)}>Retry reading request</button>}
    </div>
  </details>;
}

function SavedSource({goalId, source, label, selections, reading}: {goalId: string; source: SourceSnapshot; label: string; selections: Selection[]; reading?: SourceReadingPlan}) {
  const [page, setPage] = useState<SavedText>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const activeRead = useRef<AbortController | undefined>(undefined), inspectButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => activeRead.current?.abort(), []);
  function close() {
    activeRead.current?.abort(); activeRead.current = undefined;
    setBusy(false); setPage(undefined); setError('');
    requestAnimationFrame(() => {if (!activeRead.current && document.activeElement === document.body) inspectButton.current?.focus({preventScroll: true});});
  }
  async function inspect(offset: number, selection?: Selection) {
    if (activeRead.current) return;
    const control = new AbortController(); activeRead.current = control;
    setBusy(true); setError('');
    try {
      if (selection && (!Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) || selection.start < 0 || selection.end <= selection.start || selection.end > source.textLength || selection.end - selection.start > 1600 || selection.textSha256 !== source.textSha256)) throw new Error('The saved selection does not match this source.');
      let cursor = offset, text = '', end = offset;
      do {
        const response = await fetch('/api/goals/' + encodeURIComponent(goalId) + '/sources/' + encodeURIComponent(source.id) + '?offset=' + cursor, {credentials: 'same-origin', cache: 'no-store', signal: control.signal});
        const value = await response.json();
        if (control.signal.aborted || activeRead.current !== control) return;
        if (!response.ok) throw new Error(value.error || 'Saved text is unavailable.');
        if (value.source?.id !== source.id || value.source?.goalId !== goalId || value.source?.textSha256 !== source.textSha256) throw new Error('The saved source identity changed.');
        if (value.offset !== cursor || !Number.isSafeInteger(value.end) || value.end < cursor || value.end > source.textLength || typeof value.text !== 'string' || value.text.length !== value.end - cursor || value.text.length > 1000) throw new Error('The saved-text response has invalid positions.');
        end = selection ? Math.min(selection.end, value.end) : value.end;
        if (selection && end <= cursor) throw new Error('The saved-text response did not reach the selected passage.');
        text += value.text.slice(0, end - cursor); cursor = end;
      } while (selection && cursor < selection.end);
      if (selection?.rangeSha256) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        if (control.signal.aborted || activeRead.current !== control) return;
        const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== selection.rangeSha256 || (selection.text !== undefined && selection.text !== text)) throw new Error('The selected passage does not match its saved range hash.');
      }
      if (!control.signal.aborted && activeRead.current === control) setPage({offset, end, text, selected: !!selection, readingId: selection ? reading?.id : undefined, rangeVerified: !!selection?.rangeSha256});
    } catch (failure) {if (!control.signal.aborted && activeRead.current === control) setError(String(failure));}
    finally {if (activeRead.current === control) {activeRead.current = undefined; setBusy(false);}}
  }
  return <article className="goal-source" aria-label={'Saved source ' + label}>
    <strong>[{label}] {source.title}</strong>
    <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
    <small>Retrieved {new Date(source.retrievedAt).toLocaleString()} · {source.type} · {source.bytes.toLocaleString()} response bytes · {source.textLength.toLocaleString()} text positions</small>
    {source.requestedUrl !== source.url && <small>Requested: {source.requestedUrl}</small>}
    {source.copiedFrom && <small>Copied from snapshot {source.copiedFrom.sourceId} in question {source.copiedFrom.goalId}, without a new public fetch.</small>}
    <details><summary>Content identity</summary>
      <small>Response SHA-256: {source.sha256}</small><small>Text SHA-256: {source.textSha256}</small>
      <small>Snapshot {source.id} · {source.normalization}. Text positions use UTF-16 offsets. Acquisition checks do not establish factual accuracy.</small>
    </details>
    {selections.length > 0 ? <ol className="goal-source-ranges">{selections.map((selection, index) => <li key={index}>
      <p>{reading?.mode === 'auto' && selection.score === 0 ? 'Opening candidate (no question-term match)' : reading ? 'Selected passage' : 'Saved answer range (legacy)'}: text {selection.start}–{selection.end} · {selection.end - selection.start} positions</p>
      <small>Reading label: [{selection.label}]</small>
      {reading?.mode === 'auto' && selection.score === 0 && <small>No question term matched this candidate. Its relevance to the question is not established.</small>}
      {!!selection.matchedTerms?.length && <small>Matched question terms: {selection.matchedTerms.join(', ')}</small>}
      {selection.rangeSha256 && <details><summary>Range identity</summary><small>Range SHA-256: {selection.rangeSha256}</small><small>Source text SHA-256: {selection.textSha256}</small></details>}
      <button type="button" disabled={busy} aria-label={'Inspect selected passage ' + label + ' ' + selection.start + '–' + selection.end} onClick={() => void inspect(selection.start, selection)}>Inspect selected passage {index + 1}</button>
    </li>)}</ol> : reading && <p>No passage from this source was selected for this reading.</p>}
    <div className="goal-actions"><button ref={inspectButton} type="button" disabled={busy} onClick={() => void inspect(page && !page.selected ? page.offset : 0)}>{busy ? 'Reading saved text…' : page && !page.selected ? 'Reload saved text' : 'Inspect saved text'}</button>
      {(page || busy) && <button type="button" onClick={close}>Close saved text</button>}</div>
    {error && <p role="status">{error}</p>}
    {page && <div className="goal-saved-text">
      <p>{page.selected ? 'Selected passage' : 'Saved text'} {page.offset}–{page.end} of {source.textLength}.{page.rangeVerified ? ' Range hash checked against the saved reading plan.' : ''}</p>
      {page.readingId && <small>Inspected reading plan: {page.readingId}</small>}
      <pre tabIndex={0} aria-label={'Saved text ' + label} data-source-range={page.offset + ':' + page.end}>{page.text}</pre>
      <div className="goal-actions">{page.selected ? <button type="button" disabled={busy} onClick={() => void inspect(page.offset)}>Browse saved text from this position</button> : <>
        <button type="button" disabled={busy || page.offset === 0} onClick={() => void inspect(Math.max(0, page.offset - 1000))}>Previous text</button>
        <button type="button" disabled={busy || page.end >= source.textLength} onClick={() => void inspect(page.end)}>Next text</button>
      </>}</div>
    </div>}
  </article>;
}

export function GoalSources({goal, onAskAnother, message}: {goal: GoalRecord; onAskAnother?: (goal: GoalRecord) => void; message?: string}) {
  const [inspected, setInspected] = useState<ReadingDetail>();
  const readingPanel = useRef<HTMLElement>(null);
  function showReading(plan: ReadingDetail | undefined, trigger: HTMLElement) {
    setInspected(plan);
    requestAnimationFrame(() => {
      if (document.activeElement !== trigger && document.activeElement !== document.body) return;
      readingPanel.current?.focus({preventScroll: true}); readingPanel.current?.scrollIntoView({block: 'start'});
    });
  }
  if (!goal.sourceQuestion) return null;
  const answer = goal.tasks.find(task => task.sourceAnswer)?.execution?.sourceAnswer, reading = inspected?.goalId === goal.id ? inspected : goal.reading;
  const earlierReading = reading && reading.id !== goal.reading?.id;
  const archived = inspected?.goalId === goal.id ? inspected.result : undefined, archivedAnswer = archived?.execution.sourceAnswer;
  const sourcesReady = goal.sourceQuestion.urls.every((url, index) => {
    const task = goal.tasks.find(item => item.id === 'source-' + (index + 1));
    return task?.status === 'verified' && task.review?.accepted && task.execution?.verified && goal.sources?.some(source => source.id === task.execution?.sourceId && source.requestedUrl === url);
  });
  const active = !['completed', 'needs_input', 'cancelled'].includes(goal.status), reusable = sourcesReady && !active;
  return <section className="goal-sources" aria-label="Question sources and answer">
    <p>Public-source question · Saved copies stay here when the window closes. Continue reuses them. No PDF, website or vault content is sent to source hosts.</p>
    {reading ? <section ref={readingPanel} tabIndex={-1} className="goal-reading-plan" aria-label="Saved reading plan" data-reading-id={reading.id}>
      <strong>Reading plan saved before inference</strong>
      {earlierReading && <><p>Inspecting an earlier saved plan. The goal’s current progress and answer stay unchanged.</p><button type="button" onClick={event => showReading(undefined, event.currentTarget)}>Return to current reading</button></>}
      <p>{reading.mode === 'manual' ? 'Explicitly selected passages. The answer is limited to these ranges.' : 'Automatic question-term matching selects up to two passages and 1,600 text positions from the full saved copies. This may omit relevant text; it is not a complete source review.'}</p>
      {reading.match === 'none' && <p role="status">No question-term match was found. The opening candidates below are saved for inspection; the automatic answer paused before inference. Inspect the saved text and ask a more focused question.</p>}
      <small>{reading.ranges.length} selected passages · Saved {new Date(reading.created).toLocaleString()} · {reading.version}</small>
      <details><summary>Reading identity and exact question</summary><p>{reading.question}</p><small>Question SHA-256: {reading.questionSha256}</small><small>Reading {reading.id} · milestone {reading.taskId}</small></details>
    </section> : <p>{answer ? 'This older answer has no persisted reading plan. Its saved ranges are shown below; automatic relevance was not recorded.' : 'No reading plan has been saved yet. Source acquisition can finish before local inference is available.'}</p>}
    <ReadingHistory key={goal.id} goalId={goal.id} currentId={goal.reading?.id} onSelect={showReading}/>
    {archived && <section className="goal-source-answer" aria-label="Archived reading result" data-reading-result-id={archived.id}>
      <h4>Latest archived {archivedAnswer ? 'answer' : 'result'} ({inspected?.resultCount || 1} saved {(inspected?.resultCount || 1) === 1 ? 'attempt' : 'attempts'})</h4>
      <small>Recorded attempt {archived.attempt} · Saved {new Date(archived.created).toLocaleString()} · {archived.status} · {archived.execution.verified ? 'execution checks recorded as verified' : 'execution checks were not satisfied'}</small>
      <details><summary>Archived exact question</summary><p>{archived.question}</p></details>
      {archivedAnswer ? <SourceAnswerContent answer={archivedAnswer}/> : <p>{archived.execution.message}</p>}
      {archived.review && <p>Saved acceptance review · {archived.review.accepted ? 'accepted' : 'needs more work'}: {archived.review.reason}</p>}
      {!!archived.execution.evidence.length && <details><summary>Archived execution evidence</summary><ul>{archived.execution.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    </section>}
    {goal.sourceQuestion.urls.map((url, index) => {
      const source = goal.sources?.find(item => item.taskId === 'source-' + (index + 1));
      const selections = source ? (reading?.ranges || answer?.selections || []).filter(selection => selection.sourceId === source.id) : [];
      return source ? <SavedSource key={goal.id + ':' + source.id} goalId={goal.id} source={source} label={'source-' + (index + 1)} selections={selections} reading={reading}/> : <p className="goal-source" key={url}>[source-{index + 1}] Waiting for a saved copy: {url}</p>;
    })}
    {answer ? <section className="goal-source-answer" aria-label="Source-grounded answer">
      <h4>Answer · {answer.supportError ? 'support review incomplete' : answer.answerable === false || answer.supportReview?.supported === false ? 'needs more citation support' : goal.tasks.find(task => task.sourceAnswer)?.status === 'verified' ? 'acceptance passed' : 'awaiting acceptance'}</h4>
      {answer.readingId && <small>Answer reading plan: {answer.readingId}</small>}
      <SourceAnswerContent answer={answer}/>
    </section> : <p>No answer saved yet. A local model is required after source acquisition and passage selection. If it is unavailable, set it up and explicitly Continue remaining work; saved sources will be reused.</p>}
    {onAskAnother && <div className="goal-source-followup">
      <button type="button" disabled={!reusable} onClick={() => onAskAnother(goal)}>Ask another question from saved sources</button>
      <small>{reusable ? 'Prepare a new question using these verified saved copies without fetching them again. The original question and answer stay unchanged. Nothing is submitted until you send the new question.' : active ? 'Wait for this question to finish or stop it before reusing its sources.' : 'All source acquisitions must pass their saved-identity checks before their copies can be reused.'}</small>
      {message && <p role="status">{message}</p>}
    </div>}
  </section>;
}
