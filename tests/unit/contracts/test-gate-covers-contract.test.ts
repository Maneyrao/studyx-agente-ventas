import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El comando oficial de tests tiene que correr unitarios Y contract.
 *
 * Esto no es una preferencia de estilo. `vitest.config.mts` incluye
 * `tests/contract/**`, pero `test:unit` pasaba `tests/unit` como filtro
 * posicional, y un filtro posicional GANA sobre `include`. El resultado era
 * un directorio entero que nadie corría: la paridad del brain quedó rota
 * desde 15b444e y el hueco fue invisible durante semanas porque todos los
 * runbooks del repo dicen `npm run test:unit`.
 *
 * El bug no estaba en el config. Estaba en el comando que la gente escribe.
 */

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const config = readFileSync(new URL('../../../vitest.config.mts', import.meta.url), 'utf8');

/** Un gate es un script de vitest que corre TODO, no un atajo focal. */
const GATE_SCRIPTS = ['test', 'test:unit'] as const;

describe('el gate de tests cubre unitarios y contract', () => {
  it('el config incluye ambos directorios', () => {
    expect(config).toContain("'tests/unit/**/*.test.ts'");
    expect(config).toContain("'tests/contract/**/*.test.ts'");
  });

  it.each(GATE_SCRIPTS)('«%s» no filtra por directorio', (name) => {
    const script: string = pkg.scripts[name];
    expect(script, `falta el script ${name}`).toBeTruthy();

    // Un argumento posicional que empiece con `tests/` es un filtro, y un
    // filtro recorta el `include` del config sin avisar.
    const positional = script
      .split(/\s+/)
      .filter((token) => token.startsWith('tests/'));
    expect(positional, `${name} filtra por ruta: ${positional.join(' ')}`).toEqual([]);
  });

  it('los dos gates corren exactamente lo mismo', () => {
    // Si divergen, uno de los dos vuelve a ser el que no mira contract.
    expect(pkg.scripts['test:unit']).toBe(pkg.scripts.test);
  });
});
