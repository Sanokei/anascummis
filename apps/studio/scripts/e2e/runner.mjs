import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createWriteStream} from 'node:fs';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {redactTrace, zipEntries} from './artifacts.mjs';

export const studioRoot = fileURLToPath(new URL('../../', import.meta.url));
export const viewports = {desktop: {width: 1440, height: 1000}, narrow: {width: 360, height: 800}};
const activeHosts = new Set();
export class BlockedGoal extends Error {constructor(message, evidence = {}) {super(message); this.evidence = evidence;}}

export async function until(check, label, milliseconds = 30_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {const result = await check(); if (result) return result; await delay(100);}
  throw new Error('Timed out: ' + label);
}

async function freePort() {
  const server = createServer(); await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function browserPath() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  for (const path of candidates) {try {await access(path); return path;} catch {}}
  throw new Error('Installed Chrome/Chromium is required. Set CHROME_PATH to its executable; this runner does not download browsers.');
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref(); await exited; clearTimeout(timer);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function runJourney(browser, journey, viewportName, output) {
  if (!journey || typeof journey.id !== 'string' || !journey.id.trim() || typeof journey.goal !== 'string' || !journey.goal.trim() || typeof journey.run !== 'function') throw new Error('Every journey needs an id, a concrete user goal and an executable run function.');
  const folder = join(output, journey.id + '-' + viewportName); await mkdir(folder, {recursive: true});
  const data = join(folder, 'private-data'); await mkdir(data);
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const log = createWriteStream(join(folder, 'host.log'));
  const record = {id: journey.id, viewport: viewportName, goal: journey.goal, startedAt: new Date().toISOString(), status: 'running',
    lane: 'real-local-runtime', prerequisite: journey.prerequisite || 'None', assertions: [], screenshots: [], downloads: [], pageErrors: [], apiMutations: [],
    limitations: ['Installed Chrome with desktop/touch emulation; no physical handset or native voice quality claim.', 'No test-supplied inference, API seeding, model download or external provisioning.']};
  let host, context, page, steps = 0, hostError;
  const env = {...process.env, STUDIO_DATA: data, STUDIO_PORT: String(port), STUDIO_DEV: '0'};
  try {
    host = spawn(process.env.BUN_PATH || 'bun', ['core/server.ts'], {cwd: studioRoot, env, stdio: ['ignore', 'pipe', 'pipe']});
    activeHosts.add(host);
    host.once('error', error => {hostError = error;}); host.stdout.pipe(log); host.stderr.pipe(log);
    record.host = {pid: host.pid, port, command: 'bun core/server.ts', isolatedData: 'private-data'};
    await until(async () => {
      if (hostError) throw hostError;
      if (host.exitCode !== null || host.signalCode) throw new Error('Studio exited before readiness; inspect host.log.');
      try {const response = await fetch(base + '/api/status', {signal: AbortSignal.timeout(2000)}); if (response.ok) {record.runtime = await response.json(); return true;}} catch {}
    }, 'ordinary Studio readiness');
    context = await browser.newContext({viewport: viewports[viewportName], hasTouch: viewportName === 'narrow', reducedMotion: 'reduce', timezoneId: 'Etc/UTC', acceptDownloads: true});
    record.externalBrowserRequests = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {record.externalBrowserRequests.push({origin: url.origin, path: url.pathname, blocked: true}); return route.abort();}
      return route.continue();
    });
    await context.tracing.start({screenshots: true, snapshots: true, sources: false});
    page = await context.newPage(); page.setDefaultTimeout(12_000);
    page.on('pageerror', error => record.pageErrors.push(error.message));
    page.on('request', request => {const url = new URL(request.url()); if (url.origin === base && request.method() === 'POST') record.apiMutations.push({path: url.pathname, time: new Date().toISOString()});});
    await page.goto(base, {waitUntil: 'networkidle'});
    await until(() => page.getByRole('button', {name: 'Type a message', exact: true}).isEnabled(), 'visible typing entry');
    const helpers = {
      page, base, folder, record, until, runtime: record.runtime,
      assert(name, evidence = {}) {record.assertions.push({name, passed: true, ...evidence});},
      blocked(message, evidence = {}) {throw new BlockedGoal(message, evidence);},
      async readApi(path) {const response = await page.request.get(base + path); if (!response.ok()) throw new Error(`${path} returned ${response.status()}`); return response.json();},
      async closeComposer() {const close = page.getByRole('button', {name: 'Close text input', exact: true}); if (await close.isVisible()) await close.click();},
      async type(text) {if (!await page.getByRole('textbox', {name: 'Message Anascummis', exact: true}).isVisible()) await page.getByRole('button', {name: 'Type a message', exact: true}).click(); await page.getByRole('textbox', {name: 'Message Anascummis', exact: true}).fill(text);},
      async send(text) {await helpers.type(text); await page.getByRole('button', {name: 'Send message', exact: true}).click();},
      async screenshot(name, target) {
        if (target) await target.scrollIntoViewIfNeeded();
        const filename = String(++steps).padStart(2, '0') + '-' + name + '.png'; await page.screenshot({path: join(folder, filename)}); record.screenshots.push(filename);
      },
      async download(command, filename) {
        const pending = page.waitForEvent('download', {timeout: 20_000}); pending.catch(() => {}); await helpers.send(command); const download = await pending;
        if (await download.failure()) throw new Error('Download failed: ' + await download.failure());
        const path = join(folder, filename); await download.saveAs(path); const bytes = await readFile(path);
        record.downloads.push({path: filename, suggestedFilename: download.suggestedFilename(), bytes: bytes.length, sha256: sha(bytes)}); return bytes;
      },
      async inspectCounter(taskId) {
        if (!/^[a-f0-9-]{36}$/.test(taskId)) throw new Error('Invalid produced application reference.');
        const application = join(data, 'software', taskId, '.next/standalone'); await access(join(application, 'server.js'));
        const appPort = await freePort(), appOrigin = 'http://127.0.0.1:' + appPort;
        const cleanEnv = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
        const app = spawn(process.execPath, ['server.js'], {cwd: application, env: {...cleanEnv, PORT: String(appPort), HOSTNAME: '127.0.0.1', NODE_ENV: 'production'}, stdio: 'ignore'});
        activeHosts.add(app); let appContext, appError;
        app.once('error', error => {appError = error;});
        record.deliveredApp = {pid: app.pid, port: appPort, source: 'Produced task standalone bundle; not a clean installation of the downloaded source ZIP.'};
        try {
          await until(async () => {if (appError) throw appError; if (app.exitCode !== null || app.signalCode) throw new Error('The produced app exited before startup.'); try {return (await fetch(appOrigin)).ok;} catch {}}, 'produced counter application starts');
          appContext = await browser.newContext({viewport: viewports[viewportName], hasTouch: viewportName === 'narrow', reducedMotion: 'reduce'});
          await appContext.route('**/*', route => {const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== appOrigin) {record.externalBrowserRequests.push({origin: url.origin, path: url.pathname, blocked: true}); return route.abort();} return route.continue();});
          await appContext.tracing.start({screenshots: true, snapshots: true, sources: false});
          const actual = await appContext.newPage(); actual.setDefaultTimeout(12_000); await actual.goto(appOrigin, {waitUntil: 'networkidle'});
          await actual.getByRole('heading', {name: 'Bakery Orders', exact: true}).waitFor();
          const count = number => actual.getByText(new RegExp('^(?:count\\s*:?\\s*)?' + number + '$', 'i')).first();
          await count(0).waitFor(); await actual.getByRole('button', {name: 'Increment', exact: true}).click(); await count(1).waitFor();
          await actual.getByRole('button', {name: 'Increment', exact: true}).click(); await count(2).waitFor();
          await actual.getByRole('button', {name: 'Reset', exact: true}).click(); await count(0).waitFor();
          await actual.reload({waitUntil: 'networkidle'}); await count(0).waitFor();
          await actual.screenshot({path: join(folder, 'produced-counter.png')}); record.screenshots.push('produced-counter.png');
          helpers.assert('Independently launched produced bundle: Bakery Orders; Increment 0→1→2; Reset→0; reload→0.');
        } finally {
          try {if (appContext) {const trace = join(folder, 'produced-app-trace.zip'); await appContext.tracing.stop({path: trace}); await redactTrace(trace); record.deliveredApp.trace = 'produced-app-trace.zip';}}
          finally {await appContext?.close().catch(() => {}); await stop(app); activeHosts.delete(app);}
        }
      },
      zipEntries
    };
    await helpers.screenshot('first-use');
    await journey.run(helpers);
    if (!record.assertions.length) throw new Error('A journey cannot achieve its goal without recording an outcome assertion.');
    if (record.pageErrors.length) throw new Error('Uncaught browser error: ' + record.pageErrors.join('; '));
    record.status = 'passed'; record.goalAchieved = true;
  } catch (error) {
    record.status = error instanceof BlockedGoal ? 'blocked' : 'failed'; record.goalAchieved = false; record.reason = String(error.message || error);
    if (error instanceof BlockedGoal) record.blocker = error.evidence;
    else record.stack = error.stack;
    if (page) {try {await page.screenshot({path: join(folder, 'outcome.png')}); record.screenshots.push('outcome.png');} catch {}}
  } finally {
    if (context) {
      const trace = join(folder, 'trace.zip');
      try {await context.tracing.stop({path: trace}); await redactTrace(trace); record.trace = 'trace.zip'; record.traceSessionHeadersRedacted = true;}
      catch (error) {record.traceError = String(error); record.userGoalStatus = record.status; record.reason = 'Browser trace evidence failed: ' + String(error) + '. Prior goal result: ' + (record.reason || record.status); record.status = 'failed'; record.goalAchieved = false;}
      await context.close().catch(() => {});
    }
    await stop(host); activeHosts.delete(host); log.end(); record.finishedAt = new Date().toISOString();
    record.recoveryChecksPassed = record.assertions.filter(assertion => assertion.passed).length;
    await writeFile(join(folder, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  }
  return {...record, artifactDirectory: relative(output, folder)};
}

export async function runSuite(journeys, options) {
  const output = resolve(options.output || join(studioRoot, '.test-data/user-journeys', new Date().toISOString().replace(/[:.]/g, '-'))); await mkdir(output, {recursive: true});
  await access(join(studioRoot, 'out/index.html')).catch(() => {throw new Error('Build the Studio production UI first. This test does not build or package it implicitly.');});
  const selected = options.journey === 'all' ? journeys : journeys.filter(journey => journey.id === options.journey);
  if (!selected.length) throw new Error('Unknown journey: ' + options.journey);
  const names = options.viewport === 'all' ? Object.keys(viewports) : [options.viewport];
  if (names.some(name => !viewports[name])) throw new Error('Choose --viewport desktop, narrow or all.');
  const report = {startedAt: new Date().toISOString(), source: null, lane: 'real-local-runtime', results: [], output,
    notes: ['Blocked user goals never count as completed goals, even when recovery assertions pass.', 'private-data and host.log are local diagnostics, not shareable fixture inputs. Traces remove ephemeral session headers.']};
  try {report.source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: studioRoot, encoding: 'utf8'}).trim();} catch {}
  try {report.sourceDirty = !!execFileSync('git', ['status', '--porcelain'], {cwd: studioRoot, encoding: 'utf8'}).trim();} catch {}
  report.runnerSource = [];
  for (const name of ['scripts/test-user-journeys.mjs', 'scripts/e2e/runner.mjs', 'scripts/e2e/journeys.mjs', 'scripts/e2e/artifacts.mjs', 'scripts/e2e/source-reading.mjs']) {
    report.runnerSource.push({path: name, sha256: sha(await readFile(join(studioRoot, name)))});
  }
  report.servedBuild = [];
  async function fingerprint(folder, prefix = '') {
    const {readdir} = await import('node:fs/promises');
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      if (entry.name === 'opensource' || entry.isSymbolicLink()) continue;
      const name = prefix + entry.name;
      if (entry.isDirectory()) await fingerprint(join(folder, entry.name), name + '/');
      else if (/\.(?:html|js|css|json)$/.test(name)) {const bytes = await readFile(join(folder, entry.name)); report.servedBuild.push({path: 'out/' + name, bytes: bytes.length, sha256: sha(bytes)});}
    }
  }
  await fingerprint(join(studioRoot, 'out'));
  report.applicationSource = [];
  const applicationPaths = ['app/page.tsx', 'app/style.css', 'components/GoalPanel.tsx', 'components/GoalSources.tsx', 'core/server.ts', 'core/workspace-export.ts',
    'core/orchestrator.ts', 'core/harness.ts', 'core/model.ts', 'core/model-scheduler.ts', 'core/decision-routing.ts', 'core/working-memory.ts', 'core/tools.ts',
    'core/analysis-harness.ts', 'core/source-question.ts', 'core/source-passages.ts', 'core/source-citation-spans.ts', 'core/public-source.ts', 'core/goal-executor.ts', 'core/goal-orchestrator.ts',
    'core/software-api.ts', 'core/software-task.ts', 'core/software-runner.ts', 'core/software-recipes.ts', 'worker/software-browser.mjs'];
  for (const name of applicationPaths) {try {report.applicationSource.push({path: name, sha256: sha(await readFile(join(studioRoot, name)))});} catch {}}
  const browser = await chromium.launch({executablePath: await browserPath(), headless: true});
  let interrupted = false;
  const cancel = () => {interrupted = true; void Promise.allSettled([...activeHosts].map(stop)).then(() => browser.close());};
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {outer: for (const journey of selected) for (const viewport of names) {if (interrupted) break outer; const result = await runJourney(browser, journey, viewport, output); report.results.push(result); console.log(`${result.status.toUpperCase()} ${journey.id} [${viewport}] ${result.reason || result.goal}`);}}
  finally {process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); await browser.close();}
  report.summary = Object.fromEntries(['passed', 'blocked', 'failed'].map(status => [status, report.results.filter(result => result.status === status).length]));
  report.goalAchieved = report.summary.failed === 0 && report.summary.blocked === 0;
  report.status = report.summary.failed ? 'failed' : report.summary.blocked ? 'incomplete' : 'passed';
  report.finishedAt = new Date().toISOString();
  const missingModel = report.results.some(result => result.runtime?.model?.ready === false);
  report.exitCode = report.summary.failed ? 1 : (report.summary.blocked && !options.allowBlocked) || (options.requireModel && missingModel) ? 2 : 0;
  if (interrupted) {report.status = 'interrupted'; report.goalAchieved = false; report.exitCode = 130;}
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const escape = value => String(value || '').replace(/[&<>\"]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[char]));
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>User journey results</title><style>body{font:16px system-ui;margin:24px;max-width:960px;line-height:1.5}article{border-top:1px solid #bbb;padding:16px 0}img{max-width:100%;height:auto}small{display:block}</style><h1>User goals: ${escape(report.status)}</h1><p>${report.summary.passed} achieved; ${report.summary.blocked} blocked; ${report.summary.failed} failed. Recovery assertions are separate from goal completion.</p>${report.results.map(result => `<article><h2>${escape(result.id)} · ${escape(result.viewport)} · ${escape(result.status)}</h2><p>${escape(result.goal)}</p><p>${escape(result.reason)}</p><small>${result.recoveryChecksPassed} assertions passed; goal achieved: ${result.goalAchieved}</small><a href="${result.artifactDirectory}/result.json">Full receipt</a>${result.trace ? ` · <a href="${result.artifactDirectory}/trace.zip">Redacted browser trace</a>` : ''}${result.screenshots.map(image => `<p><a href="${result.artifactDirectory}/${image}">${escape(image)}</a></p>`).join('')}</article>`).join('')}`;
  await writeFile(join(output, 'report.html'), html);
  console.log(`User goals: ${report.summary.passed} achieved, ${report.summary.blocked} blocked, ${report.summary.failed} failed. Report: ${join(output, 'report.html')}`);
  return report;
}
