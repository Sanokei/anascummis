import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { fileURLToPath } from 'node:url';

export default defineWorkersConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: fileURLToPath(new URL('./src/shared', import.meta.url)) },
      { find: '@worker', replacement: fileURLToPath(new URL('./src/worker', import.meta.url)) },
      // fengari's lualib eagerly pulls in loslib and ldblib, which require
      // `tmp` and `readline-sync`; both call process.binding and cannot load
      // on workerd. wrangler.jsonc substitutes stubs for the deployed Worker,
      // and the test runtime needs the same substitution or importing the
      // sandbox fails outright. Anchored so only the bare specifier matches.
      { find: /^tmp$/, replacement: fileURLToPath(new URL('./tests/helpers/tmp-stub.cjs', import.meta.url)) },
      {
        find: /^readline-sync$/,
        replacement: fileURLToPath(new URL('./tests/helpers/readline-stub.cjs', import.meta.url)),
      },
      // fengari also reads os.platform() to pick Lua's module search paths.
      // The deployed Worker gets node:os from the runtime; the pinned test
      // runtime does not resolve it, so the import fails before any test runs.
      { find: /^(node:)?os$/, replacement: fileURLToPath(new URL('./tests/helpers/os-stub.cjs', import.meta.url)) },
      {
        find: /^(node:)?child_process$/,
        replacement: fileURLToPath(new URL('./tests/helpers/child-process-stub.cjs', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // fengari is CommonJS with circular requires between fengari.js and
    // loadlib.js. Vite's per-module transform turns those into ES bindings and
    // the cycle then throws on a binding read before initialisation. Letting
    // esbuild pre-bundle the package resolves the cycle the same way wrangler
    // does for the deployed Worker.
    deps: {
      optimizer: {
        ssr: { enabled: true, include: ['fengari'] },
      },
    },
    poolOptions: {
      workers: {
        singleWorker: true,
        // Durable Object bindings resolve their class from this module.
        main: './tests/helpers/worker-entry.ts',
        miniflare: {
          compatibilityDate: '2025-09-06',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          kvNamespaces: ['CACHE'],
          durableObjects: { SESSION: 'SessionCoordinator' },
          bindings: {
            APP_NAME: 'Anascummis',
            MAX_STORY_DISPATCHES_PER_TURN: '3',
            MAX_FORGE_ATTEMPTS: '3',
            GUEST_RETENTION_SECONDS: '86400',
            // Session cookies are HMAC-signed, and `sessionSecret` refuses
            // anything shorter than 32 characters. Without this, `resolveIdentity`
            // falls through to minting a *fresh* guest id on every request, so no
            // two requests could ever be the same session and no session-scoped
            // route could be tested over HTTP at all. A test-only value, plainly
            // not a credential: the real secret reaches a deployment through
            // `wrangler secret put` and never through this file.
            SESSION_SECRET: 'test-secret-not-used-anywhere-real-000000',
          },
        },
      },
    },
  },
});
