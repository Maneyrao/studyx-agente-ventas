import { decidePostCallFollowup } from '../domain/post-call-followup';
import type { PostCallFollowupStore } from '../ports/post-call-followup-store';
import type { SendOutboundMessageInput, SendOutboundMessageResult } from '@/features/messaging/application/send-outbound-message';
import { buildAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';

/**
 * Spec 007 — el sweep que cierra el loop B→A: una llamada en estado terminal
 * sin seguimiento emitido produce, como máximo, un mensaje de WhatsApp
 * iniciado por el sistema, o una revocación de contacto, nunca ambos y nunca
 * ninguno más de una vez.
 *
 * Deliberadamente dull, igual que reconcile-orchestration: nunca resuelve una
 * ambigüedad actuando. Si el turno no se puede sintetizar (contacto sin
 * thread de WhatsApp resuelto), la fila queda para la próxima corrida y se
 * cuenta como fallo, no se reintenta en el momento.
 */

export interface PostCallFollowupInput {
  readonly trace_id: string;
  readonly limit?: number;
  readonly grace_seconds?: number;
  readonly now?: number;
}

export interface PostCallFollowupResult {
  readonly trace_id: string;
  readonly examined: number;
  readonly sent: number;
  readonly revoked: number;
  readonly skipped: number;
  readonly failed: number;
  readonly findings: Array<{
    readonly call_id: string;
    readonly action: 'send' | 'revoke_contact' | 'skip' | 'error';
    readonly reason: string;
  }>;
}

export interface PostCallFollowupDependencies {
  readonly store: PostCallFollowupStore;
  readonly sendOutbound: (input: SendOutboundMessageInput) => Promise<SendOutboundMessageResult>;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_GRACE_SECONDS = 120;

export async function runPostCallFollowup(
  input: PostCallFollowupInput,
  deps: PostCallFollowupDependencies
): Promise<PostCallFollowupResult> {
  const log = deps.log ?? (() => {});
  const limit = input.limit ?? DEFAULT_LIMIT;
  const graceSeconds = input.grace_seconds ?? DEFAULT_GRACE_SECONDS;

  const pending = await deps.store.listPendingFollowups({ limit, grace_seconds: graceSeconds });
  const findings: PostCallFollowupResult['findings'] = [];
  let sent = 0;
  let revoked = 0;
  let skipped = 0;
  let failed = 0;

  for (const call of pending) {
    try {
      // Un contacto ya bloqueado por cualquier otro motivo no recibe outbound
      // comercial — mismo guardrail que rige cualquier otro mensaje saliente.
      if (await deps.store.isContactBlocked(call.contact_id)) {
        findings.push({ call_id: call.call_id, action: 'skip', reason: 'CONTACT_BLOCKED' });
        skipped += 1;
        continue;
      }

      const paymentVerified = await deps.store.hasVerifiedPayment(call.contact_id, call.workspace_id);
      const verdict = decidePostCallFollowup({
        status: call.status,
        result: call.result,
        analysisStatus: call.analysis_status,
        paymentVerified,
        doNotContact: call.do_not_contact,
      });

      if (verdict.action === 'skip') {
        findings.push({ call_id: call.call_id, action: 'skip', reason: verdict.reason });
        skipped += 1;
        continue;
      }

      if (verdict.action === 'revoke_contact') {
        // Revoke first, then persist the system-call-result marker. If the
        // process crashes between them, the next sweep repeats the idempotent
        // permission event instead of hiding an incomplete revocation.
        await deps.store.revokeContact({
          contact_id: call.contact_id,
          call_id: call.call_id,
          trace_id: input.trace_id,
        });
        await deps.store.markFollowupCompleted({
          call_id: call.call_id,
          contact_id: call.contact_id,
          conversation_id: call.conversation_id,
          trace_id: input.trace_id,
        });
        findings.push({ call_id: call.call_id, action: 'revoke_contact', reason: verdict.reason });
        revoked += 1;
        continue;
      }

      // verdict.action === 'send'
      const delivery = await deps.sendOutbound({
        workspaceId: call.workspace_id,
        contactId: call.contact_id,
        text: verdict.content,
        authorizedEgress: buildAuthorizedEgress({
          content: verdict.content,
          authorized_urls: [],
          protected_facts: [],
        }),
        idempotencyKey: `post-call:${call.call_id}`,
        preferredChannel: 'whatsapp',
        purpose: 'conversational',
      });

      if (delivery.outcome !== 'sent') {
        failed += 1;
        findings.push({
          call_id: call.call_id,
          action: 'error',
          reason: delivery.reason ?? `OUTBOUND_${delivery.outcome.toUpperCase()}`,
        });
        continue;
      }

      await deps.store.markFollowupCompleted({
        call_id: call.call_id,
        contact_id: call.contact_id,
        conversation_id: call.conversation_id,
        trace_id: input.trace_id,
      });

      findings.push({
        call_id: call.call_id,
        action: 'send',
        reason: verdict.reason,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      findings.push({ call_id: call.call_id, action: 'error', reason: String(error) });
      log('calls.post_call_followup.failed', {
        trace_id: input.trace_id,
        call_id: call.call_id,
        error: String(error),
      });
    }
  }

  const result: PostCallFollowupResult = {
    trace_id: input.trace_id,
    examined: pending.length,
    sent,
    revoked,
    skipped,
    failed,
    findings,
  };

  log('calls.post_call_followup.completed', {
    trace_id: input.trace_id,
    examined: pending.length,
    sent,
    revoked,
    skipped,
    failed,
  });

  return result;
}
