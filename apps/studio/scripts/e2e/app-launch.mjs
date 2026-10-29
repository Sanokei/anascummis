#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants, createWriteStream} from 'node:fs';
import {access, cp, mkdir, readFile, readdir, realpath, symlink, writeFile} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'node:net';
import {join, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
import {redactTrace} from './artifacts.mjs';

const studioRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const viewports = {desktop: {width: 1440, height: 1000}, narrow: {width: 360, height: 800}};
const activeHosts = new Set();
const defaults = {
  collectionFixture: '.test-data/user-journeys/task-list-native-fixed-desktop/task-list-application-desktop/private-data',
  parent: 'e261cd74-7630-4210-960e-6602b417e178', child: '3913421e-e224-4968-9045-622f161a2d0c',
  counterFixture: '.test-data/user-journeys/counter-ux-native-final/counter-application-desktop/private-data',
  counter: '3df01946-1359-4e9f-8036-ec02ed037b09', viewport: 'all', scenario: 'all'
};

async function until(check, label, milliseconds = 30_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {const result = await check(); if (result) return result; await delay(100);}
  throw new Error('Timed out: ' + label);
}
async function freePort() {
  const server = createServer(); await new Promise((done, fail) => {server.once('error', fail); server.listen(0, '127.0.0.1', done);});
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
async function pidState(pid) {
  try {const stat = await readFile('/proc/' + pid + '/stat', 'utf8'); const suffix = stat.slice(stat.lastIndexOf(')') + 2).split(' '); return {state: suffix[0], startTime: suffix[19]};}
  catch (error) {if (error.code === 'ENOENT') return {state: 'absent'}; throw error;}
}
async function awaitProcessExit(pid, label) {
  return until(async () => {const current = await pidState(pid); return ['absent', 'Z', 'X'].includes(current.state) && current;}, label);
}
async function stopHost(host, signal = 'SIGTERM') {
  if (!host) return;
  if (!host.pid) {activeHosts.delete(host); return;}
  if (host.exitCode !== null || host.signalCode) {activeHosts.delete(host); return;}
  const exited = new Promise(done => host.once('exit', done)); host.kill(signal);
  const timer = setTimeout(() => host.kill('SIGKILL'), 10_000); timer.unref(); await exited; clearTimeout(timer); activeHosts.delete(host);
}
async function originalIdentity(data, ids) {
  const entries = [];
  for (const name of ['studio.sqlite', 'studio.sqlite-wal', 'studio.sqlite-shm']) {
    try {const bytes = await readFile(join(data, name)); entries.push({path: name, bytes: bytes.length, sha256: sha(bytes)});}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  for (const id of ids) {
    async function walk(folder, relative = '') {
      for (const entry of await readdir(folder, {withFileTypes: true})) {
        if (['node_modules', '.next', '.qa'].includes(entry.name)) continue;
        const name = relative + entry.name, path = join(folder, entry.name);
        if (entry.isDirectory()) await walk(path, name + '/');
        else if (entry.isFile()) {const bytes = await readFile(path); entries.push({path: 'software/' + id + '/' + name, bytes: bytes.length, sha256: sha(bytes)});}
      }
    }
    await walk(join(data, 'software', id));
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
async function copyStoppedFixture(source, destination, ids) {
  assert(destination !== source && !destination.startsWith(source + sep), 'Evidence data must stay outside the preserved source fixture.');
  const before = await originalIdentity(source, ids);
  await cp(source, destination, {recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true,
    filter: path => !path.slice(source.length).split(/[\\/]/).some(part => ['node_modules', '.next'].includes(part))});
  const dependencies = [];
  for (const id of ids) {
    const original = await realpath(join(source, 'software', id, 'node_modules'));
    await symlink(original, join(destination, 'software', id, 'node_modules'), 'dir');
    const packages = {};
    for (const name of ['react', 'react-dom']) {const bytes = await readFile(join(original, name, 'package.json')); const value = JSON.parse(bytes); packages[name] = {version: value.version, packageSha256: sha(bytes)};}
    dependencies.push({taskId: id, existingDependencyTree: original, packages});
  }
  assert.deepEqual(await originalIdentity(source, ids), before);
  return {before, dependencies};
}
async function fingerprintSource() {
  const paths = ['scripts/e2e/app-launch.mjs', 'scripts/e2e/artifacts.mjs', 'app/page.tsx', 'app/style.css', 'components/SoftwareLaunch.tsx', 'components/SoftwarePanel.tsx',
    'core/server.ts', 'core/storage.ts', 'core/software-api.ts', 'core/software-task.ts', 'core/software-launch.ts', 'core/app-launch-package.ts', 'core/app-launch-process.ts',
    'core/react-screen.ts', 'core/collection-screen.ts', 'core/activity-journal.ts', 'core/zip.ts', 'worker/app-launch.ts', 'package.json', 'bun.lock'];
  return Promise.all(paths.map(async path => {const bytes = await readFile(join(studioRoot, path)); return {path, bytes: bytes.length, sha256: sha(bytes)};}));
}
async function fingerprintBuild() {
  const result = [];
  async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      if (entry.name === 'opensource' || entry.isSymbolicLink()) continue;
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(folder, entry.name), name + '/');
      else if (/\.(?:html|js|css|json)$/.test(name)) {const bytes = await readFile(join(folder, entry.name)); result.push({path: 'out/' + name, bytes: bytes.length, sha256: sha(bytes)});}
    }
  }
  await walk(join(studioRoot, 'out')); return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function runCase(browser, kind, viewportName, options) {
  const folder = join(options.output, kind + '-' + viewportName); await mkdir(folder, {recursive: true});
  const source = resolve(studioRoot, kind === 'collection' ? options.collectionFixture : options.counterFixture);
  const ids = kind === 'collection' ? [options.parent, options.child] : [options.counter];
  const data = join(folder, 'private-data');
  const record = {id: 'in-window-' + kind, viewport: viewportName, startedAt: new Date().toISOString(), status: 'running',
    artifactDirectory: kind + '-' + viewportName,
    lane: 'actual-previously-native-generated-checkpoint',
    goal: kind === 'collection' ? 'Start and use an accepted My Tasks app inside Software work, retain items across close/reload/Stop/restart, and explicitly open its accepted My Week child without changing accepted work.' : 'Use an accepted counter inside Software work through pointer/touch and keyboard, Stop it, and reopen the same checked app.',
    assertions: [], screenshots: [], apiMutations: [], pageErrors: [], requests: [], processes: [], downloads: [], mainNavigations: [],
    limitations: ['This launches copied, previously native-generated accepted work; it is not fresh inference or arbitrary model-written server execution.', 'Fixed trusted React browser runtime executes exact accepted client Page code; this is not the packaged Next server.', 'Existing matching dependencies are reused; no online installation, native OS or physical handset/voice pass.']};
  let fixture, host, context, page, blocker, step = 0;
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const launchPosts = () => record.apiMutations.filter(x => /\/launch\/(?:start|stop)$/.test(x.path));
  const assertStep = (name, evidence = {}) => record.assertions.push({name, passed: true, ...evidence});
  const screenshot = async (name, target) => {
    if (target) await target.scrollIntoViewIfNeeded();
    const file = String(++step).padStart(2, '0') + '-' + name + '.png'; await page.screenshot({path: join(folder, file)}); record.screenshots.push(file);
  };
  async function boot() {
    const log = createWriteStream(join(folder, 'host-' + (record.processes.length + 1) + '.log'));
    host = spawn(process.env.BUN_PATH || 'bun', ['core/server.ts'], {cwd: studioRoot,
      env: {...process.env, STUDIO_DEV: '0', STUDIO_PORT: String(port), STUDIO_DATA: data, STUDIO_TEST_DATA: data}, stdio: ['ignore', 'pipe', 'pipe']});
    activeHosts.add(host);
    let spawnError; host.once('error', error => {spawnError = error;}); host.stdout.pipe(log); host.stderr.pipe(log);
    record.processes.push({pid: host.pid, port, command: 'bun core/server.ts', startedAt: new Date().toISOString()});
    await until(async () => {if (spawnError) throw spawnError; if (host.exitCode !== null || host.signalCode) throw new Error('Owned Studio exited before readiness.'); try {const response = await fetch(base + '/api/status', {signal: AbortSignal.timeout(2000)}); return response.ok;} catch {}}, 'owned ordinary Studio starts');
  }
  async function rejectDuplicateStudio(id) {
    const before = await launch(id), posts = launchPosts().length;
    const log = createWriteStream(join(folder, 'duplicate-studio-rejected.log'));
    const duplicate = spawn(process.env.BUN_PATH || 'bun', ['core/server.ts'], {cwd: studioRoot,
      env: {...process.env, STUDIO_DEV: '0', STUDIO_PORT: String(port), STUDIO_DATA: data, STUDIO_TEST_DATA: data}, stdio: ['ignore', 'pipe', 'pipe']});
    activeHosts.add(duplicate);
    let spawnError; duplicate.once('error', error => {spawnError = error;}); duplicate.stdout.pipe(log); duplicate.stderr.pipe(log);
    try {
      await until(() => {if (spawnError) throw spawnError; return duplicate.exitCode !== null || duplicate.signalCode;}, 'second Studio fails its occupied bind', 15_000);
      assert.notEqual(duplicate.exitCode, 0, 'Second Studio must fail its bind.');
    } finally {await stopHost(duplicate);}
    const after = await launch(id); assert.equal(after.state, 'running'); assert.equal(after.updated, before.updated); assert.deepEqual(startIdentity(after), startIdentity(before)); assert.equal(launchPosts().length, posts);
    record.processes.push({duplicateStudioPid: duplicate.pid, exitCode: duplicate.exitCode, rejectedOccupiedBind: true, originalAppProcessId: before.processId});
    assertStep('A second Studio attempt on the same data/address fails its bind without interrupting or relabelling the original running app.');
  }
  async function checkLocalOnlyGuards(id) {
    const before = await launch(id), posts = launchPosts().length;
    // These rejected contract probes stay outside Playwright tracing. Neither
    // session nor pairing values are recorded in this report or the browser trace.
    const cookie = (await context.cookies(base)).map(value => value.name + '=' + value.value).join('; ');
    const pairingResponse = await fetch(base + '/api/software-pairing', {headers: {Cookie: cookie}, signal: AbortSignal.timeout(5000)}); assert.equal(pairingResponse.status, 200);
    const pairing = await pairingResponse.json(); assert(typeof pairing.key === 'string');
    record.rejectedApiGuards = [];
    for (const method of ['GET', 'POST']) {
      const response = await fetch(base + '/api/software/' + id + '/launch' + (method === 'POST' ? '/start' : ''), {method,
        headers: {Origin: 'https://anascummis.com', 'X-Anascummis-Pair': pairing.key, ...(method === 'POST' ? {'Content-Type':'application/json'} : {})}, ...(method === 'POST' ? {body:'{}'} : {}), signal: AbortSignal.timeout(5000)});
      assert.equal(response.status, 403, 'Paired online origins cannot use local-only launch.'); const error = await response.json(); record.rejectedApiGuards.push({method, contract:'paired-online launch', status:response.status, error:String(error.error)});
    }
    const rejected = await fetch(base + '/api/software/' + id + '/launch/start', {method:'POST', headers:{Cookie:cookie, Origin:base, 'X-Requested-With':'Anascummis', 'Content-Type':'application/json'}, body:JSON.stringify({command:'unrecognized-public-test-marker'}), signal:AbortSignal.timeout(5000)});
    assert.equal(rejected.status, 400, 'Unknown launch command fields must be rejected.'); const detail = await rejected.json(); record.rejectedApiGuards.push({method:'POST',contract:'nonempty Start body',status:rejected.status,error:String(detail.error)});
    assert.deepEqual(startIdentity(await launch(id)), startIdentity(before)); assert.equal((await launch(id)).state, before.state); assert.equal(launchPosts().length, posts);
    assertStep('A valid paired-online key still cannot launch locally; unknown Start command fields are rejected without changing launch state.', {statuses:record.rejectedApiGuards.map(value=>value.status)});
  }
  async function get(path) {const response = await page.request.get(base + path); assert(response.ok(), path + ': ' + response.status()); return response.json();}
  const launch = id => get('/api/software/' + id + '/launch');
  const card = id => page.locator('[data-software-task-id="' + id + '"]');
  const region = id => card(id).locator('[data-app-launch-task-id="' + id + '"]');
  async function send(text) {
    const entry = page.getByRole('textbox', {name: 'Message Anascummis', exact: true});
    if (!await entry.isVisible()) await page.getByRole('button', {name: 'Type a message', exact: true}).click();
    await entry.fill(text); await page.getByRole('button', {name: 'Send message', exact: true}).click();
    const close = page.getByRole('button', {name: 'Close text input', exact: true}); if (await close.isVisible()) await close.click();
  }
  async function openSoftware() {if (!await page.locator('.software-panel').isVisible()) await send('Show software work'); await card(ids[0]).waitFor();}
  async function running(id) {return until(async () => {const value = await launch(id); assert.notEqual(value.state, 'failed', value.message); return value.state === 'running' && value.activeTaskId === id && value;}, 'actual checked app reaches running state', 120_000);}
  async function start(id) {
    await region(id).getByRole('button', {name: 'Start app', exact: true}).click();
    const state = await running(id); assert.equal(state.taskId, id); assert.notEqual(state.origin, base); assert(Number.isInteger(state.processId) && state.processId > 0); assert(state.launchId && state.startedAt && state.runtimeId && state.zipSha256);
    const iframe = card(id).locator('iframe'); await iframe.waitFor(); assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-forms');
    assert.equal(new URL(await iframe.getAttribute('src')).origin, state.origin);
    return state;
  }
  async function frame(id) {const handle = await card(id).locator('iframe').elementHandle(); assert(handle); const result = await handle.contentFrame(); assert(result); return result;}
  async function reloadApp(id, heading) {
    const app = await frame(id), loaded = app.waitForNavigation({waitUntil: 'load'});
    await Promise.all([loaded, app.evaluate(() => {location.reload();})]);
    await (await frame(id)).getByRole('heading', {name: heading, exact: true}).waitFor();
  }
  function startIdentity(value) {return Object.fromEntries(['lineageId', 'activeTaskId', 'revision', 'zipSha256', 'runtimeId', 'origin', 'processId', 'startedAt', 'launchId'].map(key => [key, value[key]]));}
  async function stop(id) {
    const before = await launch(id); await region(id).getByRole('button', {name: 'Stop running app', exact: true}).click();
    const after = await until(async () => {const value = await launch(id); return value.state === 'stopped' && value;}, 'explicit Stop finishes');
    assert.equal(after.origin, before.origin); assert.equal(await card(id).locator('iframe').count(), 0);
    const exit = await awaitProcessExit(before.processId, 'owned app exits after Stop'); record.processes.push({appPid: before.processId, explicitStopExit: exit});
    return after;
  }
  async function visibleAppControls(id,label) {
    const metrics=[];
    for(const name of ['Stop running app','Check app status','Focus app view']){
      const control=region(id).getByRole('button',{name,exact:true}),bounds=await control.boundingBox();
      assert(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=page.viewportSize().width+1&&bounds.y+bounds.height<=page.viewportSize().height+1,name+' remains inside the current viewport.');
      assert(await control.evaluate(node=>{const box=node.getBoundingClientRect();const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return hit===node||node.contains(hit);}),name+' remains pointer-accessible above the real app frame.');
      metrics.push({name,...bounds});
    }
    (record.controlLayouts||=[]).push({label,viewport:page.viewportSize(),metrics});return metrics;
  }
  async function returnToControls(id,label){
    await region(id).getByRole('button',{name:'Back to app controls',exact:true}).click();
    const stopControl=region(id).getByRole('button',{name:'Stop running app',exact:true});assert(await stopControl.evaluate(node=>document.activeElement===node),'The product Back action returns keyboard focus to Stop.');
    await visibleAppControls(id,label);await screenshot(label);
  }
  async function appLayout(id,heading){
    await region(id).getByRole('button',{name:'Focus app view',exact:true}).click();
    let app=await frame(id);await app.getByRole('heading',{name:heading,exact:true}).scrollIntoViewIfNeeded();
    const initialBox=await card(id).locator('iframe').boundingBox(),initialLogical=await app.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert(initialBox&&initialBox.width>=300&&initialLogical.width>=300,'The active app gets a readable300px or wider embedded viewport.');
    (record.appLayouts||=[]).push({viewport:page.viewportSize(),frame:initialBox,logical:initialLogical});
    await visibleAppControls(id,'running-'+kind+'-heading');await screenshot('running-'+kind+'-heading-and-controls');
    if(kind==='collection'){
      const item=app.getByRole('listitem').filter({hasText:'Keep this task'});await item.scrollIntoViewIfNeeded();const text=item.locator('span'),bounds=await text.boundingBox();
      assert(bounds&&bounds.width>=80,'The task label has room for words beside Remove, rather than one or two characters per line.');
      await visibleAppControls(id,'running-collection-items');await screenshot('running-collection-readable-items-and-controls');
    }
    await returnToControls(id,'return-to-'+kind+'-controls');
    if(viewportName!=='narrow')return;
    const originalFrame=await card(id).locator('iframe').elementHandle(),oldIdentity=startIdentity(await launch(id));let draft;
    app=await frame(id);
    if(kind==='collection'){draft='Keep this app input through a shorter viewport';await app.getByRole('textbox',{name:'New task',exact:true}).fill(draft);}
    else{const increment=app.getByRole('button',{name:'Increment',exact:true});await increment.click();await increment.click();assert.equal(await app.getByLabel('Count',{exact:true}).innerText(),'2');}
    await page.setViewportSize({width:360,height:420});
    await until(async()=>{const box=await card(id).locator('iframe').boundingBox();return box&&box.width>=300&&box.height>64;},'short viewport has a measured, contained app frame');
    assert(await originalFrame.evaluate(node=>node.isConnected),'Viewport changes retain the actual app iframe/client state.');
    await region(id).getByRole('button',{name:'Focus app view',exact:true}).click();app=await frame(id);await app.getByRole('heading',{name:heading,exact:true}).scrollIntoViewIfNeeded();
    await visibleAppControls(id,'short-'+kind+'-heading');await screenshot('short-'+kind+'-heading-and-controls');
    const measured=await card(id).locator('iframe').boundingBox(),logical=await app.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert(logical.width>=300,'The embedded app has at least300 logical CSS pixels at a360px viewport.');
    (record.appLayouts||=[]).push({viewport:{width:360,height:420},frame:measured,logical});
    if(kind==='collection'){
      assert.equal(await app.getByRole('textbox',{name:'New task',exact:true}).inputValue(),draft);await app.getByRole('listitem').filter({hasText:'Keep this task'}).scrollIntoViewIfNeeded();
    }else{assert.equal(await app.getByLabel('Count',{exact:true}).innerText(),'2');await app.getByRole('button',{name:'Reset',exact:true}).scrollIntoViewIfNeeded();}
    await visibleAppControls(id,'short-'+kind+'-interaction');await screenshot('short-'+kind+'-interaction-and-controls');
    await returnToControls(id,'short-'+kind+'-return-to-controls');
    await page.setViewportSize(viewports.narrow);await until(async()=>{const box=await card(id).locator('iframe').boundingBox();return box&&box.width>=300;},'normal narrow layout restores');
    assert(await originalFrame.evaluate(node=>node.isConnected));assert.deepEqual(startIdentity(await launch(id)),oldIdentity);
    app=await frame(id);if(kind==='collection'){assert.equal(await app.getByRole('textbox',{name:'New task',exact:true}).inputValue(),draft);await app.getByRole('textbox',{name:'New task',exact:true}).fill('');}else{assert.equal(await app.getByLabel('Count',{exact:true}).innerText(),'2');await app.getByRole('button',{name:'Reset',exact:true}).click();}
    assertStep('Actual Focus/Back controls keep Stop/Check reachable at360x800 and360x420; measured wide app viewport and existing iframe preserve saved items and client draft/count during resize.');
  }
  async function ensureItems(id, expected) {const app = await frame(id); for (const text of expected) await app.getByRole('listitem').filter({hasText: text}).waitFor(); return app;}
  async function download(id, label) {
    const task = await get('/api/software/' + id), zip = task.evidence.artifacts.find(x => x.kind === 'zip' && x.smokeTested); assert(zip);
    const pending = page.waitForEvent('download'); pending.catch(() => {}); await card(id).getByRole('button', {name: 'Download source ZIP', exact: true}).click();
    const file = await pending; const path = label + '.zip'; await file.saveAs(join(folder, path)); const bytes = await readFile(join(folder, path)); assert.equal(sha(bytes), zip.sha256); assert.equal(bytes.length, zip.bytes);
    record.downloads.push({path, bytes: bytes.length, sha256: zip.sha256}); return zip.sha256;
  }
  try {
    fixture = await copyStoppedFixture(source, data, ids); record.fixture = {source, copiedToOwnedData: true, excludedBuildCaches: true, dependencies: fixture.dependencies};
    await boot();
    context = await browser.newContext({viewport: viewports[viewportName], hasTouch: viewportName === 'narrow', reducedMotion: 'reduce', timezoneId: 'America/New_York', acceptDownloads: true});
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol)) {
        const local = url.hostname === '127.0.0.1';
        record.requests.push({method: request.method(), origin: url.origin, path: url.pathname, blocked: !local});
        if (!local) return route.abort();
      }
      return route.continue();
    });
    await context.tracing.start({screenshots: true, snapshots: true, sources: false});
    page = await context.newPage(); page.setDefaultTimeout(15_000);
    page.on('pageerror', error => record.pageErrors.push(error.message));
    page.on('framenavigated', changed => {if (changed === page.mainFrame()) record.mainNavigations.push({url:changed.url(),time:new Date().toISOString()});});
    page.on('request', request => {const url = new URL(request.url()); if (request.method() === 'POST' && url.origin === base) record.apiMutations.push({path: url.pathname, time: new Date().toISOString()});});
    await page.goto(base, {waitUntil: 'networkidle'}); await openSoftware();
    const tasksBefore = Object.fromEntries(await Promise.all(ids.map(async id => [id, await get('/api/software/' + id)])));
    for (const task of Object.values(tasksBefore)) {assert.equal(task.status, 'completed'); assert(task.evidence.checks.every(check => check.ok));}
    record.acceptedBefore = tasksBefore;
    const before = await launch(ids[0]); assert.equal(before.state, 'stopped'); assert(before.supported, before.reason || before.message); assert.equal(launchPosts().length, 0);
    await screenshot('checked-build-explicit-start', region(ids[0]));
    await checkLocalOnlyGuards(ids[0]);
    if (kind === 'counter') {
      await page.route(base + '/api/software/' + ids[0] + '/launch/start', async route => {
        const actual = await route.fetch(); await actual.body(); await route.abort('connectionfailed');
      }, {times: 1});
    }
    const first = await start(ids[0]); record.firstLaunch = first;
    assert.equal(launchPosts().length, 1); assertStep('Only a visible Start creates the product-managed trusted runtime, pinned to accepted ZIP/source and a separate origin.', first);
    if (kind === 'counter') {
      await region(ids[0]).getByRole('alert').filter({hasText: 'Start was not confirmed'}).waitFor();
      assert(await region(ids[0]).getByRole('button',{name:'Reload app view',exact:true}).isDisabled(), 'An unconfirmed Start must not recreate the app iframe.');
      await screenshot('unconfirmed-start-inspect-before-retry', region(ids[0]));
      assert.equal(launchPosts().length, 1); await region(ids[0]).getByRole('button', {name: 'Check app status', exact: true}).click();
      await until(async () => !(await region(ids[0]).innerText()).includes('Start was not confirmed'), 'read-only inspection clears uncertain Start');
      assert.deepEqual(startIdentity(await launch(ids[0])), startIdentity(first)); assert.equal(launchPosts().length, 1);
      assert(await region(ids[0]).getByRole('button',{name:'Reload app view',exact:true}).isEnabled(), 'A successful current inspection restores deliberate Reload.');
      assertStep('A dropped real Start response is inspected through GET; the saved launch is not replayed or duplicated and Reload stays disabled until inspection.', {transport: 'The real host accepted Start; only its browser response was deliberately dropped.',reloadDisabledUntilInspection:true});
    }
    const identityDetails = region(ids[0]).locator('details.software-launch-identity'); await identityDetails.locator('summary').click();
    assert((await identityDetails.innerText()).includes(first.zipSha256)); assert((await identityDetails.innerText()).includes(first.runtimeId)); assert((await identityDetails.innerText()).includes(first.origin));
    await screenshot('inspect-accepted-runtime-identity', identityDetails.locator('summary')); await identityDetails.locator('summary').click();
    const regionBounds = await region(ids[0]).boundingBox(); assert(regionBounds && regionBounds.x >= 0 && regionBounds.x + regionBounds.width <= viewports[viewportName].width + 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Launch/source identity controls must remain contained without outer horizontal scrolling.');
    await rejectDuplicateStudio(ids[0]);
    if (kind === 'collection') {
      let app = await frame(options.parent); await app.getByRole('heading', {name: 'My Tasks', exact: true}).waitFor();
      const input = app.getByRole('textbox', {name: 'New task', exact: true}); await input.fill('Keep this task'); await input.press('Enter');
      await input.fill('Duplicate task'); await input.press('Tab'); await app.getByRole('button', {name: 'Add', exact: true}).press('Enter');
      await input.fill('Duplicate task'); await app.getByRole('button', {name: 'Add', exact: true})[viewportName === 'narrow' ? 'tap' : 'click']();
      const duplicates = app.getByRole('listitem').filter({hasText: 'Duplicate task'}); assert.equal(await duplicates.count(), 2); await duplicates.first().getByRole('button', {name: 'Remove', exact: true}).click(); assert.equal(await duplicates.count(), 1);
      await reloadApp(options.parent, 'My Tasks'); await ensureItems(options.parent, ['Keep this task', 'Duplicate task']);
      await screenshot('running-my-tasks', region(options.parent));
      await appLayout(options.parent,'My Tasks');
      const retainedFrame = await card(options.parent).locator('iframe').elementHandle(), unchangedStart = await launch(options.parent), unchangedPosts = launchPosts().length;
      app = await frame(options.parent); await app.getByRole('textbox', {name:'New task',exact:true}).fill('Keep this unsubmitted app draft');
      await page.route(base + '/api/software/' + options.parent + '/launch', route => route.abort('connectionfailed'), {times:1});
      await region(options.parent).getByRole('button',{name:'Check app status',exact:true}).click();
      await region(options.parent).getByRole('alert').filter({hasText:'App status could not be checked'}).waitFor();
      assert(await retainedFrame.evaluate(node=>node.isConnected), 'A temporary status failure must retain the existing iframe, not recreate its client state.');
      assert(await region(options.parent).getByRole('button',{name:'Reload app view',exact:true}).isDisabled(), 'A failed current status check must disable iframe recreation.');
      assert.equal(await (await frame(options.parent)).getByRole('textbox',{name:'New task',exact:true}).inputValue(),'Keep this unsubmitted app draft');
      assert.deepEqual(startIdentity(await launch(options.parent)),startIdentity(unchangedStart)); assert.equal(launchPosts().length,unchangedPosts);
      await screenshot('temporary-status-failure-keeps-app-draft', region(options.parent));
      await region(options.parent).getByRole('button',{name:'Check app status',exact:true}).click();
      await until(async()=>!(await region(options.parent).innerText()).includes('App status could not be checked'),'explicit real GET restores checked status');
      assert(await retainedFrame.evaluate(node=>node.isConnected)); assert.equal(await (await frame(options.parent)).getByRole('textbox',{name:'New task',exact:true}).inputValue(),'Keep this unsubmitted app draft');
      assert(await region(options.parent).getByRole('button',{name:'Reload app view',exact:true}).isEnabled());
      await (await frame(options.parent)).getByRole('textbox',{name:'New task',exact:true}).fill('');
      assertStep('A temporary aborted status GET keeps the same iframe and unsubmitted app draft; Reload is disabled until explicit real status inspection recovers without POST or process recreation.',{transport:'One browser status GET was deliberately aborted while the real host/runtime stayed healthy.',reloadDisabledUntilInspection:true});
      const identity = await launch(options.parent), posts = launchPosts().length;
      const softwareTab = page.getByRole('tab', {name: 'Software work', exact: true}); await softwareTab.locator('[title="Close"]').click();
      await until(async () => !await page.locator('.software-panel').isVisible(), 'Software closes'); await openSoftware();
      await ensureItems(options.parent, ['Keep this task', 'Duplicate task']); assert.deepEqual(startIdentity(await launch(options.parent)), startIdentity(identity));
      await page.reload({waitUntil: 'networkidle'}); await openSoftware(); await ensureItems(options.parent, ['Keep this task', 'Duplicate task']); assert.deepEqual(startIdentity(await launch(options.parent)), startIdentity(identity)); assert.equal(launchPosts().length, posts);
      assertStep('Close/reopen and Studio reload retain the same process/start identity, saved items and source without another POST or preparation.');
      const appBoundary = await (await frame(options.parent)).evaluate(studioOrigin => {
        const attempt = fn => {try {fn(); return 'allowed';} catch (error) {return error.name;}};
        return {origin: location.origin, parentDom: attempt(() => parent.document.body), parentStorage: attempt(() => parent.localStorage.length), topNavigation: attempt(() => {top.location.href = studioOrigin + '/#sandbox-top-navigation-probe';}), readableStudioCookie: document.cookie.split(';').some(part => part.trim().startsWith('studio='))};
      }, base);
      assert.equal(appBoundary.origin, first.origin); assert.equal(appBoundary.parentDom, 'SecurityError'); assert.equal(appBoundary.parentStorage, 'SecurityError'); assert.equal(appBoundary.topNavigation, 'SecurityError'); assert.equal(appBoundary.readableStudioCookie, false);
      record.browserBoundary = appBoundary; assertStep('Actual embedded storage works while parent DOM/storage/top navigation and Studio HttpOnly cookie reads are blocked.', appBoundary);
      const stableOrigin = first.origin;
      await stop(options.parent); await start(options.parent); await ensureItems(options.parent, ['Keep this task', 'Duplicate task']); assert.equal((await launch(options.parent)).origin, stableOrigin);
      assertStep('Explicit Stop awaits owned exit; a later explicit Start uses the same saved-data origin and retained items.');
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        const keptDraft = 'Keep this unsent follow-up through the ' + signal + ' Studio restart.';
        await page.getByRole('button', {name:'Type a message',exact:true}).click(); await page.getByRole('textbox',{name:'Message Anascummis',exact:true}).fill(keptDraft); await page.getByRole('button',{name:'Close text input',exact:true}).click();
        const active = await launch(options.parent), postCount = launchPosts().length; await stopHost(host, signal); host = undefined;
        const exit = await awaitProcessExit(active.processId, 'owned app exits after Studio ' + signal); record.processes.push({appPid: active.processId, parentSignal: signal, exit});
        await boot(); await openSoftware(); assert.equal(launchPosts().length,postCount);
        const rejectedResponse = page.waitForResponse(response => response.url() === base + '/api/software/' + options.parent + '/launch' && response.request().method() === 'GET');
        await region(options.parent).getByRole('button',{name:'Check app status',exact:true}).click(); assert.equal((await rejectedResponse).status(),403);
        const reconnect = region(options.parent).getByRole('button',{name:'Reconnect to Studio',exact:true}); await reconnect.waitFor();
        assert(await region(options.parent).getByRole('button',{name:'Reload app view',exact:true}).isDisabled(), 'An old-session403 must not navigate the saved origin before reconnecting.');
        const beforeReconnectPosts=launchPosts().length,beforeReconnectNavigations=record.mainNavigations.length; assert.equal(beforeReconnectPosts,postCount);
        await screenshot(signal.toLowerCase() + '-session-reconnect-keeps-draft', reconnect); await reconnect.click();
        await until(async () => !(await reconnect.isVisible()), 'explicit GET session reconnect finishes');
        const interrupted = await launch(options.parent); assert(['interrupted','stopped'].includes(interrupted.state),interrupted.message); assert.equal(interrupted.origin,stableOrigin); assert(!interrupted.processId);
        assert.equal(launchPosts().length,beforeReconnectPosts); assert.equal(record.mainNavigations.length,beforeReconnectNavigations); assert.equal(await card(options.parent).locator('iframe').count(),0);
        await screenshot(signal.toLowerCase() + '-explicit-restart', region(options.parent));
        await page.getByRole('button',{name:'Type a message',exact:true}).click(); assert.equal(await page.getByRole('textbox',{name:'Message Anascummis',exact:true}).inputValue(),keptDraft); await page.getByRole('button',{name:'Close text input',exact:true}).click();
        assertStep('After '+signal+', an old-tab status GET is rejected403; explicit reconnect uses only GET, preserves the unsent draft, does not navigate, POST or start an app/model.',{rejectedOldSessionStatus:403});
        await start(options.parent); await ensureItems(options.parent, ['Keep this task', 'Duplicate task']); assert.equal((await launch(options.parent)).origin, stableOrigin); assert(await region(options.parent).getByRole('button',{name:'Reload app view',exact:true}).isEnabled());
        assertStep('Studio ' + signal + ' cleans up the owned app; restart stays stopped until explicit Start and preserves its origin/items.');
      }
      await stop(options.parent); await start(options.child); assert.equal((await launch(options.child)).origin, stableOrigin);
      app = await ensureItems(options.child, ['Keep this task', 'Duplicate task']); await app.getByRole('heading', {name: 'My Week', exact: true}).waitFor();
      await app.getByRole('textbox', {name: 'New task', exact: true}).fill('Continue in My Week'); await app.getByRole('button', {name: 'Add', exact: true}).click(); await reloadApp(options.child, 'My Week'); await ensureItems(options.child, ['Keep this task', 'Duplicate task', 'Continue in My Week']);
      await screenshot('my-week-keeps-existing-items', region(options.child)); assertStep('Explicit Stop(parent) then Start(accepted child) retains the lineage origin, existing tasks and continued edits without changing accepted parent work.');
      const originalZip = await download(options.parent, 'accepted-parent-after-launch'), childZip = await download(options.child, 'accepted-child-after-launch');
      assert.equal(originalZip, tasksBefore[options.parent].evidence.artifacts.find(x => x.kind === 'zip').sha256); assert.equal(childZip, tasksBefore[options.child].evidence.artifacts.find(x => x.kind === 'zip').sha256);
      await stop(options.child);
      const blockerPort = Number(new URL(stableOrigin).port); blocker = createHttpServer((request, response) => response.end('owned-unrelated-http-200'));
      await new Promise((done, fail) => {blocker.once('error', fail); blocker.listen(blockerPort, '127.0.0.1', done);});
      await region(options.parent).getByRole('button', {name: 'Start app', exact: true}).click();
      const collision = await until(async () => {const value = await launch(options.parent); return value.state === 'failed' && value;}, 'occupied stable port rejects launch');
      assert.equal(collision.origin, stableOrigin); assert.equal(await (await fetch(stableOrigin)).text(), 'owned-unrelated-http-200'); assert.equal(await card(options.parent).locator('iframe').count(), 0);
      await until(async () => (await region(options.parent).locator('.software-launch-state').innerText()).startsWith('failed'), 'saved occupied-origin failure appears in the actual work window');
      await screenshot('occupied-origin-fails-honestly', region(options.parent).locator('.software-launch-state'));
      await screenshot('occupied-origin-retry-controls', region(options.parent).getByRole('button',{name:'Start app',exact:true}));
      await new Promise(done => blocker.close(done)); blocker = undefined;
      await start(options.parent); await ensureItems(options.parent, ['Keep this task', 'Duplicate task', 'Continue in My Week']); await stop(options.parent);
      assertStep('An occupied reserved origin/unrelated HTTP200 fails visibly without changing port, attaching to it or killing its owner; explicit retry succeeds after the owned blocker closes.');
    } else {
      const app = await frame(options.counter), increment = app.getByRole('button', {name: 'Increment', exact: true}), reset = app.getByRole('button', {name: 'Reset', exact: true}), output = app.getByLabel('Count', {exact: true});
      await app.getByRole('heading', {name: 'Bakery Orders', exact: true}).waitFor(); assert.equal(await output.innerText(), '0');
      await increment[viewportName === 'narrow' ? 'tap' : 'click'](); assert.equal(await output.innerText(), '1'); await increment[viewportName === 'narrow' ? 'tap' : 'click'](); assert.equal(await output.innerText(), '2'); await reset[viewportName === 'narrow' ? 'tap' : 'click'](); assert.equal(await output.innerText(), '0');
      await reset.press('Shift+Tab'); assert(await increment.evaluate(node => document.activeElement === node && node.matches(':focus-visible'))); await increment.press('Enter'); await increment.press('Space'); assert.equal(await output.innerText(), '2');
      await increment.press('Tab'); await reset.press('Space'); assert.equal(await output.innerText(), '0'); assert(await reset.evaluate(node => document.activeElement === node && node.matches(':focus-visible')));
      await screenshot('counter-reset-keyboard-feedback', reset); assert.match(await app.locator('[role="status"][aria-live="polite"]').innerText(), /Reset: Count is 0/);
      await reloadApp(options.counter, 'Bakery Orders'); assert.equal(await (await frame(options.counter)).getByLabel('Count', {exact: true}).innerText(), '0');
      await appLayout(options.counter,'Bakery Orders');
      await screenshot('counter-in-software-work', region(options.counter)); await download(options.counter, 'accepted-counter-after-launch');
      const stillRunning = await launch(options.counter), stopsBefore = launchPosts().filter(x => x.path.endsWith('/stop')).length;
      await page.route(base + '/api/software/' + options.counter + '/launch/stop', route => route.abort('connectionfailed'), {times: 1});
      await region(options.counter).getByRole('button', {name: 'Stop running app', exact: true}).click();
      await region(options.counter).getByRole('alert').filter({hasText: 'Stop was not confirmed'}).waitFor();
      await screenshot('unconfirmed-stop-inspect-before-retry', region(options.counter));
      assert.deepEqual(startIdentity(await launch(options.counter)), startIdentity(stillRunning)); assert.equal(launchPosts().filter(x => x.path.endsWith('/stop')).length, stopsBefore + 1);
      await region(options.counter).getByRole('button', {name: 'Check app status', exact: true}).click();
      await until(async () => !(await region(options.counter).innerText()).includes('Stop was not confirmed'), 'read-only inspection resolves undelivered Stop');
      await card(options.counter).locator('iframe').waitFor(); assert.deepEqual(startIdentity(await launch(options.counter)), startIdentity(stillRunning));
      assert.equal(launchPosts().filter(x => x.path.endsWith('/stop')).length, stopsBefore + 1);
      assertStep('An undelivered Stop stays unconfirmed without automatic replay; explicit GET inspection restores the same still-running runtime before a deliberate retry.', {transport: 'The browser Stop request was deliberately dropped before reaching the real host.'});
      await stop(options.counter); const again = await start(options.counter); assert.equal(again.origin, first.origin); assert.equal(await (await frame(options.counter)).getByLabel('Count', {exact: true}).innerText(), '0'); await stop(options.counter);
      assertStep('The actual in-window accepted counter passes touch/pointer0→1→2→Reset0, Tab/Enter/Space/focus/feedback, reload0 and explicit Stop/reopen at the same origin.');
    }
    for (const id of ids) assert.deepEqual(await get('/api/software/' + id), tasksBefore[id], 'Launch must not mutate accepted task/source/revision/model-call evidence.');
    assert.deepEqual(await originalIdentity(source, ids), fixture.before, 'Original stopped native fixtures must remain unchanged.');
    assert.equal(record.apiMutations.filter(x => !/\/launch\/(?:start|stop)$/.test(x.path)).length, 0, 'No inference, new build, revision, goal or other mutation API is needed for these launch journeys.');
    assert.equal(record.pageErrors.length, 0); assertStep('Accepted task records, ZIPs, source, model-call counts and original stopped fixtures remain unchanged; only explicit launch controls POST.');
    record.status = 'passed';
  } catch (error) {
    record.status = 'failed'; record.reason = error.stack || String(error);
    if (page && !page.isClosed()) try {await screenshot('failure');} catch {}
  } finally {
    if (blocker) await new Promise(done => blocker.close(done));
    if (context) {try {await context.tracing.stop({path: join(folder, 'trace.zip')}); record.trace = 'trace.zip'; await redactTrace(join(folder, 'trace.zip')); record.traceSessionHeadersRedacted = true;} catch (error) {record.traceError = String(error);} await context.close();}
    await stopHost(host);
    if (fixture) try {assert.deepEqual(await originalIdentity(source, ids), fixture.before);} catch (error) {record.status = 'failed'; record.preservationError = error.message;}
    record.finishedAt = new Date().toISOString(); record.goalAchieved = record.status === 'passed';
    await writeFile(join(folder, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  }
  return record;
}

export async function runAppLaunchSuite(options) {
  options = {...defaults, ...options}; options.output = resolve(studioRoot, options.output || '.test-data/user-journeys/app-launch-' + Date.now());
  for (const id of [options.parent, options.child, options.counter]) assert.match(id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,'Fixture task identities must be UUIDs.');
  for (const fixture of [options.collectionFixture, options.counterFixture]) {const source=resolve(studioRoot,fixture);assert(options.output!==source&&!options.output.startsWith(source+sep),'Choose evidence output outside preserved source fixtures.');}
  await mkdir(options.output); const names = options.viewport === 'all' ? Object.keys(viewports) : [options.viewport]; assert(names.every(name => viewports[name]));
  const kinds = options.scenario === 'all' ? ['collection', 'counter'] : [options.scenario]; assert(kinds.every(name => ['collection', 'counter'].includes(name)));
  const report = {startedAt: new Date().toISOString(), source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: studioRoot, encoding: 'utf8'}).trim(), lane: 'product-launch-of-copied-native-accepted-work', results: [],
    notes: ['No fresh inference/API seeding or E2E-owned app server substitutes for the product launch.', 'private-data, source dependencies and raw host logs remain local; trace session headers are redacted.']};
  report.applicationSource = await fingerprintSource(); report.servedBuild = await fingerprintBuild();
  const executablePath = process.env.CHROME_PATH || '/usr/bin/chromium'; await access(executablePath);
  const browser = await chromium.launch({executablePath, headless: true});
  let interrupted=false;
  const cancel=()=>{interrupted=true;void Promise.allSettled([...activeHosts].map(host=>stopHost(host))).then(()=>browser.close());};
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {outer:for (const kind of kinds) for (const name of names) {if(interrupted)break outer;const result = await runCase(browser, kind, name, options); report.results.push(result); console.log(result.status.toUpperCase() + ' in-window-' + kind + ' [' + name + '] ' + (result.reason || result.goal));}}
  finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);await Promise.allSettled([...activeHosts].map(host=>stopHost(host)));await browser.close();}
  try{
    report.sourceAfter = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim();
    assert.equal(report.sourceAfter, report.source, 'Source commit must remain fixed during the user-goal proof.');
    assert.deepEqual(await fingerprintSource(), report.applicationSource, 'Application/driver source must remain fixed during the user-goal proof.');
    assert.deepEqual(await fingerprintBuild(), report.servedBuild, 'Served production UI must remain fixed during the user-goal proof.');
  }catch(error){report.verificationError=error.message;}
  report.summary = {passed: report.results.filter(x => x.status === 'passed').length, blocked: 0, failed: report.results.filter(x => x.status !== 'passed').length};
  report.assertions = report.results.reduce((count, result) => count + result.assertions.length, 0); report.status = report.summary.failed ? 'failed' : 'passed';
  report.goalAchieved = report.summary.failed === 0&&!report.verificationError&&!interrupted; report.exitCode = interrupted?130:report.summary.failed||report.verificationError?1:0; report.finishedAt = new Date().toISOString();
  if(report.verificationError)report.status='failed';if(interrupted)report.status='interrupted';
  await writeFile(join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const escape = value => String(value || '').replace(/[&<>\"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[character]));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>In-window app user goals</title><style>body{font:16px/1.5 system-ui;max-width:980px;margin:24px}article{border-top:1px solid #ccd3da;padding:20px 0}code{overflow-wrap:anywhere}li{margin:8px 0}</style><h1>In-window app goals: ${escape(report.status)}</h1><p>${escape(report.verificationError || (interrupted ? "Harness interrupted; attempted goals are not an acceptance pass." : ""))}</p><p>${report.summary.passed} achieved; ${report.summary.failed} failed. ${report.assertions} outcome assertions.</p><p>Source <code>${escape(report.source)}</code>; working copy changed: ${report.sourceDirty}. These are product-managed launches of copied, previously native-generated accepted work, not fresh inference or packaged Next-server execution.</p><p><a href="report.json">Exact source/build fingerprints and full report</a></p>${report.results.map(result => `<article><h2>${escape(result.id)} · ${escape(result.viewport)} · ${escape(result.status)}</h2><p>${escape(result.goal)}</p><p>${escape(result.reason)}</p><p><a href="${result.artifactDirectory}/result.json">Case receipt</a> · <a href="${result.artifactDirectory}/trace.zip">Local redacted trace</a></p><ul>${result.screenshots.map(file => `<li><a href="${result.artifactDirectory}/${file}">${escape(file)}</a></li>`).join('')}</ul></article>`).join('')}</html>`;
  await writeFile(join(options.output, 'report.html'), html); return report;
}

async function main() {
  const options = {}, args = process.argv.slice(2), flags = {'--collection-fixture':'collectionFixture','--parent':'parent','--child':'child','--counter-fixture':'counterFixture','--counter':'counter','--viewport':'viewport','--scenario':'scenario','--output':'output'};
  for (let at = 0; at < args.length; at++) {const key = flags[args[at]]; assert(key && args[at + 1], 'Usage: node scripts/e2e/app-launch.mjs [--collection-fixture DATA --parent ID --child ID] [--counter-fixture DATA --counter ID] [--scenario collection|counter|all] [--viewport desktop|narrow|all] --output FRESH_DIR'); options[key] = args[++at];}
  assert(options.output, 'Choose a fresh --output evidence directory.'); const report = await runAppLaunchSuite(options); process.exitCode = report.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
