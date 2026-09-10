import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import type { ChatMessage } from './model';
import { validateAgainstSchema } from '../registry/schema';
import type { JsonSchema } from '@shared/types';

/**
 * Multimodal input for the conversational model.
 *
 * Verified against the provider's vision guide on 2026-09-10: the V4.1 Flash
 * identifier is `deepseek-flash`, images are OpenAI-style `image_url` content
 * parts carrying a base64 data URL, a public http(s) URL, or a `file_id`, and
 * the accepted formats are JPEG, PNG, GIF and WebP.
 *
 * Bounding-box grounding is *not* a documented capability of that model. This
 * module therefore treats box output as a host-defined structured-output
 * contract that is validated here, rather than as a native grounding mode. An
 * annotation that does not satisfy the schema is rejected, not repaired.
 */

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/** Provider ceilings, from the vision guide. */
export const IMAGE_LIMITS = {
  maxBytesInline: 32 * 1024 * 1024,
  maxTotalBytesPerRequest: 64 * 1024 * 1024,
  maxPixelsPerSide: 8192,
  maxPixelsPerSideWhenManyImages: 4096,
  manyImagesThreshold: 15,
} as const;

export interface ImagePart {
  kind: 'image';
  /** A data: URL, a public https URL, or a provider file id. */
  source: { type: 'data-url'; dataUrl: string } | { type: 'url'; url: string } | { type: 'file'; fileId: string };
  mimeType: SupportedImageType;
  byteLength: number;
  width?: number;
  height?: number;
  /** Where the image came from, so provenance survives into a citation. */
  origin: string;
}

export interface TextPart {
  kind: 'text';
  text: string;
}

export type ContentPart = TextPart | ImagePart;

export interface VisionMessage {
  role: 'system' | 'user' | 'assistant';
  parts: ContentPart[];
}

export function isSupportedImageType(value: string): value is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(value);
}

/** Rejects an image set that the provider would refuse, before spending a call. */
export function screenImages(images: ImagePart[]): Result<true> {
  let total = 0;
  const sideCap =
    images.length >= IMAGE_LIMITS.manyImagesThreshold
      ? IMAGE_LIMITS.maxPixelsPerSideWhenManyImages
      : IMAGE_LIMITS.maxPixelsPerSide;

  for (const image of images) {
    if (!isSupportedImageType(image.mimeType)) {
      return fail('invalid-argument', `${image.mimeType} is not an accepted image type.`);
    }
    if (image.byteLength > IMAGE_LIMITS.maxBytesInline) {
      return fail('invalid-argument', `An image exceeds the ${IMAGE_LIMITS.maxBytesInline} byte ceiling.`);
    }
    if ((image.width ?? 0) > sideCap || (image.height ?? 0) > sideCap) {
      return fail('invalid-argument', `An image exceeds ${sideCap} px on a side for a ${images.length}-image request.`);
    }
    total += image.byteLength;
  }
  if (total > IMAGE_LIMITS.maxTotalBytesPerRequest) {
    return fail('invalid-argument', 'The request exceeds the total image size ceiling.');
  }
  return ok(true);
}

export function visionRoute(env: Env): { provider: 'deepseek' | 'none'; model: string; reason: string } {
  if (env.DEEPSEEK_API_KEY && env.DEEPSEEK_BASE_URL && env.DEEPSEEK_MODEL_VISION) {
    return {
      provider: 'deepseek',
      model: env.DEEPSEEK_MODEL_VISION,
      reason: 'DEEPSEEK_API_KEY is configured and a vision model identifier is set.',
    };
  }
  // Workers AI carries image-to-text models, but none of them is a drop-in for
  // the conversational tool-calling route, so this reports unavailable rather
  // than substituting a different capability.
  return {
    provider: 'none',
    model: '',
    reason: 'No multimodal model is configured. Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL_VISION.',
  };
}

export interface VisionRequest {
  messages: VisionMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Requests a JSON object response, used by the annotation contract. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface VisionResult {
  text: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export async function visionChat(env: Env, req: VisionRequest): Promise<Result<VisionResult>> {
  const route = visionRoute(env);
  if (route.provider === 'none') return fail('missing-credential', route.reason);

  const images = req.messages.flatMap((m) => m.parts.filter((p): p is ImagePart => p.kind === 'image'));
  const screened = screenImages(images);
  if (!screened.ok) return screened;

  const body: Record<string, unknown> = {
    model: route.model,
    messages: req.messages.map(toProviderMessage),
    max_tokens: req.maxTokens ?? 1500,
    temperature: req.temperature ?? 0.2,
    stream: false,
  };
  if (req.json) body.response_format = { type: 'json_object' };

  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      return fail('upstream-error', `Vision model returned ${res.status}.`, (await res.text()).slice(0, 400));
    }
    const parsed = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return ok({
      text: parsed.choices?.[0]?.message?.content ?? '',
      model: route.model,
      usage: {
        promptTokens: parsed.usage?.prompt_tokens ?? 0,
        completionTokens: parsed.usage?.completion_tokens ?? 0,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'Vision call was cancelled.');
    }
    return fail('upstream-error', `Vision call failed: ${String(err)}`);
  }
}

function toProviderMessage(message: VisionMessage): Record<string, unknown> {
  // A text-only message keeps the plain string form, which every provider accepts.
  if (message.parts.every((p) => p.kind === 'text')) {
    return {
      role: message.role,
      content: message.parts.map((p) => (p as TextPart).text).join('\n'),
    };
  }
  return {
    role: message.role,
    content: message.parts.map((part) => {
      if (part.kind === 'text') return { type: 'text', text: part.text };
      switch (part.source.type) {
        case 'data-url':
          return { type: 'image_url', image_url: { url: part.source.dataUrl } };
        case 'url':
          return { type: 'image_url', image_url: { url: part.source.url } };
        case 'file':
          return { type: 'image_url', image_url: { file_id: part.source.fileId } };
      }
    }),
  };
}

export function toChatMessages(messages: VisionMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.parts
      .map((p) => (p.kind === 'text' ? p.text : `[image: ${p.origin}]`))
      .join('\n'),
  }));
}

/* ------------------------------------------------------------------ */
/* Bounding-box annotation contract                                    */
/* ------------------------------------------------------------------ */

/**
 * A labelled region of an image with arbitrary named parameters attached.
 *
 * Coordinates are normalised to 0..1 of the image's own width and height, so
 * an annotation stays valid when the image is rescaled. The model is asked to
 * produce this shape; the schema below is what decides whether it did.
 */
export interface BoxAnnotation {
  label: string;
  /** Normalised [x, y, width, height], each 0..1. */
  box: [number, number, number, number];
  /** The model's own stated confidence. Not a calibrated probability. */
  statedConfidence: number | null;
  /** Named parameters the caller asked for, per region. */
  parameters: Record<string, string | number | boolean>;
}

export interface AnnotationRequest {
  image: ImagePart;
  /** What kinds of region to find, in plain language. */
  instruction: string;
  /** Parameter names each region should carry, and what each one means. */
  parameters: { name: string; description: string; type: 'string' | 'number' | 'boolean' }[];
  maxRegions?: number;
  signal?: AbortSignal;
}

const ANNOTATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    regions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 120 },
          box: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          parameters: { type: 'object' },
        },
        required: ['label', 'box'],
      },
    },
  },
  required: ['regions'],
};

export async function annotateImage(
  env: Env,
  req: AnnotationRequest,
): Promise<Result<{ annotations: BoxAnnotation[]; model: string }>> {
  const maxRegions = Math.min(Math.max(1, req.maxRegions ?? 12), 40);
  const paramSpec = req.parameters
    .map((p) => `  "${p.name}": ${p.type}  // ${p.description}`)
    .join('\n');

  const system = [
    'You label regions of an image.',
    'Reply with JSON only, matching this shape exactly:',
    '{"regions":[{"label":string,"box":[x,y,width,height],"confidence":number,"parameters":{...}}]}',
    'Coordinates are fractions of the image width and height, between 0 and 1.',
    '"box" is [left, top, width, height], not [left, top, right, bottom].',
    `Return at most ${maxRegions} regions.`,
    req.parameters.length > 0
      ? `Each region carries these parameters:\n{\n${paramSpec}\n}`
      : 'Each region carries an empty parameters object.',
    'Omit a region rather than guessing at one. An empty list is a valid answer.',
  ].join('\n');

  const res = await visionChat(env, {
    messages: [
      { role: 'system', parts: [{ kind: 'text', text: system }] },
      {
        role: 'user',
        parts: [{ kind: 'text', text: req.instruction }, req.image],
      },
    ],
    json: true,
    temperature: 0,
    signal: req.signal,
  });
  if (!res.ok) return res;

  const parsed = parseJsonObject(res.value.text);
  if (!parsed.ok) return parsed;

  const shaped = validateAgainstSchema(ANNOTATION_SCHEMA, parsed.value);
  if (!shaped.ok) {
    return fail('contract-mismatch', `The annotation did not match the contract: ${shaped.message}`);
  }

  const raw = (shaped.value as { regions: RawRegion[] }).regions.slice(0, maxRegions);
  const annotations: BoxAnnotation[] = [];
  for (const region of raw) {
    const box = normaliseBox(region.box);
    // A malformed box is dropped rather than clamped into something plausible.
    if (!box) continue;
    annotations.push({
      label: region.label,
      box,
      statedConfidence: typeof region.confidence === 'number' ? region.confidence : null,
      parameters: coerceParameters(region.parameters, req.parameters),
    });
  }
  return ok({ annotations, model: res.value.model });
}

interface RawRegion {
  label: string;
  box: number[];
  confidence?: number;
  parameters?: Record<string, unknown>;
}

export function normaliseBox(box: number[]): [number, number, number, number] | null {
  if (box.length !== 4) return null;
  const [x, y, w, h] = box as [number, number, number, number];
  if (![x, y, w, h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  if (w <= 0 || h <= 0) return null;
  if (x + w > 1.0001 || y + h > 1.0001) return null;
  return [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)];
}

function coerceParameters(
  raw: Record<string, unknown> | undefined,
  spec: AnnotationRequest['parameters'],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw) return out;
  for (const param of spec) {
    const value = raw[param.name];
    if (value === undefined || value === null) continue;
    if (param.type === 'number' && typeof value === 'number') out[param.name] = value;
    else if (param.type === 'boolean' && typeof value === 'boolean') out[param.name] = value;
    else if (param.type === 'string' && typeof value === 'string') out[param.name] = value.slice(0, 500);
  }
  return out;
}

/** Providers sometimes wrap JSON in a fenced block even when asked not to. */
export function parseJsonObject(text: string): Result<unknown> {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = unfenced?.[1] ?? trimmed;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('contract-mismatch', 'Expected a JSON object.');
    }
    return ok(parsed);
  } catch {
    return fail('contract-mismatch', 'The model did not return parseable JSON.');
  }
}
