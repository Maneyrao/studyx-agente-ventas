import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': sourceRoot,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    setupFiles: ['tests/setup/unit.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/lib/heuristics/**/*.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});

