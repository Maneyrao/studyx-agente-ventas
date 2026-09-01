import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_EFFECT_CREDENTIALS_V1,
  assertIsolatedEvaluationEnvironmentV1,
  EvaluationIsolationError,
} from '../../../scripts/lib/eval-isolation';

/**
 * El entorno de evaluación no puede tocar producción.
 *
 * `.env.local` de este repositorio apunta a la Supabase productiva: correr el
 * evaluador con ese archivo cargado escribiría conversaciones sintéticas sobre
 * datos reales. La defensa no puede ser recordarlo — tiene que fallar.
 *
 * El guard mira la forma del entorno, no la intención de quien lo corre.
 */

const AISLADO = {
  DATABASE_URL: 'postgresql://postgres@127.0.0.1:55435/studyx_test',
  DEEPSEEK_API_KEY: 'sk-sintetica-no-real',
  BUSINESS_WORKSPACE_SLUG: 'studyx',
};

describe('aislamiento del entorno de evaluación', () => {
  it('acepta un cluster desechable en loopback', () => {
    expect(() => assertIsolatedEvaluationEnvironmentV1(AISLADO)).not.toThrow();
  });

  it('rechaza cualquier base que no sea loopback', () => {
    for (const url of [
      'postgresql://postgres:pass@db.abcdefgh.supabase.co:5432/postgres',
      'postgresql://user@10.0.0.5:5432/studyx',
      'postgres://user@studyx.example.com:5432/studyx',
    ]) {
      expect(() => assertIsolatedEvaluationEnvironmentV1({ ...AISLADO, DATABASE_URL: url }))
        .toThrow(EvaluationIsolationError);
    }
  });

  it('rechaza un puerto que no sea de los desechables aprobados', () => {
    // 54322 es el de Supabase local y 5432 el del sistema: ninguno es
    // desechable, y ambos pueden tener datos que a alguien le importan.
    for (const port of [5432, 54322, 5433]) {
      expect(() => assertIsolatedEvaluationEnvironmentV1({
        ...AISLADO, DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/studyx_test`,
      })).toThrow(EvaluationIsolationError);
    }
  });

  it('rechaza la presencia de cualquier credencial de efecto externo', () => {
    for (const name of EXTERNAL_EFFECT_CREDENTIALS_V1) {
      expect(
        () => assertIsolatedEvaluationEnvironmentV1({ ...AISLADO, [name]: 'presente' }),
        `${name} presente debería abortar la evaluación`,
      ).toThrow(EvaluationIsolationError);
    }
  });

  it('una credencial vacía no cuenta como presente', () => {
    // Un `.env` que declara la variable en blanco no habilita nada.
    expect(() => assertIsolatedEvaluationEnvironmentV1({
      ...AISLADO, TELEGRAM_BOT_TOKEN: '  ',
    })).not.toThrow();
  });

  it('exige la clave de DeepSeek: sin ella la corrida mediría otro modelo', () => {
    const sinClave: Record<string, string> = { ...AISLADO };
    delete sinClave.DEEPSEEK_API_KEY;
    expect(() => assertIsolatedEvaluationEnvironmentV1(sinClave))
      .toThrow(/DEEPSEEK_API_KEY/);
  });

  it('el error nunca contiene el valor de un secreto', () => {
    const secreto = 'sk-valor-que-no-debe-aparecer-jamas';
    try {
      assertIsolatedEvaluationEnvironmentV1({
        ...AISLADO, DEEPSEEK_API_KEY: secreto, STRIPE_SECRET_KEY: secreto,
      });
      throw new Error('debería haber fallado');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secreto);
      expect((error as Error).message).toContain('STRIPE_SECRET_KEY');
    }
  });
});
