/**
 * The two-track verdict.
 *
 * A criterion is settled by a host check or it is not. Where it is, the answer is
 * arithmetic over the source or the rendered pixels and it is recorded as
 * `deterministic`. Where it is not, a vision model may be asked for a view, and
 * that view is recorded as `opinion-only` — an answer with no authority behind
 * it, kept in a field of its own so it can never be mistaken for the other.
 *
 * The rules this file enforces, in order of how much they matter:
 *
 *   1. **A model's opinion never overturns a host check.** If the check says the
 *      shade is below the post and the model says it is above, the check stands
 *      and the disagreement is preserved in `conflict`. A model describing a
 *      picture cannot overrule an arithmetic fact about the source.
 *
 *   2. **Silence is not approval.** A criterion nobody answered is
 *      `unverifiable`. It is never `met`.
 *
 *   3. **The counts cannot be reduced to a boolean.** `allVerified` is true only
 *      when every criterion was settled met by a host check, and the separate
 *      tallies are there so a caller that wants a percentage has to decide which
 *      number it is actually reporting.
 */

import { ok, type Result } from '@shared/types';
import type {
  CheckRefusal,
  CriterionVerdict,
  DesignReview,
  OpinionFinding,
  Outcome,
  Surface,
  VerdictBasis,
} from './types';
import { REVIEW_CAVEAT } from './types';
import { runChecks, type Measures } from './checks';

/** What a vision model returned about the criteria it was asked about. */
export interface ModelOpinions {
  findings: { criterion: string; outcome: Outcome; evidence: string }[];
  otherObservations: string[];
  /** The model that answered, named so every opinion is attributable. */
  reviewedBy: string;
}

/** A criterion a host check already decided, passed along as context. */
export interface SettledFinding {
  criterion: string;
  outcome: string;
  evidence: string;
}

export interface ReviewInput {
  revisionId: string;
  surface: Surface;
  criteria: string[];
  measures: Measures;
  /**
   * Asked only about the criteria the host did not pass. The settled findings
   * are handed over as well so the prompt can show the model what has already
   * been decided — not to relitigate, but so its answers have the context of
   * what was measured.
   *
   * Supplied by the caller so this module stays free of providers, and so a
   * test can hand it a scripted answer instead of a network call.
   */
  askModel: (
    criteria: string[],
    settled: SettledFinding[],
    signal?: AbortSignal,
  ) => Promise<Result<ModelOpinions>>;
  signal?: AbortSignal;
  /** Overrides the clock. Used by tests to get a stable timestamp. */
  now?: () => string;
}

/**
 * Runs the host checks, asks a model about whatever they could not settle, and
 * merges the two into one review where every verdict says where it came from.
 */
export async function reviewRevision(input: ReviewInput): Promise<Result<DesignReview>> {
  const run = runChecks(input.criteria, input.measures);

  const settled = new Map<string, CriterionVerdict['verified']>();
  for (const finding of run.findings) {
    settled.set(key(finding.criterion), finding);
  }

  // A model is asked about every criterion the host did not *pass* — the
  // refusals, the ones with no measurement, and the ones a check rejected.
  //
  // The asymmetry is deliberate. A criterion the host marked met needs no second
  // opinion: it is the one outcome with evidence behind it, and asking would
  // spend a call to produce an opinion that could not change it. A criterion the
  // host *rejected* is the consequential call — somebody is being sent back to
  // revise — and asking there is the only real check on the harness's own
  // power. It is also the only way `conflict` can ever be populated, and a field
  // that can never be set is a lie in the type.
  const unsettled = input.criteria.filter((criterion) => {
    const finding = settled.get(key(criterion));
    return !finding || finding.outcome !== 'met';
  });

  const settledContext: SettledFinding[] = run.findings.map((finding) => ({
    criterion: finding.criterion,
    outcome: finding.outcome,
    evidence: finding.evidence,
  }));

  let opinions: ModelOpinions | null = null;
  let unavailable: string | null = null;
  if (unsettled.length > 0) {
    const asked = await input.askModel(unsettled, settledContext, input.signal);
    // A vision provider being down must not discard the checks that did run.
    // The host verdicts are the authoritative half of this review and are
    // entirely independent of the model, so the review degrades to them and
    // records the gap loudly rather than throwing away good evidence. Every
    // criterion that was waiting on the model becomes `unverifiable`, which is
    // the safe direction to fail in.
    if (asked.ok) opinions = asked.value;
    else unavailable = asked.message;
  }

  const opinionFor = new Map<string, OpinionFinding>();
  for (const finding of opinions?.findings ?? []) {
    opinionFor.set(key(finding.criterion), {
      criterion: finding.criterion,
      outcome: finding.outcome,
      evidence: finding.evidence,
      reviewedBy: opinions?.reviewedBy ?? 'unknown',
    });
  }

  const verdicts: CriterionVerdict[] = input.criteria.map((criterion) => {
    const verified = settled.get(key(criterion)) ?? null;
    // A criterion the model simply did not answer counts as unanswered. The
    // `unsettled` list is what was asked; this is what came back.
    const opinion = opinionFor.get(key(criterion)) ?? null;
    const { outcome, basis, conflict } = resolve(verified, opinion);
    return {
      criterion,
      basis,
      outcome,
      verified,
      opinion,
      conflict,
    };
  });

  const refused: CheckRefusal[] = run.refusals;

  return ok({
    revisionId: input.revisionId,
    verdicts,
    allVerified: verdicts.every((v) => v.basis === 'deterministic' && v.outcome === 'met'),
    counts: {
      // These four are defined independently and deliberately do not partition:
      // `notMet` counts every rejection whichever track produced it, because
      // "what is wrong" is the actionable number, while `opinionOnly` counts
      // verdicts whose authority is a model's, for a caller reporting confidence.
      verifiedMet: verdicts.filter((v) => v.basis === 'deterministic' && v.outcome === 'met').length,
      notMet: verdicts.filter((v) => v.outcome === 'not-met').length,
      opinionOnly: verdicts.filter((v) => v.basis === 'opinion-only').length,
      unverifiable: verdicts.filter((v) => v.outcome === 'unverifiable').length,
    },
    otherObservations: [
      ...(unavailable
        ? [
            `No vision review was obtained: ${unavailable}. Any criterion marked "unverifiable" below was waiting only on that answer, and no check contradicted it.`,
          ]
        : []),
      ...(opinions?.otherObservations ?? []),
    ].slice(0, 10),
    refused,
    reviewedBy: opinions?.reviewedBy ?? null,
    reviewedAt: (input.now ?? (() => new Date().toISOString()))(),
    caveat: REVIEW_CAVEAT,
  });
}

function resolve(
  verified: CriterionVerdict['verified'],
  opinion: OpinionFinding | null,
): { outcome: Outcome; basis: VerdictBasis; conflict: string | null } {
  // A check that ran and decided. This is the only path to `deterministic`, and
  // the only path that can mark a criterion met with any authority.
  if (verified && verified.outcome !== 'unverifiable') {
    const conflict =
      opinion && opinion.outcome !== verified.outcome
        ? `The host check found "${verified.outcome}" (${verified.evidence}) while the vision model reported "${opinion.outcome}" (${opinion.evidence}). The check stands.`
        : null;
    return { outcome: verified.outcome, basis: 'deterministic', conflict };
  }

  // A check that ran but could not settle it — a missing measurement, say. If a
  // model answered, its view is the best available, and it is labelled as one.
  if (opinion) {
    return { outcome: opinion.outcome, basis: 'opinion-only', conflict: null };
  }

  return { outcome: 'unverifiable', basis: 'unverifiable', conflict: null };
}

/**
 * True only when a host check settled this criterion.
 *
 * Callers should ask this rather than reading `outcome`, because a criterion
 * marked `met` on an opinion is still only an opinion.
 */
export function isVerified(verdict: CriterionVerdict): boolean {
  return verdict.basis === 'deterministic' && verdict.outcome === 'met';
}

/** The criteria that were settled met on evidence, with the numbers behind each. */
export function verifiedEvidence(verdicts: CriterionVerdict[]): { criterion: string; evidence: string }[] {
  return verdicts
    .filter((v) => v.basis === 'deterministic' && v.verified !== null)
    .map((v) => ({ criterion: v.criterion, evidence: v.verified?.evidence ?? '' }));
}

/** Criteria that are still unresolved and why, for reporting rather than guessing. */
export function unresolved(verdicts: CriterionVerdict[]): { criterion: string; reason: string }[] {
  return verdicts
    .filter((v) => v.outcome !== 'met')
    .map((v) => ({
      criterion: v.criterion,
      reason:
        v.conflict ??
        v.verified?.evidence ??
        v.opinion?.evidence ??
        'No check and no review addressed this.',
    }));
}

/* ------------------------------------------------------------------ */
/* The prompt                                                          */
/* ------------------------------------------------------------------ */

export interface ReviewPrompt {
  system: string;
  user: string;
}

/**
 * Builds the prompt for the vision review.
 *
 * The model is told, in as many words, that it is being asked only about what a
 * machine could not decide, and that its answer is an opinion. Both are there to
 * stop the failure this whole design exists to prevent — an image model's
 * confident description being recorded as though it were a measurement.
 */
export function buildReviewPrompt(args: {
  title: string;
  surface: Surface;
  source: string;
  /** Criteria a host check already settled, shown so the model does not relitigate them. */
  settled: { criterion: string; outcome: string; evidence: string }[];
  /** Criteria the model is being asked about. */
  asked: string[];
  views: string[];
  note?: string;
}): ReviewPrompt {
  const system = [
    'You are looking at a rendered picture and answering questions about it that a',
    'program could not answer. Everything you say is recorded as an opinion, and a',
    'person will read it knowing that. Do not hedge, but do not assert more than the',
    'picture shows.',
    '',
    'Reply with JSON only:',
    '{"findings":[{"criterion":string,"outcome":"met"|"not-met"|"unverifiable","evidence":string}],',
    ' "otherObservations":[string]}',
    '',
    'Return one finding per question, in the order given, quoting the question text.',
    'Use "unverifiable" when the picture genuinely cannot settle it. That is the right',
    'answer far more often than it feels like. Never mark something met because it',
    'seems likely from the source, and never infer hidden geometry — you can see one',
    'side of a solid and must not claim what is behind it.',
    'In "evidence", describe what you actually see in the image. Do not restate the',
    'question back.',
    'Put real defects you notice into otherObservations even if nothing asked.',
  ].join('\n');

  const user = [
    `What this is meant to be: ${args.title}`,
    `How it was made: written by hand as ${args.surface === 'vector' ? 'SVG source' : 'a scene program'}, then rendered.`,
    args.views.length > 1 ? `You are shown ${args.views.length} views in this order: ${args.views.join(', ')}.` : '',
    args.note ? `Note from the maker: ${args.note.slice(0, 500)}` : '',
    '',
    'The source it was rendered from:',
    args.source.slice(0, 4000),
    '',
    args.settled.length > 0 ? 'Already settled by a program, listed so you do not repeat it:' : '',
    ...args.settled.map((s) => `  - ${s.criterion} => ${s.outcome} (${s.evidence})`),
    '',
    'Questions for you:',
    ...args.asked.map((c, i) => `${i + 1}. ${c}`),
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { system, user };
}

function key(criterion: string): string {
  return criterion.trim().toLowerCase();
}
