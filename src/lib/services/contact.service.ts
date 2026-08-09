import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import type { DbClient } from '@/lib/db/types';

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export interface Contact {
  id: string;
  phone: string;
  status: 'prospecto' | 'cliente' | 'inactivo';
  channel_origin: 'whatsapp' | 'voice';
  opted_in_at: string;
  name: string | null;
  email: string | null;
  summary: string | null;
  summary_updated_at: string | null;
  summary_version: number;
  pending_turns: number;
  lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
  sales_stage: 'new' | 'qualified' | 'offered' | 'won' | 'lost' | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ContactValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ContactValidationError';
  }
}

export async function resolveContact(params: {
  phone: string;
  channel: 'whatsapp' | 'voice';
  db?: DbClient;
  audit?: {
    event_key?: string;
    correlation_id?: string;
    causation_id?: string;
    source_event_id?: string;
  };
}): Promise<{ contact: Contact; created: boolean }> {
  const { phone, channel, db = sql, audit } = params;

  if (!E164_REGEX.test(phone)) {
    throw new ContactValidationError('INVALID_PHONE', `Phone number must be in E.164 format: ${phone}`);
  }

  // Atomic upsert: INSERT … ON CONFLICT DO NOTHING RETURNING *
  const inserted = await db<Contact[]>`
    INSERT INTO contacts (phone, channel_origin)
    VALUES (${phone}, ${channel})
    ON CONFLICT (phone) DO NOTHING
    RETURNING *
  `;

  let contact: Contact;
  let created: boolean;

  if (inserted.length > 0) {
    contact = inserted[0];
    created = true;
    counter.increment('contacts_created');
  } else {
    // Race: another request created the contact between our INSERT and DO NOTHING
    const existing = await db<Contact[]>`
      SELECT * FROM contacts WHERE phone = ${phone} LIMIT 1
    `;
    contact = existing[0];
    created = false;
  }

  logger.info({ event: 'contact.resolved', contact_id: contact.id, phone, created });

  await auditLog({
    action: created ? 'contact.created' : 'contact.accessed',
    entity_type: 'contact',
    entity_id: contact.id,
    payload: { channel },
    ...audit,
  }, db);

  return { contact, created };
}
