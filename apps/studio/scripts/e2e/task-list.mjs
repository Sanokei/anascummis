import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const taskListRequest = 'Build a task-list application with heading My Tasks, a text input labelled New task, an Add button, and a Remove button for each task. Add task text to the list, remove individual tasks, and persist remaining tasks after a page reload. Include browser checks and give me the source ZIP.';
export const taskListRevision = 'Change heading to My Week; keep existing add/remove/persistence behavior';
const terminal = ['completed', 'needs_input', 'cancelled'];

async function waitForTask(ctx, find, label) {
  let task, previous = '', timedOut = false;
  try {
    await ctx.until(async () => {
      task = (await ctx.readApi('/api/software')).find(find);
      if (task) {
        const state = {id: task.id, status: task.status, phase: task.phase, revision: task.revision, modelCalls: task.calls, message: task.message};
        if (JSON.stringify(state) !== previous) {
          previous = JSON.stringify(state); const entry = {time: new Date().toISOString(), label, ...state};
          (ctx.record.goalProgress ||= []).push(entry); await writeFile(join(ctx.folder, 'progress.json'), JSON.stringify(entry, null, 2) + '\n');
          console.log('ACTIVE task-list [' + ctx.record.viewport + '] ' + label + ' · ' + state.status + ' · ' + state.phase + ' · decisions ' + task.calls);
        }
      }
      return task && terminal.includes(task.status);
    }, label + ' reaches an actual outcome (five minute bound)', 300_000);
  } catch (error) {
    if (!task || !String(error.message).startsWith('Timed out:')) throw error;
    timedOut = true; ctx.record.boundReached = {label, time: new Date().toISOString(), task};
    const card = ctx.page.locator('[data-software-task-id="' + task.id + '"]');
    await ctx.screenshot(label + '-still-running-before-stop', card);
    await card.getByRole('button', {name: 'Stop build', exact: true}).click();
    await ctx.until(async () => {task = await ctx.readApi('/api/software/' + task.id); return task.status === 'cancelled';}, 'owned fixture stops through its visible UI');
  }
  const full = await ctx.readApi('/api/software/' + task.id);
  (ctx.record.persistedSoftwareTasks ||= []).push(full);
  await writeFile(join(ctx.folder, label + '-software.json'), JSON.stringify(full, null, 2) + '\n');
  const card = ctx.page.locator('[data-software-task-id="' + task.id + '"]'); await card.waitFor();
  await ctx.until(async () => (await card.locator('.software-build-state').innerText()).includes(full.status), 'real saved task outcome appears in its Software window');
  const savedGoal = card.locator('details.software-full-goal');
  if (await savedGoal.count()) {
    await savedGoal.locator('summary').click();
    await ctx.until(async () => (await savedGoal.innerText()).includes(full.goal), 'complete original request is inspectable in its own window');
    await ctx.screenshot(label + '-full-request', savedGoal.locator('summary'));
    await savedGoal.locator('summary').click();
  }
  const history = card.locator('details.activity-history');
  await history.locator('summary').click();
  await history.getByRole('region', {name: 'Activity history entries', exact: true}).waitFor();
  assert((await history.innerText()).includes(full.message), 'User-visible saved activity must include the actual outcome.');
  await ctx.screenshot(label + '-saved-progress', history.locator('summary'));
  await history.locator('summary').click();
  ctx.assert(label + ' exact request, state and actual persisted activity are inspectable in Software work.');
  await ctx.screenshot(label + '-outcome', card.locator('strong').first());
  if (timedOut) throw new Error(label + ' did not finish within five minutes; actual progress is retained and only the owned fixture was stopped through the UI.');
  return full;
}

async function requireCompleted(ctx, task, exactRequest) {
  if (task.status === 'completed') {
    assert(task.evidence?.checks?.length && task.evidence.checks.every(check => check.ok), 'Completion requires real passing host QA.');
    return;
  }
  const card = ctx.page.locator('[data-software-task-id="' + task.id + '"]');
  const full = card.locator('details.software-full-goal'); if (await full.count()) {if (!await full.evaluate(element => element.open)) await full.locator('summary').click(); await ctx.until(async () => (await full.innerText()).includes(exactRequest), 'exact full task-list goal remains inspectable');}
  await card.getByRole('button', {name: 'Resume checkpoint', exact: true}).waitFor();
  ctx.assert('Unfinished task-list request, actual failure and explicit Resume checkpoint remain visible; recovery is not task completion.');
  await ctx.screenshot('task-list-unfinished-recovery', card.getByRole('button', {name: 'Resume checkpoint', exact: true}));
  const status = await ctx.readApi('/api/status');
  if (/Local AI is unavailable|local (?:AI|model|service).*unavailable|not ready/i.test(task.message)) ctx.blocked('Task-list software goal needs the unavailable native model; no completed app is claimed.', {taskId: task.id, runtime: status, failure: task.message});
  throw new Error('Task-list application did not complete: ' + task.message);
}

async function downloadSource(ctx, task, name) {
  const artifact = task.evidence.artifacts.find(item => item.kind === 'zip' && item.smokeTested); assert(artifact, 'Completed app must have an actual checked source ZIP.');
  const pending = ctx.page.waitForEvent('download'); pending.catch(() => {});
  await ctx.page.locator('[data-software-task-id="' + task.id + '"]').getByRole('button', {name: 'Download source ZIP', exact: true}).click();
  const downloaded = await pending; assert.equal(await downloaded.failure(), null);
  const path = name + '-source.zip'; await downloaded.saveAs(join(ctx.folder, path)); const bytes = await readFile(join(ctx.folder, path));
  const hash = createHash('sha256').update(bytes).digest('hex'); assert.equal(hash, artifact.sha256); assert.equal(bytes.length, artifact.bytes);
  ctx.record.downloads.push({path, suggestedFilename: downloaded.suggestedFilename(), bytes: bytes.length, sha256: hash});
  ctx.assert(name + ' downloaded source matches the verified artifact bytes and SHA-256.'); return bytes;
}

async function inspectRunInstructions(ctx, task) {
  const card = ctx.page.locator('[data-software-task-id="' + task.id + '"]');
  const instructions = card.locator('details.software-run-instructions');
  await instructions.locator('summary').click();
  const text = await instructions.innerText();
  for (const expected of ['Download the checked source ZIP', 'Node.js 20.9 or newer', 'bun install --frozen-lockfile --ignore-scripts', 'bun run build', 'bun run start --port 3216', 'does not launch the app']) assert(text.includes(expected), 'Run instructions need honest supported step: ' + expected);
  await ctx.screenshot('checked-source-run-instructions', instructions.locator('summary'));
  await instructions.locator('summary').click();
  ctx.assert('Checked source ZIP has visible prerequisites and real build/start commands; instructions do not claim to launch an app.');
}

async function exerciseTaskList(page, heading, receipt) {
  await page.getByRole('heading', {name: heading, exact: true}).waitFor();
  const input = page.getByRole('textbox', {name: 'New task', exact: true});
  const add = page.getByRole('button', {name: 'Add', exact: true});
  await input.fill('Buy flour'); await add.click();
  await input.fill('Call the bakery'); await add.click();
  const first = page.getByRole('listitem').filter({hasText: 'Buy flour'}), remaining = page.getByRole('listitem').filter({hasText: 'Call the bakery'});
  await first.waitFor(); await remaining.waitFor();
  await first.getByRole('button', {name: 'Remove', exact: true}).click();
  assert.equal(await first.count(), 0, 'Remove deletes only the chosen task.'); await remaining.waitFor();
  await page.reload({waitUntil: 'networkidle'}); await page.getByRole('heading', {name: heading, exact: true}).waitFor();
  await remaining.waitFor(); assert.equal(await first.count(), 0, 'Removed task stays removed after reload.');
  await input.fill('Review delivery'); await add.click();
  const next = page.getByRole('listitem').filter({hasText: 'Review delivery'}); await next.waitFor();
  await remaining.getByRole('button', {name: 'Remove', exact: true}).click(); await next.waitFor();
  await page.reload({waitUntil: 'networkidle'}); await next.waitFor(); assert.equal(await remaining.count(), 0);
  // Duplicate text must still represent distinct items; remove must not delete
  // every equal string. Enter/Tab exercise real keyboard form controls.
  await input.fill('Check stock'); await input.press('Tab');
  assert(await add.evaluate(element => document.activeElement === element), 'Add is reachable from the input with Tab.');
  await add.press('Enter'); await input.fill('Check stock'); await add.click();
  const duplicates = page.getByRole('listitem').filter({hasText: 'Check stock'});
  assert.equal(await duplicates.count(), 2); await duplicates.first().getByRole('button', {name: 'Remove', exact: true}).click();
  assert.equal(await duplicates.count(), 1, 'Removing one duplicate must preserve the other.');
  await page.reload({waitUntil: 'networkidle'}); assert.equal(await duplicates.count(), 1); await next.waitFor();
  const bounds = await input.boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, 'Task entry remains within the viewport.');
  receipt.behavior = {heading, input: 'New task', add: 'Add', keyboardAdd: true, individualRemove: true, duplicateRemoval: true, retainedAfterReload: ['Review delivery', 'Check stock'], removedAfterReload: ['Buy flour', 'Call the bakery']};
}

export const taskListJourney = {
  id: 'task-list-application', prerequisite: 'Real local model and existing software build dependencies; no scripted inference.',
  goal: 'Build a usable persistent task list, download and run its actual source, then revise its heading while preserving the accepted parent and add/remove/reload behavior.',
  async run(ctx) {
    await ctx.send(taskListRequest); await ctx.closeComposer(); await ctx.page.locator('.software-panel').waitFor();
    const parent = await waitForTask(ctx, task => !task.parentTaskId && task.goal === taskListRequest, 'task-list-parent');
    assert.equal(ctx.record.apiMutations.filter(item => item.path === '/api/software').length, 1, 'The full natural-language request must create exactly one Software goal.');
    assert.equal(parent.goal, taskListRequest); await requireCompleted(ctx, parent, taskListRequest);
    await inspectRunInstructions(ctx, parent);
    const parentZip = await downloadSource(ctx, parent, 'task-list-parent');
    await ctx.inspectSoftware(parent.id, {name: 'task-list-parent-produced'}, (page, receipt) => exerciseTaskList(page, 'My Tasks', receipt));
    await ctx.inspectSoftware(parent.id, {name: 'task-list-parent-downloaded', sourceZip: parentZip}, (page, receipt) => exerciseTaskList(page, 'My Tasks', receipt));
    ctx.assert('Actual produced bundle and independently extracted/downloaded source build both add, remove individual tasks and preserve the remaining list after reload.');
    await ctx.page.reload({waitUntil: 'networkidle'}); assert.deepEqual(await ctx.readApi('/api/software/' + parent.id), parent);
    const parentCard = ctx.page.locator('[data-software-task-id="' + parent.id + '"]');
    await parentCard.getByRole('textbox', {name: 'Revision guidance', exact: true}).fill(taskListRevision);
    const before = ctx.record.apiMutations.filter(item => /\/revise$/.test(item.path)).length;
    await parentCard.getByRole('button', {name: 'Create revised build', exact: true}).click();
    const child = await waitForTask(ctx, task => task.parentTaskId === parent.id, 'task-list-revision');
    assert.notEqual(child.id, parent.id); assert.equal(child.revisionNote, taskListRevision); assert.equal(child.parentRevision, parent.revision);
    assert.equal(ctx.record.apiMutations.filter(item => /\/revise$/.test(item.path)).length, before + 1);
    await requireCompleted(ctx, child, parent.goal);
    const childZip = await downloadSource(ctx, child, 'task-list-revision');
    await ctx.inspectSoftware(child.id, {name: 'task-list-revision-produced'}, (page, receipt) => exerciseTaskList(page, 'My Week', receipt));
    await ctx.inspectSoftware(child.id, {name: 'task-list-revision-downloaded', sourceZip: childZip}, (page, receipt) => exerciseTaskList(page, 'My Week', receipt));
    await ctx.inspectSoftware(parent.id, {
      name: 'task-list-same-origin-replacement', replacementTaskId: child.id,
      async inspectReplacement(page, receipt) {
        await page.getByRole('heading', {name: 'My Week', exact: true}).waitFor();
        const kept = page.getByRole('listitem').filter({hasText: 'Review delivery'}), duplicate = page.getByRole('listitem').filter({hasText: 'Check stock'});
        await kept.waitFor(); await duplicate.waitFor();
        receipt.storageAfter = await page.evaluate(() => Object.entries(localStorage).sort());
        assert.deepEqual(receipt.storageAfter, receipt.storageBefore, 'Same-origin revision must retain actual parent task storage without transfer or API seeding.');
        assert.equal(await page.getByRole('listitem').count(), 2);
        const input = page.getByRole('textbox', {name: 'New task', exact: true}); await input.fill('Plan next week');
        await page.getByRole('button', {name: 'Add', exact: true}).click();
        await duplicate.getByRole('button', {name: 'Remove', exact: true}).click();
        await page.reload({waitUntil: 'networkidle'}); await kept.waitFor();
        await page.getByRole('listitem').filter({hasText: 'Plan next week'}).waitFor();
        assert.equal(await duplicate.count(), 0); receipt.retainedContext = true; receipt.behaviorAfterUpgrade = {heading: 'My Week', kept: 'Review delivery', added: 'Plan next week', removed: 'Check stock'};
      }
    }, (page, receipt) => exerciseTaskList(page, 'My Tasks', receipt));
    ctx.assert('Same owned origin and retained browser context: parent list survives actual server replacement with My Week; add/remove/reload still work without cross-port data transfer.');
    assert.deepEqual(await ctx.readApi('/api/software/' + parent.id), parent, 'Accepted parent record must remain unchanged.');
    const childCard = ctx.page.locator('[data-software-task-id="' + child.id + '"]');
    await childCard.getByRole('button', {name: 'Open parent build', exact: true}).click();
    await ctx.until(() => parentCard.getAttribute('aria-current').then(value => value === 'true'), 'child link selects the accepted parent');
    assert.deepEqual(await downloadSource(ctx, parent, 'task-list-parent-after-revision'), parentZip, 'Parent download stays byte-identical.');
    await ctx.screenshot('task-list-parent-kept', parentCard.locator('strong').first());
    await ctx.page.reload({waitUntil: 'networkidle'});
    assert.deepEqual(await ctx.readApi('/api/software/' + parent.id), parent); assert.deepEqual(await ctx.readApi('/api/software/' + child.id), child);
    assert.equal(ctx.record.apiMutations.filter(item => /\/revise$/.test(item.path)).length, before + 1, 'Reload must not create another revision.');
    ctx.assert('Explicit linked revision has My Week with original behavior; parent record and downloaded artifact remain identical across revision and reload without replay.');
  }
};
