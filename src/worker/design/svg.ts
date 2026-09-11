/**
 * Reading an authored SVG: the vector half of the design harness.
 *
 * There is no `DOMParser` in workerd and no DOM to lean on, so the document is
 * tokenised here. A hand-written parser is where the bugs are, and that is the
 * cost being paid. It buys two things that are worth it. First, the parser runs
 * in the same process as the checks, so a criterion about an authored drawing
 * is settled by arithmetic on the text rather than by asking a renderer what it
 * thinks. Second, the security posture is the opposite of a sanitiser's:
 * anything the parser cannot account for exactly is refused rather than cleaned
 * up. A `DOCTYPE` or an `ENTITY` declaration is a parse failure, not something
 * to strip, because a document that carries one is asking a browser to expand
 * text this code did not write and cannot see. Refusing loses nothing real —
 * an authored drawing has no use for either — and it removes the whole class of
 * expansion attacks rather than the instances someone thought of.
 *
 * The split between the two halves is deliberate. `parseSvg` fails only on
 * structure — malformed XML, a non-`svg` root, a DOCTYPE. `validateSvg` reports
 * what is dangerous or absent about a document that parsed cleanly, so a caller
 * can tell someone what was wrong with their artifact instead of only that it
 * was rejected. A drawing with a `<script>` in it parses; it is reported.
 *
 * Nothing here imports Ink, the registry, or a provider.
 */

// `Result` is defined once, in the shared contract; `./types` deliberately does
// not redeclare it. The relative path keeps this module's dependencies to the
// files beside it and that one contract.
import { fail, ok, type Result } from '../../shared/types';
import {
  boundsFromPoints2D,
  clamp,
  normaliseColor,
  parseLength,
  parseNumberList,
  unionBounds2D,
} from './math';
import type { Bounds2D, SvgDigest, SvgDocument, SvgElement, SvgIssue, Vec2 } from './types';

/* ------------------------------------------------------------------ */
/* Failures                                                            */
/* ------------------------------------------------------------------ */

/**
 * The SVG default canvas, in user units. Used when a document declares neither
 * a viewBox nor a usable width and height, and reported as `missing-viewbox`
 * because a drawing that was laid out against an implied 300x150 canvas is
 * usually a drawing whose author forgot to say how big it was.
 */
const DEFAULT_VIEWBOX: [number, number, number, number] = [0, 0, 300, 150];

/**
 * Deepest element nesting accepted. The element tree is walked recursively by
 * `elementBounds2D` and `svgDigest`, and a stack overflow inside the Worker is
 * a hard failure rather than a reportable one, so the depth is refused up front
 * where it can still be explained. Real drawings nest a handful deep.
 */
const MAX_DEPTH = 256;

/** An XML name. Namespace prefixes are permitted here and stripped later. */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_.:-]/.test(ch);
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * Line and column, for a message someone has to act on. Computed only on the
 * failure path, so the scan is paid for once per rejected document rather than
 * once per token.
 */
function positionOf(source: string, index: number): string {
  let line = 1;
  let lineStart = 0;
  const limit = Math.min(index, source.length);
  for (let i = 0; i < limit; i++) {
    if (source[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return `line ${line}, column ${index - lineStart + 1}`;
}

function syntaxError<T>(source: string, index: number, message: string): Result<T> {
  return fail('invalid-argument', `${message} (${positionOf(source, index)})`);
}

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const ENTITY_PATTERN = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g;

/**
 * Decodes the five predefined entities and numeric character references.
 *
 * With DOCTYPE refused, no other named entity can be *declared*, so an
 * unrecognised name is left exactly as written rather than dropped or treated
 * as an error. Dropping it would silently delete text, and failing on it would
 * reject documents that browsers render — `&nbsp;` turns up in real authored
 * files even though nothing declares it. Leaving it literal is the one option
 * that neither invents a character nor loses one.
 */
function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(ENTITY_PATTERN, (match: string, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const digits = body.slice(hex ? 2 : 1);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      // Surrogates and out-of-range values are not characters; a browser drops
      // the reference, and so does this. `fromCodePoint` would throw rather
      // than return something unusable.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/* ------------------------------------------------------------------ */
/* Element helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Attribute lookup, case-insensitively on the name.
 *
 * SVG attribute names are case-sensitive in the spec, and this is deliberately
 * looser than that: hand-written and tool-written files both turn up with
 * `viewbox` or `STOP-COLOR`, and reading one is never worse than missing it.
 * Values are never folded except where the value grammar is itself
 * case-insensitive — a colour name, a scheme, a transform function.
 */
function attributeOf(el: SvgElement, name: string): string | null {
  const direct = el.attributes[name];
  if (direct !== undefined) return direct;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(el.attributes)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

function lowerAttributes(el: SvgElement): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(el.attributes)) out.push([key.toLowerCase(), value]);
  return out;
}

/** A user-unit length. See `userLength` for what that admits. */
const ABSOLUTE_UNITS: Record<string, number> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 4 / 3,
  pc: 16,
};

/**
 * A length from a shape attribute, in user units.
 *
 * `px` is accepted because a px is a user unit — Illustrator and Figma write
 * `width="100px"` and a browser draws exactly 100 units. The physical units
 * have fixed CSS ratios, so they convert exactly. Everything else (`%`, `em`,
 * `ex`, `vw`) needs context this module does not have, and comes back null so
 * a caller sees "unknown" rather than a number that is wrong by a factor.
 *
 * The document's own width and height are reported through `parseLength`
 * instead, per the `SvgDocument` contract: a `width="100pt"` canvas reports
 * 100 and synthesises a 100-unit viewBox, while a `width="100pt"` rect measures
 * 133.3 units. The two disagree only for a unit no authored drawing uses.
 */
function userLength(value: string | null): number | null {
  if (value === null) return null;
  const parsed = parseLength(value);
  if (!parsed) return null;
  const scale = ABSOLUTE_UNITS[parsed.unit];
  if (scale === undefined) return null;
  return parsed.value * scale;
}

/**
 * An x or y coordinate, which SVG may write as a list when a single element
 * lays out several glyphs. The first entry is where the element starts, which
 * is the end a bounds calculation wants.
 */
function userCoordinate(value: string | null): number | null {
  if (value === null) return null;
  const single = userLength(value);
  if (single !== null) return single;
  const list = parseNumberList(value);
  return list?.[0] ?? null;
}

/** The element's own characters plus every descendant's, ends trimmed. */
function subtreeText(el: SvgElement): string {
  let out = el.text;
  for (const child of el.children) out += subtreeText(child);
  return out.trim();
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

interface StartTag {
  name: string;
  attributes: Record<string, string>;
  selfClosing: boolean;
  /** Index just past the closing `>`. */
  end: number;
}

/** `svg:circle` and `circle` are the same element; the prefix is not a name. */
function localName(name: string): string {
  const colon = name.lastIndexOf(':');
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

function readStartTag(source: string, start: number): Result<StartTag> {
  let cursor = start + 1;
  const nameStart = cursor;
  while (cursor < source.length && !isSpace(source[cursor]) && source[cursor] !== '>' && source[cursor] !== '/') {
    cursor++;
  }
  const rawName = source.slice(nameStart, cursor);
  if (!NAME_PATTERN.test(rawName)) {
    return syntaxError(source, nameStart, `"${rawName}" is not a usable element name`);
  }

  // A null prototype rather than `{}`: a document may name an attribute
  // `__proto__`, and on a plain object literal that write is silently dropped,
  // which would mean a parser that cannot see everything a document says.
  const attributes: Record<string, string> = Object.create(null);
  let selfClosing = false;

  for (;;) {
    while (cursor < source.length && isSpace(source[cursor])) cursor++;
    if (cursor >= source.length) {
      return syntaxError(source, start, `The <${rawName}> tag is never closed`);
    }
    const ch = source[cursor];
    if (ch === '>') {
      cursor++;
      break;
    }
    if (ch === '/') {
      if (source[cursor + 1] !== '>') {
        return syntaxError(source, cursor, `A stray "/" inside the <${rawName}> tag`);
      }
      selfClosing = true;
      cursor += 2;
      break;
    }

    const attributeStart = cursor;
    while (isNameChar(source[cursor])) cursor++;
    const attributeName = source.slice(attributeStart, cursor);
    if (!isNameStart(attributeName[0])) {
      return syntaxError(source, attributeStart, `"${attributeName}" is not a usable attribute name`);
    }

    while (cursor < source.length && isSpace(source[cursor])) cursor++;
    if (source[cursor] !== '=') {
      // XML requires every attribute to carry a value; the HTML shorthand of a
      // bare name is not accepted, because guessing what it meant would put a
      // value in the document that its author never wrote.
      return syntaxError(source, attributeStart, `The attribute "${attributeName}" has no value`);
    }
    cursor++;
    while (cursor < source.length && isSpace(source[cursor])) cursor++;

    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      return syntaxError(source, cursor, `The value of "${attributeName}" is not quoted`);
    }
    const valueStart = cursor + 1;
    const valueEnd = source.indexOf(quote, valueStart);
    if (valueEnd === -1) {
      return syntaxError(source, valueStart, `The value of "${attributeName}" is never closed`);
    }
    // Last one wins on a repeated name, rather than failing: a duplicate is
    // malformed XML, but the document still says something usable, and a
    // caller's next move is to look at the drawing rather than at the parser.
    attributes[attributeName] = decodeEntities(source.slice(valueStart, valueEnd));
    cursor = valueEnd + 1;
  }

  return ok({ name: rawName, attributes, selfClosing, end: cursor });
}

function readEndTag(source: string, start: number): Result<{ name: string; end: number }> {
  let cursor = start + 2;
  while (cursor < source.length && isSpace(source[cursor])) cursor++;
  const nameStart = cursor;
  while (cursor < source.length && !isSpace(source[cursor]) && source[cursor] !== '>') cursor++;
  const rawName = source.slice(nameStart, cursor);
  if (!NAME_PATTERN.test(rawName)) {
    return syntaxError(source, nameStart, `"${rawName}" is not a usable element name`);
  }
  while (cursor < source.length && isSpace(source[cursor])) cursor++;
  if (source[cursor] !== '>') {
    return syntaxError(source, cursor, `Unexpected content in the </${rawName}> tag`);
  }
  return ok({ name: rawName, end: cursor + 1 });
}

/**
 * Parses an SVG document.
 *
 * Refuses, rather than repairs: malformed XML, a root that is not `svg`, and
 * any `DOCTYPE` or `ENTITY` declaration. Everything else a document can say —
 * including a `<script>` element or a `javascript:` URL — parses and is left
 * for `validateSvg` to report, so that "unsafe" and "unreadable" stay separate
 * answers.
 */
export function parseSvg(source: string): Result<SvgDocument> {
  const all: SvgElement[] = [];
  const open: SvgElement[] = [];
  let root: SvgElement | null = null;
  let cursor = 0;

  const appendText = (raw: string): void => {
    const parent = open[open.length - 1];
    if (parent) parent.text += decodeEntities(raw);
  };
  const appendRaw = (raw: string): void => {
    const parent = open[open.length - 1];
    if (parent) parent.text += raw;
  };
  const outsideRoot = (raw: string, at: number): Result<SvgDocument> | null =>
    raw.trim() === '' ? null : syntaxError(source, at, 'Text appears outside the root element');

  while (cursor < source.length) {
    const lt = source.indexOf('<', cursor);

    if (lt === -1) {
      const tail = source.slice(cursor);
      if (open.length === 0) {
        const problem = outsideRoot(tail, cursor);
        if (problem) return problem;
      } else {
        appendText(tail);
      }
      break;
    }

    if (lt > cursor) {
      const chunk = source.slice(cursor, lt);
      if (open.length === 0) {
        const problem = outsideRoot(chunk, cursor);
        if (problem) return problem;
      } else {
        appendText(chunk);
      }
      cursor = lt;
    }

    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2);
      if (end === -1) return syntaxError(source, lt, 'A processing instruction is never closed');
      cursor = end + 2;
      continue;
    }

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      if (end === -1) return syntaxError(source, lt, 'A comment is never closed');
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      if (end === -1) return syntaxError(source, lt, 'A CDATA section is never closed');
      const raw = source.slice(lt + 9, end);
      if (open.length === 0) {
        const problem = outsideRoot(raw, lt);
        if (problem) return problem;
      } else {
        // CDATA is literal by definition, so no entity decoding here.
        appendRaw(raw);
      }
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<!', lt)) {
      const head = source.slice(lt, Math.min(lt + 16, source.length)).toUpperCase();
      if (/^<!\s*(DOCTYPE|ENTITY)\b/.test(head)) {
        return fail(
          'invalid-argument',
          `A DOCTYPE or ENTITY declaration at ${positionOf(source, lt)} is refused rather than resolved. An authored drawing has no use for one, and honouring it is what makes entity expansion possible.`,
        );
      }
      return syntaxError(source, lt, 'Unrecognised markup declaration');
    }

    if (source.startsWith('</', lt)) {
      const closed = readEndTag(source, lt);
      if (!closed.ok) return closed;
      const parent = open[open.length - 1];
      if (!parent) {
        return syntaxError(source, lt, `The </${closed.value.name}> tag closes nothing`);
      }
      if (localName(closed.value.name) !== parent.tag) {
        return syntaxError(source, lt, `The </${closed.value.name}> tag does not match the open <${parent.tag}>`);
      }
      open.pop();
      cursor = closed.value.end;
      continue;
    }

    const tag = readStartTag(source, lt);
    if (!tag.ok) return tag;
    const name = localName(tag.value.name);

    if (open.length === 0) {
      if (root !== null) {
        return syntaxError(source, lt, 'A second root element');
      }
      if (name !== 'svg') {
        return fail(
          'invalid-argument',
          `The root element is <${name}>, not <svg> (${positionOf(source, lt)}).`,
        );
      }
    } else if (open.length >= MAX_DEPTH) {
      return fail(
        'invalid-argument',
        `The document nests more than ${MAX_DEPTH} elements deep at ${positionOf(source, lt)}.`,
      );
    }

    const element: SvgElement = {
      id: null,
      tag: name,
      attributes: tag.value.attributes,
      text: '',
      children: [],
      index: all.length,
    };
    const declaredId = attributeOf(element, 'id');
    if (declaredId !== null && declaredId !== '') element.id = declaredId;

    all.push(element);
    const parent = open[open.length - 1];
    if (parent) parent.children.push(element);
    else root = element;

    if (!tag.value.selfClosing) open.push(element);
    cursor = tag.value.end;
  }

  if (open.length > 0) {
    const unclosed = open[open.length - 1];
    return fail(
      'invalid-argument',
      unclosed
        ? `The <${unclosed.tag}> element is never closed.`
        : 'The document is malformed.',
    );
  }
  if (root === null) {
    return fail('invalid-argument', 'The document has no root element.');
  }

  // Trimmed once, here, rather than as each run of characters arrives. A run's
  // trailing space may be interior to the element once the run after it has
  // been appended — `a  b` is two spaces in the middle and none at the ends —
  // so the only place the ends can be identified is when the element is whole.
  for (const element of all) element.text = element.text.trim();

  const { viewBox } = deriveViewBox(root);
  return ok({
    width: declaredLength(root, 'width'),
    height: declaredLength(root, 'height'),
    viewBox,
    root,
    all,
  });
}

/** A declared `width`/`height` on the root, through `parseLength` as contracted. */
function declaredLength(root: SvgElement, name: string): number | null {
  const value = attributeOf(root, name);
  if (value === null) return null;
  return parseLength(value)?.value ?? null;
}

interface ViewBoxDerivation {
  viewBox: [number, number, number, number];
  /**
   * True when neither the attribute nor a usable width/height pair was there,
   * which is what `validateSvg` reports as `missing-viewbox`. Kept here beside
   * the decision that produces it so the two can never drift apart.
   */
  synthesised: boolean;
}

function deriveViewBox(root: SvgElement): ViewBoxDerivation {
  const declared = attributeOf(root, 'viewBox');
  if (declared !== null) {
    const numbers = parseNumberList(declared);
    if (numbers && numbers.length === 4) {
      return {
        viewBox: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 0],
        synthesised: false,
      };
    }
  }

  const width = declaredLength(root, 'width');
  const height = declaredLength(root, 'height');
  if (width !== null && height !== null) {
    return { viewBox: [0, 0, width, height], synthesised: false };
  }

  // One dimension declared and the other not is still a substitution: the
  // missing side takes the SVG default, and the drawing is laid out against a
  // canvas its author only half described.
  return {
    viewBox: [0, 0, width ?? DEFAULT_VIEWBOX[2], height ?? DEFAULT_VIEWBOX[3]],
    synthesised: true,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Severity order, most serious first. A caller that wants only the headline
 * takes the first issue; nothing here depends on how many were found.
 *
 * `not-xml` and `not-svg` are absent on purpose: those are parse failures that
 * arrive as a `Result` failure, not as issues on a document that parsed.
 */
const ISSUE_SEVERITY: SvgIssue['code'][] = [
  'script-element',
  'event-handler',
  'javascript-url',
  'foreign-element',
  'external-reference',
  'duplicate-id',
  'unresolved-reference',
  'missing-viewbox',
  'degenerate-viewbox',
];

/**
 * The subset that makes a document unsafe to hand to a renderer. Everything
 * outside it is cosmetic: a `url(#missing)` paint is a broken gradient, not an
 * escape, and treating it as a security finding would train a caller to ignore
 * this list.
 */
const UNSAFE_CODES: ReadonlySet<SvgIssue['code']> = new Set<SvgIssue['code']>([
  'script-element',
  'event-handler',
  'javascript-url',
  'foreign-element',
  'external-reference',
]);

/** Elements that are not part of a drawing, or that pull in another document. */
const FOREIGN_TAGS: ReadonlySet<string> = new Set([
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'canvas',
]);

const URL_REFERENCE_PATTERN = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/gi;

/** Lower-cased with every control and space character removed. */
function schemeSafe(value: string): string {
  let out = '';
  const lower = value.toLowerCase();
  for (const ch of lower) {
    if (ch > ' ') out += ch;
  }
  return out;
}

function hrefOf(el: SvgElement): string | null {
  const direct = attributeOf(el, 'href');
  if (direct !== null) return direct;
  return attributeOf(el, 'xlink:href');
}

function isFragment(value: string): boolean {
  return value.trim().startsWith('#');
}

/**
 * Reports what is wrong with a parsed document, most serious first.
 *
 * The document is expected to have come from `parseSvg`; an element list is
 * taken as given rather than re-validated, because a second parser here would
 * be a second set of bugs.
 */
export function validateSvg(doc: SvgDocument): SvgIssue[] {
  const found = new Map<SvgIssue['code'], SvgIssue[]>();
  const add = (code: SvgIssue['code'], message: string, elementIndex: number | null): void => {
    const bucket = found.get(code);
    if (bucket) bucket.push({ code, message, elementIndex });
    else found.set(code, [{ code, message, elementIndex }]);
  };

  // Ids first: a forward reference (`fill="url(#x)"` before `#x` is declared) is
  // legal, so the whole set has to be known before any reference is judged.
  const idFirstSeen = new Map<string, number>();
  for (const el of doc.all) {
    const id = attributeOf(el, 'id');
    if (id === null || id === '') continue;
    const first = idFirstSeen.get(id);
    if (first === undefined) {
      idFirstSeen.set(id, el.index);
      continue;
    }
    add(
      'duplicate-id',
      `id="${id}" is used by element ${first} and again by element ${el.index}; a "#${id}" reference to it is ambiguous.`,
      el.index,
    );
  }

  for (const el of doc.all) {
    if (el.tag === 'script') {
      add('script-element', `A <script> element at index ${el.index}.`, el.index);
    }
    if (FOREIGN_TAGS.has(el.tag)) {
      add(
        'foreign-element',
        `<${el.tag}> at index ${el.index} is not drawing content and is not rendered by the rasteriser.`,
        el.index,
      );
    }
    if (el.tag === 'animate' || el.tag === 'set') {
      const target = attributeOf(el, 'attributeName')?.trim().toLowerCase() ?? '';
      if (target === 'href' || target.startsWith('on')) {
        add(
          'foreign-element',
          `<${el.tag}> at index ${el.index} animates "${target}", which a static render cannot be asked to honour.`,
          el.index,
        );
      }
    }
    const useHref = el.tag === 'use' ? hrefOf(el) : null;
    if (useHref !== null && !isFragment(useHref)) {
      add(
        'foreign-element',
        `<use> at index ${el.index} points at another document rather than a fragment of this one.`,
        el.index,
      );
    }

    for (const [name, value] of lowerAttributes(el)) {
      if (name.startsWith('on')) {
        add(
          'event-handler',
          `The attribute "${name}" on element ${el.index} is an event handler; there is no script in a rendered raster, so it is either inert or an escape attempt.`,
          el.index,
        );
      }
      if (schemeSafe(value).startsWith('javascript:')) {
        add(
          'javascript-url',
          `The value of "${name}" on element ${el.index} is a javascript: URL.`,
          el.index,
        );
      }
      if (name === 'href' || name === 'xlink:href') {
        const trimmed = value.trim();
        if (trimmed !== '' && !isFragment(trimmed)) {
          add(
            'external-reference',
            `"${name}" on element ${el.index} refers to "${trimmed}", which is outside this document and cannot be fetched by a rasteriser.`,
            el.index,
          );
        }
      }

      // Every attribute, not only `clip-path`, `mask`, `filter`, `fill` and
      // `stroke`, which are the five that carry a `url(#id)` in practice. The
      // syntax is unambiguous and a substring scan is free, so scanning the
      // others as well costs nothing and catches the same reference written in
      // a `style` attribute, where it also paints and also breaks unresolved.
      if (!value.includes('url(')) continue;
      for (const match of value.matchAll(URL_REFERENCE_PATTERN)) {
        const id = match[1];
        if (!id) continue;
        if (!idFirstSeen.has(id)) {
          add(
            'unresolved-reference',
            `"${name}" on element ${el.index} refers to #${id}, which no element in the document declares.`,
            el.index,
          );
        }
      }
    }

    const href = hrefOf(el);
    if (href !== null && isFragment(href)) {
      const id = href.trim().slice(1);
      if (id !== '' && !idFirstSeen.has(id)) {
        add(
          'unresolved-reference',
          `The reference to #${id} on element ${el.index} matches no id in the document.`,
          el.index,
        );
      }
    }
  }

  const derivation = deriveViewBox(doc.root);
  if (derivation.synthesised) {
    add(
      'missing-viewbox',
      `No viewBox was declared and neither width nor height was usable, so a ${doc.viewBox[2]}x${doc.viewBox[3]} canvas was assumed.`,
      doc.root.index,
    );
  }
  const [viewBoxWidth, viewBoxHeight] = [doc.viewBox[2], doc.viewBox[3]];
  if (!Number.isFinite(viewBoxWidth) || !Number.isFinite(viewBoxHeight) || viewBoxWidth <= 0 || viewBoxHeight <= 0) {
    // Reachable only through the viewBox attribute: `parseLength` and
    // `parseNumberList` both refuse a non-finite number, so a viewBox
    // synthesised from width and height can never be degenerate.
    add(
      'degenerate-viewbox',
      `The viewBox is ${doc.viewBox[0]} ${doc.viewBox[1]} ${viewBoxWidth} ${viewBoxHeight}, which describes a canvas with no area and leaves nothing to draw on.`,
      doc.root.index,
    );
  }

  const issues: SvgIssue[] = [];
  for (const code of ISSUE_SEVERITY) {
    const bucket = found.get(code);
    if (bucket) issues.push(...bucket);
  }
  return issues;
}

/**
 * Parses a document and answers whether it is safe to render — not whether it
 * is any good. A missing viewBox, an unresolved gradient, a duplicated id: all
 * of those are reported by `validateSvg` and none of them makes this fail, so
 * that a caller refusing a drawing is refusing an escape rather than a typo.
 */
export function isSafeSvg(source: string): Result<true> {
  const parsed = parseSvg(source);
  if (!parsed.ok) return parsed;

  const unsafe = validateSvg(parsed.value).filter((issue) => UNSAFE_CODES.has(issue.code));
  const first = unsafe[0];
  if (first) {
    return fail('invalid-argument', `The SVG is not safe to render: ${first.message}`);
  }
  return ok(true);
}

/* ------------------------------------------------------------------ */
/* Digest                                                              */
/* ------------------------------------------------------------------ */

const COLOR_ATTRIBUTES: readonly string[] = [
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
];

const TEXT_TAGS: ReadonlySet<string> = new Set(['text', 'tspan', 'title']);

const PATH_COMMAND_PATTERN = /[MmZzLlHhVvCcSsQqTtAa]/g;

/**
 * The SVG command letters in a `d` string.
 *
 * Deliberately a letter count rather than a parse: a criterion like "at most
 * forty commands" is about how much path an author wrote, and a document whose
 * `d` is subtly malformed should still show up as the size it is rather than as
 * zero commands.
 */
function countPathCommands(d: string): number {
  return (d.match(PATH_COMMAND_PATTERN) ?? []).length;
}

/** Tags that put ink on the canvas, and so contribute to `contentBounds`. */
const DRAWING_TAGS: ReadonlySet<string> = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
]);

/**
 * Everything the source says, counted and measured.
 *
 * `colors` and `colorCounts` answer different questions and are both kept.
 * `colors` is the palette after normalising, so "three colours" means three
 * distinct hues. `colorCounts` is keyed by the value as written, including the
 * ones that are not colours at all, so a criterion can be checked against what
 * the author actually typed — `url(#grad)` is visible rather than silently
 * missing, and a document that paints everything with `currentColor` cannot
 * pass a palette check by having produced an empty list.
 */
export function svgDigest(doc: SvgDocument): SvgDigest {
  // Null prototypes again: tag names and colour strings are both attacker-chosen
  // text, and a `__proto__` key on a plain object is dropped instead of counted.
  const counts: Record<string, number> = Object.create(null);
  const colorCounts: Record<string, number> = Object.create(null);
  const colors = new Set<string>();
  const ids: string[] = [];
  const text: string[] = [];
  let pathCount = 0;
  let pathCommandCount = 0;
  let contentBounds: Bounds2D | null = null;

  for (const el of doc.all) {
    counts[el.tag] = (counts[el.tag] ?? 0) + 1;
    if (el.id !== null) ids.push(el.id);

    for (const name of COLOR_ATTRIBUTES) {
      const value = attributeOf(el, name);
      if (value === null) continue;
      const written = value.trim().toLowerCase();
      if (written === '') continue;
      colorCounts[written] = (colorCounts[written] ?? 0) + 1;
      const normalised = normaliseColor(value);
      if (normalised !== null) colors.add(normalised);
    }

    if (TEXT_TAGS.has(el.tag) && el.text !== '') text.push(el.text);

    if (el.tag === 'path') {
      pathCount += 1;
      pathCommandCount += countPathCommands(attributeOf(el, 'd') ?? '');
    }

    if (DRAWING_TAGS.has(el.tag)) {
      const bounds = elementBounds2D(doc, el);
      if (bounds !== null) contentBounds = unionBounds2D(contentBounds, bounds);
    }
  }

  const ratio = doc.viewBox[3];
  return {
    width: doc.width,
    height: doc.height,
    viewBox: doc.viewBox,
    aspectRatio: Number.isFinite(ratio) && ratio !== 0 ? doc.viewBox[2] / ratio : null,
    counts,
    ids,
    colors: [...colors],
    colorCounts,
    text,
    pathCount,
    pathCommandCount,
    contentBounds,
  };
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/** A 2D affine transform: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. */
interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `m` then `n`, so a list composes left to right as SVG applies it. */
function composeAffine(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function applyAffine(m: Affine, x: number, y: number): Vec2 {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

const DEGREES_TO_RADIANS = Math.PI / 180;

function translation(tx: number, ty: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

function scaling(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

function rotation(degrees: number, cx = 0, cy = 0): Affine {
  const radians = degrees * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const spin: Affine = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  if (cx === 0 && cy === 0) return spin;
  return composeAffine(composeAffine(translation(cx, cy), spin), translation(-cx, -cy));
}

/**
 * Parses a `transform` attribute into one matrix, or the identity.
 *
 * A `transform-origin` is not honoured, and cannot be: it is a CSS property
 * that this module has no cascade to resolve, so rotation is always about the
 * user-space origin — the property's own default, `0 0`.
 *
 * An unparseable list returns the identity for the *whole* attribute rather
 * than for the part that failed. That is not laziness: a browser drops an
 * invalid transform list entirely, so a partially-applied matrix here would put
 * the bounds somewhere the renderer never drew anything. Matching the renderer
 * is the entire point of measuring the source in the first place.
 */
function parseTransform(value: string | null): Affine {
  if (value === null || value.trim() === '') return IDENTITY;

  let cursor = 0;
  let matrix = IDENTITY;

  while (cursor < value.length) {
    while (cursor < value.length && (isSpace(value[cursor]) || value[cursor] === ',')) cursor++;
    if (cursor >= value.length) break;

    const nameStart = cursor;
    while (isNameChar(value[cursor])) cursor++;
    const name = value.slice(nameStart, cursor).toLowerCase();
    while (cursor < value.length && isSpace(value[cursor])) cursor++;
    if (name === '' || value[cursor] !== '(') return IDENTITY;
    cursor++;

    const argumentStart = cursor;
    while (cursor < value.length && value[cursor] !== ')') cursor++;
    if (cursor >= value.length) return IDENTITY;
    const args = parseNumberList(value.slice(argumentStart, cursor));
    cursor++;
    if (!args) return IDENTITY;

    const applied = transformFunction(name, args);
    if (applied === null) return IDENTITY;
    matrix = composeAffine(matrix, applied);
  }

  return matrix;
}

function transformFunction(name: string, args: number[]): Affine | null {
  const first = args[0];
  switch (name) {
    case 'translate': {
      if (first === undefined) return null;
      return translation(first, args[1] ?? 0);
    }
    case 'scale': {
      if (first === undefined) return null;
      return scaling(first, args[1] ?? first);
    }
    case 'rotate': {
      if (first === undefined) return null;
      return rotation(first, args[1] ?? 0, args[2] ?? 0);
    }
    case 'matrix': {
      const [a, b, c, d, e, f] = args;
      if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined || f === undefined) {
        return null;
      }
      return { a, b, c, d, e, f };
    }
    case 'skewx': {
      if (first === undefined) return null;
      return { a: 1, b: 0, c: Math.tan(first * DEGREES_TO_RADIANS), d: 1, e: 0, f: 0 };
    }
    case 'skewy': {
      if (first === undefined) return null;
      return { a: 1, b: Math.tan(first * DEGREES_TO_RADIANS), c: 0, d: 1, e: 0, f: 0 };
    }
    default:
      return null;
  }
}

function transformBounds(m: Affine, box: Bounds2D): Bounds2D | null {
  // The four corners, not a tighter fit: exact under translation and scale, and
  // a superset under rotation and skew, which is the direction an approximation
  // is allowed to be wrong in.
  const corners: Vec2[] = [
    applyAffine(m, box.min[0], box.min[1]),
    applyAffine(m, box.max[0], box.min[1]),
    applyAffine(m, box.max[0], box.max[1]),
    applyAffine(m, box.min[0], box.max[1]),
  ];
  for (const corner of corners) {
    if (!Number.isFinite(corner[0]) || !Number.isFinite(corner[1])) return null;
  }
  return boundsFromPoints2D(corners);
}

/**
 * Every control point a `d` string names, in user units.
 *
 * The argument counts per command letter, with `null` for the ones that take
 * none. A command whose arguments run out ends the scan rather than throwing:
 * a malformed `d` already renders as whatever the browser could make of it, and
 * the digest still has to say something about the element.
 */
const PATH_ARGUMENT_COUNTS: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

function isPathCommandLetter(ch: string | undefined): ch is string {
  return ch !== undefined && PATH_ARGUMENT_COUNTS[ch.toUpperCase()] !== undefined;
}

/**
 * The control point `S`, `s`, `T` and `t` imply rather than state: the previous
 * one mirrored through the current point. A command that does not follow the
 * matching curve has no previous control point, and the spec says the reflected
 * one then coincides with the current point.
 *
 * Return type annotated on purpose. The reflected value is assigned back into
 * the variable it reflects from, and an inferred return type would make the
 * checker chase its own tail through that assignment.
 */
function reflectedControl(previous: Vec2 | null, current: number, axis: 0 | 1): number {
  return previous ? 2 * current - previous[axis] : current;
}

function pathControlPoints(d: string): Vec2[] {
  const points: Vec2[] = [];
  let cursor = 0;
  let command = '';
  let x = 0;
  let y = 0;
  let subpathX = 0;
  let subpathY = 0;
  let lastCubic: Vec2 | null = null;
  let lastQuad: Vec2 | null = null;

  const skipSeparators = (): void => {
    while (cursor < d.length) {
      const ch = d[cursor];
      if (ch === ',' || isSpace(ch)) cursor++;
      else break;
    }
  };

  const readNumber = (): number | null => {
    skipSeparators();
    const start = cursor;
    if (d[cursor] === '+' || d[cursor] === '-') cursor++;
    let digits = 0;
    while (isDigit(d[cursor])) {
      cursor++;
      digits++;
    }
    if (d[cursor] === '.') {
      cursor++;
      while (isDigit(d[cursor])) {
        cursor++;
        digits++;
      }
    }
    if (digits === 0) {
      cursor = start;
      return null;
    }
    if (d[cursor] === 'e' || d[cursor] === 'E') {
      const exponentStart = cursor;
      cursor++;
      if (d[cursor] === '+' || d[cursor] === '-') cursor++;
      let exponentDigits = 0;
      while (isDigit(d[cursor])) {
        cursor++;
        exponentDigits++;
      }
      if (exponentDigits === 0) cursor = exponentStart;
    }
    const value = Number.parseFloat(d.slice(start, cursor));
    return Number.isFinite(value) ? value : null;
  };

  while (cursor < d.length) {
    skipSeparators();
    if (cursor >= d.length) break;
    const ch = d[cursor];
    if (isPathCommandLetter(ch)) {
      command = ch;
      cursor++;
    } else if (command === 'M') {
      command = 'L';
    } else if (command === 'm') {
      command = 'l';
    } else if (command === '' || command === 'Z' || command === 'z') {
      // Junk where a command should be. Consume it rather than spinning on it.
      cursor++;
      continue;
    }

    const upper = command.toUpperCase();
    const relative = command !== upper;
    const wanted = PATH_ARGUMENT_COUNTS[upper] ?? 0;
    const args: number[] = [];
    let truncated = false;
    for (let i = 0; i < wanted; i++) {
      const value = readNumber();
      if (value === null) {
        truncated = true;
        break;
      }
      args.push(value);
    }
    if (truncated) break;

    const dx = (index: number): number => (relative ? x + (args[index] ?? 0) : args[index] ?? 0);
    const dy = (index: number): number => (relative ? y + (args[index] ?? 0) : args[index] ?? 0);

    switch (upper) {
      case 'M': {
        x = dx(0);
        y = dy(1);
        subpathX = x;
        subpathY = y;
        points.push([x, y]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'L': {
        x = dx(0);
        y = dy(1);
        points.push([x, y]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'H': {
        x = relative ? x + (args[0] ?? 0) : args[0] ?? 0;
        points.push([x, y]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'V': {
        y = relative ? y + (args[0] ?? 0) : args[0] ?? 0;
        points.push([x, y]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'C': {
        const x1 = dx(0);
        const y1 = dy(1);
        const x2 = dx(2);
        const y2 = dy(3);
        const ex = dx(4);
        const ey = dy(5);
        points.push([x1, y1], [x2, y2], [ex, ey]);
        lastCubic = [x2, y2];
        lastQuad = null;
        x = ex;
        y = ey;
        break;
      }
      case 'S': {
        const x1 = reflectedControl(lastCubic, x, 0);
        const y1 = reflectedControl(lastCubic, y, 1);
        const x2 = dx(0);
        const y2 = dy(1);
        const ex = dx(2);
        const ey = dy(3);
        points.push([x1, y1], [x2, y2], [ex, ey]);
        lastCubic = [x2, y2];
        lastQuad = null;
        x = ex;
        y = ey;
        break;
      }
      case 'Q': {
        const x1 = dx(0);
        const y1 = dy(1);
        const ex = dx(2);
        const ey = dy(3);
        points.push([x1, y1], [ex, ey]);
        lastQuad = [x1, y1];
        lastCubic = null;
        x = ex;
        y = ey;
        break;
      }
      case 'T': {
        const x1 = reflectedControl(lastQuad, x, 0);
        const y1 = reflectedControl(lastQuad, y, 1);
        const ex = dx(0);
        const ey = dy(1);
        points.push([x1, y1], [ex, ey]);
        lastQuad = [x1, y1];
        lastCubic = null;
        x = ex;
        y = ey;
        break;
      }
      case 'A': {
        // The two endpoints only. The bow of the arc is not computed: an ellipse
        // extent needs the centre parameterisation, and getting it half right
        // would be worse than not having it — a bowed arc stays inside the box
        // its endpoints and radii imply only sometimes, and the harness uses
        // these bounds to decide whether one part sits above another.
        const ex = dx(5);
        const ey = dy(6);
        points.push([ex, ey]);
        lastCubic = null;
        lastQuad = null;
        x = ex;
        y = ey;
        break;
      }
      case 'Z': {
        x = subpathX;
        y = subpathY;
        lastCubic = null;
        lastQuad = null;
        break;
      }
      default:
        break;
    }
  }

  return points;
}

/**
 * Andrew's monotone chain hull.
 *
 * Only the axis-aligned box of the hull is used, and the box of a point set is
 * the box of its hull — so the hull does no work here that a min/max pass would
 * not. It is computed anyway because the approximation being made is "the curve
 * lives inside the hull of its control points", and stating that in code is
 * what makes the comment above it checkable rather than a claim.
 */
function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2];
      const b = lower[lower.length - 1];
      if (!a || !b || cross(a, b, point) > 0) break;
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    if (!point) continue;
    while (upper.length >= 2) {
      const a = upper[upper.length - 2];
      const b = upper[upper.length - 1];
      if (!a || !b || cross(a, b, point) > 0) break;
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Average advance per character, as a fraction of the font size. */
const MONOSPACE_ADVANCE = 0.6;
const DEFAULT_FONT_SIZE = 16;

function fontSizeOf(el: SvgElement, inherited: number): number {
  const declared = userLength(attributeOf(el, 'font-size'));
  return declared !== null && declared > 0 ? declared : inherited;
}

function localShapeBox(el: SvgElement, fontSize: number): Bounds2D | null {
  switch (el.tag) {
    case 'rect': {
      const width = userLength(attributeOf(el, 'width'));
      const height = userLength(attributeOf(el, 'height'));
      if (width === null || height === null || width <= 0 || height <= 0) return null;
      const x = userCoordinate(attributeOf(el, 'x')) ?? 0;
      const y = userCoordinate(attributeOf(el, 'y')) ?? 0;
      return { min: [x, y], max: [x + width, y + height] };
    }
    case 'circle': {
      const r = userLength(attributeOf(el, 'r'));
      if (r === null || r <= 0) return null;
      const cx = userCoordinate(attributeOf(el, 'cx')) ?? 0;
      const cy = userCoordinate(attributeOf(el, 'cy')) ?? 0;
      return { min: [cx - r, cy - r], max: [cx + r, cy + r] };
    }
    case 'ellipse': {
      const rx = userLength(attributeOf(el, 'rx'));
      const ry = userLength(attributeOf(el, 'ry'));
      if (rx === null || ry === null || rx <= 0 || ry <= 0) return null;
      const cx = userCoordinate(attributeOf(el, 'cx')) ?? 0;
      const cy = userCoordinate(attributeOf(el, 'cy')) ?? 0;
      return { min: [cx - rx, cy - ry], max: [cx + rx, cy + ry] };
    }
    case 'line': {
      const x1 = userCoordinate(attributeOf(el, 'x1')) ?? 0;
      const y1 = userCoordinate(attributeOf(el, 'y1')) ?? 0;
      const x2 = userCoordinate(attributeOf(el, 'x2')) ?? 0;
      const y2 = userCoordinate(attributeOf(el, 'y2')) ?? 0;
      return { min: [Math.min(x1, x2), Math.min(y1, y2)], max: [Math.max(x1, x2), Math.max(y1, y2)] };
    }
    case 'polyline':
    case 'polygon': {
      const raw = attributeOf(el, 'points');
      if (raw === null) return null;
      const numbers = parseNumberList(raw);
      if (!numbers) return null;
      const pairs: Vec2[] = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        pairs.push([numbers[i] ?? 0, numbers[i + 1] ?? 0]);
      }
      if (pairs.length === 0) return null;
      return boundsFromPoints2D(pairs);
    }
    case 'path': {
      const d = attributeOf(el, 'd');
      if (d === null) return null;
      const points = pathControlPoints(d);
      if (points.length === 0) return null;
      return boundsFromPoints2D(convexHull(points));
    }
    case 'text': {
      const content = subtreeText(el);
      if (content === '') return null;
      const x = userCoordinate(attributeOf(el, 'x')) ?? 0;
      const y = userCoordinate(attributeOf(el, 'y')) ?? 0;
      // An estimate, and a coarse one: 0.6 of the font size per character is a
      // monospaced average, so a `text` in a proportional face is measured
      // wider than it draws for narrow letters and narrower for wide ones. The
      // exact width needs font metrics this runtime does not have, and the
      // bounds are used to answer "is this label inside the panel", where being
      // a character or two out changes nothing. `dominant-baseline` is ignored
      // and y is taken as the baseline, so the box runs from y - font-size to y;
      // a text anchored at `middle` or `end` is therefore offset horizontally
      // by up to half or all of its width.
      const width = MONOSPACE_ADVANCE * fontSize * content.length;
      return { min: [x, y - fontSize], max: [x + width, y] };
    }
    default:
      return null;
  }
}

interface Located {
  found: boolean;
  transform: Affine;
  fontSize: number;
}

function locate(
  node: SvgElement,
  target: number,
  inherited: Affine,
  inheritedFontSize: number,
  out: Located,
): void {
  if (out.found) return;
  const transform = composeAffine(inherited, parseTransform(attributeOf(node, 'transform')));
  const fontSize = fontSizeOf(node, inheritedFontSize);
  if (node.index === target) {
    out.found = true;
    out.transform = transform;
    out.fontSize = fontSize;
    return;
  }
  for (const child of node.children) {
    locate(child, target, transform, fontSize, out);
    if (out.found) return;
  }
}

/**
 * A conservative box for one element, in user units, after its own `transform`
 * and those of its ancestors.
 *
 * Nothing here is a claim about pixels. The box is what the harness needs to
 * answer "is the shade above the post", and every approximation in it — the
 * hull for a curve, an average advance for text, the four corners for a
 * rotated box — errs towards a box that is too large. A criterion checked
 * against these bounds can therefore pass when a strict reading would fail, and
 * cannot fail when a strict reading would pass. That asymmetry is the point:
 * the harness exists to catch drawings that are wrong, not to fail drawings it
 * merely measured badly.
 *
 * An element that draws nothing returns null. So does one whose box is not
 * finite. A zero-area box is returned rather than null — a `line`, or a path
 * that only moves — because "a point here" and "nothing here" are different
 * facts, and only the second is null.
 *
 * Element identity is the `index` from `SvgDocument.all`; an element that is
 * not in that document's tree is measured with its own transform alone, since
 * there is no ancestor chain for it to inherit.
 */
export function elementBounds2D(doc: SvgDocument, el: SvgElement): Bounds2D | null {
  const located: Located = { found: false, transform: IDENTITY, fontSize: DEFAULT_FONT_SIZE };
  locate(doc.root, el.index, IDENTITY, DEFAULT_FONT_SIZE, located);

  const transform = located.found ? located.transform : parseTransform(attributeOf(el, 'transform'));
  const fontSize = located.found ? located.fontSize : fontSizeOf(el, DEFAULT_FONT_SIZE);

  const local = localShapeBox(el, fontSize);
  if (local === null) return null;
  return transformBounds(transform, local);
}

/* ------------------------------------------------------------------ */
/* Rasterisation wrapper                                               */
/* ------------------------------------------------------------------ */

/** A guard against a nonsense size, not a policy: a plausible size is honoured. */
const MIN_VIEWPORT = 1;
const MAX_VIEWPORT = 8192;

function viewportSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_VIEWPORT;
  return clamp(Math.round(value), MIN_VIEWPORT, MAX_VIEWPORT);
}

function escapeForPre(source: string): string {
  return source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The page handed to Cloudflare Browser Rendering to rasterise an authored SVG.
 *
 * The wrapper contributes no paint of its own. Its background is transparent
 * and its margin is zero so that everything visible in the capture came from
 * the artifact, and the root `svg` is pinned to the viewport so that what is
 * measured on the raster lines up with the width and height the caller said it
 * wanted. Pinning is done with CSS rather than by rewriting the source, because
 * the source is the artifact: an author's own `width` attribute is a
 * presentation attribute and loses to a stylesheet, so nothing is edited and
 * the source still means whatever its author wrote. Only the outermost `svg` is
 * pinned; a nested one keeps its own size, which is how nested coordinate
 * systems are usually expressed.
 *
 * The source is embedded verbatim, and nothing in it is escaped or repaired.
 * Whether an SVG is safe to render is settled by `validateSvg` before this is
 * called, and duplicating that judgement here would be a second answer that
 * could disagree with the first. The one thing this function does defend
 * against is the source escaping its container: a `</body` or `</html` in the
 * text would end the page early and let anything after it be parsed as markup
 * rather than as data. That is a real breakout even in a document that carries
 * no script, so instead of trying to keep the SVG in the page, the whole
 * document becomes a `<pre>` of the escaped source. A hostile artifact renders
 * as visible text, which is a legible failure, rather than a page that silently
 * does something other than draw.
 */
export function rasterWrapHtml(source: string, width: number, height: number): string {
  const w = viewportSize(width);
  const h = viewportSize(height);

  if (/<\/body|<\/html/i.test(source)) {
    return [
      '<!doctype html>',
      '<html><head><meta charset="utf-8"><style>',
      `html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:auto;background:#ffffff;color:#111111}`,
      'pre{margin:0;padding:12px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}',
      '</style></head><body><pre>',
      escapeForPre(source),
      '</pre></body></html>',
    ].join('');
  }

  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><style>',
    `html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}`,
    `body>svg{display:block;width:${w}px;height:${h}px;overflow:hidden}`,
    '</style></head><body>',
    source,
    '</body></html>',
  ].join('');
}
