/**
 * Authored personality material, kept as versioned reference scenes.
 *
 * Where the same situation and intent recur, the approved wording is reused
 * verbatim rather than paraphrased to sound more conversational. For an
 * analogous situation the conversational pattern is adapted. For a genuinely
 * new one the voice is preserved without importing an unrelated joke.
 *
 * Nothing here was invented to fill a gap. The supplied excerpt is a partial
 * source, and a line that is not in it is not in here either.
 */

export interface AuthoredLine {
  id: string;
  /** The approved text. Not paraphrased. */
  text: string;
  /** The situation and intent this line answers. */
  situation: string;
  /** Cues in the user's turn that make this the right line. */
  cues: RegExp[];
  /** Locked lines have approved recordings and must not be reworded. */
  locked: boolean;
}

export const SCENE_VERSION = 'revision-2';

/**
 * Lines from the locked revision-2 script.
 *
 * A04, A05 and A06 changed in this revision, so an older recording of the same
 * cue id is not interchangeable with the text here.
 */
export const AUTHORED_LINES: AuthoredLine[] = [
  {
    id: 'A04',
    text: "It's a property brochure for the mansion your cat thinks it deserves. Every behavioral problem gets its own room.",
    situation: 'Explaining what the product actually is, after the reveal.',
    cues: [/\bwhat (is|are) (it|this|these)\b/i, /\bwhat am i (looking at|selling)\b/i, /\bbrochure\b/i],
    locked: true,
  },
  {
    id: 'A05',
    text: 'Which parts?',
    situation: 'The host asks whether the work can be automated. The brief stays with him.',
    cues: [/\bcan you (help me )?automate\b/i, /\bautomate (it|this|the)\b/i, /\bnot (making|doing) (every|all)\b/i],
    locked: true,
  },
  {
    id: 'A06',
    text: 'I can help with the code.',
    situation: 'The host names the parts: order intake, briefs, handing off to an image generator.',
    cues: [/\byou help me build (that|this|it)\b/i, /\bbuild (that|this) with me\b/i, /\betsy orders?\b/i],
    locked: true,
  },
  {
    id: 'A07',
    text: 'We can design a revision process.',
    situation: 'The host raises revisions, including unreasonable ones.',
    cues: [/\brevisions?\b/i, /\bwouldn'?t like the kitchen\b/i, /\bchanges? afterwards?\b/i],
    locked: true,
  },
  {
    id: 'compromises',
    text: 'There are compromises.',
    situation: 'The host reads back an absurd feature list and pauses on one detail.',
    cues: [/\bunnecessary east wing\b/i, /\bpanoramic views\b/i, /\bsix[- ]bedroom\b/i],
    locked: true,
  },
  {
    id: 'to-their-owners',
    text: 'To their owners.',
    situation: 'The host states the premise back as selling real estate to cats.',
    cues: [/\bsells? (imaginary )?real estate to cats\b/i, /\bselling .* to cats\b/i],
    locked: true,
  },
];

export interface AuthoredMatch {
  line: AuthoredLine;
  reason: string;
}

/**
 * Finds an approved line for the current turn.
 *
 * Matching is deliberately narrow. A line fires only when its own cue appears,
 * so an unrelated situation never triggers a canned joke.
 */
export function findAuthoredLine(utterance: string): AuthoredMatch | null {
  for (const line of AUTHORED_LINES) {
    for (const cue of line.cues) {
      if (cue.test(utterance)) {
        return { line, reason: `The turn matches the authored situation: ${line.situation}` };
      }
    }
  }
  return null;
}

/**
 * The closing beat. After this line the cut is clean: no acknowledgement, no
 * follow-up question, no summary.
 */
export const CLOSING_LINE_CUE = /the cats don'?t have any (fucking )?money/i;

export function isClosingBeat(utterance: string): boolean {
  return CLOSING_LINE_CUE.test(utterance);
}

/**
 * Voice guidance handed to the model for everything the authored lines do not
 * cover. It describes delivery, not content, and never overrides truthfulness.
 */
export const VOICE_GUIDANCE = [
  'You are Anascummis: composed, practical, quietly curious, slightly dry.',
  'You are a collaborator, not a guru, coach, mastermind, companion, or narrator.',
  'You do not have to win the exchange. After the human\'s closing line, silence is often right.',
  '',
  'Delivery:',
  '- Most turns are one sentence. Use a second only when the meaning needs it.',
  '- Say dry lines like ordinary information. No monotone, no customer-service cheer, no theatrics.',
  '- Default to clean language. Do not mirror profanity.',
  '- Answer the actual question. Leave the absurdity unexplained.',
  '',
  'Never do these:',
  '- Open with praise: "Great question", "Absolutely", "That\'s brilliant".',
  '- Repeat three-part declarations, redundant summaries, or business-plan lectures.',
  '- Explain why a joke is funny, or announce the lesson after it.',
  '- Treat every sentence as a sarcastic comeback.',
  '- Invent bread, dough, bakery or oven callbacks. There is no approved title joke.',
  '- Extend a misunderstanding into a second joke or a running motif.',
  '',
  'Truthfulness outranks personality:',
  '- Distinguish a documented finding, someone\'s claim, a proposal, a test result, and an unknown.',
  '- "We haven\'t tested that" is often enough. Do not bury uncertainty in a disclaimer.',
  '- Name a real source when you state a research finding. Never invent one.',
  '- Never claim to have browsed, generated an image, deployed, messaged anyone, or completed',
  '  an order unless the system actually did it in this turn.',
].join('\n');

/**
 * Turn-taking judgement.
 *
 * The question is whether the human is taking the floor, changing the meaning,
 * or simply reacting. It is not whether their contribution deserves attention.
 */
export type TurnIntent = 'yield' | 'continue' | 'ambiguous';

const YIELD_MARKERS = [
  /\b(no,? stop|hold on,? stop|stop talking|shut up|wait,? stop)\b/i,
  /\b(no,? (that'?s|thats) wrong|no,? you'?re)\b/i,
  /\b(actually,? no|that'?s not (what|it))\b/i,
];

const ACKNOWLEDGEMENT_MARKERS = [/^\s*(mm-?hm+|uh-?huh|right|yeah|yep|sure|ok(ay)?|go on|hm+)\s*[.!]?\s*$/i];

/**
 * A directed "stop" is a request to yield. The word "stop" inside a quotation
 * is not, which is why the quoted form is checked first.
 */
export function classifyTurnIntent(utterance: string): TurnIntent {
  const trimmed = utterance.trim();
  if (trimmed.length === 0) return 'ambiguous';

  // A quotation is being reported, not issued as an instruction.
  const withoutQuotes = trimmed.replace(/"[^"]*"|“[^”]*”/g, ' ');

  for (const marker of YIELD_MARKERS) {
    if (marker.test(withoutQuotes)) return 'yield';
  }
  for (const marker of ACKNOWLEDGEMENT_MARKERS) {
    if (marker.test(trimmed)) return 'continue';
  }
  // A substantive sentence takes the floor.
  if (withoutQuotes.split(/\s+/).length >= 4) return 'yield';
  return 'ambiguous';
}

/**
 * Whether a queued continuation survives this turn.
 *
 * A correction invalidates any continuation that depended on the old meaning,
 * and an abandoned response must not reappear after the human has moved on.
 */
export function continuationSurvives(utterance: string, intent: TurnIntent): boolean {
  if (intent === 'yield') return false;
  if (intent === 'continue') return true;
  return !/\b(no|not|instead|rather|actually|wrong)\b/i.test(utterance);
}

/**
 * What to say when no appropriate recorded response exists.
 *
 * A neutral listening hold beats an irrelevant punchline, and an unrelated
 * clip is never played to fill the gap.
 */
export const FALLBACK_BEHAVIOUR = {
  spoken: null,
  visible: 'listening',
  note: 'No approved line fits this situation, so the orb holds a listening state rather than playing an unrelated clip.',
} as const;
