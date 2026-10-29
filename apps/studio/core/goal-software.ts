import type {Database} from 'bun:sqlite';
import {db} from './storage';
import {createSoftwareTask, createSoftwareRevision, softwareTask, resumeSoftwareTask, stopSoftwareTask, type SoftwareTask} from './software-task';
import type {GoalExecution, GoalRecord, GoalTask} from './goal-orchestrator';

export type GoalSoftwareStore = {
  create: (request: string, targets: ('zip' | 'exe')[], onSaved: (task: SoftwareTask) => void) => Promise<SoftwareTask>;
  get: (id: string) => SoftwareTask;
  resume: (id: string, note: string) => SoftwareTask;
  stop: (id: string) => SoftwareTask;
  revise?: (parentId: string, note: string, onSaved: (task: SoftwareTask) => void) => Promise<SoftwareTask>;
};

/** The link is committed with the initial software task before its worker can run. */
export class GoalSoftwareBridge {
  constructor(private database: Database, private store: GoalSoftwareStore, private wait = () => new Promise<void>(resolve => setTimeout(resolve, 250))) {
    database.exec('CREATE TABLE IF NOT EXISTS goal_software_links(goal TEXT NOT NULL,milestone TEXT NOT NULL,software TEXT NOT NULL,PRIMARY KEY(goal,milestone))');
  }

  private link(goal: string, milestone: string) {
    return this.database.query('SELECT software FROM goal_software_links WHERE goal=? AND milestone=?').get(goal, milestone) as {software: string} | null;
  }

  links(goal: string): Record<string, string> {
    const rows = this.database.query('SELECT milestone,software FROM goal_software_links WHERE goal=?').all(goal) as {milestone: string; software: string}[];
    return Object.fromEntries(rows.map(row => [row.milestone, row.software]));
  }

  private stopBuild(id: string) {
    let build: SoftwareTask;
    try {build = this.store.get(id);} catch (error) {
      if (error instanceof Error && error.message === 'Software task not found') return;
      throw error;
    }
    if (!['completed', 'cancelled'].includes(build.status)) this.store.stop(id);
  }

  stopGoal(goalId: string) {
    const links = this.database.query('SELECT software FROM goal_software_links WHERE goal=?').all(goalId) as {software: string}[];
    for (const link of links) this.stopBuild(link.software);
  }

  reconcile(goals: GoalRecord[]) {
    const parents = new Map(goals.map(goal => [goal.id, goal]));
    const links = this.database.query('SELECT goal,software FROM goal_software_links').all() as {goal: string; software: string}[];
    for (const link of links) {
      const parent = parents.get(link.goal);
      if (parent && ['needs_input', 'cancelled'].includes(parent.status)) this.stopBuild(link.software);
    }
  }

  async execute(task: GoalTask, goal: GoalRecord, request: string, signal: AbortSignal, isShuttingDown: () => boolean): Promise<GoalExecution> {
    signal.throwIfAborted();
    let link = this.link(goal.id, task.id);
    let build: SoftwareTask;
    if (link) {
      build = this.store.get(link.software);
      if (build.status === 'completed' && task.retryReason === 'acceptance_rejected') {
        if (!this.store.revise) return {
          message: 'The linked software build is already completed, but its parent acceptance review rejected it. Guided repair of completed builds is not connected; the guidance was not applied. Review the saved build and start a new software goal with the corrected whole-app requirements.',
          verified: false, evidence: ['Unchanged completed software build: ' + build.id], softwareTaskId: build.id
        };
        if (!goal.guidance?.trim()) return {message:'Provide specific revision guidance before creating a child of the completed build.',verified:false,evidence:['Accepted software build remains unchanged: '+build.id],softwareTaskId:build.id};
        const parentId=build.id;
        build=await this.store.revise(parentId,goal.guidance,saved=>{
          signal.throwIfAborted();
          if(!this.database.inTransaction)throw new Error('Software revision and goal link must be saved in one transaction');
          const changed=this.database.query('UPDATE goal_software_links SET software=? WHERE goal=? AND milestone=? AND software=?').run(saved.id,goal.id,task.id,parentId);
          if(changed.changes!==1)throw new Error('The goal child link changed while its revision was being prepared');
        });
      }
      if (task.attempts > 1 && ['needs_input', 'cancelled'].includes(build.status)) build = this.store.resume(build.id, goal.guidance || 'Continue the saved acceptance requirements.');
    } else {
      const wholeApp = 'Complete original goal:\n' + goal.request + '\n\nWhole-application software milestone and acceptance:\n' + request;
      try {
        build = await this.store.create(wholeApp, /\b(windows|exe|executable)\b/i.test(wholeApp) ? ['zip', 'exe'] : ['zip'], saved => {
          signal.throwIfAborted();
          if (!this.database.inTransaction) throw new Error('Software task and goal link must be saved in one transaction');
          this.database.query('INSERT INTO goal_software_links(goal,milestone,software) VALUES(?,?,?)').run(goal.id, task.id, saved.id);
        });
      } catch (error) {
        signal.throwIfAborted();
        // A concurrent identical request may have committed its task and link first.
        link = this.link(goal.id, task.id);
        if (!link) throw error;
        build = this.store.get(link.software);
      }
      const saved = this.link(goal.id, task.id);
      if (!saved || saved.software !== build.id) throw new Error('Software creation did not persist its goal link');
    }
    const id = build.id;
    const stop = () => {if (!isShuttingDown()) this.stopBuild(id);};
    signal.addEventListener('abort', stop, {once: true});
    if (signal.aborted) stop();
    try {
      signal.throwIfAborted();
      for (;;) {
        signal.throwIfAborted();
        const current = this.store.get(id);
        if (current.status === 'completed') {
          const evidence = current.evidence;
          const verified = !!evidence && evidence.revision === current.revision && evidence.checks.length > 0 && evidence.checks.every(check => check.ok)
            && current.targets.every(kind => evidence.artifacts.some(artifact => artifact.kind === kind && artifact.smokeTested));
          return {message: current.message, verified, softwareTaskId: id, evidence: [
            'Saved software build: ' + id,
            'Observed production headings: ' + JSON.stringify(evidence?.headings || []),
            JSON.stringify({kind:'production_dom_excerpt',offset:0,availableCharacters:evidence?.dom.length||0,text:evidence?.dom.slice(0,600)||'',complete:(evidence?.dom.length||0)<=600}),
            ...(evidence?.checks.map(check => `${check.ok ? 'Passed' : 'Failed'}: ${check.id}`) || []),
            ...(evidence?.artifacts.map(artifact => `${artifact.smokeTested ? 'Smoke-tested' : 'Unverified'} artifact: ${artifact.name}`) || [])
          ]};
        }
        if (['needs_input', 'cancelled'].includes(current.status)) return {message: current.message, verified: false, softwareTaskId: id, evidence: ['Saved software build: ' + id]};
        await this.wait();
      }
    } finally {signal.removeEventListener('abort', stop);}
  }
}

const bridge = new GoalSoftwareBridge(db, {create: createSoftwareTask, revise:createSoftwareRevision, get: softwareTask, resume: resumeSoftwareTask, stop: stopSoftwareTask});
export const executeGoalSoftware = (task: GoalTask, goal: GoalRecord, request: string, signal: AbortSignal, isShuttingDown: () => boolean = () => false) => bridge.execute(task, goal, request, signal, isShuttingDown);
export const stopGoalSoftware = (goalId: string): void => bridge.stopGoal(goalId);
export const reconcileGoalSoftware = (goals: GoalRecord[]): void => bridge.reconcile(goals);
export const goalSoftwareLinks = (goalId: string): Record<string, string> => bridge.links(goalId);
