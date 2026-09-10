import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { fileURLToPath } from 'node:url';

export default defineWorkersConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@worker': fileURLToPath(new URL('./src/worker', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
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
          },
        },
      },
    },
  },
});
