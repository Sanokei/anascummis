import type { Citation } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';

/**
 * Web search. Returns source identifiers and retrieved evidence, never a
 * model-composed answer standing in for results.
 *
 * Brave is used when a key exists. Otherwise the keyless DuckDuckGo HTML
 * endpoint is parsed. Both paths return the same shape, and an unavailable
 * provider is reported as unavailable rather than replaced with invention.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  query: string;
  limit: number;
  signal?: AbortSignal;
}

const USER_AGENT = 'Anascummis/0.1 (+https://github.com/Sanokei/anascummis)';

export async function webSearch(env: Env, opts: SearchOptions): Promise<Result<SearchHit[]>> {
  const query = opts.query.trim();
  if (!query) return fail('invalid-argument', 'Search query is empty.');
  const limit = Math.min(Math.max(1, opts.limit), 10);

  if (env.BRAVE_SEARCH_KEY) {
    const brave = await braveSearch(env.BRAVE_SEARCH_KEY, query, limit, opts.signal);
    if (brave.ok) return brave;
    // Fall through to the keyless path rather than failing the whole turn.
  }
  return duckDuckGoSearch(query, limit, opts.signal);
}

async function braveSearch(
  key: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Result<SearchHit[]>> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key, 'User-Agent': USER_AGENT },
      signal,
    });
    if (!res.ok) return fail('upstream-error', `Brave search returned ${res.status}.`);
    const body = (await res.json()) as { web?: { results?: BraveResult[] } };
    const hits = (body.web?.results ?? []).slice(0, limit).map((r) => ({
      title: stripTags(r.title ?? r.url ?? ''),
      url: r.url ?? '',
      snippet: stripTags(r.description ?? ''),
    }));
    return ok(hits.filter((h) => h.url));
  } catch (err) {
    return fail('upstream-error', `Brave search failed: ${message(err)}`);
  }
}

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

async function duckDuckGoSearch(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Result<SearchHit[]>> {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: `q=${encodeURIComponent(query)}`,
      signal,
    });
    if (!res.ok) {
      return fail('upstream-error', `Search provider returned ${res.status}. No results were retrieved.`);
    }
    const html = await res.text();
    const hits = parseDuckDuckGoHtml(html, limit);
    if (hits.length === 0) {
      return fail(
        'upstream-error',
        'The search provider returned a page this parser did not recognise, so no sources were retrieved.',
      );
    }
    return ok(hits);
  } catch (err) {
    return fail('upstream-error', `Search failed: ${message(err)}`);
  }
}

/** Exported so a parser regression is caught by a test against a saved fixture. */
export function parseDuckDuckGoHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const anchor = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => stripTags(m[1] ?? ''));

  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = anchor.exec(html)) !== null && hits.length < limit) {
    const href = decodeDdgHref(match[1] ?? '');
    const title = stripTags(match[2] ?? '');
    if (href && title) {
      hits.push({ title, url: href, snippet: snippets[i] ?? '' });
    }
    i += 1;
  }
  return hits;
}

/** DuckDuckGo wraps results in a redirect carrying the real target in `uddg`. */
function decodeDdgHref(href: string): string {
  const raw = href.replace(/&amp;/g, '&');
  const match = /[?&]uddg=([^&]+)/.exec(raw);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return '';
    }
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return '';
}

export function stripTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function toCitation(hit: SearchHit): Citation {
  return { title: hit.title, url: hit.url, snippet: hit.snippet, retrievedAt: new Date().toISOString() };
}

function message(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'cancelled' : err.message;
  return String(err);
}
