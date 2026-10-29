#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runSuite} from './runner.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function inputHashes(data, id) {
  const root = join(data, 'software', id), hashes = {};
  for (const name of ['app/page.tsx', 'lib/collection.ts', 'BUILD-PROVENANCE.json']) hashes[name] = digest(await readFile(join(root, name)));
  return hashes;
}
async function originalHashes(data, id) {
  const hashes = await inputHashes(data, id);
  for (const name of ['studio.sqlite', 'studio.sqlite-wal', 'studio.sqlite-shm']) {
    try {hashes[name] = digest(await readFile(join(data, name)));} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return hashes;
}

export function recoveredSoftwareJourney(fixtureData, taskId, original) {
  assert.match(taskId, /^[a-f0-9-]{36}$/);
  return {
    id: 'resume-task-list-checkpoint', fixtureData,
    goal: 'Explicitly resume the same native-generated task list after correcting host validation, preserving source/call identity and prior failed checks while obtaining real verified output.',
    async run(ctx) {
      const start = await ctx.readApi('/api/software/' + taskId); ctx.record.recoveryBefore = start;
      assert.equal(start.status, 'needs_input'); assert(start.evidence?.checks.some(check => !check.ok));
      const source = await inputHashes(join(ctx.folder, 'private-data'), taskId); assert.deepEqual(source, await inputHashes(fixtureData, taskId));
      await ctx.page.locator('.software-panel').waitFor();
      const card = ctx.page.locator('[data-software-task-id="' + taskId + '"]'); await card.waitFor();
      const failed = card.locator('details').filter({has: ctx.page.locator('summary', {hasText: /^Failed · browser/})});
      await failed.locator('summary').click(); assert.match(await failed.innerText(), /persistence failure during collection acceptance/);
      await ctx.screenshot('retained-original-failed-check', failed.locator('summary')); await failed.locator('summary').click();
      await ctx.page.reload({waitUntil: 'networkidle'});
      assert.deepEqual(await ctx.readApi('/api/software/' + taskId), start, 'Opening/reloading the old failed checkpoint must not retry it.');
      assert.equal(ctx.record.apiMutations.filter(item => item.path.startsWith('/api/software')).length, 0);
      ctx.assert('The actual saved native-generated failure and browser check remain paused and inspectable until explicit Resume.');
      const resume = card.getByRole('button', {name: 'Resume checkpoint', exact: true});
      await resume.scrollIntoViewIfNeeded(); await ctx.screenshot('explicit-resume-checkpoint', resume); await resume.click();
      let end, previous = '';
      await ctx.until(async () => {
        end = await ctx.readApi('/api/software/' + taskId);
        const state = {id: end.id, status: end.status, phase: end.phase, revision: end.revision, calls: end.calls};
        if (JSON.stringify(state) !== previous) {previous = JSON.stringify(state); const entry = {time: new Date().toISOString(), ...state}; (ctx.record.goalProgress ||= []).push(entry); await writeFile(join(ctx.folder, 'progress.json'), JSON.stringify(entry, null, 2) + '\n'); console.log('ACTIVE checkpoint recovery ' + end.status + ' · ' + end.phase + ' · model decisions ' + end.calls);}
        return end.updated > start.updated && ['completed', 'needs_input', 'cancelled'].includes(end.status);
      }, 'same generated checkpoint completes real validation after explicit Resume', 300_000);
      ctx.record.recoveryAfter = end;
      assert.equal(end.status, 'completed', 'Explicit Resume must repair the same task through actual validation: ' + end.message);
      assert.equal(end.id, start.id); assert.equal(end.goal, start.goal); assert.equal(end.revision, start.revision); assert.equal(end.calls, start.calls);
      assert.deepEqual(await inputHashes(join(ctx.folder, 'private-data'), taskId), source, 'Validation retry must not regenerate source/provenance.');
      assert(end.evidence?.checks?.length && end.evidence.checks.every(check => check.ok));
      assert.equal(ctx.record.apiMutations.filter(item => item.path === '/api/software/' + taskId + '/resume').length, 1);
      assert.equal(ctx.record.apiMutations.filter(item => item.path === '/api/software').length, 0);
      let cursor, events = [];
      do {const page = await ctx.readApi('/api/software/' + taskId + '/activity?limit=50' + (cursor ? '&before=' + cursor : '')); events.push(...page.events); cursor = page.nextCursor;} while (cursor);
      const archived = events.find(event => event.phase === 'validation_retry'); assert(archived, 'Original failed validation needs an authoritative retained activity entry.');
      const packet = JSON.parse(archived.detail); assert.equal(packet.format, 'anascummis.failed-validation.v1'); assert.equal(packet.taskId, taskId); assert.equal(packet.sourceRevision, start.revision);
      const {screenshot, ...oldChecks} = start.evidence; assert.deepEqual(packet.receipt, oldChecks, 'Retained failed receipt must preserve exact prior logs/DOM/contracts/artifact identity.');
      ctx.record.archivedFailedValidation = packet;
      const history = card.locator('details.activity-history'); await history.locator('summary').click();
      await history.getByRole('region', {name: 'Activity history entries', exact: true}).waitFor();
      while (!(await history.innerText()).includes('anascummis.failed-validation.v1')) {const earlier = history.getByRole('button', {name: 'Show earlier activity', exact: true}); assert(await earlier.isVisible(), 'Archived failed-check event remains reachable in history.'); await earlier.click(); await ctx.until(async () => await history.locator('.activity-history-body').getAttribute('aria-busy') === 'false', 'older history loads');}
      assert((await history.innerText()).includes('persistence failure during collection acceptance'));
      await ctx.screenshot('failed-validation-history-kept', history.locator('summary')); await history.locator('summary').click();
      const zip = end.evidence.artifacts.find(item => item.kind === 'zip' && item.smokeTested); assert(zip);
      const pending = ctx.page.waitForEvent('download'); pending.catch(() => {}); await card.getByRole('button', {name: 'Download source ZIP', exact: true}).click();
      const download = await pending; await download.saveAs(join(ctx.folder, 'recovered-source.zip')); const bytes = await readFile(join(ctx.folder, 'recovered-source.zip'));
      assert.equal(digest(bytes), zip.sha256); ctx.record.downloads.push({path: 'recovered-source.zip', bytes: bytes.length, sha256: zip.sha256});
      await ctx.inspectSoftware(taskId, {name: 'recovered-produced-task-list'}, async page => {
        await page.getByRole('heading', {name: 'My Tasks', exact: true}).waitFor();
        await page.getByRole('textbox', {name: 'New task', exact: true}).fill('Continue saved work'); await page.getByRole('button', {name: 'Add', exact: true}).click();
        await page.reload({waitUntil: 'networkidle'}); await page.getByRole('listitem').filter({hasText: 'Continue saved work'}).waitFor();
      });
      await ctx.page.reload({waitUntil: 'networkidle'}); assert.deepEqual(await ctx.readApi('/api/software/' + taskId), end);
      assert.deepEqual(await originalHashes(fixtureData, taskId), original, 'The original failed fixture and SQLite files must remain unchanged.');
      ctx.record.recoveryIdentity = {sourceHashes: source, originalFixtureHashes: original, inferenceCallsBefore: start.calls, inferenceCallsAfter: end.calls, sourceRevision: end.revision};
      ctx.assert('One explicit Resume reruns actual checks/package on the same generated source without new inference, retains exact failed receipt/history, and leaves the original failed fixture untouched.');
    }
  };
}

async function main() {
  const options = {viewport: 'desktop'}, args = process.argv.slice(2);
  for (let at = 0; at < args.length; at++) {const name = args[at]; if (!['--fixture', '--task', '--output', '--viewport'].includes(name) || !args[at + 1]) throw new Error('Usage: node scripts/e2e/recover-software.mjs --fixture <stopped-private-data> --task <id> --output <fresh-dir> [--viewport desktop|narrow]'); options[name.slice(2)] = args[++at];}
  assert(options.fixture && options.task && options.output); const source = resolve(options.fixture), before = await originalHashes(source, options.task);
  const journey = recoveredSoftwareJourney(source, options.task, before);
  const report = await runSuite([journey], {...options, journey: journey.id, allowBlocked: false});
  assert.deepEqual(await originalHashes(source, options.task), before); process.exitCode = report.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
