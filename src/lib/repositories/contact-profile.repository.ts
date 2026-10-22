import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { extractDeclaredPhones, isCallablePhoneE164V1, splitFullName } from '@/lib/heuristics/contact-identity';
import type { ContactProfileFieldV1, ContactProfileReceiptV1,
  ContactProfileUpdateV1 } from '@/shared/conversation/contact-profile-contract';

const FIELDS: readonly ContactProfileFieldV1[] = ['nombre', 'apellido', 'correo', 'telefono'];

export interface ContactProfileApplyInputV1 {
  turn_id: string;
  batch_id: string;
  claim_token: string;
  expected_version: number;
  updates: ContactProfileUpdateV1[];
  confirmed_phone?: string | null;
}

export interface StoredContactProfileFieldV1 {
  value: string | null;
  status: 'missing' | 'confirmed' | 'retracted';
  source: 'agent_a_v1' | 'legacy' | 'channel' | null;
  source_message_id: string | null;
  source_conversation_id: string | null;
  source_quote: string | null;
  source_seq: number | null;
  version: number;
  confirmation_evidence?: {
    kind: 'delivered_phone_confirmation_v1';
    suggested_message_id: string;
    suggested_quote: string;
    local_phone_message_id: string | null;
    local_phone_quote: string | null;
  };
  voice_evidence?: {
    kind: 'retell_tool' | 'retell_analysis';
    call_id: string;
    event_key: string;
    observed_at: string;
    source_call_event_id: string | null;
    value: string;
  };
}

export interface StoredContactProfileV1 {
  schema_version: 1;
  owner: 'agent_a_v1';
  version: number;
  fields: Record<ContactProfileFieldV1, StoredContactProfileFieldV1>;
  external_receipts_v1?: Record<string, ContactProfileReceiptV1>;
}

interface ContactProfileRowV1 {
  id: string;
  phone: string;
  declared_phone: string | null;
  name: string | null;
  email: string | null;
  contact_profile_v1: StoredContactProfileV1 | null;
}

/** Authorization failures are request failures; invalid individual fields are receipts. */
export class ContactProfileClaimNotAuthorizedError extends Error {
  readonly code = 'CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED';
  constructor() {
    super('Contact profile request does not own the claimed inbound batch');
    this.name = 'ContactProfileClaimNotAuthorizedError';
  }
}

export function isAgentOwnedContactProfileV1(value: unknown): value is StoredContactProfileV1 {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (value as { owner?: unknown }).owner === 'agent_a_v1';
}

export function contactProfileValuesV1(profile: StoredContactProfileV1): ContactProfileReceiptV1['values'] {
  return { nombre: profile.fields.nombre.value, apellido: profile.fields.apellido.value,
    correo: profile.fields.correo.value, telefono: profile.fields.telefono.value };
}

function initialField(value: string | null, source: 'legacy' | 'channel'): StoredContactProfileFieldV1 {
  return { value, status: value === null ? 'missing' : 'confirmed', source: value === null ? null : source,
    source_message_id: null, source_conversation_id: null, source_quote: null, source_seq: null, version: 0 };
}

/** Only already durable contact columns migrate. Legacy partial message captures are never promoted. */
function bootstrapContactProfileV1(row: ContactProfileRowV1): StoredContactProfileV1 {
  const name = row.name ? splitFullName(row.name) : null;
  const declared = isCallablePhoneE164V1(row.declared_phone) ? row.declared_phone : null;
  const phone = declared ?? (isCallablePhoneE164V1(row.phone) ? row.phone : null);
  return { schema_version: 1, owner: 'agent_a_v1', version: 0, fields: {
    nombre: initialField(name?.nombre || null, 'legacy'), apellido: initialField(name?.apellido || null, 'legacy'),
    correo: initialField(row.email, 'legacy'), telefono: initialField(phone, declared ? 'legacy' : 'channel'),
  } };
}

export async function loadContactProfileV1(contactId: string, db: DbClient = orchestratorSql): Promise<StoredContactProfileV1 | null> {
  const [row] = await db<Array<{ contact_profile_v1: StoredContactProfileV1 | null }>>`
    SELECT contact_profile_v1 FROM contacts WHERE id = ${contactId}::uuid AND deleted_at IS NULL LIMIT 1
  `;
  return isAgentOwnedContactProfileV1(row?.contact_profile_v1) ? row.contact_profile_v1 : null;
}

/** Caller owns a transaction; row lock also fences concurrent legacy ingestion. */
export async function ensureAgentOwnedContactProfileV1(contactId: string, db: DbClient): Promise<StoredContactProfileV1> {
  const [row] = await db<ContactProfileRowV1[]>`
    SELECT id, phone, declared_phone, name, email, contact_profile_v1 FROM contacts
    WHERE id = ${contactId}::uuid AND deleted_at IS NULL FOR UPDATE
  `;
  if (!row) throw new ContactProfileClaimNotAuthorizedError();
  if (isAgentOwnedContactProfileV1(row.contact_profile_v1)) return row.contact_profile_v1;
  const profile = bootstrapContactProfileV1(row);
  await db`UPDATE contacts SET contact_profile_v1 = ${jsonbParam(db, profile)}, updated_at = now()
    WHERE id = ${contactId}::uuid`;
  return profile;
}

const normalizeText = (value: string): string => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
const foldedText = (value: string): string => normalizeText(value).toLowerCase();

function equivalentFieldValueV1(
  field: ContactProfileFieldV1,
  current: string | null,
  proposed: string | null,
): boolean {
  if (current === null || proposed === null) return current === proposed;
  // Names preserve the spelling first confirmed by the customer. Re-observing
  // that same spelling with casing or chat whitespace differences is a no-op,
  // not a correction. Accents and punctuation remain meaningful: removing an
  // accent or changing an apostrophe still requires explicit correction.
  if (field === 'nombre' || field === 'apellido') {
    return foldedText(current) === foldedText(proposed);
  }
  return current === proposed;
}

function normalizeFieldValue(field: ContactProfileFieldV1, value: string): string | null {
  const normalized = normalizeText(value);
  if (field === 'nombre' || field === 'apellido') {
    return normalized.length > 0 && normalized.length <= 160 && !/\p{Cc}/u.test(normalized) ? normalized : null;
  }
  if (field === 'correo') {
    const email = normalized.toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
  }
  if (!/^\+[\d\s().-]+$/u.test(normalized)) return null;
  const phone = normalized.replace(/[\s().-]/gu, '');
  return isCallablePhoneE164V1(phone) ? phone : null;
}

interface AuthorizedSourceV1 {
  id: string;
  content: string;
  conversation_seq: number | string;
  message_type: string | null;
  channel: string;
}

async function isWrittenWhatsappSourceV1(
  db: DbClient,
  contactId: string,
  sourceMessageId: string | null,
): Promise<boolean> {
  if (!sourceMessageId) return false;
  const [source] = await db<Array<{ authorized: boolean }>>`
    SELECT (
      message.direction = 'inbound'
      AND message.metadata->>'message_type' = 'text'
      AND conversation.channel = 'whatsapp'
    ) AS authorized
    FROM messages AS message
    JOIN conversations AS conversation ON conversation.id = message.conversation_id
    WHERE message.id = ${sourceMessageId}::uuid
      AND message.contact_id = ${contactId}::uuid
    LIMIT 1
  `;
  return source?.authorized === true;
}

/** Local sequence orders one conversation; immutable ingress time fences older evidence across conversations. */
export async function isContactProfileSourceStaleV1(db: DbClient, input: {
  contactId: string; current: StoredContactProfileFieldV1;
  source: { id: string; conversation_id: string; conversation_seq: number | null };
}): Promise<boolean> {
  const { current, source } = input;
  if (current.voice_evidence) {
    const [ordering] = await db<Array<{ stale: boolean }>>`
      SELECT created_at < ${current.voice_evidence.observed_at}::timestamptz AS stale
      FROM messages WHERE id = ${source.id}::uuid AND contact_id = ${input.contactId}::uuid AND direction = 'inbound'
    `;
    return ordering?.stale ?? true;
  }
  if (!current.source_message_id) return false;
  if (current.source_message_id === source.id) return false;
  if (current.source_conversation_id === source.conversation_id && current.source_seq !== null && source.conversation_seq !== null) {
    return source.conversation_seq < current.source_seq;
  }
  const [ordering] = await db<Array<{ stale: boolean }>>`
    SELECT saved.created_at > proposed.created_at AS stale FROM messages saved JOIN messages proposed
      ON proposed.id = ${source.id}::uuid AND proposed.contact_id = saved.contact_id AND proposed.direction = 'inbound'
    WHERE saved.id = ${current.source_message_id}::uuid AND saved.contact_id = ${input.contactId}::uuid
      AND saved.direction = 'inbound'
  `;
  return ordering?.stale ?? true;
}

export class ContactProfileExternalUpdateRejectedError extends Error {
  readonly code = 'CONTACT_PROFILE_EXTERNAL_UPDATE_REJECTED';
  constructor(readonly rejections: ContactProfileReceiptV1['rejections']) {
    super(rejections.map(rejection => `${rejection.field}:${rejection.code}`).join(','));
    this.name = 'ContactProfileExternalUpdateRejectedError';
  }
}

/** Trusted typed voice observations use call provenance, never fabricated inbound quotations. Caller owns a transaction. */
export async function applyStructuredVoiceContactProfileV1(db: DbClient, input: {
  contactId: string;
  callId: string;
  source: { kind: 'retell_tool' | 'retell_analysis'; event_key: string; occurred_at: string; source_call_event_id?: string };
  values: Partial<Record<ContactProfileFieldV1, string>>;
}): Promise<{ receipt: ContactProfileReceiptV1; replayed: boolean }> {
  const [contact] = await db<ContactProfileRowV1[]>`
    SELECT id, phone, declared_phone, name, email, contact_profile_v1 FROM contacts
    WHERE id = ${input.contactId}::uuid AND deleted_at IS NULL FOR UPDATE
  `;
  const [call] = await db<Array<{ conversation_id: string }>>`
    SELECT conversation_id FROM call_sessions WHERE id = ${input.callId}::uuid
      AND contact_id = ${input.contactId}::uuid AND provider = 'retell'
  `;
  if (!contact || !call || !isAgentOwnedContactProfileV1(contact.contact_profile_v1)) throw new ContactProfileClaimNotAuthorizedError();
  let observedAt = input.source.occurred_at;
  if (input.source.kind === 'retell_analysis') {
    const [event] = await db<Array<{ observed_at: string; email: string | null; event_id: string }>>`
      SELECT to_char(LEAST(event.occurred_at, event.recorded_at, session.created_at) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at,
        event.payload#>>'{analysis,email_capturado}' AS email, event.event_id
      FROM call_events event JOIN call_sessions session ON session.id = event.call_id
      WHERE event.id = ${input.source.source_call_event_id ?? null}::uuid AND event.call_id = ${input.callId}::uuid
        AND event.provider = 'retell' AND event.event_type = 'analyzed'
    `;
    if (!event || event.event_id !== input.source.event_key
      || normalizeFieldValue('correo', event.email ?? '') !== normalizeFieldValue('correo', input.values.correo ?? '')
      || Object.keys(input.values).some(field => field !== 'correo')) throw new ContactProfileClaimNotAuthorizedError();
    observedAt = event.observed_at;
  }
  const profile = structuredClone(contact.contact_profile_v1);
  const key = sha256Hex({ call_id: input.callId, kind: input.source.kind, event_key: input.source.event_key, values: input.values });
  const cached = profile.external_receipts_v1?.[key];
  if (cached) return { receipt: cached, replayed: true };
  const accepted: ContactProfileFieldV1[] = [];
  const rejections: ContactProfileReceiptV1['rejections'] = [];
  const receiptLimit = Object.keys(profile.external_receipts_v1 ?? {}).length >= 128;
  for (const field of FIELDS) {
    const supplied = input.values[field];
    if (supplied === undefined) continue;
    const reject = (code: string) => rejections.push({ field, code });
    if (receiptLimit) { reject('EXTERNAL_RECEIPT_LIMIT'); continue; }
    const value = normalizeFieldValue(field, supplied);
    if (value === null) { reject('INVALID_FORMAT'); continue; }
    const current = profile.fields[field];
    let stale = false;
    if (current.voice_evidence) {
      const [ordering] = await db<Array<{ stale: boolean }>>`
        SELECT ${current.voice_evidence.observed_at}::timestamptz > ${observedAt}::timestamptz AS stale
      `;
      stale = ordering.stale;
    }
    if (current.source_message_id) {
      const [ordering] = await db<Array<{ stale: boolean }>>`
        SELECT created_at > ${observedAt}::timestamptz AS stale FROM messages
        WHERE id = ${current.source_message_id}::uuid AND contact_id = ${input.contactId}::uuid AND direction = 'inbound'
      `;
      stale ||= ordering?.stale ?? true;
    }
    if (stale) { reject('STALE_SOURCE'); continue; }
    if (current.value === value) continue;
    profile.fields[field] = { value, status: 'confirmed', source: 'legacy', source_message_id: null,
      source_conversation_id: call.conversation_id, source_seq: null, source_quote: null, version: profile.version + 1,
      voice_evidence: { kind: input.source.kind, call_id: input.callId, event_key: input.source.event_key,
        observed_at: observedAt, source_call_event_id: input.source.source_call_event_id ?? null, value: supplied } };
    accepted.push(field);
  }
  if (accepted.length) profile.version += 1;
  const values = contactProfileValuesV1(profile);
  const receipt: ContactProfileReceiptV1 = { version: profile.version, values, accepted_fields: accepted, rejections };
  // Keep all retained replay identities; reaching the bound explicitly rejects new voice writes.
  if (!receiptLimit) profile.external_receipts_v1 = { ...profile.external_receipts_v1, [key]: receipt };
  const name = values.nombre ? [values.nombre, values.apellido].filter(Boolean).join(' ') : null;
  const declaredPhone = profile.fields.telefono.source === 'channel' ? contact.declared_phone : values.telefono;
  await db`UPDATE contacts SET contact_profile_v1 = ${jsonbParam(db, profile)}, name = ${name}, email = ${values.correo},
    declared_phone = ${declaredPhone}, updated_at = now() WHERE id = ${input.contactId}::uuid`;
  return { receipt, replayed: false };
}

function valueValidation(update: ContactProfileUpdateV1): { value: string | null; rejection?: string } {
  if (update.operation === 'retract') return update.value === null ? { value: null } : { value: null, rejection: 'INVALID_FORMAT' };
  if (typeof update.value !== 'string') return { value: null, rejection: 'INVALID_FORMAT' };
  const value = normalizeFieldValue(update.field, update.value);
  if (value === null) return { value: null, rejection: 'INVALID_FORMAT' };
  if (update.field === 'telefono') {
    if (!extractDeclaredPhones(update.source_quote).some(candidate => normalizeFieldValue('telefono', candidate) === value)) {
      return { value: null, rejection: 'VALUE_MISMATCH' };
    }
  } else {
    const quote = foldedText(update.source_quote);
    const literal = foldedText(value);
    let matched = false;
    for (let index = quote.indexOf(literal); index >= 0; index = quote.indexOf(literal, index + 1)) {
      const before = quote[index - 1] ?? '';
      const after = quote[index + literal.length] ?? '';
      const afterNext = quote[index + literal.length + 1] ?? '';
      const continuation = update.field === 'correo' ? /[\p{L}\p{M}\p{N}_+@-]/u : /[\p{L}\p{M}\p{N}]/u;
      if (!continuation.test(before) && !continuation.test(after)
        && !(update.field === 'correo' && after === '.' && /[\p{L}\p{N}]/u.test(afterNext))) { matched = true; break; }
    }
    if (!matched) return { value: null, rejection: 'VALUE_MISMATCH' };
  }
  return { value };
}

/**
 * Persist observations in a separate transaction before reply/effect validation.
 * Interpretation belongs to Agent A: this repository checks literal evidence,
 * technical format, ownership and field versions; it never parses dialogue.
 */
export async function applyContactProfileUpdatesV1(db: DbClient, input: ContactProfileApplyInputV1): Promise<ContactProfileReceiptV1> {
  const [turn] = await db<Array<{ contact_id: string; conversation_id: string }>>`
    SELECT contact_id, conversation_id FROM messages WHERE id = ${input.turn_id}::uuid AND direction = 'inbound'
  `;
  if (!turn) throw new ContactProfileClaimNotAuthorizedError();
  // Contact first: every profile writer serializes here before inspecting the current field versions.
  const [contact] = await db<ContactProfileRowV1[]>`
    SELECT id, phone, declared_phone, name, email, contact_profile_v1 FROM contacts
    WHERE id = ${turn.contact_id}::uuid AND deleted_at IS NULL FOR UPDATE
  `;
  if (!contact) throw new ContactProfileClaimNotAuthorizedError();
  const [batch] = await db<Array<{ state: string; claim_token: string | null; lease_valid: boolean;
    representative_turn_id: string; max_seq: string | number | null }>>`
    SELECT b.state, b.claim_token, b.lease_until > now() AS lease_valid, b.representative_turn_id,
      (SELECT max(m.conversation_seq) FROM messages m WHERE m.batch_id = b.id AND m.direction = 'inbound') AS max_seq
    FROM inbound_batches b WHERE b.id = ${input.batch_id}::uuid AND b.contact_id = ${turn.contact_id}::uuid
      AND b.conversation_id = ${turn.conversation_id}::uuid FOR UPDATE
  `;
  // Read current ownership even for cached requests: a stolen/reclaimed token cannot replay an old receipt.
  if (!batch || batch.claim_token !== input.claim_token || batch.representative_turn_id !== input.turn_id
    || !['claimed', 'completed'].includes(batch.state) || batch.max_seq === null) throw new ContactProfileClaimNotAuthorizedError();
  const [message] = await db<Array<{ metadata: Record<string, unknown> | null }>>`
    SELECT metadata FROM messages WHERE id = ${input.turn_id}::uuid FOR UPDATE
  `;
  const key = sha256Hex({ expected_version: input.expected_version, updates: input.updates, confirmed_phone: input.confirmed_phone ?? null });
  const tokenHash = sha256Hex(input.claim_token);
  const cache = message.metadata?.contact_profile_receipts_v1 as Record<string, {
    claim_token_hash: string; batch_id: string; receipt: ContactProfileReceiptV1;
  }> | undefined;
  const cached = cache?.[key];
  if (cached?.claim_token_hash === tokenHash && cached.batch_id === input.batch_id) return cached.receipt;
  if (batch.state !== 'claimed' || !batch.lease_valid) throw new ContactProfileClaimNotAuthorizedError();

  const profile = structuredClone(isAgentOwnedContactProfileV1(contact.contact_profile_v1)
    ? contact.contact_profile_v1 : bootstrapContactProfileV1(contact));
  const sources = await db<AuthorizedSourceV1[]>`
    SELECT message.id, message.content, message.conversation_seq,
      message.metadata->>'message_type' AS message_type,
      conversation.channel
    FROM messages AS message
    JOIN conversations AS conversation ON conversation.id = message.conversation_id
    WHERE message.conversation_id = ${turn.conversation_id}::uuid
      AND message.contact_id = ${turn.contact_id}::uuid
      AND message.direction = 'inbound' AND message.conversation_seq <= ${Number(batch.max_seq)}
      AND COALESCE(message.metadata->>'message_type', 'text') <> 'unsupported'
    ORDER BY message.conversation_seq DESC LIMIT 32
  `;
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const accepted: ContactProfileFieldV1[] = [];
  const rejections: ContactProfileReceiptV1['rejections'] = [];
  const touched = new Set<ContactProfileFieldV1>();
  for (const update of input.updates) {
    const reject = (code: string) => rejections.push({ field: update.field, code });
    if (!FIELDS.includes(update.field) || touched.has(update.field)) { reject('INVALID_FORMAT'); continue; }
    touched.add(update.field);
    const source = sourceById.get(update.source_message_id);
    if (!source || !update.source_quote.trim()
      || !source.content.normalize('NFC').includes(update.source_quote.normalize('NFC'))) { reject('SOURCE_NOT_AUTHORIZED'); continue; }
    const normalized = valueValidation(update);
    if (normalized.rejection) { reject(normalized.rejection); continue; }
    const current = profile.fields[update.field];
    const sourceSeq = Number(source.conversation_seq);
    if (await isContactProfileSourceStaleV1(db, { contactId: turn.contact_id, current,
      source: { id: source.id, conversation_id: turn.conversation_id, conversation_seq: sourceSeq } })) {
      reject('STALE_SOURCE'); continue;
    }
    if (!Number.isInteger(input.expected_version) || input.expected_version < 0 || input.expected_version > profile.version
      || current.version > input.expected_version) { reject('VERSION_CONFLICT'); continue; }
    // Retraction is meaningful even if the value is already empty: it records
    // this turn as the withdrawal source and fences older confirmation proof.
    const sameValue = update.operation !== 'retract'
      && equivalentFieldValueV1(update.field, current.value, normalized.value);
    if (sameValue) {
      const promotesWrittenWhatsappEmail = update.field === 'correo'
        && source.message_type === 'text'
        && source.channel === 'whatsapp'
        && !await isWrittenWhatsappSourceV1(db, turn.contact_id, current.source_message_id);
      if (!promotesWrittenWhatsappEmail) continue;
    }
    if (!sameValue && current.value !== null && normalized.value !== null && update.operation !== 'correct') {
      reject('CORRECTION_REQUIRED'); continue;
    }
    profile.fields[update.field] = { value: normalized.value, status: update.operation === 'retract' ? 'retracted' : 'confirmed',
      source: 'agent_a_v1', source_message_id: source.id, source_conversation_id: turn.conversation_id,
      source_quote: update.source_quote, source_seq: sourceSeq, version: profile.version + 1 };
    accepted.push(update.field);
  }
  if (accepted.length > 0) profile.version += 1;
  const values = contactProfileValuesV1(profile);
  const fullName = values.nombre ? [values.nombre, values.apellido].filter(Boolean).join(' ') : null;
  // Channel identity stays immutable; only a declared profile phone projects to declared_phone.
  const declaredPhone = profile.fields.telefono.source === 'channel' ? contact.declared_phone : values.telefono;
  await db`UPDATE contacts SET contact_profile_v1 = ${jsonbParam(db, profile)}, name = ${fullName},
    email = ${values.correo}, declared_phone = ${declaredPhone}, updated_at = now() WHERE id = ${contact.id}::uuid`;
  let finalProfile = profile;
  if (input.confirmed_phone !== undefined && input.confirmed_phone !== null) {
    // Loaded at call time so the dedicated confirmation proof can reuse these
    // profile primitives without a module initialization cycle.
    const { confirmDeliveredContactPhone } = await import('./contact-phone-confirmation.repository');
    const explicitPhoneAccepted = accepted.includes('telefono');
    const authorized = explicitPhoneAccepted ? profile.fields.telefono.value === input.confirmed_phone
      : Number.isInteger(input.expected_version) && input.expected_version >= 0 && input.expected_version <= profile.version
        && profile.fields.telefono.version <= input.expected_version
        && await confirmDeliveredContactPhone({ turnId: input.turn_id, phone: input.confirmed_phone }, db);
    if (authorized) {
      if (!accepted.includes('telefono')) accepted.push('telefono');
      finalProfile = (await loadContactProfileV1(contact.id, db))!;
    } else rejections.push({ field: 'telefono', code: 'PHONE_CONFIRMATION_NOT_AUTHORIZED' });
  }
  const receipt: ContactProfileReceiptV1 = { version: finalProfile.version, values: contactProfileValuesV1(finalProfile), accepted_fields: accepted, rejections };
  const receipts = { ...cache, [key]: { claim_token_hash: tokenHash, batch_id: input.batch_id, receipt } };
  await db`UPDATE messages SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object('contact_profile_receipts_v1', ${jsonbParam(db, receipts)}) WHERE id = ${input.turn_id}::uuid`;
  return receipt;
}
