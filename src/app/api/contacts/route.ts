import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveContact, ContactValidationError } from '@/lib/services/contact.service';

const schema = z.object({
  phone: z.string(),
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
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const { contact, created } = await resolveContact(parsed.data);
    return NextResponse.json({ contact, created }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err instanceof ContactValidationError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('POST /api/contacts error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
