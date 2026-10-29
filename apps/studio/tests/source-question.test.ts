import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GoalOrchestrator, type GoalRecord} from '../core/goal-orchestrator';
import {PublicSourceLedger, describePublicSource, readPublicSource, publicSourceUrl, sourceHash} from '../core/public-source';
import {executeSourceQuestion, reviewSourceAcquisition} from '../core/source-question';
import type {Infer} from '../core/model';

const url = 'https://raw.githubusercontent.com/whatwg/fetch/main/README.md';
const question = 'Which standard does this repository host?\nUse the supplied evidence.';
const content = 'This repository hosts the Fetch Standard.\n' + 'More saved text. '.repeat(160);
const page = () => describePublicSource(url, {url, type: 'text/plain', bytes: new TextEncoder().encode(content)});
const accept: Infer = async (_system, _packet, schema) => (schema.properties as Record<string, unknown>)?.citations !== undefined
  ? {response: 'The repository hosts the Fetch Standard.', citations: [{id: 'source-1', quote: 'This repository hosts the Fetch Standard.'}], uncertainty: 'Only the selected excerpt supports this answer.'}
  : {accepted: true, reason: 'The recorded source quotes and saved question satisfy the bounded acceptance criterion.'};
const noModel: Infer = async () => {throw new Error('Local AI is unavailable (test fixture).');};
const tick = () => new Promise(resolve => setTimeout(resolve, 3));
async function waitFor(queue: GoalOrchestrator, id: string, check: (goal: GoalRecord) => boolean) {
  for (let count = 0; count < 1000; count++) {const goal = queue.get(id); if (check(goal)) return goal; await tick();}
  throw new Error('Goal state timed out: ' + JSON.stringify(queue.get(id)));
}
function host(db: Database, sources: PublicSourceLedger, infer: Infer = accept) {
  return new GoalOrchestrator(db, {infer,
    execute: (task, goal, signal, progress) => executeSourceQuestion(sources, task, goal, signal, infer, progress),
    reviewSource: (task, goal, execution, signal) => reviewSourceAcquisition(sources, task, goal, execution, signal)});
}
const input = {request: question, projectId: 'private-project-not-sent', research: true, sourceQuestion: {urls: [url]}};

test('source acquisition persists full plaintext and immutable identities across database reopen; view/retry never refetch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'source-question-')), path = join(dir, 'ledger.sqlite');
  let db = new Database(path), calls = 0;
  try {
    let ledger = new PublicSourceLedger(db, async () => {calls++; return page();});
    const snapshot = await ledger.capture('goal', 'source-1', url, new AbortController().signal, () => {});
    expect(snapshot.bytes).toBe(new TextEncoder().encode(content).length);
    expect(snapshot.sha256).toBe(sourceHash(new TextEncoder().encode(content)));
    expect(snapshot.textSha256).toBe(sourceHash(content));
    expect(ledger.page('goal', snapshot.id, 1000).text).toBe(content.slice(1000, 2000));
    expect(() => ledger.get('other-goal', snapshot.id)).toThrow('not found');
    db.close(); db = new Database(path);
    ledger = new PublicSourceLedger(db, async () => {calls++; return page();});
    expect(await ledger.capture('goal', 'source-1', url, new AbortController().signal, () => {})).toEqual(snapshot);
    expect(calls).toBe(1);
    expect(ledger.get('goal', snapshot.id).text).toBe(content);
    await expect(ledger.capture('goal', 'source-1', url.replace('README', 'OTHER'), new AbortController().signal, () => {})).rejects.toThrow('different source');
    db.query('UPDATE goal_sources SET text=? WHERE id=?').run('corrupted', snapshot.id);
    expect(() => ledger.get('goal', snapshot.id)).toThrow('identity check');
  } finally {db.close(); rmSync(dir, {recursive: true, force: true});}
});

test('host-seeded source reading succeeds before missing inference and explicit continuation preserves accepted acquisition', async () => {
  const db = new Database(':memory:'); let reads = 0;
  const sources = new PublicSourceLedger(db, async () => {reads++; return page();}), queue = host(db, sources, noModel);
  try {
    const created = queue.create(input); queue.start();
    let goal = await waitFor(queue, created.id, item => item.status === 'needs_input');
    expect(goal.request).toBe(question);
    expect(goal.tasks.map(task => task.status)).toEqual(['verified', 'needs_input']);
    expect(goal.tasks[0].review?.reason).toContain('acquisition only');
    expect(goal.tasks[1].execution).toBeUndefined();
    expect(goal.events.some(event => event.phase === 'source_saved')).toBe(true);
    expect(goal.events.some(event => event.phase === 'answering_sources')).toBe(true);
    const snapshot = sources.list(goal.id)[0];
    await tick(); queue.resume(goal.id);
    goal = await waitFor(queue, goal.id, item => item.status === 'needs_input');
    expect(reads).toBe(1); expect(goal.tasks[0].attempts).toBe(1);
    expect(goal.tasks[1].attempts).toBe(2);
    expect(sources.list(goal.id)[0]).toEqual(snapshot);
    expect(goal.status).not.toBe('completed');
  } finally {queue.shutdown(); await tick(); db.close();}
});

test('scripted inference host-flow completes with exact citation offsets/hash and separate answer/coverage review', async () => {
  const db = new Database(':memory:'), roles: string[] = [];
  const sources = new PublicSourceLedger(db, async () => page());
  const generate: Infer = async (...args) => {roles.push(args[0]); return accept(...args);};
  const queue = host(db, sources, generate);
  try {
    const created = queue.create(input); queue.start();
    const goal = await waitFor(queue, created.id, item => item.status === 'completed');
    const answer = goal.tasks[1].execution!.sourceAnswer!, snapshot = sources.list(goal.id)[0];
    expect(answer.citations[0]).toEqual({sourceId: snapshot.id, label: 'source-1', quote: 'This repository hosts the Fetch Standard.', offset: 0, textSha256: snapshot.textSha256});
    expect(answer.selections).toEqual([{sourceId: snapshot.id, label: 'source-1', start: 0, end: 800, textSha256: snapshot.textSha256}]);
    expect(roles.some(role => role.startsWith('Goal planning'))).toBe(false);
    expect(roles.filter(role => role.startsWith('Independent milestone'))).toHaveLength(1);
    expect(roles.some(role => role.startsWith('Independent goal coverage'))).toBe(true);
    expect(goal.message).toContain('not independently verified');
  } finally {queue.shutdown(); await tick(); db.close();}
});

test('a fabricated quote blocks the answer while accepted source evidence stays intact', async () => {
  const db = new Database(':memory:'), sources = new PublicSourceLedger(db, async () => page());
  const generate: Infer = async () => ({response: 'Invented answer.', citations: [{id: 'source-1', quote: 'This sentence does not exist in the source.'}], uncertainty: ''});
  const queue = host(db, sources, generate);
  try {
    const created = queue.create(input); queue.start();
    const goal = await waitFor(queue, created.id, item => item.status === 'needs_input');
    expect(goal.message).toContain('quote the selected source exactly');
    expect(goal.tasks[0].status).toBe('verified'); expect(goal.tasks[1].execution).toBeUndefined();
    expect(sources.list(goal.id)).toHaveLength(1);
  } finally {queue.shutdown(); await tick(); db.close();}
});

test('stop during a pending acquisition discards a late response and cannot complete or auto-replay', async () => {
  const db = new Database(':memory:'); let finish!: () => void, started = false, calls = 0;
  const sources = new PublicSourceLedger(db, async () => {calls++; started = true; await new Promise<void>(resolve => {finish = resolve;}); return page();});
  const queue = host(db, sources);
  try {
    const created = queue.create(input); queue.start();
    await waitFor(queue, created.id, () => started); queue.stop(created.id); finish(); await tick(); await tick();
    expect(queue.get(created.id).status).toBe('cancelled');
    expect(sources.list(created.id)).toHaveLength(0); expect(calls).toBe(1);
    expect(queue.get(created.id).tasks[0].execution).toBeUndefined();
  } finally {queue.shutdown(); await tick(); db.close();}
});

test('restart between saved acquisition and execution return requires explicit Continue and reuses snapshot', async () => {
  const db = new Database(':memory:'); let calls = 0;
  const sources = new PublicSourceLedger(db, async () => {calls++; return page();});
  const queue = host(db, sources, noModel);
  try {
    const goal = queue.create(input);
    const saved = await sources.capture(goal.id, 'source-1', url, new AbortController().signal, () => {});
    goal.status = 'running'; goal.tasks[0].status = 'running'; goal.tasks[0].attempts = 1;
    db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(goal), goal.id);
    queue.start(); await tick();
    expect(queue.get(goal.id).status).toBe('needs_input'); expect(calls).toBe(1);
    expect(queue.get(goal.id).tasks[0].execution).toBeUndefined();
    queue.resume(goal.id);
    const paused = await waitFor(queue, goal.id, item => item.status === 'needs_input' && item.tasks[0].status === 'verified');
    expect(paused.events.some(event => event.phase === 'source_reused')).toBe(true);
    expect(sources.list(goal.id)[0]).toEqual(saved); expect(calls).toBe(1);
  } finally {queue.shutdown(); await tick(); db.close();}
});

test('source mode rejects missing research permission, private/credential URLs, duplicate URLs, PDF and oversized exact questions', () => {
  const db = new Database(':memory:'), queue = host(db, new PublicSourceLedger(db));
  try {
    expect(() => queue.create({...input, research: false})).toThrow('Enable public');
    expect(() => queue.create({...input, documentId: 'private-pdf'})).toThrow('public sources only');
    expect(() => queue.create({...input, request: 'x'.repeat(1001)})).toThrow('1,000');
    expect(() => queue.create({...input, sourceQuestion: {urls: [url, url]}})).toThrow('distinct');
    for (const raw of ['http://example.com', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://10.0.0.2/', 'https://user:pass@raw.githubusercontent.com/a', 'https://raw.githubusercontent.com/a?token=secret']) expect(() => publicSourceUrl(raw)).toThrow();
    const goal = queue.create(input);
    expect(() => queue.resume(goal.id, 'x'.repeat(501))).toThrow('500');
  } finally {db.close();}
});

test('fixed publisher fetch sends only a public URL and bounded headers, refuses redirects/types/oversize, preserves plain code', async () => {
  const previous = globalThis.fetch, calls: {url: string; init: RequestInit}[] = [];
  let response = () => new Response('Plain <code> remains exact.', {headers: {'content-type': 'text/plain'}});
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {calls.push({url: String(input), init: init!}); return response();}) as typeof fetch;
  try {
    const result = await readPublicSource(url);
    expect(result.text).toBe('Plain <code> remains exact.');
    expect(calls[0].url).toBe(url); expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.redirect).toBe('manual');
    expect(Object.keys(calls[0].init.headers!)).toEqual(['User-Agent', 'Accept']);
    expect(calls[0].init.body).toBeUndefined();
    response = () => new Response(null, {status: 302, headers: {Location: 'https://127.0.0.1/private'}});
    await expect(readPublicSource(url)).rejects.toThrow('redirect'); expect(calls).toHaveLength(2);
    response = () => new Response('binary', {headers: {'content-type': 'application/octet-stream'}});
    await expect(readPublicSource(url)).rejects.toThrow('plain-text');
    response = () => new Response('x'.repeat(500001), {headers: {'content-type': 'text/plain'}});
    await expect(readPublicSource(url)).rejects.toThrow('too large');
    const control = new AbortController(); control.abort();
    await expect(readPublicSource(url, control.signal)).rejects.toThrow(); expect(calls).toHaveLength(4);
  } finally {globalThis.fetch = previous;}
});

test('plain source title uses its top-level heading or filename, not an unrelated subsection', () => {
  const describe = (text: string) => describePublicSource(url, {url, type: 'text/plain', bytes: new TextEncoder().encode(text)});
  expect(describe('Introduction.\n\n## Code of conduct\nBody').title).toBe('README.md');
  expect(describe('# Fetch Standard\n\n## Subsection').title).toBe('Fetch Standard');
});
