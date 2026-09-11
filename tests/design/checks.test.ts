import { describe, it, expect } from 'vitest';
import {
  checkVocabulary,
  compileCriteria,
  parseQuantity,
  resolveName,
  ruleIds,
  runChecks,
  type Measures,
  type SceneMeasurements,
  type SvgMeasurements,
} from '../../src/worker/design/checks';
import type { ImageStats, SceneDigest, SvgDigest, SvgIssue } from '../../src/worker/design/types';

/**
 * Tests for the criteria compiler.
 *
 * The thing under test is a *decision layer*, so the cases that matter most are
 * the ones where it must decline: a criterion it cannot settle, a measurement
 * that is missing, a name that does not exist. A compiler that answered every
 * question would be the failure mode this whole design exists to avoid, so
 * several of these tests assert that it refuses.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function emptySvgDigest(over: Partial<SvgDigest> = {}): SvgDigest {
  return {
    width: 800,
    height: 600,
    viewBox: [0, 0, 800, 600],
    aspectRatio: 800 / 600,
    counts: {},
    ids: [],
    colors: [],
    colorCounts: {},
    text: [],
    pathCount: 0,
    pathCommandCount: 0,
    contentBounds: null,
    ...over,
  };
}

function svgMeasures(over: Partial<SvgMeasurements> = {}): Measures {
  return {
    surface: 'vector',
    svg: {
      digest: emptySvgDigest(),
      elementBounds: {},
      issues: [],
      ...over,
    },
    scene: null,
    pixels: null,
  };
}

function emptySceneDigest(over: Partial<SceneDigest> = {}): SceneDigest {
  return {
    name: 'test',
    unit: 'm',
    partNames: [],
    kindCounts: {},
    partCount: 0,
    maxDepth: 0,
    rootCount: 0,
    jointCount: 0,
    worldBounds: null,
    partBounds: {},
    overlappingPairs: [],
    materials: {},
    ...over,
  };
}

function sceneMeasures(
  digestOver: Partial<SceneDigest> = {},
  parents: Record<string, string | null> = {},
): Measures {
  const scene: SceneMeasurements = { digest: emptySceneDigest(digestOver), parents };
  return { surface: 'scene', svg: null, scene, pixels: null };
}

function stats(over: Partial<ImageStats> = {}): ImageStats {
  return {
    width: 100,
    height: 100,
    distinctColors: 3,
    background: '#ffffff',
    backgroundShare: 0.8,
    palette: [],
    edgeCoverage: 0,
    contrastRatio: 5,
    meanLuminance: 0.5,
    blank: false,
    inkCoverage: 0.2,
    ...over,
  };
}

/** Runs one criterion against one set of measurements and returns the finding. */
function check(criterion: string, m: Measures) {
  const run = runChecks([criterion], m);
  expect(run.refusals, `expected "${criterion}" to compile`).toHaveLength(0);
  const finding = run.findings[0];
  expect(finding, `expected a finding for "${criterion}"`).toBeDefined();
  return finding!;
}

/* ------------------------------------------------------------------ */
/* Reading quantities                                                  */
/* ------------------------------------------------------------------ */

describe('parseQuantity', () => {
  it('reads a bare spelled-out count as exact', () => {
    expect(parseQuantity('five circles')).toEqual({
      comparison: 'exactly',
      count: 5,
      noun: 'circles',
    });
  });

  it('reads digits', () => {
    expect(parseQuantity('3 rectangles')?.count).toBe(3);
  });

  it('reads leading comparators', () => {
    expect(parseQuantity('at least five circles')?.comparison).toBe('at-least');
    expect(parseQuantity('no more than 4 lines')?.comparison).toBe('at-most');
    expect(parseQuantity('at most 2 ellipses')?.comparison).toBe('at-most');
    expect(parseQuantity('exactly two paths')?.comparison).toBe('exactly');
  });

  it('distinguishes "more than" from "at least"', () => {
    // These differ by one and conflating them would let a drawing with exactly
    // the disallowed number pass.
    expect(parseQuantity('more than 5 circles')?.comparison).toBe('more-than');
    expect(parseQuantity('fewer than 3 circles')?.comparison).toBe('fewer-than');
  });

  it('reads trailing comparators', () => {
    const q = parseQuantity('5 or more circles');
    expect(q?.comparison).toBe('at-least');
    expect(q?.count).toBe(5);
    expect(q?.noun).toBe('circles');
  });

  it('strips the subject and articles', () => {
    expect(parseQuantity('there are five circles')?.noun).toBe('circles');
    expect(parseQuantity('the image has 3 squares')?.count).toBe(3);
  });

  it('returns null when there is no quantity at all', () => {
    expect(parseQuantity('it should look nice')).toBeNull();
    expect(parseQuantity('circles')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Resolving names                                                     */
/* ------------------------------------------------------------------ */

describe('resolveName', () => {
  it('matches a prose phrase to a hyphenated id', () => {
    expect(resolveName('horizon line', ['horizon-line', 'sun']).key).toBe('horizon-line');
  });

  it('matches an underscored id', () => {
    expect(resolveName('left arm', ['left_arm']).key).toBe('left_arm');
  });

  it('records every key it tried, so a wrong guess is visible', () => {
    const resolved = resolveName('the shiny thing', ['post']);
    expect(resolved.key).toBeNull();
    expect(resolved.tried).toContain('shiny thing');
    expect(resolved.tried).toContain('shiny');
  });

  it('returns null rather than a nearest guess when nothing matches', () => {
    expect(resolveName('post', ['lamp', 'shade']).key).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Counts, against a vector digest                                     */
/* ------------------------------------------------------------------ */

describe('count checks over SVG', () => {
  it('counts a tag exactly and reports the number', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ counts: { circle: 5, svg: 1 } }) });
    const found = check('exactly five circles', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.actual).toBe(5);
    expect(found.measured.rule).toBe('count-of-kind');
    expect(found.kind).toBe('structural');
  });

  it('fails an exact count that does not hold, and says the actual number', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ counts: { circle: 4, svg: 1 } }) });
    const found = check('exactly five circles', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('4 circles');
  });

  it('honours "at least"', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ counts: { circle: 9, svg: 1 } }) });
    expect(check('at least five circles', m).outcome).toBe('met');
    expect(check('exactly five circles', m).outcome).toBe('not-met');
  });

  it('sums shapes when the noun is a category', () => {
    const m = svgMeasures({
      digest: emptySvgDigest({ counts: { rect: 2, circle: 3, path: 1, svg: 1 } }),
    });
    const found = check('exactly 6 shapes', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.actual).toBe(6);
  });

  it('excludes the root svg element from an element count', () => {
    // Off-by-one here would make "the drawing has two elements" wrong in a way
    // nobody would think to check.
    const m = svgMeasures({ digest: emptySvgDigest({ counts: { rect: 1, circle: 1, svg: 1 } }) });
    expect(check('exactly 2 elements', m).outcome).toBe('met');
  });

  it('counts the head noun, not an earlier word that is also a noun', () => {
    // "circle groups" must count groups. Counting circles instead would answer a
    // different question while looking like it answered this one.
    const m = svgMeasures({ digest: emptySvgDigest({ counts: { g: 1, circle: 5, svg: 1 } }) });
    const found = check('at least 3 circle groups', m);
    expect(found.outcome).toBe('not-met');
    expect(found.measured.actual).toBe(1);
    expect(found.measured.counted).toBe('groups');
  });

  it('falls back to an earlier known noun when the head is not one', () => {
    // "lids" is not a thing this harness counts, so "box" carries the meaning.
    const m = svgMeasures({ digest: emptySvgDigest({ counts: { rect: 4, svg: 1 } }) });
    const found = check('exactly 4 box lids', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.counted).toBe('boxes');
  });
});

/* ------------------------------------------------------------------ */
/* Colour counting uses the source, not the raster                     */
/* ------------------------------------------------------------------ */

describe('colour counts', () => {
  it('counts the declared palette, not the rendered one', () => {
    const m = svgMeasures({
      digest: emptySvgDigest({ colors: ['#ff0000', '#00ff00', '#0000ff'] }),
    });
    const found = check('exactly three colours', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.rule).toBe('count-of-colours');
  });

  it('says the palette is empty rather than passing a count of zero', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ colors: [] }) });
    const found = check('exactly three colours', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('none');
  });
});

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

describe('spatial relations in SVG', () => {
  it('reads "above" as the smaller y, because SVG y grows downward', () => {
    // This is the assertion that catches an inverted vertical check. Getting it
    // backwards would pass every "above" criterion for a drawing where the
    // subject is below.
    const m = svgMeasures({
      elementBounds: {
        sun: { min: [10, 10], max: [30, 30] },
        horizon: { min: [0, 100], max: [200, 102] },
      },
    });
    expect(check('the sun is above the horizon', m).outcome).toBe('met');

    const below = svgMeasures({
      elementBounds: {
        sun: { min: [10, 200], max: [30, 220] },
        horizon: { min: [0, 100], max: [200, 102] },
      },
    });
    expect(check('the sun is above the horizon', below).outcome).toBe('not-met');
  });

  it('reports an overlap in the relation rather than only a verdict', () => {
    const m = svgMeasures({
      elementBounds: {
        sun: { min: [10, 90], max: [30, 110] },
        horizon: { min: [0, 100], max: [200, 102] },
      },
    });
    const found = check('the sun is above the horizon', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('overlap');
  });

  it('fails, rather than refusing, when the named element does not exist', () => {
    const m = svgMeasures({ elementBounds: { post: { min: [0, 0], max: [10, 10] } } });
    const found = check('the shade is above the post', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('shade');
  });

  it('resolves a prose name to a hyphenated id and records which id it used', () => {
    const m = svgMeasures({
      elementBounds: {
        'horizon-line': { min: [0, 100], max: [200, 102] },
        sun: { min: [10, 10], max: [30, 30] },
      },
    });
    const found = check('the sun is above the horizon line', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.object).toBe('horizon-line');
  });
});

describe('relations and contact in a scene', () => {
  it('reads "above" as the larger y, because a scene has y up', () => {
    const m = sceneMeasures(
      {
        partNames: ['post', 'base'],
        partBounds: {
          base: { min: [-0.1, 0, -0.1], max: [0.1, 0.02, 0.1] },
          post: { min: [-0.01, 0.02, -0.01], max: [0.01, 0.47, 0.01] },
        },
      },
      { base: null, post: 'base' },
    );
    expect(check('the post is above the base', m).outcome).toBe('met');
  });

  it('confirms a part resting on another when the surfaces meet and footprints overlap', () => {
    const m = sceneMeasures(
      {
        partNames: ['post', 'base'],
        partBounds: {
          base: { min: [-0.1, 0, -0.1], max: [0.1, 0.02, 0.1] },
          post: { min: [-0.01, 0.02, -0.01], max: [0.01, 0.47, 0.01] },
        },
      },
      { base: null, post: 'base' },
    );
    const found = check('the post sits on the base', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.footprint).toBeGreaterThan(0);
  });

  it('rejects a part that meets the surface height but stands beside it', () => {
    // The case a naive height-only check gets wrong: same bottom, no contact.
    const m = sceneMeasures(
      {
        partNames: ['post', 'base'],
        partBounds: {
          base: { min: [-0.1, 0, -0.1], max: [0.1, 0.02, 0.1] },
          post: { min: [0.5, 0.02, 0.5], max: [0.52, 0.47, 0.52] },
        },
      },
      { base: null, post: null },
    );
    const found = check('the post sits on the base', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('footprint');
  });

  it('rejects a floating part, and says the gap', () => {
    const m = sceneMeasures(
      {
        partNames: ['post', 'base'],
        partBounds: {
          base: { min: [-0.1, 0, -0.1], max: [0.1, 0.02, 0.1] },
          post: { min: [-0.01, 0.1, -0.01], max: [0.01, 0.47, 0.01] },
        },
      },
      { base: null, post: null },
    );
    const found = check('the post sits on the base', m);
    expect(found.outcome).toBe('not-met');
    expect(found.measured.gap).toBeCloseTo(0.08, 6);
  });
});

/* ------------------------------------------------------------------ */
/* Containment and hierarchy                                           */
/* ------------------------------------------------------------------ */

describe('containment', () => {
  it('verifies an SVG element inside another', () => {
    const m = svgMeasures({
      elementBounds: {
        frame: { min: [0, 0], max: [100, 100] },
        sun: { min: [10, 10], max: [30, 30] },
      },
    });
    expect(check('the sun is inside the frame', m).outcome).toBe('met');
  });

  it('fails containment and names the overflow on each side', () => {
    const m = svgMeasures({
      elementBounds: {
        frame: { min: [0, 0], max: [100, 100] },
        sun: { min: [10, 10], max: [130, 30] },
      },
    });
    const found = check('the sun is inside the frame', m);
    expect(found.outcome).toBe('not-met');
    expect(found.measured.overflowRight).toBeCloseTo(30, 6);
    expect(found.measured.overflowLeft).toBe(0);
  });

  it('verifies a 3D part inside another', () => {
    const m = sceneMeasures({
      partNames: ['post', 'base'],
      partBounds: {
        base: { min: [-0.1, 0, -0.1], max: [0.1, 0.02, 0.1] },
        post: { min: [-0.01, 0.001, -0.01], max: [0.01, 0.018, 0.01] },
      },
    });
    expect(check('the post is inside the base', m).outcome).toBe('met');
  });
});

describe('hierarchy', () => {
  it('walks the ancestry rather than checking only the immediate parent', () => {
    const m = sceneMeasures(
      {
        partNames: ['lamp', 'post', 'shade'],
        partBounds: {
          lamp: { min: [-0.2, 0, -0.2], max: [0.2, 0.7, 0.2] },
          post: { min: [-0.01, 0, -0.01], max: [0.01, 0.47, 0.01] },
          shade: { min: [-0.18, 0.47, -0.18], max: [0.18, 0.63, 0.18] },
        },
      },
      { lamp: null, post: 'lamp', shade: 'post' },
    );
    const found = check('the shade is part of the lamp', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.chain).toBe('shade -> post -> lamp');
  });

  it('fails parentage that does not hold, and prints the real chain', () => {
    const m = sceneMeasures(
      {
        partNames: ['a', 'b', 'shade'],
        partBounds: {
          a: { min: [0, 0, 0], max: [1, 1, 1] },
          b: { min: [0, 0, 0], max: [1, 1, 1] },
          shade: { min: [0, 0, 0], max: [1, 1, 1] },
        },
      },
      { a: null, b: 'a', shade: null },
    );
    const found = check('the shade is part of the lamp', m);
    expect(found.outcome).toBe('not-met');
  });

  it('terminates on a corrupt parent chain instead of looping forever', () => {
    // A cycle should never reach here, but a decision layer that hangs on bad
    // input is worse than one that answers wrongly.
    const m = sceneMeasures(
      {
        partNames: ['a', 'b', 'lamp'],
        partBounds: {
          a: { min: [0, 0, 0], max: [1, 1, 1] },
          b: { min: [0, 0, 0], max: [1, 1, 1] },
          lamp: { min: [0, 0, 0], max: [1, 1, 1] },
        },
      },
      { lamp: null, a: 'b', b: 'a' },
    );
    expect(check('a is part of the lamp', m).outcome).toBe('not-met');
  });
});

/* ------------------------------------------------------------------ */
/* Overlap                                                             */
/* ------------------------------------------------------------------ */

describe('overlap', () => {
  it('reports a clean scene as met for "parts do not overlap"', () => {
    const m = sceneMeasures({ partNames: ['a', 'b'], overlappingPairs: [] });
    const found = check('the parts do not overlap', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.overlappingPairs).toBe(0);
  });

  it('names the offending pair when parts intersect', () => {
    const m = sceneMeasures({ partNames: ['a', 'b'], overlappingPairs: [['a', 'b']] });
    const found = check('the parts do not overlap', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('a/b');
  });

  it('does not read "do not overlap" as a request for overlap', () => {
    const m = sceneMeasures({ partNames: ['a', 'b'], overlappingPairs: [] });
    expect(check('the parts do not overlap', m).outcome).toBe('met');
  });
});

/* ------------------------------------------------------------------ */
/* Rendered-image checks                                               */
/* ------------------------------------------------------------------ */

describe('rendered image checks', () => {
  function withViews(views: { view: string; stats: ImageStats }[]): Measures {
    return { surface: 'scene', svg: null, scene: null, pixels: { views } };
  }

  it('verifies a non-blank render', () => {
    const m = withViews([{ view: 'front', stats: stats({ blank: false, inkCoverage: 0.3 }) }]);
    expect(check('the render is not blank', m).outcome).toBe('met');
  });

  it('fails when any view is blank, because one empty view is a defect', () => {
    const m = withViews([
      { view: 'front', stats: stats({ blank: false }) },
      { view: 'top', stats: stats({ blank: true, inkCoverage: 0 }) },
    ]);
    const found = check('the render is not blank', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('top');
  });

  it('detects clipping from border coverage', () => {
    const m = withViews([{ view: 'front', stats: stats({ edgeCoverage: 0.4 }) }]);
    expect(check('nothing is cut off at the edges', m).outcome).toBe('not-met');
  });

  it('does not call a full-bleed background clipped', () => {
    // Border pixels that *are* the dominant colour mean the drawing fills the
    // frame on purpose, not that it overflowed.
    const m = withViews([{ view: 'front', stats: stats({ edgeCoverage: 0 }) }]);
    expect(check('nothing is cut off at the edges', m).outcome).toBe('met');
  });

  it('checks contrast against the worst view', () => {
    const m = withViews([
      { view: 'front', stats: stats({ contrastRatio: 12 }) },
      { view: 'top', stats: stats({ contrastRatio: 2.1 }) },
    ]);
    const found = check('the contrast is at least 4.5', m);
    expect(found.outcome).toBe('not-met');
    expect(found.measured.view).toBe('top');
  });

  it('refuses to pass a pixel criterion when nothing was rendered', () => {
    const m: Measures = { surface: 'scene', svg: null, scene: null, pixels: null };
    const found = check('the render is not blank', m);
    expect(found.outcome).toBe('unverifiable');
    expect(found.measured.reason).toBe('no-measurement');
  });
});

/* ------------------------------------------------------------------ */
/* Refusals — the important half                                       */
/* ------------------------------------------------------------------ */

describe('refusals', () => {
  it('refuses a criterion no pattern matches, and says what it could check', () => {
    const compilation = compileCriteria(['it should feel warm and inviting'], 'vector');
    expect(compilation.criteria[0]?.check).toBeNull();
    expect(compilation.refused).toHaveLength(1);
    const reason = compilation.refused[0]?.reason ?? '';
    expect(reason).toContain('vision model');
    expect(reason).toContain('count');
  });

  it('refuses a vector construct on a scene lab, rather than silently checking zero', () => {
    const compilation = compileCriteria(['exactly five circles'], 'scene');
    expect(compilation.criteria[0]?.check).toBeNull();
    expect(compilation.refused).toHaveLength(1);
  });

  it('refuses a scene construct on a vector lab', () => {
    const compilation = compileCriteria(['exactly three cylinders'], 'vector');
    expect(compilation.criteria[0]?.check).toBeNull();
  });

  it('gives every criterion either a check or a refusal, never neither', () => {
    const criteria = [
      'exactly five circles',
      'it should look nice',
      'the sun is above the horizon',
      'uses three colours',
    ];
    const compilation = compileCriteria(criteria, 'vector');
    expect(compilation.criteria).toHaveLength(4);
    for (const entry of compilation.criteria) {
      const hasCheck = entry.check !== null;
      const hasRefusal = entry.refusal !== null;
      expect(hasCheck !== hasRefusal, `"${entry.criterion}" must have exactly one`).toBe(true);
    }
  });

  it('skips blank criteria without inventing a finding', () => {
    expect(compileCriteria(['   ', ''], 'vector').criteria).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* The safety property that matters most                               */
/* ------------------------------------------------------------------ */

describe('no check ever reports met without evidence', () => {
  it('never returns met when the measurement is absent', () => {
    const cases: { criterion: string; m: Measures }[] = [
      { criterion: 'exactly five circles', m: { surface: 'vector', svg: null, scene: null, pixels: null } },
      { criterion: 'the parts do not overlap', m: { surface: 'scene', svg: null, scene: null, pixels: null } },
      { criterion: 'the post sits on the base', m: { surface: 'scene', svg: null, scene: null, pixels: null } },
      { criterion: 'the render is not blank', m: { surface: 'scene', svg: null, scene: null, pixels: null } },
      { criterion: 'the sun is above the horizon', m: { surface: 'vector', svg: null, scene: null, pixels: null } },
    ];
    for (const { criterion, m } of cases) {
      const run = runChecks([criterion], m);
      for (const finding of run.findings) {
        expect(
          finding.outcome,
          `"${criterion}" must not be met with no measurement`,
        ).not.toBe('met');
      }
    }
  });

  it('records which rule produced every finding', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ counts: { circle: 1, svg: 1 } }) });
    const run = runChecks(['exactly one circle', 'uses two colours', 'it is lovely'], m);
    for (const finding of run.findings) {
      expect(typeof finding.measured.rule).toBe('string');
      expect(finding.measured.rule).not.toBe('');
    }
    // The uncheckable one is a refusal, not a finding pretending to be one.
    expect(run.refusals.map((r) => r.criterion)).toEqual(['it is lovely']);
  });
});

/* ------------------------------------------------------------------ */
/* Safety rule                                                         */
/* ------------------------------------------------------------------ */

describe('source safety', () => {
  it('passes a document with no unsafe constructs', () => {
    const m = svgMeasures({ issues: [] });
    expect(check('the file is self-contained', m).outcome).toBe('met');
  });

  it('fails when a script is present, naming the code', () => {
    const issues: SvgIssue[] = [{ code: 'script-element', message: 'script', elementIndex: 2 }];
    const m = svgMeasures({ issues });
    const found = check('the file is safe', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('script-element');
  });

  it('does not treat a cosmetic issue as unsafe', () => {
    // An unresolved gradient reference makes a drawing ugly, not dangerous.
    const issues: SvgIssue[] = [{ code: 'unresolved-reference', message: 'url(#gone)', elementIndex: 1 }];
    expect(check('the file is safe', svgMeasures({ issues })).outcome).toBe('met');
  });
});

/* ------------------------------------------------------------------ */
/* Text and canvas                                                     */
/* ------------------------------------------------------------------ */

describe('text and canvas checks', () => {
  it('finds text content case-insensitively', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ text: ['Sunset over the bay'] }) });
    expect(check('it contains the text "sunset"', m).outcome).toBe('met');
  });

  it('fails text that is not present and prints what is there', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ text: ['Hello'] }) });
    const found = check('it contains the text "goodbye"', m);
    expect(found.outcome).toBe('not-met');
    expect(found.evidence).toContain('Hello');
  });

  it('checks an aspect ratio within tolerance', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ aspectRatio: 16 / 9 }) });
    expect(check('the canvas aspect ratio is 16:9', m).outcome).toBe('met');
  });

  it('fails a wrong aspect ratio and reports both numbers', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ aspectRatio: 1 }) });
    const found = check('the canvas aspect ratio is 16:9', m);
    expect(found.outcome).toBe('not-met');
    expect(found.measured.actual).toBe(1);
  });

  it('finds a named element', () => {
    const m = svgMeasures({ digest: emptySvgDigest({ ids: ['sun', 'horizon'] }) });
    expect(check('it has an element named sun', m).outcome).toBe('met');
    expect(check('it has an element named moon', m).outcome).toBe('not-met');
  });
});

/* ------------------------------------------------------------------ */
/* Assembly depth                                                      */
/* ------------------------------------------------------------------ */

describe('assembly depth', () => {
  it('counts a flat scene as one level', () => {
    const m = sceneMeasures({ partNames: ['a', 'b'], maxDepth: 0, rootCount: 2 });
    expect(check('the assembly is one level deep', m).outcome).toBe('met');
  });

  it('counts root plus depth as levels', () => {
    const m = sceneMeasures({ partNames: ['a', 'b', 'c'], maxDepth: 2, rootCount: 1 });
    const found = check('it has at least 3 levels of hierarchy', m);
    expect(found.outcome).toBe('met');
    expect(found.measured.levels).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* The published vocabulary                                            */
/* ------------------------------------------------------------------ */

describe('the vocabulary an author is shown', () => {
  it('describes every rule exactly once', () => {
    // `settlable` is built from the live RULES, so a rule that applies to a
    // surface contributes its description to that surface's list. Five rules
    // apply to both surfaces, so the two lists together are longer than the rule
    // count — but the *distinct* descriptions must number exactly the rules.
    // A rule added without a description drops that count; two rules sharing one
    // description drops it too. Either way this fails, rather than letting the
    // published list drift from the compiler — the drift that would have an
    // author write a criterion the harness then refuses.
    const described = [
      ...checkVocabulary('vector').settlable,
      ...checkVocabulary('scene').settlable,
    ];
    expect(new Set(described).size).toBe(ruleIds().length);
  });

  it('does not repeat itself within one surface', () => {
    for (const surface of ['vector', 'scene'] as const) {
      const settlable = checkVocabulary(surface).settlable;
      expect(new Set(settlable).size, `${surface} lists a rule twice`).toBe(settlable.length);
    }
  });

  it('describes only rules the surface can actually reach', () => {
    // "rests on" is a scene idea; a drawing author must not be told to write it,
    // because it would come straight back as a refusal.
    const vector = checkVocabulary('vector').settlable.join(' ');
    const scene = checkVocabulary('scene').settlable.join(' ');
    expect(scene).toContain('sits on top of');
    expect(vector).not.toContain('sits on top of');
    // Counting is the rule that applies everywhere, so both surfaces have it.
    expect(vector).toContain('how many of a named kind');
    expect(scene).toContain('how many of a named kind');
  });

  it('lists only the nouns the surface can actually count', () => {
    const vector = checkVocabulary('vector').nouns.map((n) => n.word);
    const scene = checkVocabulary('scene').nouns.map((n) => n.word);
    expect(vector).toContain('circle');
    expect(vector).toContain('rect');
    expect(scene).toContain('cylinder');
    expect(scene).toContain('box');
    // A drawing has no cylinders; a scene has no <circle> elements.
    expect(vector).not.toContain('cylinder');
    expect(scene).not.toContain('circle');
  });

  it('names each relation once, with the axis it is read along', () => {
    const relations = checkVocabulary('vector').relations;
    const words = relations.map((r) => r.word);
    expect(words).toContain('above');
    expect(words).toContain('left of');
    // "above" and "over" are one relation, not two.
    expect(words.filter((w) => w === 'above' || w === 'over')).toHaveLength(1);
    expect(relations.find((r) => r.word === 'above')?.axis).toBe('vertical');
  });

  it('says out loud what no check can settle', () => {
    // The not-settlable list is the honest half of the answer: an author reads it
    // and knows those criteria will be an opinion, not a result.
    const vocabulary = checkVocabulary('scene');
    expect(vocabulary.notSettlable.join(' ')).toContain('good');
    expect(vocabulary.settlable.join(' ')).not.toContain('looks');
  });
});
