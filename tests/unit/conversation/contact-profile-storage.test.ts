import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@/lib/db/types';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { InboundEnvelopeSchema } from '@/lib/contracts/inbound-envelope';

vi.mock('@/lib/db/orchestrator', () => ({ sql: vi.fn() }));

const field = (value: string | null) => ({ value, status: value === null ? 'missing' : 'confirmed',
  source: 'agent_a_v1', source_message_id: null, source_conversation_id: null, source_quote: null, source_seq: null, version: 1 });

describe('Agent A contact profile storage boundary', () => {
  it('reads an independent surname even before a first name exists', async () => {
    const db = vi.fn().mockResolvedValue([{ phone: '+5491132104399', declared_phone: null,
      name: null, email: null, contact_profile_v1: { schema_version: 1, owner: 'agent_a_v1', version: 1,
        fields: { nombre: field(null), apellido: field('de la Croix'), correo: field(null),
          telefono: field('+5491132104399') } } }]) as unknown as DbClient;
    expect(await loadContactIntakeV1('00000000-0000-4000-8000-000000000001', db)).toEqual({
      nombre: null, apellido: 'de la Croix', correo: null, telefono: '+5491132104399',
    });
  });

  it('keeps a compound first name independent from the missing surname', async () => {
    const db = vi.fn().mockResolvedValue([{ phone: '+9991132104399', declared_phone: null,
      name: 'Ana María', email: null, contact_profile_v1: { schema_version: 1, owner: 'agent_a_v1', version: 1,
        fields: { nombre: field('Ana María'), apellido: field(null), correo: field(null), telefono: field(null) } } }]) as unknown as DbClient;
    expect(await loadContactIntakeV1('00000000-0000-4000-8000-000000000001', db)).toEqual({
      nombre: 'Ana María', apellido: null, correo: null, telefono: null,
    });
  });

  it('preserves the signed ownership marker through backend envelope parsing', () => {
    const parsed = InboundEnvelopeSchema.parse({ schema_version: 1, source: 'botpress', channel: 'whatsapp',
      identity_owner: 'agent_a_v1', integration_id: 'unit', external_message_id: 'one',
      external_conversation_id: 'one', external_user_id: 'one', phone_e164: '+5491132104399',
      trace_id: '00000000-0000-4000-8000-000000000001', message: {
        type: 'text', text: 'Hola', occurred_at: '2026-10-14T10:00:00Z',
      } });
    expect(parsed).toHaveProperty('identity_owner', 'agent_a_v1');
  });
});
