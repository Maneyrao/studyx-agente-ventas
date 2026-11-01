import { z } from 'zod';
import { auditLog } from '@/lib/audit/logger';
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
  const rows = input.subject_type === 'turn'
    ? await db`SELECT m.id FROM messages m
        JOIN workspace_contacts wc ON wc.contact_id=m.contact_id
        JOIN workspaces w ON w.id=wc.workspace_id
        WHERE m.id=${input.subject_id}::uuid AND m.direction='inbound' AND w.slug=${slug} LIMIT 1`
    : await db`SELECT n.id FROM post_sale_notifications n JOIN payments p ON p.id=n.payment_id
        JOIN workspaces w ON w.id=p.workspace_id
        WHERE n.id=${input.subject_id}::uuid AND w.slug=${slug} LIMIT 1`;
  if (!rows.length) throw new Error('EVIDENCE_SUBJECT_NOT_AUTHORIZED');
  // Keep the first server identity on a retry, even across backend releases.
  const key = `turn-evidence:${input.subject_type}:${input.subject_id}:${input.event_id}`;
  const [existing] = await db<Array<{ payload: { observation: unknown; backend_sha: string | null } }>>`
    SELECT payload FROM audit_log WHERE event_key=${key} LIMIT 1`;
  await auditLog({
    action: 'agent.turn.evidence', entity_type: input.subject_type === 'turn' ? 'message' : 'post_sale_notification',
    entity_id: input.subject_id, event_key: key, correlation_id: input.trace_id,
    payload: { observation: input, backend_sha: existing ? existing.payload.backend_sha : backendReleaseSha() },
  }, db);
}
