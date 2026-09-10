import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { randomId, sha256Hex } from '../crypto';
import {
  visionChat,
  visionRoute,
  isSupportedImageType,
  type ImagePart,
  type SupportedImageType,
} from '../providers/vision';

/**
 * Vision-first document memory, after VisRAG (OpenBMB, Apache-2.0 code).
 *
 * VisRAG's insight is that parsing a page to text throws information away, so
 * the page image itself should reach the generator. That half is implemented
 * here in full: pages are stored whole and passed to the multimodal model as
 * images at generation time.
 *
 * The retrieval half is *not* VisRAG-Ret. That model is MiniCPM-licensed,
 * free for academic research only, and needs a GPU-hosted VLM encoder that a
 * Worker does not have. Retrieval here ranks over a model-written descriptor
 * of each page plus an optional text embedding of that descriptor. The
 * information loss VisRAG avoids at generation is therefore still present at
 * retrieval, and `retrievalMode` reports which of the two is in use so a
 * caller never mistakes this for a full VisRAG implementation.
 */

export type RetrievalMode = 'descriptor-embedding' | 'descriptor-keyword';

export interface StoredPage {
  id: string;
  documentId: string;
  pageNumber: number;
  /** R2 object key, or a KV key when R2 is not bound. */
  objectKey: string;
  storage: 'r2' | 'kv';
  mimeType: SupportedImageType;
  byteLength: number;
  width: number | null;
  height: number | null;
  /** What the vision model saw. Used for retrieval, never shown as the answer. */
  descriptor: string;
  embedding: number[] | null;
  origin: string;
  storedAt: string;
}

export interface IngestRequest {
  sessionId: string;
  userId: string | null;
  documentId: string;
  pageNumber: number;
  bytes: ArrayBuffer;
  mimeType: string;
  width?: number;
  height?: number;
  origin: string;
  signal?: AbortSignal;
}

const DESCRIPTOR_PROMPT = [
  'Describe this page so it can be found again by search.',
  'Cover: what kind of document it is, its headings, the entities and figures it names,',
  'any table or chart and what it measures, and any distinctive layout.',
  'Write plain prose under 200 words. Do not speculate about content you cannot see.',
].join(' ');

export class VisionMemoryStore {
  constructor(private readonly env: Env) {}

  get retrievalMode(): RetrievalMode {
    return this.env.AI ? 'descriptor-embedding' : 'descriptor-keyword';
  }

  /** True when generation can actually receive images rather than descriptors. */
  get generationIsVisual(): boolean {
    return visionRoute(this.env).provider !== 'none';
  }

  async ingest(req: IngestRequest): Promise<Result<StoredPage>> {
    if (!isSupportedImageType(req.mimeType)) {
      return fail('invalid-argument', `${req.mimeType} is not an accepted page image type.`);
    }
    if (req.bytes.byteLength === 0) return fail('invalid-argument', 'The page image is empty.');

    const contentHash = await sha256Hex(req.bytes);
    const scope = req.userId ?? `session:${req.sessionId}`;
    const objectKey = `vision/${scope}/${req.documentId}/${req.pageNumber}-${contentHash.slice(0, 16)}`;

    const stored = await this.putObject(objectKey, req.bytes, req.mimeType, req.userId !== null);
    if (!stored.ok) return stored;

    const descriptor = await this.describe(
      { bytes: req.bytes, mimeType: req.mimeType, origin: req.origin, width: req.width, height: req.height },
      req.signal,
    );
    if (!descriptor.ok) return descriptor;

    const embedding = await this.embed(descriptor.value);

    const page: StoredPage = {
      id: randomId('page'),
      documentId: req.documentId,
      pageNumber: req.pageNumber,
      objectKey,
      storage: stored.value,
      mimeType: req.mimeType,
      byteLength: req.bytes.byteLength,
      width: req.width ?? null,
      height: req.height ?? null,
      descriptor: descriptor.value,
      embedding,
      origin: req.origin,
      storedAt: new Date().toISOString(),
    };

    // A guest's pages are session-scoped and expiry-bound; only an
    // authenticated user's pages become a durable row.
    if (req.userId) {
      await this.env.DB.prepare(
        `INSERT INTO vision_pages
           (id, user_id, session_id, document_id, page_number, object_key, storage,
            mime_type, byte_length, width, height, descriptor, embedding, origin, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          page.id,
          req.userId,
          req.sessionId,
          page.documentId,
          page.pageNumber,
          page.objectKey,
          page.storage,
          page.mimeType,
          page.byteLength,
          page.width,
          page.height,
          page.descriptor,
          embedding ? JSON.stringify(embedding) : null,
          page.origin,
          page.storedAt,
        )
        .run();
    } else {
      const ttl = Number.parseInt(this.env.GUEST_RETENTION_SECONDS, 10) || 86_400;
      await this.env.CACHE.put(`vpage:${req.sessionId}:${page.id}`, JSON.stringify(page), {
        expirationTtl: Math.max(60, ttl),
      });
    }

    return ok(page);
  }

  /** Ranked pages for a query. Returns provenance, never a composed answer. */
  async retrieve(input: {
    sessionId: string;
    userId: string | null;
    query: string;
    limit?: number;
  }): Promise<Result<{ pages: StoredPage[]; mode: RetrievalMode }>> {
    const limit = Math.min(Math.max(1, input.limit ?? 3), 8);
    const candidates = await this.candidates(input.sessionId, input.userId);
    if (candidates.length === 0) return ok({ pages: [], mode: this.retrievalMode });

    const queryEmbedding = await this.embed(input.query);
    let ranked: StoredPage[];

    if (queryEmbedding && candidates.some((c) => c.embedding)) {
      ranked = candidates
        .map((page) => ({
          page,
          score: page.embedding ? cosine(queryEmbedding, page.embedding) : -1,
        }))
        .sort((a, b) => b.score - a.score)
        .filter((entry) => entry.score > 0.15)
        .slice(0, limit)
        .map((entry) => entry.page);
    } else {
      const terms = input.query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2);
      ranked = candidates
        .map((page) => {
          const hay = `${page.descriptor} ${page.origin}`.toLowerCase();
          return { page, score: terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.page);
    }

    return ok({ pages: ranked, mode: this.retrievalMode });
  }

  /**
   * Rebuilds retrieved pages as image parts for generation.
   *
   * This is the part that is genuinely VisRAG: the original page reaches the
   * model rather than a text rendering of it.
   */
  async toImageParts(pages: StoredPage[]): Promise<Result<ImagePart[]>> {
    const parts: ImagePart[] = [];
    for (const page of pages) {
      const bytes = await this.getObject(page.objectKey, page.storage);
      if (!bytes) {
        return fail('missing-capability', `Stored page ${page.id} is no longer retrievable.`);
      }
      parts.push({
        kind: 'image',
        source: { type: 'data-url', dataUrl: toDataUrl(bytes, page.mimeType) },
        mimeType: page.mimeType,
        byteLength: bytes.byteLength,
        ...(page.width !== null ? { width: page.width } : {}),
        ...(page.height !== null ? { height: page.height } : {}),
        origin: `${page.origin} page ${page.pageNumber}`,
      });
    }
    return ok(parts);
  }

  private async candidates(sessionId: string, userId: string | null): Promise<StoredPage[]> {
    if (userId) {
      const rows = await this.env.DB.prepare(
        `SELECT * FROM vision_pages WHERE user_id = ? ORDER BY stored_at DESC LIMIT 200`,
      )
        .bind(userId)
        .all<Record<string, unknown>>();
      return (rows.results ?? []).map(rowToPage);
    }
    const listed = await this.env.CACHE.list({ prefix: `vpage:${sessionId}:`, limit: 100 });
    const pages: StoredPage[] = [];
    for (const key of listed.keys) {
      const raw = await this.env.CACHE.get(key.name);
      if (raw) pages.push(JSON.parse(raw) as StoredPage);
    }
    return pages;
  }

  private async describe(
    image: { bytes: ArrayBuffer; mimeType: SupportedImageType; origin: string; width?: number; height?: number },
    signal?: AbortSignal,
  ): Promise<Result<string>> {
    const route = visionRoute(this.env);
    if (route.provider === 'none') {
      // Without a multimodal model there is no honest descriptor to write, so
      // the page is indexed by its provenance alone and says so.
      return ok(`Unindexed page image from ${image.origin}. No multimodal model was available to describe it.`);
    }
    const res = await visionChat(this.env, {
      messages: [
        {
          role: 'user',
          parts: [
            { kind: 'text', text: DESCRIPTOR_PROMPT },
            {
              kind: 'image',
              source: { type: 'data-url', dataUrl: toDataUrl(image.bytes, image.mimeType) },
              mimeType: image.mimeType,
              byteLength: image.bytes.byteLength,
              ...(image.width !== undefined ? { width: image.width } : {}),
              ...(image.height !== undefined ? { height: image.height } : {}),
              origin: image.origin,
            },
          ],
        },
      ],
      temperature: 0,
      maxTokens: 400,
      signal,
    });
    if (!res.ok) return res;
    const text = res.value.text.trim();
    if (!text) return fail('upstream-error', 'The vision model returned an empty page descriptor.');
    return ok(text);
  }

  private async embed(text: string): Promise<number[] | null> {
    if (!this.env.AI) return null;
    try {
      const res = (await this.env.AI.run('@cf/baai/bge-base-en-v1.5' as never, {
        text: [text.slice(0, 2000)],
      } as never)) as { data?: number[][] };
      const vector = res.data?.[0];
      return Array.isArray(vector) && vector.length > 0 ? vector : null;
    } catch {
      // An embedding failure degrades retrieval to keyword ranking rather than
      // failing the ingest.
      return null;
    }
  }

  private async putObject(
    key: string,
    bytes: ArrayBuffer,
    mimeType: string,
    durable: boolean,
  ): Promise<Result<'r2' | 'kv'>> {
    if (this.env.VISION && durable) {
      await this.env.VISION.put(key, bytes, { httpMetadata: { contentType: mimeType } });
      return ok('r2');
    }
    if (bytes.byteLength > 24 * 1024 * 1024) {
      return fail('invalid-argument', 'The page image is too large for the available store.');
    }
    const ttl = durable ? undefined : Math.max(60, Number.parseInt(this.env.GUEST_RETENTION_SECONDS, 10) || 86_400);
    await this.env.CACHE.put(key, bytes, ttl ? { expirationTtl: ttl } : undefined);
    return ok('kv');
  }

  private async getObject(key: string, storage: 'r2' | 'kv'): Promise<ArrayBuffer | null> {
    if (storage === 'r2' && this.env.VISION) {
      const object = await this.env.VISION.get(key);
      return object ? object.arrayBuffer() : null;
    }
    return this.env.CACHE.get(key, 'arrayBuffer');
  }
}

function rowToPage(row: Record<string, unknown>): StoredPage {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    pageNumber: Number(row.page_number),
    objectKey: String(row.object_key),
    storage: row.storage === 'r2' ? 'r2' : 'kv',
    mimeType: String(row.mime_type) as SupportedImageType,
    byteLength: Number(row.byte_length),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    descriptor: String(row.descriptor ?? ''),
    embedding: row.embedding ? (JSON.parse(String(row.embedding)) as number[]) : null,
    origin: String(row.origin ?? ''),
    storedAt: String(row.stored_at),
  };
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function toDataUrl(bytes: ArrayBuffer, mimeType: string): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
