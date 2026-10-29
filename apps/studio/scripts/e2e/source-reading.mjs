import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const sourceUrl = 'https://raw.githubusercontent.com/whatwg/fetch/main/README.md';
const testsQuestion = 'Where are the Fetch Standard’s tests kept, and where can I see them running against browser engines? Cite the README statements supporting both.';
const buildQuestion = 'For quick local iteration, what command should I run, and what does it use to build the standard? Cite the README statement.';
const missingQuestion = 'What is the maintainer’s postal mailing address? Cite the README statement supplying that address.';
const hash = value => createHash('sha256').update(value).digest('hex');
const answerOf = goal => goal.tasks.find(task => task.sourceAnswer)?.execution?.sourceAnswer;
const cardFor = (ctx, id) => ctx.page.locator('[data-goal-id="' + id + '"]');
const submitted = ctx => ctx.record.apiMutations.filter(item => item.path === '/api/goals').length;

async function goalOutcome(ctx, question, minimumAnswerAttempts = 0) {
  let goal;
  await ctx.until(async () => {
    goal = (await ctx.readApi('/api/goals')).find(item => item.request === question);
    if (!goal) return false;
    if (goal.reading && !answerOf(goal)) {
      (ctx.record.readingObservedBeforeAnswer ||= {})[goal.id] ||= {observedAt: new Date().toISOString(), phase: goal.phase,
        readingId: goal.reading.id, created: goal.reading.created, answerPresent: false};
    }
    return ['completed', 'needs_input', 'cancelled'].includes(goal.status)
      && (goal.tasks.find(task => task.sourceAnswer)?.attempts || 0) >= minimumAnswerAttempts;
  }, 'exact source question reaches a persisted result', 120_000);
  assert.equal(goal.request, question);
  return goal;
}

async function inspectSupport(ctx, region, answer) {
  assert(answer.draftAssessment && typeof answer.draftAssessment.text === 'string' && answer.draftAssessment.text.trim());
  assert(answer.supportReview && typeof answer.supportReview.supported === 'boolean' && answer.supportReview.reason.trim());
  assert.equal(answer.supportError, undefined, 'A missing/failed verifier decision cannot count as evidence support or a correct refusal.');
  const checks = region.locator('details.goal-answer-checks'); await checks.waitFor();
  if (!await checks.evaluate(element => element.open)) await checks.locator('> summary').click();
  assert((await checks.innerText()).includes(answer.draftAssessment.reason));
  assert((await checks.innerText()).includes(answer.supportReview.reason));
  const original = checks.locator('summary').filter({hasText: /^Original model draft$/}).locator('..');
  if (!await original.evaluate(element => element.open)) await original.locator('> summary').click();
  assert.equal(await original.locator('> p').textContent(), answer.draftAssessment.text);
  return {checks, original};
}

async function verifyReading(ctx, goal, requireLater) {
  const plan = goal.reading;
  assert(plan, 'The source question needs a persisted reading plan.');
  assert.equal(plan.goalId, goal.id); assert.equal(plan.taskId, 'source-answer');
  assert.equal(plan.question, goal.request); assert.equal(plan.questionSha256, hash(goal.request));
  assert.equal(plan.mode, 'auto'); assert.equal(plan.match, 'matched');
  assert(plan.ranges.length > 0 && plan.ranges.length <= 2);
  assert(plan.ranges.reduce((sum, range) => sum + range.text.length, 0) <= 1600);
  for (const range of plan.ranges) {
    const source = goal.sources.find(item => item.id === range.sourceId); assert(source);
    assert.equal(range.textSha256, source.textSha256); assert.equal(range.end - range.start, range.text.length);
    assert.equal(hash(range.text), range.rangeSha256); assert(range.matchedTerms.length > 0);
  }
  const savedAt = goal.events.findIndex(event => ['selection_saved', 'selection_reused'].includes(event.phase));
  const inferenceAt = goal.events.findIndex(event => event.phase === 'answering_sources');
  assert(savedAt >= 0 && inferenceAt > savedAt, 'The saved selection must precede the answering phase.');
  assert(plan.created <= goal.events[savedAt].time && goal.events[savedAt].time <= goal.events[inferenceAt].time);
  const answer = answerOf(goal); assert(answer); assert.equal(answer.readingId, plan.id); assert.equal(answer.answerable, true);
  assert.equal(answer.citationMethod, 'host-spans-v1'); assert.equal(answer.supportReview?.supported, true);
  assert.equal(answer.supportError, undefined); assert(answer.draftAssessment);
  assert(answer.answerabilityReason.trim()); assert(answer.citations.length > 0);
  if (requireLater) assert(answer.citations.every(citation => citation.offset > 800), 'Requested later facts must use actual later-document citations.');
  for (const citation of answer.citations) {
    const selected = plan.ranges.find(range => range.sourceId === citation.sourceId && range.label === citation.label
      && range.start <= citation.offset && citation.offset + citation.quote.length <= range.end); assert(selected);
    assert.equal(selected.text.slice(citation.offset - selected.start, citation.offset - selected.start + citation.quote.length), citation.quote);
    const saved = await ctx.readApi('/api/goals/' + goal.id + '/sources/' + citation.sourceId + '?offset=' + citation.offset);
    assert(saved.text.startsWith(citation.quote)); assert.equal(citation.textSha256, saved.source.textSha256);
  }
  const card = cardFor(ctx, goal.id); await card.waitFor();
  const shownPlan = card.getByRole('region', {name: 'Saved reading plan', exact: true}); await shownPlan.waitFor();
  assert.equal(await shownPlan.getAttribute('data-reading-id'), plan.id);
  assert((await shownPlan.innerText()).includes('Reading plan saved before inference'));
  await ctx.screenshot('saved-reading-plan-' + goal.id.slice(0, 8), shownPlan.locator('strong'));
  const history = card.locator('summary').filter({hasText: /^Reading plan history$/});
  const disclosure = history.locator('..');
  assert.equal(await disclosure.evaluate(element => element.open), false);
  assert(!(ctx.record.readingHistoryRequests || []).some(item => item.path === '/api/goals/' + goal.id + '/readings'), 'Reading history must be lazy while closed.');
  const unchangedPosts = submitted(ctx);
  const metadataResponse = ctx.page.waitForResponse(response => new URL(response.url()).pathname === '/api/goals/' + goal.id + '/readings');
  metadataResponse.catch(() => {}); await history.click();
  const metadata = await (await metadataResponse).json();
  assert(Array.isArray(metadata.readings)); assert(metadata.readings.some(item => item.id === plan.id));
  assert(metadata.readings.every(item => !item.ranges?.some(range => Object.hasOwn(range, 'text'))), 'History metadata must not eagerly include passage text.');
  const detailResponse = ctx.page.waitForResponse(response => new URL(response.url()).pathname === '/api/goals/' + goal.id + '/readings/' + plan.id);
  detailResponse.catch(() => {});
  await card.getByRole('button', {name: 'Inspect saved reading plan ' + plan.id, exact: true}).click();
  const detail = await (await detailResponse).json();
  assert.equal(detail.id, plan.id); assert.equal(detail.questionSha256, plan.questionSha256); assert.deepEqual(detail.ranges, plan.ranges);
  await ctx.until(async () => await shownPlan.getAttribute('data-reading-id') === plan.id, 'explicit current reading inspection displays its saved identity');
  await ctx.until(() => shownPlan.evaluate(element => document.activeElement === element), 'explicit current reading inspection focuses the saved plan');
  await history.click(); assert.equal(await disclosure.evaluate(element => element.open), false);
  assert.equal(submitted(ctx), unchangedPosts, 'Inspecting/closing reading history must not submit a question.');
  (ctx.record.currentReadingHistoryChecks ||= []).push({goalId: goal.id, readingId: plan.id, historyEntries: metadata.readings.length,
    inspectedCurrent: true, archivedNativePlanExercised: false});
  ctx.assert('Closed reading history is lazy; explicit current-plan inspect verifies the full saved ranges and closes without submission.');
  const first = plan.ranges[0];
  await card.getByRole('button', {name: 'Inspect selected passage source-1 ' + first.start + '–' + first.end, exact: true}).click();
  const text = card.getByRole('article', {name: 'Saved source source-1', exact: true}).locator('pre[aria-label="Saved text source-1"]');
  await ctx.until(async () => await text.textContent() === first.text, 'the exact selected saved passage is inspectable');
  assert.equal(await text.getAttribute('data-source-range'), first.start + ':' + first.end);
  assert((await card.locator('.goal-saved-text').innerText()).includes('Range hash checked'));
  await ctx.screenshot('selected-later-passage-' + goal.id.slice(0, 8), text);
  await card.getByRole('button', {name: 'Close saved text', exact: true}).click();
  const shownAnswer = card.getByRole('region', {name: 'Source-grounded answer', exact: true}); await shownAnswer.waitFor();
  assert((await shownAnswer.innerText()).includes(answer.text));
  await ctx.screenshot('later-answer-' + goal.id.slice(0, 8), shownAnswer.locator('h4'));
  const support = await inspectSupport(ctx, shownAnswer, answer);
  await support.checks.locator('> summary').click();
  ctx.assert('Hashed question passages were saved before the answering phase; absolute later citations and visible inspected text match.',
    {goalId: goal.id, readingId: plan.id, citations: answer.citations.map(item => ({offset: item.offset, quote: item.quote}))});
}

async function stageFromSaved(ctx, parent, question) {
  const before = submitted(ctx), existing = (await ctx.readApi('/api/goals')).length;
  await cardFor(ctx, parent.id).getByRole('button', {name: 'Ask another question from saved sources', exact: true}).click();
  const form = ctx.page.locator('details.goal-create'); await form.waitFor();
  assert.equal(await form.getByRole('textbox', {name: 'Exact question', exact: true}).inputValue(), '');
  const source = form.getByRole('textbox', {name: 'Public source URLs', exact: true});
  assert.equal(await source.inputValue(), parent.sourceQuestion.urls.join('\n')); assert.equal(await source.getAttribute('readonly'), '');
  const context = form.getByLabel('Saved-source question context', {exact: true}); await context.waitFor();
  await context.locator('summary').click();
  assert((await context.innerText()).includes(parent.request)); assert((await context.innerText()).includes(parent.projectId));
  assert((await context.innerText()).includes(parent.id));
  const research = form.getByRole('checkbox', {name: 'Allow public web research for this goal', exact: true});
  assert.equal(await research.isChecked(), false, 'A new linked question requires a fresh explicit opt-in.');
  await form.getByRole('textbox', {name: 'Exact question', exact: true}).fill(question);
  const send = form.getByRole('button', {name: 'Send question from saved sources', exact: true});
  assert(await send.isDisabled()); assert.equal(submitted(ctx), before); assert.equal((await ctx.readApi('/api/goals')).length, existing);
  await research.check(); assert.equal(submitted(ctx), before, 'Staging, editing and permission must not submit the question.');
  await ctx.screenshot('explicit-linked-question-' + before, context);
  await send.click();
  const child = await goalOutcome(ctx, question);
  (ctx.record.linkedQuestionOutcomes ||= []).push(child);
  assert.equal(submitted(ctx), before + 1); assert.equal(child.parentGoalId, parent.id); assert.equal(child.projectId, parent.projectId);
  assert.deepEqual(child.sourceQuestion.urls, parent.sourceQuestion.urls); assert.equal(child.research, true);
  assert.notEqual(child.id, parent.id); assert.equal(child.sources.length, parent.sources.length);
  for (const copy of child.sources) {
    const original = parent.sources.find(item => item.id === copy.copiedFrom?.sourceId); assert(original);
    assert.equal(copy.copiedFrom.goalId, parent.id); assert.notEqual(copy.id, original.id);
    assert.equal(copy.goalId, child.id);
    for (const field of ['url', 'requestedUrl', 'title', 'retrievedAt', 'type', 'bytes', 'textLength', 'sha256', 'textSha256', 'normalization']) assert.equal(copy[field], original[field], 'Copied source ' + field);
  }
  assert(child.events.some(event => event.phase === 'source_reused'));
  assert(!child.events.some(event => event.phase === 'fetching_source'), 'Linked questions must not fetch their public URLs again.');
  assert(child.tasks.filter(task => task.sourceUrl).every(task => task.status === 'verified' && task.attempts === 0));
  assert.deepEqual(await ctx.readApi('/api/goals/' + parent.id), parent, 'The original parent record and answer must stay unchanged.');
  ctx.assert('A new explicit linked question reuses distinct hash-checked source copies, keeps the original retrieval time, and does not fetch or mutate its parent.', {parentGoalId: parent.id, childGoalId: child.id});
  return child;
}

function rejectedEvidence(goal) {
  assert.equal(goal.status, 'needs_input');
  const answer = answerOf(goal); assert(answer, 'This matched-source control needs a retained native draft and real support decision.');
  assert.equal(goal.reading?.match, 'matched'); assert.equal(answer.answerable, false);
  assert.equal(answer.supportReview?.supported, false, 'An actual negative support decision is required, not a transport/validator failure.');
  assert.equal(answer.supportError, undefined); assert(answer.draftAssessment?.text.trim());
  return answer;
}

async function archivedRefusal(ctx, goal, expectedAnswer) {
  const card = cardFor(ctx, goal.id), history = card.locator('details.goal-reading-history');
  if (!await history.evaluate(element => element.open)) await history.locator('> summary').click();
  await card.getByRole('button', {name: 'Inspect saved reading plan ' + goal.reading.id, exact: true}).click();
  let detail;
  await ctx.until(async () => {detail = await ctx.readApi('/api/goals/' + goal.id + '/readings/' + goal.reading.id); return detail.resultCount >= 1 && detail.result;}, 'the explicit native retry archives the prior draft and its support decision');
  assert.equal(detail.result.question, goal.request); assert.equal(detail.result.goalId, goal.id); assert.equal(detail.result.readingId, goal.reading.id);
  assert.deepEqual(detail.result.execution.sourceAnswer, expectedAnswer);
  const archived = card.getByRole('region', {name: 'Archived reading result', exact: true}); await archived.waitFor();
  assert.equal(await archived.getAttribute('data-reading-result-id'), detail.result.id);
  const exact = archived.locator('summary').filter({hasText: /^Archived exact question$/}).locator('..');
  if (!await exact.evaluate(element => element.open)) await exact.locator('> summary').click();
  assert.equal(await exact.locator('> p').textContent(), goal.request);
  const inspected = await inspectSupport(ctx, archived, expectedAnswer);
  await ctx.screenshot('archived-native-refusal-' + goal.id.slice(0, 8), archived.locator('h4'));
  await ctx.screenshot('archived-native-draft-and-check-' + goal.id.slice(0, 8), inspected.original.locator('> p'));
  await history.locator('> summary').click();
  (ctx.record.archivedNativeReadingChecks ||= []).push({goalId: goal.id, readingId: goal.reading.id, resultId: detail.result.id,
    attemptsSaved: detail.resultCount, originalDraftMatched: true, actualSupportReviewMatched: true});
  return detail.result;
}

export const laterSourceFollowupJourney = {
  id: 'later-source-followup', prerequisite: 'Permitted real public-source fetch and an actual local inference runtime.',
  goal: 'Answer both later README test-location facts, ask a separate build question from retained sources without refetching, and keep an unanswerable control unfinished.',
  async run(ctx) {
    ctx.record.readingHistoryRequests = [];
    ctx.page.on('request', request => {
      const url = new URL(request.url());
      if (/^\/api\/goals\/[^/]+\/readings(?:\/[^/]+)?$/.test(url.pathname)) ctx.record.readingHistoryRequests.push({path: url.pathname, time: new Date().toISOString()});
    });
    await ctx.send('What can you do?'); await ctx.closeComposer();
    await ctx.page.getByRole('region', {name: 'Getting started', exact: true}).getByRole('button', {name: 'Open Goals', exact: true}).click();
    await ctx.page.getByRole('checkbox', {name: 'Question from public sources', exact: true}).check();
    await ctx.page.getByRole('textbox', {name: 'Exact question', exact: true}).fill(testsQuestion);
    await ctx.page.getByRole('textbox', {name: 'Public source URLs', exact: true}).fill(sourceUrl);
    await ctx.page.getByRole('checkbox', {name: 'Allow public web research for this goal', exact: true}).check();
    await ctx.page.getByRole('button', {name: 'Save question and read sources', exact: true}).click();
    let parent = await goalOutcome(ctx, testsQuestion);
    ctx.record.laterSource = {parent};
    assert.equal(parent.status, 'completed', 'Acknowledging missing test locations is not answering the saved question.');
    const answer = answerOf(parent); assert(answer);
    for (const pattern of [/web-platform-tests\/wpt/i, /fetch\//i, /wpt\.fyi\/results\/fetch/i]) {
      assert.match(answer.text, pattern, 'The answer must actually give every requested location.');
      assert.match(answer.citations.map(citation => citation.quote).join('\n'), pattern, 'Later literal quotations must support the requested locations.');
    }
    await verifyReading(ctx, parent, true);
    assert.equal(parent.tasks.find(task => task.id === 'source-1').attempts, 1);
    const posts = submitted(ctx), immutable = structuredClone(parent);
    await ctx.page.getByRole('tab', {name: 'Goals', exact: true}).focus(); await ctx.page.keyboard.press('Control+Delete');
    await ctx.page.locator('.goal-panel').waitFor({state: 'hidden'});
    await ctx.send('What can you do?'); await ctx.closeComposer();
    await ctx.page.getByRole('region', {name: 'Getting started', exact: true}).getByRole('button', {name: 'Open Goals', exact: true}).click();
    await cardFor(ctx, parent.id).waitFor();
    await ctx.page.reload({waitUntil: 'networkidle'}); await cardFor(ctx, parent.id).waitFor();
    parent = await ctx.readApi('/api/goals/' + parent.id); assert.deepEqual(parent, immutable); assert.equal(submitted(ctx), posts);
    ctx.assert('Closing/reopening/reloading preserves the question, reading, answer, source identity and the single original acquisition without replay.');

    const child = await stageFromSaved(ctx, parent, buildQuestion); ctx.record.laterSource.child = child;
    assert.equal(child.status, 'completed');
    const build = answerOf(child); assert(build);
    for (const pattern of [/\bmake\b/i, /web service/i]) {assert.match(build.text, pattern); assert.match(build.citations.map(citation => citation.quote).join('\n'), pattern);}
    await verifyReading(ctx, child, true);
    await cardFor(ctx, child.id).getByRole('button', {name: 'Open parent question', exact: true}).click();
    await ctx.until(async () => await cardFor(ctx, parent.id).getAttribute('aria-current') === 'true', 'parent question link selects its original window record');
    const links = cardFor(ctx, parent.id).locator('details.goal-question-links'); await links.locator('summary').click();
    await links.getByRole('button', {name: /^Open follow-up question:/}).click();
    await ctx.until(async () => await cardFor(ctx, child.id).getAttribute('aria-current') === 'true', 'follow-up link selects the child question');
    await cardFor(ctx, child.id).getByRole('button', {name: 'Open parent question', exact: true}).click();
    ctx.assert('Visible parent and follow-up links return to the correct retained questions.');

    const insufficient = await stageFromSaved(ctx, parent, missingQuestion); ctx.record.laterSource.insufficient = insufficient;
    assert.equal(insufficient.status, 'needs_input', 'A postal address absent from the README must never become completed.');
    assert(insufficient.reading, 'The insufficient-evidence result must keep its reading plan.');
    assert.equal(insufficient.reading.question, missingQuestion); assert.equal(insufficient.reading.questionSha256, hash(missingQuestion));
    assert(!insufficient.events.some(event => event.phase === 'completed'));
    const uncertain = rejectedEvidence(insufficient);
    const negativeCard = cardFor(ctx, insufficient.id); await negativeCard.waitFor();
    const negativePlan = negativeCard.getByRole('region', {name: 'Saved reading plan', exact: true}); await negativePlan.waitFor();
    assert.equal(await negativePlan.getAttribute('data-reading-id'), insufficient.reading.id);
    await negativeCard.getByRole('button', {name: 'Continue remaining work', exact: true}).waitFor();
    await ctx.screenshot('insufficient-source-needs-input', negativeCard.locator('h3'));
    const continuation = negativeCard.getByRole('button', {name: 'Continue remaining work', exact: true});
    assert.equal(await negativeCard.getByRole('textbox', {name: 'Guidance for continuing', exact: true}).inputValue(), '');
    await continuation.focus();
    const focus = await continuation.evaluate(element => {const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return {x: box.x, y: box.y, right: box.right, bottom: box.bottom,
      width: innerWidth, height: innerHeight, focused: document.activeElement === element, hit: hit === element || element.contains(hit)};});
    assert(focus.focused && focus.hit && focus.x >= 0 && focus.y >= 0 && focus.right <= focus.width && focus.bottom <= focus.height);
    ctx.record.refusalContinueFocus = focus; await ctx.screenshot('insufficient-focusable-continue');
    const oldAttempt = insufficient.tasks.find(task => task.sourceAnswer).attempts;
    const beforeRetryPosts = submitted(ctx);
    await continuation.click();
    const retry = await goalOutcome(ctx, missingQuestion, oldAttempt + 1); ctx.record.laterSource.insufficientRetry = retry;
    rejectedEvidence(retry);
    assert.equal(retry.id, insufficient.id); assert.equal(retry.request, missingQuestion);
    assert.deepEqual(retry.reading, insufficient.reading); assert.deepEqual(retry.sources, insufficient.sources);
    assert.deepEqual(retry.guidance, insufficient.guidance); assert.deepEqual(retry.notes, insufficient.notes);
    assert.equal(retry.tasks.find(task => task.sourceAnswer).attempts, oldAttempt + 1);
    assert(retry.tasks.filter(task => task.sourceUrl).every(task => task.attempts === 0 && task.status === 'verified'));
    assert(!retry.events.some(event => event.phase === 'fetching_source'));
    assert.equal(submitted(ctx), beforeRetryPosts, 'Continue retries the same question; it must not create another one.');
    const archived = await archivedRefusal(ctx, retry, uncertain);
    const resumePosts = ctx.record.apiMutations.filter(item => item.path === '/api/goals/' + retry.id + '/resume').length;
    assert.equal(resumePosts, 1);
    await ctx.page.getByRole('tab', {name: 'Goals', exact: true}).focus(); await ctx.page.keyboard.press('Control+Delete');
    await ctx.page.locator('.goal-panel').waitFor({state: 'hidden'});
    await ctx.send('What can you do?'); await ctx.closeComposer();
    await ctx.page.getByRole('region', {name: 'Getting started', exact: true}).getByRole('button', {name: 'Open Goals', exact: true}).click();
    await ctx.page.reload({waitUntil: 'networkidle'}); await cardFor(ctx, retry.id).waitFor();
    const afterReload = await ctx.readApi('/api/goals/' + retry.id); assert.deepEqual(afterReload, retry);
    const restoredArchive = await archivedRefusal(ctx, afterReload, uncertain); assert.equal(restoredArchive.id, archived.id);
    assert.equal(ctx.record.apiMutations.filter(item => item.path === '/api/goals/' + retry.id + '/resume').length, resumePosts);
    ctx.record.insufficientEvidenceControl = {request: missingQuestion, status: insufficient.status, goalAchieved: false,
      answered: false, answerable: false, supportReview: uncertain.supportReview, reason: uncertain.answerabilityReason,
      explicitRetries: 1, archivedReadingResultId: archived.id};
    assert.deepEqual(await ctx.readApi('/api/goals/' + parent.id), immutable);
    assert.deepEqual(await ctx.readApi('/api/goals/' + child.id), child);
    ctx.assert('The insufficient-evidence control remains needs_input through one explicit native retry, keeps exact source/reading identity, and preserves its prior draft/support decision across close/reload. The unknown address is not counted as answered.');
  }
};
