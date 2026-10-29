import assert from 'node:assert/strict';
import {samplePdf} from './artifacts.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const unavailable = /Local AI is unavailable|local (?:AI|model|service).*unavailable|connect.*local|not ready/i;
async function preview(ctx, title) {
  await ctx.send('show website'); await ctx.closeComposer();
  const frame = ctx.page.frameLocator('iframe[title="Website preview"]');
  await frame.locator('h1').waitFor(); assert.equal(await frame.locator('h1').innerText(), title);
  return frame;
}
async function nativeBlocker(ctx, message, evidence) {
  const current = await ctx.readApi('/api/status');
  if (unavailable.test(message)) ctx.blocked('The requested user outcome requires local inference, which is unavailable. Recovery checks are separate from goal completion.', {...evidence, runtime: current, observedError: message});
}

export const journeys = [
  {
    id: 'discover-capabilities',
    goal: 'Find what this assistant can help me do, then open the work windows without knowing hidden command phrases.',
    async run(ctx) {
      await ctx.send('What can you do?'); await ctx.closeComposer();
      const help = ctx.page.getByRole('region', {name: 'Getting started', exact: true});
      await help.waitFor();
      for (const label of ['Open Goals', 'Open Work history', 'Open Software work', 'Open a PDF', 'Show website']) await help.getByRole('button', {name: label, exact: true}).waitFor();
      ctx.assert('Capabilities provide visible, labelled next actions.');
      await ctx.screenshot('capabilities', help);
      for (const [label, selector] of [['Open Goals', '.goal-panel'], ['Open Work history', '.work-journal'], ['Open Software work', '.software-panel']]) {
        // A chosen window comes to the front on phones. Return through the same
        // visible help instruction before choosing a different starting point.
        await ctx.send('What can you do?'); await ctx.closeComposer();
        await help.getByRole('button', {name: label, exact: true}).click(); await ctx.page.locator(selector).waitFor();
        ctx.assert(label + ' opens the existing window.');
      }
      await ctx.screenshot('work-windows');
      assert.equal(ctx.record.apiMutations.filter(item => ['/api/chat', '/api/goals', '/api/software'].includes(item.path)).length, 0, 'Help must not silently start work.');
    }
  },
  {
    id: 'bakery-website', prerequisite: 'A real configured local inference runtime for the requested website edits.',
    goal: 'Personalize my bakery website, inspect the result, reload it, and download a copy with the exact requested title and subtitle.',
    async run(ctx) {
      const title = "Baker's Table", subtitle = 'Fresh bread every morning. Open Tuesday to Sunday, 7 am to 2 pm.';
      const request = `Set my website title to "${title}" and subtitle to "${subtitle}". Preserve the other content.`;
      await ctx.send(request); await ctx.closeComposer();
      let work;
      await ctx.until(async () => {const page = await ctx.readApi('/api/jobs'); work = [...page.active, ...page.history].find(item => item.request === request); return work && work.status !== 'running';}, 'website edit reaches a recorded outcome', 120_000);
      ctx.record.persistedWork = work;
      const card = ctx.page.locator('[data-work-task-id="' + work.id + '"]'); await card.waitFor();
      assert.equal(await card.locator('strong').innerText(), request); ctx.assert('The exact user request is visible in saved Work history.');
      if (work.status !== 'complete' || work.outcome !== 'finished') {
        await ctx.screenshot('website-goal-blocked', card);
        await card.getByRole('button', {name: 'Edit saved request', exact: true}).click();
        const input = ctx.page.getByRole('textbox', {name: 'Message Anascummis', exact: true});
        await ctx.until(async () => await input.inputValue() === request, 'exact saved request restored');
        ctx.assert('Failed request can be edited without retyping.');
        const sent = ctx.record.apiMutations.filter(item => item.path === '/api/chat').length;
        await ctx.closeComposer(); await ctx.page.reload({waitUntil: 'networkidle'}); await ctx.page.locator('.work-journal').waitFor();
        assert.equal(ctx.record.apiMutations.filter(item => item.path === '/api/chat').length, sent, 'Reload must not replay a task.');
        const recovered = ctx.page.locator('[data-work-task-id="' + work.id + '"]');
        await recovered.getByRole('button', {name: 'Setup instructions', exact: true}).click();
        const dialog = ctx.page.getByRole('dialog'); await dialog.waitFor(); assert.match(await dialog.innerText(), /model:start/);
        await ctx.screenshot('setup-next-step'); await ctx.page.getByRole('button', {name: 'Close download instructions', exact: true}).click();
        ctx.assert('Reload preserves the failed goal without replay and setup gives a concrete runtime step.');
        await nativeBlocker(ctx, work.error || work.message || '', {workId: work.id, requestPreserved: true, automaticReplay: false});
        throw new Error('Website goal did not achieve the requested output: ' + (work.error || work.message));
      }
      const project = await ctx.readApi('/api/projects/' + work.projectId); assert.equal(project.site.title, title); assert.equal(project.site.subtitle, subtitle);
      const frame = await preview(ctx, title); assert.match(await frame.locator('body').innerText(), /Fresh bread every morning/); await ctx.screenshot('personalized-website');
      await ctx.page.reload({waitUntil: 'networkidle'}); await preview(ctx, title);
      const archive = ctx.zipEntries(await ctx.download('export website as zip', 'bakery-website.zip'));
      const saved = JSON.parse(archive.get('site.json').toString()); assert.equal(saved.title, title); assert.equal(saved.subtitle, subtitle);
      assert(archive.get('index.html').toString().includes('Fresh bread every morning.')); ctx.assert('Requested copy survives reload, preview, and the actual downloaded website.');
      await ctx.screenshot('downloaded-website');
    }
  },
  {
    id: 'website-pdf-exports',
    goal: 'Keep a PDF open while previewing my website, then download the requested website HTML/ZIP and the PDF/PNG without getting the wrong artifact.',
    async run(ctx) {
      const invalid = 'export pdf as png', unexpected = [];
      const recordUnexpected = download => unexpected.push(download.suggestedFilename());
      ctx.page.on('download', recordUnexpected);
      await ctx.send(invalid);
      await ctx.until(async () => /open a PDF/i.test(await ctx.page.locator('.voice-status').innerText()), 'invalid PDF export explains the missing document');
      assert.equal(await ctx.page.getByRole('textbox', {name: 'Message Anascummis', exact: true}).inputValue(), invalid);
      assert.equal(await ctx.page.getByRole('complementary', {name: 'Unconfirmed delivery', exact: true}).count(), 0, 'A rejected read/export command is not an unconfirmed mutation.');
      assert.deepEqual(unexpected, [], 'A missing-PDF export must not download a different artifact.');
      ctx.page.off('download', recordUnexpected); await ctx.type(''); await ctx.closeComposer();
      ctx.assert('Missing PDF produces a concrete error, preserves the request, and causes no download or fake unconfirmed-delivery notice.');
      const projects = await ctx.readApi('/api/projects'); assert.equal(projects.length, 1);
      const project = await ctx.readApi('/api/projects/' + projects[0].id);
      await ctx.send('open a pdf'); await ctx.closeComposer();
      const pdf = samplePdf(); await writeFile(join(ctx.folder, 'packing-list-input.pdf'), pdf);
      const chooser = ctx.page.waitForEvent('filechooser');
      chooser.catch(() => {});
      await ctx.page.getByRole('button', {name: 'Talk to Anascummis', exact: true}).click();
      await (await chooser).setFiles({name: 'packing-list.pdf', mimeType: 'application/pdf', buffer: pdf});
      let document;
      await ctx.until(async () => {document = (await ctx.readApi('/api/documents'))[0]; return document;}, 'PDF uploaded through the actual file input');
      const rendered = ctx.page.getByRole('img', {name: 'PDF page 1', exact: true}); await rendered.waitFor();
      await ctx.until(() => rendered.evaluate(image => image.complete && image.naturalWidth > 0), 'PDF page actually decodes');
      ctx.record.renderedPdf = await rendered.evaluate(image => ({width: image.naturalWidth, height: image.naturalHeight}));
      ctx.assert('PDF upload creates an inspectable page without inference.');
      await preview(ctx, project.site.title); await ctx.screenshot('website-with-pdf-attached');
      const html = await ctx.download('export website as html', 'website.html');
      assert.match(html.toString('utf8'), /<!doctype html/i, 'Explicit HTML website export must contain HTML, not the attached PDF or ZIP.');
      assert(html.toString('utf8').includes(project.site.title)); ctx.assert('Explicit website HTML target produces actual HTML despite an attached PDF.');
      const artifactPage = await ctx.page.context().newPage();
      try {await artifactPage.setContent(html.toString('utf8'), {waitUntil: 'load'}); assert.equal(await artifactPage.locator('h1').innerText(), project.site.title); await artifactPage.screenshot({path: join(ctx.folder, 'rendered-downloaded-website.png')}); ctx.record.screenshots.push('rendered-downloaded-website.png'); ctx.assert('The actual downloaded HTML renders its expected website heading in a fresh page.');}
      finally {await artifactPage.close();}
      const zip = ctx.zipEntries(await ctx.download('export website as zip', 'website.zip'));
      assert.equal(JSON.parse(zip.get('site.json').toString()).title, project.site.title); assert(zip.has('index.html')); ctx.assert('Explicit website ZIP contains website content, not PDF bytes.');
      const exportedPdf = await ctx.download('export pdf as pdf', 'packing-list.pdf'); assert.equal(exportedPdf.subarray(0, 5).toString(), '%PDF-'); assert(exportedPdf.includes(Buffer.from('Bakery packing list')));
      const png = await ctx.download('export pdf as png', 'packing-list.png'); assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(png.toString('ascii', 12, 16), 'IHDR'); assert(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0); ctx.assert('Explicit PDF and PNG target exports remain correct.');
      const savedDoc = await ctx.readApi('/api/documents/' + document.id); assert.equal(savedDoc.revision, document.revision); ctx.assert('Exporting does not edit the original PDF.');
      await ctx.screenshot('correct-exports');
    }
  },
  {
    id: 'public-source-answer', prerequisite: 'Permitted public-source access and a real local model for the final answer.',
    goal: 'Answer which standard a public repository hosts, cite saved source evidence, and retain the answer or unfinished question after reload.',
    async run(ctx) {
      await ctx.send('What can you do?'); await ctx.closeComposer();
      await ctx.page.getByRole('region', {name: 'Getting started', exact: true}).getByRole('button', {name: 'Open Goals', exact: true}).click();
      await ctx.page.getByRole('checkbox', {name: 'Question from public sources', exact: true}).check();
      const question = 'Which standard does this repository host? Cite the exact supplied source statement.';
      await ctx.page.getByRole('textbox', {name: 'Exact question', exact: true}).fill(question);
      await ctx.page.getByRole('textbox', {name: 'Public source URLs', exact: true}).fill('https://raw.githubusercontent.com/whatwg/fetch/main/README.md');
      await ctx.page.getByRole('checkbox', {name: 'Allow public web research for this goal', exact: true}).check();
      await ctx.page.getByRole('button', {name: 'Save question and read sources', exact: true}).click();
      let goal;
      await ctx.until(async () => {goal = (await ctx.readApi('/api/goals'))[0]; return goal && ['completed', 'needs_input', 'cancelled'].includes(goal.status);}, 'source question reaches a recorded outcome', 120_000);
      assert.equal(goal.request, question); ctx.record.persistedGoal = goal;
      await ctx.screenshot('source-question-outcome', ctx.page.locator('.goal-record h3'));
      if (goal.sources.length) {
        const snapshot = goal.sources[0]; await ctx.page.getByRole('button', {name: 'Inspect saved text', exact: true}).click();
        const saved = await ctx.readApi('/api/goals/' + goal.id + '/sources/' + snapshot.id + '?offset=0');
        assert(saved.text.includes('Fetch Standard')); assert.equal(saved.source.sha256, snapshot.sha256); ctx.assert('A real source is retained with content identity and inspectable text.');
        await ctx.page.reload({waitUntil: 'networkidle'}); const restored = await ctx.readApi('/api/goals/' + goal.id); assert.deepEqual(restored.sources, goal.sources); ctx.assert('Reload preserves exact source identities without a new acquisition.');
      }
      if (goal.status !== 'completed') {
        if (!goal.sources.length) ctx.blocked('Public source acquisition is unavailable; no answer was produced.', {message: goal.message});
        await nativeBlocker(ctx, goal.message, {goalId: goal.id, sourcesRetained: goal.sources.length, fabricatedAnswer: false});
        throw new Error('Source-grounded answer did not complete: ' + goal.message);
      }
      const answer = goal.tasks.find(task => task.sourceAnswer)?.execution?.sourceAnswer;
      assert(answer?.citations?.length); assert.match(answer.text, /\bFetch Standard\b/i);
      ctx.record.answerQuality = {text: answer.text, uncertainty: answer.uncertainty};
      assert.doesNotMatch(answer.uncertainty, /(?:exact\s+)?(?:cited\s+|quoted\s+|supplied\s+|selected\s+)?(?:source\s+)?(?:statement|excerpt)\s+(?:is|was|are|were)\s+not\s+(?:provided|supplied|available)/i,
        'The answer cannot quote the supplied host statement and then claim that statement/excerpt was not provided.');
      assert(answer.citations.some(citation => /repository hosts[^\n]{0,100}Fetch Standard/i.test(citation.quote)), 'At least one citation must support which standard the repository hosts.');
      for (const citation of answer.citations) {const saved = await ctx.readApi('/api/goals/' + goal.id + '/sources/' + citation.sourceId + '?offset=0'); assert.equal(saved.text.slice(citation.offset, citation.offset + citation.quote.length), citation.quote); assert.equal(citation.textSha256, saved.source.textSha256);}
      const shown = ctx.page.getByRole('region', {name: 'Source-grounded answer', exact: true}); await shown.waitFor(); assert((await shown.innerText()).includes(answer.text));
      await ctx.screenshot('source-grounded-answer-after-reload', shown.locator('h4'));
      await ctx.screenshot('source-answer-uncertainty-and-limit', shown.locator('> p').last());
      ctx.assert('Real model answer names Fetch and literal citations match the real saved source.');
    }
  },
  {
    id: 'counter-application', prerequisite: 'Real local model plus existing software build dependencies/runner.',
    goal: 'Build a counter application and obtain its verified source ZIP, with persistent progress and a usable resume path if work cannot finish.',
    async run(ctx) {
      const request = 'Build a small counter application with heading Bakery Orders, a count starting at zero, an Increment button that adds one, and a Reset button that returns to zero. Include browser checks and give me the source ZIP.';
      await ctx.send(request); await ctx.closeComposer(); await ctx.page.locator('.software-panel').waitFor();
      let task, previousProgress = '';
      await ctx.until(async () => {
        task = (await ctx.readApi('/api/software'))[0];
        if (task) {
          const state = {id: task.id, status: task.status, phase: task.phase, revision: task.revision, modelCalls: task.calls};
          const progress = JSON.stringify(state);
          if (progress !== previousProgress) {
            previousProgress = progress;
            const entry = {time: new Date().toISOString(), ...state};
            (ctx.record.goalProgress ||= []).push(entry);
            await writeFile(join(ctx.folder, 'progress.json'), JSON.stringify(entry, null, 2) + '\n');
            console.log('ACTIVE counter-application [' + ctx.record.viewport + '] ' + task.status + ' · ' + task.phase + ' · model calls ' + task.calls);
          }
        }
        return task && ['completed', 'needs_input', 'cancelled'].includes(task.status);
      }, 'counter app reaches a recorded outcome (10 minute bound for genuine generation/install/build/QA)', 600_000);
      ctx.record.persistedSoftware = task;
      await ctx.screenshot('counter-application-outcome', ctx.page.locator('[data-software-task-id="' + task.id + '"]'));
      assert.equal(task.goal, request); const savedId = task.id;
      await ctx.page.reload({waitUntil: 'networkidle'}); assert.equal((await ctx.readApi('/api/software'))[0].id, savedId); ctx.assert('The exact build request and its own progress survive reload.');
      if (task.status !== 'completed') {
        const card = ctx.page.locator('[data-software-task-id="' + task.id + '"]');
        await card.getByRole('button', {name: 'Resume checkpoint', exact: true}).waitFor();
        const full = card.locator('details.software-full-goal'); await full.locator('summary').click();
        await ctx.until(async () => (await full.innerText()).includes(request), 'full software request remains visible');
        ctx.assert('Blocked application shows its exact saved request and an explicit Resume checkpoint action.');
        await nativeBlocker(ctx, task.message, {taskId: task.id, status: task.status}); throw new Error('Counter app did not complete: ' + task.message);
      }
      assert(task.evidence?.checks?.length && task.evidence.checks.every(check => check.ok), 'Completed app needs actual host QA checks.');
      const artifact = task.evidence.artifacts.find(item => item.name.endsWith('.zip') && item.smokeTested); assert(artifact, 'Completed app must provide a checked ZIP.');
      const downloadButton = ctx.page.locator('[data-software-task-id="' + task.id + '"]').getByRole('button', {name: 'Download source ZIP', exact: true}); await downloadButton.waitFor();
      const pending = ctx.page.waitForEvent('download'); pending.catch(() => {}); await downloadButton.click(); const download = await pending; await download.saveAs(join(ctx.folder, 'counter-source.zip'));
      const bytes = await (await import('node:fs/promises')).readFile(join(ctx.folder, 'counter-source.zip'));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256); const files = ctx.zipEntries(bytes); assert([...files.keys()].some(name => name.endsWith('package.json')));
      ctx.record.downloads.push({path: 'counter-source.zip', bytes: bytes.length, sha256: artifact.sha256}); ctx.assert('Downloaded app source matches its checked artifact identity.');
      await ctx.inspectCounter(task.id);
    }
  }
];
