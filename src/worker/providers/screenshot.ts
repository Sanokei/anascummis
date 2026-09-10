import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { screenUrl } from './retrieval';

/**
 * Screenshots through Cloudflare Browser Rendering.
 *
 * This is what lets the assistant look at something it produced rather than
 * assert that it looks right. It renders either supplied HTML or a permitted
 * URL and returns PNG bytes.
 *
 * The token this uses is deliberately a separate, narrowly scoped one. The
 * deploy token can create and delete every resource on the account, so it is
 * never given to the Worker: a rendering credential should only be able to
 * render.
 */

export interface ScreenshotRequest {
  /** Exactly one of these. HTML is rendered in a blank page. */
  html?: string;
  url?: string;
  width?: number;
  height?: number;
  /** Capture the whole scrollable page rather than the viewport. */
  fullPage?: boolean;
  /** CSS selector to wait for before capturing. */
  waitForSelector?: string;
  signal?: AbortSignal;
}

export interface Screenshot {
  bytes: ArrayBuffer;
  mimeType: 'image/png';
  width: number;
  height: number;
  /** What was captured, so a lab record carries its own provenance. */
  source: string;
}

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SHOT_BYTES = 12 * 1024 * 1024;

export function screenshotRoute(env: Env): { available: boolean; reason: string } {
  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    return { available: false, reason: 'CLOUDFLARE_ACCOUNT_ID is not set.' };
  }
  if (!env.BROWSER_RENDERING_TOKEN) {
    return {
      available: false,
      reason:
        'BROWSER_RENDERING_TOKEN is not set. Create an API token scoped to Browser Rendering: Edit and add it as a secret. The deploy token is deliberately not reused here.',
    };
  }
  return { available: true, reason: 'Browser Rendering is configured.' };
}

export async function captureScreenshot(
  env: Env,
  req: ScreenshotRequest,
): Promise<Result<Screenshot>> {
  const route = screenshotRoute(env);
  if (!route.available) return fail('missing-credential', route.reason);

  if (!req.html && !req.url) {
    return fail('invalid-argument', 'A screenshot needs either html or a url.');
  }
  if (req.html && req.url) {
    return fail('invalid-argument', 'Supply html or a url, not both.');
  }

  const width = clamp(req.width ?? 1280, 320, 2560);
  const height = clamp(req.height ?? 800, 240, 2560);

  const body: Record<string, unknown> = {
    viewport: { width, height },
    screenshotOptions: { type: 'png', fullPage: req.fullPage === true },
    gotoOptions: { waitUntil: 'networkidle0', timeout: 20_000 },
  };

  let source: string;
  if (req.html) {
    if (new TextEncoder().encode(req.html).length > MAX_HTML_BYTES) {
      return fail('invalid-argument', 'That HTML is larger than the accepted ceiling.');
    }
    body.html = req.html;
    source = 'supplied html';
  } else {
    // A screenshot is a fetch with a renderer attached, so the same
    // destination rules apply: no loopback, no cloud metadata, no private
    // ranges. Otherwise this would be a way around the retrieval screen.
    const screened = screenUrl(req.url!);
    if (!screened.ok) return screened;
    body.url = screened.value.toString();
    source = screened.value.toString();
  }

  if (req.waitForSelector) body.waitForSelector = { selector: req.waitForSelector, timeout: 10_000 };

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/screenshot`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.BROWSER_RENDERING_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      },
    );

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      if (res.status === 401 || res.status === 403) {
        return fail('missing-credential', 'The rendering token was rejected or lacks the scope.', detail);
      }
      return fail('upstream-error', `Browser Rendering returned ${res.status}.`, detail);
    }

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) return fail('upstream-error', 'The renderer returned an empty image.');
    if (bytes.byteLength > MAX_SHOT_BYTES) {
      return fail('budget-exhausted', 'The screenshot is larger than the accepted ceiling.');
    }

    return ok({ bytes, mimeType: 'image/png', width, height, source });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'The screenshot was cancelled.');
    }
    return fail('upstream-error', `Screenshot failed: ${String(err)}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}
