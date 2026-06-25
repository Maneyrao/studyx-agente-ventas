import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { semanticSearch } from '@/lib/services/memory.service';

const schema = z.object({
  contact_id: z.string().uuid(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(10),
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

  if (!parsed.data.contact_id) {
    return NextResponse.json({ error: 'CONTACT_ID_REQUIRED' }, { status: 400 });
  }

  try {
    const { results, total } = await semanticSearch(parsed.data);
    return NextResponse.json({ results, total }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'contact_id is required') {
      return NextResponse.json({ error: 'CONTACT_ID_REQUIRED' }, { status: 400 });
    }
    console.error('POST /api/memory/search error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
