import assert from 'node:assert/strict';

/** Read-only navigation requests use normal typing, not hidden URL/window state. */
export const windowRoutingJourney = {
  id: 'software-window-routing',
  goal: 'Find software progress, revision guidance, honest run instructions and Work history without accidentally starting or changing an application.',
  async run(ctx) {
    const before = await ctx.readApi('/api/software'); assert.deepEqual(before, []);
    const mutations = () => ctx.record.apiMutations.filter(item => /^\/api\/(?:software(?:\/|$)|chat$|goals(?:\/|$))/.test(item.path));
    await ctx.send('Show build progress'); await ctx.closeComposer();
    await ctx.page.locator('.software-panel').waitFor();
    await ctx.until(async () => /There are no software builds yet/i.test(await ctx.page.locator('.voice-status').innerText()), 'progress request opens Software and explains actual empty state');
    assert.deepEqual(mutations(), []); ctx.assert('Show build progress opens Software without creating a task.');
    await ctx.screenshot('software-progress-routing');
    const edit = 'Edit the app heading to Done'; await ctx.send(edit);
    const input = ctx.page.getByRole('textbox', {name: 'Message Anascummis', exact: true});
    await ctx.until(async () => await input.inputValue() === edit, 'exact proposed revision remains in the typing input');
    assert.match(await ctx.page.locator('.voice-status').innerText(), /Revision guidance[\s\S]*(?:nothing has been revised|not been applied)/i);
    assert.deepEqual(mutations(), []); await ctx.screenshot('revision-request-kept', input);
    ctx.assert('Existing-app edit shows explicit revision instructions and preserves exact text without applying or submitting it.');
    await ctx.closeComposer(); await ctx.send('Open my app'); await ctx.closeComposer();
    await ctx.until(async () => /Start app[\s\S]*checked source ZIP[\s\S]*No app has started/i.test(await ctx.page.locator('.voice-status').innerText()), 'Open app explains the explicit supported launch action and manual fallback');
    await ctx.page.locator('.software-panel').waitFor(); assert.deepEqual(mutations(), []);
    await ctx.screenshot('honest-open-app-handoff'); ctx.assert('Open my app explains explicit Start and the source ZIP fallback without creating a launch.');
    await ctx.send('Show tasks'); await ctx.closeComposer(); await ctx.page.locator('.work-journal').waitFor();
    assert.deepEqual(mutations(), []); assert.deepEqual(await ctx.readApi('/api/software'), before);
    await ctx.screenshot('show-tasks-work-history'); ctx.assert('Show tasks reaches Work history; navigation produces no build, revision, chat or goal mutations.');
  }
};
