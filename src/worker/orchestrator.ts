import type {
  Citation,
  Identity,
  InkChoiceView,
  PendingConfirmation,
  Turn,
  TurnResponse,
} from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from './env';
import { CapabilityRegistry } from './registry/registry';
import { buildRegistry } from './registry/natives';
import { Dispatcher } from './registry/dispatcher';
import { TaskBudget, TURN_LIMITS } from './policy/budget';
import { PermissionEnvelope, defaultEnvelope } from './policy/permissions';
import { MemoryManager, type Mission } from './memory/manager';
import { SessionClient, type SessionSnapshot } from './do/session-coordinator';
import { SkillHarness } from './skills/harness';
import { resolveChoice } from './ink/resolver';
import { evaluate, chooseIndex, type ActionOutcome } from './ink/runtime';
import { capabilityIdToExternalName } from './ink/harness';
import { chat, resolveRoute, type ChatMessage } from './providers/model';
import { findAuthoredLine, VOICE_GUIDANCE, classifyTurnIntent } from './ink/personality';
import { getStory, OPEN_CONVERSATION_ID } from './stories/registry';
import { randomId } from './crypto';

/**
 * One conversational turn.
 *
 * The normal path uses cached context and installed capabilities. It does not
 * regenerate Ink, walk the whole history graph, summarise memory, or wait on
 * unrelated work. Anything slower has to earn its place.
 */

export interface TurnRequest {
  identity: Identity;
  text: string;
  rawTranscript?: string;
  /** Set when the user pressed a numbered choice rather than speaking. */
  choiceIndex?: number;
  /** Set when the user answered a pending confirmation. */
  confirmationToken?: string;
  signal: AbortSignal;
}

export class Orchestrator {
  private readonly registry: CapabilityRegistry;
  private readonly dispatcher: Dispatcher;
  private readonly memory: MemoryManager;
  private readonly skills: SkillHarness;

  constructor(private readonly env: Env) {
    this.registry = buildRegistry(env);
    this.dispatcher = new Dispatcher(env, this.registry);
    this.memory = new MemoryManager(env);
    this.skills = new SkillHarness(env, this.registry);
  }

  async handleTurn(req: TurnRequest): Promise<Result<TurnResponse>> {
    const client = new SessionClient(this.env, req.identity.sessionId);
    const snapshot = await client.snapshot();
    const begun = await client.beginTurn();
    const generation = begun.generation;

    const budget = TaskBudget.restore(
      `turn:${req.identity.sessionId}:${generation}`,
      TURN_LIMITS,
      null,
      begun.budgetStartedAt,
    );

    const config = await this.memory.loadConfig(req.identity);
    const permissions = defaultEnvelope(req.identity);
    const mission = missionFrom(snapshot);

    const userTurn: Turn = {
      id: randomId('turn'),
      role: 'user',
      text: req.text,
      at: new Date().toISOString(),
      ...(req.rawTranscript ? { rawTranscript: req.rawTranscript } : {}),
    };

    // A pending confirmation is answered before anything else is considered.
    if (snapshot.pendingConfirmation && req.confirmationToken) {
      return this.resumeConfirmed(req, snapshot, generation, budget, permissions, userTurn, client);
    }

    const story = getStory(snapshot.storyId ?? OPEN_CONVERSATION_ID);
    if (!story) {
      return fail('missing-capability', 'The active story version is no longer available.');
    }

    // Existing choices, so the resolver has something to interpret against.
    const currentView = await evaluate({
      compiled: story.compiled,
      stateJson: snapshot.runtimeState,
      entryKnot: snapshot.runtimeState ? null : story.entryKnot,
      memo: new Map(),
      readableConfig: readableConfig(config),
      riskFor: (id) => this.riskFor(id),
    });
    if (!currentView.ok) return currentView;

    let choices = currentView.value.choices;
    let stateJson = currentView.value.stateJson;

    // Direct selection needs no resolver at all.
    let selected: number | null = typeof req.choiceIndex === 'number' ? req.choiceIndex : null;
    let deviation = false;
    let clarification: string | null = null;

    if (selected === null && choices.length > 0) {
      const resolved = await resolveChoice(this.env, {
        utterance: req.text,
        choices,
        recentContext: recentContextOf(snapshot.turns),
        budget,
        signal: req.signal,
      });
      if (!resolved.ok) return resolved;

      switch (resolved.value.kind) {
        case 'match':
          selected = resolved.value.index;
          break;
        case 'clarify':
          clarification = resolved.value.question;
          break;
        case 'deviation':
          deviation = true;
          break;
        case 'navigate-back':
          return this.respondPlainly(
            req,
            snapshot,
            generation,
            budget,
            userTurn,
            client,
            choices,
            stateJson,
            story.id,
            story.version,
            'Use the branch list to pick the point you want. Going back branches from there; it does not erase what came after.',
          );
        case 'stop':
          await client.stop();
          return this.respondPlainly(
            req,
            snapshot,
            generation,
            budget,
            userTurn,
            client,
            [],
            stateJson,
            story.id,
            story.version,
            'Stopped.',
          );
      }
    } else if (selected === null) {
      deviation = true;
    }

    if (clarification) {
      return this.respondPlainly(
        req,
        snapshot,
        generation,
        budget,
        userTurn,
        client,
        choices,
        stateJson,
        story.id,
        story.version,
        clarification,
      );
    }

    // A selected branch advances the story and may request an action.
    if (selected !== null) {
      const chosen = chooseIndex(story.compiled, stateJson, selected);
      if (!chosen.ok) return chosen;
      stateJson = chosen.value;

      const advanced = await this.runToCompletion({
        compiled: story.compiled,
        stateJson,
        identity: req.identity,
        permissions,
        budget,
        generation,
        signal: req.signal,
        confirmationMode: config.dialogue.confirmationMode,
        confirmationToken: req.confirmationToken ?? null,
        readable: readableConfig(config),
      });
      if (!advanced.ok) return advanced;

      if (advanced.value.confirmation) {
        return this.commit({
          req,
          client,
          generation,
          budget,
          userTurn,
          assistantText: describeConfirmation(advanced.value.confirmation),
          choices: [],
          stateJson: advanced.value.stateJson,
          storyId: story.id,
          storyVersion: story.version,
          confirmation: advanced.value.confirmation,
          citations: advanced.value.citations,
          mission,
          blocked: null,
        });
      }

      return this.commit({
        req,
        client,
        generation,
        budget,
        userTurn,
        assistantText: advanced.value.text,
        choices: advanced.value.choices,
        stateJson: advanced.value.stateJson,
        storyId: story.id,
        storyVersion: story.version,
        confirmation: null,
        citations: advanced.value.citations,
        mission,
        blocked: advanced.value.blocked,
      });
    }

    // Deviation: handled as conversation, without touching the pending decision.
    void deviation;
    const reply = await this.converse({
      req,
      snapshot,
      budget,
      permissions,
      generation,
      mission,
      pendingChoices: choices,
    });
    if (!reply.ok) return reply;

    return this.commit({
      req,
      client,
      generation,
      budget,
      userTurn,
      assistantText: reply.value.text,
      // The unresolved decision is still on offer after the detour.
      choices,
      stateJson,
      storyId: story.id,
      storyVersion: story.version,
      confirmation: null,
      citations: reply.value.citations,
      mission: reply.value.mission,
      blocked: reply.value.blocked,
      ...(reply.value.authoredLineId ? { authoredLineId: reply.value.authoredLineId } : {}),
      ...(reply.value.activeSkill ? { activeSkill: reply.value.activeSkill } : {}),
    });
  }

  /* ---------------- story evaluation with the action gate ---------------- */

  private async runToCompletion(input: {
    compiled: string;
    stateJson: string;
    identity: Identity;
    permissions: PermissionEnvelope;
    budget: TaskBudget;
    generation: number;
    signal: AbortSignal;
    confirmationMode: 'always' | 'risky-only' | 'off';
    confirmationToken: string | null;
    readable: Record<string, string | number | boolean>;
  }): Promise<
    Result<{
      text: string;
      choices: InkChoiceView[];
      stateJson: string;
      citations: Citation[];
      confirmation: PendingConfirmation | null;
      blocked: { kind: import('@shared/types').FailureKind; message: string } | null;
    }>
  > {
    const memo = new Map<string, ActionOutcome>();
    const citations: Citation[] = [];
    let text = '';
    let passes = 0;

    for (;;) {
      if (++passes > TURN_LIMITS.dispatches + 2) {
        return fail('budget-exhausted', 'The story kept requesting actions past its dispatch budget.');
      }

      const run = await evaluate({
        compiled: input.compiled,
        stateJson: input.stateJson,
        entryKnot: null,
        memo,
        readableConfig: input.readable,
        riskFor: (id) => this.riskFor(id),
      });
      if (!run.ok) return run;

      // Text accumulates across passes because replay re-emits from the same
      // snapshot; only the final pass's text is kept.
      text = run.value.text;

      const pending = run.value.pendingAction;
      if (!pending) {
        return ok({
          text,
          choices: run.value.choices,
          stateJson: run.value.stateJson,
          citations,
          confirmation: null,
          blocked: null,
        });
      }

      const outcome = await this.dispatcher.dispatch({
        capabilityId: pending.capabilityId,
        args: argsFor(pending.args),
        identity: input.identity,
        permissions: input.permissions,
        budget: input.budget,
        confirmationMode: input.confirmationMode,
        generation: input.generation,
        signal: input.signal,
        ...(input.confirmationToken ? { confirmationToken: input.confirmationToken } : {}),
      });

      if (outcome.kind === 'confirmation-required') {
        return ok({
          text,
          choices: [],
          stateJson: input.stateJson,
          citations,
          confirmation: outcome.confirmation,
          blocked: null,
        });
      }

      if (outcome.kind === 'failure') {
        // A failure is memoised too, so the story can narrate an honest
        // unavailable state rather than looping on the same call.
        memo.set(pending.memoKey, { kind: 'failure', message: outcome.failure.message });
        if (outcome.failure.kind === 'budget-exhausted' || outcome.failure.kind === 'cancelled') {
          return ok({
            text,
            choices: [],
            stateJson: input.stateJson,
            citations,
            confirmation: null,
            blocked: { kind: outcome.failure.kind, message: outcome.failure.message },
          });
        }
        continue;
      }

      memo.set(pending.memoKey, { kind: 'value', value: outcome.value });
      for (const citation of extractCitations(outcome.value)) citations.push(citation);
    }
  }

  /* ---------------- open conversation ---------------- */

  private async converse(input: {
    req: TurnRequest;
    snapshot: SessionSnapshot;
    budget: TaskBudget;
    permissions: PermissionEnvelope;
    generation: number;
    mission: Mission;
    pendingChoices: InkChoiceView[];
  }): Promise<
    Result<{
      text: string;
      citations: Citation[];
      mission: Mission;
      authoredLineId?: string;
      activeSkill?: { name: string; version: string; origin: string };
      blocked: { kind: import('@shared/types').FailureKind; message: string } | null;
    }>
  > {
    // An approved line for a recurring situation is reused verbatim, and costs
    // nothing.
    const authored = findAuthoredLine(input.req.text);
    if (authored) {
      return ok({
        text: authored.line.text,
        citations: [],
        mission: input.mission,
        authoredLineId: authored.line.id,
        blocked: null,
      });
    }

    // A brief acknowledgement does not need a turn of its own.
    if (classifyTurnIntent(input.req.text) === 'continue') {
      return ok({ text: '', citations: [], mission: input.mission, blocked: null });
    }

    const route = resolveRoute(this.env);
    if (route.provider === 'none') {
      return ok({
        text: 'There is no conversational model configured on this deployment, so I cannot answer that. Everything else here still works.',
        citations: [],
        mission: input.mission,
        blocked: { kind: 'missing-credential', message: route.reason },
      });
    }

    // A skill activates only when one genuinely helps.
    const selection = await this.skills.select({
      intent: input.req.text,
      identity: input.req.identity,
      permissions: input.permissions,
    });

    let skillInstructions = '';
    let activeSkill: { name: string; version: string; origin: string } | undefined;
    if (selection.kind === 'selected') {
      const activated = await this.skills.activate(
        input.req.identity,
        selection.skill,
        input.permissions,
      );
      if (activated.ok) {
        skillInstructions = activated.value.instructions;
        activeSkill = {
          name: selection.skill.qualifiedName,
          version: selection.skill.revision,
          origin: selection.skill.origin,
        };
      }
    } else if (selection.kind === 'blocked') {
      return ok({
        text: `I can see a procedure for that, but it is blocked: ${selection.reason}`,
        citations: [],
        mission: input.mission,
        blocked: { kind: 'missing-permission', message: selection.reason },
      });
    }

    const context = await this.memory.assemble({
      identity: input.req.identity,
      mission: input.mission,
      recentTurns: input.snapshot.turns,
      query: input.req.text,
    });

    const tools = await this.toolDefinitions(input.permissions);
    const messages: ChatMessage[] = [
      { role: 'system', content: `${VOICE_GUIDANCE}\n\n${context.layers.map((l) => l.body).join('\n\n')}` },
      ...(skillInstructions ? [{ role: 'system' as const, content: skillInstructions }] : []),
      ...(input.pendingChoices.length > 0
        ? [
            {
              role: 'system' as const,
              content: `A decision is still open and will be offered again after this: ${input.pendingChoices
                .map((c) => c.text)
                .join(' / ')}. Answer the question that was asked; do not resolve the decision for them.`,
            },
          ]
        : []),
      ...input.snapshot.turns.slice(-8).map((t) => ({
        role: t.role === 'system' ? ('assistant' as const) : (t.role as 'user' | 'assistant'),
        content: t.text,
      })),
      { role: 'user', content: input.req.text },
    ];

    const citations: Citation[] = [];
    const capabilityVersions: string[] = [];
    let reply = '';

    // Bounded tool loop. Every proposed call goes through the dispatcher, so
    // the model never executes anything itself.
    for (let step = 0; step < 4; step++) {
      const res = await chat(this.env, {
        messages,
        tools,
        temperature: 0.5,
        maxTokens: 900,
        signal: input.req.signal,
      });
      if (!res.ok) {
        return ok({
          text: 'I could not reach the model just then.',
          citations,
          mission: input.mission,
          blocked: { kind: res.kind, message: res.message },
        });
      }
      input.budget.chargeModelTokens(res.value.usage.promptTokens + res.value.usage.completionTokens);

      if (res.value.toolCalls.length === 0) {
        reply = res.value.text.trim();
        break;
      }

      messages.push({ role: 'assistant', content: res.value.text || '' });

      for (const call of res.value.toolCalls) {
        const capabilityId = call.name.replace(/_/g, '.');
        const outcome = await this.dispatcher.dispatch({
          capabilityId,
          args: call.arguments,
          identity: input.req.identity,
          permissions: input.permissions,
          budget: input.budget,
          confirmationMode: 'risky-only',
          generation: input.generation,
          signal: input.req.signal,
        });

        if (outcome.kind === 'value') {
          capabilityVersions.push(capabilityId);
          for (const citation of extractCitations(outcome.value)) citations.push(citation);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(outcome.value).slice(0, 12_000),
          });
        } else if (outcome.kind === 'confirmation-required') {
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({
              error: 'confirmation-required',
              message: 'That action needs the user to confirm it first. Say what it would do and stop.',
            }),
          });
        } else {
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({ error: outcome.failure.kind, message: outcome.failure.message }),
          });
        }
      }
    }

    if (activeSkill) {
      await this.skills.recordRun(input.req.identity, {
        skillName: activeSkill.name,
        skillVersion: activeSkill.version,
        skillOrigin: activeSkill.origin,
        task: input.req.text.slice(0, 400),
        capabilityVersions,
        permissions: input.permissions.list(),
        outcome: reply ? 'completed' : 'failed',
      });
    }

    return ok({
      text: reply || 'I do not have an answer for that yet.',
      citations,
      mission: input.mission,
      ...(activeSkill ? { activeSkill } : {}),
      blocked: null,
    });
  }

  /* ---------------- helpers ---------------- */

  private async toolDefinitions(permissions: PermissionEnvelope) {
    const contracts = await this.registry.listInstalled();
    return contracts
      .filter((c) => c.status === 'installed')
      .filter((c) => c.permissions.every((p) => permissions.has(p)))
      // Irreversible work is not offered as a free-form tool; it belongs on a
      // confirmed branch.
      .filter((c) => c.risk !== 'irreversible')
      .map((c) => ({
        name: capabilityIdToExternalName(c.id),
        description: c.summary,
        parameters: c.input,
      }));
  }

  private riskFor(capabilityId: string): import('@shared/types').RiskClass {
    const native = this.registry.native(capabilityId);
    return native?.contract.risk ?? 'moderate';
  }

  private async resumeConfirmed(
    req: TurnRequest,
    snapshot: SessionSnapshot,
    generation: number,
    budget: TaskBudget,
    permissions: PermissionEnvelope,
    userTurn: Turn,
    client: SessionClient,
  ): Promise<Result<TurnResponse>> {
    const confirmation = snapshot.pendingConfirmation;
    if (!confirmation) return fail('invalid-argument', 'There is nothing awaiting confirmation.');
    if (req.confirmationToken !== confirmation.bindingHash) {
      return fail(
        'not-authorised',
        'That confirmation no longer matches the action it was issued for. Something about it changed.',
      );
    }
    if (Date.parse(confirmation.expiresAt) < Date.now()) {
      return fail('not-authorised', 'That confirmation expired. Ask again and I will re-offer it.');
    }

    const story = getStory(snapshot.storyId ?? OPEN_CONVERSATION_ID);
    if (!story) return fail('missing-capability', 'The story this confirmation belonged to is gone.');

    const config = await this.memory.loadConfig(req.identity);
    const advanced = await this.runToCompletion({
      compiled: story.compiled,
      stateJson: snapshot.runtimeState ?? '',
      identity: req.identity,
      permissions,
      budget,
      generation,
      signal: req.signal,
      confirmationMode: config.dialogue.confirmationMode,
      confirmationToken: req.confirmationToken,
      readable: readableConfig(config),
    });
    if (!advanced.ok) return advanced;

    return this.commit({
      req,
      client,
      generation,
      budget,
      userTurn,
      assistantText: advanced.value.text,
      choices: advanced.value.choices,
      stateJson: advanced.value.stateJson,
      storyId: story.id,
      storyVersion: story.version,
      confirmation: advanced.value.confirmation,
      citations: advanced.value.citations,
      mission: missionFrom(snapshot),
      blocked: advanced.value.blocked,
    });
  }

  private async respondPlainly(
    req: TurnRequest,
    snapshot: SessionSnapshot,
    generation: number,
    budget: TaskBudget,
    userTurn: Turn,
    client: SessionClient,
    choices: InkChoiceView[],
    stateJson: string,
    storyId: string,
    storyVersion: string,
    text: string,
  ): Promise<Result<TurnResponse>> {
    return this.commit({
      req,
      client,
      generation,
      budget,
      userTurn,
      assistantText: text,
      choices,
      stateJson,
      storyId,
      storyVersion,
      confirmation: null,
      citations: [],
      mission: missionFrom(snapshot),
      blocked: null,
    });
  }

  private async commit(input: {
    req: TurnRequest;
    client: SessionClient;
    generation: number;
    budget: TaskBudget;
    userTurn: Turn;
    assistantText: string;
    choices: InkChoiceView[];
    stateJson: string;
    storyId: string;
    storyVersion: string;
    confirmation: PendingConfirmation | null;
    citations: Citation[];
    mission: Mission;
    blocked: { kind: import('@shared/types').FailureKind; message: string } | null;
    authoredLineId?: string;
    activeSkill?: { name: string; version: string; origin: string };
  }): Promise<Result<TurnResponse>> {
    const assistantTurn: Turn = {
      id: randomId('turn'),
      role: 'assistant',
      text: input.assistantText,
      at: new Date().toISOString(),
      ...(input.authoredLineId ? { authoredLineId: input.authoredLineId } : {}),
    };

    const turns = input.assistantText ? [input.userTurn, assistantTurn] : [input.userTurn];

    const committed = await input.client.commitTurn({
      generation: input.generation,
      turns,
      runtimeState: input.stateJson,
      storyId: input.storyId,
      storyVersion: input.storyVersion,
      pendingConfirmation: input.confirmation,
      budgetRecord: input.budget.serialize(),
      mission: input.mission.mission,
      currentTask: input.mission.currentTask,
      currentFocus: input.mission.currentFocus,
      constraints: input.mission.acceptedConstraints,
    });

    if (!committed.applied) {
      // Stop landed while this turn was running, so the result is discarded.
      return fail('cancelled', 'You stopped while that was running, so nothing was applied.');
    }

    const snapshot = await input.client.snapshot();

    return ok({
      sessionId: input.req.identity.sessionId,
      turns: snapshot.turns.slice(-30),
      choices: input.choices,
      pendingConfirmation: input.confirmation,
      citations: input.citations,
      jobs: snapshot.jobs,
      activeSkill: input.activeSkill ?? null,
      checkpointId: snapshot.headCheckpointId ?? '',
      budget: input.budget.view(),
      blocked: input.blocked,
      paused: input.budget.exhausted,
      mission: input.mission.mission,
      currentTask: input.mission.currentTask,
      currentFocus: input.mission.currentFocus,
    });
  }
}

/**
 * The user sees the action, its target and what follows, not a bare
 * "Are you sure?".
 */
function describeConfirmation(confirmation: PendingConfirmation): string {
  return [
    `${confirmation.title}: ${confirmation.action}`,
    `Target: ${confirmation.target}`,
    ...confirmation.consequences.map((c) => `- ${c}`),
  ].join('\n');
}

function missionFrom(snapshot: SessionSnapshot): Mission {
  return {
    mission: snapshot.mission,
    currentTask: snapshot.currentTask,
    currentFocus: snapshot.currentFocus,
    acceptedConstraints: snapshot.constraints,
    unresolvedDecisions: [],
  };
}

function readableConfig(config: import('@shared/types').GlobalConfig): Record<string, string | number | boolean> {
  return {
    'dialogue.confirmationMode': config.dialogue.confirmationMode,
    'dialogue.language': config.dialogue.language,
    'dialogue.speechOutput': config.dialogue.speechOutput,
    'accessibility.captions': config.accessibility.captions,
    'accessibility.reducedMotion': config.accessibility.reducedMotion,
  };
}

function recentContextOf(turns: Turn[]): string {
  return turns
    .slice(-6)
    .map((t) => `${t.role}: ${t.text}`)
    .join('\n');
}

/** Ink passes positional arguments; capabilities take named ones. */
function argsFor(args: unknown[]): Record<string, unknown> {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0] as Record<string, unknown>;
  }
  if (args.length === 1 && typeof args[0] === 'string') {
    // The single-string form is by far the most common: a query or a URL.
    const value = args[0];
    return /^https?:\/\//i.test(value) ? { url: value } : { query: value };
  }
  const out: Record<string, unknown> = {};
  if (typeof args[0] === 'string') {
    out[/^https?:\/\//i.test(args[0]) ? 'url' : 'query'] = args[0];
  }
  if (typeof args[1] === 'number') out.limit = args[1];
  return out;
}

function extractCitations(value: unknown): Citation[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.results)) {
    return record.results
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      .filter((r) => typeof r.url === 'string')
      .map((r) => ({
        title: String(r.title ?? r.url),
        url: String(r.url),
        snippet: String(r.snippet ?? ''),
        retrievedAt: String(r.retrievedAt ?? new Date().toISOString()),
      }));
  }

  if (typeof record.finalUrl === 'string') {
    return [
      {
        title: String(record.title ?? record.finalUrl),
        url: String(record.finalUrl),
        snippet: String(record.text ?? '').slice(0, 240),
        retrievedAt: new Date().toISOString(),
      },
    ];
  }
  return [];
}
