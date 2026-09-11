import type { CapabilityContract, JsonSchema } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { NativeContext, NativeHandler } from './registry';
import { captureScreenshot, screenshotRoute } from '../providers/screenshot';
import { visionRoute } from '../providers/vision';
import type { Env } from '../env';
import { isSafeSvg, rasterWrapHtml } from '../design/svg';
import { checkVocabulary } from '../design/checks';
import { DesignWorkspace } from '../design/workspace';
import { MAX_ROUNDS_PER_DESIGN_LAB } from '../design/types';
import { REVIEW_CAVEAT } from '../design/types';

/**
 * Design capabilities: author a picture as source, and have it checked.
 *
 * These differ from the older `lab.*` contracts in a way that matters. A lab
 * asks a model whether a generated image looks right; the model's answer *is*
 * the review, and the caveat travels with it. Here the artifact is a program —
 * SVG text or a scene description — so most criteria can be settled by
 * arithmetic over the source instead of by an opinion about a picture. The
 * model is asked only about what the arithmetic could not reach, and its answer
 * is recorded in a field of its own that says so.
 *
 * Two rules are inherited from the vision and lab natives and hold here too:
 *
 *   - **Image bytes never cross the Lua boundary.** These return verdicts,
 *     counts and storage *keys*. The bytes stay host-side and are fetched
 *     through the session-bounded byte route.
 *
 *   - **Nothing here gates on a review.** A verdict that says "not met" sends
 *     the author back to revise; it does not authorise or block any other
 *     capability. `allVerified` is a report, not a permission.
 */

const VERSION = '1.0.0';

function designContract(input: {
  id: string;
  title: string;
  summary: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: CapabilityContract['permissions'];
  risk: CapabilityContract['risk'];
  idempotent: boolean;
  timeoutMs: number;
  hostCalls: number;
  requiresConfirmation?: boolean;
}): CapabilityContract {
  return {
    id: input.id,
    version: VERSION,
    sourceHash: `native:${input.id}@${VERSION}`,
    kind: 'native',
    title: input.title,
    summary: input.summary,
    owner: 'host',
    workspaceScope: 'session',
    input: input.inputSchema,
    output: input.outputSchema,
    permissions: input.permissions,
    risk: input.risk,
    requiresConfirmation: input.requiresConfirmation ?? false,
    budget: {
      timeoutMs: input.timeoutMs,
      instructionLimit: 0,
      outputBytes: 96 * 1024,
      hostCalls: input.hostCalls,
    },
    idempotent: input.idempotent,
    cancellable: true,
    validation: {
      validatedAt: '2026-09-10T00:00:00.000Z',
      validator: 'host-seed@1',
      checks: [
        { name: 'host-authored', passed: true },
        { name: 'no-image-bytes-cross-sandbox', passed: true },
        { name: 'verdicts-carry-their-own-basis', passed: true },
      ],
      passed: true,
    },
    status: 'installed',
    installedAt: '2026-09-10T00:00:00.000Z',
  };
}

/** The shared shape of a criterion verdict, as it crosses to a caller. */
const VERDICT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    criterion: { type: 'string' },
    // The field that matters most. `deterministic` means a host check settled it
    // against a measurement; `opinion-only` means a model did, and carries no
    // authority; `unverifiable` means nobody could.
    basis: { type: 'string', enum: ['deterministic', 'opinion-only', 'unverifiable'] },
    outcome: { type: 'string', enum: ['met', 'not-met', 'unverifiable'] },
    evidence: { type: 'string' },
    // Set when a model disagreed with a check. The check stands; this records
    // that somebody could see it the other way.
    conflict: { type: 'string' },
  },
};

/* ------------------------------------------------------------------ */
/* design.open                                                         */
/* ------------------------------------------------------------------ */

const designOpenHandler: NativeHandler = {
  contract: designContract({
    id: 'design.open',
    title: 'Open a design lab',
    summary:
      'Starts a lab for a drawing or a 3D scene, with the acceptance criteria the work is judged against. Most criteria are then settled by a host check, not by a model.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200, description: 'What the work is meant to be.' },
        surface: {
          type: 'string',
          enum: ['vector', 'scene'],
          description: 'vector: an SVG drawing. scene: a 3D assembly, exported as a GLB mesh.',
        },
        criteria: {
          // No maxItems in the schema vocabulary, so the cap is enforced in the
          // workspace, which trims to twelve and says so by returning what it
          // kept rather than silently accepting the rest.
          type: 'array',
          items: { type: 'string', maxLength: 400 },
          description:
            'Checkable statements. Prefer ones a machine can settle — counts, names, positions, palette. A subjective one is allowed and will be reviewed as an opinion.',
        },
      },
      required: ['title', 'surface', 'criteria'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        labId: { type: 'string' },
        surface: { type: 'string' },
        criteria: { type: 'array', items: { type: 'string' } },
        maxRounds: { type: 'integer' },
        vocabulary: {
          type: 'object',
          description:
            'What a criterion can be written in on this surface, and what no check can settle.',
        },
        renderer: {
          type: 'object',
          description:
            'Whether this surface can produce a render here, so an author knows before writing whether pixel criteria will be verifiable.',
        },
        caveat: { type: 'string' },
      },
    },
    permissions: ['workspace.write'],
    risk: 'none',
    idempotent: false,
    timeoutMs: 10_000,
    hostCalls: 1,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    // A wrong surface does not fail loudly on its own: it silently changes which
    // criteria compile and which coordinate convention applies. So garbage is
    // refused rather than defaulted, because a default here is a wrong answer
    // that looks like a right one.
    const surface = ctx.args.surface;
    if (surface !== 'vector' && surface !== 'scene') {
      return fail(
        'invalid-argument',
        'surface must be "vector" (an SVG drawing) or "scene" (a 3D assembly).',
      );
    }

    const criteria = Array.isArray(ctx.args.criteria) ? ctx.args.criteria.map(String) : [];
    const workspace = new DesignWorkspace(ctx.env);
    const lab = await workspace.create(ctx.identity, {
      title: String(ctx.args.title ?? ''),
      surface,
      criteria,
    });
    if (!lab.ok) return lab;

    return ok({
      labId: lab.value.id,
      surface: lab.value.surface,
      criteria: lab.value.criteria,
      maxRounds: MAX_ROUNDS_PER_DESIGN_LAB,
      // Returned here rather than left in documentation, because it is derived
      // from the same tables the compiler uses. An author reading it cannot be
      // told to write a criterion that the next `design.submit` would refuse.
      vocabulary: checkVocabulary(lab.value.surface),
      renderer: rendererFor(ctx.env, lab.value.surface),
      caveat: REVIEW_CAVEAT,
    });
  },
};

/* ------------------------------------------------------------------ */
/* design.submit                                                       */
/* ------------------------------------------------------------------ */

const designSubmitHandler: NativeHandler = {
  contract: designContract({
    id: 'design.submit',
    title: 'Submit a revision for checking',
    summary:
      'Parses the source, measures it, renders it, settles every criterion a host check can settle, and asks a vision model only about the rest. Records the revision.',
    inputSchema: {
      type: 'object',
      properties: {
        labId: { type: 'string', maxLength: 80 },
        source: {
          type: 'string',
          maxLength: 400_000,
          description:
            'SVG source for a vector lab, or a scene program for a scene lab. This text is the artifact; the picture is derived from it.',
        },
        note: { type: 'string', maxLength: 500, description: 'What changed since the last round.' },
      },
      required: ['labId', 'source'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        revisionId: { type: 'string' },
        round: { type: 'integer' },
        maxRounds: { type: 'integer' },
        allVerified: {
          type: 'boolean',
          description:
            'True only when every criterion was settled met by a host check. Never true on the strength of an opinion.',
        },
        verdicts: { type: 'array', items: VERDICT_SCHEMA },
        counts: { type: 'object' },
        refused: { type: 'array', items: { type: 'object' } },
        issues: { type: 'array', items: { type: 'object' } },
        otherObservations: { type: 'array', items: { type: 'string' } },
        renderKeys: { type: 'object' },
        glbKey: { type: 'string' },
        unrendered: { type: 'string' },
        reviewedBy: { type: 'string' },
        caveat: { type: 'string' },
      },
    },
    permissions: ['workspace.write'],
    // Low, not none: it may call a vision model, whose answer is an opinion and
    // is labelled as one. It touches no file, no credential, and no other
    // session's work.
    risk: 'low',
    // Two identical submissions are two rounds against the round budget, and the
    // second costs a render and possibly a vision call.
    idempotent: false,
    // A browser render takes up to 20s and a vision call can take a minute on a
    // dense picture; both can happen in one dispatch.
    timeoutMs: 150_000,
    hostCalls: 2,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const workspace = new DesignWorkspace(ctx.env);
    const lab = await workspace.load(ctx.identity, String(ctx.args.labId ?? ''));
    if (!lab.ok) return lab;

    // A submission that will reach a provider is charged. A vector lab with no
    // browser configured never reaches one, so charging there would spend budget
    // on a dispatch that made no outbound request.
    const willRender = lab.value.surface === 'vector';
    if (willRender) {
      const charged = ctx.chargeExternal();
      if (!charged.ok) return charged;
    }

    const submitted = await workspace.submit(ctx.identity, {
      lab: lab.value,
      source: String(ctx.args.source ?? ''),
      ...(typeof ctx.args.note === 'string' ? { note: ctx.args.note } : {}),
      signal: ctx.signal,
      rasteriseSvg: async (source, width, height) => rasterise(ctx, source, width, height),
    });
    if (!submitted.ok) return submitted;

    const { review, revision, renders, glb, issues, unrendered } = submitted.value;
    return ok({
      revisionId: revision.id,
      round: lab.value.rounds + 1,
      maxRounds: MAX_ROUNDS_PER_DESIGN_LAB,
      allVerified: review.allVerified,
      verdicts: review.verdicts.map((verdict) => ({
        criterion: verdict.criterion,
        basis: verdict.basis,
        outcome: verdict.outcome,
        evidence: verdict.verified?.evidence ?? verdict.opinion?.evidence ?? '',
        ...(verdict.conflict ? { conflict: verdict.conflict } : {}),
      })),
      counts: review.counts,
      refused: review.refused.map((refusal) => ({
        criterion: refusal.criterion,
        reason: refusal.reason,
      })),
      issues: issues.slice(0, 40),
      otherObservations: review.otherObservations,
      renderKeys: renders,
      ...(glb ? { glbKey: glb } : {}),
      ...(unrendered ? { unrendered } : {}),
      ...(review.reviewedBy ? { reviewedBy: review.reviewedBy } : {}),
      caveat: review.caveat,
    });
  },
};

/**
 * Rasterises authored SVG through Browser Rendering.
 *
 * The safety gate is here rather than in the workspace because *this* is the
 * boundary being defended — the browser. Source that does not pass the safe
 * subset is never handed to a renderer, whatever a caller believes about it.
 * The refusal is a failure the round records, not a silent blank: no pixels
 * means the pixel criteria come back unverifiable, which is the honest answer.
 */
async function rasterise(
  ctx: NativeContext,
  source: string,
  width: number,
  height: number,
): Promise<Result<Uint8Array>> {
  const safe = isSafeSvg(source);
  if (!safe.ok) return safe;

  const shot = await captureScreenshot(ctx.env, {
    // The wrapper escapes the source rather than interpolating it into a page,
    // so a `</body>` in the text cannot end the document early.
    html: rasterWrapHtml(source, width, height),
    width,
    height,
  });
  if (!shot.ok) return shot;
  return ok(new Uint8Array(shot.value.bytes));
}

/* ------------------------------------------------------------------ */
/* design.read                                                         */
/* ------------------------------------------------------------------ */

/** How much source a read returns before it says it truncated. */
const READ_SOURCE_CAP = 32 * 1024;

const designReadHandler: NativeHandler = {
  contract: designContract({
    id: 'design.read',
    title: 'Read a design lab',
    summary:
      'Returns the authored source of a revision and the verdicts recorded for it, including every criterion that was refused or left unverifiable.',
    inputSchema: {
      type: 'object',
      properties: {
        labId: { type: 'string', maxLength: 80 },
        revisionId: {
          type: 'string',
          maxLength: 80,
          description: 'A specific revision. Omit for the most recent one.',
        },
      },
      required: ['labId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        labId: { type: 'string' },
        title: { type: 'string' },
        surface: { type: 'string' },
        criteria: { type: 'array', items: { type: 'string' } },
        rounds: { type: 'integer' },
        state: { type: 'string' },
        revisionId: { type: 'string' },
        source: { type: 'string' },
        truncated: { type: 'boolean' },
        verdicts: { type: 'array', items: VERDICT_SCHEMA },
        counts: { type: 'object' },
        refused: { type: 'array', items: { type: 'object' } },
        issues: { type: 'array', items: { type: 'object' } },
        unrendered: { type: 'string' },
        caveat: { type: 'string' },
      },
    },
    permissions: ['workspace.read'],
    risk: 'none',
    idempotent: true,
    timeoutMs: 10_000,
    hostCalls: 1,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const workspace = new DesignWorkspace(ctx.env);
    const lab = await workspace.load(ctx.identity, String(ctx.args.labId ?? ''));
    if (!lab.ok) return lab;

    const history = await workspace.history(ctx.identity, lab.value.id);
    const wantedId = typeof ctx.args.revisionId === 'string' ? ctx.args.revisionId : null;
    const row = wantedId
      ? history.find((entry) => String(entry.id) === wantedId)
      : history[history.length - 1];

    if (!row) {
      return ok({
        labId: lab.value.id,
        title: lab.value.title,
        surface: lab.value.surface,
        criteria: lab.value.criteria,
        rounds: lab.value.rounds,
        state: lab.value.state,
        note:
          history.length === 0
            ? 'Nothing has been submitted to this lab yet.'
            : 'No revision with that id in this lab.',
        caveat: REVIEW_CAVEAT,
      });
    }

    const read = await workspace.source(ctx.identity, lab.value.id, String(row.id));
    if (!read.ok) return read;

    // The source is the artifact and is returned so an author can revise it, but
    // it is capped: a caller that wants all of it should take it from the byte
    // route rather than push a megabyte through the Lua boundary.
    const source = read.value.source;
    const truncated = source.length > READ_SOURCE_CAP;

    return ok({
      labId: lab.value.id,
      title: lab.value.title,
      surface: lab.value.surface,
      criteria: lab.value.criteria,
      rounds: lab.value.rounds,
      state: lab.value.state,
      revisionId: String(row.id),
      source: truncated ? source.slice(0, READ_SOURCE_CAP) : source,
      truncated,
      verdicts: parseJsonArray(row.verdicts),
      counts: parseJsonObject(row.counts),
      refused: parseJsonArray(row.refused),
      issues: parseJsonArray(row.issues),
      ...(typeof row.render_key === 'string' ? { renderKey: row.render_key } : {}),
      caveat: REVIEW_CAVEAT,
    });
  },
};

/* ------------------------------------------------------------------ */
/* design.close                                                        */
/* ------------------------------------------------------------------ */

const designCloseHandler: NativeHandler = {
  contract: designContract({
    id: 'design.close',
    title: 'Close a design lab',
    summary:
      'Ends the lab with a summary of what was settled and what is still unresolved. A closed lab takes no further revisions.',
    inputSchema: {
      type: 'object',
      properties: {
        labId: { type: 'string', maxLength: 80 },
        summary: {
          type: 'string',
          maxLength: 2000,
          description: 'What was settled, and what is still unresolved.',
        },
      },
      required: ['labId', 'summary'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { labId: { type: 'string' }, state: { type: 'string' }, rounds: { type: 'integer' } },
    },
    permissions: ['workspace.write'],
    risk: 'none',
    idempotent: true,
    timeoutMs: 10_000,
    hostCalls: 1,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const workspace = new DesignWorkspace(ctx.env);
    const closed = await workspace.close(
      ctx.identity,
      String(ctx.args.labId ?? ''),
      String(ctx.args.summary ?? ''),
    );
    if (!closed.ok) return closed;
    return ok({ labId: closed.value.id, state: closed.value.state, rounds: closed.value.rounds });
  },
};

/* ------------------------------------------------------------------ */

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Whether a surface can be rendered here, and why not when it cannot.
 *
 * The two surfaces have genuinely different dependencies, so they are reported
 * separately. Collapsing them into one "design available" flag would either
 * promise a drawing renderer that is not configured, or hide the 3D path that
 * needs no provider at all.
 */
function rendererFor(env: Env, surface: 'vector' | 'scene'): { available: boolean; reason: string } {
  if (surface === 'scene') {
    return {
      available: true,
      reason:
        'The scene is compiled to a mesh and rasterised inside the Worker, so it needs no provider.',
    };
  }
  const route = screenshotRoute(env);
  return {
    available: route.available,
    reason: route.available
      ? 'A drawing is rasterised by Browser Rendering.'
      : `${route.reason} Source criteria still run; pixel criteria will be unverifiable.`,
  };
}

/** What the interface needs to describe design work honestly, per surface. */
export function designAvailability(env: Env) {
  const vision = visionRoute(env);
  return {
    vector: rendererFor(env, 'vector'),
    scene: rendererFor(env, 'scene'),
    // Reviewing needs the multimodal route, reported from the same function the
    // review path calls, so the interface cannot offer a review that would fail.
    review: { available: vision.provider !== 'none', model: vision.model, reason: vision.reason },
    maxRounds: MAX_ROUNDS_PER_DESIGN_LAB,
  };
}

/**
 * Design labs.
 *
 * Four contracts rather than one "do a design" call, so each passes the
 * dispatcher's gate on its own: reading a lab costs nothing and needs no
 * charge, while submitting one may spend a browser render and a vision call.
 * Folding them together would make the cheap read pay the expensive one's price.
 */
export const DESIGN_NATIVES: NativeHandler[] = [
  designOpenHandler,
  designSubmitHandler,
  designReadHandler,
  designCloseHandler,
];
