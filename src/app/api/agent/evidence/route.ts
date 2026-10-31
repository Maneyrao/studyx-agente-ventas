import { NextRequest, NextResponse } from 'next/server';
import { withSerializableTransaction } from '@/lib/db/transaction';
import { recordTurnEvidence, TurnEvidenceInputSchema } from '@/lib/services/turn-evidence.service';

/** API key + HMAC + replay/idempotency checks live in proxy.ts. */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }); }
  const parsed = TurnEvidenceInputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_TURN_EVIDENCE' }, { status: 400 });
  try {
    await withSerializableTransaction(db => recordTurnEvidence(db, parsed.data));
    return NextResponse.json({ recorded: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === 'EVIDENCE_SUBJECT_NOT_AUTHORIZED'
      ? 'EVIDENCE_SUBJECT_NOT_AUTHORIZED' : 'TURN_EVIDENCE_UNAVAILABLE' }, { status: 503 });
  }
}
