import { describe, expect, it } from 'vitest';
import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import {
  buildCanonicalFactRegistry,
  materializeCanonicalFactRequests,
} from '@/features/conversation/domain/canonical-fact-registry';

const catalog: CatalogIndexView = {
  as_of: '2026-08-27T00:00:00.000Z',
  offerings_total: 2,
  offerings: [
    { code: 'redes-informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: [] },
    { code: 'armado-reparacion-pc', display_name: 'Armado y Reparación de PC', academy: 'Tecnología', aliases: [] },
  ],
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
      total: { amount: '360', currency: 'USD' }, installments: 12,
      installment_amount: '30', payment_link: 'https://buy.stripe.com/test_canonical',
    }],
  },
  offerings: [{
    code: 'redes-informaticas', display_name: 'Redes Informáticas', aliases: [],
    academy: 'Tecnología', offering_type: 'course',
    description: 'Formación canónica en redes.', value_proposition: null,
    price_type: 'fixed', price: { amount: '360', currency: 'USD' }, price_assertable: true,
    billing_interval: null, modality: 'online', schedules: [], certification: true,
    hours_per_month: 8, classes: 24, modules: 4, includes: [], syllabus_published: true,
    language: 'Spanish', min_age: null,
    policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
  }],
  qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
} satisfies BusinessContextView;

describe('canonical fact registry V1', () => {
  it('materializes only requested snapshot facts and keeps stable IDs', () => {
    const registry = buildCanonicalFactRegistry({ business_context: business, catalog_index: catalog });
    const result = materializeCanonicalFactRequests({
      requests: [
        { kind: 'course_options', area_code: 'tecnologia', limit: 1 },
        { kind: 'offering_duration', offering_code: 'redes-informaticas' },
        { kind: 'offering_modality', offering_code: 'redes-informaticas' },
      ],
      registry,
    });

    expect(result.facts.map((fact) => fact.id)).toEqual([
      'offering:redes-informaticas:name:v1',
      'offering:redes-informaticas:duration:v1',
      'offering:redes-informaticas:modality:v1',
    ]);
    expect(result.facts.map((fact) => fact.value)).toEqual([
      'Redes Informáticas', '24 clases', 'online',
    ]);
    expect(result.refs.every((ref) => !('value' in ref))).toBe(true);
  });

  it('keeps payment-link values private while exposing a value-free ref', () => {
    const registry = buildCanonicalFactRegistry({ business_context: business, catalog_index: catalog });
    const result = materializeCanonicalFactRequests({
      requests: [{
        kind: 'payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
      }],
      registry,
    });

    expect(result.facts).toEqual([expect.objectContaining({
      id: 'payment:redes-informaticas:monthly_12:link:v1',
      value: 'https://buy.stripe.com/test_canonical',
    })]);
    expect(result.refs).toEqual([{
      id: 'payment:redes-informaticas:monthly_12:link:v1',
      kind: 'payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
    }]);
    expect(JSON.stringify(result.refs)).not.toContain('stripe.com');
  });

  it('returns no fact for an unknown or mismatched canonical code', () => {
    const registry = buildCanonicalFactRegistry({ business_context: business, catalog_index: catalog });
    const result = materializeCanonicalFactRequests({
      requests: [{ kind: 'offering_name', offering_code: 'inventado' }], registry,
    });

    expect(result).toEqual({ facts: [], refs: [] });
  });
});
