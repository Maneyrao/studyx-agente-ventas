import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateReadiness, type DependencyProbe } from '@/features/observability/domain/readiness';
import type { RawBusinessContext } from '@/features/orchestration/domain/business-context';
import type { BusinessContextStore } from '@/features/orchestration/ports/business-context-store';

type CommercialSnapshotProbe = (
  readWorkspace: () => { workspaceSlug: string },
  store: Pick<BusinessContextStore, 'loadBusinessContext'>,
) => Promise<DependencyProbe>;

let probeCommercialSnapshot: CommercialSnapshotProbe;

beforeAll(async () => {
  // `probes.ts` wires the production SQL adapter at module load. This test
  // injects the store, so this inert URL only lets that module load.
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  const probes = await import('@/features/observability/adapters/probes');
  probeCommercialSnapshot = (probes as unknown as {
    probeCommercialSnapshot: CommercialSnapshotProbe;
  }).probeCommercialSnapshot;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function snapshot(overrides: Partial<RawBusinessContext> = {}): RawBusinessContext {
  return {
    as_of: '2026-08-27T00:00:00.000Z',
    workspace: {
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'studyx',
      display_name: 'StudyX',
      environment: 'production',
      default_locale: 'es-AR',
      timezone: 'America/Argentina/Buenos_Aires',
      metadata: {},
    },
    offerings: [],
    offerings_total: 0,
    qualification_fields: [],
    ...overrides,
  };
}

function offering() {
  return {
    code: 'barista',
    display_name: 'Barista',
    offering_type: 'course' as const,
    description: 'Curso de barista.',
    value_proposition: null,
    price_type: 'fixed' as const,
    price_amount: '360.00',
    currency: 'USD',
    billing_interval: null,
    delivery: {},
    guardrails: {},
    audience: {},
    metadata: {},
  };
}

function canonicalPaymentMetadata() {
  return {
    payment_options: [
      {
        code: 'monthly_12', currency: 'USD', total_amount: '360.00', installments: 12,
        installment_amount: '30.00', payment_link: 'https://buy.stripe.com/test_monthly_12',
      },
      {
        code: 'monthly_6', currency: 'USD', total_amount: '360.00', installments: 6,
        installment_amount: '60.00', payment_link: 'https://buy.stripe.com/test_monthly_6',
      },
      {
        code: 'one_time', currency: 'USD', total_amount: '360.00', installments: 1,
        installment_amount: '360.00', payment_link: 'https://buy.stripe.com/test_one_time',
      },
    ],
  };
}

describe('probeCommercialSnapshot', () => {
  it('reports invalid workspace configuration without exposing the configured value', async () => {
    const probe = await probeCommercialSnapshot(
      () => { throw new Error('INVALID_BUSINESS_CONFIG:BUSINESS_WORKSPACE_SLUG'); },
      { loadBusinessContext: async () => snapshot() },
    );

    expect(probe).toMatchObject({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'workspace_configuration_invalid',
    });
  });

  it('makes readiness fail when the configured workspace cannot produce the claim catalog snapshot', async () => {
    const probe = await probeCommercialSnapshot(
      () => ({ workspaceSlug: 'missing-production-workspace' }),
      { loadBusinessContext: async () => null },
    );

    expect(probe).toMatchObject({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'workspace_not_found_or_inactive',
    });
    expect(evaluateReadiness([probe])).toMatchObject({
      ready: false,
      http_status: 503,
      failed_required: ['commercial_snapshot'],
    });
  });

  it('reports a snapshot query failure without returning database details', async () => {
    const probe = await probeCommercialSnapshot(
      () => ({ workspaceSlug: 'studyx' }),
      { loadBusinessContext: async () => { throw new Error('database credential must stay private'); } },
    );

    expect(probe).toMatchObject({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'catalog_snapshot_unavailable',
    });
    expect(JSON.stringify(probe)).not.toContain('database credential must stay private');
  });

  it('makes readiness fail when the configured workspace has no active catalog offerings', async () => {
    const probe = await probeCommercialSnapshot(
      () => ({ workspaceSlug: 'studyx' }),
      { loadBusinessContext: async () => snapshot() },
    );

    expect(probe).toMatchObject({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'catalog_empty',
    });
  });

  it('makes readiness fail when a bounded snapshot omits active offerings', async () => {
    const probe = await probeCommercialSnapshot(
      () => ({ workspaceSlug: 'studyx' }),
      { loadBusinessContext: async () => snapshot({ offerings: [offering()], offerings_total: 2 }) },
    );

    expect(probe).toMatchObject({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'catalog_truncated',
    });
  });

  it('makes readiness fail when the canonical payment options are unavailable', async () => {
    const probe = await probeCommercialSnapshot(
      () => ({ workspaceSlug: 'studyx' }),
      { loadBusinessContext: async () => snapshot({ offerings: [offering()], offerings_total: 1 }) },
    );

    expect(probe).toMatchObject({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'payment_options_unavailable',
    });
  });

  it('makes readiness fail when a catalog cannot assert any canonical price', async () => {
    const quoteOnly = { ...offering(), price_type: 'quote' as const, price_amount: null, currency: null };
    const probe = await probeCommercialSnapshot(
      () => ({ workspaceSlug: 'studyx' }),
      {
        loadBusinessContext: async () => snapshot({
          workspace: { ...snapshot().workspace, metadata: canonicalPaymentMetadata() },
          offerings: [quoteOnly],
          offerings_total: 1,
        }),
      },
    );

    expect(probe).toMatchObject({
      name: 'commercial_snapshot',
      required: true,
      status: 'down',
      detail: 'catalog_prices_not_assertable',
    });
  });
});
