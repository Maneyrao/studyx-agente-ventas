import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { registerAgentReply, TurnNotFoundError, TurnAlreadyAnsweredError } from '@/lib/services/ingestion.service';

const schema = z.object({
  turn_id: z.string().uuid(),
  content: z.string().min(1).max(4096),
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
    const result = await registerAgentReply(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof TurnNotFoundError) {
      return NextResponse.json({ error: err.code }, { status: 404 });
    }
    if (err instanceof TurnAlreadyAnsweredError) {
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    console.error('POST /api/agent/reply error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
