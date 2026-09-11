import { describe, expect, it } from 'vitest';
import {
  elementBounds2D,
  isSafeSvg,
  parseSvg,
  rasterWrapHtml,
  svgDigest,
  validateSvg,
} from '@worker/design/svg';
import type { SvgDocument, SvgElement } from '@worker/design/types';

/**
 * The vector surface is the half of the design harness that can be settled by
 * arithmetic, and these are the arithmetic's own tests: parse the source, count
 * what it says, measure where the parts are.
 *
 * The assertions that matter most are the ones about refusal. A parser that
 * accepts everything is easy to write and useless as a gate, so the malformed
 * and dangerous cases are tested as hard as the working ones — a `DOCTYPE`, a
 * `javascript:` URL, an `onload` attribute — and the cosmetic cases are tested
 * for the opposite property: a broken gradient reference must not make a
 * document count as unsafe, or the gate would be one callers learn to bypass.
 */

const WELL_FORMED = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <!-- a panel and two dots -->
  <title>Two dots</title>
  <rect id="panel" x="10" y="20" width="100" height="50" fill="#ff0000"/>
  <circle id="dot-a" cx="50" cy="100" r="10" fill="red"/>
  <circle id="dot-b" cx="120" cy="100" r="10" fill="#0f0" stroke="blue"/>
  <text id="caption" x="10" y="200" font-size="20">Hello</text>
</svg>`;

function mustParse(source: string): SvgDocument {
  const parsed = parseSvg(source);
  if (!parsed.ok) throw new Error(`expected this to parse: ${parsed.message}`);
  return parsed.value;
}

function elementById(doc: SvgDocument, id: string): SvgElement {
  const found = doc.all.find((el) => el.id === id);
  if (!found) throw new Error(`no element carries id="${id}"`);
  return found;
}

function boundsOf(doc: SvgDocument, id: string) {
  return elementBounds2D(doc, elementById(doc, id));
}

function issueCodes(source: string): string[] {
  return validateSvg(mustParse(source)).map((issue) => issue.code);
}

describe('parseSvg', () => {
  it('reads a well-formed document', () => {
    const doc = mustParse(WELL_FORMED);

    expect(doc.width).toBe(400);
    expect(doc.height).toBe(300);
    expect(doc.viewBox).toEqual([0, 0, 400, 300]);
    expect(doc.root.tag).toBe('svg');
    expect(doc.root.index).toBe(0);
    expect(doc.all.length).toBe(6);

    // Document order, root first: the index is the handle a finding points at.
    expect(doc.all.map((el) => el.tag)).toEqual(['svg', 'title', 'rect', 'circle', 'circle', 'text']);
    expect(doc.all[1]?.tag).toBe('title');

    // A spread, because `counts` is built on a null prototype so that a tag
    // named `__proto__` cannot be silently dropped from it.
    expect({ ...svgDigest(doc).counts }).toEqual({
      svg: 1,
      title: 1,
      rect: 1,
      circle: 2,
      text: 1,
    });
    expect(svgDigest(doc).ids).toEqual(['panel', 'dot-a', 'dot-b', 'caption']);
    expect(svgDigest(doc).text).toEqual(['Two dots', 'Hello']);
    expect(validateSvg(doc)).toEqual([]);
  });

  it('strips namespace prefixes and ignores xmlns declarations', () => {
    const doc = mustParse('<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><svg:circle id="c" r="2"/></svg:svg>');
    expect(doc.root.tag).toBe('svg');
    expect(doc.all[1]?.tag).toBe('circle');
    expect(validateSvg(doc)).toEqual([]);
  });

  it('keeps direct text only, and preserves interior whitespace', () => {
    const doc = mustParse('<svg viewBox="0 0 4 4"><text id="t">  a  b  <tspan>c</tspan> </text></svg>');
    expect(elementById(doc, 't').text).toBe('a  b');
    expect(doc.all.find((el) => el.tag === 'tspan')?.text).toBe('c');
  });

  it('decodes numeric entities and leaves CDATA literal', () => {
    const doc = mustParse(
      '<svg viewBox="0 0 4 4"><text id="t">A&#66;&#x43;&amp;&lt;&gt;&quot;&apos;</text><desc id="d"><![CDATA[<not> & <markup>]]></desc></svg>',
    );
    // Decimal 66 is B and hex 43 is C, so this reads `A`, `B`, `C` only if both
    // numeric forms were decoded.
    expect(elementById(doc, 't').text).toBe('ABC&<>"\'');
    expect(elementById(doc, 'd').text).toBe('<not> & <markup>');
  });

  it('refuses a DOCTYPE and an ENTITY rather than resolving either', () => {
    const doctype = parseSvg(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol">]><svg viewBox="0 0 4 4"><rect width="1" height="1"/></svg>',
    );
    expect(doctype.ok).toBe(false);
    expect(doctype.ok ? '' : doctype.message).toContain('DOCTYPE');

    const entity = parseSvg('<svg viewBox="0 0 4 4"><!ENTITY xxe SYSTEM "file:///etc/passwd"></svg>');
    expect(entity.ok).toBe(false);

    // A refusal is an argument problem, not an upstream one: nothing was called.
    expect(doctype.ok ? 'ok' : doctype.kind).toBe('invalid-argument');
  });

  it('refuses malformed XML and a non-svg root', () => {
    const unclosed = parseSvg('<svg viewBox="0 0 4 4"><rect width="1" height="1"></svg>');
    expect(unclosed.ok).toBe(false);
    expect(unclosed.ok ? '' : unclosed.message).toContain('line 1');

    expect(parseSvg('<html><body/></html>').ok).toBe(false);
    expect(parseSvg('').ok).toBe(false);
    expect(parseSvg('<svg viewBox="0 0 4 4"/>').ok).toBe(true);
  });

  it('derives the viewBox, or reports that it had to guess', () => {
    const declared = mustParse('<svg viewBox="1 2 30 40"><rect width="1" height="1"/></svg>');
    expect(declared.viewBox).toEqual([1, 2, 30, 40]);
    expect(issueCodes('<svg viewBox="1 2 30 40"><rect width="1" height="1"/></svg>')).toEqual([]);

    const fromSize = mustParse('<svg width="80" height="60"><rect width="1" height="1"/></svg>');
    expect(fromSize.viewBox).toEqual([0, 0, 80, 60]);

    // Nothing declared at all: the SVG default, and said out loud.
    const nothing = mustParse('<svg><rect width="1" height="1"/></svg>');
    expect(nothing.viewBox).toEqual([0, 0, 300, 150]);
    expect(issueCodes('<svg><rect width="1" height="1"/></svg>')).toContain('missing-viewbox');
    expect(nothing.width).toBeNull();

    // A percentage needs a viewport to resolve, so it is not a declared size.
    expect(mustParse('<svg width="50%" height="50%"><rect width="1" height="1"/></svg>').width).toBeNull();
  });
});

describe('validateSvg', () => {
  it('reports each unsafe construct', () => {
    const script = '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>';
    expect(issueCodes(script)).toContain('script-element');

    const handler = '<svg viewBox="0 0 10 10" onLoad="alert(1)"><rect width="1" height="1" ONMOUSEOVER="x"/></svg>';
    expect(issueCodes(handler)).toContain('event-handler');

    const jsUrl = '<svg viewBox="0 0 10 10"><a href="  JaVaScRiPt:alert(1)"><rect width="1" height="1"/></a></svg>';
    expect(issueCodes(jsUrl)).toContain('javascript-url');

    const foreign = '<svg viewBox="0 0 10 10"><foreignObject width="10" height="10"><div>hi</div></foreignObject></svg>';
    expect(issueCodes(foreign)).toContain('foreign-element');

    const external = '<svg viewBox="0 0 10 10"><image href="http://example.com/a.png" width="1" height="1"/></svg>';
    expect(issueCodes(external)).toContain('external-reference');

    // An external `<use>` is both: it is not drawing content, and it reaches
    // outside the document. Reporting one and not the other would hide why.
    const use = '<svg viewBox="0 0 10 10"><use xlink:href="https://example.com/x.svg#a"/></svg>';
    expect(issueCodes(use)).toContain('foreign-element');
    expect(issueCodes(use)).toContain('external-reference');

    // A same-document fragment is not an external reference.
    const fragment = '<svg viewBox="0 0 10 10"><use href="#a"/><rect id="a" width="1" height="1"/></svg>';
    expect(issueCodes(fragment)).not.toContain('external-reference');
  });

  it('reports a `data:` reference as external, since a rasteriser cannot fetch it', () => {
    expect(issueCodes('<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AA" width="1" height="1"/></svg>')).toContain(
      'external-reference',
    );
  });

  it('separates unsafe from merely wrong', () => {
    expect(isSafeSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>').ok).toBe(false);
    expect(isSafeSvg('<svg viewBox="0 0 10 10" onload="x"><rect width="1" height="1"/></svg>').ok).toBe(false);
    expect(isSafeSvg('<svg viewBox="0 0 10 10"><a href="javascript:alert(1)"/></svg>').ok).toBe(false);
    expect(isSafeSvg('<svg viewBox="0 0 10 10"><foreignObject/></svg>').ok).toBe(false);
    expect(isSafeSvg('<svg viewBox="0 0 10 10"><image href="http://example.com/a.png"/></svg>').ok).toBe(false);

    // A document that parses but is not XML at all is still a failure.
    expect(isSafeSvg('not an svg').ok).toBe(false);

    // Cosmetic problems are not safety problems. A gate that refused these
    // would be one a caller works around instead of one a caller trusts.
    const dangling = '<svg viewBox="0 0 10 10"><rect width="9" height="9" fill="url(#missing)"/></svg>';
    expect(issueCodes(dangling)).toContain('unresolved-reference');
    expect(isSafeSvg(dangling).ok).toBe(true);

    expect(isSafeSvg('<svg><rect width="1" height="1"/></svg>').ok).toBe(true);
    expect(isSafeSvg(WELL_FORMED).ok).toBe(true);
  });

  it('reports a duplicated id and a reference to nothing', () => {
    expect(issueCodes('<svg viewBox="0 0 10 10"><a id="x"/><a id="x"/></svg>')).toContain('duplicate-id');
    expect(issueCodes('<svg viewBox="0 0 10 10"><a id="x"/><a id="y"/></svg>')).not.toContain('duplicate-id');

    expect(issueCodes('<svg viewBox="0 0 10 10"><rect width="1" height="1" fill="url(#gone)"/></svg>')).toContain(
      'unresolved-reference',
    );
    expect(
      issueCodes('<svg viewBox="0 0 10 10"><filter id="f"/><rect width="1" height="1" filter="url(#f)"/></svg>'),
    ).not.toContain('unresolved-reference');
  });

  it('reports a degenerate viewBox', () => {
    expect(issueCodes('<svg viewBox="0 0 0 10"><rect width="1" height="1"/></svg>')).toContain('degenerate-viewbox');
    expect(issueCodes('<svg viewBox="0 0 10 -5"><rect width="1" height="1"/></svg>')).toContain('degenerate-viewbox');
    expect(issueCodes('<svg viewBox="0 0 10 10"><rect width="1" height="1"/></svg>')).not.toContain('degenerate-viewbox');
  });

  it('puts the serious findings first', () => {
    const issues = validateSvg(
      mustParse('<svg onload="x" viewBox="0 0 4 4"><a id="x"/><a id="x"/></svg>'),
    );
    expect(issues[0]?.code).toBe('event-handler');
    expect(issues[issues.length - 1]?.code).toBe('duplicate-id');
  });
});

describe('elementBounds2D', () => {
  it('boxes the simple shapes by their own coordinates', () => {
    const doc = mustParse(`<svg viewBox="0 0 200 200">
      <rect id="r" x="10" y="20" width="30" height="40"/>
      <circle id="c" cx="50" cy="50" r="10"/>
      <ellipse id="e" cx="50" cy="50" rx="20" ry="5"/>
      <line id="l" x1="0" y1="0" x2="10" y2="20"/>
      <polygon id="p" points="0,0 10,0 10,10"/>
    </svg>`);

    expect(boundsOf(doc, 'r')?.min).toEqual([10, 20]);
    expect(boundsOf(doc, 'r')?.max).toEqual([40, 60]);
    expect(boundsOf(doc, 'c')?.min).toEqual([40, 40]);
    expect(boundsOf(doc, 'c')?.max).toEqual([60, 60]);
    expect(boundsOf(doc, 'e')?.min).toEqual([30, 45]);
    expect(boundsOf(doc, 'e')?.max).toEqual([70, 55]);
    // A line has no area, but it is somewhere: a zero-area box, not null.
    expect(boundsOf(doc, 'l')?.min).toEqual([0, 0]);
    expect(boundsOf(doc, 'l')?.max).toEqual([10, 20]);
    expect(boundsOf(doc, 'p')?.min).toEqual([0, 0]);
    expect(boundsOf(doc, 'p')?.max).toEqual([10, 10]);
  });

  it('returns null for an element that draws nothing', () => {
    const doc = mustParse('<svg viewBox="0 0 10 10"><g id="g"/><rect id="zero" width="0" height="10"/></svg>');
    expect(boundsOf(doc, 'g')).toBeNull();
    expect(boundsOf(doc, 'zero')).toBeNull();
  });

  it('boxes an absolute path by its points, and a relative path identically', () => {
    const absolute = mustParse('<svg viewBox="0 0 100 100"><path id="p" d="M10 10 L90 10 L90 90 L10 90 Z"/></svg>');
    expect(boundsOf(absolute, 'p')?.min).toEqual([10, 10]);
    expect(boundsOf(absolute, 'p')?.max).toEqual([90, 90]);

    const relative = mustParse('<svg viewBox="0 0 100 100"><path id="p" d="m10 10 l80 0 l0 80 l-80 0 z"/></svg>');
    expect(boundsOf(relative, 'p')?.min).toEqual([10, 10]);
    expect(boundsOf(relative, 'p')?.max).toEqual([90, 90]);
  });

  it('contains the endpoints of a curve, because the hull of the control points does', () => {
    const doc = mustParse('<svg viewBox="0 0 100 100"><path id="p" d="M0 0 C 0 100 100 100 100 0"/></svg>');
    const bounds = boundsOf(doc, 'p');
    expect(bounds?.min).toEqual([0, 0]);
    expect(bounds?.max).toEqual([100, 100]);
    // The curve itself stays in y >= 0; the hull is deliberately looser.
    const start: [number, number] = [0, 0];
    const end: [number, number] = [100, 0];
    for (const point of [start, end]) {
      expect(bounds?.min[0]).toBeLessThanOrEqual(point[0]);
      expect(bounds?.min[1]).toBeLessThanOrEqual(point[1]);
      expect(bounds?.max[0]).toBeGreaterThanOrEqual(point[0]);
      expect(bounds?.max[1]).toBeGreaterThanOrEqual(point[1]);
    }
  });

  it('walks every path command without leaving its argument box', () => {
    const doc = mustParse(
      '<svg viewBox="0 0 200 200"><path id="p" d="M0 0 H50 V50 S 60 60 70 70 T 90 90 A 5 5 0 0 1 100 100 z"/></svg>',
    );
    expect(boundsOf(doc, 'p')?.min).toEqual([0, 0]);
    expect(boundsOf(doc, 'p')?.max).toEqual([100, 100]);
  });

  it('applies a transform list left to right, as a renderer does', () => {
    // scale first, then translate: (0,0)-(10,10) becomes (10,20)-(30,40).
    const doc = mustParse(
      '<svg viewBox="0 0 100 100"><rect id="r" x="0" y="0" width="10" height="10" transform="translate(10,20) scale(2)"/></svg>',
    );
    expect(boundsOf(doc, 'r')?.min).toEqual([10, 20]);
    expect(boundsOf(doc, 'r')?.max).toEqual([30, 40]);
  });

  it('composes an ancestor transform with the element’s own', () => {
    const doc = mustParse(
      '<svg viewBox="0 0 200 200"><g transform="translate(100,0)"><g transform="scale(3)"><rect id="r" x="1" y="1" width="2" height="2" transform="translate(5,5)"/></g></g></svg>',
    );
    // (1,1)-(3,3), shifted by 5, scaled by 3, then shifted by 100.
    expect(boundsOf(doc, 'r')?.min).toEqual([118, 18]);
    expect(boundsOf(doc, 'r')?.max).toEqual([124, 24]);
  });

  it('boxes a rotated element conservatively', () => {
    const doc = mustParse('<svg viewBox="0 0 100 100"><rect id="r" width="10" height="20" transform="rotate(90)"/></svg>');
    // (x, y) -> (-y, x), so the 10x20 box becomes 20 wide and 10 tall.
    // Approximate, because the rotation is built from cos and sin.
    expect(boundsOf(doc, 'r')?.min[0]).toBeCloseTo(-20, 6);
    expect(boundsOf(doc, 'r')?.min[1]).toBeCloseTo(0, 6);
    expect(boundsOf(doc, 'r')?.max[0]).toBeCloseTo(0, 6);
    expect(boundsOf(doc, 'r')?.max[1]).toBeCloseTo(10, 6);
  });

  it('ignores a transform it cannot read, rather than applying half of it', () => {
    const doc = mustParse(
      '<svg viewBox="0 0 100 100"><rect id="r" width="10" height="10" transform="translate(50,50) perspective(9)"/></svg>',
    );
    // A browser drops an invalid transform list whole, so the bounds have to
    // land where the renderer will draw: untransformed.
    expect(boundsOf(doc, 'r')?.min).toEqual([0, 0]);
  });

  it('estimates a text box from the font size, and null for empty text', () => {
    const doc = mustParse(
      '<svg viewBox="0 0 200 200"><text id="t" x="0" y="100" font-size="20">abcd</text><text id="empty" x="0" y="10"/></svg>',
    );
    // 4 characters at 0.6 x 20 wide, running up from the baseline at y.
    expect(boundsOf(doc, 't')?.min).toEqual([0, 80]);
    expect(boundsOf(doc, 't')?.max).toEqual([48, 100]);
    expect(boundsOf(doc, 'empty')).toBeNull();
  });

  it('inherits a font size from an ancestor', () => {
    const doc = mustParse('<svg viewBox="0 0 200 200"><g font-size="10"><text id="t" x="0" y="50">ab</text></g></svg>');
    expect(boundsOf(doc, 't')?.max).toEqual([12, 50]);
  });
});

describe('svgDigest', () => {
  it('measures content bounds over everything that draws', () => {
    const doc = mustParse(`<svg viewBox="0 0 200 200">
      <line id="l" x1="0" y1="0" x2="10" y2="20"/>
      <circle id="c" cx="50" cy="50" r="10"/>
      <text id="t" x="0" y="100" font-size="20">abcd</text>
    </svg>`);
    const digest = svgDigest(doc);
    expect(digest.contentBounds?.min).toEqual([0, 0]);
    expect(digest.contentBounds?.max).toEqual([60, 100]);
  });

  it('is null when nothing draws', () => {
    expect(svgDigest(mustParse('<svg viewBox="0 0 10 10"><g/></svg>')).contentBounds).toBeNull();
  });

  it('counts paths and their commands', () => {
    const digest = svgDigest(mustParse('<svg viewBox="0 0 10 10"><path d="M10 10 L90 10 L90 90 L10 90 Z"/><path d="m0 0 h5 v5"/></svg>'));
    expect(digest.pathCount).toBe(2);
    expect(digest.pathCommandCount).toBe(8);
  });

  it('normalises colours for the palette and keeps the written value for the count', () => {
    const doc = mustParse(
      '<svg viewBox="0 0 10 10"><linearGradient id="g"><stop stop-color="#00FF00"/></linearGradient><rect width="1" height="1" fill="#FF0000"/><rect width="1" height="1" fill="red"/><rect width="1" height="1" fill="url(#g)"/><rect width="1" height="1" fill="none"/></svg>',
    );
    const digest = svgDigest(doc);

    // `#FF0000` and `red` are one colour; `url(#g)` and `none` are not colours.
    expect(digest.colors).toEqual(['#00ff00', '#ff0000']);
    expect({ ...digest.colorCounts }).toEqual({
      '#ff0000': 1,
      red: 1,
      'url(#g)': 1,
      none: 1,
      '#00ff00': 1,
    });
  });

  it('reports the aspect ratio, and null for a degenerate height', () => {
    expect(svgDigest(mustParse('<svg viewBox="0 0 160 90"><rect width="1" height="1"/></svg>')).aspectRatio).toBeCloseTo(16 / 9, 9);
    expect(svgDigest(mustParse('<svg viewBox="0 0 10 0"><rect width="1" height="1"/></svg>')).aspectRatio).toBeNull();
  });
});

describe('rasterWrapHtml', () => {
  const BENIGN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>';

  it('embeds the source verbatim, with nothing escaped or rewritten', () => {
    const html = rasterWrapHtml(BENIGN, 640, 480);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(BENIGN);
    expect(html).toContain('margin:0');
    expect(html).toContain('overflow:hidden');
    // The root svg is pinned to the viewport, so that what is measured on the
    // raster lines up with the size the caller asked for.
    expect(html).toMatch(/body>svg\{[^}]*width:640px[^}]*height:480px/);
  });

  it('shows a source that could escape its container as text instead', () => {
    const hostile = `${BENIGN}</body><script>fetch("/x")</script>`;
    const html = rasterWrapHtml(hostile, 320, 200);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('&lt;/body&gt;');
    expect(html).toContain('&lt;script&gt;');

    // Nothing between the body tags is markup: the only closing tags in the
    // document are the wrapper's own, and they are the last thing in it.
    const open = html.indexOf('<body>') + '<body>'.length;
    const close = html.lastIndexOf('</body>');
    const body = html.slice(open, close).toLowerCase();
    expect(body).not.toContain('</body');
    expect(body).not.toContain('</html');
    expect(body).not.toContain('<script');
    expect(close).toBeGreaterThan(open);
  });

  it('refuses to write a viewport size that is not a number', () => {
    const html = rasterWrapHtml(BENIGN, Number.NaN, -5);
    expect(html).not.toContain('NaN');
    expect(html).toContain('width:1px');
    expect(html).toContain('height:1px');
  });
});
