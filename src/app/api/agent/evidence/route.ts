import { NextRequest, NextResponse } from 'next/server';
import { withSerializableTransaction } from '@/lib/db/transaction';
import { recordTurnEvidence, TurnEvidenceInputSchema } from '@/lib/services/turn-evidence.service';
import { getPostgresError } from '@/lib/db/types';

/** API key + HMAC + replay/idempotency checks live in proxy.ts. */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }); }
  const parsed = TurnEvidenceInputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_TURN_EVIDENCE' }, { status: 400 });
  try {
    await withSerializableTransaction(db => recordTurnEvidence(db, parsed.data), { traceId: parsed.data.trace_id });
    return NextResponse.json({ recorded: true });
  } catch (error) {
    // Content-free diagnostics: never log drafts, credentials or SQL bindings.
    const code = getPostgresError(error)?.code;
    console.error(JSON.stringify({ event: 'turn.evidence.persistence_failed', trace_id: parsed.data.trace_id,
      subject_type: parsed.data.subject_type, subject_id: parsed.data.subject_id,
      sqlstate: code && /^[A-Z0-9]{5}$/u.test(code) ? code : null }));
    return NextResponse.json({ error: error instanceof Error && error.message === 'EVIDENCE_SUBJECT_NOT_AUTHORIZED'
      ? 'EVIDENCE_SUBJECT_NOT_AUTHORIZED' : 'TURN_EVIDENCE_UNAVAILABLE' }, { status: 503 });
  }
}
