import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { processInboundMessage } from '@/lib/services/ingestion.service';
import { ContactValidationError } from '@/lib/services/contact.service';

const schema = z.object({
  phone: z.string().min(1),
  content: z.string().min(1).max(4096),
  channel: z.enum(['whatsapp', 'voice']).default('whatsapp'),
});

export async function POST(request: NextRequest) {
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

  try {
    const context = await processInboundMessage(parsed.data);
    return NextResponse.json(context, { status: 200 });
  } catch (err) {
    if (err instanceof ContactValidationError && err.code === 'INVALID_PHONE') {
      return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 });
    }
    console.error('POST /api/agent/ingest error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
