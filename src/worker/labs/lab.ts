import type { Identity } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { randomId, sha256Hex } from '../crypto';
import { visionChat, parseJsonObject, type ImagePart, type SupportedImageType } from '../providers/vision';
import { validateAgainstSchema } from '../registry/schema';
import type { JsonSchema } from '@shared/types';
import { toDataUrl } from '../memory/vision-store';

/**
 * Labs: make something, look at it, say what is wrong with it.
 *
 * A lab is a bounded workspace holding acceptance criteria and a series of
 * rounds. Each round produces an artifact, captures it as an image, and has
 * the vision model review it against the criteria.
 *
 * The single most important thing about this file: **a review verdict is the
 * model's opinion about a picture, not a test result.** The specification is
 * explicit that a model saying it approves is not validation, and reviewing
 * your own output is exactly the case where that goes wrong. So:
 *
 *   - a verdict is stored and reported as an opinion, with the model that gave
 *     it named alongside;
 *   - `passed` never gates a consequential action on its own;
 *   - a criterion the model cannot actually check from an image is returned as
 *     `unverifiable` rather than being marked met.
 *
 * What the lab genuinely provides is a cheap loop that catches obvious visual
 * defects before a person is asked to look, which is worth having as long as
 * nobody mistakes it for proof.
 */

export type ArtifactKind = 'generated-image' | 'rendered-page';

export interface LabArtifact {
  bytes: ArrayBuffer;
  mimeType: SupportedImageType;
  kind: ArtifactKind;
  /** What produced it: a model id, or the page that was rendered. */
  producedBy: string;
  /** The prompt or HTML that produced it, for a reviewer to judge against. */
  inputSummary: string;
  width: number | null;
  height: number | null;
}

export type CriterionOutcome = 'met' | 'not-met' | 'unverifiable';

export interface CriterionFinding {
  criterion: string;
  outcome: CriterionOutcome;
  /** What in the image led to that call. */
  evidence: string;
}

export interface LabReview {
  roundId: string;
  findings: CriterionFinding[];
  /** True only when every criterion came back `met`. Still an opinion. */
  allMet: boolean;
  /** Free-text defects the model noticed that no criterion asked about. */
  otherObservations: string[];
  reviewedBy: string;
  reviewedAt: string;
  /** Always present. The interface renders it next to any verdict. */
  caveat: string;
}

export const REVIEW_CAVEAT =
  'This is a vision model describing an image it was shown, not a test result. It can miss defects and can report ones that are not there. Treat it as a first look, not as evidence that the work is correct.';

const REVIEW_SCHEMA: JsonSchema = {
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

export interface Lab {
  id: string;
  sessionId: string;
  userId: string | null;
  title: string;
  criteria: string[];
  state: 'open' | 'closed';
  rounds: number;
  createdAt: string;
}

/** A lab cannot iterate forever; the host budget still bounds the enclosing task. */
export const MAX_ROUNDS_PER_LAB = 5;

export class LabWorkspace {
  constructor(private readonly env: Env) {}

  async create(
    identity: Identity,
    input: { title: string; criteria: string[] },
  ): Promise<Result<Lab>> {
    const criteria = input.criteria
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, 12);
    if (criteria.length === 0) {
      return fail(
        'invalid-argument',
        'A lab needs at least one acceptance criterion. Without one there is nothing to review against, and the review becomes an opinion about whether the picture is nice.',
      );
    }

    const lab: Lab = {
      id: randomId('lab'),
      sessionId: identity.sessionId,
      userId: identity.kind === 'user' ? identity.userId : null,
      title: input.title.slice(0, 200),
      criteria,
      state: 'open',
      rounds: 0,
      createdAt: new Date().toISOString(),
    };

    await this.env.DB.prepare(
      `INSERT INTO labs (id, session_id, user_id, title, criteria, state, rounds, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', 0, ?)`,
    )
      .bind(lab.id, lab.sessionId, lab.userId, lab.title, JSON.stringify(criteria), lab.createdAt)
      .run();

    return ok(lab);
  }

  async load(identity: Identity, labId: string): Promise<Result<Lab>> {
    const row = await this.env.DB.prepare('SELECT * FROM labs WHERE id = ? AND session_id = ?')
      .bind(labId, identity.sessionId)
      .first<Record<string, unknown>>();
    if (!row) return fail('missing-capability', 'No lab with that id in this session.');
    return ok({
      id: String(row.id),
      sessionId: String(row.session_id),
      userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
      title: String(row.title),
      criteria: parseArray(row.criteria),
      state: row.state === 'closed' ? 'closed' : 'open',
      rounds: Number(row.rounds ?? 0),
      createdAt: String(row.created_at),
    });
  }

  /**
   * Stores an artifact and has the model look at it.
   *
   * The artifact is kept whether the review passes or fails, because a failed
   * round is the useful record: it says what was wrong and what was changed.
   */
  async review(
    identity: Identity,
    input: { lab: Lab; artifact: LabArtifact; note?: string; signal?: AbortSignal },
  ): Promise<Result<LabReview>> {
    const { lab, artifact } = input;
    if (lab.state === 'closed') return fail('not-authorised', 'That lab is closed.');
    if (lab.rounds >= MAX_ROUNDS_PER_LAB) {
      return fail(
        'budget-exhausted',
        `This lab has used its ${MAX_ROUNDS_PER_LAB} rounds. Close it and say what is still unresolved rather than iterating further.`,
      );
    }

    const roundId = randomId('round');
    const objectKey = `lab/${lab.id}/${roundId}`;
    const stored = await this.storeArtifact(objectKey, artifact, lab.userId !== null);
    if (!stored.ok) return stored;

    const part: ImagePart = {
      kind: 'image',
      source: { type: 'data-url', dataUrl: toDataUrl(artifact.bytes, artifact.mimeType) },
      mimeType: artifact.mimeType,
      byteLength: artifact.bytes.byteLength,
      ...(artifact.width !== null ? { width: artifact.width } : {}),
      ...(artifact.height !== null ? { height: artifact.height } : {}),
      origin: artifact.producedBy,
    };

    const system = [
      'You are reviewing an image against a list of acceptance criteria.',
      'Reply with JSON only:',
      '{"findings":[{"criterion":string,"outcome":"met"|"not-met"|"unverifiable","evidence":string}],',
      ' "otherObservations":[string]}',
      '',
      'Return one finding per criterion, in the order given, quoting the criterion text.',
      'Use "unverifiable" when the image genuinely cannot settle it. That is the right',
      'answer for anything about behaviour, timing, data correctness, or what happens',
      'off-screen. Do not mark a criterion met because it seems likely.',
      'In "evidence", say what you actually see. Do not restate the criterion back.',
      'Put real defects you notice in otherObservations even if no criterion asked.',
    ].join('\n');

    const user = [
      `What this is meant to be: ${lab.title}`,
      `How it was produced: ${artifact.producedBy}`,
      `Input that produced it: ${artifact.inputSummary.slice(0, 1200)}`,
      input.note ? `Note from the maker: ${input.note.slice(0, 500)}` : '',
      '',
      'Acceptance criteria:',
      ...lab.criteria.map((c, i) => `${i + 1}. ${c}`),
    ]
      .filter(Boolean)
      .join('\n');

    const res = await visionChat(this.env, {
      messages: [
        { role: 'system', parts: [{ kind: 'text', text: system }] },
        { role: 'user', parts: [{ kind: 'text', text: user }, part] },
      ],
      json: true,
      temperature: 0,
      maxTokens: 1200,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!res.ok) return res;

    const parsed = parseJsonObject(res.value.text);
    if (!parsed.ok) return parsed;
    const shaped = validateAgainstSchema(REVIEW_SCHEMA, parsed.value);
    if (!shaped.ok) {
      return fail('contract-mismatch', `The review did not match the contract: ${shaped.message}`);
    }

    const raw = shaped.value as {
      findings: { criterion: string; outcome: CriterionOutcome; evidence?: string }[];
      otherObservations?: string[];
    };

    // A criterion the model simply did not answer is unverifiable, not met.
    // Silence must never read as approval.
    const answered = new Map(raw.findings.map((f) => [f.criterion.trim().toLowerCase(), f]));
    const findings: CriterionFinding[] = lab.criteria.map((criterion) => {
      const match = answered.get(criterion.trim().toLowerCase()) ?? raw.findings.shift();
      if (!match) {
        return {
          criterion,
          outcome: 'unverifiable',
          evidence: 'The review did not address this criterion.',
        };
      }
      return {
        criterion,
        outcome: match.outcome,
        evidence: (match.evidence ?? '').slice(0, 600),
      };
    });

    const review: LabReview = {
      roundId,
      findings,
      allMet: findings.every((f) => f.outcome === 'met'),
      otherObservations: (raw.otherObservations ?? []).slice(0, 10),
      reviewedBy: res.value.model,
      reviewedAt: new Date().toISOString(),
      caveat: REVIEW_CAVEAT,
    };

    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO lab_rounds
           (id, lab_id, session_id, artifact_key, artifact_storage, artifact_kind, mime_type,
            produced_by, input_summary, content_hash, findings, all_met, other_observations,
            reviewed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        roundId,
        lab.id,
        lab.sessionId,
        objectKey,
        stored.value,
        artifact.kind,
        artifact.mimeType,
        artifact.producedBy,
        artifact.inputSummary.slice(0, 2000),
        await sha256Hex(artifact.bytes),
        JSON.stringify(findings),
        review.allMet ? 1 : 0,
        JSON.stringify(review.otherObservations),
        review.reviewedBy,
        review.reviewedAt,
      ),
      this.env.DB.prepare('UPDATE labs SET rounds = rounds + 1 WHERE id = ?').bind(lab.id),
    ]);

    return ok(review);
  }

  async close(identity: Identity, labId: string, summary: string): Promise<Result<Lab>> {
    const loaded = await this.load(identity, labId);
    if (!loaded.ok) return loaded;
    await this.env.DB.prepare('UPDATE labs SET state = ?, summary = ? WHERE id = ?')
      .bind('closed', summary.slice(0, 2000), labId)
      .run();
    return ok({ ...loaded.value, state: 'closed' });
  }

  async rounds(identity: Identity, labId: string): Promise<Record<string, unknown>[]> {
    const rows = await this.env.DB.prepare(
      `SELECT id, artifact_kind, produced_by, all_met, findings, other_observations,
              reviewed_by, created_at
       FROM lab_rounds WHERE lab_id = ? AND session_id = ? ORDER BY created_at`,
    )
      .bind(labId, identity.sessionId)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  private async storeArtifact(
    key: string,
    artifact: LabArtifact,
    durable: boolean,
  ): Promise<Result<'r2' | 'kv'>> {
    if (this.env.VISION && durable) {
      await this.env.VISION.put(key, artifact.bytes, {
        httpMetadata: { contentType: artifact.mimeType },
      });
      return ok('r2');
    }
    if (artifact.bytes.byteLength > 24 * 1024 * 1024) {
      return fail('invalid-argument', 'That artifact is too large for the available store.');
    }
    const ttl = durable
      ? undefined
      : Math.max(60, Number.parseInt(this.env.GUEST_RETENTION_SECONDS, 10) || 86_400);
    await this.env.CACHE.put(key, artifact.bytes, ttl ? { expirationTtl: ttl } : undefined);
    return ok('kv');
  }
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
