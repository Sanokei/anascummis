import type { Identity } from '@shared/types';
import { ok, type Result } from '@shared/types';
import type { Env } from '../env';
import { randomId } from '../crypto';
import { isSuperAdmin, type AccessIdentity } from './access';
import { createUserSession } from './session';

/**
 * Turns a verified Access identity into an application account.
 *
 * Access answers "may this person reach the Worker". This answers "who are
 * they here", which is a separate question with a separate answer. The role is
 * granted from the configured super-admin list, never inferred from the email
 * domain, so widening the Access policy cannot accidentally create admins.
 */

export type Role = 'member' | 'admin' | 'super-admin';

export interface ResolvedAccount {
  userId: string;
  email: string;
  displayName: string | null;
  role: Role;
  /** Set when this sign-in created the account. */
  created: boolean;
}

export async function resolveAccessAccount(
  env: Env,
  access: AccessIdentity,
): Promise<Result<ResolvedAccount>> {
  const now = new Date().toISOString();
  const email = access.email;
  const shouldBeSuper = isSuperAdmin(env, email);

  const existing = await env.DB.prepare(
    'SELECT id, email, display_name, role FROM users WHERE email = ? AND deleted_at IS NULL',
  )
    .bind(email)
    .first<{ id: string; email: string; display_name: string | null; role: string }>();

  if (existing) {
    // The configured list is the authority, so removing an address from it
    // demotes on the next sign-in rather than leaving a stale admin.
    const role: Role = shouldBeSuper ? 'super-admin' : normaliseRole(existing.role, false);
    if (role !== existing.role) {
      await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, existing.id).run();
    }
    await recordSighting(env, access, existing.id, now);
    return ok({
      userId: existing.id,
      email: existing.email,
      displayName: existing.display_name,
      role,
      created: false,
    });
  }

  const userId = randomId('user');
  const role: Role = shouldBeSuper ? 'super-admin' : 'member';

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, email, display_name, created_at, memory_enabled, role) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind(userId, email, null, now, role),
    // The Access identity is recorded as its own provider link, so a later
    // social login can be attached deliberately rather than merged on email.
    env.DB.prepare(
      'INSERT INTO identities (id, user_id, provider, provider_uid, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(randomId('ident'), userId, 'cloudflare-access', access.subject, email, now),
  ]);

  await recordSighting(env, access, userId, now);
  return ok({ userId, email, displayName: null, role, created: true });
}

async function recordSighting(
  env: Env,
  access: AccessIdentity,
  userId: string,
  now: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO access_identities (subject, email, user_id, first_seen_at, last_seen_at, seen_count)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(subject) DO UPDATE SET
       email = excluded.email,
       user_id = excluded.user_id,
       last_seen_at = excluded.last_seen_at,
       seen_count = access_identities.seen_count + 1`,
  )
    .bind(access.subject, access.email, userId, now, now)
    .run();
}

function normaliseRole(raw: string, allowSuper: boolean): Role {
  if (raw === 'super-admin') return allowSuper ? 'super-admin' : 'member';
  if (raw === 'admin') return 'admin';
  return 'member';
}

/**
 * Ensures the Access-authenticated person has an application session.
 *
 * Access renews its own token on its own schedule, so the application session
 * is created once and then reused, rather than minted on every request.
 */
export async function ensureAccessSession(
  env: Env,
  request: Request,
  account: ResolvedAccount,
  currentIdentity: Identity,
): Promise<{ setCookie: string | null; identity: Identity }> {
  if (currentIdentity.kind === 'user' && currentIdentity.userId === account.userId) {
    return { setCookie: null, identity: currentIdentity };
  }

  const session = await createUserSession(env, request, account.userId);
  if (!session.ok) {
    // Without a signable session the request still proceeds as the verified
    // Access identity for this one request, but nothing durable is written.
    return { setCookie: null, identity: currentIdentity };
  }

  return {
    setCookie: session.value.setCookie,
    identity: {
      kind: 'user',
      sessionId: session.value.sessionId,
      userId: account.userId,
      email: account.email,
      displayName: account.displayName,
    },
  };
}

export async function roleOf(env: Env, identity: Identity): Promise<Role> {
  if (identity.kind !== 'user') return 'member';
  const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?')
    .bind(identity.userId)
    .first<{ role: string }>();
  return normaliseRole(row?.role ?? 'member', true);
}
