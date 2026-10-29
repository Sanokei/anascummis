import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';
import {writeFile, readFile} from 'node:fs/promises';
const [url, screenshot, report, contractPath] = process.argv.slice(2), parsed = new URL(url);
if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('QA only supports this local application');
const executable = process.env.STUDIO_BROWSER_EXE || process.env.STUDIO_CHROME || [
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
if (!executable || !existsSync(executable)) throw new Error('Set STUDIO_BROWSER_EXE to an installed Chromium, Chrome or Edge executable for actual browser QA');
const browser = await chromium.launch({executablePath: executable, headless: true, timeout: 45000});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 800}}), errors = [];
  page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, {waitUntil: 'networkidle', timeout: 30000});
  let behavior = '';
  const contract = contractPath ? await readFile(contractPath, 'utf8').then(JSON.parse).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw new Error('The host browser contract is unreadable or invalid: ' + error.message);
  }) : null;
  if (contract && (!['counter', 'counter_absent'].includes(contract.kind) || typeof contract.label !== 'string' || !contract.label.trim() || typeof contract.button !== 'string' || !contract.button.trim())) throw new Error('Unsupported host browser contract');
  if (contract?.heading !== undefined && (typeof contract.heading !== 'string' || !contract.heading.trim() || contract.heading.length > 80)) throw new Error('Invalid literal heading browser contract');
  if (contract?.resetButton !== undefined && (typeof contract.resetButton !== 'string' || !contract.resetButton.trim() || contract.resetButton.length > 60 || contract.resetButton === contract.button)) throw new Error('Invalid Reset browser contract');
  async function textEquals(locator, expected, failure) {
    const deadline = Date.now() + 5000;
    let actual = '';
    do {
      actual = (await locator.innerText()).trim();
      if (actual === expected) return;
      await page.waitForTimeout(50);
    } while (Date.now() < deadline);
    throw new Error(failure + '; observed ' + JSON.stringify(actual));
  }
  try {
    if (contract?.heading !== undefined) {
      const heading = page.getByRole('heading', {level: 1});
      await textEquals(heading, contract.heading, 'The actual application heading does not match the requested literal');
    }
    if (contract?.kind === 'counter') {
      const initial = contract.initial ?? 0, delta = contract.delta ?? 1;
      if (![initial, delta].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000)) throw new Error('Counter browser targets must be finite numbers within supported limits');
      const first = initial + delta, second = first + delta;
      const output = page.getByLabel(contract.label, {exact: true});
      const button = page.getByRole('button', {name: contract.button, exact: true});
      await textEquals(output, String(initial), 'Counter did not start at its required initial value');
      await button.click(); await textEquals(output, String(first), 'First Increment did not reach its required value');
      await button.click(); await textEquals(output, String(second), 'Second Increment did not reach its required value');
      if (contract.resetButton !== undefined) {
        const reset = page.getByRole('button', {name: contract.resetButton, exact: true});
        await reset.click(); await textEquals(output, String(initial), 'Reset did not return the counter to its required initial value');
        await button.click(); await textEquals(output, String(first), 'Increment did not work after Reset');
      }
      await page.reload({waitUntil: 'networkidle'});
      await textEquals(output, String(initial), 'Counter must reset on a new page');
      behavior = 'counter acceptance passed: ' + [initial, first, second].join(' → ') + (contract.resetButton !== undefined ? ', ' + contract.resetButton + ' → ' + initial + ', Increment → ' + first : '') + ', reload → ' + initial + (contract.heading !== undefined ? '; exact heading ' + JSON.stringify(contract.heading) : '');
    } else if (contract?.kind === 'counter_absent') {
      if (await page.getByLabel(contract.label, {exact: true}).count() || await page.getByRole('button', {name: contract.button, exact: true}).count() || contract.resetButton !== undefined && await page.getByRole('button', {name: contract.resetButton, exact: true}).count()) throw new Error('The removed counter controls are still present');
      behavior = 'counter removal acceptance passed: the prior labelled readout and button are absent';
    }
  } catch (error) {errors.push(error.message);}
  const dom = (await page.locator('body').innerText()).slice(0, 8000);
  const headings = await page.getByRole('heading', {level: 1}).allTextContents();
  await page.screenshot({path: screenshot, fullPage: true});
  await writeFile(report, JSON.stringify({dom, headings, errors, behavior, contract}));
  if (errors.length || !dom.trim()) throw new Error(errors.join('\n') || 'No application content');
  console.log('Actual browser loaded production app; DOM and screenshot captured.');
} finally {await browser.close();}
