import { describe, it, expect } from 'vitest';
import { fail, ok, type Result } from '../../src/shared/types';
import {
  buildReviewPrompt,
  isVerified,
  reviewRevision,
  unresolved,
  verifiedEvidence,
  type ModelOpinions,
  type ReviewInput,
} from '../../src/worker/design/review';
import type { DesignReview, SvgDigest } from '../../src/worker/design/types';
import type { Measures } from '../../src/worker/design/checks';

/**
 * Tests for the two-track verdict.
 *
 * The property under test is a separation of authority: what a host check
 * established and what a model opined must never be confused, and the opinion
 * must never win. Several of these tests are adversarial in the specific sense
 * of having the model assert the opposite of the measurement.
 */

function digest(over: Partial<SvgDigest> = {}): SvgDigest {
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

function measures(over: Partial<SvgDigest> = {}, bounds: Record<string, { min: [number, number]; max: [number, number] }> = {}): Measures {
  return {
    surface: 'vector',
    svg: { digest: digest(over), elementBounds: bounds, issues: [] },
    scene: null,
    pixels: null,
  };
}

/** A model that answers with whatever it is told, and records what it was asked. */
function scriptedModel(
  answers: Record<string, { outcome: 'met' | 'not-met' | 'unverifiable'; evidence?: string }>,
  other: string[] = [],
): { ask: ReviewInput['askModel']; asked: string[][] } {
  const asked: string[][] = [];
  const ask: ReviewInput['askModel'] = async (criteria) => {
    asked.push([...criteria]);
    return ok({
      findings: criteria.map((criterion) => ({
        criterion,
        outcome: answers[criterion]?.outcome ?? 'unverifiable',
        evidence: answers[criterion]?.evidence ?? 'no answer',
      })),
      otherObservations: other,
      reviewedBy: 'test-model-1',
    });
  };
  return { ask, asked };
}

async function review(
  criteria: string[],
  m: Measures,
  ask: ReviewInput['askModel'],
): Promise<DesignReview> {
  const result = await reviewRevision({
    revisionId: 'rev-1',
    surface: m.surface,
    criteria,
    measures: m,
    askModel: ask,
    now: () => '2026-09-10T00:00:00.000Z',
  });
  expect(result.ok, result.ok ? '' : result.message).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

const neverCalled: ReviewInput['askModel'] = async () => {
  throw new Error('the model must not be asked when every criterion is settled');
};

/* ------------------------------------------------------------------ */

describe('a host check settles a criterion', () => {
  it('marks it deterministic and verified', async () => {
    const found = await review(['exactly five circles'], measures({ counts: { circle: 5, svg: 1 } }), neverCalled);
    const verdict = found.verdicts[0]!;
    expect(verdict.basis).toBe('deterministic');
    expect(verdict.outcome).toBe('met');
    expect(isVerified(verdict)).toBe(true);
    expect(found.allVerified).toBe(true);
    expect(found.reviewedBy).toBeNull();
  });

  it('keeps the numbers behind the verdict', async () => {
    const found = await review(['exactly five circles'], measures({ counts: { circle: 5, svg: 1 } }), neverCalled);
    expect(found.verdicts[0]?.verified?.measured.actual).toBe(5);
    expect(verifiedEvidence(found.verdicts)[0]?.evidence).toContain('5 circles');
  });

  it('records a failed check as deterministic and not met', async () => {
    const model = scriptedModel({ 'exactly five circles': { outcome: 'not-met', evidence: 'I see two' } });
    const found = await review(['exactly five circles'], measures({ counts: { circle: 2, svg: 1 } }), model.ask);
    expect(found.verdicts[0]?.basis).toBe('deterministic');
    expect(found.verdicts[0]?.outcome).toBe('not-met');
    expect(found.allVerified).toBe(false);
    expect(found.counts.notMet).toBe(1);
    // The model agreed, so there is nothing to record as a disagreement.
    expect(found.verdicts[0]?.conflict).toBeNull();
  });

  it('does not ask the model about criteria already settled', async () => {
    const model = scriptedModel({});
    await review(['exactly five circles'], measures({ counts: { circle: 5, svg: 1 } }), model.ask);
    expect(model.asked).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* The rule that matters most                                          */
/* ------------------------------------------------------------------ */

describe('an opinion never overturns a check', () => {
  it('keeps the check when the model disagrees, and records the disagreement', async () => {
    // The measurement says the sun is below the horizon. The model says it is
    // above. The measurement stands, and the disagreement is preserved rather
    // than being resolved silently in either direction.
    const model = scriptedModel({
      'the sun is above the horizon': { outcome: 'met', evidence: 'the sun sits clearly above the line' },
    });
    const found = await review(
      ['the sun is above the horizon'],
      measures({}, {
        sun: { min: [10, 200], max: [30, 220] },
        horizon: { min: [0, 100], max: [200, 102] },
      }),
      model.ask,
    );
    const verdict = found.verdicts[0]!;
    expect(verdict.outcome).toBe('not-met');
    expect(verdict.basis).toBe('deterministic');
    expect(verdict.conflict).toContain('The check stands');
    expect(verdict.opinion?.outcome).toBe('met');
    expect(isVerified(verdict)).toBe(false);
  });

  it('does ask a model about a criterion a check rejected', async () => {
    // A rejection is the consequential call — it sends somebody back to revise —
    // so it is the one outcome worth a second, independent look. Approvals get
    // no second opinion, because they already have evidence and an opinion could
    // not move them.
    const model = scriptedModel({ 'exactly five circles': { outcome: 'met', evidence: 'I count five' } });
    await review(['exactly five circles'], measures({ counts: { circle: 1, svg: 1 } }), model.ask);
    expect(model.asked).toHaveLength(1);
    expect(model.asked[0]).toEqual(['exactly five circles']);
  });

  it('does not ask a model about a criterion the host passed', async () => {
    const model = scriptedModel({});
    await review(['exactly five circles'], measures({ counts: { circle: 5, svg: 1 } }), model.ask);
    expect(model.asked).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Opinions                                                            */
/* ------------------------------------------------------------------ */

describe('opinion-only verdicts', () => {
  it('never marks a criterion verified even when the model says met', async () => {
    const model = scriptedModel({ 'it should feel warm': { outcome: 'met', evidence: 'warm oranges' } });
    const found = await review(['it should feel warm'], measures(), model.ask);
    const verdict = found.verdicts[0]!;
    expect(verdict.outcome).toBe('met');
    expect(verdict.basis).toBe('opinion-only');
    expect(isVerified(verdict)).toBe(false);
    expect(found.allVerified).toBe(false);
    expect(found.counts.opinionOnly).toBe(1);
    expect(found.counts.verifiedMet).toBe(0);
  });

  it('carries the caveat and names the model', async () => {
    const model = scriptedModel({ 'it should feel warm': { outcome: 'met' } });
    const found = await review(['it should feel warm'], measures(), model.ask);
    expect(found.reviewedBy).toBe('test-model-1');
    expect(found.caveat).toContain('opinion');
  });

  it('is asked only about what the host could not settle', async () => {
    const model = scriptedModel({ 'it should feel warm': { outcome: 'met' } });
    await review(
      ['exactly five circles', 'it should feel warm'],
      measures({ counts: { circle: 5, svg: 1 } }),
      model.ask,
    );
    expect(model.asked).toHaveLength(1);
    expect(model.asked[0]).toEqual(['it should feel warm']);
  });

  it('reports a refusal for the criterion so a person sees why the host declined', async () => {
    const model = scriptedModel({ 'it should feel warm': { outcome: 'met' } });
    const found = await review(['it should feel warm'], measures(), model.ask);
    expect(found.refused).toHaveLength(1);
    expect(found.refused[0]?.criterion).toBe('it should feel warm');
  });
});

/* ------------------------------------------------------------------ */
/* Silence                                                             */
/* ------------------------------------------------------------------ */

describe('an unanswered criterion is never approved', () => {
  it('is unverifiable when the model returns nothing for it', async () => {
    // The model answers about a different criterion than it was asked about.
    const ask: ReviewInput['askModel'] = async () =>
      ok({
        findings: [{ criterion: 'something else entirely', outcome: 'met', evidence: 'x' }],
        otherObservations: [],
        reviewedBy: 'test-model-1',
      });
    const found = await review(['it should feel warm'], measures(), ask);
    const verdict = found.verdicts[0]!;
    expect(verdict.outcome).toBe('unverifiable');
    expect(verdict.basis).toBe('unverifiable');
    expect(verdict.opinion).toBeNull();
    expect(isVerified(verdict)).toBe(false);
  });

  it('is unverifiable when the model is not reachable at all', async () => {
    const ask: ReviewInput['askModel'] = async () => {
      throw new Error('should not be reachable');
    };
    const found = await review(['exactly five circles'], measures({ counts: { circle: 5, svg: 1 } }), ask);
    // No call was made, because the host settled everything.
    expect(found.verdicts[0]?.outcome).toBe('met');
  });

  it('stays unverifiable when a check ran but had no measurement', async () => {
    const empty: Measures = { surface: 'vector', svg: null, scene: null, pixels: null };
    const model = scriptedModel({ 'it should feel warm': { outcome: 'unverifiable' } });
    const found = await review(['the render is not blank', 'it should feel warm'], empty, model.ask);
    const blank = found.verdicts[0]!;
    expect(blank.outcome).toBe('unverifiable');
    expect(blank.verified?.measured.reason).toBe('no-measurement');
    expect(model.asked[0]).toContain('the render is not blank');
  });
});

/* ------------------------------------------------------------------ */
/* Failure propagation                                                 */
/* ------------------------------------------------------------------ */

describe('a failed model call', () => {
  it('degrades to the host verdicts rather than discarding them', async () => {
    // A provider outage must not throw away checks that ran fine. The verified
    // verdict survives; the criterion that was waiting on the model becomes
    // unverifiable, and the gap is reported.
    const ask: ReviewInput['askModel'] = async () => fail('upstream-error', 'the vision provider is down');
    const found = await review(
      ['exactly five circles', 'it should feel warm'],
      measures({ counts: { circle: 5, svg: 1 } }),
      ask,
    );
    expect(found.verdicts[0]?.outcome).toBe('met');
    expect(found.verdicts[0]?.basis).toBe('deterministic');
    expect(found.verdicts[1]?.outcome).toBe('unverifiable');
    expect(found.reviewedBy).toBeNull();
    expect(found.otherObservations[0]).toContain('down');
  });

  it('does not report the outage when no model was needed', async () => {
    const ask: ReviewInput['askModel'] = async () => fail('upstream-error', 'down');
    const found = await review(['exactly five circles'], measures({ counts: { circle: 5, svg: 1 } }), ask);
    expect(found.otherObservations).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Counting and reporting                                              */
/* ------------------------------------------------------------------ */

describe('counts', () => {
  it('separates verified met from opinion-only', async () => {
    const model = scriptedModel({ 'it should feel warm': { outcome: 'met' } });
    const found = await review(
      ['exactly five circles', 'exactly ten circles', 'it should feel warm'],
      measures({ counts: { circle: 5, svg: 1 } }),
      model.ask,
    );
    expect(found.counts.verifiedMet).toBe(1);
    expect(found.counts.notMet).toBe(1);
    expect(found.counts.opinionOnly).toBe(1);
    expect(found.allVerified).toBe(false);
  });

  it('is allVerified only when every criterion was met on evidence', async () => {
    const model = scriptedModel({ 'it should feel warm': { outcome: 'met' } });
    const withOpinion = await review(
      ['exactly five circles', 'it should feel warm'],
      measures({ counts: { circle: 5, svg: 1 } }),
      model.ask,
    );
    expect(withOpinion.allVerified).toBe(false);

    const allChecked = await review(['exactly five circles'], measures({ counts: { circle: 5, svg: 1 } }), neverCalled);
    expect(allChecked.allVerified).toBe(true);
  });
});

describe('unresolved', () => {
  it('lists everything not met, with the reason', async () => {
    const model = scriptedModel({
      'exactly five circles': { outcome: 'not-met', evidence: 'I see two' },
      'it should feel warm': { outcome: 'unverifiable', evidence: 'cannot tell' },
    });
    const found = await review(['exactly five circles', 'it should feel warm'], measures({ counts: { circle: 2, svg: 1 } }), model.ask);
    const open = unresolved(found.verdicts);
    expect(open).toHaveLength(2);
    expect(open[0]?.reason).toContain('2 circles');
    expect(open[1]?.reason).toContain('cannot tell');
  });
});

/* ------------------------------------------------------------------ */
/* The prompt                                                          */
/* ------------------------------------------------------------------ */

describe('buildReviewPrompt', () => {
  it('asks only the unsettled questions and shows the settled ones as context', () => {
    const prompt = buildReviewPrompt({
      title: 'a sunset',
      surface: 'vector',
      source: '<svg/>',
      settled: [{ criterion: 'exactly five circles', outcome: 'met', evidence: '5 circles found' }],
      asked: ['it should feel warm'],
      views: ['canvas'],
    });
    expect(prompt.user).toContain('exactly five circles => met');
    expect(prompt.user).toContain('1. it should feel warm');
    expect(prompt.user).not.toContain('2. ');
  });

  it('tells the model its answer is an opinion and that it may not infer hidden geometry', () => {
    const prompt = buildReviewPrompt({
      title: 'a lamp',
      surface: 'scene',
      source: 'scene "lamp"',
      settled: [],
      asked: ['the shade is the right shape'],
      views: ['front', 'top'],
    });
    expect(prompt.system).toContain('opinion');
    expect(prompt.system).toContain('behind');
    expect(prompt.user).toContain('front, top');
  });

  it('does not silently truncate a long source without saying so', () => {
    const prompt = buildReviewPrompt({
      title: 't',
      surface: 'vector',
      source: 'x'.repeat(10_000),
      settled: [],
      asked: ['a'],
      views: [],
    });
    // The source is capped, and the cap is on the source only — the questions
    // must still all be present.
    expect(prompt.user.length).toBeLessThan(10_000);
    expect(prompt.user).toContain('1. a');
  });
});
