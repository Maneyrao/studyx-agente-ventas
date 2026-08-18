#!/usr/bin/env node
/**
 * Aprovisiona Products y Prices de Stripe para el catálogo de `offerings` de
 * un workspace y deja el resultado en `offering_payment_configs`, que es la
 * fila que `src/features/payments/application/create-checkout.ts` lee para
 * saber qué precio cobrar.
 *
 * Alcance: sólo offerings con `price_type = 'fixed'` (los de precio de
 * cotización u ofrecimiento gratis no tienen un Price fijo que crear).
 *
 * Uso:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/provision-stripe-prices.mjs \
 *     --database-url <url> [--workspace studyx] [--dry-run]
 *
 * La URL de conexión se toma EXCLUSIVAMENTE de:
 *   1. --database-url <url>
 *   2. la variable de entorno TEST_DATABASE_URL
 * Nunca de DATABASE_URL ni de .env.local — ese valor es la Supabase de
 * PRODUCCIÓN en este repo (ver tests/setup/integration.ts). Sin
 * --database-url ni TEST_DATABASE_URL, el script se niega a arrancar.
 *
 * Host remoto (p.ej. la Supabase de producción, a propósito): hace falta
 * --allow-remote y confirmar explícitamente con --yes. Sin --allow-remote
 * sólo se acepta 127.0.0.1 (cualquier puerto).
 *
 * Idempotente: reencuentra el Product de Stripe ya creado por
 * metadata.offering_code (Stripe Search) y el Price ya creado por
 * (product, unit_amount, currency) antes de crear nada nuevo en Stripe, y
 * hace UPSERT en offering_payment_configs por `offering_id` (columna UNIQUE).
 * Correr esto dos veces no duplica Products, Prices ni filas.
 *
 * --dry-run: muestra exactamente qué crearía/actualizaría, sin llamar a
 * Stripe ni escribir en la base. Sigue necesitando --database-url para leer
 * el catálogo; STRIPE_SECRET_KEY es opcional en --dry-run (si falta, el
 * ambiente se muestra como desconocido).
 *
 * La clave se lee sólo de process.env.STRIPE_SECRET_KEY y NUNCA se imprime,
 * ni entera ni parcial, ni en logs ni en mensajes de error.
 */
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import Stripe from 'stripe';
import {
  amountToUnitAmount,
  deriveStripeEnvironment,
  upsertStripeProductAndPrice,
} from './lib/stripe-provisioning.mjs';

const LOCAL_HOST = '127.0.0.1';
const BOOLEAN_FLAGS = new Set(['dry-run', 'allow-remote', 'yes']);

function printUsage() {
  console.error(
    [
      'Uso: node scripts/provision-stripe-prices.mjs --database-url <url> [--workspace studyx] [--dry-run]',
      '',
      'La URL de conexión se toma de --database-url o de TEST_DATABASE_URL.',
      'Nunca de DATABASE_URL ni de .env.local.',
      '',
      'Contra un host remoto hace falta --allow-remote y --yes; sin',
      '--allow-remote sólo se acepta 127.0.0.1.',
      '',
      'STRIPE_SECRET_KEY se lee del entorno (obligatoria salvo en --dry-run).',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const out = { 'dry-run': false, 'allow-remote': false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      out[key] = true;
      continue;
    }
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const workspaceSlug = args.workspace ?? 'studyx';
const dryRun = args['dry-run'] === true;

function resolveDatabaseUrl() {
  const rawUrl = args['database-url'] ?? process.env.TEST_DATABASE_URL;
  if (!rawUrl) {
    console.error('Falta --database-url (o TEST_DATABASE_URL). Nunca se usa DATABASE_URL por defecto.');
    printUsage();
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error('--database-url no es una URL válida.');
    process.exit(1);
  }

  const isLocalhost = parsed.hostname === LOCAL_HOST;
  if (!isLocalhost) {
    if (!args['allow-remote']) {
      console.error(
        `Rechazado — host remoto: ${parsed.host}. Sin --allow-remote sólo se acepta ${LOCAL_HOST}.`,
      );
      printUsage();
      process.exit(1);
    }
    if (!args.yes) {
      console.error(
        `Vas a correr esto contra un host remoto: ${parsed.host}. Confirmá agregando --yes.`,
      );
      process.exit(1);
    }
    console.error(`Aviso: corriendo contra host remoto ${parsed.host} (--allow-remote --yes confirmado).`);
  }

  return rawUrl;
}

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  let environment = null;
  if (secretKey) {
    try {
      environment = deriveStripeEnvironment(secretKey);
    } catch {
      // Nunca se loguea la clave ni el error crudo (podría reflejarla).
      console.error('STRIPE_SECRET_KEY tiene un prefijo no reconocido (se esperaba sk_test_/sk_live_/rk_test_/rk_live_).');
      process.exit(1);
    }
  } else if (!dryRun) {
    console.error('Falta STRIPE_SECRET_KEY en el entorno.');
    process.exit(1);
  }

  const databaseUrl = resolveDatabaseUrl();
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const [workspace] = await sql`SELECT id FROM workspaces WHERE slug = ${workspaceSlug}`;
    if (!workspace) {
      console.error(`No existe el workspace '${workspaceSlug}'.`);
      process.exit(1);
    }

    const offerings = await sql`
      SELECT id, code, display_name, price_amount, currency
      FROM offerings
      WHERE workspace_id = ${workspace.id} AND price_type = 'fixed'
      ORDER BY code
    `;

    if (offerings.length === 0) {
      console.log(`Workspace '${workspaceSlug}': no hay offerings con price_type='fixed'. Nada que hacer.`);
      return;
    }

    if (dryRun) {
      const envLabel = environment ?? 'desconocido (STRIPE_SECRET_KEY no seteada)';
      console.log(
        `[dry-run] Workspace '${workspaceSlug}' — ambiente Stripe: ${envLabel} — ${offerings.length} offering(s) de precio fijo:`,
      );
      for (const offering of offerings) {
        const unitAmount = amountToUnitAmount(offering.price_amount);
        console.log(
          `[dry-run]   ${offering.code}: Product "${offering.display_name}" + Price ${unitAmount} ${offering.currency.toLowerCase()}` +
            ` -> UPSERT offering_payment_configs(offering_id=${offering.id}, provider=stripe, checkout_mode=payment, environment=${envLabel})`,
        );
      }
      console.log('[dry-run] No se llamó a Stripe ni se escribió en la base.');
      return;
    }

    const stripe = new Stripe(secretKey);

    for (const offering of offerings) {
      const { price } = await upsertStripeProductAndPrice(stripe, offering);

      await sql`
        INSERT INTO offering_payment_configs (offering_id, provider, stripe_price_id, checkout_mode, environment, status)
        VALUES (${offering.id}, 'stripe', ${price.id}, 'payment', ${environment}, 'active')
        ON CONFLICT (offering_id) DO UPDATE SET
          provider = EXCLUDED.provider,
          stripe_price_id = EXCLUDED.stripe_price_id,
          checkout_mode = EXCLUDED.checkout_mode,
          environment = EXCLUDED.environment,
          status = EXCLUDED.status
      `;

      console.log(`${offering.code}: stripe_price_id=${price.id} (${environment})`);
    }
  } finally {
    await sql.end();
  }
}

// Ejecutar sólo cuando se invoca directamente (no cuando algo lo importa,
// p.ej. en tests). Comparar vía pathToFileURL en vez de armar el
// `file://` a mano: el repo vive en una ruta con espacios
// ("AGENTE IA"), que pathToFileURL codifica igual que import.meta.url pero
// una concatenación literal no.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Error inesperado:', err.message);
    process.exit(1);
  });
}

export { main, parseArgs, resolveDatabaseUrl };
