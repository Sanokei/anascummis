import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ResearchBriefStore, BRIEF_WRITER_ROLE} from '../core/research-brief';
import {ResearchBriefEditStore} from '../core/research-brief-edit';
import {PublicSourceLedger, describePublicSource, sourceHash} from '../core/public-source';
import {GoalOrchestrator, type GoalRecord, type GoalTask, type SourceAnswer} from '../core/goal-orchestrator';
import type {Infer} from '../core/model';

// Host-flow/model fixtures only. The real renderer is exercised in one case;
// genuine local-model decisions and real host interruption have separate UI evidence.
const signal = () => new AbortController().signal, noop = () => {};
const question = 'Where are Fetch tests and browser results?';
const quotes = ['Fetch tests are kept in the fetch/ directory of web-platform-tests/wpt.', 'Browser results are shown at https://wpt.fyi/results/fetch.'];
const originalSummary = 'Fetch tests live in fetch/ under web-platform-tests/wpt, and browser results are at https://wpt.fyi/results/fetch.';
const firstSummary = 'Tests: Fetch tests are kept in the fetch/ directory of web-platform-tests/wpt. Browser results: A dashboard showing the tests running against browser engines can be seen at https://wpt.fyi/results/fetch.';
const secondSummary = 'Newcomers can find Fetch tests in fetch/ under web-platform-tests/wpt and browser results at https://wpt.fyi/results/fetch.';
const secondIntent = 'Shorten the current summary to one sentence for a newcomer; keep both exact locations and citations and do not change notes/evidence.';
const notes = `Personal handoff for my next Fetch test contribution. These are my own proposed actions and working notes, not instructions or verified claims from the source.

Before changing anything, I will record the browser and version, a minimal public example, the outcome I expected and what I actually saw. I will remove cookies, authorization headers, account details and private URLs from anything I share.

1. Reopen this brief and follow its original-source link. Compare the saved retrieval time with the current README. If the evidence changed, ask a new focused question instead of editing the accepted copy.
2. Open the browser-results location from the brief. Write down the engine and platform I inspected. A saved answer is a pointer to evidence, not proof that a bug exists or a test passes.
3. Search the cited test directory for a related case before proposing another test. Keep the candidate filename, my reason for choosing it and any unresolved question in my own draft.
4. Separate reproduction from implementation. First describe a small public fixture and expected behavior; then explain the proposed test and the observation it should distinguish.
5. Read the project's current contribution and review instructions before submitting anything. I have not checked those instructions yet, and this brief does not establish them.
6. Keep a handoff log of what I tried, which evidence I saved and what remains uncertain. After interruption, inspect saved work and continue deliberately rather than repeating accepted research.
7. Preserve the PDF and HTML with their recorded hashes and original citations. Ask for missing guidance instead of guessing. My personal checklist is not a source-backed conclusion.`;

function goal(fields: Partial<GoalRecord> = {}): GoalRecord {
  return {id: crypto.randomUUID(), request: question, projectId: 'fixture-workspace', research: true, status: 'running', phase: 'executing', message: '', tasks: [], created: 1, updated: 1, events: [], planningOffset: question.length, planningDone: true, planningCalls: 0, coverageOffset: 0, coverageDone: false, notes: [], ...fields};
}

async function fixture(real = false, beforeJob?: (job: Record<string, any>) => void | Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'brief-second-edit-'));
  const db = new Database(join(directory, 'state.sqlite'));
  db.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,name TEXT,revision INTEGER,pages INTEGER); CREATE TABLE pdf_versions(doc TEXT,revision INTEGER,label TEXT,PRIMARY KEY(doc,revision)); CREATE TABLE goal_tasks(id TEXT PRIMARY KEY,body TEXT,updated INTEGER);');
  const saveGoal = (value: GoalRecord) => db.query('INSERT INTO goal_tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated=excluded.updated').run(value.id, JSON.stringify(value), value.updated);
  const url = 'https://example.org/fetch-second-edit-fixture', content = quotes.join('\n');
  const ledger = new PublicSourceLedger(db, async requested => describePublicSource(requested, {url: requested, type: 'text/plain', bytes: new TextEncoder().encode(content)}));
  const ancestor = crypto.randomUUID(), original = goal(), source = await ledger.capture(ancestor, 'source-1', url, signal(), noop);
  const copied = db.transaction(() => ledger.copySnapshots(ancestor, original.id, [source.id])[0])(), reading = ledger.prepareReading(original.id, 'source-answer', question).plan;
  const answer: SourceAnswer = {text: originalSummary, uncertainty: '', limit: 'Injected fixture acceptance; source claims are not independently verified.', answerable: true, supportReview: {supported: true, reason: 'Injected source support.'}, readingId: reading.id, citationMethod: 'host-spans-v1', citations: quotes.map((quote, index) => ({sourceId: copied.id, label: 'source-1', quote, offset: content.indexOf(quote), textSha256: copied.textSha256, spanId: 'source-1:' + (index + 1)})), selections: reading.ranges.map(range => ({sourceId: range.sourceId, label: range.label, start: range.start, end: range.end, textSha256: range.textSha256, rangeSha256: range.rangeSha256, text: range.text}))};
  const originalTask: GoalTask = {id: 'source-brief', specialist: 'analysis', sourceBrief: true, description: 'Write fixture brief', acceptance: 'Retain notes and citations', dependsOn: ['source-answer'], status: 'running', attempts: 1};
  Object.assign(original, {parentGoalId: ancestor, sourceQuestion: {urls: [url]}, brief: {parentGoalId: ancestor, requestKey: crypto.randomUUID(), title: 'Fetch newcomer brief', notes}, tasks: [
    {id: 'source-1', specialist: 'research', sourceUrl: url, description: 'Saved fixture source', acceptance: 'Fixture hash', dependsOn: [], status: 'verified', attempts: 0, execution: {verified: true, sourceId: copied.id, message: 'Fixture source', evidence: ['Synthetic public-source bytes.']}, review: {accepted: true, reason: 'Checked saved fixture identity.'}},
    {id: 'source-answer', specialist: 'analysis', sourceAnswer: true, description: 'Accepted fixture answer', acceptance: 'Fixture facts', dependsOn: ['source-1'], status: 'verified', attempts: 0, execution: {verified: true, sourceAnswer: answer, message: originalSummary, evidence: ['Injected answer, not genuine inference.']}, review: {accepted: true, reason: 'Injected acceptance.'}}, originalTask]});
  let renders = 0;
  const engine = async (job: Record<string, any>) => {
    if (beforeJob) await beforeJob(job);
    if (job.op === 'research_brief') renders++;
    if (real) {
      const studio = resolve(import.meta.dir, '..'), python = process.env.PYTHON_PATH || join(studio, '.venv/bin/python');
      return await new Promise<any>((done, reject) => {
        const child = execFile(python, [join(studio, 'worker/pdf_worker.py')], {encoding: 'utf8', maxBuffer: 4_000_000, timeout: 10_000}, (error, stdout, stderr) => {
          if (error) {reject(new Error(stderr || error.message)); return;}
          try {const value = JSON.parse(stdout); if (!value.ok) throw new Error(value.error); done(value.result);} catch (error) {reject(error);}
        });
        child.stdin!.end(JSON.stringify(job));
      });
    }
    if (job.op === 'research_brief') await writeFile(job.output, '%PDF-1.7\nInjected renderer bytes ' + renders + '\n');
    if (job.op === 'inspect') return {pageCount: 2, pages: [{page: 1, text: originalSummary}, {page: 2, text: notes}]};
    return {pageCount: 2, complete: true, contained: true, linksContained: true, links: job.args?.expectedLinks || []};
  };
  const briefs = new ResearchBriefStore(db, ledger, directory, engine);
  const briefExecution = await briefs.execute(originalTask, original, signal(), async role => role === BRIEF_WRITER_ROLE ? {paragraphs: [{text: originalSummary, citations: [1, 2]}]} : {supported: true, reason: 'Injected support.'}, noop);
  Object.assign(originalTask, {status: 'verified', execution: briefExecution, review: {accepted: true, reason: 'Real host fixture artifact verification.'}});
  Object.assign(original, {status: 'completed', phase: 'completed', coverageDone: true, coverageOffset: original.request.length}); saveGoal(original);
  const store = new ResearchBriefEditStore(db, briefs, directory, engine);
  const queue = new GoalOrchestrator(db, {infer: async () => {throw new Error('Fixture queue planner must not infer.');}, execute: (task, value, sig, progress) => store.execute(task, value, sig, makeInfer(firstSummary).infer, progress), reviewDocumentEdit: (task, value, execution, sig) => store.review(task, value, execution, sig)});
  const first = queue.createDocumentEdit(original.id, await store.prepare(original, {requestKey: crypto.randomUUID(), intent: 'Give both facts clear Tests: and Browser results: labels; retain all locations and citations.'}));
  const task = first.tasks.find(item => item.documentEdit)!;
  const firstModel = makeInfer(firstSummary);
  await expect(store.execute(task, first, signal(), firstModel.infer, noop)).rejects.toThrow('proposal is ready');
  first.status = 'needs_input'; saveGoal(first); const proposed = store.state(first.id)!;
  await store.approve(first, {operationId: proposed.operationId, proposalSha256: proposed.proposalSha256!});
  const execution = await store.execute(task, first, signal(), firstModel.infer, noop);
  Object.assign(task, {status: 'verified', execution, review: await store.review(task, first, execution, signal())});
  Object.assign(first, {status: 'completed', phase: 'completed', coverageDone: true, coverageOffset: first.request.length}); saveGoal(first);
  const beforeFiles = {originalPdf: await briefs.exportPdf(original), originalHtml: await briefs.exportHtml(original), firstPdf: await store.export(first, 'pdf'), firstHtml: await store.export(first, 'html'), firstProvenance: await store.export(first, 'provenance-json')};
  const originalBody = JSON.stringify(original), firstBody = JSON.stringify(first);
  const second = async (intent = secondIntent) => queue.createDocumentEdit(first.id, await store.prepare(first, {requestKey: crypto.randomUUID(), intent}));
  const markNeedsInput = (value: GoalRecord) => {value.status = 'needs_input'; saveGoal(value);};
  return {directory, db, ledger, briefs, store, queue, original, first, firstModel, beforeFiles, originalBody, firstBody, saveGoal, second, markNeedsInput, engine, renders: () => renders,
    restart: () => new ResearchBriefEditStore(db, briefs, directory, engine), close: async () => {queue.shutdown(); db.close(); await rm(directory, {recursive: true, force: true});}};
}

function makeInfer(text: string) {
  const calls: {role: string; packet: string; kind: 'write' | 'review'}[] = [];
  const infer: Infer = async (role, packet, schema) => {
    const review = !!(schema.properties as any)?.supported;
    calls.push({role, packet, kind: review ? 'review' : 'write'});
    return review ? {supported: true, reason: 'Injected fixture reviewer; no genuine model-quality claim.'} : (schema.properties as any)?.paragraphs ? {paragraphs: [{text, citations: [1, 2]}]} : {text, citations: [1, 2]};
  };
  return {calls, infer};
}

async function htmlReadingText(html: string) {
  const python = process.env.PYTHON_PATH || resolve(import.meta.dir, '../.venv/bin/python');
  return await new Promise<string>((done, reject) => {
    const child = execFile(python, ['-c', "import sys\nfrom html.parser import HTMLParser\nclass Reader(HTMLParser):\n def __init__(self): super().__init__(convert_charrefs=True); self.parts=[]\n def handle_data(self,text): self.parts.append(text)\n def handle_starttag(self,tag,attrs):\n  if tag=='br': self.parts.append('\\n')\nr=Reader();r.feed(sys.stdin.read());sys.stdout.write(''.join(r.parts))"], {encoding: 'utf8', maxBuffer: 4_000_000, timeout: 5_000}, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : done(stdout));
    child.stdin!.end(html);
  });
}

async function proposeSecond(f: Awaited<ReturnType<typeof fixture>>, value: GoalRecord, model = makeInfer(secondSummary)) {
  const task = value.tasks.find(item => item.documentEdit)!;
  await expect(f.store.execute(task, value, signal(), model.infer, noop)).rejects.toThrow('proposal is ready');
  f.markNeedsInput(value); return {task, model, state: f.store.state(value.id)!};
}

async function applySecond(f: Awaited<ReturnType<typeof fixture>>, value: GoalRecord, model: ReturnType<typeof makeInfer>) {
  const state = f.store.state(value.id)!;
  await f.store.approve(value, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
  return f.store.execute(value.tasks.find(item => item.documentEdit)!, value, signal(), model.infer, noop);
}

async function unchangedEarlier(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await f.briefs.exportPdf(f.original)).bytes).toEqual(f.beforeFiles.originalPdf.bytes);
  expect((await f.briefs.exportHtml(f.original)).bytes).toEqual(f.beforeFiles.originalHtml.bytes);
  expect((await f.store.export(f.first, 'pdf')).bytes).toEqual(f.beforeFiles.firstPdf.bytes);
  expect((await f.store.export(f.first, 'html')).bytes).toEqual(f.beforeFiles.firstHtml.bytes);
  expect((await f.store.export(f.first, 'provenance-json')).bytes).toEqual(f.beforeFiles.firstProvenance.bytes);
  expect((f.db.query('SELECT body FROM goal_tasks WHERE id=?').get(f.original.id) as any).body).toBe(f.originalBody);
  expect((f.db.query('SELECT body FROM goal_tasks WHERE id=?').get(f.first.id) as any).body).toBe(f.firstBody);
}

test('current accepted revision pins the exact base and one approved version 2 preserves all earlier bytes and notes', async () => {
  const f = await fixture(true);
  try {
    expect(notes.length).toBe(1719);
    const second = await f.second(), request = second.documentEdit!;
    expect(request.parentGoalId).toBe(f.first.id); expect(request.baseRevision).toBe(1);
    expect(request.basePdfSha256).toBe(sourceHash(f.beforeFiles.firstPdf.bytes));
    expect(request.originalBriefGoalId).toBe(f.original.id);
    expect(request.baseOperationId).toBe(f.store.state(f.first.id)!.operationId);
    expect(request.baseHtmlSha256).toBe(sourceHash(f.beforeFiles.firstHtml.bytes));
    expect(request.baseProvenanceSha256).toBe(sourceHash(f.beforeFiles.firstProvenance.bytes));
    expect(request.requirements?.oneSentence).toBe(true);
    expect(request.requirements?.shorterThanCharacters).toBe(firstSummary.length);
    expect(request.requirements?.locations).toEqual(expect.arrayContaining(['fetch/', 'web-platform-tests/wpt', 'wpt.fyi/results/fetch']));
    const {task, model, state} = await proposeSecond(f, second);
    expect(state.before.paragraphs[0].text).toBe(firstSummary); expect(state.preserved.notes).toBe(notes);
    expect(state.proposal?.paragraphs[0].text).toBe(secondSummary); expect(state.writingAttempt?.raw).toEqual({text: secondSummary, citations: [1, 2]});
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 1});
    const result = await applySecond(f, second, model);
    expect(result.documentEditArtifact).toMatchObject({operationId: state.operationId, documentId: request.documentId, revision: 2});
    expect((await f.store.review(task, second, result, signal())).accepted).toBe(true);
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2});
    expect(f.db.query('SELECT revision FROM pdf_versions ORDER BY revision').all()).toEqual([{revision: 0}, {revision: 1}, {revision: 2}]);
    const pdf = await f.store.export(second, 'pdf'), html = new TextDecoder().decode((await f.store.export(second, 'html')).bytes);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    const readableHtml = await htmlReadingText(html); expect(readableHtml).toContain(notes); expect(readableHtml.split(notes).length - 1).toBe(1);
    const inspected = await f.engine({op: 'inspect', input: join(f.directory, 'documents', request.documentId, '2.pdf'), args: {pages: Array.from({length: result.documentEditArtifact!.pages}, (_, i) => i + 1)}});
    const compact = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ''), readablePdf = inspected.pages.map((page: any) => page.text).join('\n');
    expect(compact(readablePdf)).toContain(compact(notes)); expect(compact(readablePdf)).toContain(compact(secondSummary));
    expect(html).toContain('web-platform-tests/wpt'); expect(html).toContain('https://wpt.fyi/results/fetch');
    const provenance = JSON.parse(new TextDecoder().decode((await f.store.export(second, 'provenance-json')).bytes));
    expect(provenance.personalNotes).toBe(notes); expect(provenance.citations.map((item: any) => item.quote)).toEqual(quotes);
    expect(model.calls.map(call => call.kind)).toEqual(['write', 'review']);
    await unchangedEarlier(f);
  } finally {await f.close();}
}, 40000);

test('an interrupted second proposal and rendered checkpoint reuse the raw decision and files without another write or review', async () => {
  const f = await fixture();
  try {
    const second = await f.second(), task = second.tasks[0], model = makeInfer(secondSummary);
    let rewriteCalls = 0;
    const rewrite: Infer = async (...args) => {rewriteCalls++; return model.infer(...args);};
    const reviewOnly: Infer = async (...args) => {expect((args[2].properties as any)?.supported).toBeDefined(); return model.infer(...args);};
    await expect(f.store.execute(task, second, signal(), reviewOnly, phase => {if (phase === 'edit_proposal_saved') throw new Error('Injected saved rewrite interruption');}, rewrite)).rejects.toThrow('saved rewrite interruption');
    const proposal = f.store.state(second.id)!; expect(proposal.phase).toBe('proposal_saved'); expect(model.calls.map(call => call.kind)).toEqual(['write']); expect(rewriteCalls).toBe(1);
    await expect(f.restart().execute(task, second, signal(), reviewOnly, noop, rewrite)).rejects.toThrow('proposal is ready'); f.markNeedsInput(second);
    const reviewed = f.store.state(second.id)!; expect(reviewed.writingAttempt).toEqual(proposal.writingAttempt); expect(model.calls.map(call => call.kind)).toEqual(['write', 'review']);
    await f.store.approve(second, {operationId: reviewed.operationId, proposalSha256: reviewed.proposalSha256!});
    await expect(f.store.execute(task, second, signal(), reviewOnly, phase => {if (phase === 'edit_rendered') throw new Error('Injected version 2 registration interruption');}, rewrite)).rejects.toThrow('registration interruption');
    const rendered = f.store.state(second.id)!, renderCount = f.renders(); expect(rendered.phase).toBe('rendered'); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 1});
    const result = await f.restart().execute(task, second, signal(), reviewOnly, noop, rewrite);
    expect(result.documentEditArtifact).toEqual(rendered.artifact); expect(f.renders()).toBe(renderCount); expect(model.calls.map(call => call.kind)).toEqual(['write', 'review']); expect(rewriteCalls).toBe(1);
    expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=2').get()).toEqual({n: 1}); await unchangedEarlier(f);
  } finally {await f.close();}
});

test('stale current parents and a document changed while reviewing cannot trigger inference or approve a version', async () => {
  for (const boundary of ['before-native', 'before-apply']) {
    const f = await fixture();
    try {
      await expect(f.store.prepare(f.original, {requestKey: crypto.randomUUID(), intent: secondIntent})).rejects.toThrow();
      const second = await f.second(), model = makeInfer(secondSummary);
      if (boundary === 'before-apply') await proposeSecond(f, second, model);
      const state = f.store.state(second.id);
      await writeFile(join(f.directory, 'documents', second.documentId!, '2.pdf'), '%PDF-1.7\nUnrelated manual revision\n');
      f.db.query('INSERT INTO pdf_versions VALUES(?,?,?)').run(second.documentId!, 2, 'Manual unrelated edit'); f.db.query('UPDATE documents SET revision=2 WHERE id=?').run(second.documentId!);
      if (boundary === 'before-native') {
        await expect(f.store.execute(second.tasks[0], second, signal(), model.infer, noop)).rejects.toThrow();
        expect(model.calls).toEqual([]); expect(f.store.state(second.id)?.writingAttempt).toBeUndefined(); expect(f.store.state(second.id)?.artifact).toBeUndefined();
      } else {
        await expect(f.store.approve(second, {operationId: state!.operationId, proposalSha256: state!.proposalSha256!})).rejects.toThrow();
        expect(f.store.state(second.id)!.approvedProposalSha256).toBeUndefined(); expect(model.calls.map(call => call.kind)).toEqual(['write', 'review']);
      }
      await expect(f.store.prepare(f.first, {requestKey: crypto.randomUUID(), intent: secondIntent})).rejects.toThrow();
      expect(await readFile(join(f.directory, 'documents', second.documentId!, '2.pdf'), 'utf8')).toContain('Unrelated manual revision'); await unchangedEarlier(f);
    } finally {await f.close();}
  }
});

test('a base changed after approval cannot overwrite a competing version 2 or claim it as this operation', async () => {
  const f = await fixture();
  try {
    const second = await f.second(), {model, state} = await proposeSecond(f, second);
    await f.store.approve(second, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
    const competing = '%PDF-1.7\nCompeting saved version 2\n'; await writeFile(join(f.directory, 'documents', second.documentId!, '2.pdf'), competing);
    f.db.query('INSERT INTO pdf_versions VALUES(?,?,?)').run(second.documentId!, 2, 'Competing accepted version'); f.db.query('UPDATE documents SET revision=2 WHERE id=?').run(second.documentId!);
    await expect(f.restart().execute(second.tasks[0], second, signal(), model.infer, noop)).rejects.toThrow();
    expect(f.store.state(second.id)!.artifact).toBeUndefined(); expect(await readFile(join(f.directory, 'documents', second.documentId!, '2.pdf'), 'utf8')).toBe(competing);
    expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=2').get()).toEqual({n: 1}); expect(model.calls.length).toBe(2); await unchangedEarlier(f);
  } finally {await f.close();}
});

test('a lost completion and rolled-back version 2 registration reconcile the same approved operation exactly once', async () => {
  const f = await fixture();
  try {
    const second = await f.second(), {model, state} = await proposeSecond(f, second);
    await f.store.approve(second, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
    f.db.exec("CREATE TRIGGER fail_version_two BEFORE INSERT ON pdf_versions WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'Injected version two rollback'); END");
    await expect(f.store.execute(second.tasks[0], second, signal(), model.infer, noop)).rejects.toThrow('version two rollback');
    const checkpoint = f.store.state(second.id)!, count = f.renders(); expect(checkpoint.phase).toBe('rendered'); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 1});
    f.db.exec('DROP TRIGGER fail_version_two');
    const saved = await f.restart().execute(second.tasks[0], second, signal(), model.infer, noop);
    expect(saved.documentEditArtifact).toEqual(checkpoint.artifact); expect(f.renders()).toBe(count);
    expect(await f.restart().execute(second.tasks[0], second, signal(), model.infer, noop)).toEqual(saved);
    await f.store.approve(second, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
    expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=2').get()).toEqual({n: 1}); expect(model.calls.length).toBe(2); await unchangedEarlier(f);
  } finally {await f.close();}
});

test('an unknown unregistered version 2 file is preserved through explicit retry without a false revision', async () => {
  const f = await fixture();
  try {
    const second = await f.second(), {model, state} = await proposeSecond(f, second);
    await f.store.approve(second, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
    const path = join(f.directory, 'documents', second.documentId!, '2.pdf'), unknown = '%PDF-1.7\nUnknown unregistered owner\n';
    await writeFile(path, unknown);
    await expect(f.store.execute(second.tasks[0], second, signal(), model.infer, noop)).rejects.toThrow('different file');
    const checkpoint = f.store.state(second.id)!, count = f.renders(); expect(checkpoint.phase).toBe('rendered');
    await expect(f.restart().execute(second.tasks[0], second, signal(), model.infer, noop)).rejects.toThrow('different file');
    expect(f.store.state(second.id)!.artifact).toEqual(checkpoint.artifact); expect(f.renders()).toBe(count); expect(model.calls.length).toBe(2);
    expect(await readFile(path, 'utf8')).toBe(unknown); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 1});
    expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=2').get()).toEqual({n: 0}); await unchangedEarlier(f);
  } finally {await f.close();}
});

test('uncertain create and exact Apply identities do not create duplicate children or approve a different proposal', async () => {
  const f = await fixture();
  try {
    const submission = {requestKey: crypto.randomUUID(), intent: secondIntent}, request = await f.store.prepare(f.first, submission), second = f.queue.createDocumentEdit(f.first.id, request);
    expect(f.queue.createDocumentEdit(f.first.id, request).id).toBe(second.id);
    expect(() => f.queue.createDocumentEdit(f.first.id, {...request, intent: 'Another requested change'})).toThrow('another intent');
    const {model, state} = await proposeSecond(f, second);
    await expect(f.store.approve(second, {operationId: crypto.randomUUID(), proposalSha256: state.proposalSha256!})).rejects.toThrow('exact saved edit proposal');
    await expect(f.store.approve(second, {operationId: state.operationId, proposalSha256: 'f'.repeat(64)})).rejects.toThrow('exact saved edit proposal');
    expect(f.store.state(second.id)!.approvedProposalSha256).toBeUndefined();
    await applySecond(f, second, model); expect(f.db.query('SELECT COUNT(*) n FROM goal_document_edit_requests WHERE parent_id=?').get(f.first.id)).toEqual({n: 1});
    expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=2').get()).toEqual({n: 1}); await unchangedEarlier(f);
  } finally {await f.close();}
});

test('a shorter-one-sentence request rejects missing locations, multiple sentences and unshortened text before Apply', async () => {
  for (const text of ['Newcomers can find tests in fetch/ under web-platform-tests/wpt.', 'Tests are in fetch/ under web-platform-tests/wpt. Browser results are at https://wpt.fyi/results/fetch.', firstSummary]) {
    const f = await fixture();
    try {
      const second = await f.second(), model = makeInfer(text);
      await expect(f.store.execute(second.tasks[0], second, signal(), model.infer, noop)).rejects.toThrow();
      const state = f.store.state(second.id)!; expect(state.phase).toBe('rejected'); expect(state.writingAttempt?.raw).toEqual({text, citations: [1, 2]});
      expect(state.approvedProposalSha256).toBeUndefined(); expect(state.artifact).toBeUndefined(); expect(model.calls.filter(call => call.kind === 'write').length).toBe(1);
      expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 1}); await unchangedEarlier(f);
    } finally {await f.close();}
  }
});

test('unsupported current-revision intents are refused before a new operation without silently changing the request', async () => {
  const f = await fixture();
  try {
    const before = {edits: f.db.query('SELECT COUNT(*) n FROM research_brief_edits').get(), goals: f.db.query('SELECT COUNT(*) n FROM goal_tasks').get(), renders: f.renders(), modelCalls: f.firstModel.calls.length};
    for (const intent of ['Change the colour.', 'Make it one sentence.', 'Shorten the summary.']) {
      const submission = {requestKey: crypto.randomUUID(), intent}, saved = structuredClone(submission);
      await expect(f.store.prepare(f.first, submission)).rejects.toThrow('explicit request to shorten it to one sentence');
      expect(submission).toEqual(saved);
    }
    expect(f.db.query('SELECT COUNT(*) n FROM research_brief_edits').get()).toEqual(before.edits);
    expect(f.db.query('SELECT COUNT(*) n FROM goal_tasks').get()).toEqual(before.goals);
    expect(f.renders()).toBe(before.renders); expect(f.firstModel.calls.length).toBe(before.modelCalls);
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 1}); await unchangedEarlier(f);
  } finally {await f.close();}
});

test('Stop during prepared-file verification leaves version 2 unpublished until explicit continuation', async () => {
  let target = '', held = false, release!: () => void, reached!: () => void;
  const gate = new Promise<void>(done => {release = done;}), entered = new Promise<void>(done => {reached = done;});
  const f = await fixture(false, async job => {
    if (!held && target && job.op === 'verify_research_brief' && job.input === target) {
      held = true; reached(); await gate;
    }
  });
  try {
    const second = await f.second(), {model, state} = await proposeSecond(f, second);
    await f.store.approve(second, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
    target = join(f.directory, 'documents', second.documentId!, 'edits', state.operationId, 'revised.pdf');
    const control = new AbortController();
    const running = f.store.execute(second.tasks[0], second, control.signal, model.infer, noop);
    // Attach the rejection observer before cancellation to retain an ordinary
    // controlled-stop result, without an unhandled rejection in the fixture.
    const stopped = running.then(() => null, error => error as Error);
    await entered;
    second.status = 'cancelled'; f.saveGoal(second); control.abort(new Error('Injected late Stop'));
    release(); const error = await stopped;
    expect(error).toBeInstanceOf(Error); expect(error?.message).toBe('Injected late Stop');
    const prepared = f.store.state(second.id)!, count = f.renders();
    expect(prepared.phase).toBe('rendered'); expect(prepared.operationId).toBe(state.operationId);
    expect(prepared.writingAttempt).toEqual(state.writingAttempt); expect(prepared.approvedProposalSha256).toBe(state.proposalSha256);
    expect(prepared.artifact).toBeDefined();
    if (!prepared.artifact) throw new Error('Prepared revision artifact is missing after Stop.');
    expect(sourceHash(await readFile(target))).toBe(prepared.artifact.pdfSha256);
    expect(await Bun.file(join(f.directory, 'documents', second.documentId!, 'edits', state.operationId, 'brief.html')).exists()).toBe(true);
    expect(await Bun.file(join(f.directory, 'documents', second.documentId!, '2.pdf')).exists()).toBe(false);
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 1});
    expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=2').get()).toEqual({n: 0});
    expect(model.calls.map(call => call.kind)).toEqual(['write', 'review']); await unchangedEarlier(f);
    f.markNeedsInput(second);
    const continued = await f.restart().execute(second.tasks[0], second, signal(), model.infer, noop);
    expect(continued.documentEditArtifact).toEqual(prepared.artifact); expect(f.renders()).toBe(count);
    expect(model.calls.map(call => call.kind)).toEqual(['write', 'review']);
    expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=2').get()).toEqual({n: 1}); await unchangedEarlier(f);
  } finally {release(); await f.close();}
});
