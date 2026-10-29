'use client';
import {useState} from 'react';
import type {GoalRecord} from '../core/goal-orchestrator';
import type {SourceSnapshot} from '../core/public-source';

function SavedSource({goalId, source, label}: {goalId: string; source: SourceSnapshot; label: string}) {
  const [page, setPage] = useState<{offset: number; end: number; text: string}>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function inspect(offset: number) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/goals/' + goalId + '/sources/' + source.id + '?offset=' + offset, {credentials: 'same-origin', cache: 'no-store'});
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Saved text is unavailable.');
      if (value.source?.textSha256 !== source.textSha256) throw new Error('The saved source identity changed.');
      setPage(value);
    } catch (failure) {setError(String(failure));}
    finally {setBusy(false);}
  }
  return <article className="goal-source" aria-label={'Saved source ' + label}>
    <strong>[{label}] {source.title}</strong>
    <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
    <small>Retrieved {new Date(source.retrievedAt).toLocaleString()} · {source.type} · {source.bytes.toLocaleString()} response bytes · {source.textLength.toLocaleString()} text positions</small>
    {source.requestedUrl !== source.url && <small>Requested: {source.requestedUrl}</small>}
    <details><summary>Content identity</summary>
      <small>Response SHA-256: {source.sha256}</small><small>Text SHA-256: {source.textSha256}</small>
      <small>Snapshot {source.id} · {source.normalization}. Text positions use UTF-16 offsets. Acquisition checks do not establish factual accuracy.</small>
    </details>
    <div className="goal-actions"><button disabled={busy} onClick={() => void inspect(page?.offset || 0)}>{busy ? 'Reading saved text…' : page ? 'Reload saved text' : 'Inspect saved text'}</button>
      {page && <button onClick={() => setPage(undefined)}>Close saved text</button>}</div>
    {error && <p role="status">{error}</p>}
    {page && <div className="goal-saved-text">
      <p>Saved text {page.offset}–{page.end} of {source.textLength}. Answer selection: 0–{Math.min(800, source.textLength)}; later text is retained for inspection, outside this answer’s model context.</p>
      <pre tabIndex={0} aria-label={'Saved text ' + label}>{page.text}</pre>
      <div className="goal-actions">
        <button disabled={busy || page.offset === 0} onClick={() => void inspect(Math.max(0, page.offset - 1000))}>Previous text</button>
        <button disabled={busy || page.end >= source.textLength} onClick={() => void inspect(page.end)}>Next text</button>
      </div>
    </div>}
  </article>;
}

export function GoalSources({goal}: {goal: GoalRecord}) {
  if (!goal.sourceQuestion) return null;
  const answer = goal.tasks.find(task => task.sourceAnswer)?.execution?.sourceAnswer;
  return <section className="goal-sources" aria-label="Question sources and answer">
    <p>Public-source question · Saved copies stay here when the window closes. Continue reuses them; start a new question for a fresh fetch. No PDF, website or vault content is sent to source hosts.</p>
    {goal.sourceQuestion.urls.map((url, index) => {
      const source = goal.sources?.find(item => item.taskId === 'source-' + (index + 1));
      return source ? <SavedSource key={source.id} goalId={goal.id} source={source} label={'source-' + (index + 1)}/> : <p className="goal-source" key={url}>[source-{index + 1}] Waiting for a saved copy: {url}</p>;
    })}
    {answer ? <section className="goal-source-answer" aria-label="Source-grounded answer">
      <h4>Answer · {goal.tasks.find(task => task.sourceAnswer)?.status === 'verified' ? 'acceptance passed' : 'awaiting acceptance'}</h4>
      <p>{answer.text}</p>
      <ul>{answer.citations.map((citation, index) => <li key={index}>
        <blockquote>“{citation.quote}”</blockquote>
        <small>[{citation.label}] text {citation.offset}–{citation.offset + citation.quote.length} · snapshot {citation.sourceId} · text SHA-256 {citation.textSha256}</small>
      </li>)}</ul>
      <p>{answer.uncertainty} {answer.limit}</p>
    </section> : <p>No answer saved yet. A local model is required after source acquisition. If it is unavailable, set it up and explicitly Continue remaining work; saved sources will be reused.</p>}
  </section>;
}
