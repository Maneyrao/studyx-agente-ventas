import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_EFFECT_CREDENTIALS_V1,
  assertEvaluationApiIdentityV1,
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
  STUDYX_EVAL_API_BASE_URL: 'http://127.0.0.1:3217',
  PAYMENT_LINK_12M: 'https://payments.example.invalid/monthly-12',
  PAYMENT_LINK_6M: 'https://payments.example.invalid/monthly-6',
  PAYMENT_LINK_CONTADO: 'https://payments.example.invalid/one-time',
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

  it('rechaza el puerto genérico 3000 y APIs que no sean loopback', () => {
    for (const apiBaseUrl of [
      'http://127.0.0.1:3000',
      'https://studyx-agente-ventas.vercel.app',
      'http://10.0.0.4:3217',
    ]) {
      expect(() => assertIsolatedEvaluationEnvironmentV1({
        ...AISLADO,
        STUDYX_EVAL_API_BASE_URL: apiBaseUrl,
      })).toThrow(/STUDYX_EVAL_API_BASE_URL/);
    }
  });

  it('rechaza links de pago reales o faltantes', () => {
    for (const paymentLink of [
      undefined,
      'https://buy.stripe.com/real',
      'http://payments.example.invalid/insecure',
      'https://example.invalid.attacker.test/link',
    ]) {
      expect(() => assertIsolatedEvaluationEnvironmentV1({
        ...AISLADO,
        PAYMENT_LINK_12M: paymentLink,
      })).toThrow(/PAYMENT_LINK_12M/);
    }
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

describe('identidad del servidor local evaluado', () => {
  const commit = 'a'.repeat(40);

  it('acepta solamente health del commit esperado y readiness positiva', () => {
    expect(() => assertEvaluationApiIdentityV1({
      expectedCommit: commit,
      health: { status: 'ok', commit },
      readiness: { status: 'ready', ready: true },
    })).not.toThrow();
  });

  it('falla cerrado ante otro commit, health incompleto o API no ready', () => {
    for (const evidence of [
      { health: { status: 'ok', commit: 'b'.repeat(40) }, readiness: { status: 'ready', ready: true } },
      { health: { status: 'ok', commit: null }, readiness: { status: 'ready', ready: true } },
      { health: { status: 'ok', commit }, readiness: { status: 'not_ready', ready: false } },
    ]) {
      expect(() => assertEvaluationApiIdentityV1({ expectedCommit: commit, ...evidence }))
        .toThrow(EvaluationIsolationError);
    }
  });
});
