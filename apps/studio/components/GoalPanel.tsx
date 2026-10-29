'use client';
import {useEffect, useRef, useState} from 'react';
import type {GoalRecord} from '../core/goal-orchestrator';
import type {ActivityPage} from '../core/activity-journal';
import {ActivityHistory} from './ActivityHistory';
import {GoalSources} from './GoalSources';
import {ResearchBrief} from './ResearchBrief';

const goalLabels = {
  queued: 'Queued', planning: 'Planning', running: 'Working', needs_input: 'Needs attention',
  completed: 'Completed', cancelled: 'Stopped'
};
const taskLabels = {pending: 'Waiting', running: 'Working', verified: 'Accepted', needs_input: 'Needs attention'};
const roleLabels = {planner: 'Planner', executor: 'Specialist executor', reviewer: 'Acceptance reviewer', coordinator: 'Coordinator'};
type Props = {
  projectId?: string;
  documentId?: string;
  documentName?: string;
  onOpenProject: (id: string) => void;
  onOpenDocument: (id: string) => void;
  onOpenSoftware: (id: string) => void;
};
type SourceReuse = {goalId: string; projectId: string; urls: string[]; question: string};

async function goalApi(path = '', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch('/api/goals' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal, cache: 'no-store',
    headers: {'Content-Type': 'application/json', 'X-Requested-With': 'Anascummis'},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Goal request failed.');
  return value;
}

export function GoalPanel({projectId, documentId, documentName, onOpenProject, onOpenDocument, onOpenSoftware}: Props) {
  const [goals, setGoals] = useState<GoalRecord[]>([]), [request, setRequest] = useState('');
  const [research, setResearch] = useState(false), [includeDocument, setIncludeDocument] = useState(!!documentId);
  const [message, setMessage] = useState(''), [loadError, setLoadError] = useState(''), [busy, setBusy] = useState<string>();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState(false), [sourceUrls, setSourceUrls] = useState('');
  const [reuse, setReuse] = useState<SourceReuse>(), [sourceMessages, setSourceMessages] = useState<Record<string, string>>({});
  const requestDraft = useRef<{text: string; sourceMode: boolean; sourceUrls: string; reuse?: SourceReuse}>({text: '', sourceMode: false, sourceUrls: ''}), noteDrafts = useRef<Record<string, {text: string}>>({});
  const busyRef = useRef<string | undefined>(undefined), mutationEpoch = useRef(0);
  const requestInput = useRef<HTMLTextAreaElement>(null), goalNodes = useRef(new Map<string, HTMLElement>()), navigation = useRef<AbortController | undefined>(undefined);
  const selectionSequence = useRef(0), revealedSelection = useRef(0), [goalSelection, setGoalSelection] = useState<{id: string; key: number}>();

  useEffect(() => {setIncludeDocument(!!documentId);}, [documentId]);
  useEffect(() => () => navigation.current?.abort(), []);
  useEffect(() => {
    if (!goalSelection || revealedSelection.current === goalSelection.key) return;
    const node = goalNodes.current.get(goalSelection.id);
    if (!node) return;
    revealedSelection.current = goalSelection.key;
    node.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    node.focus({preventScroll: true});
  }, [goalSelection, goals]);
  useEffect(() => {
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const epoch = mutationEpoch.current;
      try {
        const next = await goalApi('', undefined, control.signal);
        if (!Array.isArray(next)) throw new Error('Goal history is unavailable.');
        if (!control.signal.aborted && epoch === mutationEpoch.current) {setGoals(next as GoalRecord[]); setLoadError('');}
      } catch (error) {
        if (!control.signal.aborted && epoch === mutationEpoch.current) setLoadError(String(error));
      } finally {
        if (!control.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {control.abort(); clearTimeout(timer);};
  }, []);

  function received(goal: GoalRecord) {
    // A child handoff can confirm a mutation independently of this panel's forms.
    // Its acknowledgement invalidates any list poll that began before it.
    mutationEpoch.current++;
    setGoals(current => [goal, ...current.filter(item => item.id !== goal.id)]);
  }
  function writeRequest(text: string) {
    requestDraft.current = {...requestDraft.current, text}; setRequest(text);
    if (text.length) setNewGoalOpen(true);
  }
  function writeNote(id: string, text: string) {
    noteDrafts.current[id] = {text}; setNotes(current => ({...current, [id]: text}));
  }
  async function openQuestion(id: string) {
    navigation.current?.abort();
    if (goalNodes.current.has(id)) {setGoalSelection({id, key: ++selectionSequence.current}); return;}
    const control = new AbortController(); navigation.current = control;
    try {
      const saved = await goalApi('/' + encodeURIComponent(id), undefined, control.signal) as GoalRecord;
      if (control.signal.aborted || navigation.current !== control) return;
      if (saved.id !== id) throw new Error('The saved question could not be opened.');
      setGoals(current => current.some(item => item.id === id) ? current : [...current, saved]);
      setGoalSelection({id, key: ++selectionSequence.current});
    } catch (error) {if (!control.signal.aborted && navigation.current === control) setMessage(String(error));}
    finally {if (navigation.current === control) navigation.current = undefined;}
  }
  function stageSourceQuestion(goal: GoalRecord) {
    if (!goal.sourceQuestion) return;
    if (!['completed', 'needs_input', 'cancelled'].includes(goal.status)) {
      setSourceMessages(messages => ({...messages, [goal.id]: 'Wait for this question to finish or stop it before reusing its sources.'})); return;
    }
    const current = requestDraft.current;
    if (busyRef.current || current.text.length || (!current.reuse && current.sourceUrls.length)) {
      setSourceMessages(messages => ({...messages, [goal.id]: busyRef.current ? 'A submission is pending. Your current draft was kept; wait for its result before staging another question.' : 'The New goal form already contains an unsent draft. Keep or send it before staging another question.'}));
      return;
    }
    const context: SourceReuse = {goalId: goal.id, projectId: goal.projectId, urls: [...goal.sourceQuestion.urls], question: goal.request};
    requestDraft.current = {text: '', sourceMode: true, sourceUrls: context.urls.join('\n'), reuse: context};
    setRequest(''); setSourceMode(true); setSourceUrls(context.urls.join('\n')); setReuse(context); setResearch(false); setNewGoalOpen(true);
    setSourceMessages(messages => ({...messages, [goal.id]: 'Saved sources are staged in New goal. Enter the exact new question and explicitly send it.'}));
    setMessage('A new question is being prepared from the original workspace and verified saved sources. Nothing has been submitted.');
    requestAnimationFrame(() => {
      if (requestDraft.current.reuse !== context) return;
      requestInput.current?.focus({preventScroll: true}); requestInput.current?.scrollIntoView({block: 'center'});
    });
  }
  function clearReuse() {
    requestDraft.current = {...requestDraft.current, reuse: undefined}; setReuse(undefined);
  }
  async function start() {
    const submitted = requestDraft.current;
    const targetProject = submitted.reuse?.projectId || projectId;
    if (!targetProject || !submitted.text.trim() || busyRef.current || (submitted.sourceMode && (!research || !submitted.sourceUrls.trim() || submitted.text.length > 1000))) return;
    busyRef.current = 'new'; mutationEpoch.current++;
    setBusy('new');
    try {
      const goal = await goalApi('', {
        request: submitted.text, project: targetProject,
        ...(!submitted.sourceMode && includeDocument && documentId ? {document: documentId} : {}), research,
        ...(submitted.sourceMode ? {sourceQuestion: {urls: submitted.reuse?.urls || submitted.sourceUrls.split('\n').map(url => url.trim()).filter(Boolean), ...(submitted.reuse ? {reuseGoalId: submitted.reuse.goalId} : {})}} : {})
      }) as GoalRecord;
      received(goal);
      if (requestDraft.current === submitted) {
        writeRequest(''); setSourceUrls(''); setReuse(undefined); requestDraft.current = {...requestDraft.current, sourceUrls: '', reuse: undefined}; setNewGoalOpen(false);
        if (submitted.reuse) setGoalSelection({id: goal.id, key: ++selectionSequence.current});
      }
      else setNewGoalOpen(true);
      setMessage(submitted.reuse ? 'The new question is saved with verified snapshot copies. Its parent question and answer are kept.' : submitted.sourceMode ? 'The exact question and source steps are saved. Acquisition, answer and acceptance progress will appear here.' : 'The full goal is saved. Planning, specialist work and acceptance reviews will appear here.');
    } catch (error) {setMessage('Submission was not confirmed. Check saved goals before sending again. ' + String(error));}
    finally {mutationEpoch.current++; busyRef.current = undefined; setBusy(undefined);}
  }
  async function act(goal: GoalRecord, action: 'stop' | 'resume') {
    if (busyRef.current) return;
    const submitted = noteDrafts.current[goal.id];
    busyRef.current = goal.id; mutationEpoch.current++;
    setBusy(goal.id);
    try {
      received(await goalApi('/' + goal.id + '/' + action, action === 'resume' ? {note: submitted?.text || ''} : {}) as GoalRecord);
      setMessage(action === 'stop' ? 'Goal stopped. Its plan, accepted work and evidence are kept.' : 'Continuing unfinished work with the saved plan and your guidance.');
      if (action === 'resume' && noteDrafts.current[goal.id] === submitted) writeNote(goal.id, '');
    } catch (error) {setMessage(String(error));}
    finally {mutationEpoch.current++; busyRef.current = undefined; setBusy(undefined);}
  }

  const targetProject = reuse?.projectId || projectId;
  const newGoalForm = <form onSubmit={event => {event.preventDefault(); void start();}}>
      <label className="goal-option"><input type="checkbox" checked={sourceMode} onChange={event => {const enabled = event.target.checked; requestDraft.current = {...requestDraft.current, sourceMode: enabled, ...(!enabled ? {reuse: undefined} : {})}; setSourceMode(enabled); if (!enabled) setReuse(undefined);}}/>Question from public sources</label>
      {reuse && <div className="goal-source-reuse" aria-label="Saved-source question context">
        <p>New question using verified saved copies. It uses the original question’s website workspace and source order, without a new public fetch.</p>
        <details><summary>Original question and reuse context</summary><p>{reuse.question}</p><small>Project {reuse.projectId} · parent question {reuse.goalId}</small></details>
        <button type="button" onClick={() => void openQuestion(reuse.goalId)}>Open original question</button>
        <button type="button" onClick={clearReuse}>Use new sources instead</button>
      </div>}
      <label>{sourceMode ? 'Exact question (up to 1,000 characters)' : 'Goal'}<textarea ref={requestInput} aria-label={sourceMode ? 'Exact question' : 'Goal'} value={request} onChange={event => writeRequest(event.target.value)} maxLength={sourceMode ? Math.max(1000, request.length) : 8000} placeholder={sourceMode ? 'Ask a focused question about the saved public sources.' : 'Describe the result you want and what must be true when it is finished.'}/></label>
      {sourceMode && <><label>{reuse ? 'Saved public source URLs (reused copies)' : 'Public HTTPS sources (one per line, up to two)'}<textarea aria-label="Public source URLs" value={sourceUrls} readOnly={!!reuse} maxLength={4001} onChange={event => {if (requestDraft.current.reuse) return; const text = event.target.value; requestDraft.current = {...requestDraft.current, sourceUrls: text}; setSourceUrls(text);}} placeholder="https://raw.githubusercontent.com/owner/repository/commit/README.md"/></label><small>{reuse ? 'These saved copies will be reused. ' : 'Full bounded copies are saved first. '}Question-term matching selects up to two passages and 1,600 text positions for the answer; it can miss relevant text. The reading plan, ranges and hashes stay inspectable even if inference stops. A local model is required to answer.</small>{request.length > 1000 && <p role="status">Shorten this question to 1,000 characters. Your full draft is kept.</p>}</>}
      {documentId && !sourceMode && <label className="goal-option"><input type="checkbox" checked={includeDocument} onChange={event => {requestDraft.current = {...requestDraft.current}; setIncludeDocument(event.target.checked);}}/>Include the open PDF{documentName ? ': ' + documentName : ''}</label>}
      <label className="goal-option"><input type="checkbox" checked={research} onChange={event => {requestDraft.current = {...requestDraft.current}; setResearch(event.target.checked);}}/>Allow public web research for this goal</label>
      <button type="submit" disabled={!targetProject || !request.trim() || !!busy || (sourceMode && (!research || !sourceUrls.trim() || request.length > 1000))}>{busy === 'new' ? 'Saving goal…' : reuse ? 'Send question from saved sources' : sourceMode ? 'Save question and read sources' : 'Start coordinated work'}</button>
      {!targetProject && <small>Preparing the current website workspace…</small>}
    </form>;
  return <section className="goal-panel" aria-label="Coordinated goals">
    <p>{goals.length ? 'Progress stays saved when you close this window.' : 'A planner breaks down your goal, specialists do the work, and a separate reviewer checks each milestone. Their progress stays here when this window or page closes.'}</p>
    {goals.length ? <details className="goal-create" open={newGoalOpen} onToggle={event => setNewGoalOpen(event.currentTarget.open)}><summary>New goal</summary>{newGoalForm}</details> : newGoalForm}
    {loadError && <p role="status">{loadError}</p>}
    <p role="status">{message}</p>
    {!goals.length && <p>No saved goals yet.</p>}
    {goals.map(goal => {
      const accepted = goal.tasks.filter(task => task.status === 'verified').length;
      const running = ['queued', 'planning', 'running'].includes(goal.status);
      const canResume = ['needs_input', 'cancelled'].includes(goal.status);
      const awaitingEditApproval = goal.documentEditState?.phase === 'awaiting_approval' && goal.status === 'needs_input';
      const latest = goal.events.at(-1);
      const longRequest = goal.request.length > 180;
      const linkedSoftwareTask = goal.tasks.find(task => ['running', 'needs_input'].includes(task.status) && (task.softwareTaskId || task.execution?.softwareTaskId)) || goal.tasks.find(task => task.softwareTaskId || task.execution?.softwareTaskId);
      const linkedSoftwareId = linkedSoftwareTask?.softwareTaskId || linkedSoftwareTask?.execution?.softwareTaskId;
      const followups = goals.filter(item => item.parentGoalId === goal.id);
      return <article key={goal.id} ref={node => {if (node) goalNodes.current.set(goal.id, node); else goalNodes.current.delete(goal.id);}} tabIndex={-1} data-goal-id={goal.id} aria-current={goalSelection?.id === goal.id ? 'true' : undefined} className={'goal-record' + (goalSelection?.id === goal.id ? ' is-selected' : '')}>
        <h3>{goal.documentEdit ? 'Edit: ' + (goal.documentEditState?.preserved.title || 'Research brief') : goal.brief ? goal.brief.title : longRequest ? goal.request.slice(0, 180).trimEnd() + '…' : goal.request}</h3>
        <p className="goal-state">{goalLabels[goal.status]} · {goal.phase.replaceAll('_', ' ')}</p>
        <p>{goal.message}</p>
        <small>Updated {new Date(goal.updated).toLocaleString()}</small>
        {goal.tasks.length > 0 && <p>{accepted} of {goal.tasks.length} milestones accepted</p>}
        {latest && <p className="goal-current-role">{roleLabels[latest.role]} · {latest.detail === goal.message ? latest.phase.replaceAll('_', ' ') : latest.detail}</p>}
        {goal.parentGoalId && <div className="goal-question-link"><small>{goal.documentEdit ? 'A proposed edit of the parent’s saved brief. The original files, notes and research are preserved.' : goal.brief ? 'Research brief from the parent’s complete accepted answer and checked source copies. The parent is unchanged.' : 'New question from the parent’s saved source copies. Its answer is separate.'}</small><button type="button" onClick={() => void openQuestion(goal.parentGoalId!)}>{goal.documentEdit ? 'Open original brief goal' : 'Open parent question'}</button></div>}
        {followups.length > 0 && <details className="goal-question-links"><summary>{followups.length} linked {followups.length === 1 ? 'goal' : 'goals'}</summary>{followups.map(child => <button key={child.id} type="button" onClick={() => void openQuestion(child.id)}>{child.documentEdit ? 'Open brief edit: ' + (child.request.length > 100 ? child.request.slice(0, 100).trimEnd() + '…' : child.request) : child.brief ? 'Open research brief: ' + child.brief.title : 'Open follow-up question: ' + (child.request.length > 100 ? child.request.slice(0, 100).trimEnd() + '…' : child.request)}</button>)}</details>}
        {linkedSoftwareId && <div className="goal-child-link">
          <small>Software build for milestone {goal.tasks.indexOf(linkedSoftwareTask!) + 1}</small>
          <button onClick={() => onOpenSoftware(linkedSoftwareId)}>Open software build</button>
        </div>}
        {(goal.brief || goal.documentEdit) && (running || (canResume && !awaitingEditApproval)) && <div className="goal-brief-controls">
          {running && <button disabled={!!busy} onClick={() => void act(goal, 'stop')}>Stop goal</button>}
          {canResume && <button disabled={!!busy} onClick={() => void act(goal, 'resume')}>Continue remaining work</button>}
          <small>{goal.documentEdit ? 'The requested change and any saved proposal are kept. Continue finishes unfinished checks; it never approves or reapplies an edit. Apply requires your explicit review below.' : 'The title, notes and accepted research are saved. Continue reuses saved writing and document evidence. For changed requirements, create another brief from the original question.'}</small>
        </div>}
        <ResearchBrief goal={goal} onOpenDocument={onOpenDocument} onCreated={child => {received(child); setGoalSelection({id: child.id, key: ++selectionSequence.current});}}/>
        <GoalSources goal={goal} onAskAnother={goal.brief ? undefined : stageSourceQuestion} message={sourceMessages[goal.id]}/>
        {!goal.brief && !goal.documentEdit && (canResume || !!notes[goal.id]) && <form onSubmit={event => {event.preventDefault(); if (canResume) void act(goal, 'resume');}}>
          {!goal.brief && <label>Guidance for continuing{goal.sourceQuestion ? ' (up to 500 characters)' : ''}<textarea aria-label="Guidance for continuing" value={notes[goal.id] || ''} onChange={event => writeNote(goal.id, event.target.value)} maxLength={goal.sourceQuestion ? 500 : 2000} placeholder="Clarify missing information or explain what to try next."/></label>}
          <small>{goal.brief ? 'The saved title, notes and accepted research stay unchanged. Continue reuses any saved writing and document; it does not refetch sources or repeat accepted work. Create another brief from the original question for changed requirements.' : goal.sourceQuestion ? 'Verified source acquisitions are kept. Changed guidance on an unfinished question can regenerate its read-only answer. Reading plan history shows saved plans and the latest archived answer for each plan; completed questions stay unchanged.' : 'Accepted milestones are kept. Only unfinished work is retried; review any saved changes before continuing.'}</small>
          {!canResume && <small>Your newer guidance draft is kept. You can send it when this goal needs attention or is stopped.</small>}
          <button type="submit" disabled={!!busy || !canResume}>Continue remaining work</button>
        </form>}
        {longRequest && <details className="goal-full-request"><summary>Full goal</summary><p>{goal.request}</p></details>}
        <ol className="goal-milestones">{goal.tasks.map((task, index) => {
          const softwareTaskId = task.softwareTaskId || task.execution?.softwareTaskId;
          const longDescription = task.description.length > 160;
          return <li key={task.id}>
          <strong>{index + 1}. {longDescription ? task.description.slice(0, 160).trimEnd() + '…' : task.description}</strong>
          <p>{taskLabels[task.status]} · {task.specialist.replaceAll('_', ' ')}</p>
          {task.dependsOn.length > 0 && <small>After {task.dependsOn.map(id => {
            const dependency = goal.tasks.findIndex(item => item.id === id);
            return dependency >= 0 ? 'milestone ' + (dependency + 1) : id;
          }).join(', ')}</small>}
          {task.retryReason && <p className="goal-input-needed">{{
            acceptance_rejected: 'The acceptance review needs more work. Use the guidance below to continue this milestone.',
            execution_unverified: 'Execution has not produced verified evidence. Review the result before continuing.',
            interrupted: 'This milestone was interrupted. Inspect saved changes before continuing.'
          }[task.retryReason]}</p>}
          {softwareTaskId && task.id !== linkedSoftwareTask?.id && <div className="goal-child-link">
            <small>Software build for this milestone</small>
            <button onClick={() => onOpenSoftware(softwareTaskId)}>Open software build</button>
          </div>}
          <details><summary>Acceptance and evidence</summary>
            {longDescription && <p>{task.description}</p>}
            <p>{task.acceptance}</p>
            {task.execution && <>
              <p>{task.execution.message}</p>
              <small>{task.execution.verified ? 'Host execution checks passed.' : 'Host execution checks are not satisfied.'}</small>
              {task.execution.evidence.length > 0 && <ul>{task.execution.evidence.map((evidence, i) => <li key={i}>{evidence}</li>)}</ul>}
            </>}
            {task.review && <p>{task.review.accepted ? 'Reviewer accepted this milestone: ' : 'Reviewer needs more work: '}{task.review.reason}</p>}
          </details>
        </li>;
        })}</ol>
        <ActivityHistory streamId={'goal:'+goal.id} title="Orchestrator history" loadPage={(before, signal) => goalApi('/'+encodeURIComponent(goal.id)+'/activity?limit=25'+(before?'&before='+encodeURIComponent(before):''), undefined, signal) as Promise<ActivityPage>}/>
        <div className="goal-actions">
          <button onClick={() => onOpenProject(goal.projectId)}>Open website</button>
          {goal.documentId && <button onClick={() => onOpenDocument(goal.documentId!)}>Open PDF</button>}
          {running && !goal.brief && !goal.documentEdit && <button disabled={!!busy} onClick={() => void act(goal, 'stop')}>Stop goal</button>}
        </div>
      </article>;
    })}
  </section>;
}
