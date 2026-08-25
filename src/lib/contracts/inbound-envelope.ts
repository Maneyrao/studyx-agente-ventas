import { z } from 'zod';

export const SourceSchema = z.literal('botpress');
export const ChannelSchema = z.enum(['emulator', 'whatsapp', 'telegram']);
export const MessageTypeSchema = z.enum(['text', 'audio', 'image', 'unsupported']);

export const AudioReferenceSchema = z.object({
  provider_file_id: z.string().trim().min(1).max(512),
  mime_type: z.string().trim().min(1).max(128),
  duration_seconds: z.number().int().nonnegative().nullable().default(null),
  transcription_status: z.enum(['ok', 'failed', 'skipped']),
  transcription_provider: z.string().trim().min(1).max(64).nullable().default(null),
}).strict();

export const MessageMetadataSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(512), z.number(), z.boolean()])
);

export const InboundMessageSchema = z.object({
  type: MessageTypeSchema,
  text: z.string().min(1).max(4096),
  occurred_at: z.string().datetime({ offset: true }),
  reply_to_external_message_id: z.string().trim().min(1).max(512).nullable().default(null),
  audio_reference: AudioReferenceSchema.nullable().default(null),
  metadata: MessageMetadataSchema.default({}),
});

export const SandboxProviderSchema = z.enum(['telegram_sandbox']);

export const InboundEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  source: SourceSchema,
  channel: ChannelSchema,
  integration_id: z.string().trim().min(1).max(512),
  external_message_id: z.string().trim().min(1).max(512),
  provider_message_id: z.string().trim().min(1).max(512).optional(),
  external_conversation_id: z.string().trim().min(1).max(512),
  external_user_id: z.string().trim().min(1).max(512),
  phone_e164: z.string().trim().min(8).max(16).optional(),
  trace_id: z.string().uuid(),
  message: InboundMessageSchema,
  sandbox_provider: SandboxProviderSchema.nullable().default(null),
});

export type AudioReference = z.infer<typeof AudioReferenceSchema>;
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;
export type InboundMessage = z.infer<typeof InboundMessageSchema>;
export type InboundEnvelope = z.infer<typeof InboundEnvelopeSchema>;
