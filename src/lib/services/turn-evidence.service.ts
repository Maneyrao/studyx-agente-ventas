import { z } from 'zod';
import { jsonbParam } from '@/lib/db/json';
import type { DbClient } from '@/lib/db/types';
import { loadBusinessWorkspaceConfig } from '@/lib/config';

export const TurnEvidenceInputSchema = z.object({
  subject_type: z.enum(['turn', 'post_sale']), subject_id: z.string().uuid(),
  trace_id: z.string().uuid(), event_id: z.string().uuid(),
  kind: z.string().min(1).max(80).regex(/^[a-z_]+$/u),
  botpress_version: z.string().min(1).max(160),
  prompt_version: z.string().min(1).max(160), brain_version: z.string().min(1).max(160),
  data: z.record(z.string(), z.unknown()),
}).strict().refine(value => JSON.stringify(value).length <= 131072, 'EVIDENCE_TOO_LARGE');

export function backendReleaseSha(): string | null {
  const candidate = process.env.STUDYX_RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  return candidate && /^[a-f0-9]{40}$/u.test(candidate) ? candidate : null;
}

/** Authenticated append-only diagnostic data, never sales policy or application logs. */
export async function recordTurnEvidence(db: DbClient, raw: unknown): Promise<void> {
  const input = TurnEvidenceInputSchema.parse(raw);
  const slug = loadBusinessWorkspaceConfig().workspaceSlug;
  // Subject authorization, exact replay and the first server SHA share the
  // existing append-only audit boundary; no direct audit reads are permitted.
  await db`SELECT studyx_private.append_turn_evidence_atomic(
    ${slug}, ${jsonbParam(db, input)}, ${backendReleaseSha()})`;
}
