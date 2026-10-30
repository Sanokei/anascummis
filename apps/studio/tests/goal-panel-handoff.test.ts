import {expect, test} from 'bun:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Synthetic browser/API ordering proof. No model, real document or restart claim.
test('an older goal poll cannot replace a confirmed edit handoff or approval', async () => {
  await mkdir('.test-data', {recursive: true});
  const folder = await mkdtemp(resolve('.test-data/goal-panel-handoff-'));
  const parentId = '829c3521-8b12-4149-9a6d-321234567890', childId = '00fab2c6-23dd-4db1-a875-e17ae7121cdf';
  const documentId = '0ea40ce9-ef40-46b8-92ad-7ec22788cb24', operationId = '5677a109-8625-4353-b292-0791cdaf5ed5', proposalSha256 = 'b'.repeat(64);
  const common = {projectId: 'same-project', research: false, tasks: [], created: 1, updated: 1, events: [], notes: [], planningDone: true, planningCalls: 0, planningOffset: 0, coverageDone: true, coverageOffset: 0};
  const parent: any = {...common, id: parentId, request: 'Where are the tests and results?', status: 'completed', phase: 'completed', message: 'Accepted original brief.',
    brief: {parentGoalId: '829c3521-8b12-4149-9a6d-321234567891', requestKey: '829c3521-8b12-4149-9a6d-321234567892', title: 'Fetch contributor brief', notes: 'Keep the complete note.'},
    briefEditEligibility: {canEdit: true}, briefState: {phase: 'saved', artifact: {documentId, pages: 2}}};
  let savedChild: any, polls = 0, creates = 0, applies = 0;
  const releases = new Map<number, () => void>(), started = new Map<number, () => void>();
  const createPoll = new Promise<void>(resolve => started.set(2, resolve)), approvalPoll = new Promise<void>(resolve => started.set(3, resolve));
  const entry = join(folder, 'entry.tsx');
  await Bun.write(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{GoalPanel}from ${JSON.stringify(resolve('components/GoalPanel.tsx'))};createRoot(document.getElementById('root')).render(<GoalPanel projectId="same-project" onOpenProject={()=>{}} onOpenDocument={()=>{}} onOpenSoftware={()=>{}}/>);`);
  const built = await Bun.build({entrypoints: [entry], target: 'browser'});
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const bundle = await built.outputs[0].text();
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/goals') {
      const call = ++polls, snapshot = structuredClone(savedChild ? [savedChild, parent] : [parent]);
      if (call === 2 || call === 3) {started.get(call)?.(); await new Promise<void>(resolve => releases.set(call, resolve));}
      return Response.json(snapshot);
    }
    if (url.pathname === '/api/goals/' + parentId + '/document-edit' && request.method === 'POST') {
      creates++; const submission: any = await request.json();
      savedChild = {...common, id: childId, parentGoalId: parentId, documentId, request: submission.intent, status: 'needs_input', phase: 'needs_input', message: 'The proposal awaits explicit approval.', updated: 2,
        documentEdit: {...submission, parentGoalId: parentId, documentId, baseRevision: 0, basePdfSha256: 'a'.repeat(64)},
        documentEditState: {operationId, goalId: childId, inputSha256: 'c'.repeat(64), phase: 'awaiting_approval',
          before: {paragraphs: [{text: 'Tests and results appear together.', citations: [1, 2]}]},
          proposal: {paragraphs: [{text: 'Tests: The tests location. Browser results: The results location.', citations: [1, 2]}]}, proposalSha256,
          preserved: {title: parent.brief.title, notes: parent.brief.notes, citations: []},
          draftCheck: {accepted: true, reason: 'Host proposal checks passed.'}, supportReview: {supported: true, reason: 'Both facts are supported.'}}};
      return Response.json(savedChild);
    }
    if (url.pathname === '/api/goals/' + childId + '/document-edit/apply' && request.method === 'POST') {
      applies++; savedChild = {...savedChild, status: 'queued', phase: 'queued', message: 'The exact approval is saved.', updated: 3,
        documentEditState: {...savedChild.documentEditState, phase: 'approved', approvedProposalSha256: proposalSha256}};
      return Response.json(savedChild);
    }
    if (url.pathname.endsWith('/activity')) return Response.json({events: [], hasMore: false});
    if (url.pathname === '/bundle.js') return new Response(bundle, {headers: {'Content-Type': 'text/javascript'}});
    return new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
    const page = await browser.newPage();
    await page.goto(server.url.href);
    const parentCard = page.locator('[data-goal-id="' + parentId + '"]'), childCard = page.locator('[data-goal-id="' + childId + '"]');
    await parentCard.getByRole('button', {name: 'Edit brief', exact: true}).click();
    await parentCard.getByLabel('Requested brief change', {exact: true}).fill('Use labelled Tests: and Browser results: sentences.');
    await parentCard.getByRole('checkbox', {name: 'Two labelled sentences', exact: true}).check();
    await parentCard.getByLabel('First sentence label', {exact: true}).fill('Tests:');
    await parentCard.getByLabel('Second sentence label', {exact: true}).fill('Browser results:');
    await createPoll; // The ordinary poll has captured the old parent-only list.
    await parentCard.getByRole('button', {name: 'Save edit and propose changes', exact: true}).click();
    await childCard.waitFor();
    expect(await childCard.getAttribute('aria-current')).toBe('true');
    expect(creates).toBe(1);
    const oldCreatePoll = page.waitForResponse(response => new URL(response.url()).pathname === '/api/goals' && response.request().method() === 'GET');
    releases.get(2)!(); await (await oldCreatePoll).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await childCard.count()).toBe(1);
    expect(await childCard.getAttribute('aria-current')).toBe('true');

    await approvalPoll; // This poll captured the child before its approval.
    await childCard.getByRole('button', {name: 'Apply proposed edit', exact: true}).click();
    await childCard.getByText('Your approval is saved', {exact: true}).waitFor();
    expect(applies).toBe(1);
    const oldApprovalPoll = page.waitForResponse(response => new URL(response.url()).pathname === '/api/goals' && response.request().method() === 'GET');
    releases.get(3)!(); await (await oldApprovalPoll).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await childCard.getByText('Your approval is saved', {exact: true}).isVisible()).toBe(true);
    expect(await childCard.getByRole('button', {name: 'Apply proposed edit', exact: true}).count()).toBe(0);
    expect(await childCard.getByRole('button', {name: 'Stop goal', exact: true}).count()).toBe(1);
    expect(creates).toBe(1); expect(applies).toBe(1);
    // A separate synthetic metadata state checks the section-specific link copy;
    // it does not claim another model decision or a real saved note revision.
    savedChild = {...savedChild, updated: 4, request: 'Make this clearer for a newcomer', documentEdit: {...savedChild.documentEdit, intent: 'Make this clearer for a newcomer', sentenceLabels: undefined, baseRevision: 2, target: {section: 'notes', paragraph: 1, paragraphSha256: 'd'.repeat(64), format: 'clearer-plain-paragraph'}}};
    await childCard.getByText('An edit to personal-note paragraph 2 based on accepted version 2. The summary, other note paragraphs and source evidence are preserved; earlier files remain available.', {exact: true}).waitFor();
    expect(await childCard.getByText('A summary edit based on accepted version 2. Earlier files, notes and research are preserved.', {exact: true}).count()).toBe(0); expect(creates).toBe(1); expect(applies).toBe(1);
  } finally {for (const release of releases.values()) release(); await browser?.close(); await server.stop(true); await rm(folder, {recursive: true, force: true});}
}, 30_000);
