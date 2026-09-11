/**
 * Turning acceptance criteria into checks the host runs itself.
 *
 * This is the file that decides whether "visual QA" means anything. The
 * specification forbids a model from approving its own output, and it also
 * forbids the host's tool surface from being a second unrestricted execution
 * path. A criterion compiler that asked a model to write a check would violate
 * the first of those in a new costume — the model would be choosing what counts
 * as success — and one that evaluated arbitrary expressions would violate the
 * second.
 *
 * So the vocabulary is fixed and inspectable. `RULES` below is the complete
 * list of criterion shapes this harness can settle mechanically, written as
 * patterns a person can read and disagree with. A criterion matching one of
 * them is checked by arithmetic against a measurement. A criterion matching
 * none of them is **refused**, with a reason, and the refusal travels to the
 * caller where it can be restated in checkable terms or routed to a vision
 * model as the opinion it is.
 *
 * Two consequences worth stating plainly, because they are the point:
 *
 *   - A refusal is not a failure. It is the harness saying "I cannot settle
 *     this", which is far more useful than a model's guess dressed as a verdict.
 *   - Every finding records the rule that produced it and the numbers behind
 *     it, so a misread criterion is visible rather than silently authoritative.
 *
 * This module deliberately imports nothing but `./types` and `./math`. It
 * decides over *measurements* — digests, bounds, image statistics — which the
 * caller produces. That is what lets the whole decision layer be tested with a
 * hand-built digest and no parser, no renderer, and no model.
 */

import type {
  Bounds2D,
  Bounds,
  CheckRefusal,
  CheckKind,
  DeterministicFinding,
  ImageStats,
  Outcome,
  SceneDigest,
  Surface,
  SvgDigest,
  SvgIssue,
} from './types';
import { bounds2DContains, boundsSize } from './math';

/* ------------------------------------------------------------------ */
/* What the checks run against                                         */
/* ------------------------------------------------------------------ */

export interface SvgMeasurements {
  digest: SvgDigest;
  /**
   * Bounds of each element that carries an `id`, in user units, after every
   * ancestor transform. Supplied by the caller rather than derived here,
   * because deriving it needs the document tree and this module takes only
   * measurements. Elements without an id are absent: a criterion can only name
   * something that has a name.
   */
  elementBounds: Record<string, Bounds2D>;
  issues: SvgIssue[];
}

export interface SceneMeasurements {
  digest: SceneDigest;
  /**
   * Parent of each part, `null` for a root. The digest holds the bounds and the
   * counts; this holds the shape of the assembly, which is what a claim like
   * "the shade is part of the lamp" is actually about.
   */
  parents: Record<string, string | null>;
}

export interface PixelMeasurements {
  /** One entry per rendered view. A scene is viewed from several; an SVG from one. */
  views: { view: string; stats: ImageStats }[];
}

export interface Measures {
  surface: Surface;
  svg: SvgMeasurements | null;
  scene: SceneMeasurements | null;
  pixels: PixelMeasurements | null;
}

/* ------------------------------------------------------------------ */
/* Compiled shape                                                      */
/* ------------------------------------------------------------------ */

/** What a rule produced when it ran. */
export interface CheckResult {
  outcome: Outcome;
  evidence: string;
  measured: Record<string, number | string | boolean>;
}

export interface HostCheck {
  /** Which rule built this check. Recorded on the finding. */
  rule: string;
  kind: Exclude<CheckKind, 'perceptual'>;
  run: (m: Measures) => CheckResult;
}

export interface CompiledCriterion {
  criterion: string;
  check: HostCheck | null;
  refusal: CheckRefusal | null;
}

export interface Compilation {
  criteria: CompiledCriterion[];
  /** The criteria no host check can settle, in the words they were written in. */
  refused: CheckRefusal[];
}

export interface CheckRun {
  findings: DeterministicFinding[];
  refusals: CheckRefusal[];
}

/* ------------------------------------------------------------------ */
/* Quantities                                                          */
/* ------------------------------------------------------------------ */

type Comparison = 'exactly' | 'at-least' | 'at-most' | 'more-than' | 'fewer-than';

const COMPARISON_PHRASE: Record<Comparison, string> = {
  exactly: 'exactly',
  'at-least': 'at least',
  'at-most': 'at most',
  'more-than': 'more than',
  'fewer-than': 'fewer than',
};

function satisfies(comparison: Comparison, actual: number, wanted: number): boolean {
  if (comparison === 'exactly') return actual === wanted;
  if (comparison === 'at-least') return actual >= wanted;
  if (comparison === 'at-most') return actual <= wanted;
  if (comparison === 'more-than') return actual > wanted;
  return actual < wanted; // fewer-than
}

/**
 * Spelled-out numbers, up to twenty and then by tens.
 *
 * Bounded on purpose. A criterion like "one hundred and twelve circles" is not
 * a design criterion, and an unbounded number-word parser is a small amount of
 * code hiding a large amount of ambiguity. Past this range the refusal names
 * the reason, which is the honest answer rather than a guess.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

interface Quantity {
  comparison: Comparison;
  count: number;
  /** What is being counted, lower-cased, with any articles removed. */
  noun: string;
}

/**
 * Reads "at least five circles" / "5 or more circles" / "exactly two paths".
 *
 * A bare quantity is read as exact: "five circles" is a count someone will
 * check, and treating it as "at least five" would let a drawing with nine
 * circles pass. Where the comparison is genuinely open the phrase says so.
 */
export function parseQuantity(input: string): Quantity | null {
  let text = normalise(input);

  // Subjects that carry no information for count itself. The generic
  // "the <thing> is/are/has" form comes before the bare verbs, because
  // "the assembly is one level deep" must lose its subject in one step rather
  // than leaving "assembly" in front of the number.
  text = text.replace(
    /^(?:there\s+(?:are|is)|it\s+(?:has|contains|shows|uses)|the\s+\S+\s+(?:is|are|has|have|contains|shows|uses)|contains|has|have|with|showing|uses|use|using|shows)\s+/,
    '',
  );
  // "uses only two colours" — the qualifier is not a quantity.
  text = text.replace(/^(?:only|just)\s+/, '');

  let comparison: Comparison | null = null;
  const leading: [RegExp, Comparison][] = [
    [/^(?:at\s+least|no\s+fewer\s+than|not\s+fewer\s+than|minimum\s+of)\s+/, 'at-least'],
    [/^(?:at\s+most|no\s+more\s+than|not\s+more\s+than|maximum\s+of|up\s+to)\s+/, 'at-most'],
    [/^(?:exactly|precisely|just)\s+/, 'exactly'],
    [/^(?:more\s+than|greater\s+than|over)\s+/, 'more-than'],
    [/^(?:fewer\s+than|less\s+than|under)\s+/, 'fewer-than'],
  ];
  for (const [pattern, kind] of leading) {
    const matched = pattern.exec(text);
    if (matched) {
      comparison = kind;
      text = text.slice(matched[0].length);
      break;
    }
  }

  const head = /^([a-z]+|\d+)\s*/.exec(text);
  const token = head?.[1];
  if (!token) return null;
  const spelled = NUMBER_WORDS[token];
  const digits = /^\d+$/.test(token) ? Number.parseInt(token, 10) : null;
  const count = spelled ?? digits;
  if (count === null || count === undefined) return null;

  let rest = text.slice(head[0].length).trim();
  const trailing: [RegExp, Comparison][] = [
    [/^or\s+(?:more|greater|above|higher)\b\s*/, 'at-least'],
    [/^or\s+(?:fewer|less|below|lower)\b\s*/, 'at-most'],
    [/^or\s+(?:so|thereabouts)\b\s*/, 'at-least'],
  ];
  for (const [pattern, kind] of trailing) {
    const matched = pattern.exec(rest);
    if (matched) {
      // An explicit trailing comparator wins; it is the more specific phrasing.
      comparison = kind;
      rest = rest.slice(matched[0].length).trim();
      break;
    }
  }

  rest = stripArticles(rest);
  if (!rest) return null;
  return { comparison: comparison ?? 'exactly', count, noun: rest };
}

function stripArticles(text: string): string {
  return text.replace(/^(?:the|a|an|its|their|any)\s+/, '').trim();
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Noun resolution                                                     */
/* ------------------------------------------------------------------ */

/** Who counts something, and how. Returns null when the noun is not one we know. */
type Counter = (m: Measures) => number | null;

interface NounEntry {
  /** Canonical name used in evidence. */
  label: string;
  appliesTo: Surface[];
  count: Counter;
}

const SHAPE_TAGS = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'];

function vectorCounts(m: Measures): Record<string, number> {
  return m.svg?.digest.counts ?? {};
}

function sceneKinds(m: Measures): Record<string, number> {
  return m.scene?.digest.kindCounts ?? {};
}

const NOUNS: Record<string, NounEntry> = {
  circle: {
    label: 'circles',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).circle ?? 0,
  },
  rect: {
    label: 'rectangles',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).rect ?? 0,
  },
  ellipse: {
    label: 'ellipses',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).ellipse ?? 0,
  },
  line: {
    label: 'lines',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).line ?? 0,
  },
  polyline: {
    label: 'polylines',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).polyline ?? 0,
  },
  polygon: {
    label: 'polygons',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).polygon ?? 0,
  },
  path: {
    label: 'paths',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).path ?? 0,
  },
  text: {
    label: 'text elements',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).text ?? 0,
  },
  group: {
    label: 'groups',
    appliesTo: ['vector'],
    count: (m) => vectorCounts(m).g ?? 0,
  },
  shape: {
    label: 'shapes',
    appliesTo: ['vector'],
    count: (m) => {
      if (!m.svg) return null;
      let total = 0;
      for (const tag of SHAPE_TAGS) total += vectorCounts(m)[tag] ?? 0;
      return total;
    },
  },
  element: {
    label: 'elements',
    appliesTo: ['vector'],
    count: (m) => {
      if (!m.svg) return null;
      let total = 0;
      for (const value of Object.values(vectorCounts(m))) total += value;
      // The root `svg` element is a container, not a drawn element, and counting
      // it would make "the drawing has ten elements" off by one in a way nobody
      // would think to check.
      return total - (vectorCounts(m).svg ?? 0);
    },
  },
  box: {
    // "Box" is the one word both surfaces use, for different things: a `<rect>`
    // in a drawing, a `box` primitive in a scene. Dispatching on the surface
    // rather than aliasing the plural keeps "boxes" and "box" agreeing.
    label: 'boxes',
    appliesTo: ['vector', 'scene'],
    count: (m) => (m.surface === 'vector' ? (vectorCounts(m).rect ?? 0) : (sceneKinds(m).box ?? 0)),
  },
  cylinder: {
    label: 'cylinders',
    appliesTo: ['scene'],
    count: (m) => sceneKinds(m).cylinder ?? 0,
  },
  cone: {
    label: 'cones',
    appliesTo: ['scene'],
    count: (m) => sceneKinds(m).cone ?? 0,
  },
  sphere: {
    label: 'spheres',
    appliesTo: ['scene'],
    count: (m) => sceneKinds(m).sphere ?? 0,
  },
  torus: {
    label: 'tori',
    appliesTo: ['scene'],
    count: (m) => sceneKinds(m).torus ?? 0,
  },
  part: {
    label: 'parts',
    appliesTo: ['scene'],
    count: (m) => m.scene?.digest.partCount ?? 0,
  },
  joint: {
    label: 'joints',
    appliesTo: ['scene'],
    count: (m) => m.scene?.digest.jointCount ?? 0,
  },
  material: {
    label: 'materials',
    appliesTo: ['scene'],
    count: (m) => (m.scene ? Object.keys(m.scene.digest.materials).length : null),
  },
  root: {
    label: 'roots',
    appliesTo: ['scene'],
    count: (m) => m.scene?.digest.rootCount ?? 0,
  },
};

/** Word forms that should land on a numbered noun. Plural and common synonyms only. */
const NOUN_ALIASES: Record<string, string> = {
  circles: 'circle',
  rects: 'rect',
  rectangles: 'rect',
  ellipses: 'ellipse',
  lines: 'line',
  polylines: 'polyline',
  polygons: 'polygon',
  paths: 'path',
  texts: 'text',
  labels: 'text',
  captions: 'text',
  groups: 'group',
  shapes: 'shape',
  elements: 'element',
  objects: 'element',
  cylinders: 'cylinder',
  cones: 'cone',
  spheres: 'sphere',
  tori: 'torus',
  toruses: 'torus',
  parts: 'part',
  components: 'part',
  pieces: 'part',
  joints: 'joint',
  hinges: 'joint',
  materials: 'material',
  roots: 'root',
};

/**
 * Finds the head noun in a phrase like "small filled circles".
 *
 * Scans from the end, because the head of an English noun phrase is last and an
 * adjective may itself collide with a noun — "three box lids" should count lids,
 * not boxes.
 */
function resolveNoun(noun: string, surface: Surface): { entry: NounEntry; word: string } | null {
  const words = noun.split(' ').filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (!word) continue;
    const key = NOUN_ALIASES[word] ?? word;
    const entry = NOUNS[key];
    if (entry && entry.appliesTo.includes(surface)) return { entry, word };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolves a name written in prose to a key that actually exists.
 *
 * "the horizon line" may be an id of `horizon-line`, `horizon_line` or
 * `horizonline`. Guessing is unavoidable here, so the finding records which key
 * it resolved to and every name it tried. A wrong resolution is then visible in
 * the evidence rather than being an unexplained verdict.
 */
export function resolveName(
  raw: string,
  keys: string[],
): { key: string | null; tried: string[] } {
  const cleaned = stripArticles(normalise(raw)).replace(/["'`]/g, '').trim();
  if (!cleaned) return { key: null, tried: [] };
  const candidates = [
    cleaned,
    cleaned.replace(/\s+/g, '-'),
    cleaned.replace(/\s+/g, '_'),
    cleaned.replace(/\s+/g, ''),
  ];
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length > 1) {
    const last = words[words.length - 1];
    const first = words[0];
    if (last) candidates.push(last);
    if (first) candidates.push(first);
  }
  const seen = new Set<string>();
  const tried: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    tried.push(candidate);
    const hit = keys.find((k) => k.toLowerCase() === candidate);
    if (hit) return { key: hit, tried };
  }
  return { key: null, tried };
}

function namesFor(m: Measures): string[] {
  if (m.surface === 'vector') return Object.keys(m.svg?.elementBounds ?? {});
  return Object.keys(m.scene?.digest.partBounds ?? {});
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

function result(
  outcome: Outcome,
  evidence: string,
  measured: Record<string, number | string | boolean>,
): CheckResult {
  return { outcome, evidence, measured };
}

/**
 * Used wherever a measurement the criterion needs is absent.
 *
 * Not `not-met`: an image that failed to render has not disproved the claim, and
 * recording it as a failure would make a broken pipeline look like a bad
 * drawing. It is also emphatically not `met`.
 */
function missing(what: string): CheckResult {
  return result('unverifiable', `${what} is not available, so this could not be checked.`, {
    reason: 'no-measurement',
  });
}

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */

interface Rule {
  id: string;
  appliesTo: Surface[];
  /**
   * Returns a check, or null when this rule does not actually match.
   *
   * The surface is passed in so a rule can decline at compile time. That matters:
   * a criterion reached by the wrong surface — "five circles" on a 3D lab — must
   * come back as a refusal that says so, not as a check that always answers
   * "unverifiable", which reads to a person like the harness tried and failed.
   */
  build: (criterion: string, surface: Surface) => HostCheck | null;
}

const COLOUR_NOUNS = new Set(['colour', 'colours', 'color', 'colors']);

function countRule(): Rule {
  return {
    id: 'count-of-kind',
    appliesTo: ['vector', 'scene'],
    build: (criterion, surface) => {
      const quantity = parseQuantity(criterion);
      if (!quantity) return null;
      const head = quantity.noun.split(' ').filter(Boolean).pop();
      if (!head) return null;

      // Colour counts are measured on the source palette, not on the render.
      // Antialiasing turns two colours into two hundred in a raster, so a claim
      // about how many colours a drawing *uses* is a claim about what was
      // written, and that is what gets checked. Only a vector document has a
      // palette to check, so a scene lab declines rather than pretending.
      if (COLOUR_NOUNS.has(head)) {
        if (surface !== 'vector') return null;
        return {
          rule: 'count-of-colours',
          kind: 'structural',
          run: (m) => {
            if (!m.svg) return missing('The source palette');
            const colours = m.svg.digest.colors;
            const ok = satisfies(quantity.comparison, colours.length, quantity.count);
            return result(
              ok ? 'met' : 'not-met',
              `The source declares ${colours.length} distinct colour${colours.length === 1 ? '' : 's'} (${COMPARISON_PHRASE[quantity.comparison]} ${quantity.count} required): ${colours.join(', ') || 'none'}.`,
              { actual: colours.length, wanted: quantity.count, comparison: quantity.comparison },
            );
          },
        };
      }

      // Declining here rather than at run time is what turns "three cylinders" on
      // a vector lab into a refusal that explains the mismatch.
      if (!resolveNoun(quantity.noun, surface)) return null;

      return {
        rule: 'count-of-kind',
        kind: 'structural',
        run: (m) => {
          const resolved = resolveNoun(quantity.noun, m.surface);
          if (!resolved) return missing(`A count of "${quantity.noun}"`);
          const actual = resolved.entry.count(m);
          if (actual === null) return missing(`The count of ${resolved.entry.label}`);
          const ok = satisfies(quantity.comparison, actual, quantity.count);
          return result(
            ok ? 'met' : 'not-met',
            `${actual} ${resolved.entry.label} found (${COMPARISON_PHRASE[quantity.comparison]} ${quantity.count} required).`,
            {
              actual,
              wanted: quantity.count,
              comparison: quantity.comparison,
              counted: resolved.entry.label,
            },
          );
        },
      };
    },
  };
}

interface Relation {
  words: string[];
  id: string;
  axis: 'vertical' | 'horizontal';
  /**
   * True when the relation points towards larger coordinates **in a scene**.
   *
   * The two coordinate spaces disagree about which way is up: a scene's y grows
   * upward, SVG's grows downward. So "above" is the larger y in one and the
   * smaller y in the other, and this flag is inverted for the vertical axis on
   * the vector surface. A single comparison shared by both would invert every
   * vertical verdict while leaving every horizontal one correct — the kind of
   * bug that survives a casual test.
   */
  towardsGreater: boolean;
}

const RELATIONS: Relation[] = [
  { words: ['above', 'over', 'higher than', 'on top of'], id: 'above', axis: 'vertical', towardsGreater: true },
  { words: ['below', 'under', 'beneath', 'lower than'], id: 'below', axis: 'vertical', towardsGreater: false },
  { words: ['left of', 'to the left of'], id: 'left-of', axis: 'horizontal', towardsGreater: false },
  { words: ['right of', 'to the right of'], id: 'right-of', axis: 'horizontal', towardsGreater: true },
];

/**
 * Boxes that merely touch are not overlapping, so a separation of zero satisfies
 * a direction relation. A post sitting exactly on a base is above it.
 */
const SEPARATION_TOLERANCE = 1e-6;

/**
 * How far apart two boxes are along one axis, signed so that a positive result
 * means the relation holds.
 */
function separation(
  subject: { min: number[]; max: number[] },
  object: { min: number[]; max: number[] },
  axis: number,
  towardsGreater: boolean,
): number {
  return towardsGreater
    ? (subject.min[axis] ?? 0) - (object.max[axis] ?? 0)
    : (object.min[axis] ?? 0) - (subject.max[axis] ?? 0);
}

/** Normalises the two bound shapes to plain number arrays, so one runner serves both. */
function boxFor(m: Measures, name: string): { min: number[]; max: number[] } | null {
  if (m.surface === 'scene') {
    const found = m.scene?.digest.partBounds[name];
    return found ? { min: [...found.min], max: [...found.max] } : null;
  }
  const found = m.svg?.elementBounds[name];
  return found ? { min: [...found.min], max: [...found.max] } : null;
}

function relationRule(): Rule {
  return {
    id: 'spatial-relation',
    appliesTo: ['vector', 'scene'],
    build: (criterion) => {
      const text = normalise(criterion);
      for (const relation of RELATIONS) {
        for (const phrase of relation.words) {
          const pattern = new RegExp(`^(.+?)\\s+(?:is\\s+|sits\\s+|lies\\s+)?(?:directly\\s+)?${escapeRegex(phrase)}\\s+(.+)$`);
          const matched = pattern.exec(text);
          if (!matched?.[1] || !matched[2]) continue;
          const subject = matched[1];
          const object = stripArticles(matched[2]).replace(/[.?!]$/, '');
          return {
            rule: `relation-${relation.id}`,
            kind: 'geometric',
            run: (m) => runRelation(m, subject, object, relation),
          };
        }
      }
      return null;
    },
  };
}

function runRelation(
  m: Measures,
  subjectRaw: string,
  objectRaw: string,
  relation: Relation,
): CheckResult {
  const keys = namesFor(m);
  if (keys.length === 0) return missing('Any named part or element');

  const subject = resolveName(subjectRaw, keys);
  const object = resolveName(objectRaw, keys);
  const measured: Record<string, number | string | boolean> = {
    subject: subject.key ?? subjectRaw,
    object: object.key ?? objectRaw,
    triedSubject: subject.tried.join('|'),
    triedObject: object.tried.join('|'),
  };
  if (!subject.key) {
    return result(
      'not-met',
      `No part or element named "${subjectRaw.trim()}" exists, so it cannot be ${relation.id.replace('-', ' ')} "${objectRaw}". Names present: ${keys.join(', ') || 'none'}.`,
      measured,
    );
  }
  if (!object.key) {
    return result(
      'not-met',
      `"${subject.key}" exists but nothing is named "${objectRaw}", so the relation cannot hold. Names present: ${keys.join(', ') || 'none'}.`,
      measured,
    );
  }

  const subjectBox = boxFor(m, subject.key);
  const objectBox = boxFor(m, object.key);
  if (!subjectBox || !objectBox) {
    return result(
      'unverifiable',
      `Bounds are not available for ${!subjectBox ? subject.key : object.key}, which is a group or has no measurable geometry.`,
      measured,
    );
  }

  const axis = relation.axis === 'vertical' ? 1 : 0;
  const towardsGreater =
    relation.axis === 'vertical' && m.surface === 'vector'
      ? !relation.towardsGreater
      : relation.towardsGreater;
  const gap = separation(subjectBox, objectBox, axis, towardsGreater);
  const ok = gap >= -SEPARATION_TOLERANCE;
  const axisName = axis === 1 ? 'y' : 'x';
  const direction = relation.id.replace('-', ' ');

  const detail =
    gap > 0
      ? `They are separated by ${fmt(gap)} along ${axisName}, so ${subject.key} is ${direction} ${object.key}.`
      : gap >= -SEPARATION_TOLERANCE
        ? `Their extents along ${axisName} touch exactly without overlapping, so ${subject.key} is ${direction} ${object.key}.`
        : `They overlap by ${fmt(-gap)} along ${axisName}, so ${subject.key} is not ${direction} ${object.key}.`;

  return result(
    ok ? 'met' : 'not-met',
    `${subject.key} spans ${axisName} ${fmt(subjectBox.min[axis] ?? 0)}..${fmt(subjectBox.max[axis] ?? 0)}; ` +
      `${object.key} spans ${axisName} ${fmt(objectBox.min[axis] ?? 0)}..${fmt(objectBox.max[axis] ?? 0)}. ${detail}`,
    {
      ...measured,
      gap,
      axis: axisName,
      // The axis convention is recorded, because it differs between the two
      // surfaces and is the thing most worth double-checking in a surprising
      // verdict.
      convention: m.surface === 'scene' ? 'y-increases-upward' : 'y-increases-downward',
    },
  );
}

function containmentRule(): Rule {
  return {
    id: 'containment',
    appliesTo: ['vector', 'scene'],
    build: (criterion) => {
      const text = normalise(criterion);
      const matched = /^(.+?)\s+(?:is\s+)?(?:fully\s+)?(?:inside|within|contained in|contained by)\s+(.+)$/.exec(text);
      if (!matched?.[1] || !matched[2]) return null;
      const subjectRaw = matched[1].replace(/^(?:the|a|an)\s+/, '');
      const objectRaw = stripArticles(matched[2]).replace(/[.?!]$/, '');
      return {
        rule: 'containment',
        kind: 'geometric',
        run: (m) => {
          const keys = namesFor(m);
          if (keys.length === 0) return missing('Any named part or element');
          const subject = resolveName(subjectRaw, keys);
          const object = resolveName(objectRaw, keys);
          const measured: Record<string, number | string | boolean> = {
            subject: subject.key ?? subjectRaw,
            object: object.key ?? objectRaw,
          };
          if (!subject.key || !object.key) {
            return result(
              'not-met',
              !subject.key
                ? `No part or element named "${subjectRaw}" exists.`
                : `Nothing is named "${objectRaw}", so containment cannot hold.`,
              measured,
            );
          }
          if (m.surface === 'vector') {
            const inner = m.svg?.elementBounds[subject.key];
            const outer = m.svg?.elementBounds[object.key];
            if (!inner || !outer) return missing('Element bounds for both named elements');
            const ok = bounds2DContains(outer, inner);
            return result(
              ok ? 'met' : 'not-met',
              `${subject.key} spans x ${fmt(inner.min[0])}..${fmt(inner.max[0])}, y ${fmt(inner.min[1])}..${fmt(inner.max[1])}; ` +
                `${object.key} spans x ${fmt(outer.min[0])}..${fmt(outer.max[0])}, y ${fmt(outer.min[1])}..${fmt(outer.max[1])}.`,
              {
                ...measured,
                overflowLeft: Math.max(0, outer.min[0] - inner.min[0]),
                overflowRight: Math.max(0, inner.max[0] - outer.max[0]),
                overflowTop: Math.max(0, outer.min[1] - inner.min[1]),
                overflowBottom: Math.max(0, inner.max[1] - outer.max[1]),
              },
            );
          }
          const inner = m.scene?.digest.partBounds[subject.key];
          const outer = m.scene?.digest.partBounds[object.key];
          if (!inner || !outer) return missing('Part bounds for both named parts');
          const ok = contains3(outer, inner);
          const size = boundsSize(outer);
          return result(
            ok ? 'met' : 'not-met',
            `${subject.key} spans x ${fmt(inner.min[0])}..${fmt(inner.max[0])}, y ${fmt(inner.min[1])}..${fmt(inner.max[1])}, z ${fmt(inner.min[2])}..${fmt(inner.max[2])}; ` +
              `${object.key} spans x ${fmt(outer.min[0])}..${fmt(outer.max[0])}, y ${fmt(outer.min[1])}..${fmt(outer.max[1])}, z ${fmt(outer.min[2])}..${fmt(outer.max[2])} (size ${fmt(size[0])}x${fmt(size[1])}x${fmt(size[2])}).`,
            { ...measured, contained: ok },
          );
        },
      };
    },
  };
}

function contains3(outer: Bounds, inner: Bounds, tolerance = 1e-6): boolean {
  for (let i = 0; i < 3; i++) {
    if ((inner.min[i] ?? 0) < (outer.min[i] ?? 0) - tolerance) return false;
    if ((inner.max[i] ?? 0) > (outer.max[i] ?? 0) + tolerance) return false;
  }
  return true;
}

function restingRule(): Rule {
  return {
    id: 'rests-on',
    appliesTo: ['scene'],
    build: (criterion) => {
      const text = normalise(criterion);
      const matched = /^(.+?)\s+(?:sits|rests|stands|is seated|is mounted)\s+(?:directly\s+)?on\s+(?:top of\s+)?(.+)$/.exec(text);
      if (!matched?.[1] || !matched[2]) return null;
      const subjectRaw = stripArticles(matched[1]);
      const objectRaw = stripArticles(matched[2]).replace(/[.?!]$/, '');
      return {
        rule: 'rests-on',
        kind: 'geometric',
        run: (m) => {
          const keys = namesFor(m);
          if (keys.length === 0) return missing('Any named part');
          const subject = resolveName(subjectRaw, keys);
          const object = resolveName(objectRaw, keys);
          const measured: Record<string, number | string | boolean> = {
            subject: subject.key ?? subjectRaw,
            object: object.key ?? objectRaw,
          };
          if (!subject.key || !object.key) {
            return result(
              'not-met',
              !subject.key
                ? `No part named "${subjectRaw}" exists.`
                : `Nothing is named "${objectRaw}", so it cannot be rested on.`,
              measured,
            );
          }
          const upper = m.scene?.digest.partBounds[subject.key];
          const lower = m.scene?.digest.partBounds[object.key];
          if (!upper || !lower) return missing('Part bounds for both named parts');

          // Contact is two claims, not one: the surfaces must meet, and they must
          // meet *over* each other. A post exactly one metre to the side of a
          // base has its bottom at the same height, and is not standing on it.
          const gap = upper.min[1] - lower.max[1];
          const overlapX = Math.min(upper.max[0], lower.max[0]) - Math.max(upper.min[0], lower.min[0]);
          const overlapZ = Math.min(upper.max[2], lower.max[2]) - Math.max(upper.min[2], lower.min[2]);
          const footprint = Math.max(0, overlapX) * Math.max(0, overlapZ);
          const touching = Math.abs(gap) <= 1e-4;
          const ok = touching && footprint > 0;
          const detail = !touching
            ? gap > 0
              ? `There is a gap of ${fmt(gap)} between them.`
              : `They interpenetrate by ${fmt(Math.abs(gap))}.`
            : footprint > 0
              ? 'The surfaces meet and their footprints overlap.'
              : 'The surfaces meet but their footprints do not overlap, so it is beside rather than on.';
          return result(
            ok ? 'met' : 'not-met',
            `${subject.key} sits at y ${fmt(upper.min[1])}..${fmt(upper.max[1])}; ${object.key} tops out at y ${fmt(lower.max[1])}. ${detail}`,
            { ...measured, gap, footprint },
          );
        },
      };
    },
  };
}

function hierarchyRule(): Rule {
  return {
    id: 'parentage',
    appliesTo: ['scene'],
    build: (criterion) => {
      const text = normalise(criterion);
      const matched =
        /^(.+?)\s+is\s+(?:a\s+)?(?:child|part|component|piece)\s+of\s+(.+)$/.exec(text) ??
        /^(.+?)\s+(?:is\s+)?belongs\s+to\s+(.+)$/.exec(text) ??
        /^(.+?)\s+is\s+attached\s+to\s+(.+)$/.exec(text);
      if (!matched?.[1] || !matched[2]) return null;
      const childRaw = stripArticles(matched[1]);
      const parentRaw = stripArticles(matched[2]).replace(/[.?!]$/, '');
      return {
        rule: 'parentage',
        kind: 'geometric',
        run: (m) => {
          const parents = m.scene?.parents;
          if (!parents) return missing('The assembly hierarchy');
          const keys = Object.keys(parents);
          if (keys.length === 0) return missing('Any named part');

          // Walk the chain rather than checking only the immediate parent, so a
          // claim about ancestry is answered as written. "The shade is part of
          // the lamp" is true of a shade bolted to a post bolted to a lamp, and
          // reporting it false because the post intervenes would be pedantic in
          // the least useful direction.
          const child = resolveName(childRaw, keys);
          const parent = resolveName(parentRaw, keys);
          const measured: Record<string, number | string | boolean> = {
            child: child.key ?? childRaw,
            ancestor: parent.key ?? parentRaw,
          };
          if (!child.key || !parent.key) {
            return result(
              'not-met',
              !child.key
                ? `No part named "${childRaw}" exists. Parts present: ${keys.join(', ')}.`
                : `No part named "${parentRaw}" exists. Parts present: ${keys.join(', ')}.`,
              measured,
            );
          }
          const chain: string[] = [];
          let cursor: string | null | undefined = child.key;
          let depth = 0;
          while (cursor && depth < 64) {
            chain.push(cursor);
            if (cursor === parent.key) break;
            cursor = parents[cursor] ?? null;
            depth++;
          }
          const ok = chain[chain.length - 1] === parent.key && chain.length > 1;
          return result(
            ok ? 'met' : 'not-met',
            ok
              ? `${child.key} is a descendant of ${parent.key} through ${chain.join(' -> ')}.`
              : `${child.key} has the ancestry ${chain.join(' -> ')}, which does not include ${parent.key}.`,
            { ...measured, chain: chain.join(' -> '), depth: chain.length - 1 },
          );
        },
      };
    },
  };
}

function overlapRule(): Rule {
  return {
    id: 'no-overlap',
    appliesTo: ['scene'],
    build: (criterion) => {
      const text = normalise(criterion);
      const negative = /\b(?:do not|don't|does not|never|must not|no)\b[^.]*\boverlap/.test(text);
      const positive = /\boverlap/.test(text) && !negative;
      if (!positive && !negative) return null;
      return {
        rule: negative ? 'no-overlap' : 'overlap',
        kind: 'geometric',
        run: (m) => {
          const digest = m.scene?.digest;
          if (!digest) return missing('The scene measurement');
          const pairs = digest.overlappingPairs;
          const ok = negative ? pairs.length === 0 : pairs.length > 0;
          const rendered = pairs.map(([a, b]) => `${a}/${b}`).join(', ');
          return result(
            ok ? 'met' : 'not-met',
            pairs.length === 0
              ? 'No two named parts share volume.'
              : `${pairs.length} pair${pairs.length === 1 ? '' : 's'} share volume: ${rendered}. (Bounding boxes, so a close-fitting pair can be reported without truly touching.)`,
            { overlappingPairs: pairs.length, pairs: rendered },
          );
        },
      };
    },
  };
}

function canvasRule(): Rule {
  return {
    id: 'canvas-size',
    appliesTo: ['vector'],
    build: (criterion) => {
      const text = normalise(criterion);
      if (!/\b(?:canvas|viewbox|drawing|image|page)\b/.test(text)) return null;

      const ratio = /\b(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)\b/.exec(text);
      if (!ratio?.[1] || !ratio[2]) return null;
      const wanted = Number.parseFloat(ratio[1]) / Number.parseFloat(ratio[2]);
      if (!Number.isFinite(wanted) || wanted <= 0) return null;
      if (!/\baspect\b|\bratio\b|:/.test(text)) return null;
      return {
        rule: 'canvas-aspect',
        kind: 'structural',
        run: (m) => {
          const aspect = m.svg?.digest.aspectRatio;
          if (aspect === null || aspect === undefined) return missing('The viewBox aspect ratio');
          const tolerance = 0.01;
          const ok = Math.abs(aspect - wanted) <= tolerance;
          return result(
            ok ? 'met' : 'not-met',
            `The viewBox is ${JSON.stringify(m.svg?.digest.viewBox)} giving an aspect ratio of ${aspect.toFixed(4)}; ${ratio[0]} asks for ${wanted.toFixed(4)}.`,
            { actual: aspect, wanted, tolerance },
          );
        },
      };
    },
  };
}

function textRule(): Rule {
  return {
    id: 'contains-text',
    appliesTo: ['vector'],
    build: (criterion) => {
      const matched =
        /(?:contains?|includes?|shows?|says?|reads?|displays?|with)\s+(?:the\s+)?(?:text|word|words|string|label|title)\s+["'“”]?([^"'””]+)["'“”]?\s*$/i.exec(
          criterion.trim(),
        );
      if (!matched?.[1]) return null;
      const wanted = matched[1].trim().toLowerCase();
      if (!wanted) return null;
      return {
        rule: 'contains-text',
        kind: 'structural',
        run: (m) => {
          if (!m.svg) return missing('The source text');
          const haystack = m.svg.digest.text.join(' ').toLowerCase();
          const ok = haystack.includes(wanted);
          return result(
            ok ? 'met' : 'not-met',
            ok
              ? `The drawing's text contains "${wanted}".`
              : `The drawing's text is ${m.svg.digest.text.length === 0 ? 'empty' : JSON.stringify(m.svg.digest.text)}; it does not contain "${wanted}".`,
            { wanted, textElements: m.svg.digest.text.length },
          );
        },
      };
    },
  };
}

function namedThingRule(): Rule {
  return {
    id: 'named-thing-exists',
    appliesTo: ['vector', 'scene'],
    build: (criterion) => {
      const matched =
        /\b(?:has|have|with|contains?|includes?)\s+(?:an?\s+)?(?:element|part|group|layer|object|node)?\s*(?:named|called|labelled|labeled)\s+["'“”]?([^"'“”,.]+)["'“”]?/i.exec(
          criterion,
        );
      if (!matched?.[1]) return null;
      const wanted = matched[1].trim();
      if (!wanted) return null;
      return {
        rule: 'named-thing-exists',
        kind: 'structural',
        run: (m) => {
          const keys = m.surface === 'vector' ? (m.svg?.digest.ids ?? null) : (m.scene?.digest.partNames ?? null);
          if (!keys) return missing('The list of names');
          const resolved = resolveName(wanted, keys);
          const ok = resolved.key !== null;
          return result(
            ok ? 'met' : 'not-met',
            ok
              ? `"${resolved.key}" is present.`
              : `No part or element named "${wanted}" exists. Names present: ${keys.join(', ') || 'none'}.`,
            { wanted, present: keys.length, resolvedAs: resolved.key ?? '' },
          );
        },
      };
    },
  };
}

function depthRule(): Rule {
  return {
    id: 'assembly-depth',
    appliesTo: ['scene'],
    build: (criterion) => {
      const text = normalise(criterion);
      if (!/\b(?:nested|hierarch|assembly|tree|depth|depth of|levels?)\b/.test(text)) return null;
      const quantity = parseQuantity(criterion);
      if (!quantity) return null;
      return {
        rule: 'assembly-depth',
        kind: 'structural',
        run: (m) => {
          const digest = m.scene?.digest;
          if (!digest) return missing('The scene measurement');
          const ok = satisfies(quantity.comparison, digest.maxDepth + 1, quantity.count);
          return result(
            ok ? 'met' : 'not-met',
            `The deepest part is ${digest.maxDepth} level${digest.maxDepth === 1 ? '' : 's'} below its root, so the assembly has ${digest.maxDepth + 1} level${digest.maxDepth === 0 ? '' : 's'} (${COMPARISON_PHRASE[quantity.comparison]} ${quantity.count} required).`,
            { levels: digest.maxDepth + 1, wanted: quantity.count, comparison: quantity.comparison },
          );
        },
      };
    },
  };
}

function pixelRule(): Rule {
  return {
    id: 'rendered-image',
    appliesTo: ['vector', 'scene'],
    build: (criterion) => {
      const text = normalise(criterion);

      if (/\b(?:not\s+blank|not\s+empty|is\s+blank|is\s+empty|nothing\s+is\s+drawn|something\s+is\s+drawn|has\s+content)\b/.test(text)) {
        const wantContent = !/\b(?:is\s+blank|is\s+empty|nothing\s+is\s+drawn)\b/.test(text);
        return {
          rule: 'rendered-not-blank',
          kind: 'pixel',
          run: (m) => runOverViews(m, wantContent ? 'not-blank' : 'blank'),
        };
      }

      if (/\b(?:cut\s+off|clipped|clip(ping)?|runs?\s+off|off\s+the\s+edge|overflows?)\b/.test(text)) {
        const negative = /\b(?:not|no|nothing|never|without)\b/.test(text);
        return {
          rule: negative ? 'rendered-not-clipped' : 'rendered-clipped',
          kind: 'pixel',
          run: (m) => runOverViews(m, negative ? 'not-clipped' : 'clipped'),
        };
      }

      const contrast = /\bcontrast\b[^0-9]*(\d+(?:\.\d+)?)/.exec(text);
      if (contrast?.[1]) {
        const wanted = Number.parseFloat(contrast[1]);
        return {
          rule: 'rendered-contrast',
          kind: 'pixel',
          run: (m) => {
            const views = m.pixels?.views ?? null;
            if (!views || views.length === 0) return missing('A rendered view');
            const worst = views.reduce((a, b) => (a.stats.contrastRatio <= b.stats.contrastRatio ? a : b));
            const ok = worst.stats.contrastRatio >= wanted;
            return result(
              ok ? 'met' : 'not-met',
              `Contrast between the dominant colour and the next most common was ${worst.stats.contrastRatio.toFixed(2)} in view "${worst.view}" and no worse elsewhere (WCAG needs ${wanted}).`,
              {
                contrastRatio: worst.stats.contrastRatio,
                wanted,
                view: worst.view,
                perView: views.map((v) => `${v.view}:${v.stats.contrastRatio.toFixed(2)}`).join(' '),
              },
            );
          },
        };
      }

      const quantity = parseQuantity(criterion);
      const head = quantity?.noun.split(' ').filter(Boolean).pop();
      if (quantity && head && COLOUR_NOUNS.has(head) && /\bdistinct\b/.test(text)) {
        return {
          rule: 'rendered-colour-count',
          kind: 'pixel',
          run: (m) => {
            const views = m.pixels?.views ?? null;
            if (!views || views.length === 0) return missing('A rendered view');
            const worst = views.reduce((a, b) => (a.stats.distinctColors <= b.stats.distinctColors ? a : b));
            const ok = satisfies(quantity.comparison, worst.stats.distinctColors, quantity.count);
            return result(
              ok ? 'met' : 'not-met',
              `The fewest distinct colours in any view was ${worst.stats.distinctColors} in "${worst.view}" (${COMPARISON_PHRASE[quantity.comparison]} ${quantity.count} required). Rendered counts include antialiasing, so they run high.`,
              { distinctColors: worst.stats.distinctColors, wanted: quantity.count, view: worst.view },
            );
          },
        };
      }

      return null;
    },
  };
}

function runOverViews(m: Measures, mode: 'not-blank' | 'blank' | 'not-clipped' | 'clipped'): CheckResult {
  const views = m.pixels?.views ?? null;
  if (!views || views.length === 0) return missing('A rendered view');

  const perView = views.map((v) => `${v.view}:${(v.stats.inkCoverage * 100).toFixed(1)}%`).join(' ');

  if (mode === 'not-blank' || mode === 'blank') {
    const blankOnes = views.filter((v) => v.stats.blank);
    const ok = mode === 'not-blank' ? blankOnes.length === 0 : blankOnes.length === views.length;
    return result(
      ok ? 'met' : 'not-met',
      mode === 'not-blank'
        ? blankOnes.length === 0
          ? `Every view has content drawn (ink coverage ${perView}).`
          : `${blankOnes.length} of ${views.length} views are blank: ${blankOnes.map((v) => v.view).join(', ')}.`
        : `${blankOnes.length} of ${views.length} views are blank.`,
      { blankViews: blankOnes.length, views: views.length, inkCoverage: perView },
    );
  }

  // A border that differs from the *dominant* colour is what "cut off" means
  // here. A drawing with a full-bleed background is not clipped, because its
  // border pixels are that background.
  const threshold = 0.05;
  const clipped = views.filter((v) => v.stats.edgeCoverage > threshold);
  const ok = mode === 'not-clipped' ? clipped.length === 0 : clipped.length > 0;
  return result(
    ok ? 'met' : 'not-met',
    clipped.length === 0
      ? `No view has more than ${(threshold * 100).toFixed(0)}% of its border differing from its dominant colour.`
      : `Views with a busy border: ${clipped.map((v) => `${v.view} (${(v.stats.edgeCoverage * 100).toFixed(1)}%)`).join(', ')}. Content reaching the edge can be deliberate, so read the number rather than the verdict.`,
    {
      clippedViews: clipped.length,
      threshold,
      edgeCoverage: views.map((v) => `${v.view}:${v.stats.edgeCoverage.toFixed(3)}`).join(' '),
    },
  );
}

function safeSourceRule(): Rule {
  return {
    id: 'source-safety',
    appliesTo: ['vector'],
    build: (criterion) => {
      const text = normalise(criterion);
      if (!/\b(?:safe|no\s+scripts?|without\s+scripts?|no\s+javascript|no\s+external|self-?contained)\b/.test(text)) return null;
      return {
        rule: 'source-safety',
        kind: 'structural',
        run: (m) => {
          if (!m.svg) return missing('The parsed document');
          const blocking: SvgIssue['code'][] = [
            'script-element',
            'event-handler',
            'javascript-url',
            'foreign-element',
            'external-reference',
          ];
          const found = m.svg.issues.filter((issue) => blocking.includes(issue.code));
          return result(
            found.length === 0 ? 'met' : 'not-met',
            found.length === 0
              ? 'The document contains no script, event handler, external reference, or foreign element.'
              : `The document contains ${found.map((i) => i.code).join(', ')}.`,
            { unsafeIssues: found.length, codes: found.map((i) => i.code).join(',') },
          );
        },
      };
    },
  };
}

/**
 * The complete vocabulary, in precedence order.
 *
 * Order matters and is deliberate: the more specific phrasing is tried first, so
 * "the shade is above the post" is read as a relation rather than as a count,
 * and "the drawing has three colours" is read as a palette claim rather than
 * being silently refused for not naming a colour.
 */
const RULES: Rule[] = [
  safeSourceRule(),
  canvasRule(),
  pixelRule(),
  textRule(),
  restingRule(),
  hierarchyRule(),
  containmentRule(),
  relationRule(),
  overlapRule(),
  depthRule(),
  namedThingRule(),
  countRule(),
];

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

/**
 * Compiles each criterion into a check, or refuses it with a reason.
 *
 * Compilation is pure and total: every criterion comes back either with a check
 * or with a refusal, never with neither. The caller can therefore always show a
 * person exactly which of their criteria the harness will settle itself.
 */
export function compileCriteria(criteria: string[], surface: Surface): Compilation {
  const compiled: CompiledCriterion[] = [];
  const refused: CheckRefusal[] = [];

  for (const raw of criteria) {
    const criterion = raw.trim();
    if (!criterion) continue;
    let check: HostCheck | null = null;
    for (const rule of RULES) {
      if (!rule.appliesTo.includes(surface)) continue;
      check = rule.build(criterion, surface);
      if (check) break;
    }
    if (check) {
      compiled.push({ criterion, check, refusal: null });
      continue;
    }
    // The refusal names what the harness could have checked instead, because a
    // bare "cannot check that" leaves the person with nothing to act on.
    const refusal: CheckRefusal = {
      criterion,
      reason:
        surface === 'vector'
          ? 'No host check matches this wording. It can be restated as a count ("exactly five circles"), a name ("has an element named sun"), a position ("the sun is above the horizon"), a size ("the canvas aspect ratio is 16:9"), text content, a palette count, or a property of the rendered image (not blank, not clipped, contrast of 4.5). Otherwise it is a judgement about how the picture looks, and only a vision model can offer an opinion on it.'
          : 'No host check matches this wording. It can be restated as a count ("exactly three cylinders"), a name ("has a part named shade"), a position ("the shade is above the post"), resting contact ("the post sits on the base"), ancestry ("the shade is part of the lamp"), a joint count, or a property of the rendered views (not blank, nothing clipped). Otherwise it is a judgement about how the model looks, and only a vision model can offer an opinion on it.',
    };
    compiled.push({ criterion, check: null, refusal });
    refused.push(refusal);
  }

  return { criteria: compiled, refused };
}

/**
 * Runs every compiled check against the measurements.
 *
 * A check whose measurement is absent yields `unverifiable` rather than a
 * verdict. That is the whole point of having three outcomes: a failed render
 * must not be recorded as a drawing that failed its criteria.
 */
export function runChecks(criteria: string[], m: Measures): CheckRun {
  const compilation = compileCriteria(criteria, m.surface);
  const findings: DeterministicFinding[] = [];

  for (const entry of compilation.criteria) {
    if (!entry.check) continue;
    const outcome = entry.check.run(m);
    findings.push({
      criterion: entry.criterion,
      kind: entry.check.kind,
      outcome: outcome.outcome,
      evidence: outcome.evidence,
      measured: { ...outcome.measured, rule: entry.check.rule },
    });
  }

  return { findings, refusals: compilation.refused };
}

/* ------------------------------------------------------------------ */
/* The vocabulary, published                                           */
/* ------------------------------------------------------------------ */

export interface CheckVocabulary {
  /** Words that can be counted on this surface, with their canonical plural. */
  nouns: { word: string; label: string }[];
  /** Relative-position words, with the axis each is read along. */
  relations: { word: string; axis: 'vertical' | 'horizontal' }[];
  /** What the checks can decide, in plain terms, for an author to aim at. */
  settlable: string[];
  /** What no check can decide on any surface, so a model is asked and its answer is an opinion. */
  notSettlable: string[];
}

/**
 * What each rule settles, in plain terms, keyed by rule id.
 *
 * Kept beside `RULES` rather than inside it so a rule can be read as code, but
 * the two are held together by a test: `ruleIds()` and this map must list
 * exactly the same ids, so a rule cannot be added without saying what it
 * settles, and this cannot describe a rule that does not exist.
 */
const RULE_DESCRIPTIONS: Record<string, string> = {
  'source-safety': 'whether the source stays inside the safe subset',
  'canvas-size': 'whether the drawing fits the canvas it declares',
  'rendered-image': 'whether anything was actually drawn, and how much ink covers the frame',
  'contains-text': 'whether the drawing contains text, and which words',
  'rests-on': 'whether one part of an assembly sits on top of another rather than beside or through it',
  'parentage': 'how the parts of an assembly nest, and which part is a child of which',
  'containment': 'whether one named thing is inside another',
  'spatial-relation': 'whether one named thing is above, below, left of or right of another',
  'no-overlap': 'whether two named things overlap, or are clear of each other',
  'assembly-depth': 'how deep the assembly is',
  'named-thing-exists': 'whether a named thing exists, and whether a name is used only once',
  'count-of-kind': 'how many of a named kind there are, and how many distinct colours are used',
};

/** The rule ids in precedence order, so a test can hold the published map to them. */
export function ruleIds(): string[] {
  return RULES.map((rule) => rule.id);
}

/**
 * What a criterion can be written in, for one surface.
 *
 * Published so an author writes criteria that can actually be settled instead of
 * finding out by having them refused. Every list here is derived from the live
 * tables — the nouns, the relations and the rules the compiler itself uses — so
 * it cannot promise something `compileCriteria` would reject. That failure mode
 * is the one this file exists to prevent: a confident statement about what was
 * checked, when nothing was.
 *
 * `notSettlable` is part of the answer on purpose. An author who knows that
 * "it looks balanced" will never be settled by a check can choose whether to
 * write it anyway and take an opinion, or write something checkable instead.
 */
export function checkVocabulary(surface: Surface): CheckVocabulary {
  const nouns: { word: string; label: string }[] = [];
  for (const [word, entry] of Object.entries(NOUNS)) {
    if (entry.appliesTo.includes(surface)) nouns.push({ word, label: entry.label });
  }
  nouns.sort((a, b) => a.word.localeCompare(b.word));

  // One word per relation: the entries within one are synonyms, and listing all
  // four spellings of "above" would suggest they mean different things.
  const seenRelations = new Set<string>();
  const relations: { word: string; axis: 'vertical' | 'horizontal' }[] = [];
  for (const relation of RELATIONS) {
    const word = relation.words[0];
    if (!word || seenRelations.has(relation.id)) continue;
    seenRelations.add(relation.id);
    relations.push({ word, axis: relation.axis });
  }

  // Only what this surface can actually reach. A scene rule is not described to
  // a drawing author, because offering it would be an instruction to write a
  // criterion that comes straight back as a refusal.
  const settlable: string[] = [];
  for (const rule of RULES) {
    if (!rule.appliesTo.includes(surface)) continue;
    const description = RULE_DESCRIPTIONS[rule.id];
    if (description) settlable.push(description);
  }

  return {
    nouns,
    relations,
    settlable,
    notSettlable: [
      'whether the picture is any good, balanced, or pleasing',
      'whether a shape resembles the thing it is meant to depict',
      'whether a colour is appropriate for the subject',
      'whether a composition reads well at a glance',
      'anything about geometry that a given view hides',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function fmt(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

