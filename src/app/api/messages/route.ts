import { NextRequest, NextResponse } from 'next/server';
import { registerMessage, registerMessageSchema } from '@/lib/services/message.service';
import { ConversationNotFoundError } from '@/lib/services/conversation.service';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = registerMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { message, embedding_status } = await registerMessage(parsed.data);
    return NextResponse.json({ message, embedding_status }, { status: 201 });
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return NextResponse.json({ error: err.code }, { status: 404 });
    }
    console.error('POST /api/messages error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
