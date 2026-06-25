import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createConversation, ContactNotFoundError } from '@/lib/services/conversation.service';

const schema = z.object({
  contact_id: z.string().uuid(),
  channel: z.enum(['whatsapp', 'voice']),
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
    return NextResponse.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const conversation = await createConversation(parsed.data);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err) {
    if (err instanceof ContactNotFoundError) {
      return NextResponse.json({ error: err.code }, { status: 404 });
    }
    console.error('POST /api/conversations error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
