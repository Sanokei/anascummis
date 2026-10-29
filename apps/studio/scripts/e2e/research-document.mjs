#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn, execFile, execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {access, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {redactTrace} from './artifacts.mjs';

const studioRoot = fileURLToPath(new URL('../../', import.meta.url));
const viewports = {desktop: {width: 1440, height: 1000}, narrow: {width: 360, height: 800}};
const sourceUrl = 'https://raw.githubusercontent.com/whatwg/fetch/main/README.md';
const question = 'Where are the Fetch Standard’s tests kept, and where can I see them running against browser engines? Cite the README statements supporting both.';
const title = 'Fetch test contributor brief';
const shortNotes = 'Check the live dashboard before filing a browser bug. This is my personal next step, not a claim from the source.';
const phoneNotes = `Personal handoff for my next Fetch test contribution. These are my own proposed actions and working notes, not instructions or verified claims from the source.

Before changing anything, I will record the browser and version, a minimal public example, the outcome I expected and what I actually saw. I will remove cookies, authorization headers, account details and private URLs from anything I share.

1. Reopen this brief and follow its original-source link. Compare the saved retrieval time with the current README. If the evidence changed, ask a new focused question instead of editing the accepted copy.
2. Open the browser-results location from the brief. Write down the engine and platform I inspected. A saved answer is a pointer to evidence, not proof that a bug exists or a test passes.
3. Search the cited test directory for a related case before proposing another test. Keep the candidate filename, my reason for choosing it and any unresolved question in my own draft.
4. Separate reproduction from implementation. First describe a small public fixture and expected behavior; then explain the proposed test and the observation it should distinguish.
5. Read the project's current contribution and review instructions before submitting anything. I have not checked those instructions yet, and this brief does not establish them.
6. Keep a handoff log of what I tried, which evidence I saved and what remains uncertain. After interruption, inspect saved work and continue deliberately rather than repeating accepted research.
7. Preserve the PDF and HTML with their recorded hashes and original citations. Ask for missing guidance instead of guessing. My personal checklist is not a source-backed conclusion.`;
const activeHosts = new Set();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compact = text => text.replace(/\s+/g, '');
// MuPDF text extraction can emit standard font ligatures. Normalize their
// compatibility forms and layout whitespace for PDF comparisons only; the
// downloaded HTML retains its actual strings and is checked independently.
const pdfCompact = text => text.normalize('NFKC').replace(/\s+/g, '');
const exec = promisify(execFile);
class BlockedGoal extends Error {}

async function until(check, label, milliseconds = 30_000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {const result = await check(); if (result) return result; await delay(60);}
  throw new Error('Timed out: ' + label);
}
async function freePort() {
  const server = createServer(); await new Promise((done, fail) => {server.once('error', fail); server.listen(0, '127.0.0.1', done);});
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
async function stopHost(host, signal = 'SIGTERM') {
  if (!host || host.exitCode !== null || host.signalCode) {activeHosts.delete(host); return;}
  const exited = new Promise(done => host.once('exit', done)); host.kill(signal);
  const timer = setTimeout(() => host.kill('SIGKILL'), 10_000); timer.unref();
  await exited; clearTimeout(timer); activeHosts.delete(host);
}
async function fingerprints() {
  const source = [], build = [];
  async function walk(folder, prefix, result, expression) {
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      if (entry.isSymbolicLink() || ['node_modules', '.next', '.test-data', 'opensource', '__pycache__'].includes(entry.name)) continue;
      const name = prefix + entry.name, path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path, name + '/', result, expression);
      else if (expression.test(name)) {const bytes = await readFile(path); result.push({path: name, bytes: bytes.length, sha256: sha(bytes)});}
    }
  }
  for (const name of ['app', 'components', 'core', 'worker']) await walk(join(studioRoot, name), name + '/', source, /\.(?:ts|tsx|mjs|js|py|css)$/);
  for (const name of ['scripts/e2e/research-document.mjs', 'scripts/e2e/artifacts.mjs', 'package.json', 'bun.lock']) {const bytes = await readFile(join(studioRoot, name)); source.push({path: name, bytes: bytes.length, sha256: sha(bytes)});}
  await walk(join(studioRoot, 'out'), 'out/', build, /\.(?:html|js|css|json)$/);
  return {applicationSource: source.sort((a, b) => a.path.localeCompare(b.path)), servedBuild: build.sort((a, b) => a.path.localeCompare(b.path))};
}
function acceptedAnswer(goal) {
  const task = goal.tasks.find(task => task.sourceAnswer), answer = task?.execution?.sourceAnswer;
  assert.equal(goal.status, 'completed', goal.message); assert.equal(task.status, 'verified'); assert.equal(task.review?.accepted, true);
  assert.equal(answer?.answerable, true); assert.equal(answer.supportReview?.supported, true); assert.equal(answer.supportError, undefined);
  for (const pattern of [/web-platform-tests\/wpt/i, /fetch\//i, /wpt\.fyi\/results\/fetch/i]) {
    assert.match(answer.text, pattern, 'The genuine native answer must supply both requested locations.');
    assert.match(answer.citations.map(citation => citation.quote).join('\n'), pattern, 'Literal quotations must support both locations.');
  }
  return answer;
}
const briefTask = goal => goal.tasks.find(task => task.id === 'source-brief');
const artifactOf = goal => briefTask(goal)?.execution?.briefArtifact || goal.briefState?.artifact;
const goalDiagnostic = goal => [goal.message, goal.briefState?.draftCheck?.reason, goal.briefState?.writingAttempt?.error].filter(Boolean).join(' · ');

async function runCase(browser, viewportName, options) {
  const notes = viewportName === 'narrow' ? phoneNotes : shortNotes, pointer = viewportName === 'narrow' ? 'tap' : 'click';
  const layoutViewports = [viewports[viewportName], {width: 360, height: 800}, {width: 360, height: 420}].filter((viewport, index, values) => values.findIndex(value => value.width === viewport.width && value.height === viewport.height) === index);
  if (viewportName === 'narrow') assert(notes.length >= 1500 && notes.length <= 1800, 'The phone goal uses a meaningful bounded personal handoff, not repeated padding.');
  const folder = join(options.output, 'research-document-' + viewportName); await mkdir(folder);
  const data = join(folder, 'private-data'); await mkdir(data);
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const record = {id: 'native-research-document', viewport: viewportName, artifactDirectory: 'research-document-' + viewportName,
    goal: viewportName === 'narrow' ? 'Use touch to create a real native-written Fetch brief with a substantial personal contributor handoff; preserve the complete note/citations across stop and interruption, inspect every page at 300% zoom and reopen the actual multipage PDF/HTML without repeated research.' : 'Retrieve real Fetch evidence, create a genuinely native-written cited brief, recover stopped/interrupted work explicitly and reopen actual PDF/HTML downloads without losing notes or repeating accepted research.',
    startedAt: new Date().toISOString(), status: 'running', lane: 'fresh-real-native-research-and-document',
    personalNoteCharacters: notes.length, pointerActions: pointer, assertions: [], screenshots: [], processes: [], apiMutations: [], requests: [], externalBrowserRequests: [], downloads: [], pageErrors: [], progress: [],
    limitations: ['Installed local Qwen is used through the ordinary application, never a scripted model, proxy or mutation API seed.', 'Fixed host code renders PDF/HTML from native decisions; this is not arbitrary generated software execution.', 'Desktop Chromium/touch emulation and installed PDF dependencies; no physical handset, voice or fresh online installation claim.', 'One focused Fetch brief: required facts, literal citation identity and a reproduced provenance-misattribution regression; not general semantic citation or answer-quality proof.']};
  let host, context, page, sequence = 0, parent, child, submittedKey;
  const save = () => writeFile(join(folder, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  const assertStep = (name, evidence = {}) => record.assertions.push({name, passed: true, ...evidence});
  const card = id => page.locator('[data-goal-id="' + id + '"]');
  const action = (region, name) => region.getByRole('button', {name, exact: true}).or(region.getByRole('link', {name, exact: true})).first();
  const mutationCount = () => record.apiMutations.length;
  const createCount = () => record.apiMutations.filter(item => /\/brief$/.test(item.path)).length;
  async function screenshot(name, target) {
    if (target) await target.scrollIntoViewIfNeeded();
    const file = String(++sequence).padStart(2, '0') + '-' + name + '.png'; await page.screenshot({path: join(folder, file)}); record.screenshots.push(file);
  }
  async function boot() {
    const log = createWriteStream(join(folder, 'host-' + (record.processes.length + 1) + '.log'));
    const child = spawn(process.env.BUN_PATH || 'bun', ['core/server.ts'], {cwd: studioRoot,
      env: {...process.env, STUDIO_DATA: data, STUDIO_TEST_DATA: data, STUDIO_PORT: String(port), STUDIO_DEV: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
    host = child; activeHosts.add(child); let spawnError; child.once('error', error => {spawnError = error;}); child.stdout.pipe(log); child.stderr.pipe(log);
    child.once('exit', () => log.end()); record.processes.push({pid: child.pid, port, startedAt: new Date().toISOString(), command: 'bun core/server.ts'});
    await until(async () => {
      if (spawnError) throw spawnError; if (child.exitCode !== null || child.signalCode) throw new Error('Owned Studio exited before readiness.');
      try {const response = await fetch(base + '/api/status', {signal: AbortSignal.timeout(2000)}); if (response.ok) {record.runtime = await response.json(); return true;}} catch {}
    }, 'owned ordinary Studio readiness');
  }
  async function get(path) {const response = await page.request.get(base + path); assert(response.ok(), path + ' returned ' + response.status()); return response.json();}
  async function closeComposer() {const button = page.getByRole('button', {name: 'Close text input', exact: true}); if (await button.isVisible()) await button[pointer]();}
  async function send(text) {
    if (!await page.getByRole('textbox', {name: 'Message Anascummis', exact: true}).isVisible()) await page.getByRole('button', {name: 'Type a message', exact: true})[pointer]();
    await page.getByRole('textbox', {name: 'Message Anascummis', exact: true}).fill(text); await page.getByRole('button', {name: 'Send message', exact: true})[pointer](); await closeComposer();
  }
  async function openGoals() {
    if (await page.locator('.goal-panel').isVisible()) return;
    const help = page.getByRole('region', {name: 'Getting started', exact: true});
    if (!await help.isVisible()) await send('What can you do?');
    await help.getByRole('button', {name: 'Open Goals', exact: true})[pointer](); await page.locator('.goal-panel').waitFor();
  }
  async function closeWindow(name, content) {
    const tab = page.getByRole('tab', {name, exact: true});
    if (viewportName === 'narrow') await tab.getByTitle('Close', {exact: true}).tap();
    else {await tab.focus(); await page.keyboard.press('Control+Delete');}
    await content.waitFor({state: 'hidden'});
  }
  async function closeGoals() {await closeWindow('Goals', page.locator('.goal-panel'));}

  async function restoredBriefForm(id) {
    await card(id).waitFor();
    const input = card(id).getByRole('textbox', {name: 'Brief title', exact: true});
    const reveal = card(id).getByRole('button', {name: /^(?:Create research brief|Continue brief draft)$/});
    // Goal history and browser draft hydration happen after the window mounts.
    // Wait for the hydrated state before choosing whether the form needs opening.
    await until(async () => {
      if (await input.isVisible()) return true;
      if (await reveal.isVisible() && await reveal.isEnabled()) await reveal[pointer]();
      return input.isVisible();
    }, 'saved brief form and browser draft hydrate after opening Goals');
  }
  async function snapshotGoal(id) {const goal = await get('/api/goals/' + id); return structuredClone(goal);}
  async function pollGoal(id, predicate, label, milliseconds = 180_000) {
    let value, prior = '';
    await until(async () => {
      value = await get('/api/goals/' + id);
      const state = JSON.stringify([value.status, value.phase, value.briefState?.phase, value.tasks.map(task => [task.id, task.status, task.attempts])]);
      if (state !== prior) {prior = state; record.progress.push({time: new Date().toISOString(), goalId: id, status: value.status, phase: value.phase, briefPhase: value.briefState?.phase, tasks: value.tasks.map(task => ({id: task.id, status: task.status, attempts: task.attempts}))}); await save(); console.log('ACTIVE research-document [' + viewportName + '] ' + value.status + ' · ' + value.phase + ' · ' + (value.briefState?.phase || 'research'));}
      return predicate(value);
    }, label, milliseconds); return value;
  }
  async function verifiedCitations(goal, answer) {
    for (const citation of answer.citations) {
      const copy = await get('/api/goals/' + goal.id + '/sources/' + citation.sourceId + '?offset=' + citation.offset);
      assert(copy.text.startsWith(citation.quote)); assert.equal(copy.source.textSha256, citation.textSha256);
    }
  }
  async function reachable(control, name) {
    await control.scrollIntoViewIfNeeded(); await control.focus();
    const layout = await control.evaluate(element => {
      const bounds = element.getBoundingClientRect(), point = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return {left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height, focused: document.activeElement === element, hit: point === element || element.contains(point), viewportWidth: innerWidth, viewportHeight: innerHeight};
    });
    assert(layout.focused && layout.hit, name + ' must receive keyboard focus and a visible pointer/touch hit.');
    assert(layout.left >= 0 && layout.right <= layout.viewportWidth && layout.top >= 0 && layout.bottom <= layout.viewportHeight, name + ' must fit the actual viewport.');
    (record.controlLayout ||= []).push({name, viewport: await page.viewportSize(), ...layout});
  }
  async function download(label, filename) {
    const control = action(card(child.id), label), href = await control.getAttribute('href');
    assert(href, 'A document download must expose its exact export URL.');
    const url = new URL(href, base); assert.equal(url.origin, base, 'Document exports stay on the owned Studio origin.');
    const pending = page.waitForEvent('download', {timeout: 20_000}); pending.catch(() => {});
    await control[pointer](); const file = await pending; assert.equal(await file.failure(), null);
    const path = join(folder, filename); await file.saveAs(path); const bytes = await readFile(path);
    // Chromium exposes downloads through the documented Download event. A
    // download is not required to emit a normal page response event. Save those
    // actual browser bytes first, then independently inspect headers using an
    // exact-URL read-only GET and require its body to be byte-identical.
    const receipt = {path: filename, bytes: bytes.length, sha256: sha(bytes), suggestedFilename: file.suggestedFilename(),
      mimeEvidence: 'Independent exact-URL GET headers; its complete body must equal the actual browser download.'};
    record.downloads.push(receipt);
    const served = await page.request.get(url.href); assert(served.ok(), 'The same read-only document export must remain available.');
    const servedBytes = await served.body(); assert.deepEqual(servedBytes, bytes, 'Read-only header inspection must return the exact actual browser-downloaded bytes.');
    receipt.type = served.headers()['content-type']; receipt.headerProbe = {method: 'GET', path: url.pathname + url.search, status: served.status(), sha256: sha(servedBytes), byteIdentical: true};
    return {path, bytes, receipt};
  }

  try {
    await boot(); if (!record.runtime.model?.ready) throw new BlockedGoal('Local Qwen is unavailable; the requested native research/document goal cannot be achieved.');
    context = await browser.newContext({viewport: viewports[viewportName], hasTouch: viewportName === 'narrow', reducedMotion: 'reduce', timezoneId: 'America/New_York', acceptDownloads: true});
    await context.route('**/*', route => {const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {record.externalBrowserRequests.push({origin: url.origin, path: url.pathname, blocked: true}); return route.abort();} return route.continue();});
    await context.tracing.start({screenshots: true, snapshots: true, sources: false});
    page = await context.newPage(); page.setDefaultTimeout(12_000);
    page.on('pageerror', error => record.pageErrors.push(error.message));
    page.on('request', request => {const url = new URL(request.url()); if (url.origin !== base) return; record.requests.push({path: url.pathname, method: request.method(), time: new Date().toISOString()}); if (request.method() === 'POST') record.apiMutations.push({path: url.pathname, time: new Date().toISOString()});});
    await page.goto(base, {waitUntil: 'networkidle'}); await page.getByRole('button', {name: 'Type a message', exact: true}).waitFor(); await screenshot('ordinary-first-use');
    await send('What can you do?'); await openGoals();
    await page.getByRole('checkbox', {name: 'Question from public sources', exact: true}).check();
    await page.getByRole('textbox', {name: 'Exact question', exact: true}).fill(question); await page.getByRole('textbox', {name: 'Public source URLs', exact: true}).fill(sourceUrl);
    await page.getByRole('checkbox', {name: 'Allow public web research for this goal', exact: true}).check(); await screenshot('explicit-source-question');
    await page.getByRole('button', {name: 'Save question and read sources', exact: true})[pointer]();
    await until(async () => {parent = (await get('/api/goals')).find(goal => goal.request === question); return parent;}, 'the exact question is saved');
    parent = await pollGoal(parent.id, goal => ['completed', 'needs_input', 'cancelled'].includes(goal.status), 'genuine native cited parent answer');
    const answer = acceptedAnswer(parent); await verifiedCitations(parent, answer); record.acceptedParentBefore = structuredClone(parent);
    await screenshot('supported-parent-answer', card(parent.id).getByRole('region', {name: 'Source-grounded answer', exact: true}));
    assertStep('Fresh ordinary source question has genuine local native decisions, both required facts, actual support acceptance and literal hash-checked retrieved citations.', {goalId: parent.id, answer: answer.text});

    await card(parent.id).getByRole('button', {name: 'Create research brief', exact: true})[pointer]();
    const titleInput = card(parent.id).getByRole('textbox', {name: 'Brief title', exact: true}), notesInput = card(parent.id).getByRole('textbox', {name: 'Your notes for the brief', exact: true});
    await titleInput.fill(title); await notesInput.fill(notes); const postsBeforeDraft = mutationCount();
    await screenshot('unsaved-exact-title-and-notes', notesInput); await closeGoals(); await openGoals();
    await restoredBriefForm(parent.id);
    assert.equal(await titleInput.inputValue(), title); assert.equal(await notesInput.inputValue(), notes);
    await page.reload({waitUntil: 'networkidle'}); await openGoals();
    await restoredBriefForm(parent.id);
    assert.equal(await titleInput.inputValue(), title); assert.equal(await notesInput.inputValue(), notes); assert.equal(mutationCount(), postsBeforeDraft);
    assertStep('An unsent brief title and personal note survive actual window close/reopen and browser reload, with no child submission or model work.');

    let deliveredChild;
    await page.route(base + '/api/goals/' + parent.id + '/brief', async route => {
      submittedKey = route.request().postDataJSON().requestKey;
      const response = await route.fetch(); assert(response.ok(), 'Actual brief creation must reach the real host before losing its acknowledgement.'); deliveredChild = await response.json();
      record.lostSubmission = {transport: 'The real host accepted the actual UI POST; only its browser acknowledgement was aborted.', status: response.status(), requestKey: submittedKey, goalId: deliveredChild.id};
      await route.abort('connectionfailed');
    }, {times: 1});
    await card(parent.id).getByRole('button', {name: 'Save and write brief', exact: true})[pointer]();
    const inspect = card(parent.id).getByRole('button', {name: 'Inspect saved briefs', exact: true}); await inspect.waitFor();
    await until(() => inspect.isEnabled(), 'uncertain submission settles before inspection');
    const unconfirmedNotice = card(parent.id).locator('.research-brief-create').getByRole('status').filter({hasText: 'Submission was not confirmed.'}); await unconfirmedNotice.waitFor();
    record.lostSubmission.notice = await unconfirmedNotice.innerText();
    const oneCreate = createCount(); assert.equal(oneCreate, 1); await screenshot('unconfirmed-creation-inspect-before-retry', inspect); await screenshot('unconfirmed-creation-explicit-notice', unconfirmedNotice); await inspect[pointer]();
    await until(() => deliveredChild, 'delivered child receipt');
    child = await snapshotGoal(deliveredChild.id); await card(child.id).waitFor();
    assert.equal(createCount(), oneCreate); assert.equal(child.brief.requestKey, submittedKey); assert.equal(child.brief.title, title); assert.equal(child.brief.notes, notes); assert.equal(child.parentGoalId, parent.id); assert.equal(child.projectId, parent.projectId);
    assert.equal((await get('/api/goals')).filter(goal => goal.brief?.requestKey === submittedKey).length, 1);
    assertStep('Lost actual-create acknowledgement offers explicit GET inspection and retains exactly one request-keyed child with exact title, note and parent; no automatic replay.', {requestKey: submittedKey, childGoalId: child.id});
    const sourceTasks = child.tasks.filter(task => task.id !== 'source-brief');
    assert(sourceTasks.some(task => task.sourceAnswer)); assert(sourceTasks.every(task => task.status === 'verified' && task.attempts === 0));
    assert(!child.events.some(event => event.phase === 'fetching_source')); await verifiedCitations(child, child.tasks.find(task => task.sourceAnswer).execution.sourceAnswer);
    for (const copy of child.sources) {const original = parent.sources.find(source => source.id === copy.copiedFrom?.sourceId); assert(original); for (const field of ['url', 'requestedUrl', 'title', 'retrievedAt', 'type', 'bytes', 'sha256', 'textSha256', 'normalization']) assert.equal(copy[field], original[field]);}
    assert.deepEqual(await snapshotGoal(parent.id), parent);
    assertStep('Dependent child reuses accepted source/answer milestones with zero attempts, distinct verified copies, original retrieval identities and no parent mutation or refetch.');

    child = await pollGoal(child.id, goal => briefTask(goal)?.status === 'running' || ['completed', 'needs_input', 'cancelled'].includes(goal.status), 'actual native writing starts');
    if (child.status === 'needs_input') record.failedChild = structuredClone(child);
    assert.equal(briefTask(child).status, 'running', 'The real brief must remain active for an explicit user Stop. ' + goalDiagnostic(child));
    await card(child.id).getByRole('button', {name: 'Stop goal', exact: true})[pointer]();
    child = await pollGoal(child.id, goal => goal.status === 'cancelled', 'visible Stop saves cancellation'); record.stoppedChild = structuredClone(child);
    const stoppedPosts = mutationCount(); await closeGoals(); await openGoals(); await page.reload({waitUntil: 'networkidle'}); await openGoals();
    const stopped = await snapshotGoal(child.id); assert.deepEqual(stopped, child); assert.equal(mutationCount(), stoppedPosts); assert.equal(stopped.brief.title, title); assert.equal(stopped.brief.notes, notes);
    const savedNotes = card(child.id).locator('summary').filter({hasText: /^Saved notes and document identity$/}).locator('..');
    if (!await savedNotes.evaluate(element => element.open)) await savedNotes.locator('> summary')[pointer]();
    assert((await savedNotes.innerText()).includes(notes));
    await screenshot('stopped-child-saved-personal-note', savedNotes);
    await screenshot('stopped-child-keeps-notes-and-dependencies', card(child.id).getByRole('button', {name: 'Continue remaining work', exact: true}));
    assertStep('Visible Stop retains exact saved title/note, dependencies and evidence through actual window close/reload; reopening does not resume or repeat accepted work.');

    await card(child.id).getByRole('button', {name: 'Continue remaining work', exact: true})[pointer]();
    child = await pollGoal(child.id, goal => !!goal.briefState?.draft || ['completed', 'needs_input', 'cancelled'].includes(goal.status), 'a real native writing decision is persisted before artifact creation');
    if (child.status === 'needs_input') record.failedChild = structuredClone(child);
    assert(child.briefState?.draft && child.briefState.draftSha256, 'A real persisted native draft is required. ' + goalDiagnostic(child));
    assert.equal(briefTask(child).status, 'running', 'The owned host must be interrupted during the real draft/review/render lifecycle. ' + goalDiagnostic(child));
    assert.notEqual(child.briefState.phase, 'saved', 'The real interruption must precede saved artifact completion.');
    record.interruptedCheckpoint = structuredClone(child); const draft = structuredClone(child.briefState.draft), draftSha256 = child.briefState.draftSha256;
    const postsBeforeRestart = mutationCount(); await stopHost(host, 'SIGKILL'); host = undefined; await boot();
    await page.reload({waitUntil: 'networkidle'}); await openGoals();
    child = await pollGoal(child.id, goal => goal.status === 'needs_input', 'restart exposes interrupted work and explicit continuation');
    assert.deepEqual(child.briefState.draft, draft); assert.equal(child.briefState.draftSha256, draftSha256); assert.equal(child.brief.notes, notes); assert.equal(mutationCount(), postsBeforeRestart);
    assert(child.tasks.filter(task => task.id !== 'source-brief').every(task => task.status === 'verified' && task.attempts === 0));
    const resume = card(child.id).getByRole('button', {name: 'Continue remaining work', exact: true}); await resume.waitFor();
    const savedWriting = card(child.id).locator('summary').filter({hasText: /^Saved native writing and support review$/}).locator('..');
    if (!await savedWriting.evaluate(element => element.open)) await savedWriting.locator('> summary')[pointer]();
    for (const paragraph of draft.paragraphs) assert((await savedWriting.innerText()).includes(paragraph.text), 'The original interrupted native draft must remain inspectable in the actual work window.');
    const originalDecision = savedWriting.locator('summary').filter({hasText: /^Original native writing decision$/}).locator('..');
    if (!await originalDecision.evaluate(element => element.open)) await originalDecision.locator('> summary')[pointer]();
    const originalJson = originalDecision.getByLabel('Original native writing decision JSON', {exact: true});
    assert.deepEqual(JSON.parse(await originalJson.textContent()), child.briefState.writingAttempt.raw, 'The original saved native decision must be inspectable without presentation rewriting.');
    await screenshot('interrupted-original-native-writing', originalJson);
    if (child.briefState.presentation) {
      const presented = card(child.id).getByRole('region', {name: 'Presented brief', exact: true}); await presented.waitFor();
      for (const paragraph of child.briefState.presentation.draft.paragraphs) assert((await presented.innerText()).includes(paragraph.text), 'The separately labelled presented brief must show the exact supported projection.');
      await screenshot('interrupted-presented-brief', presented);
    }
    await screenshot('interrupted-saved-native-writing', savedWriting);
    await screenshot('interrupted-native-draft-explicit-continuation', resume);
    assertStep('A real SIGKILL after native draft persistence restarts into needs_input; accepted research, exact saved draft/hash/title/notes survive without automatic replay.', {draftSha256, phaseBeforeKill: record.interruptedCheckpoint.briefState.phase});
    await resume[pointer]();
    child = await pollGoal(child.id, goal => ['completed', 'needs_input', 'cancelled'].includes(goal.status), 'native support and actual document artifact reach acceptance');
    assert.equal(child.status, 'completed', child.message); assert.equal(briefTask(child).status, 'verified'); assert.equal(briefTask(child).review?.accepted, true);
    assert.deepEqual(child.briefState.draft, draft); assert.equal(child.briefState.draftSha256, draftSha256); assert.equal(child.briefState.supportReview?.supported, true);
    const rawWriting = child.briefState.writingAttempt;
    assert(rawWriting?.raw && rawWriting.sha256, 'The original native decision and its content identity must be retained.');
    assert.equal(sha(JSON.stringify(rawWriting.raw)), rawWriting.sha256, 'The original native writing decision hash must match its exact retained object.');
    assert.deepEqual(rawWriting.raw, child.briefState.draft, 'A valid native draft must preserve its original decision exactly.');
    assert.deepEqual(rawWriting, record.interruptedCheckpoint.briefState.writingAttempt, 'Explicit continuation must retain the exact raw native decision captured before interruption.');
    const presentation = child.briefState.presentation;
    if (presentation) {
      assert.equal(presentation.version, 'brief-inline-v1'); assert.equal(sha(JSON.stringify(presentation.draft)), presentation.sha256);
      assert(presentation.method?.trim(), 'Any fixed host presentation projection must identify its method.');
      assert.deepEqual(presentation.draft.paragraphs.map(paragraph => paragraph.citations), draft.paragraphs.map(paragraph => paragraph.citations), 'Presentation must preserve native citation selections.');
    }
    record.presentationChecks = {rawNativeSha256: rawWriting.sha256, presentationVersion: presentation?.version, presentationSha256: presentation?.sha256, method: presentation?.method, scope: 'Raw native decision retained; any format-only host presentation is separately identified.'};
    const displayedDraft = presentation?.draft || child.briefState.draft;
    assert.equal(displayedDraft.paragraphs.length, 1, 'This focused brief needs one useful paragraph without repetitive filler.');
    const written = displayedDraft.paragraphs[0].text;
    for (const pattern of [/web-platform-tests\/wpt/i, /fetch\//i, /wpt\.fyi\/results\/fetch/i]) assert.match(written, pattern, 'The actual written prose must supply both requested locations, not merely include them in references.');
    assert(!compact(written).includes(compact(answer.limit)), 'Host-provenance text must not appear in the factual paragraph with a source citation.');
    record.boundedDocumentCritique = {oneFocusedParagraph: true, actualProseGivesBothLocations: true, reproducedProvenanceMisattributionAbsent: true, scope: 'Specific Fetch facts and exact host-limit regression, not a general semantic citation validator.'};
    assert.equal(child.briefState.phase, 'saved'); const artifact = artifactOf(child); assert(artifact?.documentId); assert.equal(artifact.draftSha256, draftSha256); assert.equal(artifact.inputSha256, child.briefState.inputSha256); assert.equal(artifact.title, title);
    if (presentation) {assert.equal(artifact.presentationVersion, presentation.version); assert.equal(artifact.presentationSha256, presentation.sha256);}
    assert.equal(child.events.filter(event => event.phase === 'writing_document').length, record.interruptedCheckpoint.events.filter(event => event.phase === 'writing_document').length, 'Explicit continuation after the persisted draft must not repeat native writing.');
    assert(child.tasks.filter(task => task.id !== 'source-brief').every(task => task.status === 'verified' && task.attempts === 0));
    assert(!child.events.some(event => event.phase === 'fetching_source'));
    if (viewportName === 'narrow') assert(artifact.pages >= 2, 'The substantive personal handoff must produce a real multipage phone artifact, not a single-page navigation substitute.');
    record.completedChild = structuredClone(child); record.artifact = artifact;
    assert.equal((await get('/api/goals')).filter(goal => goal.brief?.requestKey === submittedKey).length, 1); assert.equal((await get('/api/documents')).length, 1);
    assert.deepEqual(await snapshotGoal(parent.id), parent);
    assertStep('Explicit continuation reuses the exact persisted native draft, passes actual support review and host artifact acceptance, and produces one document while preserving the parent.');

    const pdf = await download('Download brief PDF', 'fetch-test-contributor-brief.pdf'), html = await download('Download brief HTML', 'fetch-test-contributor-brief.html');
    assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-'); assert.match(pdf.receipt.type, /^application\/pdf\b/i); assert.equal(pdf.receipt.sha256, artifact.pdfSha256);
    assert.match(html.bytes.toString('utf8'), /<!doctype html/i); assert.match(html.receipt.type, /^text\/html\b/i); assert.equal(html.receipt.sha256, artifact.htmlSha256);
    const python = process.env.PYTHON_PATH || join(studioRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const inspected = await exec(python, ['-c', "import json,sys,pathlib,pymupdf as fitz\np=fitz.open(sys.argv[1]);out=pathlib.Path(sys.argv[2]);pages=[]\nfor i,page in enumerate(p):\n page.get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(str(out/('downloaded-pdf-page-'+str(i+1)+'.png')))\n pages.append({'number':i+1,'width':page.rect.width,'height':page.rect.height,'text':page.get_text(),'links':[{'uri':link.get('uri'),'kind':link.get('kind'),'rect':list(link['from'])} for link in page.get_links()]})\nprint(json.dumps({'pages':pages,'pageCount':len(p),'metadata':p.metadata}))", pdf.path, folder], {maxBuffer: 4_000_000});
    const pdfInspection = JSON.parse(inspected.stdout); await writeFile(join(folder, 'pdf-inspection.json'), JSON.stringify(pdfInspection, null, 2) + '\n'); record.pdfInspection = {path: 'pdf-inspection.json', pages: pdfInspection.pageCount, textComparison: 'Unicode NFKC for standard font ligatures, then layout whitespace removed; no other characters omitted.'};
    assert.equal(pdfInspection.pageCount, artifact.pages); assert(pdfInspection.pageCount >= 1); const extracted = pdfInspection.pages.map(value => value.text).join('\n');
    for (const expected of [title, notes, written, 'web-platform-tests/wpt', 'wpt.fyi/results/fetch', sourceUrl, ...child.sources.flatMap(source => [source.title, source.retrievedAt, source.sha256, source.textSha256]), ...answer.citations.map(citation => citation.quote)]) assert(pdfCompact(extracted).includes(pdfCompact(expected)), 'Actual PDF text must include ' + expected);
    assert.equal(pdfCompact(extracted).split(pdfCompact(answer.limit)).length - 1, 1, 'The actual PDF keeps the host provenance once in its separate scope section.');
    const pdfLinks = pdfInspection.pages.flatMap(value => value.links);
    for (const source of child.sources) assert(pdfLinks.some(link => link.uri === source.url), 'Actual PDF annotations must preserve each complete original source URL without inserted layout spaces.');
    for (const value of pdfInspection.pages) for (const link of value.links) {const [left, top, right, bottom] = link.rect; assert(left >= 0 && top >= 0 && right <= value.width && bottom <= value.height && right > left && bottom > top, 'Actual PDF source-link rectangles must fit their pages.');}
    for (const [index, citation] of answer.citations.entries()) {const label = 'Reference [' + (index + 1) + ']'; const referencePage = pdfInspection.pages.find(value => pdfCompact(value.text).includes(pdfCompact(label))); assert(referencePage, 'Each PDF reference label must be present.'); assert(pdfCompact(referencePage.text).includes(pdfCompact(citation.quote.slice(0, 45))), 'A PDF reference label must stay on the page with its quotation opening.');}
    record.renderedPages = Array.from({length: pdfInspection.pageCount}, (_, index) => 'downloaded-pdf-page-' + (index + 1) + '.png');
    assertStep('Actual browser PDF download signature/hash and independent exact-URL matching-body MIME pass; PyMuPDF rendering/extracted text preserves every requested fact/note/source identity/literal citation.', {pages: pdfInspection.pageCount, pdfSha256: pdf.receipt.sha256});

    for (const viewport of layoutViewports) {
      await page.setViewportSize(viewport); await openGoals();
      for (const name of ['Open PDF in editor', 'Open brief HTML', 'Download brief PDF', 'Download brief HTML']) await reachable(action(card(child.id), name), name);
      await screenshot('saved-brief-actions-' + viewport.width + 'x' + viewport.height, action(card(child.id), 'Open PDF in editor'));
    }
    await action(card(child.id), 'Open PDF in editor')[pointer]();
    async function decodedPdfPage(number) {
      const image = page.getByRole('img', {name: 'PDF page ' + number, exact: true}); await image.waitFor();
      await until(() => image.evaluate((element, expected) => element.complete && element.naturalWidth > 0 && new URL(element.src).searchParams.get('page') === String(expected), number), 'ordinary PDF window actually decodes saved page ' + number);
      return image;
    }
    record.pdfPagesSeen = [];
    for (let number = 1; number <= artifact.pages; number++) {
      const image = await decodedPdfPage(number); record.pdfPagesSeen.push(number);
      await page.getByText('Page ' + number + ' of ' + artifact.pages, {exact: true}).waitFor();
      if (number === 1 || number === artifact.pages) await screenshot('actual-pdf-page-' + number, image);
      if (number < artifact.pages) {const next = page.getByRole('button', {name: 'Next PDF page', exact: true}); await reachable(next, 'Next PDF page'); await next[pointer]();}
    }
    record.multiPageWindowExercised = artifact.pages > 1;
    const lastPageNumber = artifact.pages;
    assert(await page.getByRole('button', {name: 'Next PDF page', exact: true}).isDisabled());
    if (artifact.pages > 1) {
      const previous = page.getByRole('button', {name: 'Previous PDF page', exact: true}); await reachable(previous, 'Previous PDF page'); if (viewportName === 'narrow') await previous.tap(); else await previous.press('Enter'); await decodedPdfPage(lastPageNumber - 1);
      await page.getByRole('button', {name: 'Next PDF page', exact: true})[pointer](); await decodedPdfPage(lastPageNumber);
    } else assert(await page.getByRole('button', {name: 'Previous PDF page', exact: true}).isDisabled());
    for (const viewport of layoutViewports) {
      await page.setViewportSize(viewport); const image = await decodedPdfPage(lastPageNumber);
      const fit = page.getByRole('button', {name: 'Fit PDF width', exact: true}), zoomIn = page.getByRole('button', {name: 'Zoom in PDF', exact: true}), zoomOut = page.getByRole('button', {name: 'Zoom out PDF', exact: true});
      if (await fit.isEnabled()) await fit[pointer]();
      assert(await fit.isDisabled()); assert(await zoomOut.isDisabled()); await reachable(zoomIn, 'Zoom in PDF');
      const before = await image.boundingBox(); assert(before && before.width > 0);
      const targetZoom = viewportName === 'narrow' ? 3 : 1.25;
      while ((await image.boundingBox()).width < before.width * targetZoom - 1) {
        const priorWidth = (await image.boundingBox()).width; assert(await zoomIn.isEnabled()); await zoomIn[pointer]();
        await until(async () => (await image.boundingBox())?.width > priorWidth + 1, 'Zoom tap increases the actual PDF image width');
      }
      const magnified = await image.boundingBox();
      if (viewportName === 'narrow') {assert(magnified.width >= before.width * 2.99); await page.locator('.pdf-zoom-controls').getByText('300%', {exact: true}).waitFor(); assert(await zoomIn.isDisabled());}
      for (const [control, name] of [[fit, 'Fit PDF width'], [zoomOut, 'Zoom out PDF']]) await reachable(control, name);
      const pan = await image.evaluate(element => {
        let scroller = element.parentElement;
        while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
        if (!scroller) return {scrollContainer: false};
        const beforeLeft = element.getBoundingClientRect().left, beforeTop = element.getBoundingClientRect().top;
        scroller.scrollLeft = scroller.scrollWidth; scroller.scrollTop = scroller.scrollHeight;
        return {scrollContainer: true, clientWidth: scroller.clientWidth, clientHeight: scroller.clientHeight, scrollWidth: scroller.scrollWidth, scrollHeight: scroller.scrollHeight, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop, beforeLeft, afterLeft: element.getBoundingClientRect().left, beforeTop, afterTop: element.getBoundingClientRect().top};
      });
      assert(pan.scrollContainer && pan.scrollWidth > pan.clientWidth && pan.scrollLeft > 0 && pan.afterLeft < pan.beforeLeft, 'Zoomed actual PDF image must allow intentional horizontal panning.');
      if (viewportName === 'narrow') assert(pan.scrollHeight > pan.clientHeight && pan.scrollTop > 0 && pan.afterTop < pan.beforeTop, 'The actual 300% phone page must allow vertical panning as well.');
      await screenshot('actual-pdf-zoom-pan-' + viewport.width + 'x' + viewport.height, zoomOut);
      if (viewportName === 'narrow') {
        await image.evaluate(element => {const scroller = element.closest('.pdf-page-scroll'); scroller.scrollLeft = 0; scroller.scrollTop = Math.min(180, scroller.scrollHeight - scroller.clientHeight);});
        await screenshot('actual-pdf-readable-300pct-' + viewport.width + 'x' + viewport.height, zoomOut);
      }
      await zoomOut[pointer](); await until(async () => (await image.boundingBox())?.width < magnified.width - 1, 'Zoom out reduces the actual page width');
      if (!await fit.isEnabled()) await zoomIn[pointer]();
      await fit[pointer](); await until(async () => (await image.boundingBox())?.width <= before.width + 1, 'Fit restores a contained readable page width');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'PDF zoom must not make the application body overflow.');
      (record.pdfZoomChecks ||= []).push({viewport, pointer, targetZoom, beforeWidth: before.width, magnifiedWidth: magnified.width, ...pan, panMechanism: 'Actual overflow view scroll positions; browser touch taps operate zoom controls. No physical swipe claim.', fitRestored: true});
      await screenshot('actual-pdf-window-' + viewport.width + 'x' + viewport.height, fit);
    }
    assertStep('The ordinary PDF window decodes each actual page, exposes reachable controls, supports real zoom/pan/fit on desktop/phone/short viewports and retains the last inspected page.', {pagesSeen: record.pdfPagesSeen, multiPageExercised: record.multiPageWindowExercised});
    const postsBeforeReturn = mutationCount();
    await closeWindow('PDF', page.locator('.pdf-preview'));
    await page.getByRole('tab', {name: 'Goals', exact: true})[pointer](); await card(child.id).waitFor();
    assert.equal(await card(child.id).locator('h3').textContent(), title);
    const returnedBrief = card(child.id).getByRole('region', {name: 'Presented brief', exact: true}); await returnedBrief.waitFor();
    assert((await returnedBrief.innerText()).includes(written));
    const returnedNotes = card(child.id).locator('summary').filter({hasText: /^Saved notes and document identity$/}).locator('..');
    if (!await returnedNotes.evaluate(element => element.open)) await returnedNotes.locator('> summary')[pointer]();
    assert((await returnedNotes.innerText()).includes(notes));
    await page.setViewportSize({width: 360, height: 800}); await screenshot('returned-to-correct-brief-work-window', returnedBrief);
    await screenshot('returned-brief-keeps-personal-note', returnedNotes);
    for (const source of child.sources) {
      const shownSource = card(child.id).getByRole('article', {name: 'Saved source ' + source.taskId, exact: true}); await shownSource.waitFor();
      assert.equal(await shownSource.getByRole('link', {name: source.url, exact: true}).getAttribute('href'), source.url);
      const identity = shownSource.locator('summary').filter({hasText: /^Content identity$/}).locator('..');
      if (!await identity.evaluate(element => element.open)) await identity.locator('> summary')[pointer]();
      for (const expected of [source.sha256, source.textSha256, source.id]) assert((await identity.innerText()).includes(expected));
      await screenshot('returned-brief-source-identity-' + source.taskId, identity);
    }
    assert.equal(mutationCount(), postsBeforeReturn); assert.deepEqual(await snapshotGoal(child.id), record.completedChild); assert.deepEqual(await snapshotGoal(parent.id), parent);
    assertStep('Closing the actual PDF and explicitly activating Goals returns to the correct saved brief, presented prose, personal note and checked source identity on a phone viewport without another mutation.');
    const htmlControl = action(card(child.id), 'Open brief HTML'), previewHref = await htmlControl.getAttribute('href');
    assert(previewHref, 'The supported HTML opening action must identify its saved document URL.'); const previewUrl = new URL(previewHref, base); assert.equal(previewUrl.origin, base); assert.equal(previewUrl.pathname, '/api/goals/' + child.id + '/brief/preview');
    const pendingPreview = context.waitForEvent('page'); pendingPreview.catch(() => {}); await htmlControl[pointer](); const exported = await pendingPreview; exported.setDefaultTimeout(12_000);
    await exported.waitForURL(previewUrl.href); await exported.waitForLoadState('domcontentloaded');
    const previewResponse = await page.request.get(previewUrl.href); assert(previewResponse.ok()); assert.deepEqual(await previewResponse.body(), html.bytes, 'The supported inline preview must display the exact actual browser-downloaded HTML bytes.');
    const previewHeaders = previewResponse.headers(); assert.match(previewHeaders['content-type'], /^text\/html\b/i); assert.match(previewHeaders['content-security-policy'] || '', /\bsandbox\b/); assert.match(previewHeaders['content-security-policy'] || '', /(?:script-src|default-src)\s+'none'/); assert.equal(previewHeaders['x-content-type-options'], 'nosniff'); assert.equal(previewHeaders['referrer-policy'], 'no-referrer');
    record.htmlOpenability = {transport: 'Actual visible Open brief HTML link opens the verified saved document through ordinary Studio HTTP.', path: previewUrl.pathname, byteIdenticalToBrowserDownload: true, sha256: sha(html.bytes), headers: Object.fromEntries(['content-type', 'content-security-policy', 'x-content-type-options', 'referrer-policy', 'content-disposition', 'cache-control'].filter(name => previewHeaders[name] !== undefined).map(name => [name, previewHeaders[name]])), fileUrlLimitation: 'The earlier genuine desktop file:// attempt was blocked with ERR_BLOCKED_BY_ADMINISTRATOR; no browser flags or policy settings were changed. Local-file opening remains unverified in this managed browser.'};
    const body = await exported.locator('body').innerText();
    for (const expected of [title, notes, written, 'web-platform-tests/wpt', 'wpt.fyi/results/fetch', sourceUrl, ...child.sources.flatMap(source => [source.title, source.retrievedAt, source.sha256, source.textSha256]), ...answer.citations.map(citation => citation.quote)]) assert(compact(body).includes(compact(expected)), 'Opened actual HTML must include ' + expected);
    assert.equal(compact(body).split(compact(answer.limit)).length - 1, 1, 'The actual HTML keeps the host provenance once in its separate scope section.');
    const htmlLinks = await exported.locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
    for (const source of child.sources) assert(htmlLinks.includes(source.url), 'Actual HTML anchors must preserve each complete original source URL.');
    record.sourceLinkChecks = {pdfUris: pdfLinks.map(link => link.uri).filter(Boolean), htmlHrefs: htmlLinks, containedPdfLinkRectangles: true, referenceLabelsWithQuoteOpenings: true};
    assert.equal(await exported.locator('script,iframe,form,object,embed').count(), 0, 'The document must not execute generated code or embed remote content.');
    for (const viewport of layoutViewports) {
      await exported.setViewportSize(viewport); assert(await exported.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Downloaded HTML must fit the viewport.');
      const file = 'downloaded-html-' + viewport.width + 'x' + viewport.height + '.png'; await exported.screenshot({path: join(folder, file)}); if (!record.screenshots.includes(file)) record.screenshots.push(file);
    }
    await exported.close(); assertStep('The visible Studio HTML action opens bytes identical to the actual download with complete presented prose/attribution/notes, restrictive sandbox headers, no generated executable elements and contained desktop/phone/short layout; managed file-URL opening remains blocked.');

    const finished = await snapshotGoal(child.id), completedPosts = mutationCount(); await stopHost(host, 'SIGTERM'); host = undefined; await boot(); await page.reload({waitUntil: 'networkidle'}); await openGoals();
    assert.deepEqual(await snapshotGoal(child.id), finished); assert.deepEqual(await snapshotGoal(parent.id), parent); assert.equal(mutationCount(), completedPosts);
    await card(child.id).waitFor(); await action(card(child.id), 'Open PDF in editor')[pointer](); await decodedPdfPage(lastPageNumber);
    await page.getByText('Page ' + lastPageNumber + ' of ' + artifact.pages, {exact: true}).waitFor();
    await screenshot('reopened-pdf-keeps-last-inspected-page', page.getByRole('button', {name: 'Fit PDF width', exact: true}));
    assert.equal((await get('/api/documents')).length, 1); assert.equal((await get('/api/goals')).filter(goal => goal.brief?.requestKey === submittedKey).length, 1);
    assertStep('Completed work reopens after actual SIGTERM/restart with exact unchanged parent/child/artifact identities, one PDF and no mutation or automatic replay.');
    assert.deepEqual(record.pageErrors, []); record.status = 'passed';
  } catch (error) {
    record.status = error instanceof BlockedGoal ? 'blocked' : 'failed'; record.reason = error.stack || String(error);
    if (page && !page.isClosed() && host?.exitCode === null && !host.signalCode) {
      try {if (child?.id) record.failedChild = await snapshotGoal(child.id); else if (parent?.id) record.failedParent = await snapshotGoal(parent.id);}
      catch (snapshotError) {record.failureSnapshotError = String(snapshotError);}
    }
    if (page && !page.isClosed()) try {await screenshot('failure');} catch {}
  } finally {
    if (context) {try {const path = join(folder, 'trace.zip'); await context.tracing.stop({path}); await redactTrace(path); record.trace = 'trace.zip'; record.traceSessionHeadersRedacted = true;} catch (error) {record.traceError = String(error); record.status = 'failed';} await context.close().catch(() => {});}
    await stopHost(host); record.finishedAt = new Date().toISOString(); record.goalAchieved = record.status === 'passed'; await save();
  }
  return record;
}

export async function runResearchDocumentSuite(options = {}) {
  options = {viewport: 'all', ...options}; assert(options.output, 'Choose a fresh --output evidence directory.'); options.output = resolve(studioRoot, options.output);
  const names = options.viewport === 'all' ? Object.keys(viewports) : [options.viewport]; assert(names.every(name => viewports[name]), 'Use desktop, narrow or all.');
  await access(join(studioRoot, 'out/index.html')); await mkdir(options.output);
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim();
  const report = {startedAt: new Date().toISOString(), source, sourceDirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: studioRoot, encoding: 'utf8'}).trim(), lane: 'fresh-real-native-research-and-document', results: [], ...await fingerprints(),
    notes: ['Actual user goals must complete; honest native/source blockers remain unmet with nonzero exit.', 'Private databases, keys and raw host logs stay local; fixture content is the public README plus the explicit test note.', 'No existing normal Studio/model process is stopped; only harness-owned Studio children are controlled.']};
  const executablePath = process.env.CHROME_PATH || '/usr/bin/chromium'; await access(executablePath); const browser = await chromium.launch({executablePath, headless: true});
  let interrupted = false; const cancel = () => {interrupted = true; void Promise.allSettled([...activeHosts].map(host => stopHost(host))).then(() => browser.close());};
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {for (const name of names) {if (interrupted) break; const result = await runCase(browser, name, options); report.results.push(result); console.log(result.status.toUpperCase() + ' research-document [' + name + '] ' + (result.reason || result.goal));}}
  finally {process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); await Promise.allSettled([...activeHosts].map(host => stopHost(host))); await browser.close();}
  try {
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim(), source, 'Source commit must remain fixed during acceptance.');
    assert.deepEqual(await fingerprints(), {applicationSource: report.applicationSource, servedBuild: report.servedBuild}, 'Source/served build must remain fixed during acceptance.');
  } catch (error) {report.verificationError = error.message;}
  report.summary = Object.fromEntries(['passed', 'blocked', 'failed'].map(status => [status, report.results.filter(result => result.status === status).length]));
  report.assertions = report.results.reduce((count, result) => count + result.assertions.length, 0); report.status = interrupted ? 'interrupted' : report.summary.failed || report.verificationError ? 'failed' : report.summary.blocked ? 'incomplete' : 'passed';
  report.goalAchieved = report.status === 'passed'; report.exitCode = interrupted ? 130 : report.summary.failed || report.verificationError ? 1 : report.summary.blocked ? 2 : 0; report.finishedAt = new Date().toISOString();
  await writeFile(join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const escape = value => String(value || '').replace(/[&<>\"]/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[character]));
  await writeFile(join(options.output, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Native research document journeys</title><style>body{font:16px/1.5 system-ui;max-width:980px;margin:24px}article{border-top:1px solid #ccd3da;padding:20px 0}code{overflow-wrap:anywhere}</style><h1>Native research → document: ${escape(report.status)}</h1><p>${report.summary.passed} achieved; ${report.summary.blocked} blocked; ${report.summary.failed} failed. ${report.assertions} assertions.</p><p>${escape(report.verificationError)}</p><p>Source <code>${escape(report.source)}</code>; working copy changed: ${report.sourceDirty}.</p><p><a href="report.json">Full report and source/build fingerprints</a></p>${report.results.map(result => `<article><h2>${escape(result.viewport)} · ${escape(result.status)}</h2><p>${escape(result.goal)}</p><p>${escape(result.reason)}</p><p><a href="${result.artifactDirectory}/result.json">Receipt</a></p><ul>${result.screenshots.map(file => `<li><a href="${result.artifactDirectory}/${file}">${escape(file)}</a></li>`).join('')}</ul><p>Independent renders of actual downloaded PDF pages:</p><ul>${(result.renderedPages || []).map(file => `<li><a href="${result.artifactDirectory}/${file}">${escape(file)}</a></li>`).join('')}</ul></article>`).join('')}</html>`);
  return report;
}

async function main() {
  const options = {}, args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {const flag = args[index]; assert(['--viewport', '--output'].includes(flag) && args[index + 1] && !args[index + 1].startsWith('--'), 'Usage: node scripts/e2e/research-document.mjs --viewport all|desktop|narrow --output FRESH_DIR'); options[flag.slice(2)] = args[++index];}
  const report = await runResearchDocumentSuite(options); process.exitCode = report.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
