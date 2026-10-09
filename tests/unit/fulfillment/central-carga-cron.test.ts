import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/central-carga-enrollment/route';
import { runPostSalePipeline } from '@/features/fulfillment/post-sale/service';

vi.mock('@/features/fulfillment/post-sale/service', () => ({ runPostSalePipeline: vi.fn(async () => ({ enabled: true })) }));
vi.mock('@/features/fulfillment/central-carga/worker', () => ({ runEnrollmentWorker: vi.fn() }));
const paymentId = '46595744-4993-48cd-87f0-026ec619272e';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const request = (query: string, authorized = true) => new NextRequest(`https://example.test/api/cron/central-carga-enrollment${query}`, {
  headers: authorized ? { authorization: 'Bearer synthetic-cron-secret' } : {},
});
describe('scoped central enrollment recovery', () => {
  it('retains authentication before any payment-specific processing', async () => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    expect((await GET(request(`?payment_id=${paymentId}`, false))).status).toBe(401);
    expect(runPostSalePipeline).not.toHaveBeenCalled();
  });
  it('rejects malformed payment IDs without processing jobs', async () => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    expect((await GET(request('?payment_id=not-a-uuid'))).status).toBe(400);
    expect(runPostSalePipeline).not.toHaveBeenCalled();
  });
  it('processes only the requested payment while preserving the default scheduled sweep', async () => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    vi.stubEnv('POST_SALE_ENABLED', 'true');
    expect((await GET(request(`?payment_id=${paymentId}`))).status).toBe(200);
    expect(runPostSalePipeline).toHaveBeenLastCalledWith(paymentId);
    expect((await GET(request(''))).status).toBe(200);
    expect(runPostSalePipeline).toHaveBeenLastCalledWith(undefined);
  });
});
