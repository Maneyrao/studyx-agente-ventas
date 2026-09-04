import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Contrato de salida de `scripts/eval-agent-a.sh`.
 *
 * Una corrida que falla no puede terminar en código 0. Antes el bucle hacía
 * `... || echo "corrida con casos fallidos"`, así que el script salía 0 aunque
 * las tres repeticiones se hubieran caído: encadenado detrás de un `&&`, o
 * leído por CI, una matriz entera en rojo se reportaba como verde.
 *
 * La prueba corre el script REAL sobre una copia desechable, con las
 * herramientas externas sustituidas por stubs en el PATH. No levanta cluster,
 * no construye la app y no llama a ningún proveedor: lo único que se ejercita
 * es el control de flujo del script.
 */

const scriptsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts',
);

function writeExecutable(directory: string, name: string, body: string): void {
  const target = path.join(directory, name);
  writeFileSync(target, body, 'utf8');
  chmodSync(target, 0o755);
}

/**
 * Copia mínima del árbol que el script toca, más los stubs.
 *
 * `npx tsx -e` (aislamiento e identidad de la API) tiene que salir bien;
 * `npx tsx scripts/run-agent-a-conversations.ts` es el que se hace fallar,
 * que es exactamente la corrida de evaluación.
 */
function prepararEntorno(runnerExitCode: number): string {
  const root = mkdtempSync(path.join(tmpdir(), 'studyx-eval-shell-'));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, '.eval'), { recursive: true });
  mkdirSync(path.join(root, 'bin'), { recursive: true });

  copyFileSync(
    path.join(scriptsRoot, 'eval-agent-a.sh'),
    path.join(root, 'scripts', 'eval-agent-a.sh'),
  );
  chmodSync(path.join(root, 'scripts', 'eval-agent-a.sh'), 0o755);

  for (const nombre of ['pg-native-down.sh', 'pg-native-up.sh']) {
    writeExecutable(path.join(root, 'scripts'), nombre, '#!/bin/sh\nexit 0\n');
  }

  // El guard de aislamiento lee este archivo; para esta prueba alcanza con que
  // exista y no aporte nada peligroso. No hay claves reales en juego.
  writeFileSync(
    path.join(root, '.eval', '.env.local'),
    'BUSINESS_WORKSPACE_SLUG=studyx\nDEEPSEEK_API_KEY=stub-solo-para-el-test\n',
    'utf8',
  );

  writeExecutable(path.join(root, 'bin'), 'npx', `#!/bin/sh
# Distingue la comprobación de entorno (\`tsx -e\`) de la corrida de evaluación.
for arg in "$@"; do
  case "$arg" in
    *run-agent-a-conversations.ts) exit ${runnerExitCode} ;;
  esac
done
exit 0
`);
  writeExecutable(path.join(root, 'bin'), 'node', '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(root, 'bin'), 'curl', '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(root, 'bin'), 'npm', `#!/bin/sh
# \`npm run start\` queda en segundo plano y el script comprueba que siga vivo.
for arg in "$@"; do
  if [ "$arg" = "start" ]; then sleep 20; exit 0; fi
done
exit 0
`);
  writeExecutable(path.join(root, 'bin'), 'git', '#!/bin/sh\necho stub-sha\n');

  return root;
}

function correr(root: string, repeticiones: string): { status: number | null; stderr: string } {
  const resultado = spawnSync('bash', ['scripts/eval-agent-a.sh', 'suite-x', repeticiones, 'etq'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${path.join(root, 'bin')}:${process.env.PATH ?? ''}`,
      STUDYX_EVAL_API_PORT: '3298',
    },
  });
  return { status: resultado.status, stderr: `${resultado.stderr ?? ''}` };
}

describe('scripts/eval-agent-a.sh', () => {
  let root: string;

  beforeEach(() => {
    root = '';
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('sale distinto de cero cuando una corrida de evaluación falla', () => {
    root = prepararEntorno(1);

    const { status, stderr } = correr(root, '2');

    expect(status).not.toBe(0);
    expect(stderr).toContain('EVAL_RUNS_FAILED: 2/2');
    // El reporte de cada corrida se conserva: el bucle no aborta en la primera.
    expect(stderr).toContain('corrida 2/2');
  });

  it('sale cero cuando todas las corridas pasan', () => {
    root = prepararEntorno(0);

    const { status, stderr } = correr(root, '2');

    expect(status).toBe(0);
    expect(stderr).not.toContain('EVAL_RUNS_FAILED');
  });

  it('declara la ruta evaluada y usa plannerless por defecto', () => {
    root = prepararEntorno(0);

    const { stderr } = correr(root, '1');

    expect(stderr).toContain('ruta evaluada: plannerless_v2');
  });

  it('la ruta legacy es una excepción explícita y queda reportada', () => {
    root = prepararEntorno(0);

    const resultado = spawnSync('bash', ['scripts/eval-agent-a.sh', 'suite-x', '1', 'etq'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH ?? ''}`,
        STUDYX_EVAL_API_PORT: '3298',
        STUDYX_EVAL_LEGACY_PLANNER: '1',
      },
    });

    expect(`${resultado.stderr}`).toContain('ruta evaluada: planner_v1');
  });
});
