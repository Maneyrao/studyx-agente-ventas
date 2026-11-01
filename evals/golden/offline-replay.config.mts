import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: {
    '@': fileURLToPath(new URL('../../src', import.meta.url)),
    '@botpress/runtime': fileURLToPath(new URL('../../tests/helpers/botpress-runtime-stub.ts', import.meta.url)),
  } },
  test: {
    include: ['evals/golden/offline-replay.test.mjs'],
    env: { STUDYX_OFFLINE_REPLAY: '1' },
    fileParallelism: false, testTimeout: 120_000,
  },
});
