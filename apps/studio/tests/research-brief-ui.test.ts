import {test, expect} from 'bun:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Synthetic component/transport checks, not native inference or document output proof.
test('brief UI keeps drafts and uncertain submissions without replaying them', async () => {
  await mkdir('.test-data', {recursive: true});
  const folder = await mkdtemp(resolve('.test-data/research-brief-ui-'));
  const parent = {id: '829c3521-8b12-4149-9a6d-321234567890', request: 'Where are the Fetch tests and browser results?',
    status: 'completed', sourceQuestion: {urls: ['https://raw.githubusercontent.com/whatwg/fetch/main/README.md']},
    tasks: [{id: 'source-answer', sourceAnswer: true, status: 'verified', review: {accepted: true}, execution: {sourceAnswer: {answerable: true, supportReview: {supported: true}}}}]};
  const entry = join(folder, 'entry.tsx');
  await Bun.write(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchBrief}from ${JSON.stringify(resolve('components/ResearchBrief.tsx'))};const goal=${JSON.stringify(parent)},root=createRoot(document.getElementById('root'));window.showBrief=next=>root.render(<ResearchBrief goal={next} onCreated={child=>{window.lastCreated=child;}} onOpenDocument={id=>{window.lastOpened=id;}}/>);window.showBrief(goal);`);
  const built = await Bun.build({entrypoints: [entry], target: 'browser', minify: false});
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const bundle = await built.outputs[0].text();
  let posts = 0, gets = 0;
  const children: any[] = [];
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/brief') && request.method === 'POST') {
      posts++; const input = await request.json();
      const child = {...parent, id: crypto.randomUUID(), parentGoalId: parent.id, status: 'queued', brief: {...input, parentGoalId: parent.id}};
      children.push(child); return Response.json(child);
    }
    if (url.pathname === '/api/goals') {gets++; return Response.json(children);}
    if (url.pathname === '/bundle.js') return new Response(bundle, {headers: {'Content-Type': 'text/javascript'}});
    return new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(server.url.href);
    await page.getByRole('button', {name: 'Create research brief', exact: true}).click();
    await page.getByLabel('Brief title', {exact: true}).fill('Exact local heading');
    await page.getByLabel('Your notes for the brief', {exact: true}).fill('Literal <notes> & café\nKeep this line.');
    await page.reload();
    expect(await page.getByLabel('Brief title', {exact: true}).inputValue()).toBe('Exact local heading');
    expect(await page.getByLabel('Your notes for the brief', {exact: true}).inputValue()).toBe('Literal <notes> & café\nKeep this line.');
    expect(posts).toBe(0);

    await page.route('**/api/goals/*/brief', async route => {await route.fetch(); await route.abort('failed');});
    await page.getByRole('button', {name: 'Save and write brief', exact: true}).click();
    await page.getByRole('button', {name: 'Inspect saved briefs', exact: true}).waitFor();
    await page.waitForFunction(() => document.body.innerText.includes('Submission was not confirmed.'));
    expect(posts).toBe(1);
    await page.reload();
    await page.getByRole('button', {name: 'Inspect saved briefs', exact: true}).waitFor();
    expect(posts).toBe(1);
    await page.getByRole('button', {name: 'Inspect saved briefs', exact: true}).click();
    await page.waitForFunction(() => !!(window as any).lastCreated);
    expect(posts).toBe(1); expect(gets).toBe(1);
    expect(await page.evaluate(() => (window as any).lastCreated.brief.notes)).toBe('Literal <notes> & café\nKeep this line.');

    // A later success may acknowledge only the submitted snapshot, not newer edits.
    await page.unroute('**/api/goals/*/brief');
    await page.getByRole('button', {name: 'Create research brief', exact: true}).click();
    await page.getByLabel('Brief title', {exact: true}).fill('Actually submitted');
    await page.getByLabel('Your notes for the brief', {exact: true}).fill('First note');
    let release!: () => void;
    const held = new Promise<void>(resolve => {release = resolve;});
    await page.route('**/api/goals/*/brief', async route => {const response = await route.fetch(); await held; await route.fulfill({response});});
    await page.getByRole('button', {name: 'Save and write brief', exact: true}).click();
    await page.waitForFunction(() => document.body.innerText.includes('Saving the exact title'));
    await page.getByLabel('Brief title', {exact: true}).fill('Newer unsent heading');
    await page.getByLabel('Your notes for the brief', {exact: true}).fill('Newer unsent note');
    release();
    await page.waitForFunction(() => document.body.innerText.includes('Your newer title or notes remain'));
    await page.reload();
    expect(await page.getByLabel('Brief title', {exact: true}).inputValue()).toBe('Newer unsent heading');
    expect(await page.getByLabel('Your notes for the brief', {exact: true}).inputValue()).toBe('Newer unsent note');
    expect(await page.getByRole('button', {name: 'Inspect saved briefs', exact: true}).count()).toBe(0);
    expect(posts).toBe(2);
    await page.evaluate((parent) => (window as any).showBrief({...parent, id: 'f725b77e-e7ce-44a6-aafe-a1dd734f6f5a',
      brief: {parentGoalId: parent.id, requestKey: '4f5688b1-8192-498f-9f19-c88c98e6268c', title: 'Saved brief', notes: '<script>literal note</script>'},
      briefState: {phase: 'saved', draft: {paragraphs: [{text: 'One cited fact', citations: [1]}]}, artifact: {documentId: 'owned-document', pages: 2}}}), parent);
    await page.getByRole('button', {name: 'Open brief PDF', exact: true}).click();
    expect(await page.evaluate(() => (window as any).lastOpened)).toBe('owned-document');
    expect(await page.getByRole('link', {name: 'Download brief PDF', exact: true}).getAttribute('href')).toBe('/api/goals/f725b77e-e7ce-44a6-aafe-a1dd734f6f5a/brief/export?format=pdf');
    await page.getByText('Saved native writing and support review', {exact: true}).click();
    expect(await page.getByText('One cited fact [1]', {exact: true}).isVisible()).toBe(true);
    expect(posts).toBe(2);
    await context.close();

    const unavailable = await browser.newContext();
    await unavailable.addInitScript(() => {Storage.prototype.setItem = () => {throw new Error('storage blocked');};});
    const unavailablePage = await unavailable.newPage();
    await unavailablePage.goto(server.url.href);
    await unavailablePage.getByRole('button', {name: 'Create research brief', exact: true}).click();
    expect(await unavailablePage.getByText('This browser could not save the draft.', {exact: false}).isVisible()).toBe(true);
    expect(posts).toBe(2);
    await unavailable.close();
  } finally {await browser?.close(); await server.stop(true); await rm(folder, {recursive: true, force: true});}
}, 60_000);
