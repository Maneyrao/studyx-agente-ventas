import { describe, expect, it } from 'vitest';
import {
  getCourseInformationToolV1,
  getPaymentOptionsToolV1,
  searchCatalogToolV1,
} from '@/features/conversation/application/agent-tools-read';
import type {
  RawBusinessContext,
  RawCatalogIndex,
} from '@/features/orchestration/domain/business-context';

const rawContext: RawBusinessContext = {
  as_of: '2026-09-05T00:00:00.000Z',
  workspace: {
    id: 'workspace-1',
    slug: 'studyx',
    display_name: 'StudyX',
    environment: 'production',
    default_locale: 'es-AR',
    timezone: 'America/Argentina/Buenos_Aires',
    metadata: { beca_price_usd: 699 },
  },
  offerings: [{
    code: 'dip-mkt',
    display_name: 'Diplomado en Marketing',
    offering_type: 'course',
    description: 'Ideal para arrancar.',
    value_proposition: null,
    price_type: 'fixed',
    price_amount: '1200.00',
    currency: 'USD',
    billing_interval: null,
    delivery: { classes: 38, modality: '100% online' },
    guardrails: {},
    audience: {},
    metadata: { academy: 'Negocios', beca_price_usd: 699 },
  }],
  offerings_total: 1,
  qualification_fields: [],
};

const rawIndex: RawCatalogIndex = {
  as_of: rawContext.as_of,
  offerings_total: 1,
  offerings: [{
    code: 'dip-mkt',
    display_name: 'Diplomado en Marketing',
    metadata: { academy: 'Negocios', beca_price_usd: 699 },
  }],
};

function store() {
  return {
    loadCompleteIndex: async () => rawIndex,
    loadBusinessContext: async () => rawContext,
    loadByCode: async (_slug: string, code: string) => code === 'dip-mkt' ? rawContext : null,
  };
}

describe('agent read tools', () => {
  it('returns a compact canonical catalog without metadata', async () => {
    const result = await searchCatalogToolV1({ store: store(), workspaceSlug: 'studyx' });

    expect(result).toEqual({
      tool: 'search_catalog',
      success: true,
      canonical_data: {
        offerings: [{
          code: 'dip-mkt',
          display_name: 'Diplomado en Marketing',
          academy: 'Negocios',
        }],
        areas: ['Negocios'],
        prices_assertable: true,
      },
      error_code: null,
      recoverable: false,
      idempotency_result: 'not_applicable',
      preparation_id: null,
    });
    expect(JSON.stringify(result)).not.toContain('beca_price_usd');
  });

  it('returns a recoverable course-not-found result', async () => {
    const result = await getCourseInformationToolV1(
      { store: store(), workspaceSlug: 'studyx' },
      { code: 'nope' },
    );
    expect(result).toMatchObject({
      tool: 'get_course_information',
      success: false,
      canonical_data: null,
      error_code: 'COURSE_NOT_FOUND',
      recoverable: true,
    });
  });

  it('returns sanitized course facts and never leaks the beca amount', async () => {
    const result = await getCourseInformationToolV1(
      { store: store(), workspaceSlug: 'studyx' },
      { code: 'dip-mkt' },
    );
    expect(result).toMatchObject({
      success: true,
      canonical_data: {
        code: 'dip-mkt',
        display_name: 'Diplomado en Marketing',
        academy: 'Negocios',
        delivery: { classes: 38, modality: '100% online' },
        price: { amount: '1200.00', currency: 'USD' },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/\b699\b|beca_price_usd/u);
  });

  it('turns a store exception into a recoverable tool result', async () => {
    const unavailable = {
      ...store(),
      loadCompleteIndex: async (): Promise<RawCatalogIndex | null> => {
        throw new Error('database details');
      },
    };
    const result = await searchCatalogToolV1({ store: unavailable, workspaceSlug: 'studyx' });
    expect(result).toMatchObject({
      success: false,
      canonical_data: null,
      error_code: 'CATALOG_UNAVAILABLE',
      recoverable: true,
    });
    expect(JSON.stringify(result)).not.toContain('database details');
  });

  it('projects payment options with stable fact ids and no links', async () => {
    const result = await getPaymentOptionsToolV1({
      plans: [
        { code: 'monthly_12', label: '12 pagos mensuales de USD 30' },
        { code: 'one_time', label: 'Pago único de USD 360' },
      ],
    });
    expect(result.canonical_data?.plans).toEqual([
      {
        code: 'monthly_12',
        label: '12 pagos mensuales de USD 30',
        fact_id: 'fact:payment_plan:monthly_12',
      },
      {
        code: 'one_time',
        label: 'Pago único de USD 360',
        fact_id: 'fact:payment_plan:one_time',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('https://');
  });
});
