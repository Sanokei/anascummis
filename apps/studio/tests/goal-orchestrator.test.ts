import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GoalOrchestrator, type GoalTask, type GoalExecution, type GoalRecord} from '../core/goal-orchestrator';
import type {Infer} from '../core/model';

type PlannedTask = Pick<GoalTask, 'specialist' | 'description' | 'acceptance' | 'dependsOn'>;
const title: PlannedTask = {specialist: 'website', description: 'Set the website title to Oak Studio', acceptance: 'Inspected website title is Oak Studio', dependsOn: []};
const scene: PlannedTask = {specialist: 'scene', description: 'Add the requested sphere', acceptance: 'Inspected scene includes the requested sphere', dependsOn: ['step-1']};
const evidence = (message = 'Host inspection matches the requested change.'): GoalExecution => ({message, verified: true, evidence: ['host:inspection:revision-1']});
const accepted = {accepted: true, reason: 'The recorded host checks satisfy the requested criterion.'};
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2));

async function waitFor(queue: GoalOrchestrator, id: string, predicate: (goal: GoalRecord) => boolean) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const goal = queue.get(id);
    if (predicate(goal)) return goal;
    await pause();
  }
  throw new Error('Goal did not reach the expected state: ' + JSON.stringify(queue.get(id)));
}

function planner(tasks: PlannedTask[], reviews: (role: string) => unknown = () => accepted, pages = new Map<number, string>()): Infer {
  return async (system, raw) => {
    const packet = JSON.parse(raw);
    if (system.startsWith('Goal planning orchestrator')) {
      pages.set(packet.goalPage.offset, packet.goalPage.text);
      const next = tasks[packet.existingMilestones.length];
      return next ? {action: 'add', message: 'A bounded task is needed.', task: next} : {action: 'advance', message: 'This goal page is represented.'};
    }
    return reviews(system);
  };
}

test('distinct planner, specialist execution and independent reviewer complete dependency-ordered work', async () => {
  const db = new Database(':memory:');
  const roles: string[] = [], executed: string[] = [];
  const generate = planner([title, scene]);
  const queue = new GoalOrchestrator(db, {
    infer: async (...args) => {roles.push(args[0]); return generate(...args);},
    execute: async task => {executed.push(task.id); return evidence();}
  });
  try {
    const goal = queue.create({request: 'Set title to Oak Studio, then add a sphere.', projectId: 'project-1'});
    queue.start();
    const done = await waitFor(queue, goal.id, value => value.status === 'completed');
    expect(executed).toEqual(['step-1', 'step-2']);
    expect(done.tasks.map(task => task.status)).toEqual(['verified', 'verified']);
    expect(done.tasks.every(task => task.execution?.verified && task.review?.accepted)).toBe(true);
    expect(roles.some(role => role.startsWith('Goal planning orchestrator'))).toBe(true);
    expect(roles.filter(role => role.startsWith('Independent milestone acceptance'))).toHaveLength(2);
    expect(roles.some(role => role.startsWith('Independent goal coverage'))).toBe(true);
    expect(done.events.map(event => event.role)).toContain('executor');
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('the complete long goal is read and coverage-reviewed in persisted pages without truncating it', async () => {
  const db = new Database(':memory:'), pages = new Map<number, string>(), reviewed = new Map<number, string>();
  const request = 'Preserve this exact goal. ' + 'A distinct acceptance detail must remain recorded; '.repeat(57);
  const generate = planner([title], () => accepted, pages);
  const queue = new GoalOrchestrator(db, {
    infer: async (...args) => {
      if (args[0].startsWith('Independent goal coverage')) {const packet = JSON.parse(args[1]); reviewed.set(packet.goalPage.offset, packet.goalPage.text);}
      return generate(...args);
    }, execute: async () => evidence()
  });
  try {
    const goal = queue.create({request, projectId: 'project-1'});
    queue.start();
    const done = await waitFor(queue, goal.id, value => value.status === 'completed');
    expect(done.request).toBe(request);
    expect([...pages].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('')).toBe(request);
    expect([...reviewed].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('')).toBe(request);
    expect(done.planningOffset).toBe(request.length);
    expect(done.coverageOffset).toBe(request.length);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('a specialist completion claim without host evidence cannot reach acceptance or completion', async () => {
  const db = new Database(':memory:');
  let reviews = 0;
  const queue = new GoalOrchestrator(db, {
    infer: planner([title], () => {reviews++; return accepted;}),
    execute: async () => ({message: 'I finished it.', verified: false, evidence: ['model:assertion']})
  });
  try {
    const goal = queue.create({request: 'Set the website title.', projectId: 'project-1'});
    queue.start();
    const blocked = await waitFor(queue, goal.id, value => value.status === 'needs_input');
    expect(blocked.message).toContain('host-verified evidence');
    expect(blocked.tasks[0].status).toBe('needs_input');
    expect(blocked.tasks[0].execution?.verified).toBe(false);
    expect(reviews).toBe(0);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('acceptance rejection is retained and only unverified milestones execute again after explicit guidance', async () => {
  const db = new Database(':memory:');
  let rejectSecond = true;
  const executed: string[] = [];
  const queue = new GoalOrchestrator(db, {
    infer: planner([title, scene], role => {
      if (role.startsWith('Independent milestone') && executed.at(-1) === 'step-2' && rejectSecond) return {accepted: false, reason: 'The sphere dimensions were not checked.'};
      return accepted;
    }),
    execute: async (task, goal) => {executed.push(task.id); if (goal.guidance) expect(goal.guidance).toBe('Check the actual sphere dimensions.'); return evidence();}
  });
  try {
    const goal = queue.create({request: 'Set the title and add a sphere.', projectId: 'project-1'});
    queue.start();
    const blocked = await waitFor(queue, goal.id, value => value.status === 'needs_input');
    expect(blocked.tasks[0].status).toBe('verified');
    expect(blocked.tasks[1].review).toEqual({accepted: false, reason: 'The sphere dimensions were not checked.'});
    rejectSecond = false;
    queue.resume(goal.id, 'Check the actual sphere dimensions.');
    const done = await waitFor(queue, goal.id, value => value.status === 'completed');
    expect(executed).toEqual(['step-1', 'step-2', 'step-2']);
    expect(done.notes).toEqual(['Check the actual sphere dimensions.']);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('final goal-coverage review rejects an incomplete plan even when every planned milestone passed', async () => {
  const db = new Database(':memory:');
  const queue = new GoalOrchestrator(db, {
    infer: planner([title], role => role.startsWith('Independent goal coverage')
      ? {accepted: false, reason: 'The requested PDF correction has not been represented.'} : accepted),
    execute: async () => evidence()
  });
  try {
    const goal = queue.create({request: 'Set the title and correct the PDF.', projectId: 'project-1', documentId: 'doc-1'});
    queue.start();
    const blocked = await waitFor(queue, goal.id, value => value.status === 'needs_input');
    expect(blocked.tasks[0].status).toBe('verified');
    expect(blocked.phase).toBe('coverage_rejected');
    expect(blocked.message).toContain('PDF correction');
    expect(blocked.coverageDone).toBe(false);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('capability and dependency restrictions stop unsupported work before execution', async () => {
  for (const unsupported of [
    {...title, specialist: 'pdf' as const},
    {...title, specialist: 'research' as const},
    {...title, dependsOn: ['step-2']},
    {...title, specialist: 'software' as const}
  ]) {
    const db = new Database(':memory:');
    let executions = 0;
    const queue = new GoalOrchestrator(db, {allowedSpecialists: ['analysis', 'website', 'pdf', 'research'], infer: planner([unsupported]), execute: async () => {executions++; return evidence();}});
    try {
      const goal = queue.create({request: 'Do the requested task.', projectId: 'project-1'});
      queue.start();
      const blocked = await waitFor(queue, goal.id, value => value.status === 'needs_input');
      expect(blocked.status).toBe('needs_input');
      expect(executions).toBe(0);
      expect(blocked.tasks).toHaveLength(0);
    } finally {queue.shutdown(); await pause(); db.close();}
  }
});

test('cancellation stays authoritative when a non-cooperative executor returns a late success', async () => {
  const db = new Database(':memory:');
  let release!: (value: GoalExecution) => void;
  const pending = new Promise<GoalExecution>(resolve => {release = resolve;});
  const queue = new GoalOrchestrator(db, {infer: planner([title]), execute: async () => pending});
  try {
    const goal = queue.create({request: 'Set a title.', projectId: 'project-1'});
    queue.start();
    await waitFor(queue, goal.id, value => value.tasks[0]?.status === 'running');
    queue.stop(goal.id);
    const stopped = queue.get(goal.id);
    const stoppedActivity = queue.activity(goal.id, 100);
    release(evidence());
    await pause(); await pause();
    expect(queue.get(goal.id)).toEqual(stopped);
    expect(queue.activity(goal.id, 100)).toEqual(stoppedActivity);
    expect(queue.get(goal.id).tasks[0].review).toBeUndefined();
    expect(queue.get(goal.id).status).toBe('cancelled');
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('reopening the database preserves verified work and pauses an uncertain write instead of replaying it', async () => {
  const root = mkdtempSync(join(process.env.STUDIO_TEST_DATA || tmpdir(), 'goal-orchestrator-'));
  let db = new Database(join(root, 'goals.sqlite'));
  let executions = 0;
  const options = {infer: planner([title, scene]), execute: async () => {executions++; return evidence();}};
  let queue = new GoalOrchestrator(db, options);
  try {
    const goal = queue.create({request: 'Set the title and add a sphere.', projectId: 'project-1'});
    goal.status = 'running'; goal.planningDone = true; goal.planningOffset = goal.request.length;
    goal.tasks = [
      {...title, id: 'step-1', attempts: 1, status: 'verified', execution: evidence(), review: accepted},
      {...scene, id: 'step-2', attempts: 1, status: 'running'}
    ];
    db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(goal), goal.id);
    db.close();
    db = new Database(join(root, 'goals.sqlite'));
    queue = new GoalOrchestrator(db, options);
    queue.start();
    const restored = queue.get(goal.id);
    expect(restored.status).toBe('needs_input');
    expect(restored.tasks.map(task => task.status)).toEqual(['verified', 'needs_input']);
    expect(restored.message).toContain('edits were not replayed');
    expect(executions).toBe(0);
    queue.resume(goal.id, 'I reviewed the scene; finish its remaining work.');
    const done = await waitFor(queue, goal.id, value => value.status === 'completed');
    expect(executions).toBe(1);
    expect(done.tasks[0].attempts).toBe(1);
    expect(done.tasks[1].attempts).toBe(2);
  } finally {queue.shutdown(); await pause(); db.close(); rmSync(root, {recursive: true, force: true});}
});

test('a restored milestone with saved host evidence is reviewed without executing its write twice', async () => {
  const db = new Database(':memory:');
  let executions = 0;
  const queue = new GoalOrchestrator(db, {infer: planner([title]), execute: async () => {executions++; return evidence();}});
  try {
    const goal = queue.create({request: 'Set the title.', projectId: 'project-1'});
    goal.status = 'running'; goal.planningDone = true;
    goal.tasks = [{...title, id: 'step-1', status: 'running', attempts: 1, execution: evidence()}];
    db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(goal), goal.id);
    queue.start();
    expect(queue.get(goal.id).status).toBe('needs_input');
    queue.resume(goal.id);
    const done = await waitFor(queue, goal.id, value => value.status === 'completed');
    expect(executions).toBe(0);
    expect(done.tasks[0].review?.accepted).toBe(true);
    expect(done.tasks[0].attempts).toBe(1);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('one software milestone owns the whole app instead of creating separate apps for dependent edits', async () => {
  const db = new Database(':memory:');
  let executions = 0;
  const tasks: PlannedTask[] = [
    {specialist: 'software', description: 'Build the counter application', acceptance: 'The whole requested app passes runtime and artifact checks', dependsOn: []},
    {specialist: 'software', description: 'Add a reset button to that application', acceptance: 'The reset button updates that same app', dependsOn: ['step-1']}
  ];
  const queue = new GoalOrchestrator(db, {infer: planner(tasks), execute: async () => {executions++; return evidence();}});
  try {
    const parent = queue.create({request: 'Build a counter app with an Increment button and Reset button.', projectId: 'project-1'});
    queue.start();
    const blocked = await waitFor(queue, parent.id, value => value.status === 'needs_input');
    expect(blocked.tasks).toHaveLength(1);
    expect(blocked.message).toContain('one software milestone');
    expect(executions).toBe(0);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('a rejected software acceptance reason survives repeated guided retries', async () => {
  const db = new Database(':memory:');
  const reasons: GoalTask['retryReason'][] = [];
  const queue = new GoalOrchestrator(db, {
    infer: planner([{specialist: 'software', description: 'Build the app', acceptance: 'The complete application passes requested checks', dependsOn: []}], role => role.startsWith('Independent milestone') ? {accepted: false, reason: 'The requested reset button was not checked.'} : accepted),
    execute: async task => {
      reasons.push(task.retryReason);
      return task.retryReason === 'acceptance_rejected' ? {message: 'Guided repair was not applied.', verified: false, evidence: ['unchanged build']} : evidence();
    }
  });
  try {
    const parent = queue.create({request: 'Build the app with its reset behavior.', projectId: 'project-1'});
    queue.start();
    await waitFor(queue, parent.id, value => value.status === 'needs_input');
    queue.resume(parent.id, 'Implement the missing reset behavior.');
    await waitFor(queue, parent.id, value => value.status === 'needs_input');
    queue.resume(parent.id, 'Retry after reviewing the same completed artifacts.');
    const blocked = await waitFor(queue, parent.id, value => value.status === 'needs_input');
    expect(reasons).toEqual([undefined, 'acceptance_rejected', 'acceptance_rejected']);
    expect(blocked.tasks[0].execution?.verified).toBe(false);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('a restored multi-software plan is rejected before separate application workspaces can run', async () => {
  const db = new Database(':memory:');
  let executions = 0;
  const queue = new GoalOrchestrator(db, {infer: planner([]), execute: async () => {executions++; return evidence();}});
  try {
    const parent = queue.create({request: 'Build one complete app.', projectId: 'project-1'});
    parent.planningDone = true;
    parent.tasks = [
      {...title, specialist: 'software', id: 'step-1', status: 'pending', attempts: 0},
      {...scene, specialist: 'software', id: 'step-2', status: 'pending', attempts: 0}
    ];
    db.query('UPDATE goal_tasks SET body=? WHERE id=?').run(JSON.stringify(parent), parent.id);
    queue.start();
    const blocked = await waitFor(queue, parent.id, value => value.status === 'needs_input');
    expect(blocked.message).toContain('whole application acceptance contract');
    expect(executions).toBe(0);
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('only a validated host software child reference is retained in milestone execution evidence', async () => {
  const db = new Database(':memory:'), softwareTaskId = crypto.randomUUID();
  const queue = new GoalOrchestrator(db, {
    infer: planner([{specialist: 'software', description: 'Build one complete application', acceptance: 'The complete application passes all requested checks', dependsOn: []}]),
    execute: async () => ({...evidence(), softwareTaskId, untrustedExtra: 'Do not persist arbitrary executor properties'})
  });
  try {
    const parent = queue.create({request: 'Build the requested application.', projectId: 'project-1'});
    queue.start();
    const done = await waitFor(queue, parent.id, value => value.status === 'completed');
    expect(done.tasks[0].execution?.softwareTaskId).toBe(softwareTaskId);
    expect(JSON.stringify(done.tasks[0].execution)).not.toContain('untrustedExtra');
  } finally {queue.shutdown(); await pause(); db.close();}
});

test('malformed or non-software child references cannot become trusted task links', async () => {
  for (const [specialist, softwareTaskId] of [['software', 'not-a-uuid'], ['website', crypto.randomUUID()]] as const) {
    const db = new Database(':memory:');
    const queue = new GoalOrchestrator(db, {
      infer: planner([{...title, specialist}]), execute: async () => ({...evidence(), softwareTaskId})
    });
    try {
      const parent = queue.create({request: 'Perform the requested task.', projectId: 'project-1'});
      queue.start();
      const blocked = await waitFor(queue, parent.id, value => value.status === 'needs_input');
      expect(blocked.message).toContain('invalid software child reference');
      expect(blocked.tasks[0].execution).toBeUndefined();
    } finally {queue.shutdown(); await pause(); db.close();}
  }
});
