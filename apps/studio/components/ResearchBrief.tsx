'use client';
import {useEffect, useRef, useState} from 'react';
import type {GoalRecord} from '../core/goal-orchestrator';
import type {BriefArtifact, BriefRequest, BriefState} from '../core/research-brief-types';
import {beginBriefSubmission, readBriefDraft, sameBriefSubmission, settleBriefSubmission, type BriefFormDraft, type BriefSubmission} from '../core/research-brief-draft';

type BriefGoal = GoalRecord & {brief?: BriefRequest; briefState?: BriefState};
type Props = {goal: BriefGoal; onCreated: (child: GoalRecord) => void; onOpenDocument: (id: string) => void};
const phaseLabels: Record<BriefState['phase'], string> = {
  preparing: 'Preparing the writing handoff', draft_saved: 'Native writing draft saved',
  reviewed: 'Writing support review saved', rejected: 'Writing needs more support', saved: 'Document files saved'
};

function SavedBrief({goal, onOpenDocument}: Pick<Props, 'goal' | 'onOpenDocument'>) {
  const brief = goal.brief!, state = goal.briefState;
  const artifact = state?.artifact || (goal.tasks.find(task => (task as {sourceBrief?: boolean}).sourceBrief)?.execution as {briefArtifact?: BriefArtifact} | undefined)?.briefArtifact;
  return <section className="research-brief" aria-label="Research brief">
    <h4>{brief.title}</h4>
    <p>{state ? phaseLabels[state.phase] : 'Title and notes saved. Waiting for the document specialist.'}</p>
    {artifact && <>
      <p>{artifact.pages} {artifact.pages === 1 ? 'page' : 'pages'} · {goal.status === 'completed' ? 'Document and goal checks passed.' : 'The files are saved; goal acceptance is still shown above.'}</p>
      <div className="goal-actions research-brief-actions">
        <button type="button" onClick={() => onOpenDocument(artifact.documentId)}>Open brief PDF</button>
        <a href={'/api/goals/' + encodeURIComponent(goal.id) + '/brief/export?format=pdf'} download>Download brief PDF</a>
        <a href={'/api/goals/' + encodeURIComponent(goal.id) + '/brief/export?format=html'} download>Download brief HTML</a>
      </div>
      <small>The PDF opens in the editor. Brief downloads keep the original checked document.</small>
    </>}
    <details>
      <summary>Saved notes and document identity</summary>
      <p className="research-brief-notes">{brief.notes || 'No personal notes were added.'}</p>
      <small>Personal notes are kept separately from source evidence.</small>
      <small>Parent question {brief.parentGoalId}</small>
      {state && <small>Writing input SHA-256 {state.inputSha256}</small>}
      {state?.draftSha256 && <small>Native draft SHA-256 {state.draftSha256}</small>}
      {artifact && <>
        <small>Document {artifact.documentId}</small>
        <small>PDF SHA-256 {artifact.pdfSha256}</small>
        <small>HTML SHA-256 {artifact.htmlSha256}</small>
      </>}
    </details>
    {state?.draft && <details className="research-brief-writing">
      <summary>Saved native writing and support review</summary>
      {state.draft.paragraphs.map((paragraph, index) => <p key={index}>{paragraph.text} {paragraph.citations.map(citation => '[' + citation + ']').join(' ')}</p>)}
      {state.supportReview && <p>{state.supportReview.supported ? 'Writing support check passed: ' : 'Writing support check needs attention: '}{state.supportReview.reason}</p>}
      <small>Model support checks do not independently verify source claims. The source copies and literal citations remain inspectable below.</small>
    </details>}
    {!artifact && <p>The saved title and notes are kept through interruption. Use Stop goal or Continue remaining work in this goal; accepted source work is reused.</p>}
  </section>;
}

function BriefCreation({goal, onCreated}: Pick<Props, 'goal' | 'onCreated'>) {
  const [draft, setDraft] = useState<BriefFormDraft>(), [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [storageError, setStorageError] = useState('');
  const [checkedMissing, setCheckedMissing] = useState(false);
  const current = useRef<BriefFormDraft | undefined>(undefined), active = useRef<AbortController | undefined>(undefined), mounted = useRef(true);
  const titleInput = useRef<HTMLInputElement>(null), inspectButton = useRef<HTMLButtonElement>(null), notice = useRef<HTMLParagraphElement>(null);
  const storageKey = 'anascummis.research-brief-draft.v1.' + goal.id;
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {const saved = readBriefDraft(raw); current.current = saved; setDraft(saved); setOpen(true); if (saved.submitted) setMessage('An earlier submission was not confirmed. Inspect saved briefs before sending anything again.');}
    } catch (error) {setStorageError('This browser could not restore the brief draft. ' + String(error));}
    setLoaded(true);
    return () => {mounted.current = false; active.current?.abort();};
  }, [storageKey]);

  function save(next: BriefFormDraft | undefined) {
    current.current = next; setDraft(next);
    try {if (next) localStorage.setItem(storageKey, JSON.stringify(next)); else localStorage.removeItem(storageKey); setStorageError('');}
    catch {setStorageError('This browser could not save the draft. Keep this window open or copy your title and notes before closing or reloading. The goal has not saved these edits.');}
  }
  function reveal() {
    if (!current.current) save({version: 1, requestKey: crypto.randomUUID(), title: 'Research brief', notes: ''});
    setOpen(true); requestAnimationFrame(() => titleInput.current?.focus());
  }
  function edit(field: 'title' | 'notes', value: string) {
    const previous = current.current;
    if (previous) save({...previous, [field]: value});
  }
  function confirmed(child: BriefGoal, submitted: BriefSubmission) {
    if (child.parentGoalId !== goal.id || child.brief?.parentGoalId !== goal.id || !sameBriefSubmission(child.brief, submitted)) throw new Error('The saved brief does not match the exact submitted title, notes and request identity.');
    const previous = current.current;
    if (!previous) throw new Error('The pending brief draft is missing; inspect the saved goal before sending again.');
    const next = settleBriefSubmission(previous, submitted, () => crypto.randomUUID());
    save(next); setCheckedMissing(false);
    if (!next) setOpen(false);
    setMessage(next ? 'The submitted brief is saved. Your newer title or notes remain in this browser as an unsent draft.' : 'The brief title and notes are saved in the linked goal.');
    onCreated(child);
  }
  async function submit(retry = false) {
    if (active.current || !current.current) return;
    let saved = current.current;
    try {
      if (!retry) {saved = beginBriefSubmission(saved); save(saved);}
      else if (!checkedMissing || !saved.submitted) return;
    } catch (error) {setMessage(String(error)); return;}
    const submitted = saved.submitted!, controller = new AbortController(); active.current = controller;
    setBusy(true); setCheckedMissing(false); setMessage('Saving the exact title and notes before writing…');
    try {
      const response = await fetch('/api/goals/' + encodeURIComponent(goal.id) + '/brief', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: {'Content-Type': 'application/json', 'X-Requested-With': 'Anascummis'}, body: JSON.stringify(submitted)
      });
      const child = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(child.error || 'The brief submission was not confirmed.');
      confirmed(child as BriefGoal, submitted);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {setMessage('Submission was not confirmed. Your title, notes and submission identity are kept. Inspect saved briefs before retrying. ' + String(error)); requestAnimationFrame(() => inspectButton.current?.focus());}
    } finally {if (active.current === controller) {active.current = undefined; if (mounted.current) setBusy(false);}}
  }
  async function inspect() {
    const submitted = current.current?.submitted;
    if (active.current || !submitted) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage('Checking saved brief goals. No work is being submitted.');
    try {
      const response = await fetch('/api/goals', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
      const goals: unknown = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(goals)) throw new Error('Saved brief history is unavailable.');
      const matches = (goals as BriefGoal[]).filter(child => child.brief?.requestKey === submitted.requestKey && child.brief.parentGoalId === goal.id);
      if (matches.length > 1) throw new Error('More than one brief has this submission identity. Review saved goals before continuing.');
      if (matches[0]) confirmed(matches[0], submitted);
      else {setCheckedMissing(true); setMessage('No brief with this submission identity is saved. You may explicitly retry the original title and notes. Any newer edits remain separate.'); requestAnimationFrame(() => notice.current?.focus());}
    } catch (error) {if (mounted.current && !controller.signal.aborted) {setCheckedMissing(false); setMessage('Could not inspect saved briefs. The draft is kept; nothing was resubmitted. ' + String(error));}}
    finally {if (active.current === controller) {active.current = undefined; if (mounted.current) setBusy(false);}}
  }
  return <section className="research-brief-create" aria-label="Create a research brief">
    {!open && <button type="button" disabled={!loaded} onClick={reveal}>{draft ? 'Continue brief draft' : 'Create research brief'}</button>}
    {open && draft && <form onSubmit={event => {event.preventDefault(); void submit();}}>
      <h4>Create a cited research brief</h4>
      <p>The linked goal reuses this accepted answer and saved source copies. A local writing decision creates a short brief, then host checks create PDF and HTML files.</p>
      <label>Brief title<input ref={titleInput} aria-label="Brief title" value={draft.title} maxLength={120} onChange={event => edit('title', event.target.value)}/></label>
      <label>Your notes for the brief<textarea aria-label="Your notes for the brief" value={draft.notes} maxLength={2000} onChange={event => edit('notes', event.target.value)} placeholder="Optional personal notes, kept separately from source evidence."/></label>
      <small>Your edits are a draft in this browser until you save the linked goal. Notes are not sent to public source hosts.</small>
      {draft.submitted && <div className="research-brief-unconfirmed" aria-label="Unconfirmed brief submission">
        <p>The original submission needs inspection before another save. Editing above keeps newer text as a separate unsent draft.</p>
        <details><summary>Original submitted title and notes</summary><p>{draft.submitted.title}</p><p className="research-brief-notes">{draft.submitted.notes || 'No personal notes were submitted.'}</p><small>Submission {draft.submitted.requestKey}</small></details>
        <button ref={inspectButton} type="button" disabled={busy} onClick={() => void inspect()}>Inspect saved briefs</button>
        {checkedMissing && <button type="button" disabled={busy} onClick={() => void submit(true)}>Retry saved submission</button>}
      </div>}
      <div className="goal-actions research-brief-actions">
        <button type="submit" disabled={busy || !!draft.submitted || !draft.title.trim()}>Save and write brief</button>
        <button type="button" onClick={() => setOpen(false)}>Close brief form</button>
      </div>
    </form>}
    {storageError && <p role="status">{storageError}</p>}
    <p ref={notice} role="status" tabIndex={-1}>{message}</p>
  </section>;
}

export function ResearchBrief({goal, onCreated, onOpenDocument}: Props) {
  if (goal.brief) return <SavedBrief goal={goal} onOpenDocument={onOpenDocument}/>;
  const answerTask = goal.tasks.find(task => task.sourceAnswer), answer = answerTask?.execution?.sourceAnswer;
  if (goal.status !== 'completed' || !goal.sourceQuestion || answerTask?.status !== 'verified' || !answerTask.review?.accepted || answer?.answerable !== true || answer.supportReview?.supported !== true) return null;
  return <BriefCreation goal={goal} onCreated={onCreated}/>;
}
