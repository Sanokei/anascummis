import {expect, test} from 'bun:test';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from 'playwright-core';
import {BriefReviewText} from '../components/BriefReviewText';
import type {BriefDraft} from '../core/research-brief-types';

// Synthetic presentation/security/browser proof only. No native inference,
// source retrieval, document publication or application transport is claimed.
const repository = 'https://github.com/web-platform-tests/wpt';
const results = 'https://wpt.fyi/results/fetch';
const citations = [
  {number: 1, quote: 'Tests are in the `fetch/` directory of [`web-platform-tests/wpt`](' + repository + ').'},
  {number: 2, quote: 'A browser-results dashboard is at [wpt.fyi/results/fetch](' + results + ').'}
];
const draft: BriefDraft = {paragraphs: [{text: 'Tests: Tests are in the `fetch/` directory of [`web-platform-tests/wpt`](' + repository + '). Browser results: See [wpt.fyi/results/fetch](' + results + ').', citations: [1, 2]}]};

test('review rendering presents literal code/link labels without altering retained native text', () => {
  const before = JSON.stringify({draft, citations});
  const html = renderToStaticMarkup(createElement(BriefReviewText, {draft, citations}));
  expect(html).toContain('<code>fetch/</code>');
  expect(html).toContain('<code>web-platform-tests/wpt</code>');
  expect(html).not.toContain('`fetch/`'); expect(html).not.toContain('](');
  expect(html).toContain('href="' + repository + '"'); expect(html).toContain('href="' + results + '"');
  expect(html).toContain('aria-label="Citation 1 source"');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(JSON.stringify({draft, citations})).toBe(before);
});

test('private, credentialled, invented and malformed destinations remain inert even inside source text', () => {
  const unsafe = ['https://127.0.0.1/private', 'https://127.1/private', 'https://0x7f000001/private', 'https://[::1]/private', 'https://10.1.2.3/private', 'https://user:password@example.org/private', 'https://localhost/private', 'https://host.local/private', 'https://host.internal/private', 'https://example.org:8443/private', 'javascript:alert(1)'];
  const raw = unsafe.map((url, index) => '[untrusted-' + index + '](' + url + ')').join(' ') + ' <script>window.reviewExecuted=true</script> <img src="' + repository + '" onerror="window.reviewExecuted=true"> ![not an image](' + repository + ')';
  const html = renderToStaticMarkup(createElement(BriefReviewText, {draft: {paragraphs: [{text: raw, citations: [1, 2]}]}, citations: [{number: 1, quote: unsafe.join(' ')}, {number: 2, quote: 'No URL is available.'}]}));
  expect(html).not.toContain('<a'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('window.reviewExecuted=true');
  expect(html).toContain('[1]'); expect(html).toContain('[2]');
  const invented = renderToStaticMarkup(createElement(BriefReviewText, {draft: {paragraphs: [{text: '[new model target](https://invented.example.org/claim) and https://invented.example.org/claim', citations: []}]}, citations}));
  expect(invented).not.toContain('<a'); expect(invented).toContain('https://invented.example.org/claim');
  for (const text of ['`Unclosed code ' + results, '[unclosed link](' + results, '```block ' + results]) {
    const result = renderToStaticMarkup(createElement(BriefReviewText, {draft: {paragraphs: [{text, citations: []}]}, citations}));
    expect(result).not.toContain('<a'); expect(result).toContain(text);
  }
});

test('actual browser review text has readable links, inert raw HTML and deliberate keyboard navigation', async () => {
  await mkdir('.test-data', {recursive: true});
  const folder = await mkdtemp(resolve('.test-data/brief-review-text-'));
  const entry = join(folder, 'entry.tsx');
  await Bun.write(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{BriefReviewText}from ${JSON.stringify(resolve('components/BriefReviewText.tsx'))};const root=createRoot(document.getElementById('root'));window.reviewInput={draft:${JSON.stringify(draft)},citations:${JSON.stringify(citations)}};window.showReview=value=>root.render(<BriefReviewText {...value}/>);window.showReview(window.reviewInput);`);
  const built = await Bun.build({entrypoints: [entry], target: 'browser'});
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const bundle = await built.outputs[0].text();
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/bundle.js') return new Response(bundle, {headers: {'Content-Type': 'text/javascript'}});
    return new Response('<!doctype html><html><head><style>body{margin:16px;font:16px/1.5 sans-serif}#root{min-width:0}p{overflow-wrap:anywhere}a:focus-visible{outline:2px solid #075e86;outline-offset:2px}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium'});
    const context = await browser.newContext({viewport: {width: 360, height: 420}}), page = await context.newPage();
    const attemptedDestinations: string[] = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== server.url.origin) {attemptedDestinations.push(route.request().url()); return route.abort();}
      return route.continue();
    });
    await page.goto(server.url.href);
    const root = page.locator('#root'); await root.locator('a').first().waitFor();
    expect(await root.innerText()).toBe('Tests: Tests are in the fetch/ directory of web-platform-tests/wpt. Browser results: See wpt.fyi/results/fetch. [1] [2]');
    expect(await root.locator('code').allTextContents()).toEqual(['fetch/', 'web-platform-tests/wpt']);
    expect(await root.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))).toEqual([repository, results, repository, results]);
    expect(await root.locator('a').evaluateAll(nodes => nodes.every(node => node.getAttribute('target') === '_blank' && node.getAttribute('rel') === 'noopener noreferrer'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const first = root.locator('a').first(); await first.focus();
    expect(await first.evaluate(node => node === document.activeElement)).toBe(true);
    await page.keyboard.press('Tab'); expect(await root.locator('a').nth(1).evaluate(node => node === document.activeElement)).toBe(true);
    await first.focus(); const opened = context.waitForEvent('page'); await page.keyboard.press('Enter'); const source = await opened;
    for (let count = 0; count < 100 && !attemptedDestinations.length; count++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(attemptedDestinations).toEqual([repository]); await source.close();
    expect(await page.evaluate(() => JSON.stringify((window as any).reviewInput))).toBe(JSON.stringify({draft, citations}));
    const dangerous = '<script>window.reviewExecuted=true</script> [private](https://127.0.0.1/private) [new](https://invented.example.org/claim)';
    await page.evaluate((value) => (window as any).showReview(value), {draft: {paragraphs: [{text: dangerous, citations: [9]}]}, citations: [{number: 9, quote: 'An inert reference with https://127.0.0.1/private'}]});
    await root.getByText(dangerous + ' [9]', {exact: true}).waitFor();
    expect(await root.locator('script,img,iframe,a').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).reviewExecuted)).toBeUndefined();
    expect(attemptedDestinations).toEqual([repository]);
    await context.close();
  } finally {await browser?.close(); await server.stop(true); await rm(folder, {recursive: true, force: true});}
}, 30_000);
