import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Config del arnés de workflow.
 *
 * Separada a propósito de `vitest.config.mts` por tres razones:
 *
 * 1. El alias de `@botpress/runtime` apunta a `botpress-workflow-runtime.ts`,
 *    donde `Action.execute` invoca el handler REAL de la acción. El stub de
 *    las unitarias hace lo contrario —falla si nadie la configuró— y cambiarlo
 *    rompería suites ajenas.
 * 2. Estas pruebas necesitan un backend y un PostgreSQL locales levantados.
 *    No pueden vivir en `test:unit`, que corre sin nada de eso.
 * 3. El nivel conversacional gasta API. Nunca debe entrar en `npm test` ni en
 *    un comando general: se paga sólo cuando alguien lo pide explícitamente.
 *
 * Ejecución secuencial: los casos comparten el cluster y las conversaciones se
 * pisarían entre sí.
 */
const sourceRoot = fileURLToPath(new URL('./src', import.meta.url));
const workflowRuntime = fileURLToPath(
  new URL('./tests/helpers/botpress-workflow-runtime.ts', import.meta.url),
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
    include: ['tests/workflow/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 120_000,
    clearMocks: true,
    restoreMocks: true,
  },
});
