import { loadBotpressManagedMessagingConfig } from '@/lib/config';
import { CentralCargaClient } from '@/features/fulfillment/central-carga/client';
import { loadCentralCargaConfig } from '@/features/fulfillment/central-carga/config';
import { runPostSalePipeline } from '@/features/fulfillment/post-sale/service';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import { CentralCargaConfigError } from '@/features/fulfillment/central-carga/config';

/**
 * Drains `fulfillment_jobs` into the Central de Carga
 * (docs/contracts/central-de-carga-enrollment.md). Off unless
 * CENTRAL_CARGA_ENABLED=true; when off it claims nothing.
 *
 * Same trigger and auth as the other crons: Vercel Cron injects
 * Authorization: Bearer <CRON_SECRET>; set CRON_SECRET locally for dev.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    if (request.nextUrl.searchParams.get('probe') === 'true') {
      const config = loadCentralCargaConfig();
      if (!config.enabled) return NextResponse.json({ enabled: false });
      const client = new CentralCargaClient(config);
      const result = await client.getEnrollment(randomUUID());
      const managed = loadBotpressManagedMessagingConfig();
      let botpressStatus: number | null = null;
      if (managed) {
        const response = await fetch(`${managed.apiUrl}/v1/chat/conversations`, {
          headers: { authorization: `Bearer ${managed.token}`, 'x-bot-id': managed.botId }, signal: AbortSignal.timeout(10000), redirect: 'manual',
        });
        botpressStatus = response.status;
      }
      return NextResponse.json({ enabled: true, environment: config.environment, central: result, botpress_status: botpressStatus, botpress_id: managed?.botId ?? null });
    }
    if (process.env.POST_SALE_ENABLED === 'true') return NextResponse.json(await runPostSalePipeline());
    const totals = await runEnrollmentWorker({
      worker_id: `central-carga-cron:${randomUUID()}`,
      limit: 10,
      lease_seconds: 120,
      deadline_ms: 50_000,
      scoped: true,
    });
    return NextResponse.json(totals, { status: 200 });
  } catch (error) {
    if (error instanceof CentralCargaConfigError) {
      return NextResponse.json({ error: 'CENTRAL_CARGA_MISCONFIGURED', fields: error.fields }, { status: 503 });
    }
    throw error;
  }
}
