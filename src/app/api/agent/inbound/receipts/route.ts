import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { persistedInboundReceipts } from '@/lib/services/inbound-receipts.service';

const schema = z.object({ trace_id: z.string().uuid(), integration_id: z.string().min(1).max(512),
  external_conversation_id: z.string().min(1).max(512), channel: z.enum(['emulator', 'whatsapp', 'telegram']),
  sandbox_provider: z.literal('telegram_sandbox').nullable().optional(),
  external_message_ids: z.array(z.string().min(1).max(512)).max(500) });
export async function POST(request: NextRequest) {
  const started = Date.now();
  console.info(JSON.stringify({ event: 'receipts.handler_entered', trace_id: request.headers.get('x-trace-id') }));
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  console.info(JSON.stringify({ event: 'receipts.query_started', trace_id: parsed.data.trace_id,
    requested_count: parsed.data.external_message_ids.length }));
  const persisted = await persistedInboundReceipts(parsed.data);
  console.info(JSON.stringify({ event: 'receipts.query_finished', trace_id: parsed.data.trace_id,
    duration_ms: Date.now() - started, persisted_count: persisted.length }));
  return NextResponse.json({ trace_id: parsed.data.trace_id, persisted_message_ids: persisted });
}
