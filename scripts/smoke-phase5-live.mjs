#!/usr/bin/env node
/**
 * Phase 5 live smoke: 5 sandbox contacts × 10 interleaved messages via
 * Promise.all — assert each contact ends with exactly its own 10 in
 * chronological order. All rows are cleaned up before exit.
 *
 * Uses synthetic +9990000000X phones + sandbox_identities to obey the
 * "no real effects on sandbox contacts" lock. Runs against DATABASE_URL.
 */
import postgres from 'postgres';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ENV_PATH = resolve(ROOT, '.env.local');
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq);
    if (process.env[k] === undefined) process.env[k] = t.slice(eq + 1);
  }
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(2); }

const CONTACT_COUNT = 5;
const MSGS_PER_CONTACT = 10;
const RUN_TAG = `smoke-p5-${Math.floor(Date.now()/1000)}`;
const sql = postgres(process.env.DATABASE_URL, { max: 5, prepare: false });

function synthPhone(i) { return `+99900000${String(i).padStart(2, '0')}`; }

async function main() {
  console.log(`[smoke-phase5] tag=${RUN_TAG} contacts=${CONTACT_COUNT} msgs=${MSGS_PER_CONTACT}`);

  // 1. Insert contacts + sandbox_identities + one conversation each
  const contacts = [];
  for (let i = 0; i < CONTACT_COUNT; i++) {
    const [c] = await sql`
      INSERT INTO contacts (phone, channel_origin, status, name)
      VALUES (${synthPhone(i)}, 'whatsapp', 'prospecto', ${RUN_TAG + '-c' + i})
      RETURNING id, phone
    `;
    await sql`
      INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
      VALUES ('telegram_sandbox', ${'ext-' + RUN_TAG + '-' + i}, ${c.id}, ${c.phone})
    `;
    const [conv] = await sql`
      INSERT INTO conversations (contact_id, channel, status)
      VALUES (${c.id}, 'whatsapp', 'open')
      RETURNING id
    `;
    contacts.push({ id: c.id, phone: c.phone, conv_id: conv.id, idx: i });
  }

  // 2. Fire 5*10 = 50 message inserts concurrently, INTERLEAVED across contacts.
  //    Each message tagged with "run + contact-idx + msg-idx" so we can verify.
  const jobs = [];
  for (let m = 0; m < MSGS_PER_CONTACT; m++) {
    for (const c of contacts) {
      const content = `${RUN_TAG}|c=${c.idx}|m=${m}`;
      jobs.push(sql`
        INSERT INTO messages (conversation_id, contact_id, direction, content)
        VALUES (${c.conv_id}, ${c.id}, 'inbound', ${content})
        RETURNING id, created_at
      `);
    }
  }
  const t0 = Date.now();
  const results = await Promise.all(jobs);
  console.log(`[smoke-phase5] inserted ${results.length} messages in ${Date.now()-t0}ms`);

  // 3. Bump pending_turns + summary_version to prove the additive column works
  for (const c of contacts) {
    await sql`
      UPDATE contacts
      SET pending_turns = pending_turns + ${MSGS_PER_CONTACT},
          summary = ${`stub-summary for c${c.idx} (${RUN_TAG})`},
          summary_updated_at = now(),
          summary_version = summary_version + 1
      WHERE id = ${c.id}
    `;
  }

  // 4. Verify: each contact returns EXACTLY its 10 messages, chronologically
  let ok = true;
  for (const c of contacts) {
    const rows = await sql`
      SELECT content, created_at
      FROM messages
      WHERE contact_id = ${c.id}
      ORDER BY created_at ASC, id ASC
    `;
    if (rows.length !== MSGS_PER_CONTACT) {
      console.error(`[FAIL] contact ${c.idx} has ${rows.length} messages, expected ${MSGS_PER_CONTACT}`);
      ok = false; continue;
    }
    // Every content must start with our tag AND reference c=<idx>
    const bad = rows.filter((r) => !r.content.startsWith(RUN_TAG) || !r.content.includes(`|c=${c.idx}|`));
    if (bad.length) {
      console.error(`[FAIL] contact ${c.idx} contains ${bad.length} foreign messages`);
      ok = false; continue;
    }
    // summary_version must be exactly 1 (fresh contact)
    const [v] = await sql`SELECT summary_version, pending_turns FROM contacts WHERE id = ${c.id}`;
    if (v.summary_version !== 1 || v.pending_turns !== MSGS_PER_CONTACT) {
      console.error(`[FAIL] contact ${c.idx} summary_version=${v.summary_version} pending_turns=${v.pending_turns}`);
      ok = false;
    }
  }

  // 5. Cleanup — order matters (FKs)
  for (const c of contacts) {
    await sql`DELETE FROM messages WHERE contact_id = ${c.id}`;
    await sql`DELETE FROM conversations WHERE contact_id = ${c.id}`;
    await sql`DELETE FROM sandbox_identities WHERE contact_id = ${c.id}`;
    await sql`DELETE FROM contacts WHERE id = ${c.id}`;
  }
  console.log(`[smoke-phase5] cleanup OK`);

  await sql.end({ timeout: 5 });
  if (!ok) { console.error('[smoke-phase5] FAIL'); process.exit(1); }
  console.log(`[smoke-phase5] ✅ PASS — ${CONTACT_COUNT} contacts × ${MSGS_PER_CONTACT} concurrent inserts, no cross-contact bleed, summary_version bumped`);
}

main().catch(async (e) => {
  console.error(String(e && e.stack || e));
  try { await sql.end({ timeout: 5 }); } catch {}
  process.exit(1);
});
