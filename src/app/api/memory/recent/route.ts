import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRecentMessages } from '@/lib/services/memory.service';

const querySchema = z.object({
  conversation_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    conversation_id: searchParams.get('conversation_id'),
    limit: searchParams.get('limit'),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { messages, total } = await getRecentMessages(parsed.data);
    return NextResponse.json({ messages, total }, { status: 200 });
  } catch (err) {
    console.error('GET /api/memory/recent error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
