import { decidePostCallFollowup } from '../domain/post-call-followup';
import type { PostCallFollowupStore } from '../ports/post-call-followup-store';
import { buildPostCallNarrativeEgress } from '../domain/post-call-narrative-egress';
import type { ComposePostCallFollowup, PostCallNarrativeContext } from '../ports/post-call-followup-composer';
import type { SendOutboundMessageInput, SendOutboundMessageResult } from '@/features/messaging/application/send-outbound-message';
import { protectedFactsInContentV1, verifyAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import { CALL_START_TIMEOUT_SECONDS } from '../domain/call-timeouts';

/**
 * Spec 007 — el sweep que cierra el loop B→A: una llamada en estado terminal
 * sin seguimiento emitido produce, como máximo, un mensaje por el canal
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
  readonly call_id?: string;
  readonly limit?: number;
  readonly grace_seconds?: number;
  /** Soft row-start budget. A row already in progress finishes normally. */
  readonly max_processing_ms?: number;
  readonly now?: number;
}

export interface PostCallFollowupResult {
  readonly trace_id: string;
  readonly examined: number;
  /** Listed candidates left untouched when the processing budget expires. */
  readonly deferred: number;
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
  readonly composeFollowup: ComposePostCallFollowup;
  readonly sendOutbound: (input: SendOutboundMessageInput) => Promise<SendOutboundMessageResult>;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
  /** Monotonic elapsed time in production; injectable for deadline verification. */
  readonly now?: () => number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_GRACE_SECONDS = 120;

export async function runPostCallFollowup(
  input: PostCallFollowupInput,
  deps: PostCallFollowupDependencies
): Promise<PostCallFollowupResult> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => performance.now());
  const startedAt = now();
  const maxProcessingMs = input.max_processing_ms;
  if (maxProcessingMs !== undefined && (!Number.isFinite(maxProcessingMs) || maxProcessingMs < 0)) {
    throw new Error('POST_CALL_FOLLOWUP_INVALID_PROCESSING_BUDGET');
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  const graceSeconds = input.grace_seconds ?? DEFAULT_GRACE_SECONDS;

  await deps.store.expireStaleAcceptedCalls?.({
    timeout_seconds: CALL_START_TIMEOUT_SECONDS,
  });

  const pending = await deps.store.listPendingFollowups({
    limit,
    grace_seconds: graceSeconds,
    ...(input.call_id ? { call_id: input.call_id } : {}),
  });
  const findings: PostCallFollowupResult['findings'] = [];
  let examined = 0;
  let deferred = 0;
  let sent = 0;
  let revoked = 0;
  let skipped = 0;
  let failed = 0;

  for (const call of pending) {
    if (maxProcessingMs !== undefined && now() - startedAt >= maxProcessingMs) {
      // These candidates have no send, revocation or completion effect. They
      // remain eligible for the next worker rather than being counted examined.
      deferred = pending.length - examined;
      break;
    }
    examined += 1;
    try {
      // `pending` is intentionally a snapshot. A registrar_resultado or
      // webhook can commit DNC after listPendingFollowups returns, so the
      // adapter re-reads under the call lock immediately before this row can
      // enter any outbound path. When it finds DNC, the adapter also performs
      // the canonical revocation and completion marker in that same durable
      // operation; no provider call is made here.
      const revalidated = await deps.store.revalidateFollowup?.({
        call_id: call.call_id,
        trace_id: input.trace_id,
      });
      if (revalidated?.do_not_contact) {
        findings.push({ call_id: call.call_id, action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
        revoked += 1;
        continue;
      }

      // DNC is a contact/channel fact. Decide it before workspace resolution,
      // blocking checks, or payment lookup so a legacy NULL-tenant call still
      // revokes and can never enter an outbound branch.
      if (call.do_not_contact) {
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
        findings.push({ call_id: call.call_id, action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
        revoked += 1;
        continue;
      }

      // Un contacto ya bloqueado por cualquier otro motivo no recibe outbound
      // comercial — mismo guardrail que rige cualquier otro mensaje saliente.
      if (await deps.store.isContactBlocked(call.contact_id, call.channel)) {
        findings.push({ call_id: call.call_id, action: 'skip', reason: 'CONTACT_BLOCKED' });
        skipped += 1;
        continue;
      }

      if (!call.workspace_id) {
        findings.push({ call_id: call.call_id, action: 'skip', reason: 'WORKSPACE_UNRESOLVED' });
        skipped += 1;
        continue;
      }

      const paymentVerified = await deps.store.hasVerifiedPayment(
        call.contact_id,
        call.workspace_id,
        call.call_id,
        call.provider,
      );
      const verdict = decidePostCallFollowup({
        status: call.status,
        result: call.result,
        analysisStatus: call.analysis_status,
        paymentVerified,
        doNotContact: call.do_not_contact,
        endReason: call.disconnection_reason,
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

      // Agent A owns this message too. Persist the first authored draft before
      // any send so concurrent workers and delivery/marker recovery use one text.
      let content = await deps.store.readFollowupNarrative(call);
      let narrativeContext: PostCallNarrativeContext | undefined;
      if (content === null) {
        narrativeContext = await deps.store.loadNarrativeContext(call);
        const authored = await deps.composeFollowup({
          brief: verdict.brief,
          call: {
            call_id: call.call_id,
            status: call.status,
            result: call.result,
            analysis_status: call.analysis_status,
            disconnection_reason: call.disconnection_reason,
          },
          context: narrativeContext,
        });
        if (!authored.trim()) throw new Error('AGENT_A_FOLLOWUP_EMPTY_NARRATIVE');
        const authoredEgress = buildPostCallNarrativeEgress(authored, narrativeContext.selected_course);
        if (!verifyAuthorizedEgress({ content: authored, manifest: authoredEgress }).ok) throw new Error('AGENT_A_FOLLOWUP_UNSUPPORTED_NARRATIVE');
        content = await deps.store.commitFollowupNarrative(call, authored, narrativeContext.selected_course);
      }
      // Revalidate at the actual outbound boundary too. The first check
      // protects the snapshot, while this one closes the gap introduced by
      // blocked/payment/verdict reads before provider contact.
      const outboundRevalidated = await deps.store.revalidateFollowup?.({
        call_id: call.call_id,
        trace_id: input.trace_id,
      });
      if (outboundRevalidated?.do_not_contact) {
        findings.push({ call_id: call.call_id, action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
        revoked += 1;
        continue;
      }

      let course = narrativeContext?.selected_course ?? null;
      if (protectedFactsInContentV1(content).some((fact) => fact.kind === 'offering')) {
        course = await deps.store.readFollowupNarrativeCourse?.(call) ?? course;
        if (!course) course = (await deps.store.loadNarrativeContext(call)).selected_course;
      }
      const authorizedEgress = buildPostCallNarrativeEgress(content, course);
      if (!verifyAuthorizedEgress({ content, manifest: authorizedEgress }).ok) throw new Error('AGENT_A_FOLLOWUP_UNSUPPORTED_NARRATIVE');
      const delivery = await deps.sendOutbound({
        workspaceId: call.workspace_id,
        contactId: call.contact_id,
        conversationId: call.conversation_id,
        text: content,
        authorizedEgress,
        idempotencyKey: `post-call:${call.call_id}`,
        preferredChannel: call.channel,
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
        followup: verdict.brief,
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
    examined,
    deferred,
    sent,
    revoked,
    skipped,
    failed,
    findings,
  };

  log('calls.post_call_followup.completed', {
    trace_id: input.trace_id,
    examined,
    deferred,
    sent,
    revoked,
    skipped,
    failed,
  });

  return result;
}
