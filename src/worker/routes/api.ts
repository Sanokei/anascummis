import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import type { ConsentState, Identity } from '@shared/types';
import { CONSENT_POLICY_VERSION } from '@shared/types';
import { resolveIdentity, csrfToken, verifyCsrf } from '../auth/session';
import { availableProviders } from '../auth/oauth';
import { Orchestrator } from '../orchestrator';
import { SessionClient } from '../do/session-coordinator';
import { MemoryManager } from '../memory/manager';
import { CheckpointStore } from '../memory/checkpoints';
import { buildRegistry } from '../registry/natives';
import { SkillHarness } from '../skills/harness';
import { SkillCatalog } from '../skills/catalog';
import { ensureBundledSkills } from '../skills/seed';
import { listStories, requiredCapabilities } from '../stories/registry';
import { resolveRoute } from '../providers/model';
import { transcriptionRoute, transcribe, buildVocabularyHint, shouldSuppressChunk } from '../providers/transcribe';
import { visionRoute } from '../providers/vision';
import { VisionMemoryStore } from '../memory/vision-store';
import { sha256Hex, randomId } from '../crypto';
import { attachmentMetaKey } from '../registry/vision-natives';
import { ownerFor } from '../skills/catalog';
import {
  collectionContext,
  COLLECTION_DISCLOSURE,
  AUDIO_DISCLOSURE,
} from '../policy/collection';

/**
 * JSON API.
 *
 * Every state-changing route verifies CSRF and re-derives identity server-side.
 * A client-supplied identity claim is never trusted, including one arriving on
 * a delayed job result.
 */

interface Ctx {
  identity: Identity;
  csrfSecret: string;
  setCookie: string | null;
}

type AppContext = Context<{ Bindings: Env }>;

export function registerApiRoutes(app: Hono<{ Bindings: Env }>): void {
  const withIdentity = async (c: AppContext): Promise<Ctx> => {
    const resolved = await resolveIdentity(c.req.raw, c.env);
    if (resolved.setCookie) c.header('Set-Cookie', resolved.setCookie, { append: true });
    return resolved;
  };

  const guardCsrf = async (c: AppContext, ctx: Ctx): Promise<Response | null> => {
    const checked = await verifyCsrf(c.req.raw, c.env, ctx.identity.sessionId, ctx.csrfSecret);
    if (!checked.ok) return c.json({ error: checked.kind, message: checked.message }, 403);
    return null;
  };

  /* ---------------- session ---------------- */

  app.get('/api/session', async (c) => {
    const ctx = await withIdentity(c);
    const client = new SessionClient(c.env, ctx.identity.sessionId);
    const snapshot = await client.snapshot();
    const memory = new MemoryManager(c.env);

    const model = resolveRoute(c.env);
    const speech = transcriptionRoute(c.env);
    const vision = visionRoute(c.env);

    return c.json({
      identity:
        ctx.identity.kind === 'user'
          ? {
              kind: 'user',
              email: ctx.identity.email,
              displayName: ctx.identity.displayName,
              sessionId: ctx.identity.sessionId,
            }
          : { kind: 'guest', sessionId: ctx.identity.sessionId },
      csrfToken: await csrfToken(ctx.csrfSecret, ctx.identity.sessionId),
      config: await memory.loadConfig(ctx.identity),
      memoryEnabled: await memory.persistenceEnabled(ctx.identity),
      turns: snapshot.turns.slice(-30),
      jobs: snapshot.jobs,
      pendingConfirmation: snapshot.pendingConfirmation,
      generation: snapshot.generation,
      listening: snapshot.listening,
      providers: availableProviders(c.env),
      // Capability reporting is honest about what is actually configured, so
      // the interface never offers something that would fail on use.
      capabilities: {
        model: { provider: model.provider, model: model.model, reason: model.reason },
        speech: { provider: speech.provider, model: speech.model },
        vision: { provider: vision.provider, model: vision.model, reason: vision.reason },
        cloudflareConnect: Boolean(c.env.CLOUDFLARE_OAUTH_CLIENT_ID),
      },
      consent: await readConsent(c.env, ctx.identity),
      policyVersion: CONSENT_POLICY_VERSION,
    });
  });

  app.post('/api/turn', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;

    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      rawTranscript?: string;
      choiceIndex?: number;
      confirmationToken?: string;
    };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text && typeof body.choiceIndex !== 'number') {
      return c.json({ error: 'invalid-argument', message: 'Nothing was said.' }, 400);
    }
    if (text.length > 8000) {
      return c.json({ error: 'invalid-argument', message: 'That message is too long.' }, 400);
    }

    // The request signal aborts when the client disconnects, which is one of
    // the ways Stop reaches in-flight work.
    const orchestrator = new Orchestrator(c.env);
    const result = await orchestrator.handleTurn({
      identity: ctx.identity,
      text,
      ...(body.rawTranscript ? { rawTranscript: body.rawTranscript } : {}),
      ...(typeof body.choiceIndex === 'number' ? { choiceIndex: body.choiceIndex } : {}),
      ...(body.confirmationToken ? { confirmationToken: body.confirmationToken } : {}),
      signal: c.req.raw.signal,
    });

    if (!result.ok) {
      return c.json(
        { error: result.kind, message: result.message, outcomeUnknown: result.outcomeUnknown ?? false },
        statusFor(result.kind),
      );
    }
    return c.json(result.value);
  });

  /**
   * Stop. Independent of the model and of Ink: it increments the generation
   * fence in the coordinator and returns immediately.
   */
  app.post('/api/stop', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;
    const client = new SessionClient(c.env, ctx.identity.sessionId);
    const stopped = await client.stop();
    return c.json({
      stopped: true,
      generation: stopped.generation,
      // Cancellation does not claim to reverse anything already completed.
      note: 'New actions are prevented and pending work is cancelled. Anything already completed outside this session is not undone.',
    });
  });

  /* ---------------- speech ---------------- */

  app.post('/api/listening', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;
    const body = (await c.req.json().catch(() => ({}))) as { listening?: boolean };
    const client = new SessionClient(c.env, ctx.identity.sessionId);
    const state = await client.setListening(body.listening === true);
    return c.json(state);
  });

  app.post('/api/transcribe', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;

    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: 'invalid-argument', message: 'Expected multipart audio.' }, 400);

    const file = form.get('audio');
    if (!(file instanceof File)) {
      return c.json({ error: 'invalid-argument', message: 'No audio part was supplied.' }, 400);
    }
    const audio = await file.arrayBuffer();
    const chunkHash = await sha256Hex(audio);

    const client = new SessionClient(c.env, ctx.identity.sessionId);
    const { previousChunkHash } = await client.recordChunk(chunkHash);

    // Suppression is decided on capture evidence the client measured, never on
    // which words were spoken.
    const decision = shouldSuppressChunk({
      peakAmplitude: numberField(form, 'peakAmplitude', 1),
      rmsAmplitude: numberField(form, 'rmsAmplitude', 1),
      duringPlayback: form.get('duringPlayback') === 'true',
      echoDetected: form.get('echoDetected') === 'true',
      previousChunkHash,
      chunkHash,
      durationMs: numberField(form, 'durationMs', 1000),
    });
    if (decision.suppress) {
      return c.json({ suppressed: true, reason: decision.reason, text: '' });
    }

    const extraTerms = String(form.get('vocabulary') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 16);

    const result = await transcribe(c.env, {
      audio,
      mimeType: file.type || 'audio/webm',
      vocabularyHint: buildVocabularyHint(extraTerms),
      signal: c.req.raw.signal,
    });
    if (!result.ok) {
      return c.json({ error: result.kind, message: result.message }, statusFor(result.kind));
    }
    return c.json({
      suppressed: false,
      // The raw transcript is returned as its own field and kept separate from
      // whatever the orchestrator later decides it meant.
      text: result.value.text,
      rawTranscript: result.value.text,
      provider: result.value.provider,
      model: result.value.model,
      confidence: result.value.confidence,
    });
  });

  /* ---------------- images ---------------- */

  app.post('/api/attachments', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;

    const form = await c.req.formData().catch(() => null);
    const file = form?.get('image');
    if (!(file instanceof File)) {
      return c.json({ error: 'invalid-argument', message: 'No image was supplied.' }, 400);
    }
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      return c.json({ error: 'invalid-argument', message: `${file.type} is not an accepted image type.` }, 400);
    }
    if (file.size > 20 * 1024 * 1024) {
      return c.json({ error: 'invalid-argument', message: 'That image is too large.' }, 400);
    }

    const id = randomId('att').replace('att_', '');
    const ttl = Math.max(60, Number.parseInt(c.env.GUEST_RETENTION_SECONDS, 10) || 86_400);
    const bytes = await file.arrayBuffer();

    await c.env.CACHE.put(`att:${ctx.identity.sessionId}:${id}`, bytes, { expirationTtl: ttl });
    await c.env.CACHE.put(
      attachmentMetaKey(ctx.identity.sessionId, id),
      JSON.stringify({
        mimeType: file.type,
        width: Number(form?.get('width') ?? 0) || null,
        height: Number(form?.get('height') ?? 0) || null,
        origin: file.name || 'pasted image',
      }),
      { expirationTtl: ttl },
    );

    return c.json({
      attachmentId: id,
      expiresInSeconds: ttl,
      durable: false,
      note: 'Attachments live in this session only. Ask me to store one to keep it.',
    });
  });

  app.get('/api/vision/pages', async (c) => {
    const ctx = await withIdentity(c);
    const store = new VisionMemoryStore(c.env);
    const found = await store.retrieve({
      sessionId: ctx.identity.sessionId,
      userId: ctx.identity.kind === 'user' ? ctx.identity.userId : null,
      query: c.req.query('q') ?? '',
      limit: 8,
    });
    if (!found.ok) return c.json({ error: found.kind, message: found.message }, statusFor(found.kind));
    return c.json({
      retrievalMode: found.value.mode,
      generationIsVisual: store.generationIsVisual,
      pages: found.value.pages.map((p) => ({
        id: p.id,
        documentId: p.documentId,
        pageNumber: p.pageNumber,
        origin: p.origin,
        descriptor: p.descriptor.slice(0, 600),
        storedAt: p.storedAt,
      })),
    });
  });

  /* ---------------- inspection ---------------- */

  app.get('/api/capabilities', async (c) => {
    await withIdentity(c);
    const registry = buildRegistry(c.env);
    const installed = await registry.listInstalled();
    return c.json({
      capabilities: installed.map((cap) => ({
        id: cap.id,
        version: cap.version,
        title: cap.title,
        summary: cap.summary,
        kind: cap.kind,
        risk: cap.risk,
        permissions: cap.permissions,
        requiresConfirmation: cap.requiresConfirmation,
        status: cap.status,
        validation: cap.validation,
      })),
      storiesRequire: requiredCapabilities(),
    });
  });

  app.get('/api/skills', async (c) => {
    const ctx = await withIdentity(c);
    const registry = buildRegistry(c.env);
    const harness = new SkillHarness(c.env, registry);
    // Idempotent, and keyed on content hash, so a redeploy that changed
    // nothing writes nothing.
    await ensureBundledSkills(c.env);
    const catalog = new SkillCatalog(c.env);
    const collection = await collectionContext(c.env, ctx.identity);
    return c.json({
      // Only the global tier plus this caller's own, never anybody else's.
      skills: await catalog.list(ownerFor(ctx.identity), true),
      recentRuns: await harness.runHistory(ctx.identity, 20),
      optionalCollection: {
        enabled: collection.optionalConsented,
        note: collection.optionalConsented
          ? 'Usage records are being kept. Switching this off deletes them.'
          : 'Usage records are not being kept, so this list stays empty.',
      },
    });
  });

  app.get('/api/stories', async (c) => {
    await withIdentity(c);
    return c.json({
      stories: listStories().map((s) => ({
        id: s.id,
        version: s.version,
        entryKnot: s.entryKnot,
        externals: s.externals,
        compiledBytes: s.compiled.length,
      })),
    });
  });

  app.get('/api/branches', async (c) => {
    const ctx = await withIdentity(c);
    const store = new CheckpointStore(c.env);
    return c.json({ branches: await store.listBranches(ctx.identity) });
  });

  app.get('/api/receipts', async (c) => {
    const ctx = await withIdentity(c);
    const rows = await c.env.DB.prepare(
      `SELECT id, capability_id, capability_version, outcome, intent_at, outcome_at, summary
       FROM action_receipts WHERE session_id = ? ORDER BY intent_at DESC LIMIT 50`,
    )
      .bind(ctx.identity.sessionId)
      .all<Record<string, unknown>>();
    return c.json({ receipts: rows.results ?? [] });
  });

  /* ---------------- settings, memory, consent ---------------- */

  app.post('/api/settings', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;
    const memory = new MemoryManager(c.env);
    const patch = await c.req.json().catch(() => ({}));
    const saved = await memory.saveConfig(ctx.identity, patch);
    if (!saved.ok) return c.json({ error: saved.kind, message: saved.message }, statusFor(saved.kind));
    return c.json({ config: saved.value });
  });

  app.post('/api/memory/persistence', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    const memory = new MemoryManager(c.env);
    const set = await memory.setPersistence(ctx.identity, body.enabled === true);
    if (!set.ok) return c.json({ error: set.kind, message: set.message }, statusFor(set.kind));
    return c.json({ enabled: set.value });
  });

  app.get('/api/memory/export', async (c) => {
    const ctx = await withIdentity(c);
    const memory = new MemoryManager(c.env);
    const exported = await memory.exportAll(ctx.identity);
    if (!exported.ok) {
      return c.json({ error: exported.kind, message: exported.message }, statusFor(exported.kind));
    }
    return c.json(exported.value);
  });

  app.post('/api/memory/delete', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;
    const memory = new MemoryManager(c.env);
    const deleted = await memory.deleteAll(ctx.identity);
    if (!deleted.ok) {
      return c.json({ error: deleted.kind, message: deleted.message }, statusFor(deleted.kind));
    }
    return c.json({
      removed: deleted.value,
      note: 'Deleted memories are gone. This does not undo anything already done outside this app.',
    });
  });

  /**
   * What this deployment actually stores, read from the same table the
   * enforcement uses. The policy page renders this rather than restating it,
   * so the two cannot drift apart.
   */
  app.get('/api/collection', async (c) => {
    const ctx = await withIdentity(c);
    const collection = await collectionContext(c.env, ctx.identity);
    return c.json({
      categories: COLLECTION_DISCLOSURE,
      audio: AUDIO_DISCLOSURE,
      current: {
        identity: ctx.identity.kind,
        optionalCollection: collection.optionalConsented,
        conversationStorage: collection.persistenceEnabled,
      },
      policyVersion: CONSENT_POLICY_VERSION,
    });
  });

  app.post('/api/consent', async (c) => {
    const ctx = await withIdentity(c);
    const blocked = await guardCsrf(c, ctx);
    if (blocked) return blocked;
    const body = (await c.req.json().catch(() => ({}))) as { analytics?: boolean };
    const consent: ConsentState = {
      necessary: true,
      analytics: body.analytics === true,
      decidedAt: new Date().toISOString(),
      policyVersion: CONSENT_POLICY_VERSION,
    };
    // Consent storage stays minimal and is keyed by the session, so it cannot
    // become a guest fingerprint.
    await c.env.DB.prepare(
      `INSERT INTO consent_records (subject_id, analytics, policy_version, decided_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(subject_id) DO UPDATE SET analytics = excluded.analytics,
         policy_version = excluded.policy_version, decided_at = excluded.decided_at`,
    )
      .bind(consentSubject(ctx.identity), consent.analytics ? 1 : 0, consent.policyVersion, consent.decidedAt)
      .run();

    // Withdrawing consent removes what was collected under it. Stopping future
    // collection while keeping the old records would not be a withdrawal.
    let removed = 0;
    if (!consent.analytics) {
      const harness = new SkillHarness(c.env, buildRegistry(c.env));
      removed = await harness.purgeOptionalRecords(ctx.identity);
    }
    return c.json({
      consent,
      removedRecords: removed,
      note: consent.analytics
        ? 'Usage records will be kept until you switch this off.'
        : 'Optional collection is off and any records kept under it have been deleted.',
    });
  });
}

async function readConsent(env: Env, identity: Identity): Promise<ConsentState> {
  const row = await env.DB.prepare(
    'SELECT analytics, policy_version, decided_at FROM consent_records WHERE subject_id = ?',
  )
    .bind(consentSubject(identity))
    .first<{ analytics: number; policy_version: string; decided_at: string }>();
  if (!row) {
    return { necessary: true, analytics: false, decidedAt: null, policyVersion: CONSENT_POLICY_VERSION };
  }
  return {
    necessary: true,
    analytics: row.analytics === 1,
    decidedAt: row.decided_at,
    policyVersion: row.policy_version,
  };
}

function consentSubject(identity: Identity): string {
  return identity.kind === 'user' ? `user:${identity.userId}` : `session:${identity.sessionId}`;
}

function numberField(form: FormData, name: string, fallback: number): number {
  const raw = form.get(name);
  const parsed = typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** HTTP status per failure kind, so a client can tell the conditions apart. */
export function statusFor(kind: string): 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 504 {
  switch (kind) {
    case 'invalid-argument':
      return 400;
    case 'not-authorised':
      return 403;
    case 'missing-capability':
    case 'missing-skill':
      return 404;
    case 'revoked':
    case 'contract-mismatch':
      return 409;
    case 'missing-credential':
    case 'missing-permission':
    case 'unsupported-runtime':
      return 422;
    case 'budget-exhausted':
      return 429;
    case 'timeout':
      return 504;
    case 'upstream-error':
      return 502;
    default:
      return 500;
  }
}
