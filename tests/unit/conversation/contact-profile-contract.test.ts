import { describe, expect, it } from 'vitest';
import {
  AgentAContextV1Schema as BackendContextSchema,
  AgentATurnProposalV1Schema as BackendProposalSchema,
} from '@/features/conversation/adapters/agent-a-brain-schema';
import {
  AgentAContextV1Schema as BotpressContextSchema,
  AgentATurnProposalV1Schema as BotpressProposalSchema,
} from '../../../botpress-agent/src/schemas/agent-a-brain';

const sourceId = '00000000-0000-4000-8000-000000000001';
const questionId = '00000000-0000-4000-8000-000000000002';
const profile = {
  version: 3,
  sources: [{ id: sourceId, text: 'Mi nombre es María del Mar y mi apellido es van der Meer', sequence: 12 }],
  pending_requests: [{ message_id: questionId, fields: ['nombre', 'apellido'], purpose: 'identity', mode: 'collect' }],
};
const baseProposal = {
  schema_version: 1,
  move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
  response: { messages: ['Gracias por los datos.', 'Cuál es tu correo?'] },
  proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
};
const updates = [
  { field: 'nombre', value: 'María del Mar', operation: 'set', source_message_id: sourceId, source_quote: 'Mi nombre es María del Mar' },
  { field: 'apellido', value: 'van der Meer', operation: 'set', source_message_id: sourceId, source_quote: 'mi apellido es van der Meer' },
];
const request = { message_index: 1, fields: ['correo'], purpose: 'payment', mode: 'collect' };

describe('structured contact profile contract at both boundaries', () => {
  const schemas = [BackendProposalSchema, BotpressProposalSchema];

  it('preserves independently supplied compound names and their source evidence', () => {
    for (const schema of schemas) {
      const parsed = schema.parse({ ...baseProposal, profile_updates: updates, profile_requests: [request] });
      expect(parsed).toMatchObject({ profile_updates: updates, profile_requests: [request] });
    }
  });

  it('keeps old proposals accepted without inserting profile arrays', () => {
    for (const schema of schemas) {
      const parsed = schema.parse(baseProposal);
      expect(parsed).not.toHaveProperty('profile_updates');
      expect(parsed).not.toHaveProperty('profile_requests');
    }
  });

  it('accepts corrections and explicit retractions without another identity field', () => {
    for (const schema of schemas) {
      expect(schema.safeParse({ ...baseProposal, profile_updates: [
        { ...updates[1], value: 'O’Neill-Singh', operation: 'correct' },
        { ...updates[0], value: null, operation: 'retract', source_quote: 'No uses mi nombre' },
      ] }).success).toBe(true);
    }
  });

  it.each([
    ['unknown field', { profile_updates: [{ ...updates[0], field: 'display_name' }] }],
    ['invented source id', { profile_updates: [{ ...updates[0], source_message_id: 'synthetic-turn' }] }],
    ['empty evidence', { profile_updates: [{ ...updates[0], source_quote: '' }] }],
    ['set without a value', { profile_updates: [{ ...updates[0], value: null }] }],
    ['retract with a value', { profile_updates: [{ ...updates[0], operation: 'retract' }] }],
    ['too many updates', { profile_updates: Array.from({ length: 9 }, () => updates[0]) }],
    ['duplicate request fields', { profile_requests: [{ ...request, fields: ['correo', 'correo'] }] }],
    ['empty request fields', { profile_requests: [{ ...request, fields: [] }] }],
    ['missing response bubble', { profile_requests: [{ ...request, message_index: 2 }] }],
    ['negative response index', { profile_requests: [{ ...request, message_index: -1 }] }],
    ['too many requests', { profile_requests: Array.from({ length: 5 }, () => request) }],
    ['model generated version', { profile_updates: [{ ...updates[0], version: 4 }] }],
  ])('rejects %s', (_label, replacement) => {
    for (const schema of schemas) expect(schema.safeParse({ ...baseProposal, ...replacement }).success).toBe(false);
  });

  it('exposes only bounded real sources and delivered field requests in customer context', () => {
    for (const schema of [BackendContextSchema, BotpressContextSchema]) {
      const customerSchema = schema.shape.customer;
      expect(customerSchema.parse({ display_name: null, memories: [], contact_profile: profile }).contact_profile).toEqual(profile);
      expect(customerSchema.safeParse({ display_name: null, memories: [], contact_profile: { ...profile, sources: Array.from({ length: 33 }, () => profile.sources[0]) } }).success).toBe(false);
      expect(customerSchema.safeParse({ display_name: null, memories: [], contact_profile: { ...profile, pending_requests: Array.from({ length: 13 }, () => profile.pending_requests[0]) } }).success).toBe(false);
    }
  });

  it('preserves confirmed partial contact values identically at both context boundaries', () => {
    const customer = { display_name: null, memories: [], contact_profile: profile,
      contact_intake: { nombre: 'ANa Sofía', apellido: null, correo: null, telefono: '+541155550101' } };
    expect(BackendContextSchema.shape.customer.parse(customer))
      .toEqual(BotpressContextSchema.shape.customer.parse(customer));
  });
});
