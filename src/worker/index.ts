import { Hono } from 'hono';
import type { Env } from './env';
import { registerApiRoutes } from './routes/api';
import { registerAuthRoutes } from './routes/auth';
import { SessionCoordinator } from './do/session-coordinator';
import { accessConfigured, accessDeniedResponse, accessRequired, verifyAccess } from './auth/access';
import { resolveAccessAccount, ensureAccessSession } from './auth/access-identity';
import { resolveIdentity } from './auth/session';

export { SessionCoordinator };

const app = new Hono<{ Bindings: Env }>();

/**
 * Cloudflare Access gate.
 *
 * This runs before everything else and fails closed. When Access is required
 * but not configured, or a token does not verify, nothing is served: not the
 * client, not the API, not a stray asset. The one exception is the health
 * check, which reports liveness without revealing anything about the site.
 */
app.use('*', async (c, next) => {
  if (c.req.path === '/healthz') return next();
  if (!accessRequired(c.env)) return next();

  if (!accessConfigured(c.env)) {
    return accessDeniedResponse(
      'Cloudflare Access has not been configured for this deployment, so the gate cannot verify anyone.',
      false,
    );
  }

  const verified = await verifyAccess(c.env, c.req.raw);
  if (!verified.ok) {
    return accessDeniedResponse(verified.message, true);
  }

  // A verified Access identity becomes an application account, and the role
  // comes from the configured list rather than from the email domain.
  const account = await resolveAccessAccount(c.env, verified.value);
  if (account.ok) {
    const current = await resolveIdentity(c.req.raw, c.env);
    const session = await ensureAccessSession(c.env, c.req.raw, account.value, current.identity);
    if (session.setCookie) c.header('Set-Cookie', session.setCookie, { append: true });
  }

  return next();
});

/**
 * Security headers.
 *
 * The Content-Security-Policy is deliberately tight: no inline script, no
 * external script origin, and no framing. A generated artifact is displayed as
 * text, never executed in this origin.
 */
app.use('*', async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set(
    'Permissions-Policy',
    'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
  );
  if (!headers.has('Content-Security-Policy')) {
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '),
    );
  }
});

/** Liveness only. It deliberately says nothing about who may get in. */
app.get('/healthz', (c) =>
  c.json({
    ok: true,
    service: 'anascummis',
    accessGate: accessRequired(c.env) ? (accessConfigured(c.env) ? 'enforced' : 'unconfigured') : 'off',
    at: new Date().toISOString(),
  }),
);

registerAuthRoutes(app);
registerApiRoutes(app);

// Anything else is the single-page client, served from the assets binding.
app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/')) {
    return c.json({ error: 'not-found', message: `No route for ${c.req.path}.` }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
