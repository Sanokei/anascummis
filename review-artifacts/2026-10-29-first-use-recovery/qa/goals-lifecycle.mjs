import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const require = createRequire('/workspace/anascummis/apps/studio/package.json');
const {chromium} = require('playwright-core');
const base = 'http://127.0.0.1:3211';
let gate, release, analysisCalls = 0;
const releases = [];
function holdAnalysis() {analysisCalls = 0; gate = new Promise(resolve => {release = resolve; releases.push(resolve);});}
holdAnalysis();
const model = createServer(async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') {res.end('{}'); return;}
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url === '/tokenize') {res.end(JSON.stringify({tokens: [1, 2, 3]})); return;}
    const body = JSON.parse(raw), system = body.messages[0].content;
    const packet = JSON.parse(body.messages[1].content.replace(/\n\/no_think$/, ''));
    const schema = body.response_format.json_schema.schema;
    let value;
    if (system.startsWith('Goal planning orchestrator')) {
      const tasks = /cancellation/i.test(packet.goalPage.text) ? [{specialist: 'analysis', description: 'Explain cancellation behavior', acceptance: 'Provide an answer with an explicit verification limit', dependsOn: []}] : [
        {specialist: 'website', description: 'Set website title to Coordinated Oak', acceptance: 'The inspected website title equals Coordinated Oak', dependsOn: []},
        {specialist: 'analysis', description: 'Explain the saved website title change', acceptance: 'Explain the title change using the recorded source and state its verification limit', dependsOn: ['step-1']}
      ];
      value = tasks[packet.existingMilestones.length] ? {action: 'add', message: 'Plan a scoped milestone.', task: tasks[packet.existingMilestones.length]} : {action: 'advance', message: 'All requirements on this page are planned.'};
    } else if (system.startsWith('Independent milestone acceptance') || system.startsWith('Independent goal coverage')) {
      value = {accepted: true, reason: 'The recorded checks and source-linked answer cover the stated requirements.'};
    } else if (system.startsWith('Analysis specialist')) {
      analysisCalls++; await gate;
      value = {response: packet.sources.length ? 'The website title is now Coordinated Oak.' : 'Cancellation stops future decisions and keeps recorded progress.',
        citations: packet.sources.length ? [{id: packet.sources[0].id, quote: 'Coordinated Oak'}] : [],
        uncertainty: 'This answer is limited to the supplied execution record or model knowledge; other facts were not checked.'};
    } else if (schema.properties.index) {
      const finish = packet.choices.find(choice => choice.action.startsWith('All requested actions'));
      value = {index: packet.completed?.length && finish ? finish.index : 0, message: packet.completed?.length ? 'Done.' : ''};
    } else if (schema.properties.agent) value = {agent: 'website', task: 'Set website title to Coordinated Oak', inputs: []};
    else if (schema.properties.field) value = {field: 'title', value: 'Coordinated Oak'};
    else throw new Error('Unexpected schema ' + JSON.stringify(schema));
    res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(value)}, finish_reason: 'stop'}]}));
  } catch (error) {res.statusCode = 500; res.end(JSON.stringify({error: String(error)}));}
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
await mkdir('/workspace/.cloud-env/anascummis/goals-data', {recursive: true});
const data = await mkdtemp('/workspace/.cloud-env/anascummis/goals-data/run-');
const log = createWriteStream(data + '/server.log');
let host, browser;
async function until(check, description) {
  const end = Date.now() + 20000;
  do {try {if (await check()) return;} catch {} await delay(100);} while (Date.now() < end);
  throw new Error('Timed out: ' + description + '; evidence ' + data);
}
async function startHost() {
  host = spawn('/workspace/.cloud-tools/node_modules/.bin/bun', ['core/server.ts'], {
    cwd: '/workspace/anascummis/apps/studio', env: {...process.env, STUDIO_DATA: data, STUDIO_PORT: '3211', MODEL_URL: 'http://127.0.0.1:' + model.address().port}, stdio: ['ignore', 'pipe', 'pipe']
  });
  host.stdout.pipe(log, {end: false}); host.stderr.pipe(log, {end: false});
  await Promise.race([
    until(async () => {
      if (host.exitCode !== null || host.signalCode !== null) return false;
      const response = await fetch(base + '/api/status');
      return response.ok && (await response.json()).model.ready && (await fetch(base + '/api/goals')).ok;
    }, 'fixture startup'),
    new Promise((_, reject) => host.once('exit', code => reject(new Error('Fixture host exited during startup: ' + code))))
  ]);
}
async function stopHost(signal = 'SIGTERM') {
  if (!host || host.exitCode !== null || host.signalCode !== null) return;
  const exit = new Promise(resolve => host.once('exit', resolve)); host.kill(signal); await exit;
}
try {
  await startHost();
  browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true});
  const page = await browser.newPage({viewport:{width:1280,height:800},timezoneId:'America/New_York',reducedMotion: 'reduce'}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/speech-stream', route => route.fulfill({contentType: 'application/x-ndjson', body: ''}));
  async function captureGoals(state) {
    for(const [label,width,height] of [['desktop',1280,800],['narrow',360,800]]) {
      await page.setViewportSize({width,height});
      await until(async()=>{
        const box=await page.locator('.flexlayout__float_window').filter({has:page.locator('.goal-panel')}).boundingBox();
        return box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1;
      },'visible goal window after viewport resize');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow document overflow');
      await page.locator('.goal-panel .goal-state').first().scrollIntoViewIfNeeded();
      await page.screenshot({path:data+'/goals-'+state+'-'+label+'.png'});
    }
    await page.setViewportSize({width:1280,height:800});
  }

  await page.goto(base, {waitUntil: 'networkidle'});
  await page.keyboard.press('Space'); await page.keyboard.press('Space');
  const request = 'Set website title to Coordinated Oak, then explain the saved change.';
  await page.getByRole('textbox', {name: 'Message Anascummis'}).fill('plan this goal: ' + request);
  await page.getByRole('button', {name: 'Send message'}).click();
  await until(() => analysisCalls > 0, 'analysis after accepted website milestone');
  let list = await (await page.request.get(base + '/api/goals')).json();
  const goal = list.find(item => item.request === request);
  assert(goal, 'Goal must preserve the full request');
  assert.equal(goal.tasks[0].status, 'verified');
  assert.equal(goal.tasks[1].status, 'running');
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('region', {name: 'Coordinated goals'}).getByText(request, {exact: true}).waitFor();
  console.log('Passed: planner assigns dependent website/analysis milestones and Goals window restores during execution');

  await stopHost('SIGKILL'); await startHost();
  let saved = await (await page.request.get(base + '/api/goals/' + goal.id)).json();
  assert.equal(saved.status, 'needs_input');
  assert.equal(saved.tasks[0].status, 'verified');
  assert.equal(saved.tasks[1].status, 'needs_input');
  const headers = {Origin: base, 'X-Requested-With': 'Anascummis'};
  await page.reload({waitUntil: 'networkidle'});
  await captureGoals('blocked');
  const resumedCard=page.getByRole('region',{name:'Coordinated goals'}).locator('article.goal-record').filter({has:page.getByText(request,{exact:true})});
  await resumedCard.getByLabel('Guidance for continuing',{exact:true}).fill('Continue the explanation using the saved record. Preserve the verified title edit.');
  for(const [label,width,height] of [['desktop',1280,800],['narrow',360,800]]) {
    await page.setViewportSize({width,height});
    await resumedCard.getByRole('button',{name:'Continue remaining work'}).scrollIntoViewIfNeeded();
    await page.screenshot({path:data+'/goals-resume-'+label+'.png'});
  }
  await page.setViewportSize({width:1280,height:800});
  const continuedResponse=page.waitForResponse(response=>response.url().endsWith('/api/goals/'+goal.id+'/resume')&&response.request().method()==='POST');
  await resumedCard.getByRole('button',{name:'Continue remaining work'}).click();
  const continued=await continuedResponse;assert(continued.ok(),await continued.text());
  release();
  await until(async () => {
    saved = await (await page.request.get(base + '/api/goals/' + goal.id)).json();
    return saved.status === 'completed';
  }, 'acceptance and full-goal review');
  assert(saved.tasks.every(task => task.status === 'verified' && task.execution.verified && task.review.accepted));
  assert.equal(saved.tasks[0].attempts, 1, 'Verified website write must not repeat after restart');
  assert.equal(saved.tasks[1].attempts, 2);
  for (const role of ['planner', 'executor', 'reviewer']) assert(saved.events.some(event => event.role === role));
  const project = await (await page.request.get(base + '/api/projects/' + goal.projectId)).json();
  assert.equal(project.site.title, 'Coordinated Oak'); assert.equal(project.revision, 1);
  const goals = page.getByRole('region', {name: 'Coordinated goals'});
  await goals.locator('.goal-state').filter({hasText: /^Completed/}).waitFor();
  await captureGoals('completed');
  await goals.getByRole('button', {name: 'Open website'}).first().click();
  await page.frameLocator('iframe[title="Website preview"]').getByText('Coordinated Oak', {exact: true}).first().waitFor();
  console.log('Passed: restart preserves verified writes; guided continuation runs analysis, independent acceptance and full-goal coverage checks');

  holdAnalysis();
  const cancelled = await (await page.request.post(base + '/api/goals', {headers, data: {project: goal.projectId, request: 'Explain cancellation behavior'}})).json();
  await until(() => analysisCalls > 0, 'held cancellation analysis');
  const row = goals.locator('article.goal-record').filter({has: page.getByText('Explain cancellation behavior', {exact: true})});
  await row.getByRole('button', {name: 'Stop goal'}).click();
  release();
  await until(async () => (await (await page.request.get(base + '/api/goals/' + cancelled.id)).json()).status === 'cancelled', 'goal Stop');
  await row.locator('.goal-state').filter({hasText: /^Stopped/}).waitFor();
  await page.screenshot({path: data + '/goals.png'});
  assert.deepEqual(errors, []);
  await writeFile(data+'/lifecycle.json',JSON.stringify({fixture:'Scripted inference over the real model HTTP client; real website edits, persistence, browser and acceptance flow. Speech stream simulated.',goal:saved,cancelledGoal:await(await page.request.get(base+'/api/goals/'+cancelled.id)).json(),projectRevision:project.revision,verifiedMilestoneAttempts:saved.tasks.map(task=>task.attempts),abruptRestart:'SIGKILL own backend after the accepted website write, during analysis. Continued through the Goals window without repeating the accepted write.'},null,2));
  console.log('Passed: Goals window Stop prevents late analysis completion');
  console.log('Scripted inference lifecycle evidence:', data);
} finally {
  for (const resolve of releases) resolve();
  await browser?.close(); await stopHost();
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); log.end();
}
