import { z } from 'zod';
import {
  evaluateMemoryCandidate,
  type NormalizedMemory,
} from '@/features/orchestration/domain/memory-selection';

const VoiceMemoryCandidateInputSchema = z.object({
  type: z.string(),
  key: z.string(),
  value: z.string(),
  source_quote: z.string(),
  confidence: z.number(),
}).strict();

const VoiceMemoryEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  candidates: z.array(z.unknown()).max(10),
}).strict();

export type VoiceMemoryCandidate = Omit<NormalizedMemory, 'source_message_id'>;

/**
 * Retell exposes custom analysis fields as strings. Parse that provider shape
 * one candidate at a time so malformed or unsafe memory never rejects the
 * lifecycle event that carries the rest of the call result.
 */
export function parseVoiceMemoryCandidates(input: {
  readonly raw: string | null | undefined;
  readonly transcript: string | null | undefined;
  readonly contactId: string | null | undefined;
}): VoiceMemoryCandidate[] {
  if (!input.raw || !input.transcript || !input.contactId) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(input.raw) as unknown;
  } catch {
    return [];
  }
  const envelope = VoiceMemoryEnvelopeSchema.safeParse(decoded);
  if (!envelope.success) return [];

  return envelope.data.candidates.flatMap((rawCandidate) => {
    const candidate = VoiceMemoryCandidateInputSchema.safeParse(rawCandidate);
    if (!candidate.success) return [];
    const evaluated = evaluateMemoryCandidate(candidate.data, {
      contact_id: input.contactId!,
      batch_messages: [{ id: 'voice-transcript', content: input.transcript! }],
    });
    if (evaluated.status === 'rejected') return [];
    return [{
      type: evaluated.memory.type,
      key: evaluated.memory.key,
      value: evaluated.memory.value,
      source_quote: evaluated.memory.source_quote,
      confidence: evaluated.memory.confidence,
      dedupe_hash: evaluated.memory.dedupe_hash,
      ttl_days: evaluated.memory.ttl_days,
    }];
  });
}
