import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {safeFetch, publicAddress} from './network';
import {fetchWithoutRedirects} from './fetch-without-redirects';

export type SourceSnapshot = {
  id: string; goalId: string; taskId: string; requestedUrl: string; url: string; title: string;
  retrievedAt: string; type: string; bytes: number; textLength: number;
  sha256: string; textSha256: string; normalization: 'public-text-v1';
};
export type PublicPage = Omit<SourceSnapshot, 'id' | 'goalId' | 'taskId'> & {body: Uint8Array; text: string};
export type SourceProgress = (phase: 'fetching_source' | 'source_saved' | 'source_reused' | 'answering_sources', detail: string) => void;
export const sourceHash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const MAX_BYTES = 500_000;

export function publicSourceUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) throw new Error('Use a public HTTPS source URL of at most 2,000 characters.');
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !publicAddress(host))) throw new Error('Research links must use public HTTPS; private addresses and credentials are blocked.');
  if (url.hostname === 'raw.githubusercontent.com' && url.search) throw new Error('Use a public GitHub raw source URL without query parameters.');
  url.hash = '';
  return url.href;
}

/** Fixed publisher origin uses the same zero-redirect transport as other public feeds.
 * Arbitrary destinations retain DNS validation and address pinning in safeFetch.
 * Only the URL is sent: no question, project, PDF, vault data or caller headers. */
export async function readPublicSource(raw: string, signal?: AbortSignal): Promise<PublicPage> {
  const requestedUrl = publicSourceUrl(raw), url = new URL(requestedUrl);
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  bounded.throwIfAborted();
  let result: {bytes: Uint8Array; type: string; url: string};
  if (url.origin === 'https://raw.githubusercontent.com') {
    const response = await fetchWithoutRedirects(url, {credentials: 'omit', signal: bounded,
      headers: {'User-Agent': 'AnascummisStudio/0.1 (local research)', Accept: 'text/plain,text/html,application/json'}});
    if (!response.ok) {await response.body?.cancel(); throw new Error('Research source returned ' + response.status);}
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Research source has no response body.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        bounded.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BYTES) throw new Error('Research response too large (500,000 byte limit).');
        chunks.push(chunk.value);
      }
    } finally {await reader.cancel().catch(() => {});}
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    result = {bytes, type: (response.headers.get('content-type') || '').split(';')[0].toLowerCase(), url: requestedUrl};
  } else result = await safeFetch(requestedUrl, MAX_BYTES, bounded);
  bounded.throwIfAborted();
  return describePublicSource(requestedUrl, result);
}

export function describePublicSource(requestedUrl: string, result: {bytes: Uint8Array; type: string; url: string}): PublicPage {
  if (!['text/html', 'text/plain', 'application/json'].includes(result.type)) throw new Error('Choose a public HTML, plain-text or JSON source.');
  if (!result.bytes.length || result.bytes.length > MAX_BYTES) throw new Error('Research response is empty or exceeds 500,000 bytes.');
  const decoded = new TextDecoder('utf-8', {fatal: true}).decode(result.bytes);
  const title = result.type === 'text/html' ? decoded.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] : decoded.match(/^#\s+(.+)$/m)?.[1];
  const text = result.type === 'text/html' ? decoded.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim() : decoded;
  if (!text.trim()) throw new Error('The source contains no readable text.');
  return {requestedUrl, url: result.url, title: (title || new URL(result.url).pathname.split('/').filter(Boolean).at(-1) || new URL(result.url).hostname).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240),
    retrievedAt: new Date().toISOString(), type: result.type, bytes: result.bytes.length, textLength: text.length,
    sha256: sourceHash(result.bytes), textSha256: sourceHash(text), normalization: 'public-text-v1', body: result.bytes, text};
}

/** Immutable, goal-owned acquisition checkpoints. A saved acquisition survives a crash
 * before the orchestrator records its return value; explicit retry reuses it. */
export class PublicSourceLedger {
  constructor(private db: Database, private read = readPublicSource) {
    db.exec('CREATE TABLE IF NOT EXISTS goal_sources(id TEXT PRIMARY KEY,goal TEXT NOT NULL,task TEXT NOT NULL,metadata TEXT NOT NULL,body BLOB NOT NULL,text TEXT NOT NULL,UNIQUE(goal,task))');
  }
  list(goalId: string): SourceSnapshot[] {
    return (this.db.query('SELECT metadata FROM goal_sources WHERE goal=? ORDER BY rowid').all(goalId) as {metadata: string}[]).map(row => JSON.parse(row.metadata));
  }
  get(goalId: string, id: string): {source: SourceSnapshot; text: string; body: Uint8Array} {
    const row = this.db.query('SELECT metadata,body,text FROM goal_sources WHERE goal=? AND id=?').get(goalId, id) as {metadata: string; body: Uint8Array; text: string} | null;
    if (!row) throw new Error('Saved source not found in this goal.');
    const source = JSON.parse(row.metadata) as SourceSnapshot;
    if (source.goalId !== goalId || source.id !== id || source.sha256 !== sourceHash(row.body) || source.textSha256 !== sourceHash(row.text)
      || source.bytes !== row.body.length || source.textLength !== row.text.length) throw new Error('Saved source identity check failed. Start a new question to acquire a fresh source.');
    return {source, text: row.text, body: row.body};
  }
  async capture(goalId: string, taskId: string, raw: string, signal: AbortSignal, progress: SourceProgress): Promise<SourceSnapshot> {
    signal.throwIfAborted();
    const url = publicSourceUrl(raw), existing = this.list(goalId).find(source => source.taskId === taskId);
    if (existing) {
      const {source} = this.get(goalId, existing.id);
      if (source.requestedUrl !== url) throw new Error('This milestone already holds a different source. Start a new question.');
      progress('source_reused', 'Reusing the saved source from ' + source.retrievedAt + '; no new public request.');
      return source;
    }
    progress('fetching_source', 'Fetching public source: ' + url);
    const page = await this.read(url, signal);
    signal.throwIfAborted();
    const {body, text, ...metadata} = page;
    const source: SourceSnapshot = {...metadata, id: crypto.randomUUID(), goalId, taskId};
    this.db.query('INSERT INTO goal_sources(id,goal,task,metadata,body,text) VALUES(?,?,?,?,?,?)').run(source.id, goalId, taskId, JSON.stringify(source), body, text);
    progress('source_saved', 'Saved ' + source.bytes + ' response bytes and full text; SHA-256 ' + source.sha256 + '.');
    return source;
  }
  page(goalId: string, id: string, offset = 0) {
    const saved = this.get(goalId, id);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > saved.text.length) throw new Error('Invalid saved-text position.');
    return {source: saved.source, offset, end: Math.min(offset + 1000, saved.text.length), text: saved.text.slice(offset, offset + 1000)};
  }
}
