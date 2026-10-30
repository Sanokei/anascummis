import {expect, test} from 'bun:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Actual browser/dialog behavior with injected transport. Native model quality,
// PDF bytes and host restart are checked separately by the ordinary user journey.
test('expanded review escapes the small window, renders source links and keeps explicit approval safe', async () => {
  await mkdir('.test-data', {recursive: true}); const dir = await mkdtemp(resolve('.test-data/brief-review-'));
  const id = '74f0a760-ec0e-45eb-828a-fca5195c09df', parent = 'c744b125-94a2-4dc2-a7d2-bbb145861d27', original = 'd17eeb4c-1cbe-4644-a470-9ef5d4c7a62d';
  const operationId = 'e127daac-2ca0-48d5-bd16-46e81998512e', proposalSha256 = 'b'.repeat(64);
  const intent = 'Shorten the current summary to one sentence for a newcomer; keep both exact locations and citations and do not change notes/evidence.';
  const citations = [{number: 1, quote: 'Tests are in the `fetch/` directory of [`web-platform-tests/wpt`](https://github.com/web-platform-tests/wpt).'}, {number: 2, quote: 'Browser results appear at [wpt.fyi/results/fetch](https://wpt.fyi/results/fetch).'}];
  const before = {paragraphs: [{text: 'Tests: Tests for the Fetch Standard can be found in the `fetch/` directory of [`web-platform-tests/wpt`](https://github.com/web-platform-tests/wpt). Browser results: A dashboard showing the tests running against browser engines can be seen at [wpt.fyi/results/fetch](https://wpt.fyi/results/fetch).', citations: [1, 2]}]};
  const proposal = {paragraphs: [{text: 'Fetch tests are in `fetch/` in [web-platform-tests/wpt](https://github.com/web-platform-tests/wpt), with browser results at https://wpt.fyi/results/fetch.', citations: [1, 2]}]};
  let goal: any = {id, parentGoalId: parent, status: 'needs_input', tasks: [], request: intent, documentEdit: {parentGoalId: parent, originalBriefGoalId: original, requestKey: '14192ed2-5988-46bc-9423-fe49ae933cfd', intent, documentId: 'ef67510b-4f1b-4a34-b124-89bf836baadf', baseRevision: 1, basePdfSha256: 'a'.repeat(64), requirements: {oneSentence: true, shorterThanCharacters: 300, locations: ['fetch/', 'web-platform-tests/wpt', 'wpt.fyi/results/fetch']}}, documentEditState: {operationId, goalId: id, phase: 'awaiting_approval', writingMode: 'current-summary-rewrite-v4', inputSha256: 'a'.repeat(64), before, proposal, proposalSha256, preserved: {title: 'Fetch contributor brief', notes: 'Exact original notes remain unchanged.', citations}, writingAttempt: {raw: proposal, sha256: 'c'.repeat(64)}, draftCheck: {accepted: true, reason: 'The requested shape and saved locations pass host checks.'}, supportReview: {supported: true, reason: 'Injected review fixture only.'}}};
  let applies = 0, gets = 0, creates = 0; const entry = join(dir, 'entry.tsx');
  await Bun.write(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchBriefEdit}from ${JSON.stringify(resolve('components/ResearchBriefEdit.tsx'))};const root=createRoot(document.getElementById('root'));window.showGoal=g=>root.render(<ResearchBriefEdit key={g.id} goal={g} onCreated={window.showGoal} onOpenDocument={()=>{}}/>);fetch('/api/goals/${id}').then(r=>r.json()).then(window.showGoal);`);
  const built = await Bun.build({entrypoints: [entry], target: 'browser'}); if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const js = await built.outputs[0].text(), css = await Bun.file('app/style.css').text();
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/document-edit/apply') && request.method === 'POST') {applies++; expect(await request.json()).toEqual({operationId, proposalSha256}); goal = {...goal, status: 'queued', documentEditState: {...goal.documentEditState, phase: 'approved', approvedProposalSha256: proposalSha256}}; return Response.json(goal);}
    if (path.endsWith('/document-edit') && request.method === 'POST') {creates++; return Response.json({error: 'No create in this review fixture'}, {status: 400});}
    if (path.startsWith('/api/goals/')) {gets++; return Response.json(goal);}
    if (path === '/bundle.js') return new Response(js, {headers: {'Content-Type': 'text/javascript'}});
    if (path === '/style.css') return new Response(css, {headers: {'Content-Type': 'text/css'}});
    return new Response('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#eef4f8}.goal-panel{box-sizing:border-box;position:absolute;left:16px;top:72px;width:min(400px,calc(100vw - 32px));height:min(440px,calc(100vh - 96px));overflow:auto;padding:12px;background:#fff;font:12px sans-serif}</style></head><body><div id="root" class="goal-panel"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium'});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, hasTouch: true, reducedMotion: 'reduce'}), page = await context.newPage(); await context.route('https://**/*', route => route.abort()); await page.goto(server.url.href);
    const trigger = page.getByRole('button', {name: 'Review proposed change', exact: true}); await trigger.click();
    const dialog = page.getByRole('dialog', {name: 'Review summary edit', exact: true}); await dialog.waitFor();
    const desktop = await dialog.boundingBox(); expect(desktop!.width).toBeGreaterThanOrEqual(800); expect(desktop!.width).toBeLessThanOrEqual(1000); expect(await page.locator('.goal-panel').evaluate(e => e.clientWidth)).toBe(400);
    expect(await dialog.getByRole('heading', {name: 'Review summary edit', exact: true}).evaluate(e => e === document.activeElement)).toBe(true); expect(await dialog.innerText()).toContain('Version 1 → proposed version 2 · Changed section: Summary');
    const old = dialog.getByRole('region', {name: 'Before summary', exact: true}), next = dialog.getByRole('region', {name: 'Proposed summary', exact: true}), oldBox = await old.boundingBox(), nextBox = await next.boundingBox();
    expect(oldBox!.width).toBeGreaterThan(350); expect(nextBox!.width).toBeGreaterThan(350); expect(nextBox!.x).toBeGreaterThan(oldBox!.x + oldBox!.width); expect(await old.innerText()).not.toContain('`'); expect(await old.innerText()).not.toContain(']('); expect(await next.innerText()).not.toContain('`');
    for (const href of ['https://github.com/web-platform-tests/wpt', 'https://wpt.fyi/results/fetch']) expect(await next.locator('a[href="' + href + '"]').count()).toBeGreaterThan(0);
    const apply = dialog.getByRole('button', {name: 'Apply proposed edit', exact: true}), cancel = dialog.getByRole('button', {name: 'Cancel review', exact: true});
    const footer = await dialog.locator('footer').boundingBox(); expect(oldBox!.y + oldBox!.height).toBeLessThan(footer!.y); expect(nextBox!.y + nextBox!.height).toBeLessThan(footer!.y);
    await mkdir('/workspace/.cloud-env/anascummis/section-edit/ui-preflight', {recursive: true});
    await page.screenshot({path: '/workspace/.cloud-env/anascummis/section-edit/ui-preflight/fixture-desktop-summary-review.png'});
    await page.keyboard.press('Enter'); expect(applies).toBe(0); await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'}); expect(await trigger.evaluate(e => e === document.activeElement)).toBe(true); expect(applies).toBe(0); expect(creates).toBe(0);
    await trigger.click(); await cancel.click(); await dialog.waitFor({state: 'hidden'}); expect(applies).toBe(0); expect(await trigger.evaluate(e => e === document.activeElement)).toBe(true);
    await page.setViewportSize({width: 360, height: 420}); await trigger.tap(); await dialog.waitFor();
    const stackedOld = await old.boundingBox(), stackedNext = await next.boundingBox(); expect(stackedNext!.y).toBeGreaterThan(stackedOld!.y + stackedOld!.height); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of [apply, cancel]) {const b = await control.boundingBox(); expect(b!.height).toBeGreaterThanOrEqual(44); expect(b!.x).toBeGreaterThanOrEqual(0); expect(b!.x + b!.width).toBeLessThanOrEqual(360); expect(b!.y).toBeGreaterThanOrEqual(0); expect(b!.y + b!.height).toBeLessThanOrEqual(420); await control.focus(); expect(await control.evaluate(e => e === document.activeElement)).toBe(true);}
    await page.screenshot({path: '/workspace/.cloud-env/anascummis/section-edit/ui-preflight/fixture-short-summary-review.png'});
    await dialog.getByText('Exact raw comparison and citation evidence', {exact: true}).click(); expect(JSON.parse(await dialog.getByLabel('Raw before summary JSON', {exact: true}).innerText())).toEqual(before); expect(JSON.parse(await dialog.getByLabel('Raw proposed summary JSON', {exact: true}).innerText())).toEqual(proposal);
    expect(await dialog.getByRole('link', {name: 'Download base version 1 PDF', exact: true}).getAttribute('href')).toBe('/api/goals/' + parent + '/document-edit/export?format=pdf');
    await dialog.getByRole('region', {name: 'Summary comparison and evidence', exact: true}).evaluate(e => {e.scrollTop = e.scrollHeight;});
    const scrolledFooter = await dialog.locator('footer').boundingBox(); expect(scrolledFooter!.y).toBeGreaterThanOrEqual(0); expect(scrolledFooter!.y + scrolledFooter!.height).toBeLessThanOrEqual(420);
    await page.route('**/api/goals/*/document-edit/apply', async route => {await route.fetch(); await route.abort('failed');}, {times: 1}); await apply.tap(); const inspect = dialog.getByRole('button', {name: 'Inspect saved edit', exact: true}); await inspect.waitFor(); expect(applies).toBe(1); const inspectBox = await inspect.boundingBox(); expect(inspectBox!.y + inspectBox!.height).toBeLessThanOrEqual(420);
    await inspect.tap(); await page.waitForFunction(() => document.body.innerText.includes('Your exact proposal approval is saved.')); expect(applies).toBe(1); expect(gets).toBeGreaterThanOrEqual(2); expect(await dialog.getByRole('button', {name: 'Apply proposed edit', exact: true}).count()).toBe(0);
    await cancel.tap(); await page.reload(); await trigger.waitFor(); expect(applies).toBe(1); expect(creates).toBe(0); await page.getByText('Preserved notes, citations and original files', {exact: true}).click(); expect(await page.getByRole('link', {name: 'Download original PDF', exact: true}).getAttribute('href')).toBe('/api/goals/' + original + '/brief/export?format=pdf');
    const conflicting = {...goal, status: 'needs_input', documentEditState: {...goal.documentEditState, phase: 'awaiting_approval', conflict: {expectedRevision: 1, actualRevision: 2, reason: 'Another document change was saved first. The proposal was not rebased.'}}};
    await page.evaluate(nextGoal => (window as any).showGoal(nextGoal), conflicting); await trigger.tap(); await dialog.waitFor(); expect(await dialog.innerText()).toContain('Base version 1 changed to version 2.'); expect(await dialog.getByRole('button', {name: 'Apply proposed edit', exact: true}).count()).toBe(0); expect(applies).toBe(1); await cancel.tap();
    const acceptedVersionOne = {...goal, id: parent, status: 'completed', briefEditEligibility: {canEdit: true}, documentEdit: {...goal.documentEdit, parentGoalId: original, baseRevision: 0}, documentEditState: {...goal.documentEditState, phase: 'saved', proposal: before, artifact: {revision: 1, pages: 1, documentId: goal.documentEdit.documentId}}};
    await page.evaluate(nextGoal => (window as any).showGoal(nextGoal), acceptedVersionOne);
    await page.getByRole('button', {name: 'Edit current brief', exact: true}).tap();
    await page.getByRole('group', {name: 'Clarify the intended change', exact: true}).waitFor();
    const change = page.getByRole('textbox', {name: 'Requested brief change', exact: true});
    await change.fill('Make this more cheerful'); await page.getByRole('button', {name: 'Save edit and propose changes', exact: true}).tap();
    await page.getByText('Which section and format should change? Choose them explicitly below. Your complete request is kept; no edit was submitted.', {exact: true}).waitFor();
    const kept = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), 'anascummis.research-brief-edit-draft.v1.' + parent);
    expect(kept.intent).toBe('Make this more cheerful'); expect(kept.submitted).toBeUndefined(); expect(creates).toBe(0);
    await page.getByRole('combobox', {name: 'Section to edit', exact: true}).selectOption('summary');
    await page.getByRole('combobox', {name: 'Requested format', exact: true}).selectOption('shorter-single-sentence');
    await change.fill(intent); await page.getByRole('button', {name: 'Close edit form', exact: true}).tap();
    await page.getByRole('button', {name: 'Continue edit draft', exact: true}).tap(); expect(await change.inputValue()).toBe(intent); expect(await page.getByRole('combobox', {name: 'Section to edit', exact: true}).inputValue()).toBe('summary'); expect(await page.getByRole('combobox', {name: 'Requested format', exact: true}).inputValue()).toBe('shorter-single-sentence'); expect(creates).toBe(0);
    await context.close();
  } finally {await browser?.close(); await server.stop(true); await rm(dir, {recursive: true, force: true});}
}, 30_000);
