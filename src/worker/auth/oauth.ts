import type { Identity } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { pkceChallenge, randomId, randomToken } from '../crypto';
import {
  configuredProviders,
  fetchProfile,
  findProvider,
  type ProviderConfig,
  type ProviderProfile,
} from './providers';
import { createUserSession, safeRedirectPath } from './session';

/**
 * OAuth 2.0 authorisation-code flow.
 *
 * State is single-use and stored server-side with its PKCE verifier, so a
 * replayed callback is rejected. Account linking is deliberate: a matching
 * verified email never silently merges two provider identities into one
 * account unless the user asked for the link.
 */

const FLOW_TTL_MS = 10 * 60 * 1000;

export function callbackUrl(request: Request, env: Env, provider: string): string {
  const base = env.APP_URL ? new URL(env.APP_URL) : new URL(request.url);
  return `${base.origin}/auth/${provider}/callback`;
}

export async function beginFlow(
  request: Request,
  env: Env,
  providerName: string,
  redirectTo: string | null,
  linkUserId: string | null,
): Promise<Result<string>> {
  const provider = findProvider(env, providerName);
  if (!provider) {
    return fail('missing-credential', `${providerName} sign-in is not configured on this deployment.`);
  }

  const state = randomToken(32);
  const verifier = randomToken(48);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO oauth_flows (state, provider, code_verifier, redirect_to, link_user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      state,
      provider.name,
      verifier,
      safeRedirectPath(redirectTo),
      linkUserId,
      new Date(now).toISOString(),
      new Date(now + FLOW_TTL_MS).toISOString(),
    )
    .run();

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', callbackUrl(request, env, provider.name));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state);
  if (provider.usesPkce) {
    url.searchParams.set('code_challenge', await pkceChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (provider.name === 'google') {
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
  }
  return ok(url.toString());
}

export interface CallbackOutcome {
  userId: string;
  setCookie: string;
  redirectTo: string;
  linked: boolean;
}

export async function completeFlow(
  request: Request,
  env: Env,
  providerName: string,
  code: string | null,
  state: string | null,
): Promise<Result<CallbackOutcome>> {
  if (!code || !state) return fail('invalid-argument', 'The callback is missing its code or state.');

  const provider = findProvider(env, providerName);
  if (!provider) return fail('missing-credential', `${providerName} sign-in is not configured.`);

  // Single-use: the row is deleted as it is read, so a replay finds nothing.
  const flow = await env.DB.prepare(
    'SELECT provider, code_verifier, redirect_to, link_user_id, expires_at FROM oauth_flows WHERE state = ?',
  )
    .bind(state)
    .first<{
      provider: string;
      code_verifier: string;
      redirect_to: string;
      link_user_id: string | null;
      expires_at: string;
    }>();
  await env.DB.prepare('DELETE FROM oauth_flows WHERE state = ?').bind(state).run();

  if (!flow) return fail('not-authorised', 'This sign-in link is no longer valid. Start again.');
  if (flow.provider !== provider.name) {
    return fail('not-authorised', 'The callback provider does not match the one the flow started with.');
  }
  if (Date.parse(flow.expires_at) < Date.now()) {
    return fail('not-authorised', 'This sign-in attempt expired. Start again.');
  }

  const token = await exchangeCode(request, env, provider, code, flow.code_verifier);
  if (!token.ok) return token;

  const profile = await fetchProfile(provider, token.value);
  if (!profile) return fail('upstream-error', `${provider.displayName} did not return a usable profile.`);

  const userId = await resolveUser(env, provider, profile, flow.link_user_id);
  if (!userId.ok) return userId;

  const session = await createUserSession(env, request, userId.value.userId);
  if (!session.ok) return session;

  return ok({
    userId: userId.value.userId,
    setCookie: session.value.setCookie,
    redirectTo: safeRedirectPath(flow.redirect_to),
    linked: userId.value.linked,
  });
}

async function exchangeCode(
  request: Request,
  env: Env,
  provider: ProviderConfig,
  code: string,
  verifier: string,
): Promise<Result<string>> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: callbackUrl(request, env, provider.name),
  });
  if (provider.usesPkce) body.set('code_verifier', verifier);

  try {
    const res = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!res.ok) {
      return fail('upstream-error', `${provider.displayName} rejected the token exchange (${res.status}).`);
    }
    const parsed = (await res.json()) as { access_token?: string; error?: string };
    if (parsed.error || !parsed.access_token) {
      return fail('upstream-error', `${provider.displayName} did not return an access token.`);
    }
    return ok(parsed.access_token);
  } catch (err) {
    return fail('upstream-error', `Token exchange failed: ${String(err)}`);
  }
}

/**
 * Finds or creates the account behind a provider identity.
 *
 * Linking rules:
 *   - a known provider identity signs into its existing account;
 *   - an explicit link request attaches the identity to the named account;
 *   - otherwise a new account is created, even when the verified email matches
 *     an existing one. Automatic merge on email is a known account-takeover
 *     path, so the two accounts stay separate until the user links them.
 */
async function resolveUser(
  env: Env,
  provider: ProviderConfig,
  profile: ProviderProfile,
  linkUserId: string | null,
): Promise<Result<{ userId: string; linked: boolean }>> {
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    'SELECT user_id FROM identities WHERE provider = ? AND provider_uid = ?',
  )
    .bind(provider.name, profile.providerUid)
    .first<{ user_id: string }>();

  if (existing) {
    if (linkUserId && linkUserId !== existing.user_id) {
      return fail(
        'not-authorised',
        `That ${provider.displayName} account is already linked to a different Anascummis account.`,
      );
    }
    return ok({ userId: existing.user_id, linked: false });
  }

  if (linkUserId) {
    const owner = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL')
      .bind(linkUserId)
      .first<{ id: string }>();
    if (!owner) return fail('not-authorised', 'The account to link to no longer exists.');
    await env.DB.prepare(
      'INSERT INTO identities (id, user_id, provider, provider_uid, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(randomId('ident'), linkUserId, provider.name, profile.providerUid, profile.email, now)
      .run();
    return ok({ userId: linkUserId, linked: true });
  }

  const userId = randomId('user');
  // The unique index on email means a second account with the same verified
  // address is stored without one, rather than being merged automatically.
  const emailTaken = profile.email
    ? await env.DB.prepare('SELECT id FROM users WHERE email = ?')
        .bind(profile.email)
        .first<{ id: string }>()
    : null;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, email, display_name, created_at, memory_enabled) VALUES (?, ?, ?, ?, 0)',
    ).bind(userId, emailTaken ? null : profile.email, profile.displayName, now),
    env.DB.prepare(
      'INSERT INTO identities (id, user_id, provider, provider_uid, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(randomId('ident'), userId, provider.name, profile.providerUid, profile.email, now),
  ]);

  return ok({ userId, linked: false });
}

/** Providers offered in the interface. An unconfigured one is simply absent. */
export function availableProviders(env: Env): { name: string; displayName: string }[] {
  return configuredProviders(env).map((p) => ({ name: p.name, displayName: p.displayName }));
}

export function identityIsUser(identity: Identity): identity is Extract<Identity, { kind: 'user' }> {
  return identity.kind === 'user';
}
