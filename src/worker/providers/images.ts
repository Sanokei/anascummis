import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import type { SupportedImageType } from './vision';

/**
 * Image generation.
 *
 * fal.ai when `FAL_KEY` is set, the bound Workers AI model otherwise. Both
 * return bytes plus the provenance of what produced them, so a lab record can
 * say which model made an artifact rather than implying the assistant drew it.
 *
 * A missing provider produces `missing-credential`. Nothing here ever returns
 * a placeholder image or claims a generation that did not happen.
 */

export interface GeneratedImage {
  bytes: ArrayBuffer;
  mimeType: SupportedImageType;
  width: number | null;
  height: number | null;
  provider: 'fal' | 'workers-ai';
  model: string;
  /** The prompt as actually sent, which is what a reviewer needs to judge it. */
  promptUsed: string;
}

export interface GenerateRequest {
  prompt: string;
  /** fal model id, or a Workers AI model. Configuration, never invented. */
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  signal?: AbortSignal;
}

export interface ImageRoute {
  provider: 'fal' | 'workers-ai' | 'none';
  model: string;
  reason: string;
}

export function imageRoute(env: Env, requested?: string): ImageRoute {
  if (env.FAL_KEY) {
    return {
      provider: 'fal',
      model: requested ?? env.FAL_IMAGE_MODEL ?? 'fal-ai/flux/schnell',
      reason: 'FAL_KEY is configured.',
    };
  }
  if (env.AI && env.WORKERS_AI_IMAGE_MODEL) {
    return {
      provider: 'workers-ai',
      model: env.WORKERS_AI_IMAGE_MODEL,
      reason: 'No fal key is configured; using the bound Workers AI image model.',
    };
  }
  return { provider: 'none', model: '', reason: 'No image generation provider is configured.' };
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function generateImage(env: Env, req: GenerateRequest): Promise<Result<GeneratedImage>> {
  const prompt = req.prompt.trim();
  if (!prompt) return fail('invalid-argument', 'The prompt is empty.');
  if (prompt.length > 4000) return fail('invalid-argument', 'The prompt is longer than 4000 characters.');

  const route = imageRoute(env, req.model);
  if (route.provider === 'none') {
    return fail(
      'missing-credential',
      'No image generation provider is available. Set FAL_KEY, or bind Workers AI with WORKERS_AI_IMAGE_MODEL.',
    );
  }
  if (route.provider === 'fal') return falGenerate(env, route, req, prompt);
  return workersAiGenerate(env, route, req, prompt);
}

/**
 * fal.ai synchronous run.
 *
 * The queue endpoint exists for slow models, but a Worker request cannot wait
 * indefinitely, so this uses the synchronous path and reports a timeout rather
 * than silently abandoning a queued job the caller would never hear about.
 */
async function falGenerate(
  env: Env,
  route: ImageRoute,
  req: GenerateRequest,
  prompt: string,
): Promise<Result<GeneratedImage>> {
  const body: Record<string, unknown> = { prompt };
  if (req.width && req.height) body.image_size = { width: req.width, height: req.height };
  if (req.steps) body.num_inference_steps = req.steps;
  if (typeof req.seed === 'number') body.seed = req.seed;
  body.num_images = 1;

  let payload: FalResponse;
  try {
    const res = await fetch(`https://fal.run/${route.model}`, {
      method: 'POST',
      headers: {
        // fal uses "Key", not "Bearer". A Bearer prefix returns 401.
        Authorization: `Key ${env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      if (res.status === 401 || res.status === 403) {
        return fail('missing-credential', 'fal rejected the key.', detail);
      }
      return fail('upstream-error', `fal returned ${res.status}.`, detail);
    }
    payload = (await res.json()) as FalResponse;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'Image generation was cancelled.');
    }
    return fail('upstream-error', `fal call failed: ${String(err)}`);
  }

  const image = payload.images?.[0];
  if (!image?.url) {
    return fail('contract-mismatch', 'fal returned no image for that request.');
  }

  const fetched = await downloadImage(image.url, req.signal);
  if (!fetched.ok) return fetched;

  return ok({
    bytes: fetched.value.bytes,
    mimeType: fetched.value.mimeType,
    width: image.width ?? req.width ?? null,
    height: image.height ?? req.height ?? null,
    provider: 'fal',
    model: route.model,
    promptUsed: prompt,
  });
}

interface FalResponse {
  images?: { url?: string; width?: number; height?: number; content_type?: string }[];
}

async function workersAiGenerate(
  env: Env,
  route: ImageRoute,
  req: GenerateRequest,
  prompt: string,
): Promise<Result<GeneratedImage>> {
  if (!env.AI) return fail('missing-credential', 'Workers AI is not bound.');
  try {
    const payload: Record<string, unknown> = { prompt };
    if (req.steps) payload.steps = Math.min(Math.max(1, req.steps), 8);
    if (req.seed !== undefined) payload.seed = req.seed;

    const raw = (await env.AI.run(route.model as never, payload as never)) as
      | { image?: string }
      | ReadableStream;

    // Some models return base64 in `image`, others stream raw bytes.
    if (raw instanceof ReadableStream) {
      const bytes = await new Response(raw).arrayBuffer();
      if (bytes.byteLength === 0) return fail('upstream-error', 'The image model returned nothing.');
      return ok({
        bytes,
        mimeType: 'image/png',
        width: req.width ?? null,
        height: req.height ?? null,
        provider: 'workers-ai',
        model: route.model,
        promptUsed: prompt,
      });
    }

    const base64 = raw.image;
    if (!base64) return fail('upstream-error', 'The image model returned no image.');
    const bytes = decodeBase64(base64);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return fail('budget-exhausted', 'The generated image is larger than the accepted ceiling.');
    }
    return ok({
      bytes,
      // flux-1-schnell returns JPEG bytes under this key.
      mimeType: 'image/jpeg',
      width: req.width ?? null,
      height: req.height ?? null,
      provider: 'workers-ai',
      model: route.model,
      promptUsed: prompt,
    });
  } catch (err) {
    return fail('upstream-error', `Workers AI image call failed: ${String(err)}`);
  }
}

/** fal returns a URL; the bytes still have to be fetched and bounded. */
async function downloadImage(
  url: string,
  signal?: AbortSignal,
): Promise<Result<{ bytes: ArrayBuffer; mimeType: SupportedImageType }>> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return fail('upstream-error', `Could not download the generated image (${res.status}).`);

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    const mimeType: SupportedImageType =
      contentType === 'image/png' ||
      contentType === 'image/jpeg' ||
      contentType === 'image/webp' ||
      contentType === 'image/gif'
        ? contentType
        : 'image/png';

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) return fail('upstream-error', 'The generated image was empty.');
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return fail('budget-exhausted', 'The generated image is larger than the accepted ceiling.');
    }
    return ok({ bytes, mimeType });
  } catch (err) {
    return fail('upstream-error', `Could not download the generated image: ${String(err)}`);
  }
}

function decodeBase64(value: string): ArrayBuffer {
  const clean = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}
