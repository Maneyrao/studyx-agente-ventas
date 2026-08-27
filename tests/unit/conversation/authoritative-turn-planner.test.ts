import { describe, expect, it } from 'vitest';
import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import type { ConversationStateStoreV1 } from '@/features/conversation/ports/conversation-state-store';
import {
  authoritativelyPlanConversationTurnV1,
  buildPlanningBusinessContextV1,
} from '@/features/conversation/application/plan-conversation-turn';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const conversationId = '00000000-0000-4000-8000-000000000002';
const contactId = '00000000-0000-4000-8000-000000000003';

const catalog: CatalogIndexView = {
  as_of: '2026-08-27T15:00:00.000Z',
  offerings_total: 1,
  offerings: [{
    code: 'redes-informaticas', display_name: 'Redes Informáticas',
    academy: 'Tecnología', aliases: ['Curso de Redes'],
  }],
  injection_suspected_count: 0,
};

const business = {
  as_of: catalog.as_of,
  prices_assertable: true,
  workspace: {
    slug: 'studyx', display_name: 'StudyX', environment: 'sandbox',
    default_locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires',
    payment_options: [{
      code: 'monthly_12', label: '12 cuotas mensuales',
      total: { amount: '360.00', currency: 'USD' }, installments: 12,
      installment_amount: '30.00', payment_link: 'https://buy.stripe.com/test_private',
    }],
  },
  offerings: [{
    code: 'redes-informaticas', display_name: 'Redes Informáticas', aliases: ['Curso de Redes'],
    academy: 'Tecnología', offering_type: 'course', description: 'Formación canónica en redes.',
    value_proposition: null, price_type: 'fixed', price: { amount: '360.00', currency: 'USD' },
    price_assertable: true, billing_interval: null, modality: 'online', schedules: [],
    certification: true, hours_per_month: 8, classes: 24, modules: 4, includes: [],
    syllabus_published: true, language: 'Spanish', min_age: null,
    policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
  }],
  qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
} satisfies BusinessContextView;

const emptyStateStore: ConversationStateStoreV1 = {
  async load() { return null; },
  async transition() { throw new Error('planning must not persist state'); },
};

describe('authoritative conversation planner V1', () => {
  it('re-resolves model references against canonical business data and exposes no values', async () => {
    const result = await authoritativelyPlanConversationTurnV1({
      turn: { workspace_id: workspaceId, conversation_id: conversationId, contact_id: contactId },
      workspace_slug: 'studyx',
      move: {
        schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
        course_reference: 'Curso de Redes', confidence: 0.96,
      },
      business_context: business,
      catalog_index: catalog,
    }, { state_store: emptyStateStore });

    expect(result.plan).toMatchObject({
      selected_offering_code: 'redes-informaticas',
      allowed_business_action: { type: 'none' },
    });
    expect(result.state_version).toBe(0);
    expect(result.fact_refs.map((fact) => fact.id)).toContain('offering:redes-informaticas:name:v1');
    expect(JSON.stringify(result)).not.toContain('Formación canónica en redes.');
    expect(JSON.stringify(result)).not.toContain('stripe.com');
    expect(result.plan_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not trust an invented course or payment plan from the interpreter', async () => {
    const result = await authoritativelyPlanConversationTurnV1({
      turn: { workspace_id: workspaceId, conversation_id: conversationId, contact_id: contactId },
      workspace_slug: 'studyx',
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
        course_reference: 'Curso inexistente', payment_plan: 'monthly_6', confidence: 0.99,
      },
      business_context: business,
      catalog_index: catalog,
    }, { state_store: emptyStateStore });

    expect(result.plan).toMatchObject({
      allowed_business_action: { type: 'none' },
      selected_offering_code: null,
      missing_information: ['course_selection'],
    });
  });

  it('derives strict areas, offerings and plans exclusively from the snapshots', () => {
    expect(buildPlanningBusinessContextV1(business, catalog)).toEqual({
      catalog_available: true,
      areas: [{ code: 'tecnologia', display_name: 'Tecnología' }],
      offerings: [{
        code: 'redes-informaticas', display_name: 'Redes Informáticas',
        area_code: 'tecnologia', aliases: ['Curso de Redes'],
      }],
      payment_plans: ['monthly_12'],
    });
  });

  it('keeps the plan hash stable when only snapshot read timestamps change', async () => {
    const input = {
      turn: { workspace_id: workspaceId, conversation_id: conversationId, contact_id: contactId },
      workspace_slug: 'studyx',
      move: {
        schema_version: 1 as const, move: 'ask_course_information' as const,
        secondary_moves: [], vetoes: [], confidence: 0.96,
      },
    };
    const first = await authoritativelyPlanConversationTurnV1({
      ...input, business_context: business, catalog_index: catalog,
    }, { state_store: emptyStateStore });
    const second = await authoritativelyPlanConversationTurnV1({
      ...input,
      business_context: { ...business, as_of: '2026-08-27T15:00:01.000Z' },
      catalog_index: { ...catalog, as_of: '2026-08-27T15:00:01.000Z' },
    }, { state_store: emptyStateStore });

    expect(second.plan_hash).toBe(first.plan_hash);
  });
});
