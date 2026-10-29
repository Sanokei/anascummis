import assert from 'node:assert/strict';

/** Exercise the bounded numeric screen through its actual DOM and native controls.
 * The caller owns the application, browser, request isolation and artifact source.
 * This does not infer support for arbitrary generated applications.
 */
export async function exerciseCounterUX(page, options = {}) {
  const {heading = 'Bakery Orders', label = 'Count', button = 'Increment', initial = 0, delta = 1, resetButton, touch = false, capture} = options;
  await page.getByRole('heading', {name: heading, level: 1, exact: true}).waitFor();
  assert.equal(await page.getByRole('heading', {level: 1}).count(), 1, 'The exact requested title is the sole H1.');
  const output = page.getByLabel(label, {exact: true});
  assert.equal(await output.count(), 1, 'The output must have one unambiguous accessible label.');
  assert.equal(await output.evaluate(node => node.tagName), 'OUTPUT');
  const visibleLabel = page.getByText(label, {exact: true});
  assert.equal(await visibleLabel.count(), 1, 'The output label must also appear visibly.');
  assert(await visibleLabel.isVisible());
  assert(await output.evaluate(node => [...node.labels].some(item => item.textContent.trim() === node.getAttribute('aria-label'))), 'The visible label is associated with the readout.');
  const increment = page.getByRole('button', {name: button, exact: true});
  const status = page.locator('[role="status"][aria-live="polite"]');
  assert.equal(await status.count(), 1, 'One polite status region reports completed actions.');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  assert.equal(await output.getAttribute('aria-live'), 'off', 'The readout must not duplicate the separate action announcement.');
  async function value(expected) {
    await page.waitForFunction(({id, expected}) => document.getElementById(id)?.textContent.trim() === String(expected), {id: await output.getAttribute('id'), expected});
  }
  async function feedback(action, expected) {
    await page.waitForFunction(text => document.querySelector('[role="status"][aria-live="polite"]')?.textContent.trim() === text, action + ': ' + label + ' is ' + expected + '.');
    assert(await status.isVisible(), 'Action feedback is visible as well as announced.');
  }
  async function focusVisible(control) {
    assert(await control.evaluate(node => document.activeElement === node), 'Tab must reach the expected native control.');
    assert(await control.evaluate(node => {
      const style = getComputedStyle(node);
      return node.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    }), 'Keyboard focus must have a persistent visible outline.');
  }
  const bounds = [];
  for (const control of [increment, ...(resetButton ? [page.getByRole('button', {name: resetButton, exact: true})] : [])]) {
    const rect = await control.boundingBox();
    assert(rect && rect.width >= 44 && rect.height >= 44, 'Every counter button needs a44×44px or larger target.');
    assert(rect.x >= 0 && rect.x + rect.width <= page.viewportSize().width + 1, 'Counter controls remain within the viewport.');
    assert.equal(await control.getAttribute('type'), 'button');
    bounds.push({label: await control.textContent(), ...rect});
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Counter content must not require horizontal scrolling.');
  const first = initial + delta, second = first + delta;
  await value(initial);
  if (capture) await capture('initial');
  await increment[touch ? 'tap' : 'click'](); await value(first); await feedback(button, first);
  await increment[touch ? 'tap' : 'click'](); await value(second); await feedback(button, second);
  if (resetButton) {
    await page.getByRole('button', {name: resetButton, exact: true})[touch ? 'tap' : 'click']();
    await value(initial); await feedback(resetButton, initial);
  } else assert.equal(await page.getByRole('button').count(), 1, 'An optional Reset must not appear when it was not requested.');

  // A fresh page and a real Tab sequence test native order and both activation keys.
  await page.reload({waitUntil: 'networkidle'}); await value(initial);
  await page.locator('body').evaluate(node => {node.tabIndex = -1; node.focus();});
  await page.keyboard.press('Tab'); await focusVisible(increment);
  await page.keyboard.press('Enter'); await value(first); await feedback(button, first); await focusVisible(increment);
  await page.keyboard.press('Space'); await value(second); await feedback(button, second); await focusVisible(increment);
  if (capture) await capture('keyboard-increment');
  let repeatedResetAnnounced = false;
  if (resetButton) {
    const reset = page.getByRole('button', {name: resetButton, exact: true});
    await page.keyboard.press('Tab'); await focusVisible(reset);
    await page.keyboard.press('Space'); await value(initial); await feedback(resetButton, initial); await focusVisible(reset);
    await status.evaluate(node => {
      window.counterFeedbackMutations = 0;
      window.counterFeedbackObserver = new MutationObserver(records => {window.counterFeedbackMutations += records.length;});
      window.counterFeedbackObserver.observe(node, {childList: true, characterData: true, subtree: true});
    });
    await page.keyboard.press('Enter'); await value(initial); await feedback(resetButton, initial);
    await page.waitForFunction(() => window.counterFeedbackMutations > 0);
    await status.evaluate(() => {window.counterFeedbackObserver.disconnect(); delete window.counterFeedbackObserver; delete window.counterFeedbackMutations;});
    await focusVisible(reset); repeatedResetAnnounced = true;
    if (capture) await capture('keyboard-reset');
  }
  if (resetButton) {await increment.click(); await value(first);}
  else await value(second);
  await page.reload({waitUntil: 'networkidle'}); await value(initial);
  assert.equal((await status.textContent()).trim(), 'Ready when you are.');
  return {heading, label, initial, delta, resetButton, touch, bounds, pointerValues: [initial, first, second, ...(resetButton ? [initial] : [])], keyboardEnterAndSpace: true, visibleFocus: true, repeatedResetStatusMutation: repeatedResetAnnounced, reloadValue: initial, viewport: page.viewportSize(), horizontalOverflow: false};
}
