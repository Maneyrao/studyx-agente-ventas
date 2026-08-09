#!/usr/bin/env node
/**
 * Seed / update the products table from data/catalog.seed.json.
 *
 * Usage:
 *   node scripts/seed-catalog.mjs                          # uses data/catalog.seed.json
 *   node scripts/seed-catalog.mjs path/to/my-catalog.json  # custom path
 *
 * Behavior: upserts by SKU. `active` toggles set manually in the DB are
 * preserved (see catalog.service.ts::upsertProducts). Requires DATABASE_URL.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

function loadEnvLocal() {
  const path = resolve(REPO_ROOT, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq);
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1);
  }
}
loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (needed to reach Supabase).');
  process.exit(2);
}

const catalogPath = resolve(process.cwd(), process.argv[2] ?? resolve(REPO_ROOT, 'data/catalog.seed.json'));
if (!existsSync(catalogPath)) {
  console.error(`Catalog file not found: ${catalogPath}`);
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(catalogPath, 'utf-8'));
if (!Array.isArray(parsed?.products) || parsed.products.length === 0) {
  console.error('Catalog JSON must have a non-empty "products" array.');
  process.exit(2);
}

console.log(`[seed-catalog] ${parsed.products.length} product(s) to upsert from ${catalogPath}`);

const tsxBin = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
if (!existsSync(tsxBin)) {
  console.error('tsx not found in node_modules/.bin/. Run: npm i -D tsx');
  process.exit(2);
}

const runner = `
  import { upsertProducts, ProductSchema } from './src/lib/services/catalog.service.ts';
  (async () => {
    const raw = JSON.parse(process.env.__CATALOG_PAYLOAD ?? '[]');
    const validated = raw.map((p) => ProductSchema.parse(p));
    const r = await upsertProducts(validated);
    console.log(JSON.stringify(r));
    process.exit(0);
  })().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
`;

const result = spawnSync(tsxBin, ['--eval', runner], {
  cwd: REPO_ROOT,
  env: { ...process.env, __CATALOG_PAYLOAD: JSON.stringify(parsed.products) },
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf-8',
});
if (result.status !== 0) {
  console.error(`[seed-catalog] FAIL (status=${result.status})`);
  process.exit(result.status ?? 1);
}
console.log(`[seed-catalog] OK → ${result.stdout.trim()}`);
