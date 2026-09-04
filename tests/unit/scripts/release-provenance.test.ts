import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { releaseProvenanceV1 } from '../../../scripts/run-agent-a-conversations';

/**
 * Procedencia de las fuentes que se midieron.
 *
 * `git rev-parse HEAD` sólo miente justo cuando más importa: con el árbol
 * sucio, lo construido NO es el contenido de ese commit y un reporte verde
 * queda atribuido a un commit que nunca tuvo ese código.
 *
 * La versión anterior de esta función miraba únicamente `git diff HEAD`, que
 * ignora los archivos sin trackear, y lo justificaba diciendo que TypeScript
 * los rechazaría. Es falso: Git no decide la resolución de módulos. Un archivo
 * nuevo sin agregar se importa y se compila igual, así que puede cambiar por
 * completo lo que se evaluó sin dejar rastro en la procedencia.
 *
 * Y un hash de diff no conserva el contenido: sirve para comparar dos
 * corridas, no para reconstruir qué se midió. Por eso además se escribe un
 * árbol Git real con las fuentes relevantes — recuperable con `git ls-tree` o
 * `git archive` — sin tocar HEAD, el índice ni el árbol de trabajo.
 *
 * Todo se prueba contra repositorios temporales desechables. Ninguna aserción
 * depende del worktree del usuario, que está sucio a propósito.
 */

function git(cwd: string, ...args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'eval',
      GIT_AUTHOR_EMAIL: 'eval@example.invalid',
      GIT_COMMITTER_NAME: 'eval',
      GIT_COMMITTER_EMAIL: 'eval@example.invalid',
    },
  }).trim();
}

function writeAt(root: string, relativePath: string, contents: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
}

describe('releaseProvenanceV1', () => {
  let repository: string;

  beforeEach(() => {
    repository = mkdtempSync(path.join(tmpdir(), 'studyx-provenance-'));
    git(repository, 'init', '--quiet', '--initial-branch=main');
    writeAt(repository, 'src/index.ts', 'export const uno = 1;\n');
    writeAt(repository, '.gitignore', 'node_modules/\n.env*\n');
    git(repository, 'add', '-A');
    git(repository, 'commit', '--quiet', '-m', 'base');
  });

  afterEach(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  it('un archivo sin trackear ensucia la procedencia y queda nombrado', () => {
    writeAt(repository, 'src/extra.ts', 'export const dos = 2;\n');

    const provenance = releaseProvenanceV1({ cwd: repository });

    expect(provenance.worktree_dirty).toBe(true);
    expect(provenance.untracked_relevant_paths).toContain('src/extra.ts');
    expect(provenance.source_snapshot_id).not.toBeNull();
  });

  it('el snapshot es recuperable, no sólo un hash', () => {
    writeAt(repository, 'src/extra.ts', 'export const dos = 2;\n');

    const provenance = releaseProvenanceV1({ cwd: repository });

    // Si el snapshot fuese sólo un hash, esto no podría listar el archivo.
    const listado = git(repository, 'ls-tree', '-r', '--name-only', provenance.source_snapshot_id!);
    expect(listado.split('\n')).toContain('src/extra.ts');
  });

  it('un árbol limpio no se reporta sucio ni inventa archivos', () => {
    const provenance = releaseProvenanceV1({ cwd: repository });

    expect(provenance.worktree_dirty).toBe(false);
    expect(provenance.untracked_relevant_paths).toEqual([]);
    expect(provenance.worktree_diff_sha256).toBeNull();
  });

  it('una modificación de archivo trackeado también ensucia', () => {
    writeAt(repository, 'src/index.ts', 'export const uno = 99;\n');

    const provenance = releaseProvenanceV1({ cwd: repository });

    expect(provenance.worktree_dirty).toBe(true);
    expect(provenance.worktree_diff_sha256).not.toBeNull();
  });

  it('los secretos y las dependencias nunca entran en la procedencia', () => {
    writeAt(repository, '.env.local', 'DEEPSEEK_API_KEY=no-debe-viajar\n');
    writeAt(repository, 'node_modules/paquete/index.js', 'module.exports = 1;\n');
    writeAt(repository, 'botpress-agent/evals/results/happy-path-x.json', '{"run_id":"x"}\n');
    writeAt(repository, 'src/extra.ts', 'export const dos = 2;\n');

    const provenance = releaseProvenanceV1({ cwd: repository });

    expect(provenance.untracked_relevant_paths).toContain('src/extra.ts');
    for (const excluido of ['.env.local', 'node_modules/paquete/index.js']) {
      expect(provenance.untracked_relevant_paths).not.toContain(excluido);
    }
    expect(
      provenance.untracked_relevant_paths.some((entry) => entry.includes('evals/results/')),
    ).toBe(false);
    const snapshot = git(repository, 'ls-tree', '-r', '--name-only', provenance.source_snapshot_id!);
    expect(snapshot).not.toContain('.env.local');
    expect(snapshot).not.toContain('node_modules');
  });

  it('un SHA inyectado no exime de mirar el checkout que sí existe', () => {
    writeAt(repository, 'src/extra.ts', 'export const dos = 2;\n');
    const head = git(repository, 'rev-parse', 'HEAD');

    const provenance = releaseProvenanceV1({
      cwd: repository,
      env: { GIT_COMMIT_SHA: head },
    });

    expect(provenance.git_sha).toBe(head);
    // El entorno dice qué commit se pidió; el checkout dice qué se midió.
    expect(provenance.worktree_dirty).toBe(true);
    expect(provenance.untracked_relevant_paths).toContain('src/extra.ts');
  });

  it('sin checkout la igualdad de fuentes queda desconocida, no certificada', () => {
    const sinRepositorio = mkdtempSync(path.join(tmpdir(), 'studyx-sin-git-'));
    try {
      const provenance = releaseProvenanceV1({
        cwd: sinRepositorio,
        env: { GIT_COMMIT_SHA: 'a'.repeat(40) },
      });

      expect(provenance.git_sha).toBe('a'.repeat(40));
      expect(provenance.worktree_dirty).toBeNull();
      expect(provenance.source_snapshot_id).toBeNull();
      expect(provenance.untracked_relevant_paths).toEqual([]);
    } finally {
      rmSync(sinRepositorio, { recursive: true, force: true });
    }
  });
});
