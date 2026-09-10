import type { InkChoiceView } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { chat, type ChatMessage } from '../providers/model';
import { parseJsonObject } from '../providers/vision';
import { TaskBudget } from '../policy/budget';
import { assessOpeningName } from './names';

/**
 * Choice resolver.
 *
 * The resolver interprets what the user meant against the current choices. It
 * is explicitly allowed to leave every choice unmatched: a question outside
 * the offered branches suspends the decision and is answered, then the
 * decision is offered again.
 *
 * The model's self-reported confidence is not a calibrated probability, so it
 * is used only to order candidates. Whether a match is acted on depends on the
 * lexical evidence as well.
 */

export type Resolution =
  | { kind: 'match'; index: number; reason: string }
  | { kind: 'clarify'; question: string; reason: string }
  | { kind: 'deviation'; reason: string }
  | { kind: 'navigate-back'; reason: string }
  | { kind: 'stop'; reason: string };

export interface ResolveRequest {
  utterance: string;
  choices: InkChoiceView[];
  recentContext: string;
  budget: TaskBudget;
  signal: AbortSignal;
}

const BACK_PATTERNS = [
  /^\s*(go\s+back|back up|undo that|previous|rewind|earlier)\b/i,
  /\b(take me back|return to (the )?(previous|last))\b/i,
];

const STOP_PATTERNS = [
  /^\s*(stop|halt|cancel|abort|never\s?mind|forget it)\b/i,
  /^\s*(hold on|wait)[,.!]?\s*(stop|cancel)\b/i,
];

/**
 * Deviation markers. A question that suspends the pending decision rather
 * than answering it.
 */
const SUSPENDING_QUESTION = [
  /^\s*(before that|first|hang on|wait)\b.*\?/i,
  /^\s*(what|how much|how long|why|who|when|where|which|can you|will it|does it|is it)\b.*\?/i,
];

export async function resolveChoice(env: Env, req: ResolveRequest): Promise<Result<Resolution>> {
  const utterance = req.utterance.trim();
  if (!utterance) return fail('invalid-argument', 'Nothing was said.');

  // A directed stop wins over everything, including comic timing.
  for (const pattern of STOP_PATTERNS) {
    if (pattern.test(utterance)) {
      return ok({ kind: 'stop', reason: 'The user asked to stop.' });
    }
  }

  // An uncertain opening name never authorises anything by itself.
  const opening = assessOpeningName(utterance);
  if (opening.present && opening.materialToRequest) {
    return ok({
      kind: 'clarify',
      question: `I heard something like "${opening.heard}" at the start. Did you mean me, or someone else?`,
      reason: opening.reason,
    });
  }

  for (const pattern of BACK_PATTERNS) {
    if (pattern.test(utterance)) {
      return ok({ kind: 'navigate-back', reason: 'The user asked to go back.' });
    }
  }

  if (req.choices.length === 0) {
    return ok({ kind: 'deviation', reason: 'There is no pending decision, so this is ordinary conversation.' });
  }

  // Cheap lexical pass first. A paraphrase of a choice should not cost a
  // model call, and an exact restatement certainly should not.
  const lexical = lexicalMatch(utterance, req.choices);
  if (lexical && lexical.score >= 0.6) {
    return ok({ kind: 'match', index: lexical.index, reason: `Closely matches "${lexical.text}".` });
  }

  const suspending = SUSPENDING_QUESTION.some((p) => p.test(utterance));
  if (suspending && !lexical) {
    return ok({
      kind: 'deviation',
      reason: 'A question that none of the current choices answers.',
    });
  }

  // Only now spend a model call, and only to interpret meaning.
  const charged = req.budget.chargeExternalCall();
  if (!charged.ok) {
    // With no budget left, fall back to the lexical result rather than guessing.
    if (lexical && lexical.score >= 0.4) {
      return ok({ kind: 'match', index: lexical.index, reason: `Best lexical match: "${lexical.text}".` });
    }
    return ok({ kind: 'deviation', reason: 'No budget remained to interpret this against the choices.' });
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Decide what the user meant, given the choices currently on offer.',
        'Reply with JSON only:',
        '{"decision":"match"|"clarify"|"deviation","index":number|null,"question":string|null,"reason":string}',
        'Use "match" only when the user clearly meant one of the numbered choices.',
        'Use "deviation" when they asked something the choices do not answer. That is normal and fine.',
        'Use "clarify" only when the difference between two readings would change what happens.',
        'Leaving every choice unmatched is a valid answer. Do not force a match.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        req.recentContext ? `Recent conversation:\n${req.recentContext}` : '',
        'Choices:',
        req.choices.map((c, i) => `${i}. ${c.text}`).join('\n'),
        `The user said: ${utterance}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  const res = await chat(env, {
    messages,
    json: true,
    temperature: 0,
    maxTokens: 300,
    signal: req.signal,
  });
  if (!res.ok) {
    // A provider failure must not silently become a chosen branch.
    if (lexical && lexical.score >= 0.5) {
      return ok({ kind: 'match', index: lexical.index, reason: `Lexical match after a provider failure.` });
    }
    return ok({ kind: 'deviation', reason: `Could not interpret this against the choices: ${res.message}` });
  }

  req.budget.chargeModelTokens(res.value.usage.promptTokens + res.value.usage.completionTokens);

  const parsed = parseJsonObject(res.value.text);
  if (!parsed.ok) {
    return ok({ kind: 'deviation', reason: 'The resolver did not return a usable decision.' });
  }
  const decision = parsed.value as {
    decision?: string;
    index?: number | null;
    question?: string | null;
    reason?: string;
  };
  const reason = typeof decision.reason === 'string' ? decision.reason : 'No reason was given.';

  if (decision.decision === 'match' && typeof decision.index === 'number') {
    const index = decision.index;
    if (index < 0 || index >= req.choices.length) {
      return ok({ kind: 'deviation', reason: 'The resolver named a choice that does not exist.' });
    }
    return ok({ kind: 'match', index, reason });
  }
  if (decision.decision === 'clarify' && typeof decision.question === 'string') {
    return ok({ kind: 'clarify', question: decision.question, reason });
  }
  return ok({ kind: 'deviation', reason });
}

interface LexicalMatch {
  index: number;
  text: string;
  score: number;
}

/** Token overlap between the utterance and each choice, best match returned. */
export function lexicalMatch(utterance: string, choices: InkChoiceView[]): LexicalMatch | null {
  const said = new Set(tokens(utterance));
  if (said.size === 0) return null;

  let best: LexicalMatch | null = null;
  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i]!;
    const choiceTokens = tokens(choice.text);
    if (choiceTokens.length === 0) continue;
    const hits = choiceTokens.filter((t) => said.has(t)).length;
    const score = hits / choiceTokens.length;
    if (!best || score > best.score) best = { index: i, text: choice.text, score };
  }
  return best && best.score > 0 ? best : null;
}

const FILLER = new Set([
  'the', 'a', 'an', 'it', 'to', 'do', 'me', 'my', 'i', 'you', 'that', 'this',
  'please', 'ok', 'okay', 'yeah', 'yes', 'sure', 'lets', 'let', 'us', 'and',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !FILLER.has(t));
}
