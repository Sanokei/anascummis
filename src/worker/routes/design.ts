import type { Hono } from 'hono';
import type { Env } from '../env';
import { resolveIdentity } from '../auth/session';
import { DesignWorkspace } from '../design/workspace';

/**
 * Serving rendered design work.
 *
 * A revision's pictures and its mesh are stored under a key the Worker chose,
 * and this route is the only way to read them. The key never arrives from the
 * client: the client sends a lab id, a revision id and a file name, and the
 * full key is rebuilt here and then checked against the session's own rows. A
 * key from another session therefore has nothing to match against, which is a
 * database fact rather than a string comparison someone could get wrong.
 *
 * The route is a GET, so there is no CSRF check — nothing changes. It does not
 * follow from that being safe that the content is public: every response is
 * `private, no-store`, because a guest's renders must not land in a shared
 * cache where the next visitor's browser could reuse them.
 */

/** File names this route will reconstruct a key from. Deliberately narrow. */
const FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,60}\.(?:png|glb)$/;
const LAB_ID = /^[a-z]+_[a-z0-9]{1,60}$/;
const REVISION_ID = /^[a-z]+_[a-z0-9]{1,60}$/;

/**
 * Turns three path segments into a storage key, or refuses.
 *
 * Exported so the refusal can be tested without an HTTP round trip. This is the
 * only place a client-supplied string contributes to a storage key, so it is
 * the place where a `..` or an absolute path would have to be stopped; the
 * patterns are anchored and admit no slash, no dot except the one before a known
 * extension, and no leading punctuation, which leaves nothing for a traversal to
 * be built from.
 */
export function renderKeyFromPath(labId: string, revisionId: string, file: string): string | null {
  if (!LAB_ID.test(labId) || !REVISION_ID.test(revisionId) || !FILE_NAME.test(file)) return null;
  return `design/${labId}/${revisionId}/${file}`;
}

export function registerDesignRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/design/:labId/renders/:revisionId/:file', async (c) => {
    const key = renderKeyFromPath(c.req.param('labId'), c.req.param('revisionId'), c.req.param('file'));
    if (key === null) {
      return c.json({ error: 'invalid-argument', message: 'That is not a renderable name.' }, 400);
    }

    const resolved = await resolveIdentity(c.req.raw, c.env);
    if (resolved.setCookie) c.header('Set-Cookie', resolved.setCookie, { append: true });

    const workspace = new DesignWorkspace(c.env);
    const bytes = await workspace.renderBytes(resolved.identity, c.req.param('labId'), key);
    if (!bytes.ok) {
      // A missing render and another session's render are both "no", and the
      // distinction is not disclosed: telling a caller that a key exists but
      // belongs to somebody else is a fact about another session's work.
      const status = bytes.kind === 'not-authorised' || bytes.kind === 'missing-capability' ? 404 : 400;
      return c.json({ error: bytes.kind, message: bytes.message }, status);
    }

    return new Response(bytes.value.bytes, {
      headers: {
        'Content-Type': bytes.value.mimeType,
        'Content-Length': String(bytes.value.bytes.byteLength),
        // Session-scoped content must not sit in a shared cache.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        // The validated segment, taken from the rebuilt key rather than the raw
        // parameter, so the name in the header is one the patterns above already
        // accepted.
        'Content-Disposition': `inline; filename="${key.slice(key.lastIndexOf('/') + 1)}"`,
      },
    });
  });
}
