'use client';
import {useEffect, useRef, useState} from 'react';
import type {WorkPage, WorkRecord} from '../core/work-journal';
import type {ActivityPage} from '../core/activity-journal';
import {ActivityHistory} from './ActivityHistory';

const labels = {running: 'Working', complete: 'Done', failed: 'Needs attention', cancelled: 'Stopped', interrupted: 'Interrupted'};
function mergeHistory(current: WorkRecord[], incoming: WorkRecord[], active: WorkRecord[]) {
  const records = new Map([...current, ...incoming].map(record => [record.id, record]));
  for (const record of active) records.delete(record.id);
  return [...records.values()].sort((a, b) => b.updated - a.updated || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function WorkPanel({onOpenProject, onOpenDocument}: {onOpenProject: (id: string) => void; onOpenDocument: (id: string) => void}) {
  const [active, setActive] = useState<WorkRecord[]>([]), [history, setHistory] = useState<WorkRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string>(), [message, setMessage] = useState(''), [loading, setLoading] = useState(false);
  const olderLoaded = useRef(false);
  useEffect(() => {
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/jobs', {signal: control.signal, cache: 'no-store'});
        if (!response.ok) throw new Error('Work history is unavailable.');
        const page: WorkPage = await response.json();
        if (control.signal.aborted) return;
        setActive(page.active);
        setHistory(current => mergeHistory(current, page.history, page.active));
        if (!olderLoaded.current) setNextCursor(page.nextCursor);
        setMessage('');
      } catch (error) {
        if (!control.signal.aborted) setMessage(String(error));
      } finally {
        if (!control.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {control.abort(); clearTimeout(timer);};
  }, []);

  async function stop(id: string) {
    try {
      const response = await fetch('/api/jobs/' + id + '/stop', {
        method: 'POST', headers: {'X-Requested-With': 'Anascummis'}
      });
      if (!response.ok) throw new Error('Could not stop this task.');
      setMessage('Task stopped. Its progress and saved changes are kept.');
    } catch (error) {setMessage(String(error));}
  }
  async function older() {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const response = await fetch('/api/jobs?before=' + encodeURIComponent(nextCursor), {cache: 'no-store'});
      if (!response.ok) throw new Error('Older work is unavailable.');
      const page: WorkPage = await response.json();
      olderLoaded.current = true;
      setHistory(current => mergeHistory(current, page.history, page.active));
      setNextCursor(page.nextCursor);
    } catch (error) {setMessage(String(error));}
    finally {setLoading(false);}
  }

  return <section className="work-journal background-tasks" aria-label="Work history">
    <p>Local tasks keep working when this window or page is closed. Progress is saved as they work.</p>
    <p role="status">{message}</p>
    {!active.length && !history.length && <p>No specialist tasks yet.</p>}
    {[...active, ...history].map(task => <article key={task.id}>
      <strong>{task.request}</strong>
      <p>{task.status === 'complete' && task.outcome !== 'finished' ? 'Needs attention' : labels[task.status]}</p>
      {task.status === 'running' && <p>{task.progress.agent} · {task.progress.phase}</p>}
      {(task.error || task.message) && <p>{task.error || task.message}</p>}
      <small>Updated {new Date(task.updated).toLocaleString()}</small>
      {task.specialists?.map(specialist => <p key={specialist.id}>{specialist.agent} · {specialist.status} · {specialist.message}</p>)}
      <ActivityHistory streamId={'work:'+task.id} title="Progress history" loadPage={async (before, signal) => {
        const response = await fetch('/api/jobs/'+encodeURIComponent(task.id)+'/activity?limit=25'+(before?'&before='+encodeURIComponent(before):''), {signal, cache:'no-store', credentials:'same-origin'});
        const page = await response.json();
        if (!response.ok) throw new Error(page.error || 'Work activity is unavailable.');
        return page as ActivityPage;
      }}/>
      <div className="work-actions">
        <button onClick={() => onOpenProject(task.projectId)}>Open website</button>
        {task.documentId && <button onClick={() => onOpenDocument(task.documentId!)}>Open PDF</button>}
        {task.status === 'running' && <button onClick={() => void stop(task.id)}>Stop task</button>}
      </div>
    </article>)}
    {nextCursor && <button disabled={loading} onClick={() => void older()}>{loading ? 'Loading…' : 'Show older work'}</button>}
  </section>;
}
