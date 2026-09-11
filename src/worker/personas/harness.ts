import type { OrbMood, Persona, PersonaBit, PersonaSubject, PersonaTraitKind } from '@shared/types';
import {
  MAX_PERSONA_BITS,
  MAX_PERSONA_LINES_PER_BIT,
  MAX_PERSONA_LINE_CHARS,
  MAX_PERSONA_TRAITS,
  ORB_MOODS,
} from '@shared/types';
import { contrastRatio, hexToRgb, normaliseColor } from '../design/math';
import { AUTHORED_PERSONAS } from './authored';
import {
  TRAIT_REGIONS,
  UNPOLICED_REGION,
  isTraitKind,
  regionContains,
  traitDescriptor,
  type TraitDescriptor,
} from './vocabulary';

/**
 * Whether a costume may be worn, decided by arithmetic rather than by taste.
 *
 * The same division of labour as the design harness: a host check either
 * settles a question or refuses to, and every verdict carries the numbers it
 * was reached with. What it can settle is narrow, and worth being precise
 * about — that a costume is drawable, legible against its shell, and made of
 * parts that do not land on top of each other. Whether the thing is any good is
 * not a question arithmetic has, and nothing here pretends otherwise.
 *
 * The one rule that is not arithmetic is the one that matters most. A costume
 * that reads as a specific real person is a failure no colour check would ever
 * catch, so it is prevented structurally instead: `AUTHORED_PERSONAS` is the
 * allowlist, and a persona whose id or name is not in it is refused. The
 * assistant may wear a costume we wrote, and only one of those — which is also
 * why `subject` is checked against its declared values rather than trusted.
 */

/* ------------------------------------------------------------------ */
/* Ranges and thresholds                                               */
/* ------------------------------------------------------------------ */

export const MIN_PERSONA_DURATION_MS = 10_000;
export const MAX_PERSONA_DURATION_MS = 600_000;

/**
 * Ornaments are large shapes, so 2.5:1 is the right floor for them, not 4.5:1.
 *
 * The 4.5 figure is a *text* threshold: it exists because letterforms are thin
 * and lose their shape at low contrast, so what a reader loses is the word and
 * not merely its comfort. An ornament is a filled shape the size of a hand, and
 * what fails at 2.5 is not legibility but separability — a hat you have to look
 * for before you can see it. Holding costumes to the text rule would refuse a
 * great many things that read perfectly well, which is how a check teaches its
 * callers to ignore it.
 */
export const MIN_TRAIT_CONTRAST = 2.5;

/** How far a trait may be nudged from its anchor, as a fraction of the radius. */
export const MAX_TRAIT_OFFSET = 0.35;

/**
 * How close to the centre an ornament has to reach to count as worn.
 *
 * Measured from the centre to the ornament's nearest edge. A hat sits at 0.93
 * with a drawing radius of about 1.05, so its near edge is inside the shell. An
 * ornament whose near edge stops short of this is not being worn: it is
 * floating beside the creature, which reads as a bug rather than as a costume.
 */
export const MAX_TRAIT_DETACHMENT = 0.75;

export const MAX_PERSONA_OCCASION_CHARS = 240;

/** Travels with every verdict, as `REVIEW_CAVEAT` does for a drawing. */
export const PERSONA_CAVEAT =
  'A costume that passes was checked by arithmetic: its parts fit on the shell, do not collide, and read against it. That is a claim about whether it can be drawn, not about whether it is funny.';

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

/** A problem with a costume, as opposed to a matter of taste. */
export interface PersonaFinding {
  /** Stable, machine-checkable code. */
  code:
    | 'not-a-persona'
    | 'malformed-id'
    | 'unknown-persona'
    | 'renamed-persona'
    | 'unknown-subject'
    | 'occasion-unusable'
    | 'shell-colour-unreadable'
    | 'unknown-trait-kind'
    | 'too-many-traits'
    | 'trait-scale-out-of-range'
    | 'trait-offset-too-large'
    | 'trait-anchor-misplaced'
    | 'trait-colour-unreadable'
    | 'trait-contrast-too-low'
    | 'trait-collision'
    | 'trait-detached'
    | 'too-many-bits'
    | 'duplicate-bit-id'
    | 'bit-without-lines'
    | 'too-many-lines'
    | 'empty-line'
    | 'line-too-long'
    | 'unknown-mood'
    | 'duration-out-of-range';
  /** What is wrong, in a sentence a caller can act on. */
  message: string;
  /** Which part of the costume: `id`, `traits[1].color`, `bits[0].lines[2]`. */
  path: string;
  /** What was actually measured, so a caller can check the verdict. */
  measured: Record<string, number | string | boolean>;
}

/** One trait's measurements, in the order the traits were given. */
export interface TraitMeasurement {
  kind: string;
  /** The colour as resolved, or null when it could not be read at all. */
  color: string | null;
  /** As given, or 1 when it was not a number and the descriptor's default stood. */
  scale: number;
  /** Against the shell. Null when either colour was unreadable. */
  contrast: number | null;
  /** The vocabulary entry, or null when the kind was not one of ours. */
  descriptor: TraitDescriptor | null;
  /** The nearest ornament sharing its region, if there was one. */
  nearest: { kind: string; distance: number; clearance: number } | null;
}

/** What the costume is, counted and measured. Every field here is derived. */
export interface PersonaDigest {
  id: string;
  name: string;
  subject: string;
  shell: string | null;
  traitCount: number;
  bitCount: number;
  lineCount: number;
  /** Longest authored line, in characters. Zero when there are no lines. */
  maxLineChars: number;
  /** Lowest trait-against-shell contrast, or null when there are no traits. */
  minContrast: number | null;
  maxDurationMs: number;
  traits: TraitMeasurement[];
}

export interface PersonaVerdict {
  ok: boolean;
  findings: PersonaFinding[];
  digest: PersonaDigest;
  /** See `PERSONA_CAVEAT`. A pass is a claim about drawability. */
  caveat: string;
}

const SUBJECTS: Record<PersonaSubject, true> = {
  archetype: true,
  creature: true,
  object: true,
  seasonal: true,
};

const MOODS: Record<OrbMood, true> = {
  even: true,
  bright: true,
  deadpan: true,
  mischief: true,
  grave: true,
  tender: true,
};

const WELL_FORMED_ID = /^[a-z][a-z0-9-]*$/;
const MAX_ID_CHARS = 64;

/* ------------------------------------------------------------------ */
/* The check                                                           */
/* ------------------------------------------------------------------ */

/**
 * Judges one costume.
 *
 * Findings come back in the order they were checked — who it is, what it is
 * made of, how the parts sit on the shell, then what it says — because a caller
 * fixing one thing at a time reads them top down, and a structural refusal
 * makes the findings after it meaningless.
 *
 * `known` is the allowlist and defaults to the authored set. It is a parameter
 * only so a test can present a costume of its own; production never passes it,
 * and a caller that passed an empty list would refuse everything rather than
 * allow anything, which is the direction this should fail in.
 */
export function validatePersona(
  persona: Persona,
  known: readonly Persona[] = AUTHORED_PERSONAS,
): PersonaVerdict {
  // The type is a promise, not a fact. This function exists to decide whether
  // the promise holds, so nothing below trusts a field without looking at it.
  if (!persona || typeof persona !== 'object' || Array.isArray(persona)) {
    return {
      ok: false,
      findings: [
        {
          code: 'not-a-persona',
          message: 'A costume needs an id, a name, a shell colour, traits and bits.',
          path: '',
          measured: { given: typeof persona },
        },
      ],
      digest: emptyDigest(),
      caveat: PERSONA_CAVEAT,
    };
  }

  const p = persona as unknown as Record<string, unknown>;
  const findings: PersonaFinding[] = [];

  const id = typeof p.id === 'string' ? p.id : '';
  const rawTraits = Array.isArray(p.traits) ? (p.traits as unknown[]) : [];
  const rawBits = Array.isArray(p.bits) ? (p.bits as unknown[]) : [];
  const shell = typeof p.shell === 'string' ? normaliseColor(p.shell) : null;
  const maxDurationMs = typeof p.maxDurationMs === 'number' ? p.maxDurationMs : Number.NaN;

  /* --- who it is ------------------------------------------------- */

  if (!WELL_FORMED_ID.test(id) || id.length > MAX_ID_CHARS) {
    findings.push({
      code: 'malformed-id',
      message: `"${id}" is not usable as a persona id. Ids are lower-case letters, digits and hyphens.`,
      path: 'id',
      measured: { id },
    });
  }

  const authored = known.find((candidate) => candidate.id === id) ?? null;
  // The rule that keeps a costume from becoming a person. Everything else here
  // asks whether a costume is drawable; this asks whether it may exist at all.
  if (authored === null) {
    findings.push({
      code: 'unknown-persona',
      message: `No authored costume has the id "${id}". Costumes are written ahead of time and checked; one that has not been written is not one that may be worn.`,
      path: 'id',
      measured: { id, knownCount: known.length },
    });
  } else if (typeof p.name === 'string' && p.name !== authored.name) {
    findings.push({
      code: 'renamed-persona',
      message: `The costume "${id}" is called ${JSON.stringify(authored.name)} and was presented as ${JSON.stringify(p.name)}. The name is part of the costume.`,
      path: 'name',
      measured: { id, authoredName: authored.name, givenName: p.name },
    });
  }

  if (typeof p.subject !== 'string' || !Object.prototype.hasOwnProperty.call(SUBJECTS, p.subject)) {
    findings.push({
      code: 'unknown-subject',
      message: `"${String(p.subject)}" is not a subject. A costume is an archetype, a creature, an object or a seasonal thing.`,
      path: 'subject',
      measured: { subject: String(p.subject) },
    });
  }

  const occasion = typeof p.occasion === 'string' ? p.occasion : '';
  if (occasion.trim() === '') {
    findings.push({
      code: 'occasion-unusable',
      message: 'A costume has to say when wearing it is appropriate, so that it can be judged against that.',
      path: 'occasion',
      measured: { length: 0 },
    });
  } else if (occasion.length > MAX_PERSONA_OCCASION_CHARS) {
    findings.push({
      code: 'occasion-unusable',
      message: `The occasion for "${id}" is ${occasion.length} characters, over the ${MAX_PERSONA_OCCASION_CHARS} a one-line occasion may be.`,
      path: 'occasion',
      measured: { length: occasion.length, limit: MAX_PERSONA_OCCASION_CHARS },
    });
  }

  if (shell === null) {
    findings.push({
      code: 'shell-colour-unreadable',
      message: `The shell colour ${JSON.stringify(String(p.shell))} is not one that can be read. Use #rrggbb.`,
      path: 'shell',
      measured: { shell: String(p.shell) },
    });
  }

  /* --- what it is made of ---------------------------------------- */

  if (rawTraits.length > MAX_PERSONA_TRAITS) {
    findings.push({
      code: 'too-many-traits',
      message: `The costume has ${rawTraits.length} ornaments, over the ${MAX_PERSONA_TRAITS} it may wear. Past that it stops reading as one creature in a hat.`,
      path: 'traits',
      measured: { count: rawTraits.length, limit: MAX_PERSONA_TRAITS },
    });
  }

  const traits = rawTraits.map((trait, index) => checkTrait(trait, index, shell, findings));
  checkPlacement(rawTraits, traits, findings);

  /* --- what it says ---------------------------------------------- */

  checkBits(rawBits, findings);

  if (
    !Number.isFinite(maxDurationMs) ||
    maxDurationMs < MIN_PERSONA_DURATION_MS ||
    maxDurationMs > MAX_PERSONA_DURATION_MS
  ) {
    findings.push({
      code: 'duration-out-of-range',
      message: `A costume may stay on for between ${MIN_PERSONA_DURATION_MS / 1000} and ${MAX_PERSONA_DURATION_MS / 1000} seconds, and this one asks for ${String(p.maxDurationMs)}. A persona is a moment, not a mode.`,
      path: 'maxDurationMs',
      measured: {
        given: Number.isFinite(maxDurationMs) ? maxDurationMs : -1,
        min: MIN_PERSONA_DURATION_MS,
        max: MAX_PERSONA_DURATION_MS,
      },
    });
  }

  /* --- the digest ------------------------------------------------ */

  const lines = rawBits.flatMap((bit) => {
    const lines = (bit as PersonaBit | null)?.lines;
    return Array.isArray(lines) ? lines : [];
  });
  const contrasts = traits.map((t) => t.contrast).filter((c): c is number => c !== null);

  return {
    ok: findings.length === 0,
    findings,
    digest: {
      id,
      name: typeof p.name === 'string' ? p.name : '',
      subject: typeof p.subject === 'string' ? p.subject : '',
      shell,
      traitCount: rawTraits.length,
      bitCount: rawBits.length,
      lineCount: lines.length,
      maxLineChars: lines.reduce(
        (longest, line) => (typeof line === 'string' ? Math.max(longest, line.length) : longest),
        0,
      ),
      minContrast: contrasts.length > 0 ? Math.min(...contrasts) : null,
      maxDurationMs: Number.isFinite(maxDurationMs) ? maxDurationMs : 0,
      traits,
    },
    caveat: PERSONA_CAVEAT,
  };
}

/* ------------------------------------------------------------------ */
/* One ornament                                                        */
/* ------------------------------------------------------------------ */

function checkTrait(
  trait: unknown,
  index: number,
  shell: string | null,
  findings: PersonaFinding[],
): TraitMeasurement {
  const path = `traits[${index}]`;
  const t = (trait ?? {}) as Record<string, unknown>;
  const kindGiven = typeof t.kind === 'string' ? t.kind : String(t.kind);
  const colour = typeof t.color === 'string' ? normaliseColor(t.color) : null;
  const scaleGiven = typeof t.scale === 'number' && Number.isFinite(t.scale) ? t.scale : Number.NaN;

  const measurement: TraitMeasurement = {
    kind: kindGiven,
    color: colour,
    scale: Number.isFinite(scaleGiven) ? scaleGiven : 1,
    contrast: null,
    descriptor: null,
    nearest: null,
  };

  if (!isTraitKind(t.kind)) {
    findings.push({
      code: 'unknown-trait-kind',
      message: `"${kindGiven}" is not an ornament. The vocabulary is a closed set; a costume cannot draw something new.`,
      path: `${path}.kind`,
      measured: { kind: kindGiven },
    });
    // Without a kind there is no anchor, so nothing below this line has a
    // question left that it could answer.
    return measurement;
  }

  const descriptor = traitDescriptor(t.kind);
  measurement.descriptor = descriptor;

  if (!Number.isFinite(scaleGiven) || scaleGiven < 0.6 || scaleGiven > 1.4) {
    findings.push({
      code: 'trait-scale-out-of-range',
      message: `${t.kind} is drawn at scale ${String(t.scale)}, and size runs from 0.6 to 1.4 relative to the shell.`,
      path: `${path}.scale`,
      measured: { scale: Number.isFinite(scaleGiven) ? scaleGiven : -1, min: 0.6, max: 1.4 },
    });
  }

  const offset = readOffset(t.offset);
  const nudge = Math.hypot(offset.x, offset.y);
  if (nudge > MAX_TRAIT_OFFSET) {
    findings.push({
      code: 'trait-offset-too-large',
      message: `${t.kind} is nudged ${nudge.toFixed(2)} of the radius from where it belongs; the allowance is ${MAX_TRAIT_OFFSET}.`,
      path: `${path}.offset`,
      measured: { offset: round(nudge), limit: MAX_TRAIT_OFFSET },
    });
  }

  // The declared region and the declared anchor are the only two things in the
  // vocabulary that can disagree, so this is the check that keeps the map true.
  if (!regionContains(descriptor.region, descriptor.anchor)) {
    findings.push({
      code: 'trait-anchor-misplaced',
      message: `${t.kind} claims ${descriptor.region}, which is ${TRAIT_REGIONS[descriptor.region].where}, and is anchored at (${descriptor.anchor.x}, ${descriptor.anchor.y}).`,
      path: `${path}.anchor`,
      measured: {
        anchorX: descriptor.anchor.x,
        anchorY: descriptor.anchor.y,
        region: descriptor.region,
      },
    });
  }

  if (colour === null) {
    findings.push({
      code: 'trait-colour-unreadable',
      message: `${t.kind} is coloured ${JSON.stringify(String(t.color))}, which is not one that can be read.`,
      path: `${path}.color`,
      measured: { color: String(t.color) },
    });
  } else if (shell !== null) {
    const rgb = hexToRgb(colour);
    const shellRgb = hexToRgb(shell);
    const ratio = rgb !== null && shellRgb !== null ? contrastRatio(rgb, shellRgb) : null;
    measurement.contrast = ratio;
    if (ratio !== null && ratio < MIN_TRAIT_CONTRAST) {
      findings.push({
        code: 'trait-contrast-too-low',
        message: `${t.kind} at ${colour} sits at ${ratio.toFixed(2)}:1 against a shell of ${shell}, under the ${MIN_TRAIT_CONTRAST}:1 an ornament needs to be separable from it.`,
        path: `${path}.color`,
        measured: { contrast: round(ratio), required: MIN_TRAIT_CONTRAST, color: colour, shell },
      });
    }
  }

  // Attached: an ornament whose nearest edge stops well short of the shell is
  // floating beside the creature rather than being worn by it.
  const placed = { x: descriptor.anchor.x + offset.x, y: descriptor.anchor.y + offset.y };
  const attachment = Math.hypot(placed.x, placed.y) - descriptor.naturalScale * measurement.scale;
  if (attachment > MAX_TRAIT_DETACHMENT) {
    findings.push({
      code: 'trait-detached',
      message: `${t.kind} floats ${attachment.toFixed(2)} of the radius clear of the shell. An ornament has to touch what it is worn on.`,
      path: `${path}.offset`,
      measured: { attachment: round(attachment), limit: MAX_TRAIT_DETACHMENT },
    });
  }

  return measurement;
}

/**
 * Whether two ornaments land on top of each other.
 *
 * Only ornaments claiming the same region are compared, and what is compared is
 * their sideways reach: two things in the crown whose spans meet are drawn over
 * one another. The regions are coarse deliberately — they are the parts a
 * person would name when describing a costume, and a finer partition would
 * start refusing pairs that plainly work, like glasses and a beard.
 *
 * Fills in `nearest` as it goes, so the digest carries the closest neighbour
 * even for a costume that turned out not to collide.
 */
function checkPlacement(
  rawTraits: unknown[],
  measured: TraitMeasurement[],
  findings: PersonaFinding[],
): void {
  for (let i = 0; i < rawTraits.length; i++) {
    for (let j = i + 1; j < rawTraits.length; j++) {
      const a = measured[i];
      const b = measured[j];
      if (!a || !b) continue;
      if (a.descriptor === null || b.descriptor === null) continue;
      if (a.descriptor.region !== b.descriptor.region) continue;
      // The shell's own surface is drawn under everything and may coexist with
      // whatever is on top of it. See `UNPOLICED_REGION`.
      if (a.descriptor.region === UNPOLICED_REGION) continue;

      const offsetA = readOffset((rawTraits[i] as Record<string, unknown>)?.offset);
      const offsetB = readOffset((rawTraits[j] as Record<string, unknown>)?.offset);
      const distance = Math.abs(
        a.descriptor.anchor.x + offsetA.x - (b.descriptor.anchor.x + offsetB.x),
      );
      const reach = a.descriptor.halfWidth * a.scale + b.descriptor.halfWidth * b.scale;
      const clearance = distance - reach;

      const note = { kind: b.kind, distance: round(distance), clearance: round(clearance) };
      if (a.nearest === null || distance < a.nearest.distance) a.nearest = note;
      if (b.nearest === null || distance < b.nearest.distance) {
        b.nearest = { kind: a.kind, distance: round(distance), clearance: round(clearance) };
      }

      if (clearance < 0) {
        findings.push({
          code: 'trait-collision',
          message: `${a.kind} and ${b.kind} both take ${a.descriptor.region}, and what they occupy there overlaps by ${Math.abs(clearance).toFixed(2)} of the radius.`,
          path: `traits[${i}]`,
          measured: {
            first: a.kind,
            second: b.kind,
            region: a.descriptor.region,
            distance: round(distance),
            clearance: round(clearance),
          },
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function checkBits(rawBits: unknown[], findings: PersonaFinding[]): void {
  if (rawBits.length > MAX_PERSONA_BITS) {
    findings.push({
      code: 'too-many-bits',
      message: `The costume has ${rawBits.length} bits, over the ${MAX_PERSONA_BITS} it may have.`,
      path: 'bits',
      measured: { count: rawBits.length, limit: MAX_PERSONA_BITS },
    });
  }

  const seen = new Set<string>();
  rawBits.forEach((bit, index) => {
    const path = `bits[${index}]`;
    const b = (bit ?? {}) as Record<string, unknown>;
    const id = typeof b.id === 'string' ? b.id : '';
    const label = id === '' ? `bit ${index}` : id;

    if (id === '') {
      findings.push({
        code: 'duplicate-bit-id',
        message: 'A bit has no id, so nothing could ask for it by name.',
        path: `${path}.id`,
        measured: { id },
      });
    } else if (seen.has(id)) {
      findings.push({
        code: 'duplicate-bit-id',
        message: `Two bits are called ${id}. A bit is addressed by its id, so they have to differ.`,
        path: `${path}.id`,
        measured: { id },
      });
    }
    seen.add(id);

    if (typeof b.mood !== 'string' || !Object.prototype.hasOwnProperty.call(MOODS, b.mood)) {
      findings.push({
        code: 'unknown-mood',
        message: `"${String(b.mood)}" is not a mood the shell can hold.`,
        path: `${path}.mood`,
        measured: { mood: String(b.mood) },
      });
    }

    const lines = Array.isArray(b.lines) ? (b.lines as unknown[]) : [];
    if (lines.length === 0) {
      findings.push({
        code: 'bit-without-lines',
        message: `${label} has nothing to say. Its lines are authored ahead of time, so an empty bit is an unfinished one.`,
        path: `${path}.lines`,
        measured: { count: 0 },
      });
    }
    if (lines.length > MAX_PERSONA_LINES_PER_BIT) {
      findings.push({
        code: 'too-many-lines',
        message: `${label} has ${lines.length} lines, over the ${MAX_PERSONA_LINES_PER_BIT} a bit may have.`,
        path: `${path}.lines`,
        measured: { count: lines.length, limit: MAX_PERSONA_LINES_PER_BIT },
      });
    }

    lines.forEach((line, lineIndex) => {
      if (typeof line !== 'string' || line.trim() === '') {
        findings.push({
          code: 'empty-line',
          message: `Line ${lineIndex} of ${label} is blank.`,
          path: `${path}.lines[${lineIndex}]`,
          measured: { length: 0 },
        });
        return;
      }
      if (line.length > MAX_PERSONA_LINE_CHARS) {
        findings.push({
          code: 'line-too-long',
          message: `Line ${lineIndex} of ${label} is ${line.length} characters, over the ${MAX_PERSONA_LINE_CHARS} a beat may be.`,
          path: `${path}.lines[${lineIndex}]`,
          measured: { length: line.length, limit: MAX_PERSONA_LINE_CHARS },
        });
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Odds and ends                                                       */
/* ------------------------------------------------------------------ */

function readOffset(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object') return { x: 0, y: 0 };
  const o = value as Record<string, unknown>;
  return {
    x: typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : 0,
    y: typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : 0,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function emptyDigest(): PersonaDigest {
  return {
    id: '',
    name: '',
    subject: '',
    shell: null,
    traitCount: 0,
    bitCount: 0,
    lineCount: 0,
    maxLineChars: 0,
    minContrast: null,
    maxDurationMs: 0,
    traits: [],
  };
}
