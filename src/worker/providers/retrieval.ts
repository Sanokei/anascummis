import { fail, ok, type Result } from '@shared/types';

/**
 * Bounded page retrieval.
 *
 * Retrieved pages are untrusted task material. This module returns text and
 * provenance only; it never returns anything the caller could mistake for an
 * instruction, and the orchestrator wraps the text before it reaches a prompt.
 */

export interface RetrievedPage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  truncated: boolean;
  contentType: string;
  retrievedAt: string;
}

export interface RetrievalOptions {
  url: string;
  maxBytes?: number;
  maxChars?: number;
  signal?: AbortSignal;
}

const USER_AGENT = 'Anascummis/0.1 (+https://github.com/Sanokei/anascummis)';
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_CHARS = 40_000;

/**
 * Destinations the sandbox and generated capabilities may never reach.
 * Cloud metadata services and loopback are the classic pivot from a fetch
 * capability into host credentials.
 */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

export function screenUrl(raw: string): Result<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('invalid-argument', `"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('invalid-argument', `Only http and https are retrievable, not ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    return fail('not-authorised', `${host} is not a permitted retrieval destination.`);
  }
  if (isPrivateAddress(host)) {
    return fail('not-authorised', `${host} resolves to a private address range and is not retrievable.`);
  }
  if (url.username || url.password) {
    return fail('invalid-argument', 'Credentials embedded in a URL are not accepted.');
  }
  return ok(url);
}

function isPrivateAddress(host: string): boolean {
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^127\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.startsWith('[fd') || host.startsWith('[fc')) return true;
  return false;
}

export async function retrievePage(opts: RetrievalOptions): Promise<Result<RetrievedPage>> {
  const screened = screenUrl(opts.url);
  if (!screened.ok) return screened;
  const url = screened.value;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/json;q=0.8' },
      signal: opts.signal,
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'Retrieval was cancelled.');
    }
    return fail('upstream-error', `Could not retrieve ${url.hostname}: ${text}`);
  }

  if (!res.ok) return fail('upstream-error', `${url.hostname} returned HTTP ${res.status}.`);

  // A redirect chain can leave the allowed destination set.
  const finalScreened = screenUrl(res.url || url.toString());
  if (!finalScreened.ok) {
    return fail('not-authorised', 'The page redirected to a destination that is not retrievable.');
  }

  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  if (!/text\/|application\/(json|xml|xhtml)/i.test(contentType)) {
    return fail('unsupported-runtime', `${contentType} is not a readable page type.`);
  }

  const body = await readBounded(res, maxBytes);
  if (!body.ok) return body;

  const isHtml = /html/i.test(contentType);
  const title = isHtml ? extractTitle(body.value) : finalScreened.value.pathname;
  const text = isHtml ? htmlToText(body.value) : body.value;
  const truncated = body.truncated || text.length > maxChars;

  return ok({
    url: url.toString(),
    finalUrl: finalScreened.value.toString(),
    title: title || finalScreened.value.hostname,
    text: text.slice(0, maxChars),
    truncated,
    contentType,
    retrievedAt: new Date().toISOString(),
  });
}

async function readBounded(
  res: Response,
  maxBytes: number,
): Promise<(Result<string> & { truncated: boolean }) | Result<string> & { truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return { ...ok(text.slice(0, maxBytes)), truncated: text.length > maxBytes };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - maxBytes))));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch (err) {
    return { ...fail('upstream-error', `Read failed: ${String(err)}`), truncated };
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { ...ok(new TextDecoder('utf-8', { fatal: false }).decode(merged)), truncated };
}

export function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? collapse(decodeEntities(match[1])) : '';
}

export function htmlToText(html: string): string {
  const withoutHead = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const blocks = withoutHead
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  return collapseLines(decodeEntities(blocks.replace(/<[^>]*>/g, ' ')));
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x?([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, /^x/i.test(code) ? 16 : 10)),
    );
}

function collapse(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function collapseLines(input: string): string {
  return input
    .split('\n')
    .map((line) => collapse(line))
    .filter((line) => line.length > 0)
    .join('\n');
}
