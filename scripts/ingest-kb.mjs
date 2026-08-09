#!/usr/bin/env node
/**
 * Knowledge Base ingestion CLI.
 *
 * Usage:
 *   node scripts/ingest-kb.mjs docs/kb                      # recursive over dir
 *   node scripts/ingest-kb.mjs docs/kb/pricing.md           # single file
 *   TARGET_SIMILARITY=0.75 node scripts/ingest-kb.mjs docs/kb
 *
 * Reads DATABASE_URL, OPENAI_API_KEY from .env.local (or process env).
 * Splits markdown/text files on blank-line paragraphs, drops chunks shorter
 * than MIN_CHARS (default 40), and calls ingestDocument via the compiled
 * service. Idempotent per (uri, version): re-running against an already
 * ingested uri creates a new version, so the previous one stays queryable.
 *
 * Note: uses tsx to load the TypeScript service. Requires `npm i -D tsx` (or
 * a compiled JS build). Falls back to a helpful error message if tsx is
 * missing.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const target = process.argv[2];
if (!target) {
  console.error('Uso: node scripts/ingest-kb.mjs <archivo-o-directorio>');
  process.exit(2);
}
const absTarget = resolve(process.cwd(), target);
if (!existsSync(absTarget)) {
  console.error(`No existe: ${absTarget}`);
  process.exit(2);
}

const MIN_CHARS = Number(process.env.KB_MIN_CHUNK_CHARS ?? 40);
const MAX_CHARS = Number(process.env.KB_MAX_CHUNK_CHARS ?? 2000);

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
  console.error('DATABASE_URL is not set (needed to connect to Supabase).');
  process.exit(2);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set (needed to compute embeddings).');
  process.exit(2);
}

function listSupportedFiles(root) {
  const s = statSync(root);
  if (s.isFile()) return [root];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = resolve(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      const ext = extname(name).toLowerCase();
      if (ext === '.md' || ext === '.txt') out.push(full);
    }
  };
  walk(root);
  return out;
}

// Very conservative chunker: split on blank lines, then bail out early if the
// paragraph exceeds MAX_CHARS by hard-slicing at whitespace boundaries.
function chunkText(text) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CHARS);

  const out = [];
  for (const p of paragraphs) {
    if (p.length <= MAX_CHARS) { out.push(p); continue; }
    let cursor = 0;
    while (cursor < p.length) {
      let end = Math.min(cursor + MAX_CHARS, p.length);
      if (end < p.length) {
        const slice = p.slice(cursor, end);
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > 0) end = cursor + lastSpace;
      }
      out.push(p.slice(cursor, end).trim());
      cursor = end;
    }
  }
  return out;
}

// Rough token count: ~4 chars per token for latin text. Good enough for the
// token_count column, which is only informational (not billing-critical).
function roughTokenCount(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

const files = listSupportedFiles(absTarget);
if (files.length === 0) {
  console.error(`No .md/.txt files under: ${absTarget}`);
  process.exit(2);
}

console.log(`[ingest-kb] ${files.length} file(s) to ingest`);

const tsxBin = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
if (!existsSync(tsxBin)) {
  console.error('tsx not found in node_modules/.bin/. Run: npm i -D tsx');
  process.exit(2);
}

for (const file of files) {
  const uri = relative(REPO_ROOT, file);
  const raw = readFileSync(file, 'utf-8');
  const chunks = chunkText(raw).map((content) => ({ content, token_count: roughTokenCount(content) }));
  if (chunks.length === 0) {
    console.warn(`[ingest-kb] SKIP ${uri} — no chunks after filtering`);
    continue;
  }
  const title = raw.split('\n', 1)[0].replace(/^#\s+/, '').trim() || uri;
  const payload = JSON.stringify({ uri, title, source_type: 'markdown', chunks });
  const runner = `
    import { ingestDocument } from './src/lib/services/knowledge-base.service.ts';
    const payload = JSON.parse(process.env.__KB_PAYLOAD ?? '{}');
    const r = await ingestDocument(payload);
    console.log(JSON.stringify(r));
  `;
  const result = spawnSync(tsxBin, ['--eval', runner], {
    cwd: REPO_ROOT,
    env: { ...process.env, __KB_PAYLOAD: payload },
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    console.error(`[ingest-kb] FAIL ${uri} (status=${result.status})`);
    process.exit(result.status ?? 1);
  }
  console.log(`[ingest-kb] OK ${uri} → ${result.stdout.trim()}`);
}
