import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {access, mkdir, readFile, symlink, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {redactTrace, zipEntries} from './artifacts.mjs';
import {exerciseCounterUX} from './counter-ux.mjs';

export async function exerciseCounter(page) {
  return exerciseCounterUX(page, {resetButton: 'Reset', touch: page.viewportSize().width < 700});
}

/** Exercise actual software output, optionally rebuilding the actual downloaded
 * source with the completed task's installed dependencies. No registry install.
 */
export async function inspectSoftwareArtifact(config, taskId, options, inspect) {
  const {browser, data, folder, record, viewport, activeHosts, stop, freePort, until} = config;
  assert.match(taskId, /^[a-f0-9-]{36}$/);
  assert.match(options.name, /^[a-z0-9-]+$/);
  const taskRoot = join(data, 'software', taskId), name = options.name;
  const receipt = {taskId, name, mode: options.sourceZip ? 'downloaded-source-rebuild' : 'produced-standalone', phases: []};
  (record.softwareInspections ||= []).push(receipt);
  const cleanEnv = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  async function command(executable, args, cwd, phase, timeout = 180_000) {
    const logName = name + '-' + phase + '.log', log = createWriteStream(join(folder, logName));
    const child = spawn(executable, args, {cwd, env: {...cleanEnv, NEXT_TELEMETRY_DISABLED: '1'}, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    child.e2eProcessGroup = process.platform !== 'win32';
    activeHosts.add(child); child.stdout.pipe(log, {end: false}); child.stderr.pipe(log, {end: false});
    const progress = {phase, started: new Date().toISOString(), pid: child.pid, log: logName}; receipt.phases.push(progress);
    console.log('ACTIVE task-list [' + record.viewport + '] ' + name + ' · ' + phase);
    let failure;
    child.once('error', error => {failure = error;});
    const timer = setTimeout(() => {failure = new Error(phase + ' exceeded ' + timeout + 'ms'); void stop(child);}, timeout);
    try {
      const code = await new Promise(resolve => child.once('close', resolve));
      progress.exitCode = code; progress.finished = new Date().toISOString();
      if (failure) throw failure;
      assert.equal(code, 0, phase + ' failed; inspect ' + logName);
    } finally {clearTimeout(timer); await stop(child); activeHosts.delete(child); log.end();}
  }
  let application, args, executable = process.execPath;
  if (options.sourceZip) {
    application = join(folder, name + '-extracted'); await mkdir(application);
    const entries = zipEntries(options.sourceZip);
    assert(entries.has('package.json') && entries.has('app/page.tsx'), 'Downloaded source needs its actual app inputs.');
    for (const [path, bytes] of entries) {
      const parts = path.split('/');
      assert(parts.every(part => part && part !== '.' && !['node_modules', '.next', '.git', '.runtime', '.data', 'private-data'].includes(part) && !part.startsWith('.env')), 'Source ZIP contains private/runtime inputs: ' + path);
      const target = resolve(application, path); assert(target.startsWith(application + sep));
      await mkdir(dirname(target), {recursive: true}); await writeFile(target, bytes);
    }
    const installed = join(taskRoot, 'node_modules'); await access(installed);
    const manifest = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
    assert(typeof manifest.scripts?.start === 'string' && manifest.scripts.start.trim(), 'Downloaded source needs a real start script.');
    for (const [dependency, version] of Object.entries({...manifest.dependencies, ...manifest.devDependencies})) {
      const pkg = JSON.parse(await readFile(join(installed, dependency, 'package.json'), 'utf8'));
      assert.equal(pkg.version, version, 'Reused dependency must match downloaded pinned manifest: ' + dependency);
    }
    await symlink(installed, join(application, 'node_modules'), 'dir');
    receipt.files = entries.size;
    receipt.limit = 'Actual downloaded source, clean extraction/build; reuses matching installed dependency tree. No fresh registry installation or Windows executable claim.';
    await command(process.execPath, [join(installed, 'typescript/bin/tsc'), '--noEmit'], application, 'typecheck');
    await command(process.env.BUN_PATH || 'bun', ['test', 'tests', '--timeout', '30000'], application, 'tests');
    await command(process.execPath, [join(installed, 'next/dist/bin/next'), 'build', '--webpack'], application, 'build');
    executable = process.env.BUN_PATH || 'bun';
    receipt.packageStartScript = manifest.scripts.start;
    args = ['run', 'start'];
  } else {
    application = join(taskRoot, '.next/standalone'); await access(join(application, 'server.js'));
    args = ['server.js'];
    receipt.limit = 'Actual produced standalone bundle; downloaded-source installation is a separate inspection.';
  }
  const port = await freePort(), origin = 'http://127.0.0.1:' + port;
  if (options.sourceZip) args.push('--port', String(port));
  const log = createWriteStream(join(folder, name + '-start.log'));
  let child, context, failure;
  function start(executable, args, cwd) {
    failure = undefined;
    child = spawn(executable, args, {cwd, env: {...cleanEnv, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production'}, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    child.e2eProcessGroup = process.platform !== 'win32';
    activeHosts.add(child); child.stdout.pipe(log, {end: false}); child.stderr.pipe(log, {end: false});
    child.once('error', error => {failure = error;});
    return until(async () => {if (failure) throw failure; if (child.exitCode !== null || child.signalCode) throw new Error(name + ' exited before startup.'); try {return (await fetch(origin, {signal: AbortSignal.timeout(1000)})).ok;} catch {}}, name + ' actual application starts');
  }
  try {
    await start(executable, args, application);
    receipt.pid = child.pid; receipt.port = port;
    receipt.startCommand = options.sourceZip ? ['bun', ...args].join(' ') : 'node server.js';
    context = await browser.newContext({viewport, hasTouch: record.viewport === 'narrow', reducedMotion: 'reduce'});
    await context.route('**/*', route => {const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {record.externalBrowserRequests.push({origin: url.origin, path: url.pathname, blocked: true}); return route.abort();} return route.continue();});
    await context.tracing.start({screenshots: true, snapshots: true, sources: false});
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(12_000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, {waitUntil: 'networkidle'}); await inspect(page, receipt);
    if (options.replacementTaskId) {
      assert(!options.sourceZip, 'Same-origin replacement is a separate produced-bundle proof.');
      assert.match(options.replacementTaskId, /^[a-f0-9-]{36}$/);
      const before = name + '-before-replacement.png'; await page.screenshot({path: join(folder, before)}); record.screenshots.push(before);
      const storageBefore = await page.evaluate(() => Object.entries(localStorage).sort());
      const parentPid = child.pid; await stop(child); activeHosts.delete(child);
      const replacement = join(data, 'software', options.replacementTaskId, '.next/standalone'); await access(join(replacement, 'server.js'));
      await start(process.execPath, ['server.js'], replacement);
      receipt.replacement = {taskId: options.replacementTaskId, parentPid, pid: child.pid, origin, port, storageBefore};
      await page.reload({waitUntil: 'networkidle'});
      await options.inspectReplacement(page, receipt.replacement);
      receipt.replacement.passed = true;
    }
    assert.deepEqual(errors, [], 'Delivered app must not have uncaught browser errors.');
    const screenshot = name + '.png'; await page.screenshot({path: join(folder, screenshot)}); record.screenshots.push(screenshot);
    receipt.passed = true;
  } finally {
    try {if (context) {const trace = name + '-trace.zip'; await context.tracing.stop({path: join(folder, trace)}); await redactTrace(join(folder, trace)); receipt.trace = trace;}}
    finally {await context?.close().catch(() => {}); await stop(child); activeHosts.delete(child); log.end();}
  }
}
