#!/usr/bin/env node
/**
 * Live Gemini transcription smoke test.
 * Uso:
 *   node scripts/smoke-transcribe-gemini.mjs path/to/audio.ogg
 *
 * Lee GEMINI_API_KEY de .env.local (o del entorno). Modelo por default
 * gemini-2.5-flash. Formatos soportados por Gemini: ogg, mp3, mp4, wav, flac, aac.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

function loadEnvLocal() {
  const path = resolve(REPO_ROOT, '.env.local');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

const audioPath = process.argv[2];
if (!audioPath) {
  console.error('Uso: node scripts/smoke-transcribe-gemini.mjs <ruta a audio>');
  process.exit(2);
}
const absolutePath = resolve(process.cwd(), audioPath);
if (!existsSync(absolutePath)) {
  console.error(`No existe: ${absolutePath}`);
  process.exit(2);
}

const env = { ...loadEnvLocal(), ...process.env };
const apiKey = env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY no seteado (ni en .env.local ni en entorno).');
  process.exit(2);
}
const model = env.GEMINI_MODEL ?? 'gemini-2.5-flash';

const bytes = readFileSync(absolutePath);
const ext = absolutePath.split('.').pop()?.toLowerCase() ?? '';
const mimeByExt = {
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
};
const mime = mimeByExt[ext] ?? 'audio/ogg';

const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
const body = {
  contents: [
    {
      role: 'user',
      parts: [
        {
          text: 'Transcribí exactamente el audio a texto en el idioma original. Devolvé sólo el texto transcrito, sin comillas, sin comentarios, sin marcadores de tiempo, sin descripción de tonos ni ruidos. Si el audio está en silencio o es ininteligible, devolvé exactamente "[audio_ininteligible]".',
        },
        { inline_data: { mime_type: mime, data: bytes.toString('base64') } },
      ],
    },
  ],
  generation_config: { temperature: 0, max_output_tokens: 1024, response_mime_type: 'text/plain' },
};

const started = Date.now();
const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const elapsed = Date.now() - started;

if (!response.ok) {
  console.error(`HTTP ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const payload = await response.json();
const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();

console.log(JSON.stringify({
  status: text ? 'ok' : 'failed',
  model,
  mime_type: mime,
  file_size_bytes: bytes.length,
  elapsed_ms: elapsed,
  transcript: text ?? null,
}, null, 2));
