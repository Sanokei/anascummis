import type { Identity } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { hmacSign, hmacVerify, randomId, randomToken, sha256Hex, timingSafeEqual } from '../crypto';

/**
 * Sessions and CSRF.
 *
 * A session cookie carries an opaque id plus an HMAC over it. The id alone is
 * useless without the signature, and the signature is useless without the id,
 * so a leaked half is not a session. Every durable write re-checks identity
 * and ownership server-side, including one arriving late from a worker job.
 */

const SESSION_COOKIE = '__Host-anascummis_session';
const GUEST_COOKIE = '__Host-anascummis_guest';
const CSRF_HEADER = 'x-anascummis-csrf';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const GUEST_TTL_SECONDS = 24 * 60 * 60;

export interface SessionRecord {
  id: string;
  userId: string | null;
  csrfSecret: string;
  expiresAt: string;
}

export function sessionSecret(env: Env): Result<string> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return fail(
      'missing-credential',
      'SESSION_SECRET is not set, or is shorter than 32 characters. Sessions cannot be signed.',
    );
  }
  return ok(env.SESSION_SECRET);
}

export function parseCookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  const header = request.headers.get('cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    out.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return out;
}

function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAge}`,
  ];
  // The __Host- prefix requires Secure, so the name is downgraded on plain http
  // during local development rather than silently dropping the attribute.
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function cookieName(base: string, secure: boolean): string {
  return secure ? base : base.replace('__Host-', '');
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

/**
 * Resolves the caller's identity. A guest gets a signed, expiry-bound id so
 * their session workspace and cache entries can be scoped, which is not the
 * same as durable memory: no guest row is ever written to `users`.
 */
export async function resolveIdentity(
  request: Request,
  env: Env,
): Promise<{ identity: Identity; setCookie: string | null; csrfSecret: string }> {
  const secure = isSecureRequest(request);
  const cookies = parseCookies(request);
  const secret = sessionSecret(env);

  if (secret.ok) {
    const raw = cookies.get(cookieName(SESSION_COOKIE, secure));
    if (raw) {
      const verified = await verifySignedValue(secret.value, raw);
      if (verified) {
        const row = await env.DB.prepare(
          `SELECT s.id, s.user_id, s.csrf_secret, s.expires_at, u.email, u.display_name
           FROM sessions s LEFT JOIN users u ON u.id = s.user_id
           WHERE s.id = ? AND s.revoked_at IS NULL`,
        )
          .bind(verified)
          .first<{
            id: string;
            user_id: string | null;
            csrf_secret: string;
            expires_at: string;
            email: string | null;
            display_name: string | null;
          }>();
        if (row && Date.parse(row.expires_at) > Date.now()) {
          if (row.user_id) {
            return {
              identity: {
                kind: 'user',
                sessionId: row.id,
                userId: row.user_id,
                email: row.email,
                displayName: row.display_name,
              },
              setCookie: null,
              csrfSecret: row.csrf_secret,
            };
          }
          return {
            identity: { kind: 'guest', sessionId: row.id },
            setCookie: null,
            csrfSecret: row.csrf_secret,
          };
        }
      }
    }
  }

  // Guest path. Signed when a secret exists, opaque-random otherwise, so local
  // development without a secret still works but never claims to be signed.
  const guestRaw = cookies.get(cookieName(GUEST_COOKIE, secure));
  if (guestRaw && secret.ok) {
    const verified = await verifySignedValue(secret.value, guestRaw);
    if (verified) {
      return {
        identity: { kind: 'guest', sessionId: verified },
        setCookie: null,
        csrfSecret: await guestCsrfSecret(secret.value, verified),
      };
    }
  }

  const sessionId = randomId('guest');
  const value = secret.ok ? await signValue(secret.value, sessionId) : sessionId;
  return {
    identity: { kind: 'guest', sessionId },
    setCookie: serializeCookie(cookieName(GUEST_COOKIE, secure), value, {
      maxAge: GUEST_TTL_SECONDS,
      secure,
    }),
    csrfSecret: secret.ok ? await guestCsrfSecret(secret.value, sessionId) : sessionId,
  };
}

/** A guest's CSRF secret is derived, so it needs no row and no storage. */
async function guestCsrfSecret(secret: string, sessionId: string): Promise<string> {
  return sha256Hex(`csrf:${secret}:${sessionId}`);
}

export async function createUserSession(
  env: Env,
  request: Request,
  userId: string,
): Promise<Result<{ sessionId: string; setCookie: string }>> {
  const secret = sessionSecret(env);
  if (!secret.ok) return secret;

  const sessionId = randomId('sess');
  const csrfSecret = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const agentHash = await sha256Hex(request.headers.get('user-agent') ?? '');

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, csrf_secret, user_agent_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, new Date().toISOString(), expiresAt, csrfSecret, agentHash)
    .run();

  const secure = isSecureRequest(request);
  const signed = await signValue(secret.value, sessionId);
  return ok({
    sessionId,
    setCookie: serializeCookie(cookieName(SESSION_COOKIE, secure), signed, {
      maxAge: SESSION_TTL_SECONDS,
      secure,
    }),
  });
}

/** Logout revokes server-side access as well as clearing the cookie. */
export async function revokeSession(env: Env, request: Request, sessionId: string): Promise<string[]> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), sessionId)
    .run();
  const secure = isSecureRequest(request);
  return [
    serializeCookie(cookieName(SESSION_COOKIE, secure), '', { maxAge: 0, secure }),
    serializeCookie(cookieName(GUEST_COOKIE, secure), '', { maxAge: 0, secure }),
  ];
}

/* ------------------------------------------------------------------ */
/* CSRF                                                                */
/* ------------------------------------------------------------------ */

export async function csrfToken(csrfSecret: string, sessionId: string): Promise<string> {
  return hmacSign(csrfSecret, `csrf:${sessionId}`);
}

/**
 * Double-submit with an origin check. A state-changing request must carry the
 * header token *and* come from an allowed origin, because either alone has
 * known bypasses.
 */
export async function verifyCsrf(
  request: Request,
  env: Env,
  sessionId: string,
  csrfSecret: string,
): Promise<Result<true>> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return ok(true);

  const origin = request.headers.get('origin');
  if (origin) {
    const allowed = allowedOrigins(request, env);
    if (!allowed.has(origin)) {
      return fail('not-authorised', `Origin ${origin} is not allowed to make this request.`);
    }
  }

  const supplied = request.headers.get(CSRF_HEADER);
  if (!supplied) return fail('not-authorised', 'Missing CSRF token.');
  const valid = await hmacVerify(csrfSecret, `csrf:${sessionId}`, supplied);
  if (!valid) return fail('not-authorised', 'CSRF token does not match this session.');
  return ok(true);
}

export function allowedOrigins(request: Request, env: Env): Set<string> {
  const out = new Set<string>();
  out.add(new URL(request.url).origin);
  if (env.APP_URL) {
    try {
      out.add(new URL(env.APP_URL).origin);
    } catch {
      /* A malformed APP_URL simply contributes no origin. */
    }
  }
  return out;
}

/**
 * Redirect targets are allowlisted to same-origin paths. An absolute URL, a
 * protocol-relative URL, or a backslash trick is rejected rather than cleaned.
 */
export function safeRedirectPath(candidate: string | null): string {
  if (!candidate) return '/';
  if (!candidate.startsWith('/')) return '/';
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return '/';
  if (/[\r\n]/.test(candidate)) return '/';
  return candidate;
}

/* ------------------------------------------------------------------ */
/* Signed values                                                       */
/* ------------------------------------------------------------------ */

async function signValue(secret: string, value: string): Promise<string> {
  const signature = await hmacSign(secret, value);
  return `${value}.${signature}`;
}

async function verifySignedValue(secret: string, signed: string): Promise<string | null> {
  const index = signed.lastIndexOf('.');
  if (index < 1) return null;
  const value = signed.slice(0, index);
  const signature = signed.slice(index + 1);
  const expected = await hmacSign(secret, value);
  if (!timingSafeEqual(signature, expected)) return null;
  return value;
}

export const COOKIE_NAMES = { SESSION_COOKIE, GUEST_COOKIE, CSRF_HEADER };
