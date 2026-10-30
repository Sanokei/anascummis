#!/usr/bin/env node
/** Genuine current-version rewrite and expanded-review acceptance.
 * Uses a stopped copy of a previously accepted v1 brief, never normal data.
 * No model, dependency, configuration or provider is installed by this runner. */
import assert from 'node:assert/strict';
import {spawn, execFile, execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {access, mkdir, readFile, readdir, writeFile, copyFile, realpath} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {redactTrace} from './artifacts.mjs';

const studioRoot = fileURLToPath(new URL('../../', import.meta.url));
const viewports = {desktop: {width: 1440, height: 1000}, narrow: {width: 360, height: 420}};
const intent = 'Shorten the current summary to one sentence for a newcomer; keep both exact locations and citations and do not change notes/evidence.';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compact = text => text.normalize('NFKC').replace(/\s+/gu, '');
const presentedInline = text => text.replace(/(?<![\\`])`([^`\r\n]+)`(?!`)/gu, '$1').replace(/(?<!!|\\)\[([^\]\r\n]+)\]\((https:\/\/[^\s()<>]+)\)/gu, '$1');
const literalHttps = text => (text.match(/https:\/\/[^\s<>"`]+/gu) || []).map(value => value.replace(/[),.;!?]+$/u, ''));
const activeHosts = new Set(), exec = promisify(execFile);
class BlockedGoal extends Error {}
async function until(check, label, milliseconds = 30_000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {const value = await check(); if (value) return value; await delay(35);}
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
async function fileManifest(root) {
  const result = [];
  async function walk(path, prefix = '') {
    for (const item of await readdir(path, {withFileTypes: true})) {
      assert(!item.isSymbolicLink(), 'Fixture symlinks are excluded: ' + prefix + item.name);
      if (item.isDirectory()) await walk(join(path, item.name), prefix + item.name + '/');
      else if (item.isFile()) {const bytes = await readFile(join(path, item.name)); result.push({path: prefix + item.name, bytes: bytes.length, sha256: sha(bytes)});}
      else throw new Error('Unsupported fixture entry: ' + prefix + item.name);
    }
  }
  await walk(root); return result.sort((a, b) => a.path.localeCompare(b.path));
}
async function copyFixture(source, destination) {
  const manifest = await fileManifest(source);
  for (const item of manifest) {const target = join(destination, item.path); await mkdir(dirname(target), {recursive: true}); await copyFile(join(source, item.path), target);}
  assert.deepEqual(await fileManifest(destination), manifest); return manifest;
}
async function fingerprints() {
  const result = [];
  async function walk(folder, prefix) {
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      if (entry.isSymbolicLink() || ['node_modules', '.next', '.test-data', 'opensource', '__pycache__'].includes(entry.name)) continue;
      const path = join(folder, entry.name), name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, name + '/');
      else if (/\.(?:ts|tsx|mjs|js|py|css|html|json)$/.test(name)) {const bytes = await readFile(path); result.push({path: name, bytes: bytes.length, sha256: sha(bytes)});}
    }
  }
  for (const name of ['app', 'components', 'core', 'worker', 'out']) await walk(join(studioRoot, name), name + '/');
  for (const name of ['scripts/e2e/research-document-second-edit.mjs', 'scripts/e2e/artifacts.mjs', 'package.json', 'bun.lock']) {const bytes = await readFile(join(studioRoot, name)); result.push({path: name, bytes: bytes.length, sha256: sha(bytes)});}
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function stableParent(goal) {const next = structuredClone(goal); delete next.briefEditEligibility; return next;}
function checkRewrite(raw, before) {
  assert(raw && typeof raw.text === 'string', 'The actual native response must expose its factual text.');
  const text = raw.text;
  assert(text.trim() && !/[\r\n]/u.test(text));
  assert(/[.!?]$/u.test(text.trim()) && !/[.!?]\s+\S/u.test(text.trim()), 'The actual native rewrite must be one sentence.');
  assert(text.length < before.length, 'The actual native rewrite must shorten the current rendered summary.');
  for (const pattern of [/fetch\//iu, /web-platform-tests\/wpt/iu, /wpt\.fyi\/results\/fetch/iu]) assert.match(text, pattern, 'Both exact locations must remain in the actual native text.');
  assert(!/(?:^|\s)(?:Tests:|Browser results:)/iu.test(text), 'The requested newcomer sentence must not retain the old topic labels.');
  assert(!/`|\[[^\]]+\]\(|\[\d+(?:,\s*\d+)*\]/u.test(text), 'The native text must be plain prose; citation numbers belong in the separate field.');
  assert(Array.isArray(raw.citations) && raw.citations.length === 2 && new Set(raw.citations).size === 2);
  assert.deepEqual([...raw.citations].sort(), [1, 2]);
  return {text, characters: text.length, beforeCharacters: before.length, oneSentence: true, shorter: true, bothLocations: true, citationsPreserved: true, plainProse: true};
}
function findSampling(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.temperature === .7 && value.top_p === .8 && value.top_k === 20 && value.min_p === 0 && value.seed === 42) return value;
  for (const child of Object.values(value)) {const found = findSampling(child); if (found) return found;}
}

async function runCase(browser, viewportName, options) {
  const folder = join(options.output, 'research-document-second-edit-' + viewportName); await mkdir(folder);
  const data = join(folder, 'private-data'); await mkdir(data); const fixtureManifest = await copyFixture(options.fixture, data);
  const port = await freePort(), base = 'http://127.0.0.1:' + port, pointer = viewportName === 'narrow' ? 'tap' : 'click';
  const record = {id: 'native-current-version-summary-rewrite', viewport: viewportName, lane: 'accepted-v1-real-native-second-edit', goal: intent,
    status: 'running', startedAt: new Date().toISOString(), fixture: {path: options.fixture, manifest: fixtureManifest}, assertions: [], screenshots: [],
    processes: [], cuts: [], requests: [], apiMutations: [], progress: [], downloads: [], pageErrors: [], externalBrowserRequests: [],
    limitations: ['Reuses a stopped copy of previously genuine accepted v1 research; no accepted research or first edit is regenerated.',
      'This is a native rewrite of a verified structured summary under a document-only measured decoding profile, not general imported-PDF editing or a global model/profile upgrade.',
      'Chromium desktop/touch/keyboard emulation on the prepared Linux host; physical devices, native OS installs and voice are unverified.',
      'The intentional competing proposal is a stale-base negative test, not a second user-goal success or a duplicate lost-acknowledgement submission.']};
  let host, context, page, parent, original, child, competitor, sequence = 0;
  const save = () => writeFile(join(folder, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  const check = (name, evidence = {}) => record.assertions.push({name, passed: true, ...evidence});
  const card = id => page.locator('[data-goal-id="' + id + '"]');
  const action = (id, name) => card(id).getByRole('button', {name, exact: true}).or(card(id).getByRole('link', {name, exact: true})).first();
  const dialog = () => page.getByRole('dialog', {name: 'Review summary edit', exact: true});
  const mutationCount = () => record.apiMutations.length;
  async function screenshot(name, target) {
    if (target) await target.scrollIntoViewIfNeeded(); const file = String(++sequence).padStart(2, '0') + '-' + name + '.png';
    await page.screenshot({path: join(folder, file)}); record.screenshots.push(file);
  }
  async function boot() {
    const log = createWriteStream(join(folder, 'host-' + (record.processes.length + 1) + '.log'));
    const proc = spawn(process.env.BUN_PATH || 'bun', ['core/server.ts'], {cwd: studioRoot, env: {...process.env, STUDIO_DATA: data, STUDIO_TEST_DATA: data, STUDIO_PORT: String(port), STUDIO_DEV: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
    host = proc; activeHosts.add(proc); let spawnError; proc.once('error', error => {spawnError = error;}); proc.stdout.pipe(log); proc.stderr.pipe(log); proc.once('exit', () => log.end());
    record.processes.push({pid: proc.pid, port, startedAt: new Date().toISOString(), command: 'bun core/server.ts'});
    await until(async () => {if (spawnError) throw spawnError; if (proc.exitCode !== null || proc.signalCode) throw new Error('Owned Studio exited before readiness'); try {const r = await fetch(base + '/api/status', {signal: AbortSignal.timeout(2000)}); if (r.ok) {record.runtime = await r.json(); return true;}} catch {}}, 'owned ordinary Studio readiness');
  }
  async function get(path) {const r = await page.request.get(base + path); assert(r.ok(), path + ' returned ' + r.status()); return r.json();}
  async function post(path, body, expectSuccess = true) {
    const r = await page.request.post(base + path, {headers: {'Content-Type': 'application/json', 'Origin': base, 'X-Requested-With': 'Anascummis'}, data: body});
    const value = await r.json(); record.apiMutations.push({path, method: 'POST', time: new Date().toISOString(), explicitApiNegativeOrReconciliation: true, status: r.status()});
    if (expectSuccess) assert(r.ok(), path + ': ' + JSON.stringify(value)); return {status: r.status(), ok: r.ok(), value};
  }
  async function closeComposer() {const close = page.getByRole('button', {name: 'Close text input', exact: true}); if (await close.isVisible()) await close[pointer]();}
  async function openGoals() {
    if (await page.locator('.goal-panel').isVisible()) return;
    const help = page.getByRole('region', {name: 'Getting started', exact: true});
    if (!await help.isVisible()) {
      await page.getByRole('button', {name: 'Type a message', exact: true})[pointer](); await page.getByRole('textbox', {name: 'Message Anascummis', exact: true}).fill('What can you do?');
      await page.getByRole('button', {name: 'Send message', exact: true})[pointer](); await closeComposer();
    }
    await help.getByRole('button', {name: 'Open Goals', exact: true})[pointer](); await page.locator('.goal-panel').waitFor();
  }
  async function closeWindow(name, content) {const tab = page.getByRole('tab', {name, exact: true}); if (viewportName === 'narrow') await tab.getByTitle('Close', {exact: true}).tap(); else {await tab.focus(); await page.keyboard.press('Control+Delete');} await content.waitFor({state: 'hidden'});}
  async function continueGoal(id = child.id) {
    const waiting = page.waitForResponse(r => r.url() === base + '/api/goals/' + id + '/resume' && r.request().method() === 'POST'); waiting.catch(() => {});
    await action(id, 'Continue remaining work')[pointer](); const r = await waiting; assert(r.ok(), 'Explicit Continue must be acknowledged'); await r.finished();
  }
  async function pollGoal(id, predicate, label, milliseconds = 180_000) {
    let value, previous = ''; await until(async () => {
      value = await get('/api/goals/' + id); const state = JSON.stringify([value.status, value.phase, value.documentEditState?.phase, !!value.documentEditState?.writingAttempt, !!value.documentEditState?.supportReview]);
      if (state !== previous) {previous = state; record.progress.push({time: new Date().toISOString(), id, status: value.status, phase: value.phase, editPhase: value.documentEditState?.phase, rawSaved: !!value.documentEditState?.writingAttempt, reviewed: !!value.documentEditState?.supportReview}); await save(); console.log('ACTIVE second-edit [' + viewportName + '] ' + value.status + ' · ' + value.phase + ' · ' + (value.documentEditState?.phase || 'no checkpoint'));}
      return predicate(value);
    }, label, milliseconds); return value;
  }
  async function reachable(control, name) {
    await control.scrollIntoViewIfNeeded(); await control.focus(); const r = await control.evaluate(element => {const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, focused: document.activeElement === element, hit: hit === element || element.contains(hit), viewportWidth: innerWidth, viewportHeight: innerHeight};});
    assert(r.focused && r.hit, name + ' must receive focus and a visible pointer/touch hit'); assert(r.height >= 44 && r.width >= 44, name + ' must provide a 44px target');
    assert(r.left >= 0 && r.right <= r.viewportWidth && r.top >= 0 && r.bottom <= r.viewportHeight, name + ' must fit the viewport'); (record.controlLayout ||= []).push({name, viewport: page.viewportSize(), ...r});
  }
  async function disclose(id, summaryText) {const details = card(id).locator('summary').filter({hasText: new RegExp('^' + summaryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')}).locator('..'); if (await details.count() && !await details.evaluate(element => element.open)) await details.locator('> summary')[pointer]();}
  async function download(id, label, filename) {
    const control = action(id, label), href = await control.getAttribute('href'); assert(href, label + ' must expose a pinned URL'); const url = new URL(href, base); assert.equal(url.origin, base);
    const waiting = page.waitForEvent('download', {timeout: 20_000}); waiting.catch(() => {}); await control[pointer](); const file = await waiting; assert.equal(await file.failure(), null);
    const path = join(folder, filename); await file.saveAs(path); const bytes = await readFile(path), probe = await page.request.get(url.href); assert(probe.ok()); assert.deepEqual(await probe.body(), bytes);
    const receipt = {path: filename, bytes: bytes.length, sha256: sha(bytes), suggestedFilename: file.suggestedFilename(), type: probe.headers()['content-type'], headerProbe: {method: 'GET', path: url.pathname + url.search, status: probe.status(), byteIdentical: true}};
    record.downloads.push(receipt); return {path, bytes, receipt};
  }
  async function storedGoalIdentities(ids) {
    const python = process.env.PYTHON_PATH || join(studioRoot, '.venv/bin/python');
    const r = await exec(python, ['-c', "import sqlite3,sys,json,hashlib\ndb=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);result={}\nfor id in json.loads(sys.argv[2]):\n row=db.execute('SELECT body FROM goal_tasks WHERE id=?',(id,)).fetchone();body=row[0].encode();result[id]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}\nprint(json.dumps(result))", join(data, 'studio.sqlite'), JSON.stringify(ids)]); return JSON.parse(r.stdout);
  }
  async function openReview() {await action(child.id, 'Review proposed change')[pointer](); await dialog().waitFor();}
  async function cancelReview(keyboard = false) {
    const posts = mutationCount(), before = await get('/api/goals/' + child.id);
    if (keyboard) {await dialog().getByRole('button', {name: 'Cancel review', exact: true}).focus(); await page.keyboard.press('Escape');}
    else await dialog().getByRole('button', {name: 'Cancel review', exact: true})[pointer]();
    await dialog().waitFor({state: 'hidden'}); assert.equal(mutationCount(), posts, 'Cancel/Escape must not submit or Stop'); assert.deepEqual(await get('/api/goals/' + child.id), before);
    assert(await action(child.id, 'Review proposed change').evaluate(element => element === document.activeElement), 'Closing review must restore trigger focus');
  }
  async function decodedPdfPage(number) {const image = page.getByRole('img', {name: 'PDF page ' + number, exact: true}); await image.waitFor(); await until(() => image.evaluate((element, n) => element.complete && element.naturalWidth > 0 && new URL(element.src).searchParams.get('page') === String(n), number), 'PDF image decodes page ' + number);}

  try {
    await boot(); if (!record.runtime.model?.ready) throw new BlockedGoal('Genuine local AI is unavailable; this current-version rewrite goal is unmet.');
    context = await browser.newContext({viewport: viewports[viewportName], hasTouch: viewportName === 'narrow', acceptDownloads: true, timezoneId: 'America/New_York', reducedMotion: 'reduce'});
    await context.route('**/*', route => {const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {record.externalBrowserRequests.push({origin: url.origin, path: url.pathname, blocked: true}); return route.abort();} return route.continue();});
    await context.tracing.start({screenshots: true, snapshots: true, sources: false}); page = await context.newPage(); page.setDefaultTimeout(12_000); page.on('pageerror', e => record.pageErrors.push(e.message));
    page.on('request', request => {const url = new URL(request.url()); if (url.origin !== base) return; const r = {path: url.pathname, method: request.method(), time: new Date().toISOString()}; record.requests.push(r); if (r.method === 'POST') record.apiMutations.push(r);});
    await page.goto(base, {waitUntil: 'networkidle'}); await openGoals(); await runJourney(); assert.deepEqual(record.pageErrors, []); record.status = 'passed';
  } catch (error) {
    record.status = error instanceof BlockedGoal ? 'blocked' : 'failed'; record.reason = error.stack || String(error);
    if (page && !page.isClosed()) {try {record.failedGoals = await get('/api/goals');} catch (e) {record.failureSnapshotError = String(e);} try {await screenshot('failure');} catch {}}
  } finally {
    if (context) {try {await context.tracing.stop({path: join(folder, 'trace.zip')}); await redactTrace(join(folder, 'trace.zip')); record.trace = 'trace.zip'; record.traceSessionHeadersRedacted = true;} catch (e) {record.traceError = String(e); record.status = 'failed';} await context.close().catch(() => {});}
    await stopHost(host); record.fixture.unchanged = JSON.stringify(await fileManifest(options.fixture)) === JSON.stringify(fixtureManifest); if (!record.fixture.unchanged) record.status = 'failed';
    record.finishedAt = new Date().toISOString(); record.goalAchieved = record.status === 'passed'; await save();
  }
  return record;

  async function runJourney() {
    const initial = await get('/api/goals'), candidates = initial.filter(g => g.documentEdit && g.status === 'completed' && g.documentEditState?.artifact?.revision === 1);
    assert.equal(candidates.length, 1, 'Select a stopped real accepted current-v1 fixture'); parent = candidates[0]; const parentState = parent.documentEditState, baseArtifact = parentState.artifact;
    original = initial.find(g => g.id === (parent.documentEdit.originalBriefGoalId || parent.documentEdit.parentGoalId)); assert(original?.brief && original.briefState?.artifact);
    assert.equal((await get('/api/documents/' + baseArtifact.documentId)).revision, 1); assert(parent.briefEditEligibility?.canEdit, 'Current accepted version 1 must visibly support another edit.');
    record.baseParentBefore = structuredClone(parent); record.originalGoalBefore = structuredClone(original); record.storedAncestorsBefore = await storedGoalIdentities([parent.id, original.id]);
    const notes = parentState.preserved.notes, citations = parentState.preserved.citations; assert.equal(notes.length, 1719); record.personalNoteCharacters = notes.length;
    await disclose(parent.id, 'Preserved notes, citations and original files');
    const v0pdf = await download(parent.id, 'Download original PDF', 'version-0-before.pdf'), v0html = await download(parent.id, 'Download original HTML', 'version-0-before.html');
    const v1pdf = await download(parent.id, 'Download revised PDF', 'version-1-before.pdf'), v1html = await download(parent.id, 'Download revised HTML', 'version-1-before.html'), v1prov = await download(parent.id, 'Download edit provenance', 'version-1-before-provenance.json');
    assert.equal(v1pdf.receipt.sha256, baseArtifact.pdfSha256); assert.equal(v1html.receipt.sha256, baseArtifact.htmlSha256); assert.equal(v1prov.receipt.sha256, baseArtifact.provenanceSha256);
    assert.equal(v0pdf.receipt.sha256, original.briefState.artifact.pdfSha256); assert.equal(v0html.receipt.sha256, original.briefState.artifact.htmlSha256);
    const before = presentedInline(parentState.proposal.paragraphs.map(p => p.text).join('\n\n')); record.currentSummaryBefore = {raw: parentState.proposal, rendered: before, characters: before.length}; assert(before.length > 150);
    check('Inspect the real accepted current version 1 and pin original versions 0/1 PDF, HTML, provenance, complete notes/citations and stored ancestor identities before editing.', {baseRevision: 1, documentId: baseArtifact.documentId, v0PdfSha256: v0pdf.receipt.sha256, v1PdfSha256: v1pdf.receipt.sha256, notesCharacters: notes.length});

    await action(parent.id, 'Edit current brief')[pointer](); const input = card(parent.id).getByRole('textbox', {name: 'Requested brief change', exact: true}); await input.fill(intent);
    await card(parent.id).getByRole('combobox', {name: 'Section to edit', exact: true}).selectOption('summary');
    await card(parent.id).getByRole('combobox', {name: 'Requested format', exact: true}).selectOption('shorter-single-sentence');
    const checkbox = card(parent.id).getByRole('checkbox', {name: 'Two labelled sentences', exact: true}); if (await checkbox.count()) assert(!await checkbox.isChecked());
    const draftPosts = mutationCount(); await closeWindow('Goals', page.locator('.goal-panel')); await openGoals(); await input.waitFor(); assert.equal(await input.inputValue(), intent);
    await page.reload({waitUntil: 'networkidle'}); await openGoals(); await input.waitFor(); assert.equal(await input.inputValue(), intent); assert.equal(mutationCount(), draftPosts);
    check('The exact unlabelled current-version rewrite draft survives close/reopen and reload without submission.');
    let delivered, requestKey;
    await page.route(base + '/api/goals/' + parent.id + '/document-edit', async route => {const body = route.request().postDataJSON(); assert.equal(body.intent, intent); assert.equal(body.sentenceLabels, undefined); assert.deepEqual(body.target, {section: 'summary', format: 'shorter-single-sentence'}); requestKey = body.requestKey; const r = await route.fetch(); assert(r.ok()); delivered = await r.json(); record.lostCreateAcknowledgement = {status: r.status(), requestKey, goalId: delivered.id}; await route.abort('connectionfailed');}, {times: 1});
    await action(parent.id, 'Save edit and propose changes')[pointer](); const inspect = action(parent.id, 'Inspect saved edits'); await inspect.waitFor(); await until(() => inspect.isEnabled(), 'lost create acknowledgement settles'); await inspect[pointer](); await until(() => delivered, 'real create delivered'); child = await get('/api/goals/' + delivered.id); await card(child.id).waitFor();
    assert.equal(child.documentEdit.baseRevision, 1); assert.equal(child.documentEdit.basePdfSha256, v1pdf.receipt.sha256); assert.equal(child.documentEdit.baseHtmlSha256, v1html.receipt.sha256); assert.equal(child.documentEdit.baseProvenanceSha256, v1prov.receipt.sha256); assert.equal(child.documentEdit.baseOperationId, baseArtifact.operationId); assert.equal(child.documentEdit.originalBriefGoalId, original.id); assert.equal(child.documentEdit.requestKey, requestKey); assert.equal(child.documentEdit.intent, intent);
    assert.equal((await get('/api/goals')).filter(g => g.documentEdit?.requestKey === requestKey).length, 1); assert.equal(record.apiMutations.filter(r => !r.explicitApiNegativeOrReconciliation && r.path === '/api/goals/' + parent.id + '/document-edit').length, 1);
    child = await pollGoal(child.id, g => ['running', 'needs_input', 'completed'].includes(g.status), 'current-version job starts'); assert.equal(child.status, 'running', child.message);
    await action(child.id, 'Stop goal')[pointer](); child = await pollGoal(child.id, g => g.status === 'cancelled', 'explicit Stop persists'); const stopped = structuredClone(child), stoppedPosts = mutationCount(); await page.reload({waitUntil: 'networkidle'}); await openGoals(); assert.deepEqual(await get('/api/goals/' + child.id), stopped); assert.equal(mutationCount(), stoppedPosts);
    await continueGoal(); child = await pollGoal(child.id, g => !!g.documentEditState?.proposal || ['needs_input', 'completed', 'cancelled'].includes(g.status), 'native current-version rewrite is saved before review');
    const saved = child.documentEditState; assert(saved?.proposal && saved.writingAttempt?.raw, child.message); assert.equal(child.status, 'running', 'Cut must interrupt actual active acceptance, not an idle finished proposal.'); assert.equal(saved.phase, 'proposal_saved');
    const native = checkRewrite(saved.writingAttempt.raw, before), proposal = structuredClone(saved.proposal), raw = structuredClone(saved.writingAttempt), operationId = saved.operationId, proposalSha256 = saved.proposalSha256;
    assert.equal(proposal.paragraphs.length, 1); assert.equal(proposal.paragraphs[0].text, raw.raw.text, 'The host may wrap the native result, not join or rewrite its factual text.'); assert.deepEqual(proposal.paragraphs[0].citations, raw.raw.citations); assert.equal(raw.sha256, sha(JSON.stringify(raw.raw))); assert.equal(saved.preserved.notes, notes); assert.deepEqual(saved.preserved.citations, citations);
    const sampling = findSampling(child.documentEdit.inferenceProfile) || findSampling(saved.inferenceProfile); assert(sampling, 'The measured document-only decoding profile must be durably inspectable'); assert.equal(sampling.chat_template_kwargs?.enable_thinking, false);
    const writerStarts = child.events.filter(e => e.phase === 'proposing_document_edit').length; record.interruptedProposal = structuredClone(child); record.nativeRewrite = native; record.savedNativeRaw = raw;
    record.cuts.push({point: 'native_current_summary_saved_before_review', pid: host.pid, signal: 'SIGKILL'}); const cutPosts = mutationCount(); await stopHost(host, 'SIGKILL'); host = undefined; await boot(); await page.reload({waitUntil: 'networkidle'}); await openGoals(); child = await pollGoal(child.id, g => g.status === 'needs_input', 'interrupted saved rewrite needs explicit continuation');
    assert.deepEqual(child.documentEditState.writingAttempt, raw); assert.deepEqual(child.documentEditState.proposal, proposal); assert.equal(child.documentEditState.operationId, operationId); assert.equal(mutationCount(), cutPosts); assert.equal((await get('/api/documents/' + baseArtifact.documentId)).revision, 1);
    await continueGoal(); child = await pollGoal(child.id, g => g.documentEditState?.phase === 'awaiting_approval' || g.documentEditState?.phase === 'rejected' || ['completed', 'cancelled'].includes(g.status), 'saved rewrite reaches explicit approval'); assert.equal(child.status, 'needs_input'); assert.equal(child.documentEditState.phase, 'awaiting_approval', child.message); assert.deepEqual(child.documentEditState.writingAttempt, raw); assert.equal(child.events.filter(e => e.phase === 'proposing_document_edit').length, writerStarts, 'Saved native rewrite must not be regenerated after restart');
    check('Lost create delivery, explicit Stop/reload and actual SIGKILL after the saved genuine rewrite preserve one base-v1 operation/raw proposal without automatic replay; explicit Continue finishes review only.', {operationId, proposalSha256, native});

    await openReview(); const review = dialog(), beforeRegion = review.getByRole('region', {name: 'Before summary', exact: true}), afterRegion = review.getByRole('region', {name: 'Proposed summary', exact: true});
    assert.match(await review.innerText(), /Version 1\s*→\s*proposed version 2/iu); assert.match(await review.innerText(), /Changed section:\s*Summary/iu);
    assert(compact(await beforeRegion.innerText()).includes(compact(before))); assert(compact(await afterRegion.innerText()).includes(compact(native.text)));
    for (const region of [beforeRegion, afterRegion]) {const text = await region.innerText(); assert(!text.includes('`') && !/\[[^\]]+\]\(https:/u.test(text), 'The visible comparison must render inline Markdown, keeping exact raw text in details.'); assert(await region.locator('a[href]').count() >= 2, 'The rendered comparison must retain usable citation links.');}
    const rawDetails = review.locator('details').filter({has: page.locator('summary').filter({hasText: /^Exact raw comparison and citation evidence$/})});
    await rawDetails.locator('> summary')[pointer]();
    assert.deepEqual(JSON.parse(await rawDetails.locator('pre[aria-label="Raw before summary JSON"]').innerText()), saved.before);
    assert.deepEqual(JSON.parse(await rawDetails.locator('pre[aria-label="Raw proposed summary JSON"]').innerText()), proposal);
    assert.deepEqual(JSON.parse(await rawDetails.locator('pre[aria-label="Raw native edit decision JSON"]').innerText()), raw.raw);
    await rawDetails.locator('> summary')[pointer]();
    const middle = review.getByRole('region', {name: 'Summary comparison and evidence', exact: true}); await middle.evaluate(element => {element.scrollTop = 0;});
    const size = await review.boundingBox(), b = await beforeRegion.boundingBox(), a = await afterRegion.boundingBox(), m = await middle.boundingBox(); assert(size.x >= 0 && size.x + size.width <= viewports[viewportName].width && size.y >= 0 && size.y + size.height <= viewports[viewportName].height);
    if (viewportName === 'desktop') {assert(size.width >= 800 && size.width <= 1000, 'Expanded desktop review must be 800–1000px, not the small Goals window'); assert(a.x > b.x && b.width >= 330 && a.width >= 330); assert(b.y >= m.y && a.y >= m.y && b.y + b.height <= m.y + m.height && a.y + a.height <= m.y + m.height, 'The full before/proposed comparison must be visible in the expanded desktop scroll region.'); await reachable(review.getByRole('button', {name: 'Apply proposed edit', exact: true}), 'Expanded review Apply'); await screenshot('expanded-full-comparison-and-apply-1440');}
    else {assert(a.y > b.y, 'Narrow review sections must stack'); await beforeRegion.scrollIntoViewIfNeeded(); await screenshot('stacked-before-comparison-360x420'); await afterRegion.scrollIntoViewIfNeeded(); await reachable(review.getByRole('button', {name: 'Apply proposed edit', exact: true}), 'Narrow fixed review Apply'); await screenshot('stacked-proposed-and-apply-360x420');}
    assert(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); record.reviewLayout = {viewport: viewports[viewportName], dialog: size, scrollRegion: m, before: b, proposed: a, rawComparisonInspected: true};
    await cancelReview(false); await openReview(); await cancelReview(true);
    check('Expanded readable review shows base version 1 → proposed version 2 and Summary changes, retains raw evidence separately, stacks on short screens, and Cancel/Escape restore focus without Stop/Apply.', {reviewLayout: record.reviewLayout});

    const competingKey = randomUUID(), negativeCreated = await post('/api/goals/' + parent.id + '/document-edit', {requestKey: competingKey, intent}); competitor = await pollGoal(negativeCreated.value.id, g => g.documentEditState?.phase === 'awaiting_approval' || g.status === 'completed' || g.documentEditState?.phase === 'rejected', 'intentional competing v1 proposal becomes ready without applying');
    assert.equal(competitor.status, 'needs_input'); assert.equal(competitor.documentEditState.phase, 'awaiting_approval', competitor.message); assert.equal(competitor.documentEdit.baseRevision, 1); assert.equal(competitor.documentEditState.approvedProposalSha256, undefined); assert.equal((await get('/api/documents/' + baseArtifact.documentId)).revision, 1); record.intentionalCompetingProposal = structuredClone(competitor);
    await openReview(); await page.route(base + '/api/goals/' + child.id + '/document-edit/apply', async route => {assert.deepEqual(route.request().postDataJSON(), {operationId, proposalSha256}); const r = await route.fetch(); assert(r.ok()); record.lostApplyAcknowledgement = {status: r.status(), operationId, proposalSha256}; await route.abort('connectionfailed');}, {times: 1});
    const apply = dialog().getByRole('button', {name: 'Apply proposed edit', exact: true}); await reachable(apply, 'Explicit review Apply before delivery loss'); if (viewportName === 'desktop') await page.keyboard.press('Enter'); else await apply.tap();
    const modalInspect = dialog().getByRole('button', {name: 'Inspect saved edit', exact: true}); await modalInspect.waitFor(); await until(() => modalInspect.isEnabled(), 'lost Apply settles'); await reachable(modalInspect, 'Unconfirmed Apply inspection'); if (viewportName === 'narrow') await screenshot('unconfirmed-apply-inspect-360x420');
    child = await get('/api/goals/' + child.id); record.approvedBeforeKill = structuredClone(child); assert.equal(child.documentEditState.approvedProposalSha256, proposalSha256); assert.equal(child.documentEditState.operationId, operationId); assert.equal(child.status, 'running', 'The approval cut must interrupt actual unfinished execution, not a completed version.'); assert.equal(child.documentEditState.artifact, undefined, 'The approval cut must precede publication of the revised artifact.');
    const applies = record.apiMutations.filter(r => !r.explicitApiNegativeOrReconciliation && r.path === '/api/goals/' + child.id + '/document-edit/apply').length; assert.equal(applies, 1);
    record.cuts.push({point: 'approved_apply_acknowledgement_lost', phase: child.documentEditState.phase, pid: host.pid, signal: 'SIGKILL'}); const appliedPosts = mutationCount(); await stopHost(host, 'SIGKILL'); host = undefined; await boot(); await page.reload({waitUntil: 'networkidle'}); await openGoals(); child = await get('/api/goals/' + child.id); assert.equal(mutationCount(), appliedPosts); assert.equal(child.documentEditState.operationId, operationId); assert.equal(child.documentEditState.approvedProposalSha256, proposalSha256);
    const savedInspect = action(child.id, 'Inspect saved edit'); if (await savedInspect.isVisible()) {await until(() => savedInspect.isEnabled(), 'saved Apply inspection'); const posts = mutationCount(); await savedInspect[pointer](); await until(async () => !await savedInspect.isVisible(), 'saved approval is reconciled'); assert.equal(mutationCount(), posts);}
    child = await get('/api/goals/' + child.id); if (child.status !== 'completed') {assert.equal(child.status, 'needs_input'); await continueGoal(); child = await pollGoal(child.id, g => ['completed', 'needs_input', 'cancelled'].includes(g.status), 'approved v2 finishes deliberately');}
    assert.equal(child.status, 'completed', child.message); assert.equal(child.documentEditState.phase, 'saved'); assert.deepEqual(child.documentEditState.writingAttempt, raw); assert.deepEqual(child.documentEditState.proposal, proposal); assert.equal(child.documentEditState.operationId, operationId);
    const artifact = child.documentEditState.artifact; assert.equal(artifact.revision, 2); assert.equal(artifact.documentId, baseArtifact.documentId); assert.equal((await get('/api/documents/' + artifact.documentId)).revision, 2); const history = await get('/api/documents/' + artifact.documentId + '/history'); assert.deepEqual(history.map(v => v.revision).sort(), [0, 1, 2]); assert.equal(history.filter(v => v.revision === 2).length, 1);
    assert.equal(record.apiMutations.filter(r => !r.explicitApiNegativeOrReconciliation && r.path === '/api/goals/' + child.id + '/document-edit/apply').length, applies); assert.equal((await get('/api/goals')).filter(g => g.documentEdit?.requestKey === requestKey).length, 1); record.artifact = artifact; record.completedChild = structuredClone(child);
    check('An actual reviewed Apply with lost acknowledgement and owned-host interruption preserves approval/raw operation identity and publishes exactly one version 2 after explicit inspection/continuation.', {artifact, phaseAtCut: record.approvedBeforeKill.documentEditState.phase});

    const bRaw = structuredClone(competitor.documentEditState.writingAttempt), bProposal = structuredClone(competitor.documentEditState.proposal); const staleApply = await post('/api/goals/' + competitor.id + '/document-edit/apply', {operationId: competitor.documentEditState.operationId, proposalSha256: competitor.documentEditState.proposalSha256}, false);
    assert(!staleApply.ok && staleApply.status >= 400); assert.match(staleApply.value.error, /current|changed|stale|version|revision/iu); competitor = await get('/api/goals/' + competitor.id); assert.deepEqual(competitor.documentEditState.writingAttempt, bRaw); assert.deepEqual(competitor.documentEditState.proposal, bProposal); assert.equal(competitor.documentEditState.approvedProposalSha256, undefined); assert(!competitor.documentEditState.artifact); assert(competitor.documentEditState.conflict || /current|changed|stale|version|revision/iu.test(competitor.message));
    const competingStarts = competitor.events.filter(e => e.phase === 'proposing_document_edit').length; await continueGoal(competitor.id); competitor = await pollGoal(competitor.id, g => g.status === 'needs_input', 'stale competing proposal remains unfinished'); assert.deepEqual(competitor.documentEditState.writingAttempt, bRaw); assert.equal(competitor.events.filter(e => e.phase === 'proposing_document_edit').length, competingStarts);
    const goalCount = (await get('/api/goals')).length; const staleCreates = [];
    for (const ancestor of [original, parent]) {const r = await post('/api/goals/' + ancestor.id + '/document-edit', {requestKey: randomUUID(), intent}, false); assert(!r.ok && r.status >= 400); assert.match(r.value.error, /current|changed|stale|version|revision/iu); staleCreates.push({parentId: ancestor.id, ...r});}
    assert.equal((await get('/api/goals')).length, goalCount); assert.equal((await get('/api/documents/' + artifact.documentId)).revision, 2); assert.equal((await get('/api/documents/' + artifact.documentId + '/history')).length, 3); record.staleBaseRejections = {apply: staleApply, creates: staleCreates, competingGoal: competitor};
    check('A deliberately separate real v1 proposal cannot Apply after another operation publishes v2; its raw evidence is preserved, Continue does not rewrite it, and fresh stale v0/v1 requests create no child/version.', {competingGoalId: competitor.id, staleApplyStatus: staleApply.status, staleCreateStatuses: staleCreates.map(r => r.status)});

    await disclose(child.id, 'Preserved notes, citations and original files'); const v2pdf = await download(child.id, 'Download revised PDF', 'version-2-revised.pdf'), v2html = await download(child.id, 'Download revised HTML', 'version-2-revised.html'), v2prov = await download(child.id, 'Download edit provenance', 'version-2-provenance.json');
    assert.equal(v2pdf.receipt.sha256, artifact.pdfSha256); assert.equal(v2html.receipt.sha256, artifact.htmlSha256); assert.equal(v2prov.receipt.sha256, artifact.provenanceSha256); assert.equal(v2pdf.bytes.subarray(0, 5).toString(), '%PDF-'); assert.match(v2pdf.receipt.type, /^application\/pdf/u); assert.match(v2html.receipt.type, /^text\/html/u);
    const v0AfterPdf = await download(child.id, 'Download original PDF', 'version-0-after.pdf'), v0AfterHtml = await download(child.id, 'Download original HTML', 'version-0-after.html');
    const v1AfterPdf = await download(parent.id, 'Download revised PDF', 'version-1-after.pdf'), v1AfterHtml = await download(parent.id, 'Download revised HTML', 'version-1-after.html'), v1AfterProv = await download(parent.id, 'Download edit provenance', 'version-1-after-provenance.json');
    for (const [beforeFile, afterFile] of [[v0pdf, v0AfterPdf], [v0html, v0AfterHtml], [v1pdf, v1AfterPdf], [v1html, v1AfterHtml], [v1prov, v1AfterProv]]) assert.deepEqual(afterFile.bytes, beforeFile.bytes, 'Pinned historical versions and provenance must stay byte-identical.');
    const provenance = JSON.parse(v2prov.bytes); assert(JSON.stringify(provenance).includes(JSON.stringify(notes).slice(1, -1))); for (const c of citations) assert(JSON.stringify(provenance).includes(JSON.stringify(c.quote).slice(1, -1))); assert(JSON.stringify(provenance).includes(JSON.stringify(raw.raw).slice(1, -1)) || JSON.stringify(provenance).includes(JSON.stringify(raw.raw)));
    record.storedAncestorsAfter = await storedGoalIdentities([parent.id, original.id]); assert.deepEqual(record.storedAncestorsAfter, record.storedAncestorsBefore); assert.deepEqual(stableParent(await get('/api/goals/' + parent.id)), stableParent(record.baseParentBefore)); assert.deepEqual(stableParent(await get('/api/goals/' + original.id)), stableParent(record.originalGoalBefore));
    const python = process.env.PYTHON_PATH || join(studioRoot, '.venv/bin/python'); const opened = await exec(python, ['-c', "import pymupdf as f,json,pathlib,sys\np=f.open(sys.argv[1]);out=pathlib.Path(sys.argv[2]);pages=[]\nfor i,page in enumerate(p):\n page.get_pixmap(matrix=f.Matrix(1.15,1.15)).save(str(out/('version-2-pdf-page-'+str(i+1)+'.png')))\n pages.append({'page':i+1,'text':page.get_text(),'links':[{'uri':l.get('uri'),'rect':list(l['from'])} for l in page.get_links()]})\nprint(json.dumps({'pages':pages,'pageCount':len(p)}))", v2pdf.path, folder], {maxBuffer: 4_000_000});
    const pdf = JSON.parse(opened.stdout); await writeFile(join(folder, 'version-2-pdf-inspection.json'), JSON.stringify(pdf, null, 2) + '\n'); assert.equal(pdf.pageCount, artifact.pages); const actualPdfText = pdf.pages.map(p => p.text).join('\n'); assert(compact(actualPdfText).includes(compact(native.text))); assert.equal(compact(actualPdfText).split(compact(notes)).length - 1, 1);
    const sourceGoal = await get('/api/goals/' + original.id), requiredTargets = [...new Set([...citations.flatMap(c => literalHttps(c.quote)), ...(sourceGoal.sources || []).map(s => s.url)])], pdfTargets = pdf.pages.flatMap(p => p.links.map(l => l.uri)); for (const target of requiredTargets) assert(pdfTargets.includes(target));
    record.outputCritique = {nativeSentence: native.text, oneSentence: true, shorterThanCurrent: true, notesOnce: true, originalVersionsAndProvenanceByteIdentical: true, preservedAncestorJsonByteIdentical: true, pages: pdf.pageCount, sourceLinks: pdfTargets, scope: 'Specific native rewrite goal with actual files; independent prose/model quality and arbitrary imported layouts remain unproven.'};
    const openedPage = context.waitForEvent('page'); openedPage.catch(() => {}); await action(child.id, 'Open revised HTML')[pointer](); const htmlPage = await openedPage; await htmlPage.waitForLoadState('domcontentloaded'); const htmlResponse = await page.request.get(new URL(await action(child.id, 'Open revised HTML').getAttribute('href'), base).href); assert(htmlResponse.ok()); assert.deepEqual(await htmlResponse.body(), v2html.bytes);
    const visibleHtml = await htmlPage.locator('body').innerText(); assert(compact(visibleHtml).includes(compact(native.text))); assert.equal(compact(visibleHtml).split(compact(notes)).length - 1, 1); assert.equal(await htmlPage.locator('script,iframe,form,object,embed').count(), 0); const links = await htmlPage.locator('a[href]').evaluateAll(elements => elements.map(e => e.getAttribute('href'))); for (const target of requiredTargets) assert(links.includes(target)); assert(await htmlPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (viewportName === 'narrow') {await htmlPage.screenshot({path: join(folder, 'version-2-html-360x420.png')}); record.screenshots.push('version-2-html-360x420.png');} await htmlPage.close();
    if (viewportName === 'narrow') {await reachable(action(child.id, 'Open revised PDF'), 'Saved v2 PDF action'); await screenshot('saved-version-2-actions-360x420', action(child.id, 'Open revised PDF'));}
    check('Actual browser v2 PDF/HTML/provenance have correct MIME/signature/byte hashes, open and contain the complete native sentence, exact notes/citation links; v0/v1 files/provenance and stored ancestor records stay unchanged.', {pdfSha256: artifact.pdfSha256, htmlSha256: artifact.htmlSha256, provenanceSha256: artifact.provenanceSha256, notesCharacters: notes.length});
    await action(child.id, 'Open revised PDF')[pointer](); await decodedPdfPage(1); if (viewportName === 'desktop') await screenshot('actual-version-2-pdf-reader-1440'); const current = await get('/api/goals/' + child.id), reopenedPosts = mutationCount(); record.cuts.push({point: 'completed_v2_reopen', pid: host.pid, signal: 'SIGTERM'}); await stopHost(host, 'SIGTERM'); host = undefined; await boot(); await page.reload({waitUntil: 'networkidle'}); await openGoals(); await card(child.id).waitFor(); assert.deepEqual(await get('/api/goals/' + child.id), current); assert.equal(mutationCount(), reopenedPosts); await action(child.id, 'Open revised PDF')[pointer](); await decodedPdfPage(1); assert.equal((await get('/api/documents/' + artifact.documentId + '/history')).length, 3); assert.deepEqual(await storedGoalIdentities([parent.id, original.id]), record.storedAncestorsBefore);
    record.finalGoal = await get('/api/goals/' + child.id); check('The current v2 PDF reopens after a real graceful Studio restart with the same accepted operation and no extra mutation or historical-version change.');
  }
}

export async function runResearchDocumentSecondEditSuite(options = {}) {
  options = {viewport: 'all', ...options}; assert(options.output && options.fixture, 'Choose fresh --output and explicit stopped accepted --fixture data');
  options.output = resolve(studioRoot, options.output); options.fixture = await realpath(resolve(studioRoot, options.fixture)); const normal = await realpath(join(studioRoot, '.data'));
  assert.notEqual(options.fixture, normal, 'Never clone normal user data for this journey'); assert(!options.output.startsWith(options.fixture + '/')); await access(join(options.fixture, 'studio.sqlite')); await access(join(studioRoot, 'out/index.html')); await mkdir(options.output);
  const names = options.viewport === 'all' ? Object.keys(viewports) : [options.viewport]; assert(names.every(n => viewports[n]), 'Use desktop, narrow or all');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim(), report = {source, sourceDirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: studioRoot, encoding: 'utf8'}).trim(), startedAt: new Date().toISOString(), lane: 'accepted-v1-real-native-second-edit', fingerprints: await fingerprints(), results: []};
  const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium'}); let interrupted = false;
  const cancel = () => {interrupted = true; void Promise.allSettled([...activeHosts].map(h => stopHost(h))).then(() => browser.close());}; process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {for (const name of names) {if (interrupted) break; const result = await runCase(browser, name, options); report.results.push(result); console.log(result.status.toUpperCase() + ' second-edit [' + name + '] ' + (result.reason || intent));}}
  finally {process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); await Promise.allSettled([...activeHosts].map(h => stopHost(h))); await browser.close();}
  try {assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim(), source, 'Source commit must remain fixed during native acceptance'); assert.deepEqual(await fingerprints(), report.fingerprints, 'Product source/served build changed during native acceptance');} catch (e) {report.verificationError = e.message;}
  report.summary = Object.fromEntries(['passed', 'blocked', 'failed'].map(status => [status, report.results.filter(r => r.status === status).length])); report.assertions = report.results.reduce((n, r) => n + r.assertions.length, 0);
  report.status = interrupted ? 'interrupted' : report.summary.failed || report.verificationError ? 'failed' : report.summary.blocked ? 'incomplete' : 'passed'; report.goalAchieved = report.status === 'passed'; report.exitCode = interrupted ? 130 : report.summary.failed || report.verificationError ? 1 : report.summary.blocked ? 2 : 0; report.finishedAt = new Date().toISOString();
  await writeFile(join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); return report;
}
async function main() {
  const options = {}, args = process.argv.slice(2); for (let i = 0; i < args.length; i++) {const flag = args[i]; assert(['--viewport', '--output', '--fixture'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--'), 'Usage: node scripts/e2e/research-document-second-edit.mjs --fixture STOPPED_V1_DATA --viewport all|desktop|narrow --output FRESH_DIR'); options[flag.slice(2)] = args[++i];}
  const r = await runResearchDocumentSecondEditSuite(options); process.exitCode = r.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
