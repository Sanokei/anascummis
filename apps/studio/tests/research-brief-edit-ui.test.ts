import {expect, test} from 'bun:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Synthetic component/transport proof only. Real model/output/restart evidence belongs to the goal journey.
test('document edit UI preserves an uncertain request and approval without replay', async () => {
  await mkdir('.test-data', {recursive: true});
  const folder = await mkdtemp(resolve('.test-data/research-brief-edit-ui-'));
  const parent: any = {id: '829c3521-8b12-4149-9a6d-321234567890', request: 'Where are the tests and results?', status: 'completed', tasks: [],
    brief: {title: 'Saved research brief', notes: 'Exact <personal> note & café\nKeep the second line.'}, briefState: {artifact: {documentId: '0ea40ce9-ef40-46b8-92ad-7ec22788cb24'}}};
  let child: any, posts = 0, applies = 0, gets = 0;
  const operationId = '5677a109-8625-4353-b292-0791cdaf5ed5', proposalHash = 'b'.repeat(64);
  const initialChild = (submission: any) => ({id: '00fab2c6-23dd-4db1-a875-e17ae7121cdf', parentGoalId: parent.id, request: submission.intent, status: 'needs_input', tasks: [],
    documentEdit: {...submission, parentGoalId: parent.id, documentId: parent.briefState.artifact.documentId, baseRevision: 0, basePdfSha256: 'c'.repeat(64)},
    documentEditState: {operationId, goalId: '00fab2c6-23dd-4db1-a875-e17ae7121cdf', inputSha256: 'a'.repeat(64), phase: 'awaiting_approval',
      before: {paragraphs: [{text: 'The test location and results are described together.', citations: [1, 2]}]},
      proposal: {paragraphs: [{text: 'Tests: See the saved test location. Browser results: See the saved results location.', citations: [1, 2]}]}, proposalSha256: proposalHash,
      preserved: {title: parent.brief.title, notes: parent.brief.notes, citations: [{number: 1, quote: 'Literal `source` [label](https://example.com/source)', sourceId: 'source', offset: 3, textSha256: 'e'.repeat(64)}]},
      writingAttempt: {sha256: 'd'.repeat(64), raw: {paragraphs: [{text: '<script>window.editExecuted=true</script>', citations: [1, 2]}]}},
      draftCheck: {accepted: true, reason: 'The exact proposal passes the bounded host checks.'}, supportReview: {supported: true, reason: 'The retained evidence supports both locations.'}}});
  const entry = join(folder, 'entry.tsx');
  await Bun.write(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchBriefEdit}from ${JSON.stringify(resolve('components/ResearchBriefEdit.tsx'))};const root=createRoot(document.getElementById('root'));window.showEdit=goal=>root.render(<ResearchBriefEdit goal={goal} onCreated={next=>{window.lastCreated=next;if(location.search)window.showEdit(next);}} onOpenDocument={id=>window.lastOpened=id}/>);if(location.search)fetch('/api/goals/00fab2c6-23dd-4db1-a875-e17ae7121cdf').then(r=>r.json()).then(window.showEdit);else window.showEdit(${JSON.stringify(parent)});`);
  const built = await Bun.build({entrypoints: [entry], target: 'browser'});
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const bundle = await built.outputs[0].text(), css = await Bun.file('app/style.css').text();
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/document-edit/apply') && request.method === 'POST') {
      applies++; const approval: any = await request.json();
      if (approval.operationId !== operationId || approval.proposalSha256 !== proposalHash) return Response.json({error: 'Wrong proposal identity'}, {status: 409});
      child = {...child, status: 'queued', documentEditState: {...child.documentEditState, phase: 'approved', approvedProposalSha256: proposalHash}};
      return Response.json(child);
    }
    if (url.pathname.endsWith('/document-edit') && request.method === 'POST') {posts++; child = initialChild(await request.json()); return Response.json(child);}
    if (url.pathname === '/api/goals') {gets++; return Response.json(child ? [child] : []);}
    if (url.pathname.startsWith('/api/goals/')) {gets++; return Response.json(child);}
    if (url.pathname === '/bundle.js') return new Response(bundle, {headers: {'Content-Type': 'text/javascript'}});
    if (url.pathname === '/style.css') return new Response(css, {headers: {'Content-Type': 'text/css'}});
    return new Response('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:white}.goal-panel{padding:10px;box-sizing:border-box;width:100%;font:14px sans-serif}</style></head><body><div id="root" class="goal-panel"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
    const context = await browser.newContext({viewport: {width: 360, height: 420}}), page = await context.newPage();
    await page.goto(server.url.href);
    await page.getByRole('button', {name: 'Edit brief', exact: true}).click();
    const intent = 'Use two sentences labelled Tests: and Browser results:. Keep all notes and citation evidence.';
    await page.getByLabel('Requested brief change', {exact: true}).fill(intent);
    await page.reload();
    expect(await page.getByLabel('Requested brief change', {exact: true}).inputValue()).toBe(intent);
    expect(posts).toBe(0); expect(applies).toBe(0);
    await page.route('**/api/goals/*/document-edit', async route => {await route.fetch(); await route.abort('failed');});
    await page.getByRole('button', {name: 'Save edit and propose changes', exact: true}).click();
    await page.waitForFunction(() => document.body.innerText.includes('Edit submission was not confirmed.'));
    expect(posts).toBe(1);
    await page.reload();
    await page.getByRole('button', {name: 'Inspect saved edits', exact: true}).waitFor();
    expect(posts).toBe(1); expect(applies).toBe(0);
    await page.getByLabel('Requested brief change', {exact: true}).fill('A newer unsent request');
    await page.getByRole('button', {name: 'Inspect saved edits', exact: true}).click();
    await page.waitForFunction(() => !!(window as any).lastCreated);
    expect(posts).toBe(1); expect(applies).toBe(0);
    expect(await page.getByLabel('Requested brief change', {exact: true}).inputValue()).toBe('A newer unsent request');
    expect(await page.evaluate(() => (window as any).lastCreated.documentEdit.intent)).toBe(intent);

    await page.goto(server.url.href + '?child=1');
    await page.getByRole('region', {name: 'Before edit', exact: true}).waitFor();
    expect(await page.getByRole('region', {name: 'Proposed edit', exact: true}).innerText()).toContain('Tests:');
    const apply = page.getByRole('button', {name: 'Apply proposed edit', exact: true});
    await apply.scrollIntoViewIfNeeded();
    expect((await apply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await apply.focus(); expect(await apply.evaluate(button => button === document.activeElement)).toBe(true);
    await page.route('**/api/goals/*/document-edit/apply', async route => {await route.fetch(); await route.abort('failed');});
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.innerText.includes('Apply was not confirmed.'));
    expect(applies).toBe(1);
    await page.reload();
    await page.getByRole('button', {name: 'Inspect saved edit', exact: true}).waitFor();
    expect(applies).toBe(1);
    expect(await page.getByRole('button', {name: 'Apply proposed edit', exact: true}).count()).toBe(0);
    await page.getByRole('button', {name: 'Inspect saved edit', exact: true}).click();
    await page.waitForFunction(() => document.body.innerText.includes('Your exact proposal approval is saved.'));
    expect(applies).toBe(1); expect(posts).toBe(1); expect(gets).toBeGreaterThanOrEqual(3);
    expect(await page.getByRole('button', {name: 'Retry applying inspected proposal', exact: true}).count()).toBe(0);
    await page.getByText('Preserved notes, citations and original files', {exact: true}).click();
    expect(await page.getByText(parent.brief.notes, {exact: true}).innerText()).toBe(parent.brief.notes);
    expect(await page.getByRole('link', {name: 'Download original PDF', exact: true}).getAttribute('href')).toBe('/api/goals/' + parent.id + '/brief/export?format=pdf');
    await page.getByText('Edit operation and native decision', {exact: true}).click();
    expect(await page.getByLabel('Original native edit decision JSON', {exact: true}).innerText()).toContain('<script>window.editExecuted=true</script>');
    expect(await page.evaluate(() => (window as any).editExecuted)).toBeUndefined();

    const artifact = {operationId, documentId: parent.briefState.artifact.documentId, revision: 1, pages: 2, pdfSha256: 'f'.repeat(64), htmlSha256: '0'.repeat(64), provenanceSha256: '1'.repeat(64)};
    await page.evaluate((next) => (window as any).showEdit(next), {...child, status: 'needs_input', documentEditState: {...child.documentEditState, phase: 'rendered', artifact}});
    await page.getByText('The prepared files are not yet registered as a document version.', {exact: false}).waitFor();
    expect(await page.getByRole('button', {name: 'Open revised PDF', exact: true}).count()).toBe(0);
    expect(await page.getByRole('link', {name: 'Download revised PDF', exact: true}).count()).toBe(0);
    await page.evaluate((next) => (window as any).showEdit(next), {...child, status: 'completed', documentEditState: {...child.documentEditState, phase: 'saved', artifact}});
    await page.getByRole('button', {name: 'Open revised PDF', exact: true}).click();
    expect(await page.evaluate(() => (window as any).lastOpened)).toBe(artifact.documentId);
    const html = page.getByRole('link', {name: 'Open revised HTML', exact: true});
    expect(await html.getAttribute('href')).toBe('/api/goals/' + child.id + '/document-edit/preview');
    expect(await html.getAttribute('target')).toBe('_blank'); expect(await html.getAttribute('rel')).toBe('noopener noreferrer');
    expect(await page.getByRole('link', {name: 'Download revised PDF', exact: true}).getAttribute('href')).toBe('/api/goals/' + child.id + '/document-edit/export?format=pdf');
    expect(await page.getByRole('link', {name: 'Inspect edit provenance', exact: true}).getAttribute('href')).toBe('/api/goals/' + child.id + '/document-edit/provenance?format=html');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(server.url.href);
    await page.getByLabel('Requested brief change', {exact: true}).waitFor();
    await page.evaluate(next => (window as any).showEdit(next), {...parent, briefEditEligibility: {canEdit: false, reason: 'This document already has a newer version. Open the linked edit goal.'}});
    expect(await page.getByLabel('Requested brief change', {exact: true}).inputValue()).toBe('A newer unsent request');
    expect(await page.getByRole('button', {name: 'Save edit and propose changes', exact: true}).isDisabled()).toBe(true);
    expect(await page.getByText('This document already has a newer version. Open the linked edit goal.', {exact: true}).isVisible()).toBe(true);
    expect(posts).toBe(1); expect(applies).toBe(1);
    await context.close();
    const freshContext = await browser.newContext(), fresh = await freshContext.newPage();
    await fresh.goto(server.url.href);
    await fresh.getByRole('button', {name: 'Edit brief', exact: true}).waitFor();
    await fresh.evaluate(next => (window as any).showEdit(next), {...parent, briefEditEligibility: {canEdit: false, reason: 'This original already has a saved revision.'}});
    expect(await fresh.getByRole('button', {name: 'Edit brief', exact: true}).isDisabled()).toBe(true);
    expect(await fresh.getByLabel('Requested brief change', {exact: true}).count()).toBe(0);
    expect(posts).toBe(1); expect(applies).toBe(1);
    await freshContext.close();
    const damagedContext = await browser.newContext();
    const rawDraft = '{"version":0,"intent":"Keep this older-format literal <draft> & café"';
    const draftKey = 'anascummis.research-brief-edit-draft.v1.' + parent.id;
    await damagedContext.addInitScript(({key, raw}) => {if (!localStorage.getItem(key)) localStorage.setItem(key, raw);}, {key: draftKey, raw: rawDraft});
    const damaged = await damagedContext.newPage();
    await damaged.goto(server.url.href);
    await damaged.getByText('Unreadable saved edit draft', {exact: true}).click();
    expect(await damaged.getByLabel('Unreadable saved edit draft raw text', {exact: true}).innerText()).toBe(rawDraft);
    await damaged.evaluate(() => {const realSet = Storage.prototype.setItem; (window as any).restoreSetItem = () => {Storage.prototype.setItem = realSet;}; Storage.prototype.setItem = function(key, value) {if (key.includes('.unreadable.')) throw new Error('backup unavailable'); return realSet.call(this, key, value);};});
    await damaged.getByRole('button', {name: 'Keep unreadable draft and start new edit', exact: true}).click();
    expect(await damaged.evaluate(key => localStorage.getItem(key), draftKey)).toBe(rawDraft);
    expect(await damaged.getByLabel('Requested brief change', {exact: true}).count()).toBe(0);
    await damaged.evaluate(() => (window as any).restoreSetItem());
    await damaged.getByRole('button', {name: 'Keep unreadable draft and start new edit', exact: true}).click();
    await damaged.getByLabel('Requested brief change', {exact: true}).waitFor();
    expect(await damaged.evaluate(key => Object.keys(localStorage).filter(name => name.startsWith(key + '.unreadable.')).map(name => localStorage.getItem(name)), draftKey)).toEqual([rawDraft]);
    expect(await damaged.getByLabel('Unreadable saved edit draft raw text', {exact: true}).innerText()).toBe(rawDraft);
    expect(posts).toBe(1); expect(applies).toBe(1);
    await damagedContext.close();
  } finally {await browser?.close(); await server.stop(true); await rm(folder, {recursive: true, force: true});}
}, 60_000);
