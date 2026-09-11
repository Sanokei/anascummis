import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { reasoningFields, type ChatMessage, type ReasoningEffort } from './model';
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

export function visionRoute(
  env: Env,
): { provider: 'deepseek' | 'workers-ai' | 'none'; model: string; reason: string } {
  if (env.DEEPSEEK_API_KEY && env.DEEPSEEK_BASE_URL && env.DEEPSEEK_MODEL_VISION) {
    return {
      provider: 'deepseek',
      model: env.DEEPSEEK_MODEL_VISION,
      reason: 'DEEPSEEK_API_KEY is configured and a vision model identifier is set.',
    };
  }
  // A Workers AI vision model is usable, but only when the operator has named
  // one deliberately. The default is empty on purpose.
  //
  // Two models were measured on 2026-09-10 against a rendered page:
  //   - @cf/llava-hf/llava-1.5-7b-hf answered, and was wrong. Shown a page
  //     headed "Anascummis" with a paragraph and a Stop button, it reported
  //     "a single word 'text' on a black background". For visual QA a model
  //     that is confidently wrong is worse than one that is absent, because
  //     its verdict reads exactly like a correct one.
  //   - @cf/meta/llama-3.2-11b-vision-instruct is capable but licence-gated:
  //     it refuses until the account accepts Meta's community licence, which
  //     is the operator's decision to make, not this code's.
  //
  // So nothing is substituted automatically.
  if (env.WORKERS_AI_VISION_MODEL) {
    return {
      provider: 'workers-ai',
      model: env.WORKERS_AI_VISION_MODEL,
      reason: 'WORKERS_AI_VISION_MODEL was set explicitly by the operator.',
    };
  }
  return {
    provider: 'none',
    model: '',
    reason:
      'No multimodal model is configured. Set DEEPSEEK_API_KEY with DEEPSEEK_MODEL_VISION, or name a Workers AI vision model in WORKERS_AI_VISION_MODEL once you have accepted its licence.',
  };
}

export interface VisionRequest {
  messages: VisionMessage[];
  maxTokens?: number;
  temperature?: number;
  requestedEffort?: ReasoningEffort | 'adaptive';
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

  if (route.provider === 'workers-ai') {
    return workersAiVisionChat(env, route.model, req, images);
  }

  const body: Record<string, unknown> = {
    model: route.model,
    messages: req.messages.map(toProviderMessage),
    max_tokens: req.maxTokens ?? 1500,
    temperature: req.temperature ?? 0.2,
    stream: false,
    ...reasoningFields(req.requestedEffort),
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

/**
 * Workers AI vision models take a single image as a byte array alongside one
 * prompt, rather than OpenAI-style content parts. Only the last image is sent,
 * because these models do not accept several.
 */
async function workersAiVisionChat(
  env: Env,
  model: string,
  req: VisionRequest,
  images: ImagePart[],
): Promise<Result<VisionResult>> {
  if (!env.AI) return fail('missing-credential', 'Workers AI is not bound.');

  const image = images[images.length - 1];
  if (!image) return fail('invalid-argument', 'A vision call needs an image.');
  if (images.length > 1) {
    return fail(
      'unsupported-runtime',
      'The configured Workers AI vision model accepts one image per call, and this request carried several.',
    );
  }
  if (image.source.type !== 'data-url') {
    return fail('unsupported-runtime', 'Workers AI vision needs the image bytes, not a URL reference.');
  }

  const prompt = req.messages
    .flatMap((m) => m.parts.filter((p): p is TextPart => p.kind === 'text').map((p) => p.text))
    .join('\n\n');

  try {
    const raw = (await env.AI.run(model as never, {
      image: [...new Uint8Array(dataUrlToBytes(image.source.dataUrl))],
      prompt,
      max_tokens: req.maxTokens ?? 1200,
    } as never)) as { description?: string; response?: string };

    const text = raw.description ?? raw.response ?? '';
    if (!text) return fail('upstream-error', 'The vision model returned nothing.');
    return ok({ text, model, usage: { promptTokens: 0, completionTokens: 0 } });
  } catch (err) {
    const message = String(err);
    // These models refuse until the account accepts their licence. That is the
    // operator's decision, so it is surfaced rather than worked around.
    if (/Model Agreement|agree/i.test(message)) {
      return fail(
        'not-authorised',
        `${model} requires accepting its licence on the Cloudflare account before it will answer.`,
      );
    }
    return fail('upstream-error', `Workers AI vision call failed: ${message}`);
  }
}

function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',');
  const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
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
