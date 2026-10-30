#!/usr/bin/env node
/** Genuine section-aware personal-note rewrite acceptance.
 * Uses a stopped copy of a previously accepted v2 brief, never normal data.
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
const intent = 'Make this clearer for a newcomer';
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
  for (const name of ['scripts/e2e/research-document-note-edit.mjs', 'scripts/e2e/artifacts.mjs', 'package.json', 'bun.lock']) {const bytes = await readFile(join(studioRoot, name)); result.push({path: name, bytes: bytes.length, sha256: sha(bytes)});}
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function stableParent(goal) {
  const next = structuredClone(goal);
  // These are read-only current-version affordances, not persisted ancestor data.
  delete next.briefEditEligibility; delete next.documentEditOptions;
  return next;
}
function checkNoteRewrite(raw, before) {
  assert(raw && typeof raw.text === 'string', 'The actual native note response must expose its text.');
  const text = raw.text;
  assert(text.trim() && text === text.trim() && !/[\r\n]/u.test(text), 'The requested output is one plain paragraph.');
  assert(/[.!?]$/u.test(text), 'The clearer paragraph must finish its sentence.');
  const words = value => value.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu)?.join(' ');
  assert.notEqual(words(text), words(before), 'Punctuation/case changes alone do not demonstrate a clearer rewrite.');
  assert(!/`|\[[^\]]+\]\(|https?:\/\//u.test(text), 'The selected note must remain plain prose, with no invented links or markup.');
  const concepts = {
    beforeChanges: /\bbefore\b[\s\S]*\b(?:chang(?:e|es|ing)|modif(?:y|ying|ications?))\b/iu,
    recordAction: /\b(?:record|note|collect|capture|document|write)\b/iu,
    browser: /\bbrowser\b/iu, version: /\bversion\b/iu,
    minimalExample: /\b(?:minimal|small|simple|basic|brief|short|essential|necessary)\b/iu,
    publicContext: /\bpublic\b/iu, example: /\bexample\b/iu,
    expectedOutcome: /\bexpect(?:ed|ation)?\b/iu, actualObservation: /\b(?:actually|actual|observed|observation|happened|saw)\b/iu,
    cookies: /\bcookies?\b/iu, authorizationHeaders: /\bauthori[sz]ation\s+headers?\b/iu,
    accountDetails: /\baccount\s+(?:details|information)\b/iu, privateUrls: /\bprivate\s+(?:urls?|links?)\b/iu,
    removalAction: /\b(?:remov(?:e|es|ed|ing)|strip|delete|exclude|clear)\b/iu,
    sharingContext: /\bshar(?:e|es|ed|ing)\b|\b(?:publish|post|send)\b/iu,
    plannedFirstPerson: /\bI\s+(?:will|plan to|intend to|am going to)\b|\bI['’](?:ll|m going to)\b/u
  };
  const checks = Object.fromEntries(Object.entries(concepts).map(([name, pattern]) => [name, pattern.test(text)]));
  for (const [name, passed] of Object.entries(checks)) assert(passed, 'The actual rewrite must retain the selected note concept: ' + name);
  assert(!/\bI(?:['’]ve| have (?:already )?| already | recorded| removed| collected| documented| completed| finished| verified| tested)/iu.test(text), 'The native rewrite must not invent completed first-person work.');
  // Bounded regression: a prior genuine response kept all nouns but moved the
  // expected/actual details from recording to a new "I will observe" action.
  // Inspect planned-action clauses, not isolated keywords; this remains a
  // narrow check, with the actual wording reviewed separately before acceptance.
  const futureStart = /\bI(?:\s+will\b|['’]ll\b|\s+(?:plan|intend)\s+to\b|\s+am\s+going\s+to\b|['’]m\s+going\s+to\b)\s*/giu;
  const plannedClauses = value => {
    const starts = [...value.matchAll(futureStart)];
    return starts.map((start, index) => value.slice(start.index + start[0].length, starts[index + 1]?.index ?? value.length).trim());
  };
  const clauses = plannedClauses(text), originalClauses = plannedClauses(before);
  const observes = value => /^(?:(?:first|also|then)\s+)*observe\b/iu.test(value);
  assert(!clauses.some(observes) || originalClauses.some(observes), 'Recording the expected and actual details must not become a new future observe action.');
  const recording = /^(?:(?:first|also|then|carefully|clearly|briefly)\s+)*(?:record|note|collect|capture|document|write(?:\s+down)?|make\s+(?:a\s+)?notes?(?:\s+of)?|take\s+notes?(?:\s+of)?)\b/iu;
  const recordingClauses = clauses.filter(value => recording.test(value)), recordingText = recordingClauses.join(' ');
  const recordedItems = Object.fromEntries(['browser', 'version', 'minimalExample', 'publicContext', 'example', 'expectedOutcome', 'actualObservation'].map(name => [name, concepts[name].test(recordingText)]));
  for (const [name, passed] of Object.entries(recordedItems)) assert(passed, 'The selected note item must remain part of a planned record/note/write-down clause: ' + name);
  return {text, characters: text.length, beforeCharacters: before.length, notPunctuationOnly: true, concepts: checks,
    recordingActionCheck: {clauses: recordingClauses, recordedItems, noNewFutureObserveAction: true},
    noDetectedCompletedWorkClaim: true, limit: 'Bounded literal/tense/action-object regression checks and actual output critique; not independent semantic verification.'};
}
function findSampling(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.temperature === .7 && value.top_p === .8 && value.top_k === 20 && value.min_p === 0 && value.seed === 42) return value;
  for (const child of Object.values(value)) {const found = findSampling(child); if (found) return found;}
}

async function runCase(browser, viewportName, options) {
  const folder = join(options.output, 'research-document-note-edit-' + viewportName); await mkdir(folder);
  const data = join(folder, 'private-data'); await mkdir(data); const fixtureManifest = await copyFixture(options.fixture, data);
  const port = await freePort(), base = 'http://127.0.0.1:' + port, pointer = viewportName === 'narrow' ? 'tap' : 'click';
  const record = {id: 'native-selected-personal-note-paragraph-rewrite', viewport: viewportName, lane: 'accepted-v2-real-native-note-edit', goal: intent,
    status: 'running', startedAt: new Date().toISOString(), fixture: {path: options.fixture, manifest: fixtureManifest}, assertions: [], screenshots: [],
    processes: [], cuts: [], requests: [], apiMutations: [], progress: [], downloads: [], pageErrors: [], externalBrowserRequests: [],
    limitations: ['Reuses a stopped copy of genuine accepted version2; earlier research/summary edits are not regenerated.',
      'This is a selected personal-note paragraph rewrite under an explicit section/format contract; not general imported-PDF editing or independent semantic accuracy.',
      'Chromium desktop/touch/keyboard emulation on the prepared Linux host; physical devices, native OS installs and voice are unverified.',
      'The intentional competing proposal is a stale-base negative test, not a second user-goal success or a duplicate lost-acknowledgement submission.']};
  let host, context, page, parent, original, child, competitor, sequence = 0;
  const save = () => writeFile(join(folder, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  const check = (name, evidence = {}) => record.assertions.push({name, passed: true, ...evidence});
  const card = id => page.locator('[data-goal-id="' + id + '"]');
  const action = (id, name) => card(id).getByRole('button', {name, exact: true}).or(card(id).getByRole('link', {name, exact: true})).first();
  const dialog = () => page.getByRole('dialog', {name: 'Review personal-note edit', exact: true});
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
      if (state !== previous) {previous = state; record.progress.push({time: new Date().toISOString(), id, status: value.status, phase: value.phase, editPhase: value.documentEditState?.phase, rawSaved: !!value.documentEditState?.writingAttempt, reviewed: !!value.documentEditState?.supportReview}); await save(); console.log('ACTIVE note-edit [' + viewportName + '] ' + value.status + ' · ' + value.phase + ' · ' + (value.documentEditState?.phase || 'no checkpoint'));}
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
  async function preserveUnmetEdit(error) {
    if (!child?.id) return;
    const detected = await get('/api/goals/' + child.id);
    if (detected.documentEditState?.approvedProposalSha256) return;
    const evidence = {reason: String(error), detectedGoal: detected, goalAchieved: false, noApplyAttempted: false, noNewVersionPublished: false};
    record.unmetEditAtFailure = evidence;
    let settled = detected;
    if (['queued', 'planning', 'running'].includes(detected.status)) {
      try {settled = await pollGoal(child.id, value => !['queued', 'planning', 'running'].includes(value.status), 'unmet native edit reaches its visible retained state', 20_000);}
      catch (settleError) {evidence.settleError = String(settleError); settled = await get('/api/goals/' + child.id);}
    }
    evidence.settledGoal = settled;
    evidence.originalIntent = settled.documentEdit?.intent; evidence.savedTarget = settled.documentEdit?.target;
    evidence.savedNativeRaw = settled.documentEditState?.writingAttempt; evidence.savedReviewRaw = settled.documentEditState?.notesReviewAttempt;
    evidence.noApplyAttempted = !record.apiMutations.some(request => request.path === '/api/goals/' + child.id + '/document-edit/apply');
    evidence.history = await get('/api/documents/' + settled.documentId + '/history'); evidence.noNewVersionPublished = evidence.history.every(version => version.revision <= 2);
    const stoppedCard = card(child.id); await stoppedCard.waitFor();
    const status = stoppedCard.locator('.goal-state');
    if (settled.status === 'needs_input') await until(async () => /needs attention|needs input/iu.test(await status.innerText()), 'the window shows retained needs-input state', 5000);
    evidence.visibleGoalState = await status.innerText();
    await stoppedCard.getByRole('heading', {level: 3}).first().scrollIntoViewIfNeeded(); await screenshot('unmet-note-goal-retained-state-' + (viewportName === 'desktop' ? '1440' : '360x420'));
    const request = stoppedCard.getByRole('region', {name: 'Requested change', exact: true}); await request.scrollIntoViewIfNeeded();
    assert((await request.innerText()).includes(intent), 'Failure evidence must keep the complete original user intent.'); await screenshot('unmet-note-kept-request-and-selection-' + (viewportName === 'desktop' ? '1440' : '360x420'));
    if (settled.documentEditState?.writingAttempt) {
      await disclose(child.id, 'Edit operation and native decision');
      // A labelled pre is not exposed as the same accessibility role on every
      // Chromium build; use its exact semantic label without altering the DOM.
      const rawPre = stoppedCard.locator('pre[aria-label="Original native edit decision JSON"]'); await rawPre.waitFor(); await rawPre.scrollIntoViewIfNeeded();
      evidence.rawDecisionVisible = JSON.parse(await rawPre.innerText()); await screenshot('unmet-note-original-native-response-' + (viewportName === 'desktop' ? '1440' : '360x420'));
    }
    evidence.applyControlsPresent = await stoppedCard.getByRole('button', {name: 'Apply proposed edit', exact: true}).count();
    evidence.evidenceComplete = true;
    await save();
  }

  try {
    await boot(); if (!record.runtime.model?.ready) throw new BlockedGoal('Genuine local AI is unavailable; this selected-note rewrite goal is unmet.');
    context = await browser.newContext({viewport: viewports[viewportName], hasTouch: viewportName === 'narrow', acceptDownloads: true, timezoneId: 'America/New_York', reducedMotion: 'reduce'});
    await context.route('**/*', route => {const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {record.externalBrowserRequests.push({origin: url.origin, path: url.pathname, blocked: true}); return route.abort();} return route.continue();});
    await context.tracing.start({screenshots: true, snapshots: true, sources: false}); page = await context.newPage(); page.setDefaultTimeout(12_000); page.on('pageerror', e => record.pageErrors.push(e.message));
    page.on('request', request => {const url = new URL(request.url()); if (url.origin !== base) return; const r = {path: url.pathname, method: request.method(), time: new Date().toISOString()}; record.requests.push(r); if (r.method === 'POST') record.apiMutations.push(r);});
    await page.goto(base, {waitUntil: 'networkidle'}); await openGoals(); await runJourney(); assert.deepEqual(record.pageErrors, []); record.status = 'passed';
  } catch (error) {
    record.status = error instanceof BlockedGoal ? 'blocked' : 'failed'; record.reason = error.stack || String(error);
    if (page && !page.isClosed()) {
      try {await preserveUnmetEdit(error);} catch (e) {record.failureEvidenceError = String(e);}
      try {record.failedGoals = await get('/api/goals');} catch (e) {record.failureSnapshotError = String(e);}
      if (!record.unmetEditAtFailure?.evidenceComplete) try {await screenshot('failure');} catch {}
    }
  } finally {
    if (context) {try {await context.tracing.stop({path: join(folder, 'trace.zip')}); await redactTrace(join(folder, 'trace.zip')); record.trace = 'trace.zip'; record.traceSessionHeadersRedacted = true;} catch (e) {record.traceError = String(e); record.status = 'failed';} await context.close().catch(() => {});}
    await stopHost(host); record.fixture.unchanged = JSON.stringify(await fileManifest(options.fixture)) === JSON.stringify(fixtureManifest); if (!record.fixture.unchanged) record.status = 'failed';
    record.finishedAt = new Date().toISOString(); record.goalAchieved = record.status === 'passed'; await save();
  }
  return record;

  async function runJourney() {
    const fullRecovery = viewportName === 'desktop';
    record.recoveryScope = fullRecovery ? 'New note raw/selection cut, uncertain Apply cut and competing saved-note stale proposal.' : 'Affected clarification/selection persistence, genuine note review/Apply/export, uncertain Apply inspection and stale-create guard; full note recovery is separately exercised on desktop.';
    const initial = await get('/api/goals'), candidates = initial.filter(g => g.documentEdit && g.status === 'completed' && g.documentEditState?.artifact?.revision === 2);
    assert.equal(candidates.length, 1, 'Choose the stopped genuine accepted current version2 fixture.');
    parent = candidates[0]; const parentState = parent.documentEditState, baseArtifact = parentState.artifact;
    original = initial.find(g => g.id === (parent.documentEdit.originalBriefGoalId || parent.documentEdit.parentGoalId));
    const firstEdit = initial.find(g => g.id === parent.documentEdit.parentGoalId), ancestors = [original, firstEdit, parent];
    assert(original?.brief && original.briefState?.artifact && firstEdit?.documentEditState?.artifact?.revision === 1);
    assert.equal((await get('/api/documents/' + baseArtifact.documentId)).revision, 2);
    assert(parent.briefEditEligibility?.canEdit && parent.documentEditOptions?.baseRevision === 2);
    const options = structuredClone(parent.documentEditOptions), selected = options.paragraphs.find(p => p.index === 1), notes = parentState.preserved.notes, summary = structuredClone(parentState.proposal), citations = structuredClone(parentState.preserved.citations);
    assert(selected && selected.text === notes.slice(selected.start, selected.end)); assert.equal(selected.sha256, sha(selected.text)); assert.equal(options.notesSha256, sha(notes));
    assert.equal(selected.text.length, 240); assert.equal(notes.length, 1719);
    const target = {section: 'notes', paragraph: selected.index, paragraphSha256: selected.sha256, format: 'clearer-plain-paragraph'};
    record.base = {parentId: parent.id, artifact: baseArtifact, selection: selected, target, notesSha256: options.notesSha256, notesCharacters: notes.length, summary};
    record.ancestorsBefore = ancestors.map(stableParent); record.storedAncestorsBefore = await storedGoalIdentities(ancestors.map(g => g.id));
    const acceptedDocumentFiles = await fileManifest(join(data, 'documents', baseArtifact.documentId));
    await disclose(parent.id, 'Preserved notes, citations and original files');
    const v0pdf = await download(parent.id, 'Download original PDF', 'version-0-before.pdf'), v0html = await download(parent.id, 'Download original HTML', 'version-0-before.html');
    const v1pdf = await download(firstEdit.id, 'Download revised PDF', 'version-1-before.pdf'), v1html = await download(firstEdit.id, 'Download revised HTML', 'version-1-before.html'), v1prov = await download(firstEdit.id, 'Download edit provenance', 'version-1-before-provenance.json');
    const v2pdf = await download(parent.id, 'Download revised PDF', 'version-2-before.pdf'), v2html = await download(parent.id, 'Download revised HTML', 'version-2-before.html'), v2prov = await download(parent.id, 'Download edit provenance', 'version-2-before-provenance.json');
    assert.equal(v2pdf.receipt.sha256, baseArtifact.pdfSha256); assert.equal(v2html.receipt.sha256, baseArtifact.htmlSha256); assert.equal(v2prov.receipt.sha256, baseArtifact.provenanceSha256);
    record.baseProvenance = JSON.parse(v2prov.bytes);
    check('Inspect genuine accepted version2, exact selectable note offsets/hash, full1719-character notes, unchanged143-character summary and all historical version0/1/2 files before editing.', {baseRevision: 2, selectedParagraph: selected, versions: [0, 1, 2]});

    await action(parent.id, 'Edit current brief')[pointer]();
    const form = card(parent.id).getByRole('region', {name: 'Edit a research brief', exact: true});
    const input = form.getByRole('textbox', {name: 'Requested brief change', exact: true}), section = form.getByRole('combobox', {name: 'Section to edit', exact: true}), paragraph = form.getByRole('combobox', {name: 'Personal-note paragraph', exact: true}), format = form.getByRole('combobox', {name: 'Requested format', exact: true});
    await input.fill(intent); assert.equal(await section.inputValue(), ''); assert.equal(await format.inputValue(), '');
    const beforeClarification = mutationCount(), goalCount = initial.length;
    await form.getByRole('button', {name: 'Save edit and propose changes', exact: true})[pointer]();
    await until(async () => {
      const messages = await form.getByRole('status').allTextContents();
      const clarification = messages.find(text => /choose|select|clarif/iu.test(text) && /section/iu.test(text) && /format/iu.test(text));
      if (clarification) record.clarification = {originalIntent: intent, text: clarification};
      return !!clarification;
    }, 'ambiguous request asks for explicit section and format');
    assert.equal((await get('/api/goals')).length, goalCount); assert.equal(mutationCount(), beforeClarification, 'Clarification must not submit an edit or run native work.');
    assert.equal(await input.inputValue(), intent); assert.equal(await section.inputValue(), ''); assert.equal(await format.inputValue(), '');
    await until(() => section.evaluate(e => e === document.activeElement), 'clarification focuses the first missing choice after its animation frame');
    await reachable(section, 'Clarification section choice');
    await screenshot('kept-request-needs-section-and-format-' + (viewportName === 'desktop' ? '1440' : '360x420'));
    await form.getByRole('button', {name: 'Close edit form', exact: true})[pointer](); await action(parent.id, 'Continue edit draft')[pointer](); assert.equal(await input.inputValue(), intent);
    await page.reload({waitUntil: 'networkidle'}); await openGoals(); await input.waitFor(); assert.equal(await input.inputValue(), intent); assert.equal(await section.inputValue(), ''); assert.equal(await format.inputValue(), ''); assert.equal(mutationCount(), beforeClarification);
    const noTarget = await post('/api/goals/' + parent.id + '/document-edit', {requestKey: randomUUID(), intent}, false); assert(!noTarget.ok && noTarget.status >= 400); assert.match(noTarget.value.error, /section|target|select|format|explicit/iu); assert.equal((await get('/api/goals')).length, goalCount);
    check('The complete ambiguous original intent survives clarification, close/reopen and reload; missing section/format causes no UI submission or child, and an explicit negative API control is rejected before a new job.', {originalIntent: intent, noTargetStatus: noTarget.status});

    await section.selectOption('notes'); await reachable(paragraph, 'Exact saved note paragraph choice'); await paragraph.selectOption(String(selected.index));
    await reachable(format, 'Explicit note output format'); await format.selectOption('clearer-plain-paragraph');
    const preview = form.getByRole('region', {name: 'Selected personal-note paragraph', exact: true}); assert((await preview.innerText()).includes(selected.text));
    const selectionPosts = mutationCount(); await form.getByRole('button', {name: 'Close edit form', exact: true})[pointer](); await action(parent.id, 'Continue edit draft')[pointer](); await page.reload({waitUntil: 'networkidle'}); await openGoals(); await input.waitFor();
    assert.equal(await input.inputValue(), intent); assert.equal(await section.inputValue(), 'notes'); assert.equal(await paragraph.inputValue(), String(selected.index)); assert.equal(await format.inputValue(), 'clearer-plain-paragraph'); assert.equal(mutationCount(), selectionPosts);
    assert((await preview.innerText()).includes(selected.text));
    let delivered, requestKey;
    await page.route(base + '/api/goals/' + parent.id + '/document-edit', async route => {
      const body = route.request().postDataJSON(); assert.equal(body.intent, intent); assert.equal(body.sentenceLabels, undefined); assert.deepEqual(body.target, target); requestKey = body.requestKey;
      const response = await route.fetch(); assert(response.ok()); delivered = await response.json();
      if (fullRecovery) {record.lostCreateAcknowledgement = {status: response.status(), requestKey, goalId: delivered.id}; await route.abort('connectionfailed');}
      else await route.fulfill({response});
    }, {times: 1});
    await form.getByRole('button', {name: 'Save edit and propose changes', exact: true})[pointer]();
    if (fullRecovery) {const inspect = form.getByRole('button', {name: 'Inspect saved edits', exact: true}); await inspect.waitFor(); await until(() => inspect.isEnabled(), 'lost selected-note create settles'); await inspect[pointer]();}
    await until(() => delivered, 'the actual selected-note request is delivered'); child = await get('/api/goals/' + delivered.id); await card(child.id).waitFor();
    assert.equal(child.documentEdit.intent, intent); assert.deepEqual(child.documentEdit.target, target); assert.equal(child.documentEdit.baseRevision, 2); assert.equal(child.documentEdit.baseOperationId, baseArtifact.operationId);
    assert.equal(child.documentEdit.basePdfSha256, v2pdf.receipt.sha256); assert.equal(child.documentEdit.baseHtmlSha256, v2html.receipt.sha256); assert.equal(child.documentEdit.baseProvenanceSha256, v2prov.receipt.sha256);
    assert.equal((await get('/api/goals')).filter(g => g.documentEdit?.requestKey === requestKey).length, 1);
    check('Explicit section/paragraph/format selection survives close/reload and is durably saved with the unchanged original intent, exact selected hash/base and one child.', {target, requestKey, childId: child.id, createAcknowledgementLost: fullRecovery});

    child = await pollGoal(child.id, g => !!g.documentEditState?.notesEdit?.proposal || ['needs_input', 'completed', 'cancelled'].includes(g.status), 'genuine selected-note paragraph decision is saved');
    const saved = child.documentEditState; assert(saved?.notesEdit?.proposal && saved.writingAttempt?.raw, child.message);
    const native = checkNoteRewrite(saved.writingAttempt.raw, selected.text), noteEdit = structuredClone(saved.notesEdit), raw = structuredClone(saved.writingAttempt), operationId = saved.operationId, proposalSha256 = saved.proposalSha256;
    const expectedNotes = notes.slice(0, selected.start) + native.text + notes.slice(selected.end);
    assert.equal(noteEdit.before, selected.text); assert.equal(noteEdit.start, selected.start); assert.equal(noteEdit.end, selected.end); assert.equal(noteEdit.paragraphSha256, selected.sha256); assert.equal(noteEdit.notesSha256, options.notesSha256);
    assert.equal(noteEdit.proposal, native.text); assert.equal(noteEdit.proposedNotes, expectedNotes); assert.equal(noteEdit.proposedNotesSha256, sha(expectedNotes)); assert.equal(raw.sha256, sha(JSON.stringify(raw.raw)));
    assert.deepEqual(saved.before, summary); assert.deepEqual(saved.proposal, summary); assert.deepEqual(saved.preserved.citations, citations); assert.equal(saved.preserved.notes, notes);
    const sampling = findSampling(child.documentEdit.inferenceProfile); assert(sampling && sampling.chat_template_kwargs?.enable_thinking === false);
    record.nativeRewrite = native; record.savedNativeRaw = raw; record.noteEdit = noteEdit; record.expectedNotes = {characters: expectedNotes.length, sha256: sha(expectedNotes)}; record.interruptedProposal = structuredClone(child);
    const writerStarts = child.events.filter(e => e.phase === 'proposing_document_edit').length;
    if (fullRecovery) {
      assert.equal(child.status, 'running', 'The new-mode raw cut must interrupt actual active review, not an idle accepted proposal.'); assert.equal(saved.phase, 'proposal_saved');
      const posts = mutationCount(); record.cuts.push({point: 'native_selected_note_saved_before_review', pid: host.pid, signal: 'SIGKILL'}); await stopHost(host, 'SIGKILL'); host = undefined; await boot(); await page.reload({waitUntil: 'networkidle'}); await openGoals();
      child = await pollGoal(child.id, g => g.status === 'needs_input', 'saved-note interruption requires explicit continuation'); assert.deepEqual(child.documentEditState.writingAttempt, raw); assert.deepEqual(child.documentEditState.notesEdit, noteEdit); assert.deepEqual(child.documentEdit.target, target); assert.equal(child.documentEditState.operationId, operationId); assert.equal(mutationCount(), posts); assert.equal((await get('/api/documents/' + baseArtifact.documentId)).revision, 2); await continueGoal();
    }
    child = await pollGoal(child.id, g => g.documentEditState?.phase === 'awaiting_approval' || g.documentEditState?.phase === 'rejected' || ['completed', 'cancelled'].includes(g.status), 'selected-note proposal reaches explicit review');
    assert.equal(child.status, 'needs_input'); assert.equal(child.documentEditState.phase, 'awaiting_approval', child.message); assert.deepEqual(child.documentEditState.writingAttempt, raw); assert.deepEqual(child.documentEditState.notesEdit, noteEdit); assert.equal(child.events.filter(e => e.phase === 'proposing_document_edit').length, writerStarts);
    for (const flag of ['supported', 'meaningRetained', 'plannedActionsRetained', 'noCompletedWorkInvented', 'clearerForNewcomer']) assert.equal(child.documentEditState.supportReview?.[flag], true, 'Native support role must explicitly retain note contract: ' + flag);
    check('The actual native rewrite changes more than punctuation, retains planned collection/privacy concepts without detected completed-work claims, and changes only the selected note slice; saved raw/selection survive the recorded new-mode interruption without regeneration.', {native, operationId, proposalSha256, interrupted: fullRecovery, meaningReview: child.documentEditState.supportReview});

    await openReview(); const review = dialog(), beforeRegion = review.getByRole('region', {name: 'Before personal-note paragraph', exact: true}), afterRegion = review.getByRole('region', {name: 'Proposed personal-note paragraph', exact: true}), middle = review.getByRole('region', {name: 'Personal-note comparison and evidence', exact: true});
    assert.match(await review.innerText(), /Version 2\s*→\s*proposed version 3/iu); assert.match(await review.innerText(), /Personal notes|Personal-note/iu); assert.match(await review.innerText(), /Paragraph 2/iu);
    assert(compact(await beforeRegion.innerText()).includes(compact(selected.text))); assert(compact(await afterRegion.innerText()).includes(compact(native.text)));
    const rawDetails = review.locator('details').filter({has: page.locator('summary').filter({hasText: /^Exact raw paragraph comparison and evidence$/})}); await rawDetails.locator('> summary')[pointer]();
    const rawBefore = JSON.parse(await rawDetails.locator('pre[aria-label="Raw before personal-note paragraph JSON"]').innerText()), rawProposed = JSON.parse(await rawDetails.locator('pre[aria-label="Raw proposed personal-note paragraph JSON"]').innerText());
    assert.equal(typeof rawBefore === 'string' ? rawBefore : rawBefore.text, selected.text); assert.equal(typeof rawProposed === 'string' ? rawProposed : rawProposed.text, native.text);
    const diff = JSON.parse(await rawDetails.locator('pre[aria-label="Exact personal-note paragraph diff JSON"]').innerText()); record.inspectedExactDiff = diff; assert(JSON.stringify(diff).includes(JSON.stringify(selected.text).slice(1, -1))); assert(JSON.stringify(diff).includes(JSON.stringify(native.text).slice(1, -1)));
    assert.deepEqual(JSON.parse(await rawDetails.locator('pre[aria-label="Raw native edit decision JSON"]').innerText()), raw.raw); await rawDetails.locator('> summary')[pointer](); await middle.evaluate(e => {e.scrollTop = 0;});
    const size = await review.boundingBox(), b = await beforeRegion.boundingBox(), a = await afterRegion.boundingBox(), m = await middle.boundingBox(); assert(size.x >= 0 && size.x + size.width <= viewports[viewportName].width && size.y >= 0 && size.y + size.height <= viewports[viewportName].height);
    if (viewportName === 'desktop') {
      assert(size.width >= 800 && size.width <= 1000); assert(a.x > b.x && a.width >= 330 && b.width >= 330);
      assert(b.y >= m.y && a.y >= m.y && b.y + b.height <= m.y + m.height && a.y + a.height <= m.y + m.height, 'The full desktop before/proposed note paragraphs must be visible together in the expanded review.');
      await reachable(review.getByRole('button', {name: 'Apply proposed edit', exact: true}), 'Explicit desktop note Apply'); await screenshot('rendered-selected-note-comparison-and-apply-1440');
    }
    else {assert(a.y > b.y); await afterRegion.scrollIntoViewIfNeeded(); await reachable(review.getByRole('button', {name: 'Apply proposed edit', exact: true}), 'Short fixed note Apply'); await screenshot('selected-note-proposal-and-apply-360x420');}
    assert(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); record.reviewLayout = {viewport: viewports[viewportName], dialog: size, middle: m, before: b, proposed: a};
    await cancelReview(false); await openReview(); await cancelReview(true);
    check('Section-aware rendered review identifies base2→proposed3 and Personal notes paragraph2, exposes exact raw paragraph/diff, keeps bounded desktop/short actions, and restores focus on Cancel/Escape without approval.', {reviewLayout: record.reviewLayout});

    if (fullRecovery) {
      const competingKey = randomUUID(), created = await post('/api/goals/' + parent.id + '/document-edit', {requestKey: competingKey, intent, target}); competitor = await pollGoal(created.value.id, g => g.documentEditState?.phase === 'awaiting_approval' || g.documentEditState?.phase === 'rejected' || g.status === 'completed', 'intentional competing selected-note proposal is pending');
      assert.equal(competitor.documentEditState?.phase, 'awaiting_approval', competitor.message); assert.equal(competitor.documentEditState.approvedProposalSha256, undefined); record.intentionalCompetingProposal = structuredClone(competitor);
    }
    await openReview(); await page.route(base + '/api/goals/' + child.id + '/document-edit/apply', async route => {assert.deepEqual(route.request().postDataJSON(), {operationId, proposalSha256}); const response = await route.fetch(); assert(response.ok()); record.lostApplyAcknowledgement = {status: response.status(), operationId, proposalSha256}; await route.abort('connectionfailed');}, {times: 1});
    const apply = dialog().getByRole('button', {name: 'Apply proposed edit', exact: true}); await reachable(apply, 'Selected-note Apply before uncertain delivery'); if (viewportName === 'desktop') await page.keyboard.press('Enter'); else await apply.tap();
    const inspect = dialog().getByRole('button', {name: 'Inspect saved edit', exact: true}); await inspect.waitFor(); await until(() => inspect.isEnabled(), 'lost note Apply acknowledgement settles'); await reachable(inspect, 'Unconfirmed selected-note Inspect'); if (viewportName === 'narrow') await screenshot('unconfirmed-selected-note-inspect-360x420');
    child = await get('/api/goals/' + child.id); assert.equal(child.documentEditState.approvedProposalSha256, proposalSha256); assert.equal(child.documentEditState.operationId, operationId); assert.deepEqual(child.documentEdit.target, target); const appliedPosts = mutationCount();
    if (fullRecovery) {
      assert.equal(child.status, 'running', 'The note approval cut must interrupt genuinely unfinished execution.'); assert.equal(child.documentEditState.artifact, undefined); record.approvedBeforeKill = structuredClone(child); record.cuts.push({point: 'selected_note_approval_saved_ack_lost', phase: child.documentEditState.phase, pid: host.pid, signal: 'SIGKILL'});
      await stopHost(host, 'SIGKILL'); host = undefined; await boot(); await page.reload({waitUntil: 'networkidle'}); await openGoals(); assert.equal(mutationCount(), appliedPosts); const outsideInspect = action(child.id, 'Inspect saved edit'); await outsideInspect.waitFor(); await until(() => outsideInspect.isEnabled(), 'restarted note approval Inspect'); await outsideInspect[pointer](); await until(async () => !await outsideInspect.isVisible(), 'saved note approval is read-only reconciled');
      child = await get('/api/goals/' + child.id); assert.deepEqual(child.documentEdit.target, target); if (child.status !== 'completed') {assert.equal(child.status, 'needs_input'); await continueGoal();}
    } else {
      await inspect[pointer](); await until(async () => !await inspect.isVisible(), 'phone note approval reconciles');
      // The already-approved renderer may finish while this modal closes; avoid
      // treating unrelated background progress as a Cancel-induced mutation.
      const posts = mutationCount(); await dialog().getByRole('button', {name: 'Cancel review', exact: true})[pointer]();
      await dialog().waitFor({state: 'hidden'}); assert.equal(mutationCount(), posts);
    }
    child = await pollGoal(child.id, g => ['completed', 'needs_input', 'cancelled'].includes(g.status), 'one approved selected-note version3 finishes'); assert.equal(child.status, 'completed', child.message); assert.equal(child.documentEditState.phase, 'saved'); assert.equal(child.documentEditState.operationId, operationId); assert.deepEqual(child.documentEditState.writingAttempt, raw); assert.deepEqual(child.documentEditState.notesEdit, noteEdit); assert.deepEqual(child.documentEditState.proposal, summary); assert.deepEqual(child.documentEdit.target, target);
    const artifact = child.documentEditState.artifact; assert.equal(artifact.revision, 3); assert.equal(artifact.documentId, baseArtifact.documentId); assert.deepEqual((await get('/api/documents/' + artifact.documentId + '/history')).map(v => v.revision).sort(), [0, 1, 2, 3]);
    assert.equal((await get('/api/goals')).filter(g => g.documentEdit?.requestKey === requestKey).length, 1); assert.equal(record.apiMutations.filter(r => !r.explicitApiNegativeOrReconciliation && r.path === '/api/goals/' + child.id + '/document-edit/apply').length, 1); record.artifact = artifact; record.completedChild = structuredClone(child);
    check('Actual uncertain Apply preserves the exact composite note/selection approval; inspection never resubmits it and recorded explicit continuation publishes one operation/version3.', {artifact, interruptedAfterApproval: fullRecovery});

    if (competitor) {
      const bState = structuredClone(competitor.documentEditState), staleApply = await post('/api/goals/' + competitor.id + '/document-edit/apply', {operationId: bState.operationId, proposalSha256: bState.proposalSha256}, false); assert(!staleApply.ok && staleApply.status >= 400); assert.match(staleApply.value.error, /current|changed|stale|version|revision/iu);
      competitor = await get('/api/goals/' + competitor.id); assert.deepEqual(competitor.documentEditState.writingAttempt, bState.writingAttempt); assert.deepEqual(competitor.documentEditState.notesEdit, bState.notesEdit); assert.equal(competitor.documentEditState.approvedProposalSha256, undefined); const starts = competitor.events.filter(e => e.phase === 'proposing_document_edit').length;
      await continueGoal(competitor.id); competitor = await pollGoal(competitor.id, g => g.status === 'needs_input', 'stale note proposal remains unfinished'); assert.deepEqual(competitor.documentEditState.writingAttempt, bState.writingAttempt); assert.deepEqual(competitor.documentEditState.notesEdit, bState.notesEdit); assert.equal(competitor.events.filter(e => e.phase === 'proposing_document_edit').length, starts); record.staleCompetingProposal = {apply: staleApply, finalGoal: competitor};
    }
    const beforeStale = (await get('/api/goals')).length, staleCreates = [];
    for (const ancestor of [firstEdit, parent]) {const response = await post('/api/goals/' + ancestor.id + '/document-edit', {requestKey: randomUUID(), intent, target}, false); assert(!response.ok && response.status >= 400); assert.match(response.value.error, /current|changed|stale|version|revision/iu); staleCreates.push({parentId: ancestor.id, ...response});}
    assert.equal((await get('/api/goals')).length, beforeStale); assert.equal((await get('/api/documents/' + artifact.documentId)).revision, 3); record.staleCreates = staleCreates;
    check('Stale note bases cannot publish another version or create a new child; the deliberate desktop competing raw note/selection is preserved rather than regenerated.', {competingProposalTested: !!competitor, staleCreateStatuses: staleCreates.map(r => r.status)});

    const v3pdf = await download(child.id, 'Download revised PDF', 'version-3-revised.pdf'), v3html = await download(child.id, 'Download revised HTML', 'version-3-revised.html'), v3prov = await download(child.id, 'Download edit provenance', 'version-3-provenance.json');
    assert.equal(v3pdf.receipt.sha256, artifact.pdfSha256); assert.equal(v3html.receipt.sha256, artifact.htmlSha256); assert.equal(v3prov.receipt.sha256, artifact.provenanceSha256); assert.equal(v3pdf.bytes.subarray(0, 5).toString(), '%PDF-'); assert.match(v3pdf.receipt.type, /^application\/pdf/u); assert.match(v3html.receipt.type, /^text\/html/u);
    const provenance = JSON.parse(v3prov.bytes); assert.equal(provenance.personalNotes, expectedNotes); assert.deepEqual(provenance.paragraphs, record.baseProvenance.paragraphs); assert.deepEqual(provenance.citations, record.baseProvenance.citations); assert.deepEqual(provenance.sources, record.baseProvenance.sources); assert(JSON.stringify(provenance).includes(JSON.stringify(raw.raw).slice(1, -1)) || JSON.stringify(provenance).includes(JSON.stringify(raw.raw)));
    const python = process.env.PYTHON_PATH || join(studioRoot, '.venv/bin/python'), opened = await exec(python, ['-c', "import pymupdf as f,json,pathlib,sys\np=f.open(sys.argv[1]);out=pathlib.Path(sys.argv[2]);pages=[]\nfor i,page in enumerate(p):\n page.get_pixmap(matrix=f.Matrix(1.15,1.15)).save(str(out/('version-3-pdf-page-'+str(i+1)+'.png')))\n pages.append({'page':i+1,'text':page.get_text(),'links':[{'uri':l.get('uri'),'rect':list(l['from'])} for l in page.get_links()]})\nprint(json.dumps({'pages':pages,'pageCount':len(p)}))", v3pdf.path, folder], {maxBuffer: 4_000_000});
    const pdf = JSON.parse(opened.stdout); await writeFile(join(folder, 'version-3-pdf-inspection.json'), JSON.stringify(pdf, null, 2) + '\n'); assert.equal(pdf.pageCount, artifact.pages); const actualPdfText = pdf.pages.map(p => p.text).join('\n'); assert.equal(compact(actualPdfText).split(compact(expectedNotes)).length - 1, 1); assert(compact(actualPdfText).includes(compact(summary.paragraphs.map(p => p.text).join('\n\n'))));
    const requiredTargets = [...new Set([...citations.flatMap(c => literalHttps(c.quote)), ...record.baseProvenance.sources.map(s => s.url)])], pdfTargets = pdf.pages.flatMap(p => p.links.map(l => l.uri)); for (const target of requiredTargets) assert(pdfTargets.includes(target));
    const openedPage = context.waitForEvent('page'); openedPage.catch(() => {}); await action(child.id, 'Open revised HTML')[pointer](); const htmlPage = await openedPage; await htmlPage.waitForLoadState('domcontentloaded'); const htmlResponse = await page.request.get(new URL(await action(child.id, 'Open revised HTML').getAttribute('href'), base).href); assert(htmlResponse.ok()); assert.deepEqual(await htmlResponse.body(), v3html.bytes);
    const visibleHtml = await htmlPage.locator('body').innerText(); assert.equal(compact(visibleHtml).split(compact(expectedNotes)).length - 1, 1); assert(compact(visibleHtml).includes(compact(summary.paragraphs[0].text))); assert.equal(await htmlPage.locator('script,iframe,form,object,embed').count(), 0); const links = await htmlPage.locator('a[href]').evaluateAll(elements => elements.map(e => e.getAttribute('href'))); for (const target of requiredTargets) assert(links.includes(target)); assert(await htmlPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (viewportName === 'narrow') {await htmlPage.evaluate(text => {const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) if (node.nodeValue?.includes(text)) {const range = document.createRange(); range.selectNodeContents(node); const rect = range.getBoundingClientRect(); window.scrollTo(0, window.scrollY + rect.top - 24); return;} throw new Error('Actual rewritten note text is not in readable HTML.');}, native.text); await htmlPage.screenshot({path: join(folder, 'version-3-edited-note-html-360x420.png')}); record.screenshots.push('version-3-edited-note-html-360x420.png');} await htmlPage.close();
    const historical = [[parent.id, 'Download original PDF', v0pdf, 'version-0-after.pdf'], [parent.id, 'Download original HTML', v0html, 'version-0-after.html'], [firstEdit.id, 'Download revised PDF', v1pdf, 'version-1-after.pdf'], [firstEdit.id, 'Download revised HTML', v1html, 'version-1-after.html'], [firstEdit.id, 'Download edit provenance', v1prov, 'version-1-after-provenance.json'], [parent.id, 'Download revised PDF', v2pdf, 'version-2-after.pdf'], [parent.id, 'Download revised HTML', v2html, 'version-2-after.html'], [parent.id, 'Download edit provenance', v2prov, 'version-2-after-provenance.json']];
    for (const [id, label, beforeFile, filename] of historical) {const after = await download(id, label, filename); assert.deepEqual(after.bytes, beforeFile.bytes, 'Every pinned old version export must stay byte-identical.');}
    const afterFiles = await fileManifest(join(data, 'documents', baseArtifact.documentId)); for (const before of acceptedDocumentFiles) assert.deepEqual(afterFiles.find(f => f.path === before.path), before, 'Existing accepted operation/document files must not be rewritten.');
    record.storedAncestorsAfter = await storedGoalIdentities(ancestors.map(g => g.id)); assert.deepEqual(record.storedAncestorsAfter, record.storedAncestorsBefore); for (const ancestor of ancestors) assert.deepEqual(stableParent(await get('/api/goals/' + ancestor.id)), stableParent(ancestor));
    record.outputCritique = {nativeText: native.text, notPunctuationOnly: true, plannedConcepts: native.concepts, noDetectedCompletedWorkClaim: true, exactOtherNotePrefixSuffixPreserved: true, completeNotesOnce: true, summaryAndCitationsSourcesUnchanged: true, historicalVersions: [0, 1, 2], historicalFilesAndAncestorJsonByteIdentical: true, pages: pdf.pageCount, sourceLinks: pdfTargets, limit: 'Specific planned personal-note paragraph rewrite with literal checks and inspectable native semantic review; not general editing or independent meaning accuracy.'};
    check('Actual PDF/HTML/provenance have correct MIME/signature/hash, open with the complete native note rewrite once, preserve the exact rest of notes/summary/citations/sources, and retain all version0/1/2 exports, accepted files and ancestor JSON byte-for-byte.', {artifact, outputCritique: record.outputCritique});
    await action(child.id, 'Open revised PDF')[pointer](); await decodedPdfPage(1); const current = await get('/api/goals/' + child.id), reopenPosts = mutationCount(); record.cuts.push({point: 'completed_note_version3_reopen', pid: host.pid, signal: 'SIGTERM'}); await stopHost(host, 'SIGTERM'); host = undefined; await boot(); await page.reload({waitUntil: 'networkidle'}); await openGoals(); await card(child.id).waitFor(); assert.deepEqual(await get('/api/goals/' + child.id), current); assert.equal(mutationCount(), reopenPosts); await action(child.id, 'Open revised PDF')[pointer](); await decodedPdfPage(1); assert.deepEqual((await get('/api/documents/' + artifact.documentId + '/history')).map(v => v.revision).sort(), [0, 1, 2, 3]);
    record.finalGoal = await get('/api/goals/' + child.id); check('Accepted version3 reopens after an owned graceful restart with the same selected-note operation and no replay or historical change.');
  }
}

export async function runResearchDocumentNoteEditSuite(options = {}) {
  options = {viewport: 'all', ...options}; assert(options.output && options.fixture, 'Choose fresh --output and explicit stopped accepted --fixture data');
  options.output = resolve(studioRoot, options.output); options.fixture = await realpath(resolve(studioRoot, options.fixture)); const normal = await realpath(join(studioRoot, '.data'));
  assert.notEqual(options.fixture, normal, 'Never clone normal user data for this journey'); assert(!options.output.startsWith(options.fixture + '/')); await access(join(options.fixture, 'studio.sqlite')); await access(join(studioRoot, 'out/index.html')); await mkdir(options.output);
  const names = options.viewport === 'all' ? Object.keys(viewports) : [options.viewport]; assert(names.every(n => viewports[n]), 'Use desktop, narrow or all');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim(), report = {source, sourceDirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: studioRoot, encoding: 'utf8'}).trim(), startedAt: new Date().toISOString(), lane: 'accepted-v2-real-native-note-edit', fingerprints: await fingerprints(), results: []};
  const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium'}); let interrupted = false;
  const cancel = () => {interrupted = true; void Promise.allSettled([...activeHosts].map(h => stopHost(h))).then(() => browser.close());}; process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {for (const name of names) {if (interrupted) break; const result = await runCase(browser, name, options); report.results.push(result); console.log(result.status.toUpperCase() + ' note-edit [' + name + '] ' + (result.reason || intent));}}
  finally {process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); await Promise.allSettled([...activeHosts].map(h => stopHost(h))); await browser.close();}
  try {assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim(), source, 'Source commit must remain fixed during native acceptance'); assert.deepEqual(await fingerprints(), report.fingerprints, 'Product source/served build changed during native acceptance');} catch (e) {report.verificationError = e.message;}
  report.summary = Object.fromEntries(['passed', 'blocked', 'failed'].map(status => [status, report.results.filter(r => r.status === status).length])); report.assertions = report.results.reduce((n, r) => n + r.assertions.length, 0);
  report.status = interrupted ? 'interrupted' : report.summary.failed || report.verificationError ? 'failed' : report.summary.blocked ? 'incomplete' : 'passed'; report.goalAchieved = report.status === 'passed'; report.exitCode = interrupted ? 130 : report.summary.failed || report.verificationError ? 1 : report.summary.blocked ? 2 : 0; report.finishedAt = new Date().toISOString();
  await writeFile(join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); return report;
}
async function main() {
  const options = {}, args = process.argv.slice(2); for (let i = 0; i < args.length; i++) {const flag = args[i]; assert(['--viewport', '--output', '--fixture'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--'), 'Usage: node scripts/e2e/research-document-note-edit.mjs --fixture STOPPED_V2_DATA --viewport all|desktop|narrow --output FRESH_DIR'); options[flag.slice(2)] = args[++i];}
  const r = await runResearchDocumentNoteEditSuite(options); process.exitCode = r.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
