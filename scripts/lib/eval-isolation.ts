/**
 * Guard de aislamiento del evaluador local.
 *
 * `.env.local` de este repositorio apunta a la Supabase de producción. Un
 * evaluador que corre 20 conversaciones sintéticas contra esa base escribe
 * contactos, conversaciones y mensajes inventados sobre datos reales, y no
 * hay forma de distinguirlos después.
 *
 * Este guard no confía en que quien corre la evaluación se acuerde. Mira la
 * forma del entorno y aborta: base fuera de loopback, puerto que no sea de
 * los desechables, o cualquier credencial que habilite un efecto externo.
 *
 * Ningún mensaje de error incluye el valor de una variable. Sólo su nombre.
 */

export class EvaluationIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationIsolationError';
  }
}

/**
 * Puertos de los clusters desechables (`scripts/pg-native-up.sh`).
 *
 * 5432 y 54322 quedan fuera a propósito: son el PostgreSQL del sistema y el
 * de Supabase local, y los dos pueden tener datos que a alguien le importan.
 */
const DISPOSABLE_PORTS_V1 = new Set([55432, 55433, 55434, 55435]);

const LOOPBACK_HOSTS_V1 = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Credenciales cuya sola presencia habilita un efecto sobre un tercero.
 *
 * La lista es de habilitación, no de sospecha: si una de estas está cargada,
 * algún camino del código puede llamar afuera. La evaluación no necesita
 * ninguna, así que la respuesta correcta es abortar y no confiar en que ese
 * camino no se recorra.
 */
export const EXTERNAL_EFFECT_CREDENTIALS_V1 = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_AGENT_B_BOT_TOKEN',
  'TELEGRAM_AGENT_A_BOT_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RETELL_API_KEY',
  'GOOGLE_SHEETS_PRIVATE_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID',
] as const;

function present(environment: Readonly<Record<string, string | undefined>>, name: string): boolean {
  return (environment[name] ?? '').trim().length > 0;
}

export function assertIsolatedEvaluationEnvironmentV1(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const raw = (environment.DATABASE_URL ?? '').trim();
  if (raw.length === 0) {
    throw new EvaluationIsolationError('EVAL_ISOLATION: falta DATABASE_URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // El valor no entra en el mensaje: puede traer usuario y contraseña.
    throw new EvaluationIsolationError('EVAL_ISOLATION: DATABASE_URL no es una URL válida');
  }

  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  if (!LOOPBACK_HOSTS_V1.has(host)) {
    throw new EvaluationIsolationError(
      `EVAL_ISOLATION: DATABASE_URL apunta a "${host}", que no es loopback. `
      + 'La evaluación sólo corre contra un cluster desechable local.',
    );
  }

  const port = Number(parsed.port);
  if (!DISPOSABLE_PORTS_V1.has(port)) {
    throw new EvaluationIsolationError(
      `EVAL_ISOLATION: puerto ${parsed.port || '(vacío)'} no es un cluster desechable. `
      + `Aprobados: ${[...DISPOSABLE_PORTS_V1].join(', ')} (scripts/pg-native-up.sh).`,
    );
  }

  const habilitadas = EXTERNAL_EFFECT_CREDENTIALS_V1.filter((name) => present(environment, name));
  if (habilitadas.length > 0) {
    throw new EvaluationIsolationError(
      `EVAL_ISOLATION: hay credenciales de efecto externo cargadas: ${habilitadas.join(', ')}. `
      + 'La evaluación no las necesita y su presencia habilita llamadas a terceros.',
    );
  }

  if (!present(environment, 'DEEPSEEK_API_KEY')) {
    throw new EvaluationIsolationError(
      'EVAL_ISOLATION: falta DEEPSEEK_API_KEY. Sin ella el runner cae a otro proveedor '
      + 'y los números describirían un modelo distinto del que se está evaluando.',
    );
  }
}
