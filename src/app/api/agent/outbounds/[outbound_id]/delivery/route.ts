import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  recordDeliveryReport,
  DeliveryReportConflictError,
  OutboundNotFoundError,
} from '@/lib/services/decision.service';

const schema = z.object({
  outbound_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  status: z.enum(['submitted_to_botpress', 'failed']),
  botpress_message_id: z.string().trim().min(1).max(512).nullable().default(null),
  replayed: z.boolean().default(false),
  error_code: z.string().trim().min(1).max(128).nullable().default(null),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ outbound_id: string }> }
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { outbound_id } = await context.params;
  if (outbound_id !== parsed.data.outbound_id) {
    return NextResponse.json({ error: 'OUTBOUND_ID_MISMATCH' }, { status: 409 });
  }

  try {
    return NextResponse.json(await recordDeliveryReport(parsed.data), { status: 200 });
  } catch (error) {
    if (error instanceof OutboundNotFoundError) {
      return NextResponse.json({ error: error.code }, { status: 404 });
    }
    if (error instanceof DeliveryReportConflictError) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    console.error('POST /api/agent/outbounds/:outbound_id/delivery error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

