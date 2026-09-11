import { Story } from 'inkjs/full';
import type { InkChoiceView, RiskClass } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import { canonicalJson, sha256Hex } from '../crypto';
import { externalNameToCapabilityId } from './harness';

/**
 * Ink runtime with an explicit host yield/resume protocol.
 *
 * Ink external functions are synchronous, so a story cannot await anything.
 * Instead of pretending otherwise, evaluation runs against a memo of already
 * resolved action results:
 *
 *   1. The state is snapshotted before evaluation.
 *   2. An external call whose result is already memoised returns it directly.
 *   3. An unmemoised call records an action request and aborts evaluation.
 *   4. The host restores the snapshot, validates and dispatches the request,
 *      memoises the typed result or failure, and evaluates again.
 *
 * Replay therefore never re-dispatches: step 2 serves every call the previous
 * pass made. That is what keeps compilation, lookahead, rendering, replay, and
 * branch inspection free of external side effects.
 */

export interface ActionRequest {
  /** Stable within one turn: name plus argument hash plus occurrence index. */
  memoKey: string;
  externalName: string;
  capabilityId: string;
  args: unknown[];
  occurrence: number;
}

export type ActionOutcome =
  | { kind: 'value'; value: unknown }
  | { kind: 'failure'; message: string };

export interface EvaluationResult {
  /** Text produced up to the point evaluation stopped. */
  text: string;
  tags: string[];
  choices: InkChoiceView[];
  /** Set when evaluation stopped to request an action. */
  pendingAction: ActionRequest | null;
  ended: boolean;
  /** State after evaluation, safe to persist as a checkpoint. */
  stateJson: string;
  /** Every action this pass resolved from the memo, in order. */
  resolvedActions: string[];
}

export interface EvaluationOptions {
  compiled: string;
  /** Snapshot to resume from. Omitted for a fresh entry. */
  stateJson?: string | null;
  /** Knot to enter at. Only used on a fresh entry. */
  entryKnot?: string | null;
  memo: Map<string, ActionOutcome>;
  /** Values Ink may read. Anything absent is invisible to the story. */
  readableConfig: Record<string, string | number | boolean>;
  /**
   * Variables the host supplies as input rather than configuration, set
   * without the `config_` prefix. Configuration describes the deployment;
   * an input is the particular thing this evaluation is about.
   */
  inputs?: Record<string, string | number | boolean>;
  /** Risk lookup used to classify choices for the confirmation gate. */
  riskFor: (capabilityId: string) => RiskClass;
  /** Ceiling on Continue() iterations, so a cyclic divert cannot spin. */
  maxContinues?: number;
}

const YIELD_SENTINEL = Symbol('anascummis.action-yield');

class ActionYield {
  readonly marker = YIELD_SENTINEL;
  constructor(readonly request: ActionRequest) {}
}

export async function evaluate(opts: EvaluationOptions): Promise<Result<EvaluationResult>> {
  let story: Story;
  try {
    story = new Story(opts.compiled);
  } catch (err) {
    return fail('contract-mismatch', `Compiled story could not be loaded: ${describe(err)}`);
  }

  if (opts.stateJson) {
    try {
      story.state.LoadJson(opts.stateJson);
    } catch (err) {
      // A snapshot only restores against compatible compiled content. This is
      // the incompatibility the caller must handle with a migration or by
      // returning to a safe checkpoint.
      return fail(
        'contract-mismatch',
        `Saved state is not compatible with this story version: ${describe(err)}`,
      );
    }
  }

  // Allowlisted configuration, read-only from the story's point of view.
  setVariables(story, opts.readableConfig, 'config_');
  setVariables(story, opts.inputs, '');

  const occurrences = new Map<string, number>();
  const resolvedActions: string[] = [];
  let pending: ActionRequest | null = null;

  const externals = collectExternalNames(opts.compiled);
  for (const name of externals) {
    const capabilityId = externalNameToCapabilityId(name);
    story.BindExternalFunctionGeneral(
      name,
      (args: unknown[]) => {
        if (!capabilityId) {
          throw new Error(`"${name}" does not map to a capability id.`);
        }
        const argsHash = hashSync(args);
        const seen = occurrences.get(`${name}:${argsHash}`) ?? 0;
        const memoKey = `${name}:${argsHash}:${seen}`;
        const memoised = opts.memo.get(memoKey);
        if (memoised) {
          occurrences.set(`${name}:${argsHash}`, seen + 1);
          resolvedActions.push(memoKey);
          return memoised.kind === 'value' ? toInkValue(memoised.value) : `error: ${memoised.message}`;
        }
        throw new ActionYield({
          memoKey,
          externalName: name,
          capabilityId,
          args,
          occurrence: seen,
        });
      },
      false,
    );
  }

  const maxContinues = opts.maxContinues ?? 500;
  let text = '';
  const tags: string[] = [];
  let ended = false;

  if (!opts.stateJson && opts.entryKnot) {
    try {
      story.ChoosePathString(opts.entryKnot);
    } catch (err) {
      return fail('invalid-argument', `Cannot enter at "${opts.entryKnot}": ${describe(err)}`);
    }
  }

  try {
    let iterations = 0;
    while (story.canContinue) {
      if (++iterations > maxContinues) {
        // Loop analysis is best-effort, so the host budget is what actually stops it.
        return fail('budget-exhausted', 'Story exceeded its continuation budget without reaching a choice.');
      }
      text += story.Continue() ?? '';
      for (const tag of story.currentTags ?? []) tags.push(tag);
    }
    ended = !story.canContinue && story.currentChoices.length === 0;
  } catch (err) {
    if (err instanceof ActionYield) {
      pending = err.request;
    } else {
      return fail('upstream-error', `Story evaluation failed: ${describe(err)}`);
    }
  }

  const choices: InkChoiceView[] = pending
    ? []
    : story.currentChoices.map((choice, index) => {
        const capabilityId = choiceCapability(choice.tags ?? []);
        return {
          index,
          text: choice.text ?? '',
          risk: capabilityId ? opts.riskFor(capabilityId) : 'none',
          ...(capabilityId ? { capabilityId } : {}),
        };
      });

  let stateJson: string;
  try {
    stateJson = story.state.ToJson();
  } catch (err) {
    return fail('upstream-error', `Story state could not be saved: ${describe(err)}`);
  }

  return ok({
    text: text.trim(),
    tags,
    choices,
    pendingAction: pending,
    ended,
    stateJson,
    resolvedActions,
  });
}

/**
 * Selects a choice. Selection is navigation and produces no side effect on its
 * own; the caller evaluates afterwards, which is where the action gate applies.
 */
export function chooseIndex(compiled: string, stateJson: string, index: number): Result<string> {
  try {
    const story = new Story(compiled);
    story.state.LoadJson(stateJson);
    if (index < 0 || index >= story.currentChoices.length) {
      return fail('invalid-argument', `Choice ${index} does not exist in the current state.`);
    }
    story.ChooseChoiceIndex(index);
    return ok(story.state.ToJson());
  } catch (err) {
    return fail('contract-mismatch', `Choice could not be applied: ${describe(err)}`);
  }
}

/**
 * A jump to a knot is navigation, not a historical undo. The caller is
 * responsible for branching the checkpoint DAG rather than erasing a future.
 */
export function divertTo(compiled: string, stateJson: string | null, knot: string): Result<string> {
  try {
    const story = new Story(compiled);
    if (stateJson) story.state.LoadJson(stateJson);
    story.ChoosePathString(knot);
    return ok(story.state.ToJson());
  } catch (err) {
    return fail('invalid-argument', `Cannot divert to "${knot}": ${describe(err)}`);
  }
}

/** Choice tags carry the capability a branch would dispatch, as `action:web.search`. */
export function choiceCapability(tags: string[]): string | null {
  for (const tag of tags) {
    const match = /^\s*action\s*:\s*([a-z][a-z0-9.]*)\s*$/i.exec(tag);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function collectExternalNames(compiledJson: string): string[] {
  const names = new Set<string>();
  const pattern = /"x\(\)"\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(compiledJson)) !== null) names.add(match[1]!);
  return [...names];
}

/** Ink variables hold strings, numbers and booleans, so structures are serialised. */
function toInkValue(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Synchronous hash, because an Ink external call cannot await. */
function hashSync(args: unknown[]): string {
  const text = canonicalJson(args);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

/** Used where an async hash is available and collision resistance matters. */
export async function strongArgsHash(args: unknown): Promise<string> {
  return sha256Hex(canonicalJson(args));
}

/**
 * Sets the variables a story declares. A name the story does not declare is
 * skipped rather than created, so a caller cannot widen what a story can read.
 */
function setVariables(
  story: Story,
  values: Record<string, string | number | boolean> | undefined,
  prefix: string,
): void {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) {
    const variable = `${prefix}${key.replace(/\./g, '_')}`;
    try {
      if (story.variablesState.GlobalVariableExistsWithName(variable)) {
        story.variablesState.$(variable, value);
      }
    } catch {
      /* A story that does not declare the variable simply cannot read it. */
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
