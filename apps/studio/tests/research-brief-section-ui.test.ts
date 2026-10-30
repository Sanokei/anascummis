import {expect, test} from 'bun:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Browser/transport fixtures prove clarification, exact identity and review UI.
// Genuine local-model meaning, artifacts and restart are separate user journeys.
test('an ambiguous section edit preserves explicit paragraph choices, uncertain delivery and an honest native review', async () => {
  await mkdir('.test-data', {recursive: true}); const dir = await mkdtemp(resolve('.test-data/section-edit-ui-'));
  const parentId = '99d141c6-f66a-46b4-b199-ab0ad6164619', childId = '7f8e8b30-736e-45a3-915b-233e63fb6a61', originalId = '5ad3cbfc-47f4-459c-8b79-b33df66eeb38';
  const documentId = 'b80e6064-17ba-4883-8ed7-662de9230d16', operationId = '5a82a107-a9f4-4493-9c6b-4983b81ddeec';
  const intent = 'Make this clearer for a newcomer';
  const introduction = 'These are my personal plans, not source-backed claims.';
  const before = 'Before changing anything, I will record the browser and version, a minimal public example, the outcome I expected and what I actually saw. I will remove cookies, authorization headers, account details and private URLs from anything I share.';
  const proposed = 'Before I make changes, I will note the browser and its version, a small public example, what I expected to happen and what I actually observed. Before sharing anything, I will remove cookies, authorization headers, account details and private URLs.';
  const tail = 'I will keep this separate final note unchanged.', notes = introduction + '\n\n' + before + '\n\n' + tail;
  const start = introduction.length + 2, end = start + before.length, paragraphSha256 = 'b'.repeat(64), proposalSha256 = 'c'.repeat(64);
  const target = {section: 'notes', paragraph: 1, paragraphSha256, format: 'clearer-plain-paragraph'};
  const summary = {paragraphs: [{text: 'Fetch tests are in `fetch/`, with browser results at https://wpt.fyi/results/fetch.', citations: [1, 2]}]};
  const citations = [{number: 1, quote: 'Tests are in [web-platform-tests/wpt](https://github.com/web-platform-tests/wpt).'}, {number: 2, quote: 'Results are at https://wpt.fyi/results/fetch.'}];
  const parent: any = {id: parentId, status: 'completed', tasks: [], request: 'Earlier summary request', briefEditEligibility: {canEdit: true},
    documentEdit: {parentGoalId: originalId, intent: 'Earlier summary request', requestKey: originalId, documentId, baseRevision: 1, basePdfSha256: 'a'.repeat(64)},
    documentEditState: {operationId: originalId, phase: 'saved', before: summary, proposal: summary, preserved: {title: 'Fetch contributor brief', notes, citations}, artifact: {documentId, revision: 2, pages: 1}},
    documentEditOptions: {baseRevision: 2, notesSha256: 'd'.repeat(64), paragraphs: [
      {index: 0, start: 0, end: introduction.length, text: introduction, sha256: 'e'.repeat(64)},
      {index: 1, start, end, text: before, sha256: paragraphSha256},
      {index: 2, start: end + 2, end: notes.length, text: tail, sha256: 'f'.repeat(64)}]}};
  let child: any, creates = 0, applies = 0, gets = 0;
  function makeChild(submission: any) {return {id: childId, parentGoalId: parentId, request: submission.intent, status: 'needs_input', tasks: [],
    documentEdit: {...submission, parentGoalId: parentId, originalBriefGoalId: originalId, documentId, baseRevision: 2, basePdfSha256: 'a'.repeat(64)},
    documentEditState: {operationId, goalId: childId, inputSha256: '1'.repeat(64), phase: 'awaiting_approval', before: summary, proposal: summary, proposalSha256,
      writingMode: 'note-paragraph-rewrite-v5', writingAttempt: {raw: {text: proposed}, sha256: '2'.repeat(64), format: 'native-note-paragraph-v1'},
      notesEdit: {before, start, end, notesSha256: 'd'.repeat(64), paragraphSha256, proposal: proposed, proposedNotes: introduction + '\n\n' + proposed + '\n\n' + tail, proposedNotesSha256: '3'.repeat(64)},
      preserved: {title: 'Fetch contributor brief', notes, citations}, draftCheck: {accepted: true, reason: 'Injected exact-replacement fixture.'},
      supportReview: {supported: true, meaningRetained: true, plannedActionsRetained: true, noCompletedWorkInvented: true, clearerForNewcomer: true, reason: 'Injected review fixture only, not native quality.'}}};}
  const entry = join(dir, 'entry.tsx');
  await Bun.write(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchBriefEdit}from ${JSON.stringify(resolve('components/ResearchBriefEdit.tsx'))};const root=createRoot(document.getElementById('root'));window.showGoal=g=>root.render(<ResearchBriefEdit key={g.id} goal={g} onCreated={next=>{window.lastCreated=next;if(location.search)window.showGoal(next);}} onOpenDocument={()=>{}}/>);if(location.search)fetch('/api/goals/${childId}').then(r=>r.json()).then(window.showGoal);else window.showGoal(${JSON.stringify(parent)});`);
  const bundle = await Bun.build({entrypoints: [entry], target: 'browser'}); if (!bundle.success) throw new Error(bundle.logs.map(String).join('\n'));
  const js = await bundle.outputs[0].text(), css = await Bun.file('app/style.css').text();
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/document-edit/apply') && request.method === 'POST') {applies++; expect(await request.json()).toEqual({operationId, proposalSha256}); child = {...child, status: 'queued', documentEditState: {...child.documentEditState, phase: 'approved', approvedProposalSha256: proposalSha256}}; return Response.json(child);}
    if (path.endsWith('/document-edit') && request.method === 'POST') {creates++; const submission: any = await request.json(); expect(submission.intent).toBe(intent); expect(submission.target).toEqual(target); expect(submission.sentenceLabels).toBeUndefined(); child = makeChild(submission); return Response.json(child);}
    if (path === '/api/goals') {gets++; return Response.json(child ? [parent, child] : [parent]);}
    if (path.startsWith('/api/goals/')) {gets++; return Response.json(child);}
    if (path === '/bundle.js') return new Response(js, {headers: {'Content-Type': 'text/javascript'}});
    if (path === '/style.css') return new Response(css, {headers: {'Content-Type': 'text/css'}});
    return new Response('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#eef4f8}.goal-panel{box-sizing:border-box;position:absolute;left:16px;top:72px;width:min(400px,calc(100vw - 32px));height:min(440px,calc(100vh - 96px));overflow:auto;padding:12px;background:#fff;font:12px sans-serif}</style></head><body><div id="root" class="goal-panel"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium'});
    const context = await browser.newContext({viewport: {width: 360, height: 420}, hasTouch: true, reducedMotion: 'reduce'}), page = await context.newPage(); await context.route('https://**/*', route => route.abort()); await page.goto(server.url.href);
    await page.getByRole('button', {name: 'Edit current brief', exact: true}).tap(); const change = page.getByRole('textbox', {name: 'Requested brief change', exact: true}); await change.fill(intent);
    const section = page.getByRole('combobox', {name: 'Section to edit', exact: true}), format = page.getByRole('combobox', {name: 'Requested format', exact: true}), save = page.getByRole('button', {name: 'Save edit and propose changes', exact: true});
    expect(await section.inputValue()).toBe(''); expect(await format.inputValue()).toBe(''); expect(await format.isDisabled()).toBe(true); expect(await page.getByRole('combobox', {name: 'Personal-note paragraph', exact: true}).count()).toBe(0);
    await save.tap(); await page.getByText('Which section and format should change? Choose them explicitly below. Your complete request is kept; no edit was submitted.', {exact: true}).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Section to edit'); expect(await section.evaluate(element => element === document.activeElement)).toBe(true); expect(creates).toBe(0); expect(applies).toBe(0);
    await page.reload(); expect(await change.inputValue()).toBe(intent); expect(await section.inputValue()).toBe(''); expect(await format.inputValue()).toBe(''); expect(creates).toBe(0);
    await section.selectOption('notes'); const paragraph = page.getByRole('combobox', {name: 'Personal-note paragraph', exact: true}); expect(await paragraph.inputValue()).toBe(''); expect(await format.inputValue()).toBe('');
    await save.tap(); await page.getByText('Which exact personal-note paragraph should change? Choose the paragraph and requested format. Your complete request is kept; no edit was submitted.', {exact: true}).waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Personal-note paragraph'); expect(await paragraph.evaluate(element => element === document.activeElement)).toBe(true); expect(creates).toBe(0);
    await paragraph.selectOption('1'); expect(await page.getByRole('region', {name: 'Selected personal-note paragraph', exact: true}).innerText()).toContain(before); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await save.tap(); await page.getByText('Which section and format should change? Choose them explicitly below. Your complete request is kept; no edit was submitted.', {exact: true}).waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Requested format'); expect(await format.evaluate(element => element === document.activeElement)).toBe(true); expect(creates).toBe(0);
    await format.selectOption('clearer-plain-paragraph'); await page.getByRole('button', {name: 'Close edit form', exact: true}).tap(); await page.reload();
    expect(await change.inputValue()).toBe(intent); expect(await section.inputValue()).toBe('notes'); expect(await paragraph.inputValue()).toBe('1'); expect(await format.inputValue()).toBe('clearer-plain-paragraph');
    const draftKey = 'anascummis.research-brief-edit-draft.v1.' + parentId; const clarified = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), draftKey); expect(clarified.intent).toBe(intent); expect(clarified.target).toEqual(target); expect(clarified.submitted).toBeUndefined();
    await change.fill('Rewrite the summary for a newcomer'); await save.tap();
    const mismatch = page.getByText('The original request explicitly asks to change the summary, while the selected section is Personal notes. Clarify the intended section before saving. The complete request and current choices are kept; nothing was submitted.', {exact: true}); await mismatch.waitFor();
    await page.waitForFunction(() => document.activeElement?.id.startsWith('brief-edit-clarification-')); expect(await mismatch.evaluate(element => element === document.activeElement)).toBe(true); expect(creates).toBe(0); expect(await change.inputValue()).toBe('Rewrite the summary for a newcomer'); expect(await section.inputValue()).toBe('notes'); expect(await paragraph.inputValue()).toBe('1'); expect(await format.inputValue()).toBe('clearer-plain-paragraph');
    const mismatchedDraft = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), draftKey); expect(mismatchedDraft.intent).toBe('Rewrite the summary for a newcomer'); expect(mismatchedDraft.target).toEqual(target); expect(mismatchedDraft.submitted).toBeUndefined();
    await change.fill('Make this clearer for a newcomer; keep notes unchanged'); await save.tap();
    await page.getByText('The original request explicitly preserves personal notes unchanged, while that section is selected for rewriting. Clarify the intended section before saving. The complete request and current choices are kept; nothing was submitted.', {exact: true}).waitFor(); expect(creates).toBe(0); expect(await change.inputValue()).toBe('Make this clearer for a newcomer; keep notes unchanged'); expect(await paragraph.inputValue()).toBe('1');
    await change.fill(intent); await mismatch.waitFor({state: 'hidden'});
    for (const control of [section, paragraph, format]) {await control.scrollIntoViewIfNeeded(); await control.focus(); const layout = await control.evaluate(element => {const b = element.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return {x: b.x, right: b.right, width: b.width, height: b.height, hit: hit === element || element.contains(hit), focused: document.activeElement === element};}); expect(layout.x).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(360); expect(layout.height).toBeGreaterThanOrEqual(44); expect(layout.width).toBeGreaterThanOrEqual(44); expect(layout.hit).toBe(true); expect(layout.focused).toBe(true);}
    await page.route('**/api/goals/*/document-edit', async route => {await route.fetch(); await route.abort('failed');}, {times: 1}); await save.tap(); await page.getByText('Edit submission was not confirmed.', {exact: false}).waitFor(); expect(creates).toBe(1); await page.reload();
    await page.getByRole('button', {name: 'Inspect saved edits', exact: true}).waitFor(); expect(creates).toBe(1);
    await change.fill('A newer unsent wording'); await section.selectOption('summary'); expect(await format.inputValue()).toBe('');
    await page.getByRole('button', {name: 'Inspect saved edits', exact: true}).tap(); await page.waitForFunction(() => !!(window as any).lastCreated); expect(creates).toBe(1);
    const kept = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), draftKey); expect(kept.intent).toBe('A newer unsent wording'); expect(kept.targetDraft).toEqual({section: 'summary'}); expect(kept.target).toBeUndefined(); expect(kept.submitted).toBeUndefined();
    expect(await page.evaluate(() => (window as any).lastCreated.documentEdit.intent)).toBe(intent); expect(await page.evaluate(() => (window as any).lastCreated.documentEdit.target)).toEqual(target);

    await page.setViewportSize({width: 1440, height: 1000}); await page.goto(server.url.href + '?child=1'); const trigger = page.getByRole('button', {name: 'Review proposed change', exact: true}); await trigger.click();
    const dialog = page.getByRole('dialog', {name: 'Review personal-note edit', exact: true}); await dialog.waitFor(); const box = await dialog.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(800); expect(box!.width).toBeLessThanOrEqual(1000);
    expect(await dialog.innerText()).toContain('Version 2 → proposed version 3 · Changed section: Personal notes · paragraph 2'); expect(await dialog.innerText()).toContain('The summary, title, every other note paragraph and citation evidence stay unchanged.');
    const old = dialog.getByRole('region', {name: 'Before personal-note paragraph', exact: true}), next = dialog.getByRole('region', {name: 'Proposed personal-note paragraph', exact: true}); expect(await old.innerText()).toContain(before); expect(await next.innerText()).toContain(proposed);
    const oldBox = await old.boundingBox(), nextBox = await next.boundingBox(); expect(nextBox!.x).toBeGreaterThan(oldBox!.x + oldBox!.width);
    await mkdir('/workspace/.cloud-env/anascummis/section-edit/ui-preflight', {recursive: true}); await page.screenshot({path: '/workspace/.cloud-env/anascummis/section-edit/ui-preflight/fixture-note-desktop-review.png'});
    await dialog.getByText('Exact raw paragraph comparison and evidence', {exact: true}).click(); expect(JSON.parse(await dialog.getByLabel('Raw before personal-note paragraph JSON', {exact: true}).innerText())).toBe(before); expect(JSON.parse(await dialog.getByLabel('Raw proposed personal-note paragraph JSON', {exact: true}).innerText())).toBe(proposed);
    expect(JSON.parse(await dialog.getByLabel('Exact personal-note paragraph diff JSON', {exact: true}).innerText())).toEqual({start, end, removed: before, added: proposed}); expect(JSON.parse(await dialog.getByLabel('Raw native edit decision JSON', {exact: true}).innerText())).toEqual({text: proposed});
    await dialog.getByText('Unchanged summary and citation evidence', {exact: true}).click(); expect(JSON.parse(await dialog.getByLabel('Unchanged factual summary JSON', {exact: true}).innerText())).toEqual(summary);
    const cancel = dialog.getByRole('button', {name: 'Cancel review', exact: true}); await cancel.focus(); await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'}); expect(await trigger.evaluate(element => element === document.activeElement)).toBe(true); expect(applies).toBe(0);
    await page.setViewportSize({width: 360, height: 420}); await trigger.tap(); await dialog.waitFor(); const stackedOld = await old.boundingBox(), stackedNext = await next.boundingBox(); expect(stackedNext!.y).toBeGreaterThan(stackedOld!.y + stackedOld!.height);
    const apply = dialog.getByRole('button', {name: 'Apply proposed edit', exact: true});
    await page.screenshot({path: '/workspace/.cloud-env/anascummis/section-edit/ui-preflight/fixture-note-short-review.png'});
    for (const control of [apply, cancel]) {await control.focus(); const layout = await control.evaluate(element => {const b = element.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return {x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height, hit: hit === element || element.contains(hit), focused: document.activeElement === element};}); expect(layout.x).toBeGreaterThanOrEqual(0); expect(layout.y).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(360); expect(layout.bottom).toBeLessThanOrEqual(420); expect(layout.height).toBeGreaterThanOrEqual(44); expect(layout.width).toBeGreaterThanOrEqual(44); expect(layout.hit).toBe(true); expect(layout.focused).toBe(true);}
    await cancel.tap(); await dialog.waitFor({state: 'hidden'}); expect(applies).toBe(0); await trigger.tap();
    await page.route('**/api/goals/*/document-edit/apply', async route => {await route.fetch(); await route.abort('failed');}, {times: 1}); await apply.tap(); const inspect = dialog.getByRole('button', {name: 'Inspect saved edit', exact: true}); await inspect.waitFor(); expect(applies).toBe(1);
    await inspect.tap(); await dialog.getByText('Your exact proposal approval is saved.', {exact: false}).waitFor(); expect(applies).toBe(1); expect(gets).toBeGreaterThan(1); expect(await dialog.getByRole('button', {name: 'Apply proposed edit', exact: true}).count()).toBe(0); await cancel.tap(); await page.reload(); await trigger.waitFor(); await page.getByText('Your approval is saved', {exact: true}).waitFor(); expect(applies).toBe(1); expect(creates).toBe(1);
    const rejected = {...child, status: 'needs_input', documentEditState: {...child.documentEditState, phase: 'awaiting_approval', approvedProposalSha256: undefined, supportReview: {...child.documentEditState.supportReview, supported: true, noCompletedWorkInvented: false, reason: 'The candidate invents completed work.'}, notesEdit: {...child.documentEditState.notesEdit, proposal: '<script>window.noteExecuted=true</script> I already completed the investigation.'}}};
    await page.evaluate(value => (window as any).showGoal(value), rejected); await page.getByText('Native note review needs attention: The candidate invents completed work.', {exact: true}).waitFor(); await trigger.tap(); await dialog.waitFor(); await dialog.getByText('Native meaning and planned-action review', {exact: true}).click(); expect(await dialog.innerText()).toContain('The native role rejected this proposal.'); expect(await dialog.innerText()).not.toContain('The native role accepted this proposal.'); expect(await dialog.getByRole('button', {name: 'Apply proposed edit', exact: true}).count()).toBe(0); expect(await next.innerText()).toContain('<script>window.noteExecuted=true</script>'); expect(await page.evaluate(() => (window as any).noteExecuted)).toBeUndefined(); expect(applies).toBe(1);
    await context.close();
  } finally {await browser?.close(); await server.stop(true); await rm(dir, {recursive: true, force: true});}
}, 45_000);

test('an original brief offers explicit paragraph selection and clarifies an ambiguous request before any submission', async () => {
  await mkdir('.test-data', {recursive: true}); const dir = await mkdtemp(resolve('.test-data/section-edit-original-ui-'));
  const id = 'a8bd0490-ddaa-45e6-8331-79094960e8fe', intent = 'Make this clearer for a newcomer';
  const before = 'Before changing anything, I will record the browser and version. I will remove private URLs before sharing.';
  const notes = 'My personal plans.\n\n' + before, paragraphSha256 = 'a'.repeat(64);
  const goal = {id, request: 'Original research', status: 'completed', tasks: [], briefEditEligibility: {canEdit: true},
    brief: {title: 'Original contributor brief', notes}, briefState: {artifact: {documentId: '9c0c8781-7bab-43dd-8075-29d19882eff3'}},
    documentEditOptions: {baseRevision: 0, notesSha256: 'b'.repeat(64), paragraphs: [
      {index: 0, start: 0, end: 18, text: 'My personal plans.', sha256: 'c'.repeat(64)},
      {index: 1, start: 20, end: notes.length, text: before, sha256: paragraphSha256}]}};
  const entry = join(dir, 'entry.tsx'); await Bun.write(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchBriefEdit}from ${JSON.stringify(resolve('components/ResearchBriefEdit.tsx'))};createRoot(document.getElementById('root')).render(<ResearchBriefEdit goal={${JSON.stringify(goal)}} onCreated={()=>{}} onOpenDocument={()=>{}}/>);`);
  const built = await Bun.build({entrypoints: [entry], target: 'browser'}); if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const js = await built.outputs[0].text(), css = await Bun.file('app/style.css').text(); let posts = 0;
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST') {posts++; return Response.json({error: 'No submission belongs in this clarification fixture'}, {status: 400});}
    if (path === '/bundle.js') return new Response(js, {headers: {'Content-Type': 'text/javascript'}});
    if (path === '/style.css') return new Response(css, {headers: {'Content-Type': 'text/css'}});
    return new Response('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0}.goal-panel{box-sizing:border-box;width:100%;padding:12px;font:14px sans-serif}</style></head><body><div id="root" class="goal-panel"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium'});
    const entryContext = await browser.newContext({viewport: {width: 360, height: 420}, hasTouch: true}), entryPage = await entryContext.newPage();
    await entryPage.goto(server.url.href); await entryPage.getByRole('button', {name: 'Edit brief', exact: true}).tap();
    await entryPage.getByRole('button', {name: 'Choose section or paragraph', exact: true}).tap();
    const entrySection = entryPage.getByRole('combobox', {name: 'Section to edit', exact: true}); await entrySection.waitFor(); await entryPage.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Section to edit'); expect(await entrySection.inputValue()).toBe(''); expect(posts).toBe(0); await entryContext.close();

    const context = await browser.newContext({viewport: {width: 360, height: 420}, hasTouch: true}), page = await context.newPage(); await page.goto(server.url.href);
    await page.getByRole('button', {name: 'Edit brief', exact: true}).tap(); const request = page.getByRole('textbox', {name: 'Requested brief change', exact: true}); await request.fill(intent);
    expect(await page.getByRole('combobox', {name: 'Section to edit', exact: true}).count()).toBe(0); expect(await page.getByRole('checkbox', {name: 'Two labelled sentences', exact: true}).isChecked()).toBe(false);
    await page.getByRole('button', {name: 'Save edit and propose changes', exact: true}).tap();
    await page.getByText('Which section and format should change? Choose them explicitly below. Your complete request is kept; no edit was submitted.', {exact: true}).waitFor();
    const section = page.getByRole('combobox', {name: 'Section to edit', exact: true}), format = page.getByRole('combobox', {name: 'Requested format', exact: true}); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Section to edit');
    expect(posts).toBe(0); expect(await request.inputValue()).toBe(intent); expect(await section.inputValue()).toBe(''); expect(await format.inputValue()).toBe('');
    const key = 'anascummis.research-brief-edit-draft.v1.' + id, clarified = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key); expect(clarified.intent).toBe(intent); expect(clarified.targetDraft).toEqual({}); expect(clarified.target).toBeUndefined(); expect(clarified.submitted).toBeUndefined();
    await page.getByRole('button', {name: 'Close edit form', exact: true}).tap(); await page.reload(); expect(await request.inputValue()).toBe(intent); expect(await section.inputValue()).toBe(''); expect(await format.inputValue()).toBe(''); expect(posts).toBe(0);
    await section.selectOption('notes'); const paragraph = page.getByRole('combobox', {name: 'Personal-note paragraph', exact: true}); expect(await paragraph.inputValue()).toBe(''); await paragraph.selectOption('1'); await format.selectOption('clearer-plain-paragraph'); expect(await page.getByRole('region', {name: 'Selected personal-note paragraph', exact: true}).innerText()).toContain(before);
    await page.reload(); expect(await request.inputValue()).toBe(intent); expect(await section.inputValue()).toBe('notes'); expect(await paragraph.inputValue()).toBe('1'); expect(await format.inputValue()).toBe('clearer-plain-paragraph'); expect(posts).toBe(0);
    const chosen = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key); expect(chosen.target).toEqual({section: 'notes', paragraph: 1, paragraphSha256, format: 'clearer-plain-paragraph'}); expect(chosen.submitted).toBeUndefined(); await context.close();
  } finally {await browser?.close(); await server.stop(true); await rm(dir, {recursive: true, force: true});}
}, 30_000);
