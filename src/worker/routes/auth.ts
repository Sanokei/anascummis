import type { Hono } from 'hono';
import type { Env } from '../env';
import { beginFlow, completeFlow, availableProviders } from '../auth/oauth';
import { resolveIdentity, revokeSession, safeRedirectPath, verifyCsrf } from '../auth/session';
import { statusFor } from './api';

/**
 * Sign-in routes.
 *
 * Application login is separate from Cloudflare resource authorisation, and
 * connecting Cloudflare never enables memory. Each control is its own action.
 */
export function registerAuthRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/auth/providers', (c) => c.json({ providers: availableProviders(c.env) }));

  app.get('/auth/:provider/start', async (c) => {
    const provider = c.req.param('provider');
    const resolved = await resolveIdentity(c.req.raw, c.env);

    // Linking attaches a provider to the account already signed in. It is only
    // offered when there is one, and never inferred from a matching email.
    const wantsLink = c.req.query('link') === '1';
    const linkUserId = wantsLink && resolved.identity.kind === 'user' ? resolved.identity.userId : null;

    const started = await beginFlow(
      c.req.raw,
      c.env,
      provider,
      c.req.query('redirect') ?? '/',
      linkUserId,
    );
    if (!started.ok) {
      return c.json({ error: started.kind, message: started.message }, statusFor(started.kind));
    }
    return c.redirect(started.value, 302);
  });

  app.get('/auth/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    const error = c.req.query('error');
    if (error) {
      return c.redirect(`/?auth_error=${encodeURIComponent(error)}`, 302);
    }

    const completed = await completeFlow(
      c.req.raw,
      c.env,
      provider,
      c.req.query('code') ?? null,
      c.req.query('state') ?? null,
    );
    if (!completed.ok) {
      return c.redirect(`/?auth_error=${encodeURIComponent(completed.message)}`, 302);
    }

    c.header('Set-Cookie', completed.value.setCookie, { append: true });
    // Guest work is not silently imported on sign-in. The client offers to
    // keep the current conversation, and the user decides.
    const target = safeRedirectPath(completed.value.redirectTo);
    const suffix = completed.value.linked ? 'linked=1' : 'signed_in=1';
    return c.redirect(`${target}${target.includes('?') ? '&' : '?'}${suffix}`, 302);
  });

  app.post('/auth/logout', async (c) => {
    const resolved = await resolveIdentity(c.req.raw, c.env);
    const checked = await verifyCsrf(c.req.raw, c.env, resolved.identity.sessionId, resolved.csrfSecret);
    if (!checked.ok) return c.json({ error: checked.kind, message: checked.message }, 403);

    // Logout revokes server-side access as well as clearing client state.
    const cookies = await revokeSession(c.env, c.req.raw, resolved.identity.sessionId);
    for (const cookie of cookies) c.header('Set-Cookie', cookie, { append: true });
    return c.json({ signedOut: true });
  });

  /**
   * Connect Cloudflare.
   *
   * A connected account does not authorise deployment by default; promotion to
   * a connected account needs an explicit target and its own approval.
   */
  app.get('/auth/cloudflare/start', async (c) => {
    if (!c.env.CLOUDFLARE_OAUTH_CLIENT_ID || !c.env.CLOUDFLARE_OAUTH_CLIENT_SECRET) {
      return c.json(
        {
          error: 'missing-credential',
          message:
            'Connect Cloudflare needs a registered OAuth client. Set CLOUDFLARE_OAUTH_CLIENT_ID and CLOUDFLARE_OAUTH_CLIENT_SECRET.',
        },
        422,
      );
    }
    const resolved = await resolveIdentity(c.req.raw, c.env);
    if (resolved.identity.kind !== 'user') {
      return c.json(
        { error: 'not-authorised', message: 'Sign in before connecting a Cloudflare account.' },
        403,
      );
    }
    return c.json(
      {
        error: 'unsupported-runtime',
        message:
          'The Cloudflare OAuth client for this deployment has not been registered, so the flow cannot be started. Nothing was connected.',
      },
      422,
    );
  });
}
