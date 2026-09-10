import type { CapabilityContract, JsonSchema } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { NativeContext, NativeHandler } from './registry';
import { VisionMemoryStore } from '../memory/vision-store';
import { annotateImage, isSupportedImageType, type ImagePart } from '../providers/vision';
import { randomId } from '../crypto';

/**
 * Vision capabilities, exposed the same way every other capability is.
 *
 * These are native host adapters with registry contracts. Ink reaches them
 * through the ordinary EXTERNAL name mapping (`vision_recall` -> `vision.recall`)
 * and the Ink harness enumerates them like any other action reference, so
 * adding them changes nothing about the story or sandbox contracts.
 *
 * Images never cross the Lua boundary. A capability returns page ids,
 * descriptors and provenance; the image bytes stay host-side and only reach
 * the multimodal model from the trusted orchestrator. That is what keeps Lua
 * leaf execution and keeps a page from blowing the sandbox output ceiling.
 */

const VERSION = '1.0.0';

function visionContract(input: {
  id: string;
  title: string;
  summary: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: CapabilityContract['permissions'];
  risk: CapabilityContract['risk'];
  idempotent: boolean;
  timeoutMs: number;
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
    requiresConfirmation: false,
    budget: {
      timeoutMs: input.timeoutMs,
      instructionLimit: 0,
      // Deliberately modest: these return descriptors and ids, never image bytes.
      outputBytes: 128 * 1024,
      hostCalls: 1,
    },
    idempotent: input.idempotent,
    cancellable: true,
    validation: {
      validatedAt: '2026-09-10T00:00:00.000Z',
      validator: 'host-seed@1',
      checks: [
        { name: 'host-authored', passed: true },
        { name: 'no-image-bytes-cross-sandbox', passed: true },
      ],
      passed: true,
    },
    status: 'installed',
    installedAt: '2026-09-10T00:00:00.000Z',
  };
}

/* ------------------------------------------------------------------ */
/* vision.recall                                                       */
/* ------------------------------------------------------------------ */

const visionRecallHandler: NativeHandler = {
  contract: visionContract({
    id: 'vision.recall',
    title: 'Recall stored page images',
    summary: 'Finds stored document pages relevant to a query and returns their provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 400, description: 'What to look for.' },
        limit: { type: 'integer', minimum: 1, maximum: 8 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        // `mode` is returned so a caller can tell descriptor ranking from a
        // true page-image embedding, rather than assuming full VisRAG.
        mode: { type: 'string' },
        generationIsVisual: { type: 'boolean' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageId: { type: 'string' },
              documentId: { type: 'string' },
              pageNumber: { type: 'integer' },
              origin: { type: 'string' },
              descriptor: { type: 'string' },
            },
          },
        },
      },
    },
    permissions: ['memory.read'],
    risk: 'none',
    idempotent: true,
    timeoutMs: 15_000,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const store = new VisionMemoryStore(ctx.env);
    const res = await store.retrieve({
      sessionId: ctx.identity.sessionId,
      userId: ctx.identity.kind === 'user' ? ctx.identity.userId : null,
      query: String(ctx.args.query ?? ''),
      limit: typeof ctx.args.limit === 'number' ? ctx.args.limit : 3,
    });
    if (!res.ok) return res;
    return ok({
      mode: res.value.mode,
      generationIsVisual: store.generationIsVisual,
      pages: res.value.pages.map((page) => ({
        pageId: page.id,
        documentId: page.documentId,
        pageNumber: page.pageNumber,
        origin: page.origin,
        // Truncated: the descriptor is a retrieval aid, not the answer.
        descriptor: page.descriptor.slice(0, 1200),
      })),
    });
  },
};

/* ------------------------------------------------------------------ */
/* vision.annotate                                                     */
/* ------------------------------------------------------------------ */

const visionAnnotateHandler: NativeHandler = {
  contract: visionContract({
    id: 'vision.annotate',
    title: 'Label regions of an image',
    summary: 'Returns labelled boxes with named parameters for a stored page or an attached image.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', maxLength: 80, description: 'A page from vision.recall.' },
        attachmentId: { type: 'string', maxLength: 80, description: 'An image attached this session.' },
        instruction: { type: 'string', maxLength: 600, description: 'What kind of region to find.' },
        parameters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 60 },
              description: { type: 'string', maxLength: 200 },
              type: { type: 'string', enum: ['string', 'number', 'boolean'] },
            },
            required: ['name', 'type'],
          },
        },
        maxRegions: { type: 'integer', minimum: 1, maximum: 40 },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        regions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              box: { type: 'array', items: { type: 'number' } },
              statedConfidence: { type: 'number' },
              parameters: { type: 'object' },
            },
          },
        },
      },
    },
    permissions: ['workspace.read'],
    risk: 'low',
    idempotent: true,
    timeoutMs: 30_000,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const charged = ctx.chargeExternal();
    if (!charged.ok) return charged;

    const image = await loadImage(ctx);
    if (!image.ok) return image;

    const rawParams = Array.isArray(ctx.args.parameters) ? ctx.args.parameters : [];
    const parameters = rawParams
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({
        name: String(p.name ?? ''),
        description: String(p.description ?? ''),
        type: (p.type === 'number' || p.type === 'boolean' ? p.type : 'string') as
          | 'string'
          | 'number'
          | 'boolean',
      }))
      .filter((p) => p.name.length > 0);

    const res = await annotateImage(ctx.env, {
      image: image.value,
      instruction: String(ctx.args.instruction ?? ''),
      parameters,
      maxRegions: typeof ctx.args.maxRegions === 'number' ? ctx.args.maxRegions : undefined,
      signal: ctx.signal,
    });
    if (!res.ok) return res;

    // Annotations are recorded so a later turn can refer to a region without
    // paying for the vision call again.
    const now = new Date().toISOString();
    if (res.value.annotations.length > 0) {
      const pageId = typeof ctx.args.pageId === 'string' ? ctx.args.pageId : null;
      await ctx.env.DB.batch(
        res.value.annotations.map((a) =>
          ctx.env.DB.prepare(
            `INSERT INTO vision_annotations
               (id, page_id, session_id, user_id, label, box_x, box_y, box_w, box_h,
                stated_confidence, parameters, model, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            randomId('anno'),
            pageId,
            ctx.identity.sessionId,
            ctx.identity.kind === 'user' ? ctx.identity.userId : null,
            a.label,
            a.box[0],
            a.box[1],
            a.box[2],
            a.box[3],
            a.statedConfidence,
            JSON.stringify(a.parameters),
            res.value.model,
            now,
          ),
        ),
      );
    }

    return ok({ model: res.value.model, regions: res.value.annotations });
  },
};

/* ------------------------------------------------------------------ */
/* vision.ingest                                                       */
/* ------------------------------------------------------------------ */

const visionIngestHandler: NativeHandler = {
  contract: visionContract({
    id: 'vision.ingest',
    title: 'Store a page image for later recall',
    summary: 'Describes an attached image and indexes it so later turns can find it.',
    inputSchema: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', maxLength: 80 },
        documentId: { type: 'string', maxLength: 120 },
        pageNumber: { type: 'integer', minimum: 1, maximum: 10_000 },
        origin: { type: 'string', maxLength: 300 },
      },
      required: ['attachmentId', 'documentId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        descriptor: { type: 'string' },
        durable: { type: 'boolean' },
      },
    },
    permissions: ['workspace.write'],
    risk: 'low',
    idempotent: false,
    timeoutMs: 30_000,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const charged = ctx.chargeExternal();
    if (!charged.ok) return charged;

    const attachment = await loadAttachment(ctx, String(ctx.args.attachmentId ?? ''));
    if (!attachment.ok) return attachment;

    const store = new VisionMemoryStore(ctx.env);
    const res = await store.ingest({
      sessionId: ctx.identity.sessionId,
      userId: ctx.identity.kind === 'user' ? ctx.identity.userId : null,
      documentId: String(ctx.args.documentId ?? 'untitled'),
      pageNumber: typeof ctx.args.pageNumber === 'number' ? ctx.args.pageNumber : 1,
      bytes: attachment.value.bytes,
      mimeType: attachment.value.mimeType,
      ...(attachment.value.width !== null ? { width: attachment.value.width } : {}),
      ...(attachment.value.height !== null ? { height: attachment.value.height } : {}),
      origin: String(ctx.args.origin ?? attachment.value.origin),
      signal: ctx.signal,
    });
    if (!res.ok) return res;

    return ok({
      pageId: res.value.id,
      descriptor: res.value.descriptor.slice(0, 1200),
      // A guest is told plainly that this does not persist beyond the session.
      durable: ctx.identity.kind === 'user',
    });
  },
};

/* ------------------------------------------------------------------ */
/* Attachment loading                                                  */
/* ------------------------------------------------------------------ */

interface LoadedAttachment {
  bytes: ArrayBuffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  width: number | null;
  height: number | null;
  origin: string;
}

function attachmentKey(sessionId: string, id: string): string {
  return `att:${sessionId}:${id}`;
}

export function attachmentMetaKey(sessionId: string, id: string): string {
  return `attmeta:${sessionId}:${id}`;
}

async function loadAttachment(ctx: NativeContext, id: string): Promise<Result<LoadedAttachment>> {
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(id)) {
    return fail('invalid-argument', 'That is not a valid attachment id.');
  }
  const metaRaw = await ctx.env.CACHE.get(attachmentMetaKey(ctx.identity.sessionId, id));
  if (!metaRaw) {
    return fail('missing-capability', 'That attachment is not available in this session any more.');
  }
  const meta = JSON.parse(metaRaw) as {
    mimeType: string;
    width: number | null;
    height: number | null;
    origin: string;
  };
  if (!isSupportedImageType(meta.mimeType)) {
    return fail('unsupported-runtime', `${meta.mimeType} is not a readable image type.`);
  }
  const bytes = await ctx.env.CACHE.get(attachmentKey(ctx.identity.sessionId, id), 'arrayBuffer');
  if (!bytes) {
    return fail('missing-capability', 'That attachment has expired from this session workspace.');
  }
  return ok({
    bytes,
    mimeType: meta.mimeType,
    width: meta.width,
    height: meta.height,
    origin: meta.origin,
  });
}

async function loadImage(ctx: NativeContext): Promise<Result<ImagePart>> {
  const { toDataUrl } = await import('../memory/vision-store');

  const attachmentId = typeof ctx.args.attachmentId === 'string' ? ctx.args.attachmentId : null;
  if (attachmentId) {
    const loaded = await loadAttachment(ctx, attachmentId);
    if (!loaded.ok) return loaded;
    return ok({
      kind: 'image',
      source: { type: 'data-url', dataUrl: toDataUrl(loaded.value.bytes, loaded.value.mimeType) },
      mimeType: loaded.value.mimeType,
      byteLength: loaded.value.bytes.byteLength,
      ...(loaded.value.width !== null ? { width: loaded.value.width } : {}),
      ...(loaded.value.height !== null ? { height: loaded.value.height } : {}),
      origin: loaded.value.origin,
    });
  }

  const pageId = typeof ctx.args.pageId === 'string' ? ctx.args.pageId : null;
  if (!pageId) {
    return fail('invalid-argument', 'Annotating needs either an attachmentId or a pageId.');
  }

  const store = new VisionMemoryStore(ctx.env);
  const found = await store.retrieve({
    sessionId: ctx.identity.sessionId,
    userId: ctx.identity.kind === 'user' ? ctx.identity.userId : null,
    query: '',
    limit: 8,
  });
  if (!found.ok) return found;
  const page = found.value.pages.find((p) => p.id === pageId);
  if (!page) return fail('missing-capability', 'That page is not in this session or account.');

  const parts = await store.toImageParts([page]);
  if (!parts.ok) return parts;
  const part = parts.value[0];
  if (!part) return fail('missing-capability', 'That page image is no longer retrievable.');
  return ok(part);
}

export const VISION_NATIVES: NativeHandler[] = [
  visionRecallHandler,
  visionAnnotateHandler,
  visionIngestHandler,
];
