import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            'server-only': fileURLToPath(
              new URL('./tests/helpers/server-only-stub.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            'server-only': fileURLToPath(
              new URL('./tests/helpers/server-only-stub.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          // Integration tests hit a real Supabase project; they are slower and
          // must not run concurrently against shared rows.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
