import { NextRequest, NextResponse } from 'next/server';
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

// Kept inline for legacy request compatibility. The canonical schema — with
// audio_reference + metadata + sandbox_provider — lives at
// `src/lib/contracts/inbound-envelope.ts` and is what Phase 3+ will migrate to.
// This inline schema was extended to accept `sandbox_provider` so Telegram Bot A
// envelopes can pass through the current route without changing every downstream call site.
const envelopeSchema = z.object({
  schema_version: z.literal(1),
  source: z.literal('botpress'),
  channel: z.enum(['emulator', 'whatsapp']),
  integration_id: z.string().trim().min(1).max(512),
  external_message_id: z.string().trim().min(1).max(512),
  provider_message_id: z.string().trim().min(1).max(512).optional(),
  external_conversation_id: z.string().trim().min(1).max(512),
  external_user_id: z.string().trim().min(1).max(512),
  phone_e164: z.string().trim().min(8).max(16).optional(),
  trace_id: z.string().uuid(),
  message: z.object({
    type: z.enum(['text', 'audio', 'image', 'unsupported']),
    text: z.string().min(1).max(4096),
    occurred_at: z.string().datetime({ offset: true }),
    reply_to_external_message_id: z.string().trim().min(1).max(512).nullable().default(null),
    audio_reference: z.object({
      provider_file_id: z.string().trim().min(1).max(512),
      mime_type: z.string().trim().min(1).max(128),
      duration_seconds: z.number().int().nonnegative().nullable().default(null),
      transcription_status: z.enum(['ok', 'failed', 'skipped']),
      transcription_provider: z.string().trim().min(1).max(64).nullable().default(null),
    }).strict().nullable().default(null),
    metadata: z.record(
      z.string().max(64),
      z.union([z.string().max(512), z.number(), z.boolean()]),
    ).default({}),
  }),
  sandbox_provider: z.enum(['telegram_sandbox']).nullable().default(null),
});

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

  const parsed = envelopeSchema.safeParse(body);
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
    const context = await processInboundMessage(envelope);
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
    console.error('POST /api/agent/ingest error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
