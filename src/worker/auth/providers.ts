import type { Env } from '../env';

/**
 * Social login providers.
 *
 * Google and GitHub match the set the user already runs, so the two projects
 * stay operationally consistent. The implementation is original: no SlopSquash
 * source was readable in this environment, only its variable names.
 */

export type ProviderName = 'google' | 'github';

export interface ProviderConfig {
  name: ProviderName;
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  /** Google supports PKCE on the web flow; GitHub's OAuth app flow does not. */
  usesPkce: boolean;
  clientId: string;
  clientSecret: string;
}

export function configuredProviders(env: Env): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    out.push({
      name: 'google',
      displayName: 'Google',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scopes: ['openid', 'email', 'profile'],
      usesPkce: true,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    out.push({
      name: 'github',
      displayName: 'GitHub',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      scopes: ['read:user', 'user:email'],
      usesPkce: false,
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    });
  }
  return out;
}

export function findProvider(env: Env, name: string): ProviderConfig | null {
  return configuredProviders(env).find((p) => p.name === name) ?? null;
}

export interface ProviderProfile {
  providerUid: string;
  email: string | null;
  displayName: string | null;
}

export async function fetchProfile(
  provider: ProviderConfig,
  accessToken: string,
): Promise<ProviderProfile | null> {
  const res = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'Anascummis',
    },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, unknown>;

  if (provider.name === 'google') {
    const sub = typeof body.sub === 'string' ? body.sub : null;
    if (!sub) return null;
    return {
      providerUid: sub,
      // Only a verified address is trusted for account matching.
      email: body.email_verified === true && typeof body.email === 'string' ? body.email : null,
      displayName: typeof body.name === 'string' ? body.name : null,
    };
  }

  const id = typeof body.id === 'number' || typeof body.id === 'string' ? String(body.id) : null;
  if (!id) return null;
  let email = typeof body.email === 'string' ? body.email : null;
  if (!email) email = await fetchGithubPrimaryEmail(accessToken);
  return {
    providerUid: id,
    email,
    displayName: typeof body.name === 'string' ? body.name : (body.login as string | undefined) ?? null,
  };
}

async function fetchGithubPrimaryEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Anascummis',
    },
  });
  if (!res.ok) return null;
  const list = (await res.json()) as { email?: string; primary?: boolean; verified?: boolean }[];
  const primary = list.find((e) => e.primary && e.verified);
  return primary?.email ?? null;
}
