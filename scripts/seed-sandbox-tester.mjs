#!/usr/bin/env node
/**
 * Alta idempotente del "tester sandbox" del dueño.
 *
 * Crea (o reutiliza) el contacto sandbox, la fila en `sandbox_identities`
 * que exige el candado anti-efectos-reales, y una conversación abierta, para
 * que Bot A / Bot B reconozcan al dueño durante una simulación local.
 *
 * Uso:
 *   node scripts/seed-sandbox-tester.mjs --telegram-user-id <id numérico> [--name "Nombre"]
 *
 * La URL de conexión se toma EXCLUSIVAMENTE de:
 *   1. --database-url <url>
 *   2. la variable de entorno TEST_DATABASE_URL
 *
 * Nunca se lee DATABASE_URL ni se carga `.env.local`: este script sólo debe
 * poder alcanzar un cluster PostgreSQL local desechable (127.0.0.1, puertos
 * 54322 o 55432-55435 — los mismos que exige `tests/helpers/db.ts`). Una URL
 * que apunte a otro host se rechaza sin abrir conexión: las filas que este
 * script crea son identidades de sandbox, y el candado de
 * `.claude/rules/database.md` exige que nunca existan en producción.
 *
 * Ejemplo:
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
 *     node scripts/seed-sandbox-tester.mjs --telegram-user-id 123456789 --name "Tomás"
 *
 * Idempotente: correrlo dos veces con el mismo --telegram-user-id produce el
 * mismo contact_id, exactamente una fila en sandbox_identities y a lo sumo
 * una conversación abierta (no se acumulan duplicados).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

function printUsage() {
  console.error(
    [
      'Uso: node scripts/seed-sandbox-tester.mjs --telegram-user-id <id numérico> [--name "Nombre"] [--database-url <url>]',
      '',
      'La URL de conexión se toma de --database-url o de TEST_DATABASE_URL.',
      'Nunca de DATABASE_URL ni de .env.local: sólo se acepta un cluster local',
      'de pruebas (127.0.0.1, puertos 54322 o 55432-55435).',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    out[key] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const userId = args['telegram-user-id'];
const name = args['name'] ?? 'Tester Sandbox';

if (!/^\d+$/.test(userId ?? '')) {
  console.error('Error: --telegram-user-id es obligatorio y debe ser numérico.\n');
  printUsage();
  process.exit(1);
}

// 13 dígitos tras el "+": prefijo +999 (no marcable) + el user id de
// Telegram llevado a 10 dígitos con ceros a la izquierda. Cumple el CHECK
// E.164 de contacts.phone y el `LIKE '+999%'` de sandbox_identities.
const syntheticPhone = `+999${userId.padStart(10, '0')}`;

// --- Resolución de la URL de conexión: nunca DATABASE_URL, nunca .env.local ---
const rawUrl = args['database-url'] ?? process.env.TEST_DATABASE_URL;

function describeHost(url) {
  if (!url) return '(sin URL)';
  try {
    return new URL(url).host; // host:puerto, sin credenciales
  } catch {
    return '(URL inválida)';
  }
}

let inspectLocalTestDatabaseUrl;
try {
  ({ inspectLocalTestDatabaseUrl } = await import(resolve(REPO_ROOT, 'tests/helpers/db.ts')));
} catch (err) {
  console.error('No se pudo cargar el validador de host local (tests/helpers/db.ts):', err.message);
  process.exit(1);
}

const inspection = inspectLocalTestDatabaseUrl(rawUrl);
if (!inspection.allowed) {
  console.error(`Rechazado — host no local: ${describeHost(rawUrl)}`);
  console.error(inspection.reason);
  console.error('');
  printUsage();
  process.exit(1);
}

// --- A partir de acá la URL ya fue validada como local; recién ahora se conecta ---
const sql = postgres(inspection.url, { max: 1 });
try {
  const result = await sql.begin(async (tx) => {
    const [contact] = await tx`
      INSERT INTO contacts (phone, status, channel_origin, name)
      VALUES (${syntheticPhone}, 'prospecto', 'whatsapp', ${name})
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;

    // Sin target: cubre las tres UNIQUE de sandbox_identities
    // (provider, external_user_id), (synthetic_phone) y (contact_id) — todas
    // determinísticas a partir del mismo telegram-user-id, así que en una
    // segunda corrida siempre coinciden y el INSERT es un no-op.
    await tx`
      INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
      VALUES ('telegram_sandbox', ${userId}, ${contact.id}, ${syntheticPhone})
      ON CONFLICT DO NOTHING`;

    // conversations no tiene una UNIQUE que capture "una sola conversación
    // abierta por contacto", así que la idempotencia se hace a mano: sólo
    // insertar si no hay ya una abierta para este contacto.
    //
    // El chequeo y el INSERT no son atómicos entre sí: en READ COMMITTED dos
    // corridas simultáneas para el mismo contacto pueden evaluar el NOT EXISTS
    // antes de que cualquiera commitee, y ambas insertar. El lock consultivo,
    // tomado antes del chequeo y liberado solo al cerrar la transacción,
    // serializa ese tramo por contacto. Se namespacea con el prefijo para no
    // pisar el espacio de locks de nadie más.
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtextextended('seed-sandbox-tester:conversation:' || ${contact.id}::text, 0)
      )`;

    await tx`
      INSERT INTO conversations (contact_id, channel, status)
      SELECT ${contact.id}, 'whatsapp', 'open'
      WHERE NOT EXISTS (
        SELECT 1 FROM conversations WHERE contact_id = ${contact.id} AND status = 'open'
      )`;

    const [conversation] = await tx`
      SELECT id FROM conversations
      WHERE contact_id = ${contact.id} AND status = 'open'
      ORDER BY started_at DESC
      LIMIT 1`;

    return { contact_id: contact.id, conversation_id: conversation?.id ?? null };
  });

  console.log(
    JSON.stringify({
      contact_id: result.contact_id,
      conversation_id: result.conversation_id,
      synthetic_phone: syntheticPhone,
      external_user_id: userId,
    }),
  );
} finally {
  await sql.end();
}
