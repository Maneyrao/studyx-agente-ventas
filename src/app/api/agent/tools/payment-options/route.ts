import { NextResponse } from 'next/server';
import { getPaymentOptionsToolV1 } from '@/features/conversation/application/agent-tools-read';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { buildBusinessContextView } from '@/features/orchestration/domain/business-context';
import { loadBusinessWorkspaceConfig } from '@/lib/config';

function unavailable() {
  return {
    tool: 'get_payment_options',
    success: false,
    canonical_data: null,
    error_code: 'PAYMENT_OPTIONS_UNAVAILABLE',
    recoverable: true,
    idempotency_result: 'not_applicable' as const,
    preparation_id: null,
  };
}

export async function GET() {
  try {
    const { workspaceSlug } = loadBusinessWorkspaceConfig();
    const raw = await businessContextStore.loadBusinessContext(workspaceSlug);
    if (!raw) return NextResponse.json(unavailable());
    const plans = buildBusinessContextView(raw).workspace.payment_options;
    if (plans.length === 0) return NextResponse.json(unavailable());
    return NextResponse.json(await getPaymentOptionsToolV1({ plans }));
  } catch {
    return NextResponse.json(unavailable());
  }
}
