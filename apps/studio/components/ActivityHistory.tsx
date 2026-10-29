'use client';
import {memo, useEffect, useMemo, useRef, useState} from 'react';
import type {ActivityPage} from '../core/activity-journal';

type Entry = ActivityPage['events'][number];
type RequestKind = 'initial' | 'older' | 'refresh';
type Attempt = {kind: RequestKind; before?: string};
type Snapshot = ActivityPage & {initialized: boolean; message?: string; error?: {message: string; attempt: Attempt}};
export type ActivityLoader = (before: string | undefined, signal: AbortSignal) => Promise<ActivityPage>;
type Props = {streamId: string; title?: string; loadPage: ActivityLoader};
const roles: Record<string, string> = {planner: 'Planner', executor: 'Specialist executor', reviewer: 'Acceptance reviewer', coordinator: 'Coordinator', software: 'Software builder'};

function checkedPage(page: ActivityPage, before?: string): ActivityPage {
  if (!page || !Array.isArray(page.events) || typeof page.importedHistory !== 'boolean' || typeof page.earlierHistoryMayBeMissing !== 'boolean') throw new Error('The activity response is invalid.');
  for (const entry of page.events) {
    if (!entry || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1 || !Number.isFinite(entry.time) || Number.isNaN(new Date(entry.time).getTime()) || typeof entry.role !== 'string' || typeof entry.phase !== 'string' || entry.detail !== undefined && typeof entry.detail !== 'string' || entry.taskId !== undefined && typeof entry.taskId !== 'string' || entry.revision !== undefined && (!Number.isSafeInteger(entry.revision) || entry.revision < 0)) throw new Error('A saved activity entry is invalid.');
  }
  if (page.nextCursor !== undefined) {
    if (typeof page.nextCursor !== 'string' || !/^[1-9][0-9]*$/.test(page.nextCursor) || !Number.isSafeInteger(Number(page.nextCursor)) || !page.events.length) throw new Error('The activity cursor is invalid.');
    if (before !== undefined && BigInt(page.nextCursor) >= BigInt(before)) throw new Error('The earlier-activity cursor did not advance.');
  }
  return page;
}

function mergedEntries(current: Entry[], incoming: Entry[]) {
  const entries = new Map(incoming.map(entry => [entry.sequence, entry]));
  for (const entry of current) entries.set(entry.sequence, entry);
  return [...entries.values()].sort((a, b) => b.sequence - a.sequence);
}

/** Updating parent cards can provide a fresh loader without resetting the reader's snapshot. */
export function ActivityHistory({streamId, title = 'Activity history', loadPage}: Props) {
  const loader = useRef(loadPage); loader.current = loadPage;
  return <ActivityStream key={streamId} streamId={streamId} title={title} loader={loader}/>;
}

const ActivityStream = memo(function ActivityStream({streamId, title, loader}: {streamId: string; title: string; loader: {current: ActivityLoader}}) {
  const details = useRef<HTMLDetailsElement>(null), scroll = useRef<HTMLDivElement>(null);
  const mounted = useRef(false), generation = useRef(0), active = useRef<AbortController | undefined>(undefined);
  const saved = useRef<Snapshot>({events: [], importedHistory: false, earlierHistoryMayBeMissing: false, initialized: false});
  const [snapshot, setSnapshot] = useState(saved.current), [loading, setLoading] = useState<RequestKind>();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'medium'}), []);

  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false; generation.current++; active.current?.abort(); active.current = undefined;};
  }, []);

  function commit(value: Snapshot) {saved.current = value; setSnapshot(value);}
  async function request(attempt: Attempt) {
    if (!mounted.current || !details.current?.open || active.current) return;
    const controller = new AbortController(), ticket = ++generation.current;
    active.current = controller;
    setLoading(attempt.kind);
    commit({...saved.current, error: undefined, message: undefined});
    const current = () => mounted.current && details.current?.open && active.current === controller && generation.current === ticket && !controller.signal.aborted;
    try {
      const response = await loader.current(attempt.before, controller.signal);
      if (!current()) return;
      const page = checkedPage(response, attempt.before), previous = saved.current;
      const events = mergedEntries(attempt.kind === 'older' ? previous.events : [], page.events);
      const added = events.length - previous.events.length;
      commit({
        events, nextCursor: page.nextCursor, initialized: true,
        importedHistory: page.importedHistory || attempt.kind === 'older' && previous.importedHistory,
        earlierHistoryMayBeMissing: page.earlierHistoryMayBeMissing || attempt.kind === 'older' && previous.earlierHistoryMayBeMissing,
        message: attempt.kind === 'refresh' ? 'Showing the latest saved activity.' : attempt.kind === 'older' ? added > 0 ? `${added} earlier activity entries loaded.` : 'No additional earlier activity was returned.' : undefined
      });
      if (attempt.kind === 'refresh' && scroll.current) scroll.current.scrollTop = 0;
    } catch (error) {
      if (!current()) return;
      const label = attempt.kind === 'older' ? 'earlier activity' : attempt.kind === 'refresh' ? 'the activity refresh' : 'activity history';
      commit({...saved.current, error: {message: `Could not load ${label}: ${error instanceof Error ? error.message : String(error)}`, attempt}});
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        if (mounted.current && details.current?.open) setLoading(undefined);
      }
    }
  }
  function toggle(open: boolean) {
    if (!open) {generation.current++; active.current?.abort(); active.current = undefined; setLoading(undefined);}
    else if (!saved.current.initialized) void request({kind: 'initial'});
  }

  const rows = useMemo(() => snapshot.events.map(entry => <li key={entry.sequence} data-activity-sequence={entry.sequence}>
    <div className="activity-entry-heading"><time dateTime={new Date(entry.time).toISOString()}>{dateFormat.format(entry.time)}</time><span>{roles[entry.role] || entry.role.replaceAll('_', ' ')} · {entry.phase.replaceAll('_', ' ')}</span></div>
    {(entry.taskId !== undefined || entry.revision !== undefined) && <small>{[entry.taskId !== undefined ? `Milestone ${entry.taskId}` : '', entry.revision !== undefined ? `Revision ${entry.revision}` : ''].filter(Boolean).join(' · ')}</small>}
    {entry.detail && <p>{entry.detail}</p>}
  </li>), [snapshot.events, dateFormat]);
  const pendingText = loading === 'older' ? 'Loading earlier activity…' : loading === 'refresh' ? 'Refreshing activity…' : loading ? 'Loading activity…' : undefined;

  return <details ref={details} className="activity-history" data-activity-stream={streamId} onToggle={event => toggle(event.currentTarget.open)}>
    <summary>{title}</summary>
    <div className="activity-history-body" aria-busy={loading !== undefined}>
      <p className={`activity-history-status${snapshot.error ? ' activity-history-error' : ''}`} role="status">{snapshot.error?.message || pendingText || snapshot.message}</p>
      {snapshot.events.length > 0 && <p className="activity-history-count">{snapshot.events.length} saved activity entries shown, newest first.</p>}
      {snapshot.initialized && snapshot.importedHistory && <p className="activity-history-note">Earlier saved activity was imported into this timeline.</p>}
      {snapshot.initialized && snapshot.earlierHistoryMayBeMissing && <p className="activity-history-note">Older events may already be missing from the saved history.</p>}
      {snapshot.events.length > 0 && <div ref={scroll} className="activity-history-entries" tabIndex={0} role="region" aria-label={`${title} entries`}><ol role="list">{rows}</ol></div>}
      {snapshot.initialized && !snapshot.events.length && <p>No saved activity yet.</p>}
      <div className="activity-history-actions">
        {snapshot.error && <button type="button" disabled={loading !== undefined} onClick={() => void request(snapshot.error!.attempt)}>Retry activity</button>}
        {snapshot.nextCursor !== undefined && <button type="button" disabled={loading !== undefined} onClick={() => void request({kind: 'older', before: snapshot.nextCursor})}>Show earlier activity</button>}
        <button type="button" disabled={loading !== undefined} onClick={() => void request({kind: 'refresh'})}>Refresh activity</button>
      </div>
    </div>
  </details>;
});
