import type { Hono } from 'hono';
import type { Env } from '../env';
import { resolveIdentity } from '../auth/session';
import { GENERATED_ID } from '../crypto';
import { DesignWorkspace } from '../design/workspace';
import { MAX_ROUNDS_PER_DESIGN_LAB, REVIEW_CAVEAT } from '../design/types';

/**
 * Serving design work: a revision's rendered bytes, and the record of the
 * review that was taken of them.
 *
 * A revision's pictures and its mesh are stored under a key the Worker chose,
 * and this route is the only way to read them. The key never arrives from the
 * client: the client sends a lab id, a revision id and a file name, and the
 * full key is rebuilt here and then checked against the session's own rows. A
 * key from another session therefore has nothing to match against, which is a
 * database fact rather than a string comparison someone could get wrong.
 *
 * The revision route returns the recorded review as one flat object, because
 * the client spreads the body straight into the component that draws it. That
 * is also why the lab's own fields travel in it: a screen that showed verdicts
 * without the round they were taken in, or without the caveat that says what an
 * opinion is worth, would be drawing the numbers without their meaning.
 *
 * Both routes are GETs, so there is no CSRF check — neither changes anything,
 * and no CORS headers are sent, so another page can make the request but cannot
 * read the answer. It does not follow from that being safe that the content is
 * public: every response is `private, no-store`, because a guest's renders must
 * not land in a shared cache where the next visitor's browser could reuse them,
 * and the record of the round that produced them is no more shareable.
 */

/**
 * File names this route will reconstruct a key from. Deliberately narrow.
 *
 * Lab and revision ids are not narrowed here. Both are the shape `randomId`
 * writes, and that shape belongs to `GENERATED_ID`, which lives beside the
 * generator that mints it. Restating the grammar per call site is how two
 * copies drift apart, and the drift is silent in the worse direction: a
 * perfectly valid id starts being refused by whichever copy was not updated,
 * and the refusal reads like a revision that is not there.
 */
const FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,60}\.(?:png|glb)$/;

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
  if (!GENERATED_ID.test(labId) || !GENERATED_ID.test(revisionId) || !FILE_NAME.test(file)) {
    return null;
  }
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

  app.get('/api/design/:labId/revisions/:revisionId', async (c) => {
    // Set before the first return, so a refusal carries them too: the 404 for a
    // revision that is not this session's is a statement about that session's
    // work, and must not be reused by whoever asks next.
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');

    const labId = c.req.param('labId');
    const revisionId = c.req.param('revisionId');
    if (!GENERATED_ID.test(labId) || !GENERATED_ID.test(revisionId)) {
      return c.json({ error: 'invalid-argument', message: 'That is not a readable revision.' }, 400);
    }

    const resolved = await resolveIdentity(c.req.raw, c.env);
    if (resolved.setCookie) c.header('Set-Cookie', resolved.setCookie, { append: true });

    const workspace = new DesignWorkspace(c.env);
    const lab = await workspace.load(resolved.identity, labId);
    if (!lab.ok) {
      // The byte route's choice, for the same reason: a lab this session cannot
      // see is not reported as somebody else's, because that is a fact about
      // another session's work.
      const status = lab.kind === 'not-authorised' || lab.kind === 'missing-capability' ? 404 : 400;
      return c.json({ error: lab.kind, message: lab.message }, status);
    }

    // `history` is already bounded to this session and this lab, so a revision
    // of another session's is not refused here — it is absent, which is the same
    // answer as a revision that never existed. The two have to be
    // indistinguishable, and the only way to keep them so is not to look at the
    // id anywhere it could be found.
    const history = await workspace.history(resolved.identity, labId);
    const index = history.findIndex((entry) => String(entry.id) === revisionId);
    const row = index === -1 ? undefined : history[index];
    if (!row) {
      return c.json({ error: 'missing-capability', message: 'No such revision in this lab.' }, 404);
    }

    const surface = lab.value.surface;
    return c.json({
      labId: lab.value.id,
      revisionId: String(row.id),
      title: lab.value.title,
      surface,
      // The revision's own round, which is its position in the history — not
      // `lab.rounds`, which is a running total read at the moment of the
      // request. Reading the lab's counter put a lab that had since reached
      // round 3 next to round 1's revision and round 1's criteria, labelled
      // "round 3 of 4": the two numbers on screen agreed with each other and
      // with nothing the reader was looking at. `history` is ordered oldest
      // first, so the index is the round the revision was submitted in.
      round: index + 1,
      maxRounds: MAX_ROUNDS_PER_DESIGN_LAB,
      // The columns are handed back as they were recorded, without being
      // re-derived: the row *is* the record of what was decided, and a body
      // rebuilt from the source at read time could disagree with it.
      verdicts: parseArray(row.verdicts),
      allVerified: row.all_verified === 1,
      counts: parseObject(row.counts),
      otherObservations: parseArray(row.other_observations),
      refused: parseArray(row.refused),
      reviewedBy:
        row.reviewed_by === null || row.reviewed_by === undefined ? null : String(row.reviewed_by),
      // Present as null when nothing was recorded, where `design.read` omits the
      // key: there absence is the unambiguous signal to a caller reading keys,
      // while this body is spread straight into the component's props, where a
      // missing key and a null draw the same panel.
      unrendered: typeof row.unrendered === 'string' ? row.unrendered : null,
      caveat: REVIEW_CAVEAT,
      // The revision's own timestamp, because the review is written in the same
      // batch as the revision it describes — there is no separate moment
      // recorded to report, and inventing one would be a made-up fact.
      reviewedAt: String(row.created_at),
      issues: parseArray(row.issues),
      renderKeys: parseRenderKeys(row.views),
      // Derived from the ids rather than read from `render_key`, for the reason
      // `renderBytes` gives when it serves the bytes: that column holds a single
      // primary key, and a scene with views has its contact sheet there, so the
      // mesh would be unreachable from it in every case but the degenerate one
      // where nothing rendered and the mesh became the primary key.
      glbKey: surface === 'scene' ? `design/${labId}/${revisionId}/mesh.glb` : null,
    });
  });
}

/**
 * A JSON column, read back as an array.
 *
 * These columns are written by this Worker, so the shape going in is known —
 * but a column is text on the way out, and a row written by an older version of
 * the schema, or half-copied by a migration, should cost a caller one empty
 * field rather than a 500. A value that will not parse is treated as absent.
 */
function parseArray(value: unknown): unknown[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The same, for the one column that holds an object. `{}` rather than a throw. */
function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * `views` as the workspace records it — `[{view, key}]` — turned into the view
 * name to key map the client draws from.
 *
 * A view whose key is null was never written to the store, so it is left out
 * rather than mapped to an empty string, which the client would ask the byte
 * route for as a file named nothing.
 */
function parseRenderKeys(value: unknown): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const entry of parseArray(value)) {
    if (!entry || typeof entry !== 'object') continue;
    const { view, key } = entry as Record<string, unknown>;
    if (typeof view === 'string' && view !== '' && typeof key === 'string' && key !== '') {
      keys[view] = key;
    }
  }
  return keys;
}
