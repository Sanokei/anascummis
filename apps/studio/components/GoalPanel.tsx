'use client';
import {useEffect, useRef, useState} from 'react';
import type {GoalRecord} from '../core/goal-orchestrator';
import type {ActivityPage} from '../core/activity-journal';
import {ActivityHistory} from './ActivityHistory';
import {GoalSources} from './GoalSources';

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
  const requestDraft = useRef({text: '', sourceMode: false, sourceUrls: ''}), noteDrafts = useRef<Record<string, {text: string}>>({});
  const busyRef = useRef<string | undefined>(undefined), mutationEpoch = useRef(0);

  useEffect(() => {setIncludeDocument(!!documentId);}, [documentId]);
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
    setGoals(current => [goal, ...current.filter(item => item.id !== goal.id)]);
  }
  function writeRequest(text: string) {
    requestDraft.current = {...requestDraft.current, text}; setRequest(text);
    if (text.length) setNewGoalOpen(true);
  }
  function writeNote(id: string, text: string) {
    noteDrafts.current[id] = {text}; setNotes(current => ({...current, [id]: text}));
  }
  async function start() {
    const submitted = requestDraft.current;
    if (!projectId || !submitted.text.trim() || busyRef.current) return;
    busyRef.current = 'new'; mutationEpoch.current++;
    setBusy('new');
    try {
      const goal = await goalApi('', {
        request: submitted.text, project: projectId,
        ...(!submitted.sourceMode && includeDocument && documentId ? {document: documentId} : {}), research,
        ...(submitted.sourceMode ? {sourceQuestion: {urls: submitted.sourceUrls.split('\n').map(url => url.trim()).filter(Boolean)}} : {})
      }) as GoalRecord;
      received(goal);
      if (requestDraft.current === submitted) {writeRequest(''); setSourceUrls(''); requestDraft.current = {...requestDraft.current, sourceUrls: ''}; setNewGoalOpen(false);}
      else setNewGoalOpen(true);
      setMessage(submitted.sourceMode ? 'The exact question and source steps are saved. Acquisition, answer and acceptance progress will appear here.' : 'The full goal is saved. Planning, specialist work and acceptance reviews will appear here.');
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

  const newGoalForm = <form onSubmit={event => {event.preventDefault(); void start();}}>
      <label className="goal-option"><input type="checkbox" checked={sourceMode} onChange={event => {const enabled = event.target.checked; requestDraft.current = {...requestDraft.current, sourceMode: enabled}; setSourceMode(enabled);}}/>Question from public sources</label>
      <label>{sourceMode ? 'Exact question (up to 1,000 characters)' : 'Goal'}<textarea aria-label={sourceMode ? 'Exact question' : 'Goal'} value={request} onChange={event => writeRequest(event.target.value)} maxLength={sourceMode ? Math.max(1000, request.length) : 8000} placeholder={sourceMode ? 'Ask a focused question the supplied source excerpts can answer.' : 'Describe the result you want and what must be true when it is finished.'}/></label>
      {sourceMode && <><label>Public HTTPS sources (one per line, up to two)<textarea aria-label="Public source URLs" value={sourceUrls} maxLength={4001} onChange={event => {const text = event.target.value; requestDraft.current = {...requestDraft.current, sourceUrls: text}; setSourceUrls(text);}} placeholder="https://raw.githubusercontent.com/owner/repository/commit/README.md"/></label><small>The first 800 text positions per source are selected for the answer. Full bounded copies and content hashes stay inspectable. No search key is needed. A local model is required to answer.</small>{request.length > 1000 && <p role="status">Shorten this question to 1,000 characters. Your full draft is kept.</p>}</>}
      {documentId && !sourceMode && <label className="goal-option"><input type="checkbox" checked={includeDocument} onChange={event => {requestDraft.current = {...requestDraft.current}; setIncludeDocument(event.target.checked);}}/>Include the open PDF{documentName ? ': ' + documentName : ''}</label>}
      <label className="goal-option"><input type="checkbox" checked={research} onChange={event => {requestDraft.current = {...requestDraft.current}; setResearch(event.target.checked);}}/>Allow public web research for this goal</label>
      <button type="submit" disabled={!projectId || !request.trim() || !!busy || (sourceMode && (!research || !sourceUrls.trim() || request.length > 1000))}>{busy === 'new' ? 'Saving goal…' : sourceMode ? 'Save question and read sources' : 'Start coordinated work'}</button>
      {!projectId && <small>Preparing the current website workspace…</small>}
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
      const latest = goal.events.at(-1);
      const longRequest = goal.request.length > 180;
      const linkedSoftwareTask = goal.tasks.find(task => ['running', 'needs_input'].includes(task.status) && (task.softwareTaskId || task.execution?.softwareTaskId)) || goal.tasks.find(task => task.softwareTaskId || task.execution?.softwareTaskId);
      const linkedSoftwareId = linkedSoftwareTask?.softwareTaskId || linkedSoftwareTask?.execution?.softwareTaskId;
      return <article key={goal.id} className="goal-record">
        <h3>{longRequest ? goal.request.slice(0, 180).trimEnd() + '…' : goal.request}</h3>
        <p className="goal-state">{goalLabels[goal.status]} · {goal.phase.replaceAll('_', ' ')}</p>
        <p>{goal.message}</p>
        <small>Updated {new Date(goal.updated).toLocaleString()}</small>
        {goal.tasks.length > 0 && <p>{accepted} of {goal.tasks.length} milestones accepted</p>}
        {latest && <p className="goal-current-role">{roleLabels[latest.role]} · {latest.detail === goal.message ? latest.phase.replaceAll('_', ' ') : latest.detail}</p>}
        {linkedSoftwareId && <div className="goal-child-link">
          <small>Software build for milestone {goal.tasks.indexOf(linkedSoftwareTask!) + 1}</small>
          <button onClick={() => onOpenSoftware(linkedSoftwareId)}>Open software build</button>
        </div>}
        <GoalSources goal={goal}/>
        {(canResume || !!notes[goal.id]) && <form onSubmit={event => {event.preventDefault(); if (canResume) void act(goal, 'resume');}}>
          <label>Guidance for continuing{goal.sourceQuestion ? ' (up to 500 characters)' : ''}<textarea aria-label="Guidance for continuing" value={notes[goal.id] || ''} onChange={event => writeNote(goal.id, event.target.value)} maxLength={goal.sourceQuestion ? 500 : 2000} placeholder="Clarify missing information or explain what to try next."/></label>
          <small>Accepted milestones are kept. Only unfinished work is retried; review any saved changes before continuing.</small>
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
          {running && <button disabled={!!busy} onClick={() => void act(goal, 'stop')}>Stop goal</button>}
        </div>
      </article>;
    })}
  </section>;
}
