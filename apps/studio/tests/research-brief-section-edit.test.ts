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
import type {DocumentEditRequest} from '../core/research-brief-edit-types';
import {documentEditTargetMismatch, hasLegacySummaryIntent, noteParagraphs} from '../core/research-brief-target';

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
  const directory = await mkdtemp(join(tmpdir(), 'brief-section-edit-'));
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
  // Construct the old accepted v2 through its unchanged summary contract. These
  // injected setup decisions are not genuine native-model or recovery evidence.
  const current = await second(), currentTask = current.tasks[0], currentModel = makeInfer(secondSummary);
  await expect(store.execute(currentTask, current, signal(), currentModel.infer, noop)).rejects.toThrow('proposal is ready');
  markNeedsInput(current); const currentState = store.state(current.id)!;
  await store.approve(current, {operationId: currentState.operationId, proposalSha256: currentState.proposalSha256!});
  const currentExecution = await store.execute(currentTask, current, signal(), currentModel.infer, noop);
  Object.assign(currentTask, {status: 'verified', execution: currentExecution, review: await store.review(currentTask, current, currentExecution, signal())});
  Object.assign(current, {status: 'completed', phase: 'completed', coverageDone: true, coverageOffset: current.request.length}); saveGoal(current);
  const currentFiles = {pdf: await store.export(current, 'pdf'), html: await store.export(current, 'html'), provenance: await store.export(current, 'provenance-json')};
  const currentBody = JSON.stringify(current);
  return {directory, db, ledger, briefs, store, queue, original, first, current, currentFiles, currentBody, firstModel, beforeFiles, originalBody, firstBody, saveGoal, second, markNeedsInput, engine, renders: () => renders,
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

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Target = NonNullable<DocumentEditRequest['target']>;
const noteIntent = 'Make this clearer for a newcomer';
const rewrittenNote = 'Before I make changes, I will record the browser name and version, a small public example, what I expected to happen and what I actually saw. Before sharing anything, I will remove cookies, authorization headers, account details and private URLs.';
const alternateNote = 'Before making any changes, I will record the browser and its version, a minimal public example, what I expected to happen and what I actually saw. I will remove cookies, authorization headers, account details and private URLs before I share anything.';
const completedNote = 'I recorded the browser and version, a minimal public example, the expected outcome and what I actually saw. I removed cookies, authorization headers, account details and private URLs before sharing everything.';
// Exact failed diagnostic5 projection used as injected whole-paragraph input; not native whole-paragraph evidence.
const diagnosticFutureObserveParagraph = "Before changing anything, I will record the browser and version, a minimal public example, and I will observe the outcome I expected and what I actually saw. I will remove cookies, authorization headers, account details and private URLs from anything I share.";
const acceptedNoteReview = {supported: true, meaningRetained: true, plannedActionsRetained: true, noCompletedWorkInvented: true, clearerForNewcomer: true, reason: 'Injected semantic checks for the selected paragraph only; no genuine model-quality claim.'};

function noteModel(text = rewrittenNote, review = acceptedNoteReview) {
  const calls: {kind: 'write' | 'review'; role: string; packet: string}[] = [];
  const infer: Infer = async (role, packet, schema) => {
    const reviewing = !!(schema.properties as any)?.supported;
    calls.push({kind: reviewing ? 'review' : 'write', role, packet});
    return structuredClone(reviewing ? review : {text});
  };
  return {infer, calls};
}
function targetFor(f: Fixture, parent = f.current): Target {
  const options = f.store.options(parent)!;
  const paragraph = options.paragraphs.find(p => p.index === 1)!;
  return {section: 'notes', paragraph: paragraph.index, paragraphSha256: paragraph.sha256, format: 'clearer-plain-paragraph'};
}
async function createNote(f: Fixture, target = targetFor(f), intent = noteIntent, parent = f.current, requestKey = crypto.randomUUID()) {
  const submitted = {requestKey, intent, target};
  return f.queue.createDocumentEdit(parent.id, await f.store.prepare(parent, submitted));
}
async function proposeNote(f: Fixture, edit: GoalRecord, model = noteModel()) {
  await expect(f.store.execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer)).rejects.toThrow('proposal is ready');
  f.markNeedsInput(edit); return {state: f.store.state(edit.id)!, model};
}
async function applyNote(f: Fixture, edit: GoalRecord, model = noteModel()) {
  const state = f.store.state(edit.id)!;
  await f.store.approve(edit, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
  return f.store.execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer);
}
async function acceptCompleted(f: Fixture, edit: GoalRecord, execution: Awaited<ReturnType<typeof applyNote>>) {
  Object.assign(edit.tasks[0], {status: 'verified', execution, review: await f.store.review(edit.tasks[0], edit, execution, signal())});
  Object.assign(edit, {status: 'completed', phase: 'completed', coverageDone: true, coverageOffset: edit.request.length}); f.saveGoal(edit);
}
async function unchangedAncestors(f: Fixture) {
  expect((await f.briefs.exportPdf(f.original)).bytes).toEqual(f.beforeFiles.originalPdf.bytes);
  expect((await f.briefs.exportHtml(f.original)).bytes).toEqual(f.beforeFiles.originalHtml.bytes);
  for (const [ancestor, files] of [[f.first, {pdf: f.beforeFiles.firstPdf, html: f.beforeFiles.firstHtml, provenance: f.beforeFiles.firstProvenance}], [f.current, f.currentFiles]] as const) {
    expect((await f.store.export(ancestor, 'pdf')).bytes).toEqual(files.pdf.bytes);
    expect((await f.store.export(ancestor, 'html')).bytes).toEqual(files.html.bytes);
    expect((await f.store.export(ancestor, 'provenance-json')).bytes).toEqual(files.provenance.bytes);
  }
  for (const [id, body] of [[f.original.id, f.originalBody], [f.first.id, f.firstBody], [f.current.id, f.currentBody]]) {
    expect((f.db.query('SELECT body FROM goal_tasks WHERE id=?').get(id) as {body: string}).body).toBe(body);
  }
}
function splicedNotes(replacement = rewrittenNote) {
  const paragraph = noteParagraphs(notes)[1];
  return notes.slice(0, paragraph.start) + replacement + notes.slice(paragraph.end);
}

test('paragraph ranges distinguish repeated Unicode text and retain original CRLF/blank-line separators', () => {
  const repeated = 'I will check the result.', value = '\r\n \r\nIntro 😀\r\n \r\n' + repeated + '\r\n\r\n' + repeated + '\r\n\r\nTail\nsame paragraph';
  const paragraphs = noteParagraphs(value);
  expect(paragraphs.map(p => p.text)).toEqual(['Intro 😀', repeated, repeated, 'Tail\nsame paragraph']);
  expect(paragraphs.map(p => p.index)).toEqual([0, 1, 2, 3]);
  expect(paragraphs[1].start).toBe(value.indexOf(repeated)); expect(paragraphs[2].start).toBe(value.lastIndexOf(repeated));
  expect(paragraphs[1].start).not.toBe(paragraphs[2].start); expect(sourceHash(paragraphs[1].text)).toBe(sourceHash(paragraphs[2].text));
  const selected = paragraphs[2], replacement = 'I plan to inspect the result.', result = value.slice(0, selected.start) + replacement + value.slice(selected.end);
  expect(result).toBe('\r\n \r\nIntro 😀\r\n \r\n' + repeated + '\r\n\r\n' + replacement + '\r\n\r\nTail\nsame paragraph');
  for (const paragraph of paragraphs) expect(value.slice(paragraph.start, paragraph.end)).toBe(paragraph.text);
});

test('explicit note paragraph selection publishes only that native rewrite as v3 and real PDF/HTML retain summary, other notes, citations and v0/v1/v2', async () => {
  const f = await fixture(true);
  try {
    const options = f.store.options(f.current)!;
    expect(options.baseRevision).toBe(2); expect(options.notesSha256).toBe(sourceHash(notes));
    expect(options.paragraphs.map(p => [p.index, p.start, p.end])).toEqual([[0, 0, 159], [1, 161, 401], [2, 403, 1719]]);
    const edit = await createNote(f), request = edit.documentEdit!, target = targetFor(f);
    expect(edit.request).toBe(noteIntent); expect(request.intent).toBe(noteIntent); expect(request.target).toEqual(target); expect(request.baseRevision).toBe(2);
    const {state, model} = await proposeNote(f, edit);
    expect(state.writingMode).toBe('note-paragraph-rewrite-v5'); expect(state.writingAttempt?.raw).toEqual({text: rewrittenNote});
    expect(state.writingAttempt?.format).toBe('native-note-paragraph-v1'); expect(state.proposal).toEqual(state.before);
    expect(f.store.state(f.current.id)!.proposal).toEqual(state.before);
    expect(state.notesEdit).toMatchObject({before: noteParagraphs(notes)[1].text, start: 161, end: 401, notesSha256: sourceHash(notes), paragraphSha256: target.section === 'notes' ? target.paragraphSha256 : '', proposal: rewrittenNote, proposedNotes: splicedNotes(), proposedNotesSha256: sourceHash(splicedNotes())});
    expect(state.preserved.notes).toBe(notes); expect(state.preserved.citations).toEqual(f.store.state(f.current.id)!.preserved.citations);
    const result = await applyNote(f, edit, model); await acceptCompleted(f, edit, result);
    expect(result.documentEditArtifact).toMatchObject({revision: 3, operationId: state.operationId, documentId: request.documentId});
    expect(f.db.query('SELECT revision FROM pdf_versions ORDER BY revision').all()).toEqual([{revision: 0}, {revision: 1}, {revision: 2}, {revision: 3}]);
    const pdf = await f.store.export(edit, 'pdf'), html = await f.store.export(edit, 'html'), provenance = JSON.parse(new TextDecoder().decode((await f.store.export(edit, 'provenance-json')).bytes));
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    const reading = await htmlReadingText(new TextDecoder().decode(html.bytes)); expect(reading).toContain(splicedNotes()); expect(reading.split(rewrittenNote).length - 1).toBe(1); expect(reading).toContain(secondSummary);
    expect(provenance.personalNotes).toBe(splicedNotes()); expect(provenance.paragraphs).toEqual(state.before.paragraphs); expect(provenance.citations.map((c: any) => c.quote)).toEqual(quotes);
    const inspected = await f.engine({op: 'inspect', input: join(f.directory, 'documents', request.documentId, '3.pdf'), args: {pages: Array.from({length: result.documentEditArtifact!.pages}, (_, index) => index + 1)}});
    const compact = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ''), pdfText = inspected.pages.map((p: any) => p.text).join('\n');
    expect(compact(pdfText)).toContain(compact(splicedNotes())); expect(compact(pdfText)).toContain(compact(secondSummary));
    expect(model.calls.map(c => c.kind)).toEqual(['write', 'review']); expect(model.calls[0].packet).toContain(noteIntent); expect(model.calls[0].packet).toContain(noteParagraphs(notes)[1].text);
    await unchangedAncestors(f);
  } finally {await f.close();}
}, 40000);

test('ambiguous or invalid selection clarifies without a child while an explicit summary format preserves the unchanged original intent', async () => {
  const f = await fixture();
  try {
    const count = () => [f.db.query('SELECT COUNT(*) n FROM research_brief_edits').get(), f.db.query('SELECT COUNT(*) n FROM goal_tasks').get(), f.renders()];
    const before = count(), target = targetFor(f);
    for (const candidate of [undefined, {section: 'notes'}, {...target, format: 'unspecified'}, {...target, paragraph: 99}, {...target, paragraphSha256: 'f'.repeat(64)}]) {
      const submission = {requestKey: crypto.randomUUID(), intent: noteIntent, ...(candidate ? {target: candidate as Target} : {})}, saved = structuredClone(submission);
      await expect(f.store.prepare(f.current, submission)).rejects.toThrow(); expect(submission).toEqual(saved); expect(count()).toEqual(before);
    }
    const selectedSummary: Target = {section: 'summary', format: 'shorter-single-sentence'};
    const request = await f.store.prepare(f.current, {requestKey: crypto.randomUUID(), intent: noteIntent, target: selectedSummary});
    expect(request.intent).toBe(noteIntent); expect(request.target).toEqual(selectedSummary); expect(request.requirements).toMatchObject({oneSentence: true, shorterThanCharacters: secondSummary.length});
    expect(count()).toEqual(before); await unchangedAncestors(f);
  } finally {await f.close();}
});

test('literal section-intent conflicts ask for clarification before a child while negative preservation clauses retain the original request', async () => {
  const f = await fixture();
  try {
    const noteTarget = targetFor(f), summaryTarget: Target = {section: 'summary', format: 'shorter-single-sentence'};
    const counts = () => ({edits: f.db.query('SELECT COUNT(*) n FROM research_brief_edits').get(), goals: f.db.query('SELECT COUNT(*) n FROM goal_tasks').get(), renders: f.renders(), setupModelCalls: f.firstModel.calls.length});
    const before = counts();
    // The existing fixture's original is historical v0, so its store path must
    // reject a stale base independently. Check this earlier-format gate purely
    // rather than rewinding accepted document history to manufacture fresh v0.
    expect(hasLegacySummaryIntent(noteIntent)).toBe(false);
    for (const named of ['Rewrite the summary', 'Revise the factual paragraph', 'Write both facts', 'Format as two sentences']) expect(hasLegacySummaryIntent(named)).toBe(true);
    for (const [intent, target, reason] of [['Rewrite the summary', noteTarget, 'explicitly asks to change'], ['Revise the summary', noteTarget, 'explicitly asks to change'], ['Revise the factual paragraph', noteTarget, 'explicitly asks to change'], ['Rewrite my personal notes', summaryTarget, 'explicitly asks to change'], [noteIntent + '; keep notes unchanged', noteTarget, 'explicitly preserves'], [noteIntent + "; don't change summary", summaryTarget, 'explicitly preserves']] as const) {
      expect(documentEditTargetMismatch(intent, target)).toContain('Clarify the intended section');
      const submission = {requestKey: crypto.randomUUID(), intent, target}, saved = structuredClone(submission);
      await expect(f.store.prepare(f.current, submission)).rejects.toThrow(reason);
      expect(submission).toEqual(saved); expect(counts()).toEqual(before);
      const otherwiseValid = await f.store.prepare(f.current, {...submission, intent: noteIntent});
      expect(() => f.queue.createDocumentEdit(f.current.id, {...otherwiseValid, intent})).toThrow(reason);
      expect(counts()).toEqual(before);
    }
    for (const [intent, target] of [[noteIntent + '; do not change summary', noteTarget], [noteIntent + '; do not revise factual paragraph', noteTarget], [noteIntent + '; keep notes unchanged', summaryTarget], [noteIntent, noteTarget], [noteIntent + '; keep meaning unchanged', noteTarget], [noteIntent + '; keep facts unchanged', summaryTarget]] as const) {
      expect(documentEditTargetMismatch(intent, target)).toBeUndefined();
      const submission = {requestKey: crypto.randomUUID(), intent, target}, saved = structuredClone(submission), prepared = await f.store.prepare(f.current, submission);
      expect(submission).toEqual(saved); expect(prepared.intent).toBe(intent); expect(prepared.target).toEqual(target); expect(counts()).toEqual(before);
    }
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2}); await unchangedAncestors(f);
  } finally {await f.close();}
});

test('uncertain submission identity includes exact target and distinct note proposals cannot share an Apply hash merely because summary is unchanged', async () => {
  const f = await fixture();
  try {
    const target = targetFor(f), submitted = {requestKey: crypto.randomUUID(), intent: noteIntent, target}, request = await f.store.prepare(f.current, submitted), a = f.queue.createDocumentEdit(f.current.id, request);
    expect(f.queue.createDocumentEdit(f.current.id, request).id).toBe(a.id);
    expect(() => f.queue.createDocumentEdit(f.current.id, {...request, target: {...target, format: 'shorter-single-sentence'} as Target})).toThrow();
    const b = await createNote(f), pa = await proposeNote(f, a), pb = await proposeNote(f, b, noteModel(alternateNote));
    expect(pa.state.proposal).toEqual(pb.state.proposal); expect(pa.state.notesEdit?.proposal).not.toBe(pb.state.notesEdit?.proposal); expect(pa.state.proposalSha256).not.toBe(pb.state.proposalSha256);
    await expect(f.store.approve(a, {operationId: pa.state.operationId, proposalSha256: sourceHash(JSON.stringify(pa.state.proposal))})).rejects.toThrow();
    await expect(f.store.approve(a, {operationId: pa.state.operationId, proposalSha256: pb.state.proposalSha256!})).rejects.toThrow();
    expect(f.store.state(a.id)!.approvedProposalSha256).toBeUndefined(); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2}); await unchangedAncestors(f);
  } finally {await f.close();}
});

test('word-identical punctuation copying and lost planned meaning cannot become approved completed-work claims', async () => {
  const f = await fixture();
  try {
    const before = noteParagraphs(notes)[1].text;
    const beforeRenders = f.renders();
    for (const text of [before, before.replace('expected and', 'expected, and'), diagnosticFutureObserveParagraph]) {
      const edit = await createNote(f), model = noteModel(text);
      await expect(f.store.execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer)).rejects.toThrow();
      f.markNeedsInput(edit);
      const state = f.store.state(edit.id)!; expect(state.phase).toBe('rejected'); expect(state.writingAttempt?.raw).toEqual({text}); expect(state.approvedProposalSha256).toBeUndefined(); expect(state.artifact).toBeUndefined(); expect(model.calls.map(c => c.kind)).toEqual(['write']);
      if (text === diagnosticFutureObserveParagraph) expect(state.draftCheck?.reason).toContain('new future observe action');
      await expect(f.store.approve(edit, {operationId: state.operationId, proposalSha256: state.proposalSha256!})).rejects.toThrow();
      expect(f.renders()).toBe(beforeRenders); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2});
    }
    for (const [text, flag] of [[completedNote, 'noCompletedWorkInvented'], [rewrittenNote, 'meaningRetained'], [rewrittenNote, 'plannedActionsRetained'], [rewrittenNote, 'clearerForNewcomer']] as const) {
      const review = {...acceptedNoteReview, [flag]: false}, edit = await createNote(f), model = noteModel(text, review);
      await expect(f.store.execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer)).rejects.toThrow();
      f.markNeedsInput(edit);
      const state = f.store.state(edit.id)!; expect(state.phase).toBe('rejected'); expect(state.writingAttempt?.raw).toEqual({text}); expect(state.approvedProposalSha256).toBeUndefined(); expect(state.artifact).toBeUndefined();
      if (model.calls.some(c => c.kind === 'review')) expect(state.notesReviewAttempt?.raw).toEqual(review);
    }
    const pastObservation = rewrittenNote.replace('what I actually saw', 'what I observed'), permitted = await createNote(f), permittedModel = noteModel(pastObservation);
    const {state: permittedState} = await proposeNote(f, permitted, permittedModel);
    expect(permittedState.phase).toBe('awaiting_approval'); expect(permittedState.notesEdit?.proposal).toBe(pastObservation); expect(permittedModel.calls.map(c => c.kind)).toEqual(['write', 'review']);
    expect(permittedState.approvedProposalSha256).toBeUndefined(); expect(f.renders()).toBe(beforeRenders);
    expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2}); await unchangedAncestors(f);
  } finally {await f.close();}
});

test('note proposal and prepared-file interruption continue the same raw selection and one v3 without repeated writer or meaning review', async () => {
  const f = await fixture();
  try {
    const edit = await createNote(f), model = noteModel();
    await expect(f.store.execute(edit.tasks[0], edit, signal(), model.infer, phase => {if (phase === 'edit_proposal_saved') throw new Error('Injected note raw checkpoint interruption');}, model.infer)).rejects.toThrow('note raw checkpoint interruption');
    const saved = f.store.state(edit.id)!; expect(saved.phase).toBe('proposal_saved'); expect(saved.notesEdit?.proposedNotes).toBe(splicedNotes()); expect(model.calls.map(c => c.kind)).toEqual(['write']);
    await expect(f.restart().execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer)).rejects.toThrow('proposal is ready'); f.markNeedsInput(edit);
    const reviewed = f.store.state(edit.id)!; expect(reviewed.writingAttempt).toEqual(saved.writingAttempt); expect(reviewed.notesEdit).toEqual(saved.notesEdit); expect(model.calls.map(c => c.kind)).toEqual(['write', 'review']);
    await f.store.approve(edit, {operationId: reviewed.operationId, proposalSha256: reviewed.proposalSha256!});
    // Lost Apply acknowledgment is reconciled against the exact same identity.
    await f.restart().approve(edit, {operationId: reviewed.operationId, proposalSha256: reviewed.proposalSha256!});
    await expect(f.store.execute(edit.tasks[0], edit, signal(), model.infer, phase => {if (phase === 'edit_rendered') throw new Error('Injected note registration interruption');}, model.infer)).rejects.toThrow('note registration interruption');
    const prepared = f.store.state(edit.id)!, count = f.renders(); expect(prepared.phase).toBe('rendered'); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2});
    const result = await f.restart().execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer);
    expect(result.documentEditArtifact).toEqual(prepared.artifact); expect(f.renders()).toBe(count); expect(model.calls.map(c => c.kind)).toEqual(['write', 'review']); expect(f.store.state(edit.id)!.notesEdit).toEqual(saved.notesEdit);
    expect((await f.restart().execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer)).documentEditArtifact).toEqual(prepared.artifact); expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=3').get()).toEqual({n: 1}); await unchangedAncestors(f);
  } finally {await f.close();}
});

test('an unapplied competing note proposal remains preserved and stale after one separate operation publishes v3', async () => {
  const f = await fixture();
  try {
    const a = await createNote(f), b = await createNote(f), pa = await proposeNote(f, a), pb = await proposeNote(f, b, noteModel(alternateNote));
    const result = await applyNote(f, a, pa.model); await acceptCompleted(f, a, result);
    const acceptedBytes = (await f.store.export(a, 'pdf')).bytes;
    await expect(f.store.approve(b, {operationId: pb.state.operationId, proposalSha256: pb.state.proposalSha256!})).rejects.toThrow();
    const rejected = f.store.state(b.id)!; expect(rejected.conflict).toMatchObject({expectedRevision: 2, actualRevision: 3}); expect(rejected.writingAttempt).toEqual(pb.state.writingAttempt); expect(rejected.notesEdit).toEqual(pb.state.notesEdit); expect(rejected.approvedProposalSha256).toBeUndefined();
    await expect(f.restart().execute(b.tasks[0], b, signal(), pb.model.infer, noop, pb.model.infer)).rejects.toThrow(); expect(pb.model.calls.map(c => c.kind)).toEqual(['write', 'review']);
    expect((await f.store.export(a, 'pdf')).bytes).toEqual(acceptedBytes); expect(f.db.query('SELECT COUNT(*) n FROM pdf_versions WHERE revision=3').get()).toEqual({n: 1}); await unchangedAncestors(f);
  } finally {await f.close();}
});

test('an unknown v3 file is never overwritten or claimed by a resumed note operation', async () => {
  const f = await fixture();
  try {
    const edit = await createNote(f), {model, state} = await proposeNote(f, edit); await f.store.approve(edit, {operationId: state.operationId, proposalSha256: state.proposalSha256!});
    const path = join(f.directory, 'documents', edit.documentId!, '3.pdf'), unknown = '%PDF-1.7\nUnknown owner retained by note edit\n'; await writeFile(path, unknown);
    await expect(f.store.execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer)).rejects.toThrow('different file');
    const prepared = f.store.state(edit.id)!, count = f.renders(); await expect(f.restart().execute(edit.tasks[0], edit, signal(), model.infer, noop, model.infer)).rejects.toThrow('different file');
    expect(await readFile(path, 'utf8')).toBe(unknown); expect(f.store.state(edit.id)!.artifact).toEqual(prepared.artifact); expect(f.renders()).toBe(count); expect(model.calls.map(c => c.kind)).toEqual(['write', 'review']); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2}); await unchangedAncestors(f);
  } finally {await f.close();}
});

test('tampering with saved note replacement, whole-note splice or selected base hash is detected before Apply', async () => {
  for (const field of ['replacement', 'other-note', 'target-hash']) {
    const f = await fixture();
    try {
      const edit = await createNote(f), {state} = await proposeNote(f, edit), row = f.db.query('SELECT input,body FROM research_brief_edits WHERE goal=?').get(edit.id) as {input: string; body: string}, changed = JSON.parse(row.body);
      if (field === 'replacement') changed.notesEdit.proposal = alternateNote;
      else if (field === 'other-note') {changed.notesEdit.proposedNotes += '\nInvented extra personal action.'; changed.notesEdit.proposedNotesSha256 = sourceHash(changed.notesEdit.proposedNotes);}
      else changed.notesEdit.paragraphSha256 = 'f'.repeat(64);
      f.db.query('UPDATE research_brief_edits SET body=? WHERE goal=?').run(JSON.stringify(changed), edit.id);
      expect(() => f.store.state(edit.id)).toThrow(); await expect(f.store.approve(edit, {operationId: state.operationId, proposalSha256: state.proposalSha256!})).rejects.toThrow(); expect(f.db.query('SELECT revision FROM documents').get()).toEqual({revision: 2});
      // The injected corruption is kept through all assertions, then the entire
      // isolated temporary fixture is removed; no accepted user rows are edited.
      await unchangedAncestors(f);
    } finally {await f.close();}
  }
});

test('a later explicit summary edit uses accepted current notes instead of silently restoring the original notes', async () => {
  const f = await fixture();
  try {
    const note = await createNote(f), {model} = await proposeNote(f, note), execution = await applyNote(f, note, model); await acceptCompleted(f, note, execution);
    const noteFiles = {pdf: await f.store.export(note, 'pdf'), html: await f.store.export(note, 'html'), provenance: await f.store.export(note, 'provenance-json')};
    const request = await f.store.prepare(note, {requestKey: crypto.randomUUID(), intent: noteIntent, target: {section: 'summary', format: 'shorter-single-sentence'}}), next = f.queue.createDocumentEdit(note.id, request);
    const nextText = 'Fetch tests are in fetch/ under web-platform-tests/wpt, with results at https://wpt.fyi/results/fetch.', nextModel = makeInfer(nextText);
    await expect(f.store.execute(next.tasks[0], next, signal(), nextModel.infer, noop, nextModel.infer)).rejects.toThrow('proposal is ready'); f.markNeedsInput(next);
    const state = f.store.state(next.id)!; expect(state.preserved.notes).toBe(splicedNotes()); expect(f.store.state(note.id)!.proposal).toEqual(state.before); expect(next.request).toBe(noteIntent);
    await f.store.approve(next, {operationId: state.operationId, proposalSha256: state.proposalSha256!}); await f.store.execute(next.tasks[0], next, signal(), nextModel.infer, noop, nextModel.infer);
    const provenance = JSON.parse(new TextDecoder().decode((await f.store.export(next, 'provenance-json')).bytes)); expect(provenance.personalNotes).toBe(splicedNotes()); expect(provenance.evidence.originalBrief.input.notes).toBe(notes);
    expect((await f.store.export(note, 'pdf')).bytes).toEqual(noteFiles.pdf.bytes); expect((await f.store.export(note, 'html')).bytes).toEqual(noteFiles.html.bytes); expect((await f.store.export(note, 'provenance-json')).bytes).toEqual(noteFiles.provenance.bytes); await unchangedAncestors(f);
  } finally {await f.close();}
});

