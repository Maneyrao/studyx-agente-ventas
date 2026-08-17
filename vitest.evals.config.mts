import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url));
const botpressRuntimeStub = fileURLToPath(
  new URL('./tests/helpers/botpress-runtime-stub.ts', import.meta.url),
);

/**
 * Model-behavior evals: real Gemini calls against the real Agent A prompt.
 * Never part of `npm test` — run explicitly with:
 *   RUN_MODEL_EVALS=1 GEMINI_API_KEY=... npx vitest run --config vitest.evals.config.mts
 * Structural suites stay green without any network access; these evals are
 * the separate "model evals" evidence line.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': sourceRoot,
      '@botpress/runtime': botpressRuntimeStub,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/evals/**/*.eval.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
