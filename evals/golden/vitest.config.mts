import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url));
const workflowRuntime = fileURLToPath(
  new URL('../../tests/helpers/botpress-workflow-runtime.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@': sourceRoot,
      '@botpress/runtime': workflowRuntime,
    },
  },
  test: {
    environment: 'node',
    include: ['evals/golden/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 900_000,
    hookTimeout: 120_000,
    clearMocks: true,
    restoreMocks: true,
  },
});
