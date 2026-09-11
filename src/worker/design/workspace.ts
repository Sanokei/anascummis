/**
 * The design lab: author a picture as source, measure it, and say what is true.
 *
 * A round here is not "generate an image and ask a model if it looks nice". It
 * is: write source, parse it as a program, measure what the program actually
 * says, render it, and then decide each acceptance criterion against a
 * measurement where one exists. The rendered picture is a *derived* thing — the
 * source is the artifact, and everything recorded about the round is something
 * that can be recomputed from it.
 *
 * Two asymmetries are worth knowing about before reading further, because they
 * are honest properties of the platforms involved rather than choices I would
 * have preferred:
 *
 *   - **A scene renders itself.** `sceneToMesh` and `renderViews` are ordinary
 *     arithmetic, so the whole 3D loop runs inside the Worker with no browser,
 *     no network, and no provider. It is fully deterministic and is covered by
 *     tests that assert pixel properties directly.
 *
 *   - **An SVG needs a browser.** There is no SVG rasteriser in workerd, so
 *     measuring a drawing's pixels depends on Cloudflare Browser Rendering being
 *     configured. When it is not, the source is still fully checked — counts,
 *     names, positions, palette — and the pixel criteria come back
 *     `unverifiable`. They do not quietly pass.
 */

import type { Identity, JsonSchema } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { randomId, sha256Hex } from '../crypto';
import { toDataUrl } from '../memory/vision-store';
import { parseJsonObject, visionChat, type ImagePart } from '../providers/vision';
import { validateAgainstSchema } from '../registry/schema';
import {
  MAX_ROUNDS_PER_DESIGN_LAB,
  type DesignLab,
  type DesignReview,
  type DesignRevision,
  type Outcome,
  type SceneGraph,
  type Surface,
  type ViewRender,
} from './types';
import type { Bounds2D } from './types';
import { elementBounds2D, parseSvg, svgDigest, validateSvg } from './svg';
import { parseScene, sceneDigest, sceneToGlb, sceneToMesh, validateScene } from './scene';
import { STANDARD_VIEWS, contactSheet, imageStats, renderViews } from './raster';
import { buildReviewPrompt, reviewRevision, type ModelOpinions } from './review';
import type { Measures, SceneMeasurements, SvgMeasurements } from './checks';

/** What a rendered round is measured against, plus anything wrong with the source. */
export interface Measurement {
  measures: Measures;
  issues: { code: string; message: string }[];
  views: ViewRender[];
  /**
   * The parsed scene, kept so the GLB can be written from it. Null for a
   * drawing, which has no third dimension to export.
   */
  graph: SceneGraph | null;
}

/**
 * Parses and measures a source, with no bindings involved.
 *
 * Pure on purpose: this is the step that decides what every criterion is checked
 * against, so it must be testable without a database, a provider, or a Worker.
 * A scene is rendered here; a vector's renders must be supplied, because
 * rasterising SVG needs a browser this process does not have.
 */
export function measureSource(
  surface: Surface,
  source: string,
  renders: ViewRender[] | null,
): Result<Measurement> {
  if (surface === 'vector') {
    const parsed = parseSvg(source);
    if (!parsed.ok) return parsed;
    const issues = validateSvg(parsed.value);
    const digest = svgDigest(parsed.value);

    // Bounds are collected for every element that carries an id, because a name
    // is what a criterion can refer to and an unnamed element cannot be
    // discussed. An element whose bounds cannot be estimated is simply absent
    // rather than given a placeholder box at the origin.
    //
    // A null prototype, because the keys are author-chosen strings. On an
    // ordinary object literal, an element with `id="__proto__"` would invoke the
    // inherited setter and replace the table's prototype instead of adding an
    // entry — so the one element the author named would be the one element a
    // criterion could never find. `counts` and `colorCounts` in svg.ts are built
    // the same way for the same reason.
    const elementBounds: Record<string, Bounds2D> = Object.create(null);
    for (const element of parsed.value.all) {
      if (!element.id) continue;
      const bounds = elementBounds2D(parsed.value, element);
      if (bounds) elementBounds[element.id] = bounds;
    }

    const svg: SvgMeasurements = { digest, elementBounds, issues };
    return ok({
      measures: {
        surface,
        svg,
        scene: null,
        pixels: renders && renders.length > 0 ? { views: toStats(renders) } : null,
      },
      issues: issues.map((issue) => ({ code: issue.code, message: issue.message })),
      views: renders ?? [],
      graph: null,
    });
  }

  const parsed = parseScene(source);
  if (!parsed.ok) return parsed;
  const issues = validateScene(parsed.value);
  const digest = sceneDigest(parsed.value);

  const parents: Record<string, string | null> = {};
  for (const part of parsed.value.parts) parents[part.name] = part.parent;

  // A cycle means the transform chain has no end, so the mesh is not built at
  // all: a walk that never terminates is worse than a round with no render, and
  // the issue is already recorded for the author to fix.
  const cyclic = issues.some((issue) => issue.code === 'cycle');
  const mesh = cyclic ? null : sceneToMesh(parsed.value);
  const views = mesh ? renderViews(mesh, STANDARD_VIEWS, { width: 512, height: 512 }) : [];

  const scene: SceneMeasurements = { digest, parents };
  return ok({
    measures: {
      surface,
      svg: null,
      scene,
      pixels: views.length > 0 ? { views: toStats(views) } : null,
    },
    issues: issues.map((issue) => ({ code: issue.code, message: issue.message })),
    views,
    graph: parsed.value,
  });
}

function toStats(views: ViewRender[]): { view: string; stats: ViewRender['stats'] }[] {
  return views.map((render) => ({ view: render.view, stats: render.stats }));
}

/* ------------------------------------------------------------------ */

export interface SubmitInput {
  lab: DesignLab;
  source: string;
  note?: string;
  signal?: AbortSignal;
  /**
   * Rasterises an authored drawing to a PNG. Supplied by the caller because it
   * needs Browser Rendering; leaving it out is normal and means the pixel
   * criteria will be unverifiable rather than met.
   */
  rasteriseSvg?: (source: string, width: number, height: number) => Promise<Result<Uint8Array>>;
}

export interface SubmitResult {
  revision: DesignRevision;
  review: DesignReview;
  /** View name to storage key, so a caller can serve the bytes. */
  renders: Record<string, string>;
  /** The exported mesh, when the source was a scene. Null for a drawing. */
  glb: string | null;
  issues: { code: string; message: string }[];
  /** Set when nothing could be rendered, naming the reason. */
  unrendered: string | null;
}

const VIEW_WIDTH = 512;
const VIEW_HEIGHT = 512;

export class DesignWorkspace {
  constructor(private readonly env: Env) {}

  async create(
    identity: Identity,
    input: { title: string; surface: Surface; criteria: string[] },
  ): Promise<Result<DesignLab>> {
    const criteria = input.criteria
      .map((criterion) => criterion.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (criteria.length === 0) {
      // Same reasoning as the older lab, and it still holds: without a criterion
      // there is nothing to check against and the round becomes a question about
      // whether the picture is nice.
      return fail(
        'invalid-argument',
        'A design lab needs at least one acceptance criterion. Without one there is nothing to check against.',
      );
    }

    const lab: DesignLab = {
      id: randomId('design'),
      sessionId: identity.sessionId,
      userId: identity.kind === 'user' ? identity.userId : null,
      title: input.title.slice(0, 200),
      surface: input.surface,
      criteria,
      state: 'open',
      rounds: 0,
      createdAt: new Date().toISOString(),
    };

    await this.env.DB.prepare(
      `INSERT INTO design_labs (id, session_id, user_id, title, surface, criteria, state, rounds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 0, ?)`,
    )
      .bind(
        lab.id,
        lab.sessionId,
        lab.userId,
        lab.title,
        lab.surface,
        JSON.stringify(lab.criteria),
        lab.createdAt,
      )
      .run();

    return ok(lab);
  }

  async load(identity: Identity, labId: string): Promise<Result<DesignLab>> {
    const row = await this.env.DB.prepare(
      'SELECT * FROM design_labs WHERE id = ? AND session_id = ?',
    )
      .bind(labId, identity.sessionId)
      .first<Record<string, unknown>>();
    if (!row) return fail('missing-capability', 'No design lab with that id in this session.');
    return ok({
      id: String(row.id),
      sessionId: String(row.session_id),
      userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
      title: String(row.title),
      surface: row.surface === 'scene' ? 'scene' : 'vector',
      criteria: parseArray(row.criteria),
      state: row.state === 'closed' ? 'closed' : 'open',
      rounds: Number(row.rounds ?? 0),
      createdAt: String(row.created_at),
    });
  }

  async history(identity: Identity, labId: string): Promise<Record<string, unknown>[]> {
    const rows = await this.env.DB.prepare(
      `SELECT id, surface, source_hash, views, verdicts, all_verified, counts, refused,
              issues, other_observations, reviewed_by, created_at
       FROM design_revisions WHERE lab_id = ? AND session_id = ? ORDER BY created_at`,
    )
      .bind(labId, identity.sessionId)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async close(identity: Identity, labId: string, summary: string): Promise<Result<DesignLab>> {
    const loaded = await this.load(identity, labId);
    if (!loaded.ok) return loaded;
    await this.env.DB.prepare('UPDATE design_labs SET state = ?, summary = ? WHERE id = ?')
      .bind('closed', summary.slice(0, 2000), labId)
      .run();
    return ok({ ...loaded.value, state: 'closed' });
  }

  /** The authored source of a revision. The artifact, verbatim. */
  async source(
    identity: Identity,
    labId: string,
    revisionId: string,
  ): Promise<Result<{ source: string; surface: Surface }>> {
    const row = await this.env.DB.prepare(
      'SELECT source, surface FROM design_revisions WHERE id = ? AND lab_id = ? AND session_id = ?',
    )
      .bind(revisionId, labId, identity.sessionId)
      .first<Record<string, unknown>>();
    if (!row) return fail('missing-capability', 'No such revision in this session.');
    return ok({
      source: String(row.source),
      surface: row.surface === 'scene' ? 'scene' : 'vector',
    });
  }

  /**
   * Measures, reviews and records one revision.
   *
   * A source that will not parse does not consume a round. A syntax error is not
   * an attempt at the drawing; charging for it would let a typo eat the budget
   * that the actual work needs.
   */
  async submit(identity: Identity, input: SubmitInput): Promise<Result<SubmitResult>> {
    const { lab } = input;
    if (lab.state === 'closed') return fail('not-authorised', 'That design lab is closed.');
    if (lab.rounds >= MAX_ROUNDS_PER_DESIGN_LAB) {
      return fail(
        'budget-exhausted',
        `This lab has used its ${MAX_ROUNDS_PER_DESIGN_LAB} rounds. Close it and say what is still unresolved rather than iterating further.`,
      );
    }

    const source = input.source;
    if (!source.trim()) return fail('invalid-argument', 'A revision needs source to measure.');

    let renders: ViewRender[] | null = null;
    let unrendered: string | null = null;

    if (lab.surface === 'vector') {
      if (input.rasteriseSvg) {
        const rasterised = await this.rasteriseSvg(input.rasteriseSvg, source);
        if (rasterised.ok) renders = [{ view: 'canvas', raster: rasterised.value, stats: imageStats(rasterised.value) }];
        else unrendered = rasterised.message;
      } else {
        unrendered =
          'No SVG rasteriser is configured, so no pixels were produced. Source checks still ran.';
      }
    }

    const measured = measureSource(lab.surface, source, renders);
    if (!measured.ok) return measured;

    const { measures, issues, views, graph } = measured.value;
    if (lab.surface === 'scene' && views.length === 0 && !unrendered) {
      unrendered = 'The scene produced no renderable geometry, so no view could be drawn.';
    }

    const review = await reviewRevision({
      revisionId: 'pending',
      surface: lab.surface,
      criteria: lab.criteria,
      measures,
      askModel: (criteria, settled, signal) =>
        this.askModel(lab, source, views, criteria, settled, signal ?? input.signal),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!review.ok) return review;

    const revisionId = randomId('rev');
    const stored = await this.store(identity, lab, revisionId, views, graph);
    if (!stored.ok) return stored;

    const revision: DesignRevision = {
      id: revisionId,
      sessionId: lab.sessionId,
      userId: lab.userId,
      surface: lab.surface,
      source,
      sourceHash: await sha256Hex(source),
      // The contact sheet when there is one, because a single image that shows
      // every view is what a person or a model actually wants to look at. It
      // falls back to a single view, and then to the mesh when the scene had no
      // renderable geometry at all.
      renderKey: stored.value.keys.sheet ?? Object.values(stored.value.keys)[0] ?? stored.value.glb,
      createdAt: new Date().toISOString(),
    };

    const finalReview: DesignReview = { ...review.value, revisionId };

    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO design_revisions
           (id, lab_id, session_id, surface, source, source_hash, render_key, render_storage,
            views, verdicts, all_verified, counts, refused, issues, other_observations,
            reviewed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        revision.id,
        lab.id,
        lab.sessionId,
        revision.surface,
        revision.source,
        revision.sourceHash,
        revision.renderKey,
        stored.value.storage,
        JSON.stringify(
          views.map((render) => ({ view: render.view, key: stored.value.keys[render.view] ?? null })),
        ),
        JSON.stringify(finalReview.verdicts),
        finalReview.allVerified ? 1 : 0,
        JSON.stringify(finalReview.counts),
        JSON.stringify(finalReview.refused),
        JSON.stringify(issues),
        JSON.stringify(finalReview.otherObservations),
        finalReview.reviewedBy,
        revision.createdAt,
      ),
      this.env.DB.prepare('UPDATE design_labs SET rounds = rounds + 1 WHERE id = ?').bind(lab.id),
    ]);

    return ok({
      revision,
      review: finalReview,
      renders: stored.value.keys,
      glb: stored.value.glb,
      issues,
      unrendered,
    });
  }

  /** Serves a stored render. Bounded to this session's own lab. */
  async renderBytes(
    identity: Identity,
    labId: string,
    key: string,
  ): Promise<Result<{ bytes: ArrayBuffer; mimeType: string }>> {
    // The key is checked against the session's own revisions rather than being
    // trusted, so a key from another session cannot be used to read its images.
    const row = await this.env.DB.prepare(
      `SELECT id, views, render_key FROM design_revisions WHERE lab_id = ? AND session_id = ?`,
    )
      .bind(labId, identity.sessionId)
      .all<Record<string, unknown>>();
    const allowed = new Set<string>();
    for (const revision of row.results ?? []) {
      for (const view of parseViewKeys(revision.views)) {
        if (view.key) allowed.add(view.key);
      }
      // The mesh is derived from the revision rather than read back from a
      // column, because the column holds a single primary key and a scene with
      // views has its contact sheet there. Deriving it from the revision id
      // keeps the exported mesh reachable in every case, not only the degenerate
      // one where nothing rendered and the mesh became the primary key.
      allowed.add(`design/${labId}/${String(revision.id)}/mesh.glb`);
      if (typeof revision.render_key === 'string') allowed.add(revision.render_key);
    }
    if (!allowed.has(key)) return fail('not-authorised', 'That render is not part of this session.');

    const mimeType = key.endsWith('.glb') ? 'model/gltf-binary' : 'image/png';
    if (this.env.VISION) {
      const object = await this.env.VISION.get(key);
      if (!object) return fail('missing-capability', 'That render is no longer stored.');
      const bytes = await object.arrayBuffer();
      return ok({ bytes, mimeType: object.httpMetadata?.contentType ?? mimeType });
    }
    const cached = await this.env.CACHE.get(key, 'arrayBuffer');
    if (!cached) return fail('missing-capability', 'That render is no longer stored.');
    return ok({ bytes: cached, mimeType });
  }

  /* ---------------------------------------------------------------- */

  private async rasteriseSvg(
    rasterise: NonNullable<SubmitInput['rasteriseSvg']>,
    source: string,
  ): Promise<Result<ViewRender['raster']>> {
    const bytes = await rasterise(source, VIEW_WIDTH, VIEW_HEIGHT);
    if (!bytes.ok) return bytes;
    // Decoding rather than trusting the dimensions: the statistics are computed
    // from what the rasteriser actually returned, not from what was asked for.
    const { decodePng } = await import('./raster');
    const decoded = await decodePng(bytes.value);
    return decoded;
  }

  private async store(
    identity: Identity,
    lab: DesignLab,
    revisionId: string,
    views: ViewRender[],
    graph: SceneGraph | null,
  ): Promise<Result<{ keys: Record<string, string>; storage: 'r2' | 'kv'; glb: string | null }>> {
    const keys: Record<string, string> = {};
    const durable = identity.kind === 'user';
    const storage: 'r2' | 'kv' = this.env.VISION && durable ? 'r2' : 'kv';
    const ttl = durable
      ? undefined
      : Math.max(60, Number.parseInt(this.env.GUEST_RETENTION_SECONDS, 10) || 86_400);

    const put = async (key: string, bytes: Uint8Array, contentType: string): Promise<Result<true>> => {
      if (storage === 'r2') {
        await this.env.VISION!.put(key, bytes, { httpMetadata: { contentType } });
        return ok(true);
      }
      if (bytes.byteLength > 24 * 1024 * 1024) {
        return fail('invalid-argument', 'That render is too large for the available store.');
      }
      await this.env.CACHE.put(key, bytes as unknown as ArrayBuffer, ttl ? { expirationTtl: ttl } : undefined);
      return ok(true);
    };

    for (const render of views) {
      const key = `design/${lab.id}/${revisionId}/${render.view}.png`;
      const written = await put(key, await encodePngFor(render), 'image/png');
      if (!written.ok) return written;
      keys[render.view] = key;
    }

    // A contact sheet is stored alongside the individual views so a single image
    // can be shown, or handed to a model, without a client having to compose one.
    if (views.length > 1) {
      const sheet = contactSheet(views);
      const key = `design/${lab.id}/${revisionId}/sheet.png`;
      const written = await put(key, await encodePngFor({ view: 'sheet', raster: sheet, stats: imageStats(sheet) }), 'image/png');
      if (!written.ok) return written;
      keys.sheet = key;
    }

    // The mesh is the 3D artifact in the form every other tool takes: a GLB a
    // viewer, a printer, or an editor can open. It is stored even when nothing
    // could be rendered, because the geometry is the deliverable and a picture
    // of it is only ever a view of it.
    let glb: string | null = null;
    if (graph) {
      const encoded = await sceneToGlb(graph);
      if (!encoded.ok) return encoded;
      glb = `design/${lab.id}/${revisionId}/mesh.glb`;
      const written = await put(glb, encoded.value, 'model/gltf-binary');
      if (!written.ok) return written;
    }

    return ok({ keys, storage, glb });
  }

  /**
   * Builds the vision call for the criteria the host could not settle.
   *
   * The model is shown the render — every view, in a stated order — and the
   * source. It is not shown the settled findings as something to confirm: they
   * are context, and its answers are recorded as opinions regardless of what it
   * says about them.
   */
  private async askModel(
    lab: DesignLab,
    source: string,
    views: ViewRender[],
    criteria: string[],
    settled: { criterion: string; outcome: string; evidence: string }[],
    signal?: AbortSignal,
  ): Promise<Result<ModelOpinions>> {
    if (views.length === 0) {
      return ok({
        findings: [],
        otherObservations: [],
        reviewedBy: 'none',
      });
    }

    const prompt = buildReviewPrompt({
      title: lab.title,
      surface: lab.surface,
      source,
      settled,
      asked: criteria,
      views: views.map((render) => render.view),
    });

    const parts: ImagePart[] = [];
    for (const render of views) {
      const bytes = await encodePngFor(render);
      parts.push({
        kind: 'image',
        source: { type: 'data-url', dataUrl: toDataUrl(bytes, 'image/png') },
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        width: render.raster.width,
        height: render.raster.height,
        origin: `design:${lab.surface}:${render.view}`,
      });
    }

    const res = await visionChat(this.env, {
      messages: [
        { role: 'system', parts: [{ kind: 'text', text: prompt.system }] },
        { role: 'user', parts: [{ kind: 'text', text: prompt.user }, ...parts] },
      ],
      json: true,
      temperature: 0,
      maxTokens: 1200,
      requestedEffort: 'high',
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return res;

    const parsed = parseJsonObject(res.value.text);
    if (!parsed.ok) return parsed;
    const shaped = validateAgainstSchema(OPINION_SCHEMA, parsed.value);
    if (!shaped.ok) {
      return fail('contract-mismatch', `The review did not match the contract: ${shaped.message}`);
    }

    const raw = shaped.value as {
      findings: { criterion: string; outcome: Outcome; evidence?: string }[];
      otherObservations?: string[];
    };

    // Matched to what was asked rather than trusting the reply's own labels, so
    // a model that answers about the wrong criterion leaves the asked one
    // unanswered instead of silently filling it in.
    const answered = new Map(raw.findings.map((f) => [f.criterion.trim().toLowerCase(), f]));
    const findings = criteria.map((criterion) => {
      const match = answered.get(criterion.trim().toLowerCase());
      if (!match) return null;
      return {
        criterion,
        outcome: match.outcome,
        evidence: (match.evidence ?? '').slice(0, 600),
      };
    });
    const answeredFindings = findings.filter((f): f is NonNullable<typeof f> => f !== null);

    return ok({
      findings: answeredFindings,
      otherObservations: (raw.otherObservations ?? []).slice(0, 10),
      reviewedBy: res.value.model,
    });
  }
}

const OPINION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string', maxLength: 400 },
          outcome: { type: 'string', enum: ['met', 'not-met', 'unverifiable'] },
          evidence: { type: 'string', maxLength: 600 },
        },
        required: ['criterion', 'outcome'],
      },
    },
    otherObservations: { type: 'array', items: { type: 'string', maxLength: 400 } },
  },
  required: ['findings'],
};

async function encodePngFor(render: ViewRender): Promise<Uint8Array> {
  const { encodePng } = await import('./raster');
  return encodePng(render.raster);
}

function parseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseViewKeys(value: unknown): { view: string; key: string | null }[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        view: String(entry.view ?? ''),
        key: entry.key === null || entry.key === undefined ? null : String(entry.key),
      }));
  } catch {
    return [];
  }
}
