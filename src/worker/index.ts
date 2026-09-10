import { Hono } from 'hono';
import type { Env } from './env';
import { registerApiRoutes } from './routes/api';
import { registerAuthRoutes } from './routes/auth';
import { SessionCoordinator } from './do/session-coordinator';

export { SessionCoordinator };

const app = new Hono<{ Bindings: Env }>();

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

app.get('/healthz', (c) =>
  c.json({
    ok: true,
    service: 'anascummis',
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
