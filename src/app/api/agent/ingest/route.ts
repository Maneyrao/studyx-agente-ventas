import { after, NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  processInboundMessage,
  IdempotencyConflictError,
  ChannelIdentityConflictError,
  InboundEventUnavailableError,
  type InboundEnvelope,
} from '@/lib/services/ingestion.service';
import { ContactValidationError } from '@/lib/services/contact.service';
import { isRetryableTransactionError } from '@/lib/db/transaction';
import { timedStage } from '@/lib/observability/structured-log';
import { flushSheetProjectionsAfterMutation } from '@/lib/services/sheet-projection-trigger';
import { InboundEnvelopeSchema } from '@/lib/contracts/inbound-envelope';

const legacySchema = z.object({
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

  const parsed = InboundEnvelopeSchema.safeParse(body);
  const legacy = parsed.success ? null : legacySchema.safeParse(body);
  if (!parsed.success && !legacy?.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let envelope: InboundEnvelope;
  if (parsed.success) {
    if (!parsed.data.phone_e164) {
      return NextResponse.json({ error: 'IDENTITY_REQUIRED', field: 'phone_e164' }, { status: 422 });
    }
    envelope = parsed.data as InboundEnvelope;
  } else {
    const legacyData = legacy?.success ? legacy.data : null;
    if (!legacyData) {
      return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 428 });
    }
    if (legacyData.channel !== 'whatsapp') {
      return NextResponse.json({ error: 'LEGACY_VOICE_CONTRACT_UNSUPPORTED' }, { status: 422 });
    }
    envelope = {
      schema_version: 1,
      source: 'botpress',
      channel: 'whatsapp',
      integration_id: 'legacy-api',
      external_message_id: idempotencyKey,
      external_conversation_id: legacyData.phone,
      external_user_id: legacyData.phone,
      phone_e164: legacyData.phone,
      trace_id: z.string().uuid().safeParse(request.headers.get('x-trace-id')).data ?? randomUUID(),
      message: {
        type: 'text',
        text: legacyData.content,
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    };
  }

  try {
    const context = await timedStage('ingest.process', { trace_id: envelope.trace_id }, () =>
      processInboundMessage(envelope)
    );
    if (!context.replayed && !context.contact.blocked) {
      after(() => flushSheetProjectionsAfterMutation({
        traceId: envelope.trace_id,
        source: 'ingest',
      }));
    }
    return NextResponse.json(context, { status: 200 });
  } catch (err) {
    if (err instanceof ContactValidationError && err.code === 'INVALID_PHONE') {
      return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 });
    }
    if (err instanceof IdempotencyConflictError || err instanceof ChannelIdentityConflictError) {
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    if (err instanceof InboundEventUnavailableError) {
      return NextResponse.json(
        { error: err.code, retryable: err.retryable },
        { status: err.retryable ? 425 : 409 }
      );
    }
    // A serialization/deadlock failure that survived the in-process retries is
    // still transient: the write is idempotent, so the client may safely try
    // again. 503 keeps it inside the client's retryable status set; 500 would
    // read as a permanent fault and drop the turn.
    if (isRetryableTransactionError(err)) {
      console.error('POST /api/agent/ingest transient contention:', err);
      return NextResponse.json({ error: 'TRANSIENT_DB_CONTENTION' }, { status: 503 });
    }
    console.error('POST /api/agent/ingest error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
