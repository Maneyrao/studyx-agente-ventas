import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateConversation, ConversationNotFoundError } from '@/lib/services/conversation.service';

const schema = z.object({
  status: z.enum(['open', 'closed', 'transferred']).optional(),
  current_intent: z.string().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    const conversation = await updateConversation(id, parsed.data);
    return NextResponse.json({ conversation }, { status: 200 });
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return NextResponse.json({ error: err.code }, { status: 404 });
    }
    console.error('PATCH /api/conversations/[id] error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
