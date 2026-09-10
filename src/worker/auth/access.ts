import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { fromBase64url } from '../crypto';

/**
 * Cloudflare Access gate.
 *
 * Access terminates identity at the edge and forwards a signed JWT. This
 * module verifies that JWT itself rather than trusting the header's presence,
 * because a header alone proves nothing: a request that reached the Worker by
 * some other path would carry whatever header it liked.
 *
 * Verification checks the RS256 signature against the team's published keys,
 * the `aud` against this application's own audience tag, the issuer against
 * the configured team domain, and the expiry. Any failure is a refusal.
 *
 * The gate fails closed. When `ACCESS_REQUIRED` is on and Access is not
 * configured or a token does not verify, nothing is served.
 */

export interface AccessIdentity {
  email: string;
  /** Access user id, stable per identity. */
  subject: string;
  /** The identity provider Access used. */
  issuer: string;
  expiresAt: number;
}

interface AccessJwtPayload {
  aud?: string | string[];
  email?: string;
  sub?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  identity_nonce?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

const JWKS_CACHE_KEY = 'access:jwks';
const JWKS_TTL_SECONDS = 3600;
const CLOCK_SKEW_SECONDS = 60;

export function accessConfigured(env: Env): boolean {
  return Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

export function accessRequired(env: Env): boolean {
  return env.ACCESS_REQUIRED !== 'false';
}

/** Pulled out of the token, never out of a header a caller can set. */
export function readAccessToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return match?.[1] ?? null;
}

export async function verifyAccess(env: Env, request: Request): Promise<Result<AccessIdentity>> {
  if (!accessConfigured(env)) {
    return fail(
      'missing-credential',
      'Cloudflare Access is not configured for this deployment. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.',
    );
  }

  const token = readAccessToken(request);
  if (!token) {
    return fail('not-authorised', 'No Cloudflare Access token was presented.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) return fail('not-authorised', 'The Access token is malformed.');
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  let header: { kid?: string; alg?: string };
  let payload: AccessJwtPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64url(rawHeader)));
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(rawPayload)));
  } catch {
    return fail('not-authorised', 'The Access token could not be decoded.');
  }

  // Only RS256 is accepted. Allowing the token to name its own algorithm is
  // how "alg: none" and HMAC-confusion attacks work.
  if (header.alg !== 'RS256') {
    return fail('not-authorised', `Unexpected Access token algorithm: ${header.alg ?? 'none'}`);
  }
  if (!header.kid) return fail('not-authorised', 'The Access token names no signing key.');

  const teamDomain = normaliseTeamDomain(env.CF_ACCESS_TEAM_DOMAIN!);
  const expectedIssuer = `https://${teamDomain}`;
  if (payload.iss !== expectedIssuer) {
    return fail('not-authorised', 'The Access token was issued by a different team.');
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(env.CF_ACCESS_AUD!)) {
    return fail('not-authorised', 'The Access token is for a different application.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) {
    return fail('not-authorised', 'The Access token has expired. Sign in again.');
  }
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > now) {
    return fail('not-authorised', 'The Access token is not valid yet.');
  }

  const keys = await fetchJwks(env, teamDomain);
  if (!keys.ok) return keys;

  const jwk = keys.value.find((k) => k.kid === header.kid);
  if (!jwk) {
    return fail('not-authorised', 'The Access token was signed by an unrecognised key.');
  }

  const verified = await verifySignature(jwk, `${rawHeader}.${rawPayload}`, rawSignature);
  if (!verified) return fail('not-authorised', 'The Access token signature did not verify.');

  const email = (payload.email ?? '').trim().toLowerCase();
  if (!email) return fail('not-authorised', 'The Access token carries no email address.');

  const allowed = allowedEmail(env, email);
  if (!allowed.ok) return allowed;

  return ok({
    email,
    subject: payload.sub ?? email,
    issuer: expectedIssuer,
    expiresAt: payload.exp * 1000,
  });
}

/**
 * Defence in depth behind the Access policy.
 *
 * The Access application's own policy is the primary control. This second
 * check exists so a misconfigured policy does not silently widen the audience,
 * and it is skipped only when no allowlist is configured at all.
 */
export function allowedEmail(env: Env, email: string): Result<true> {
  const supers = parseList(env.SUPER_ADMIN_EMAILS);
  if (supers.includes(email)) return ok(true);

  const domains = parseList(env.ACCESS_ALLOWED_DOMAINS);
  if (domains.length === 0) return ok(true);

  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (domains.includes(domain)) return ok(true);

  return fail(
    'not-authorised',
    `${email} is not on the allowed list for this deployment.`,
  );
}

export function isSuperAdmin(env: Env, email: string): boolean {
  return parseList(env.SUPER_ADMIN_EMAILS).includes(email.trim().toLowerCase());
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
}

function normaliseTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return trimmed.includes('.') ? trimmed : `${trimmed}.cloudflareaccess.com`;
}

/** Keys are cached, because fetching them on every request would be absurd. */
async function fetchJwks(env: Env, teamDomain: string): Promise<Result<Jwk[]>> {
  const cached = await env.CACHE.get(JWKS_CACHE_KEY, 'json');
  if (cached && Array.isArray(cached)) return ok(cached as Jwk[]);

  try {
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      return fail('upstream-error', `Access key set returned ${res.status}.`);
    }
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = body.keys ?? [];
    if (keys.length === 0) return fail('upstream-error', 'Access published no signing keys.');
    await env.CACHE.put(JWKS_CACHE_KEY, JSON.stringify(keys), { expirationTtl: JWKS_TTL_SECONDS });
    return ok(keys);
  } catch (err) {
    return fail('upstream-error', `Could not fetch the Access key set: ${String(err)}`);
  }
}

async function verifySignature(jwk: Jwk, signingInput: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      fromBase64url(signature),
      new TextEncoder().encode(signingInput),
    );
  } catch {
    return false;
  }
}

/** Rendered when the gate refuses, so the reason is visible rather than a blank 403. */
export function accessDeniedResponse(reason: string, configured: boolean): Response {
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anascummis</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0f0f0e; color:#ece8df;
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif }
  main { max-width:34rem; padding:2rem }
  h1 { font-size:1.1rem; margin:0 0 .75rem; font-weight:500 }
  p { color:#9c978c; margin:0 0 .75rem }
  code { font-family:ui-monospace,Menlo,monospace; font-size:.85em; color:#c98a3c }
</style></head>
<body><main>
<h1>This deployment is closed</h1>
<p>${escapeHtml(reason)}</p>
${
  configured
    ? '<p>If you should have access, sign in through Cloudflare Access and try again.</p>'
    : '<p>The operator needs to finish the Cloudflare Access setup before anyone can get in. Nothing is being served until then.</p>'
}
</main></body></html>`;
  return new Response(body, {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
