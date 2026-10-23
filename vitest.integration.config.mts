import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url));
const botpressRuntimeStub = fileURLToPath(
  new URL('./tests/helpers/botpress-runtime-stub.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@': sourceRoot,
      '@botpress/runtime': botpressRuntimeStub,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/replay/**/*.test.ts'],
    setupFiles: ['tests/setup/integration.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

