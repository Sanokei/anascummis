import {test, expect} from 'bun:test';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import {chromium} from 'playwright-core';

function crc32(bytes: Uint8Array) {let crc = 0xffffffff; for (const byte of bytes) {crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));} return (crc ^ 0xffffffff) >>> 0;}
function png(red: number, green: number, blue: number) {
  function chunk(type: string, bytes: Buffer) {const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([length, name, bytes, checksum]);}
  const width = 600, height = 840, header = Buffer.alloc(13), rows = Buffer.alloc((width * 3 + 1) * height);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {const offset = y * (width * 3 + 1) + 1 + x * 3; rows[offset] = red; rows[offset + 1] = green; rows[offset + 2] = blue;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// Actual Chromium component checks with two distinct synthetic rendered PNGs.
// This does not establish PDF rendering, native inference or actual handset behavior.
test('PDF reader navigates all pages, keeps position, pans zoom and retries GET failures within narrow windows', async () => {
  await mkdir('.test-data', {recursive: true});
  const requestedOutput = process.env.PDF_PREVIEW_TEST_OUTPUT;
  const buildFolder = await mkdtemp(resolve('.test-data/pdf-preview-ui-'));
  const folder = requestedOutput ? resolve(requestedOutput) : buildFolder;
  await mkdir(folder, {recursive: true});
  const metadata = {id: 'synthetic-two-pages', name: 'Synthetic two-page rendering fixture.pdf', pages: 2, revision: 0};
  const entry = join(buildFolder, 'entry.tsx');
  await Bun.write(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PdfPreview}from ${JSON.stringify(resolve('components/PdfPreview.tsx'))};function App(){const[document,setDocument]=useState(${JSON.stringify(metadata)});window.setDocument=setDocument;return <div className="fixture" style={{height:'100dvh',boxSizing:'border-box',padding:12}}><PdfPreview document={document}/></div>}createRoot(document.getElementById('root')).render(<App/>);`);
  const built = await Bun.build({entrypoints: [entry], target: 'browser'});
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const bundle = await built.outputs[0].text(), css = await readFile('app/style.css', 'utf8');
  const images = [png(190, 60, 60), png(45, 90, 200)], requests: {method: string; url: string}[] = [];
  let failSecondPage = false, lateFailure: (() => void) | undefined, holdFirstPage = false;
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.includes('/render')) {
      requests.push({method: request.method, url: url.pathname + url.search});
      const page = Number(url.searchParams.get('page'));
      if (page === 1 && holdFirstPage) {holdFirstPage = false; await new Promise<void>(resolve => {lateFailure = resolve;}); return new Response('Late old-page failure', {status: 500});}
      if (page === 2 && failSecondPage) return new Response('Synthetic page error', {status: 500});
      return new Response(images[page - 1], {headers: {'Content-Type': 'image/png', 'Cache-Control': 'no-store'}});
    }
    if (url.pathname === '/bundle.js') return new Response(bundle, {headers: {'Content-Type': 'text/javascript'}});
    return new Response('<!doctype html><html><head><style>html,body{margin:0}' + css + '</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>', {headers: {'Content-Type': 'text/html'}});
  }});
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}}), page = await context.newPage();
    async function loaded(number: number) {await page.waitForFunction(number => {const image = document.querySelector('img[alt="PDF page ' + number + '"]') as HTMLImageElement | null; return image?.complete && image.naturalWidth === 600;}, number);}
    async function color() {return page.locator('.pdf-page-image').evaluate(image => {const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!; context.drawImage(image as HTMLImageElement, 0, 0); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);});}
    await page.goto(server.url.href); await loaded(1);
    expect(await color()).toEqual([190, 60, 60]);
    expect(await page.getByRole('button', {name: 'Previous PDF page', exact: true}).isDisabled()).toBe(true);
    await page.getByRole('button', {name: 'Next PDF page', exact: true}).focus(); await page.keyboard.press('Enter'); await loaded(2);
    expect(await color()).toEqual([45, 90, 200]);
    expect(await page.getByText('Page 2 of 2', {exact: true}).isVisible()).toBe(true);
    expect(await page.getByRole('button', {name: 'Next PDF page', exact: true}).isDisabled()).toBe(true);
    await page.getByRole('button', {name: 'Zoom in PDF', exact: true}).focus(); await page.keyboard.press('Enter');
    expect(await page.getByText('125%', {exact: true}).isVisible()).toBe(true);
    expect(await page.locator('.pdf-page-scroll').evaluate(element => element.scrollWidth > element.clientWidth + 50)).toBe(true);
    await page.reload(); await loaded(2);
    expect(await page.getByText('125%', {exact: true}).isVisible()).toBe(true);

    for (const height of [800, 420]) {
      await page.setViewportSize({width: 360, height});
      const layout = await page.locator('.pdf-preview').evaluate(element => {
        const toolbar = element.querySelector('.pdf-preview-toolbar')!.getBoundingClientRect(), middle = element.querySelector('.pdf-page-scroll')!.getBoundingClientRect();
        return {toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom, middleTop: middle.top, middleBottom: middle.bottom, middleHeight: middle.height, rootWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight};
      });
      expect(layout.middleTop).toBeGreaterThanOrEqual(layout.toolbarBottom);
      expect(layout.middleHeight).toBeGreaterThan(60);
      expect(layout.middleBottom).toBeLessThanOrEqual(height);
      expect(layout.rootWidth).toBeLessThanOrEqual(360);
      for (const control of await page.locator('.pdf-preview-toolbar button').all()) {
        const bounds = await control.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
        if (!(await control.isDisabled())) {await control.focus(); expect(await control.evaluate(element => document.activeElement === element)).toBe(true);}
      }
      await page.locator('.pdf-page-scroll').evaluate(element => {element.scrollLeft = 50; element.scrollTop = 60;});
      expect(await page.locator('.pdf-page-scroll').evaluate(element => element.scrollLeft > 0)).toBe(true);
      await page.screenshot({path: join(folder, 'synthetic-pdf-360x' + height + '.png')});
    }
    await page.getByRole('button', {name: 'Fit PDF width', exact: true}).click();
    expect(await page.getByText('100%', {exact: true}).isVisible()).toBe(true);
    expect(await page.locator('.pdf-page-scroll').evaluate(element => element.scrollLeft)).toBe(0);
    await page.evaluate(metadata => (window as any).setDocument({...metadata, pages: 1, revision: 2}), metadata); await loaded(1);
    await page.getByText('Page 1 of 1', {exact: true}).waitFor();
    expect(await page.locator('.pdf-page-image').getAttribute('src')).toContain('revision=2');
    expect(await page.getByRole('button', {name: 'Next PDF page', exact: true}).isDisabled()).toBe(true);

    await page.evaluate(metadata => (window as any).setDocument({...metadata, revision: 3}), metadata); await loaded(1);
    failSecondPage = true;
    await page.getByRole('button', {name: 'Next PDF page', exact: true}).click();
    await page.getByRole('button', {name: 'Retry PDF page', exact: true}).waitFor();
    expect(await page.getByText('Page 2 of 2', {exact: true}).isVisible()).toBe(true);
    const retryBounds = await page.getByRole('button', {name: 'Retry PDF page', exact: true}).boundingBox();
    expect(retryBounds!.height).toBeGreaterThanOrEqual(44);
    expect(retryBounds!.y + retryBounds!.height).toBeLessThanOrEqual(420);
    expect(await page.locator('.pdf-page-scroll').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.screenshot({path: join(folder, 'synthetic-pdf-error-360x420.png')});
    failSecondPage = false;
    await page.getByRole('button', {name: 'Retry PDF page', exact: true}).click(); await loaded(2);
    expect(await color()).toEqual([45, 90, 200]);
    expect(requests.at(-1)?.url).toContain('retry=1');
    holdFirstPage = true;
    const oldRequest = page.waitForRequest(request => request.url().includes('/render?page=1&revision=3'));
    await page.getByRole('button', {name: 'Previous PDF page', exact: true}).click(); await oldRequest;
    await page.getByRole('button', {name: 'Next PDF page', exact: true}).click(); await loaded(2); lateFailure?.();
    await page.waitForFunction(() => document.querySelector('.pdf-page-image')?.getAttribute('alt') === 'PDF page 2');
    expect(await page.getByRole('button', {name: 'Retry PDF page', exact: true}).count()).toBe(0);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    await context.close();

    const blockedStorage = await browser.newContext({viewport: {width: 360, height: 420}});
    await blockedStorage.addInitScript(() => {Storage.prototype.getItem = () => {throw new Error('blocked');}; Storage.prototype.setItem = () => {throw new Error('blocked');};});
    const fallback = await blockedStorage.newPage(); await fallback.goto(server.url.href);
    await fallback.waitForFunction(() => (document.querySelector('img[alt="PDF page 1"]') as HTMLImageElement | null)?.naturalWidth === 600);
    await fallback.getByRole('button', {name: 'Next PDF page', exact: true}).click();
    await fallback.waitForFunction(() => (document.querySelector('img[alt="PDF page 2"]') as HTMLImageElement | null)?.naturalWidth === 600);
    expect(await fallback.getByText('Reading still works.', {exact: false}).isVisible()).toBe(true);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    await blockedStorage.close();
  } finally {lateFailure?.(); await browser?.close(); await server.stop(true); await rm(buildFolder, {recursive: true, force: true});}
}, 60_000);
