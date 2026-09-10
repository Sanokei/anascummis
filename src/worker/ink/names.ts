/**
 * Entity recognition for the assistant's name.
 *
 * These are candidates, not wake words. Nothing in this module may activate
 * listening, resume capture, select a branch, or authorise an action. The only
 * output is an observation the orchestrator may use as weak context.
 */

export const CANONICAL_NAME = 'Anascummis';
export const ACCEPTED_ALIASES = ['Anascummis', 'Anas', 'Cummis'] as const;

export interface NameMention {
  alias: string;
  index: number;
  /** True when the mention sits inside quotation marks. */
  quoted: boolean;
  /** True when the mention is the first token of the utterance. */
  leading: boolean;
}

/**
 * Complete-name, case-insensitive matches only. "Anastasia" and "bananas"
 * contain the alias as a substring and must not match.
 */
export function findNameMentions(text: string): NameMention[] {
  const mentions: NameMention[] = [];
  const quoted = quotedRanges(text);
  for (const alias of ACCEPTED_ALIASES) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${alias})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const index = match.index + (match[1]?.length ?? 0);
      mentions.push({
        alias,
        index,
        quoted: quoted.some(([start, end]) => index >= start && index < end),
        leading: text.slice(0, index).trim().length === 0,
      });
      pattern.lastIndex = index + alias.length;
    }
  }
  return mentions.sort((a, b) => a.index - b.index);
}

/**
 * Openings that sound like the name but are not aliases. These stay evaluation
 * cases: none of them is corrected automatically into the canonical name.
 */
export const NEAR_MISS_OPENINGS = ['ask chris', 'ask', 'abe', 'asus', 'ace'] as const;

export interface OpeningNameAmbiguity {
  present: boolean;
  heard: string | null;
  /** True when resolving the name would change what the request means. */
  materialToRequest: boolean;
  reason: string;
}

/** Fields whose change makes an uncertain opening name worth clarifying. */
const MATERIAL_SIGNALS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(ask|tell|send|forward|email|message|notify)\s+\w+/i, label: 'recipient' },
  { pattern: /\b(delete|remove|destroy|drop|revoke|wipe|purge)\b/i, label: 'destructive action' },
  { pattern: /\b(deploy|publish|release|push)\b/i, label: 'deployment target' },
  { pattern: /\b(don'?t|do not|never|stop|cancel)\b/i, label: 'negation' },
  { pattern: /\b\d+\s*(times|copies|items|dollars|usd|records)\b/i, label: 'quantity' },
  { pattern: /\b(account|worker|database|repo|repository|bucket|key)\s+\S+/i, label: 'identifier' },
];

/**
 * Decides what to do with an uncertain opening name.
 *
 * "Ask Chris to delete the Worker" names a different actor and a destructive
 * action, so it is never treated as authorisation for Anascummis to delete it.
 */
export function assessOpeningName(rawTranscript: string): OpeningNameAmbiguity {
  const trimmed = rawTranscript.trim();
  const lower = trimmed.toLowerCase();

  let heard: string | null = null;
  for (const candidate of NEAR_MISS_OPENINGS) {
    if (lower === candidate || lower.startsWith(`${candidate} `) || lower.startsWith(`${candidate},`)) {
      // Prefer the longest matching opening: "ask chris" over "ask".
      if (!heard || candidate.length > heard.length) heard = candidate;
    }
  }
  if (!heard) {
    return { present: false, heard: null, materialToRequest: false, reason: 'No uncertain opening name.' };
  }

  const remainder = trimmed.slice(heard.length).trim();
  for (const signal of MATERIAL_SIGNALS) {
    if (signal.pattern.test(trimmed)) {
      return {
        present: true,
        heard,
        materialToRequest: true,
        reason: `Resolving the opening name could change the ${signal.label}, so it needs clarifying.`,
      };
    }
  }
  if (remainder.length === 0) {
    return {
      present: true,
      heard,
      materialToRequest: true,
      reason: 'The utterance is only an uncertain name, so there is no request to answer.',
    };
  }
  return {
    present: true,
    heard,
    materialToRequest: false,
    reason: 'The request is clear without resolving the opening name, so it is left unresolved.',
  };
}

/**
 * Whether a mention refers to this assistant, as weak context only.
 * A quoted mention or a mention that reads as third-person reference is not
 * treated as address.
 */
export function mentionAddressesAssistant(text: string, mention: NameMention): boolean {
  if (mention.quoted) return false;
  const after = text.slice(mention.index + mention.alias.length);
  // "Anascummis said", "ask Anascummis to" refer to the assistant in the third
  // person rather than addressing it.
  if (/^\s*(said|says|told|thinks|wrote|is|was|has|had)\b/i.test(after)) return false;
  return mention.leading || /^\s*[,:]/.test(after);
}

function quotedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const pattern = /"([^"]*)"|“([^”]*)”|'([^']{2,})'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}
