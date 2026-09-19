import type postgres from 'postgres';
import {
  buildAuthorizedEgress,
  protectedFactsInContentV1,
  verifyAuthorizedEgress,
  type AuthorizedEgressV1,
  type ProtectedFactRef,
} from '@/features/orchestration/domain/egress-guard';
import { sanitizeRetrievedText } from '@/features/orchestration/domain/retrieved-context';
import {
  type PaymentOptionView,
  type PaymentPlanCode,
} from '@/features/orchestration/domain/business-context';
import type { sendOutboundMessage, SendOutboundMessageResult } from '@/features/messaging/application/send-outbound-message';
import {
  createConfigPaymentLinkResolver,
  type PaymentLinkResolver,
} from '@/features/payments/adapters/config-payment-link.resolver';
import { PAYMENT_PLAN_PRESENTATIONS } from '@/features/payments/domain/payment-link';
import type { RetellOrchestrationStore } from '../application/retell-tools';
import type { RetellPaymentPlanRequest } from '../application/retell-tools';

export type RetellOutboundSender = (
  input: Parameters<typeof sendOutboundMessage>[0],
) => Promise<SendOutboundMessageResult>;

export interface PostgresRetellOrchestrationStoreOptions {
  readonly paymentLinkResolver?: PaymentLinkResolver;
  readonly sendOutbound?: RetellOutboundSender;
}

/**
 * Canonical adapter for the five Retell side-effect tools. Retell only supplies
 * bounded intent; this class resolves workspace/contact/catalog/payment/assets
 * from PostgreSQL and delegates physical delivery to the existing outbox path.
 */
export class PostgresRetellOrchestrationStore implements RetellOrchestrationStore {
  constructor(
    private readonly db: postgres.Sql,
    private readonly options: PostgresRetellOrchestrationStoreOptions = {},
  ) {}

  async requestAgentAPaymentLink(input: Parameters<RetellOrchestrationStore['requestAgentAPaymentLink']>[0]) {
    if (!this.options.sendOutbound) return { sent: false, reference: null, reason: 'OUTBOUND_UNAVAILABLE' };
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace) return { sent: false, reference: null, reason: 'CONTACT_UNAVAILABLE' };
    if (workspace.conversation_id !== input.conversationId) {
      return { sent: false, reference: null, reason: 'CONVERSATION_MISMATCH' };
    }
    const paymentPlan = resolveRetellPaymentPlanRequest(
      input.paymentPlan,
      workspace.selected_payment_plan,
    );
    if (!paymentPlan.ok) {
      return { sent: false, reference: null, reason: paymentPlan.reason };
    }
    const offerings = await this.db<Array<{ code: string; display_name: string }>>`
      SELECT o.code, o.display_name
      FROM offerings AS o
      WHERE o.workspace_id = ${workspace.id}::uuid
        AND o.code = ${input.course}
        AND o.status = 'active'
    `;
    const offering = offerings[0];
    if (!offering) return { sent: false, reference: null, reason: 'COURSE_UNAVAILABLE' };
    const paymentLinkResolver = this.options.paymentLinkResolver ?? createConfigPaymentLinkResolver();
    const url = paymentLinkResolver.resolve(paymentPlan.planCode);
    if (!url) return { sent: false, reference: null, reason: 'PAYMENT_LINK_NOT_CONFIGURED' };
    const presentation = PAYMENT_PLAN_PRESENTATIONS[paymentPlan.planCode];
    const text = `Te dejo el link para inscribirte en ${offering.display_name} con la opción de ${presentation.label}: ${url}\n\nCuando completes el pago, avisame por acá.`;
    const sent = await this.options.sendOutbound({
      workspaceId: workspace.id,
      contactId: input.contactId,
      conversationId: input.conversationId,
      text,
      authorizedEgress: buildAuthorizedEgress({
        content: text,
        authorized_urls: [url],
        protected_facts: protectedFactsInContentV1(text),
      }),
      idempotencyKey: `agent-a:retell-payment-link:${input.callId}`,
      purpose: 'transactional',
    });
    if (sent.outcome !== 'sent') {
      return {
        sent: false,
        reference: sent.deliveryId,
        channel: sent.channel,
        reason: sent.reason ?? 'OUTBOUND_UNAVAILABLE',
      };
    }

    // The delivery key is call-scoped. If Retell replays the tool with a
    // different course/plan, sendOutbound returns the original delivery; do
    // not rewrite commercial state to describe a link that was never sent.
    if (sent.deliveryId) {
      const delivered = await this.db<Array<{ content: string }>>`
        SELECT message.content
        FROM outbound_deliveries AS delivery
        JOIN messages AS message ON message.id = delivery.message_id
        WHERE delivery.id = ${sent.deliveryId}::uuid
        LIMIT 1
      `;
      if (delivered[0] && delivered[0].content !== text) {
        return {
          sent: false,
          reference: sent.deliveryId,
          channel: sent.channel,
          reason: 'PAYMENT_LINK_ALREADY_SENT',
        };
      }
    }

    await this.recordPaymentLinkSelection({
      workspaceId: workspace.id,
      conversationId: input.conversationId,
      contactId: input.contactId,
      course: input.course,
      plan: paymentPlan.planCode,
    });
    return { sent: true, reference: sent.deliveryId, channel: sent.channel };
  }

  async verifyPayment(input: Parameters<RetellOrchestrationStore['verifyPayment']>[0]) {
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace) return { found: false as const, reason: 'PAYMENT_NOT_FOUND' };
    const rows = input.reference
      ? await this.db<Array<{ status: string }>>`
          SELECT p.status
          FROM payments AS p
          JOIN offerings AS o
            ON o.id = p.offering_id
           AND o.workspace_id = p.workspace_id
           AND o.code = ${workspace.course_code}
          WHERE p.workspace_id = ${workspace.id}::uuid
            AND p.contact_id = ${input.contactId}::uuid
            AND (p.id::text = ${input.reference} OR p.provider_session_id = ${input.reference})
          ORDER BY p.created_at DESC LIMIT 1
        `
      : await this.db<Array<{ status: string }>>`
          SELECT p.status
          FROM payments AS p
          JOIN offerings AS o
            ON o.id = p.offering_id
           AND o.workspace_id = p.workspace_id
           AND o.code = ${workspace.course_code}
          WHERE p.workspace_id = ${workspace.id}::uuid
            AND p.contact_id = ${input.contactId}::uuid
          ORDER BY p.created_at DESC LIMIT 1
        `;
    return rows[0]
      ? { found: true as const, state: rows[0].status }
      : { found: false as const, reason: 'PAYMENT_NOT_FOUND' };
  }

  async sendMaterial(input: Parameters<RetellOrchestrationStore['sendMaterial']>[0]) {
    if (!this.options.sendOutbound) return { sent: false, reference: null, reason: 'OUTBOUND_UNAVAILABLE' };
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace) return { sent: false, reference: null, reason: 'CONTACT_UNAVAILABLE' };
    if (workspace.conversation_id !== input.conversationId) {
      return { sent: false, reference: null, reason: 'CONVERSATION_MISMATCH' };
    }
    const rows = await this.db<Array<{ id: string; content: string; metadata: Record<string, unknown> }>>`
      SELECT ks.id, ks.content, ks.metadata
      FROM knowledge_sources AS ks
      WHERE ks.workspace_id = ${workspace.id}::uuid
        AND ks.status = 'active'
        AND ks.metadata ->> 'material_type' = ${input.type}
        AND (${input.course ?? null}::text IS NULL OR ks.metadata ->> 'course_code' = ${input.course ?? null})
      ORDER BY ks.updated_at DESC, ks.id
      LIMIT 1
    `;
    const asset = rows[0];
    if (!asset || asset.content.trim().length === 0) return { sent: false, reference: null, reason: 'MATERIAL_UNAVAILABLE' };
    const authorized = buildRetellMaterialAuthorization(asset.content, asset.metadata);
    if (!authorized) return { sent: false, reference: null, reason: 'MATERIAL_UNAVAILABLE' };
    const sent = await this.options.sendOutbound({
      workspaceId: workspace.id,
      contactId: input.contactId,
      conversationId: input.conversationId,
      text: authorized.content,
      authorizedEgress: authorized.manifest,
      idempotencyKey: `retell:material:${input.callId}:${asset.id}`,
      purpose: 'support',
    });
    return sent.outcome === 'sent'
      ? { sent: true, reference: sent.deliveryId, channel: sent.channel }
      : {
          sent: false,
          reference: sent.deliveryId,
          channel: sent.channel,
          reason: sent.reason ?? 'OUTBOUND_UNAVAILABLE',
        };
  }

  async requestHumanHandoff(input: Parameters<RetellOrchestrationStore['requestHumanHandoff']>[0]) {
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace) throw new Error('CONTACT_UNAVAILABLE');
    const rows = await this.db<Array<{ id: string; available: boolean | null }>>`
      INSERT INTO retell_handoff_requests (
        workspace_id, contact_id, call_id, reason, detail, urgency, available
      )
      SELECT ${workspace.id}::uuid, ${input.contactId}::uuid, ${input.callId}::uuid,
             ${input.reason}, ${input.detail}, ${input.urgency},
             CASE WHEN (w.metadata ->> 'human_available') IN ('true', 'false')
                  THEN (w.metadata ->> 'human_available')::boolean ELSE NULL END
      FROM workspaces AS w
      WHERE w.id = ${workspace.id}::uuid
      ON CONFLICT (workspace_id, contact_id, call_id)
      DO UPDATE SET updated_at = now()
      RETURNING id, available
    `;
    if (!rows[0]) throw new Error('HANDOFF_UNAVAILABLE');
    return { requestId: rows[0].id, available: rows[0].available };
  }

  async scheduleFollowup(input: Parameters<RetellOrchestrationStore['scheduleFollowup']>[0]) {
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace) throw new Error('CONTACT_UNAVAILABLE');
    const scheduledAt = resolveRetellFollowupTimestamp(input.whenText);
    const rows = await this.db<Array<{
      id: string;
      scheduled_at: string | null;
      needs_resolution: boolean;
      when_text: string;
      channel: 'llamada' | 'whatsapp';
      reason: string;
    }>>`
      INSERT INTO retell_followup_requests (
        workspace_id, contact_id, call_id, when_text, channel, reason,
        scheduled_at, needs_resolution
      ) VALUES (
        ${workspace.id}::uuid, ${input.contactId}::uuid, ${input.callId}::uuid,
        ${input.whenText}, ${input.channel}, ${input.reason},
        ${scheduledAt}::timestamptz, ${scheduledAt === null}
      )
      ON CONFLICT (workspace_id, contact_id, call_id)
      DO UPDATE SET updated_at = now()
      RETURNING id, scheduled_at, needs_resolution, when_text, channel, reason
    `;
    if (!rows[0]) throw new Error('FOLLOWUP_UNAVAILABLE');
    return {
      requestId: rows[0].id,
      scheduledAt: rows[0].scheduled_at,
      needsResolution: rows[0].needs_resolution,
      whenText: rows[0].when_text,
      channel: rows[0].channel,
      reason: rows[0].reason,
    };
  }

  private async workspaceForContact(workspaceSlug: string, contactId: string, callId: string) {
    const rows = await this.db<Array<{
      id: string;
      slug: string;
      metadata: Record<string, unknown> | null;
      conversation_id: string;
      course_code: string;
      selected_payment_plan: PaymentPlanCode | null;
    }>>`
      SELECT w.id, w.slug, w.metadata, cs.conversation_id,
             state.selected_payment_plan,
             COALESCE(
               NULLIF(btrim(state.selected_offering_code), ''),
               NULLIF(btrim(cs.context_snapshot ->> 'curso_interes'), ''),
               ''
             ) AS course_code
      FROM call_sessions AS cs
      JOIN workspaces AS w ON w.id = cs.workspace_id
      JOIN workspace_contacts AS wc
        ON wc.workspace_id = cs.workspace_id
       AND wc.contact_id = cs.contact_id
       AND wc.lifecycle_status = 'active'
      JOIN conversation_sales_context_states_v1 AS state
        ON state.workspace_id = cs.workspace_id
       AND state.conversation_id = cs.conversation_id
       AND state.contact_id = cs.contact_id
      WHERE cs.id = ${callId}::uuid
        AND cs.provider = 'retell'
        AND w.slug = ${workspaceSlug}
        AND w.status = 'active'
        AND cs.contact_id = ${contactId}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async recordPaymentLinkSelection(input: {
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly contactId: string;
    readonly course: string;
    readonly plan: PaymentPlanCode;
  }): Promise<void> {
    await this.db`
      WITH updated AS (
        UPDATE conversation_sales_context_states_v1 AS state
        SET selected_offering_code = ${input.course},
            selected_payment_plan = ${input.plan},
            stage = 'payment_link_sent',
            awaiting_reply = 'payment_confirmation',
            version = state.version + 1,
            updated_at = now()
        WHERE state.workspace_id = ${input.workspaceId}::uuid
          AND state.conversation_id = ${input.conversationId}::uuid
          AND state.contact_id = ${input.contactId}::uuid
          AND (
            state.selected_offering_code IS DISTINCT FROM ${input.course}
            OR state.selected_payment_plan IS DISTINCT FROM ${input.plan}
            OR state.stage IS DISTINCT FROM 'payment_link_sent'
            OR state.awaiting_reply IS DISTINCT FROM 'payment_confirmation'
          )
        RETURNING state.*
      )
      INSERT INTO conversation_sales_context_state_events_v1 (
        workspace_id, conversation_id, contact_id, state_version, source_turn_id,
        selected_offering_code, selected_payment_plan, stage,
        call_preference, call_offer_status, call_offer_count, awaiting_reply,
        payment_reported_at, human_review_requested_at, consecutive_technical_fallbacks
      )
      SELECT
        workspace_id, conversation_id, contact_id, version, NULL,
        selected_offering_code, selected_payment_plan, stage,
        call_preference, call_offer_status, call_offer_count, awaiting_reply,
        payment_reported_at, human_review_requested_at, consecutive_technical_fallbacks
      FROM updated
      ON CONFLICT DO NOTHING
    `;
  }
}

type RetellPaymentPlanRequestResolution =
  | { readonly ok: true; readonly planCode: PaymentPlanCode }
  | { readonly ok: false; readonly reason: 'PLAN_SELECTION_REQUIRED' };

export function resolveRetellPaymentPlanRequest(
  requested: RetellPaymentPlanRequest,
  durableSelection: PaymentPlanCode | null,
): RetellPaymentPlanRequestResolution {
  if (requested !== 'cuotas') return { ok: true, planCode: requested };
  return durableSelection === 'monthly_12' || durableSelection === 'monthly_6'
    ? { ok: true, planCode: durableSelection }
    : { ok: false, reason: 'PLAN_SELECTION_REQUIRED' };
}

/** ISO timestamps with an explicit offset are deterministic; local/free text is not. */
export function resolveRetellFollowupTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function retellPaymentPlanIsSupported(
  plan: 'contado' | 'cuotas',
  checkoutMode: 'payment' | 'subscription',
  billingInterval: string | null,
): boolean {
  return plan === 'contado'
    ? checkoutMode === 'payment' && billingInterval === 'one_time'
    : checkoutMode === 'subscription' && billingInterval === 'monthly';
}

type RetellPaymentPlanResolution =
  | { readonly ok: true; readonly planCode: PaymentPlanCode }
  | { readonly ok: false; readonly reason: 'PAYMENT_PLAN_UNAVAILABLE' | 'PLAN_SELECTION_REQUIRED' };

/**
 * Resolves Retell's coarse enum against the owner-approved canonical options.
 * A StudyX `custom` offering has no billing interval semantics to infer from;
 * its workspace metadata is the authority. For legacy offerings without that
 * metadata, retain the existing checkout-mode/interval compatibility.
 */
export function resolveRetellPaymentPlan(
  plan: 'contado' | 'cuotas',
  checkoutMode: 'payment' | 'subscription',
  billingInterval: string | null,
  configuredOptions: readonly Pick<PaymentOptionView, 'code'>[] = [],
): RetellPaymentPlanResolution {
  if (billingInterval === 'custom') {
    if (checkoutMode !== 'payment') return { ok: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' };
    if (plan === 'contado') {
      return configuredOptions.some((option) => option.code === 'one_time')
        ? { ok: true, planCode: 'one_time' }
        : { ok: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' };
    }
    return configuredOptions.some((option) => (
      option.code === 'monthly_12' || option.code === 'monthly_6'
    ))
      ? { ok: false, reason: 'PLAN_SELECTION_REQUIRED' }
      : { ok: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' };
  }

  if (!retellPaymentPlanIsSupported(plan, checkoutMode, billingInterval)) {
    return { ok: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' };
  }
  return plan === 'contado'
    ? { ok: true, planCode: 'one_time' }
    : { ok: false, reason: 'PLAN_SELECTION_REQUIRED' };
}

const MATERIAL_FACT_KINDS = new Set<ProtectedFactRef['kind']>([
  'price', 'duration', 'modality', 'certification', 'offering', 'promise',
]);

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || /\s/u.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Build an egress manifest from the exact approved canonical asset metadata. */
export function buildRetellMaterialAuthorization(
  rawContent: string,
  metadata: Record<string, unknown> | null | undefined,
): { readonly content: string; readonly manifest: AuthorizedEgressV1 } | null {
  const sanitized = sanitizeRetrievedText(rawContent, 4_096);
  if (sanitized.injection_suspected || sanitized.truncated || sanitized.text.length === 0) return null;
  const rawUrls = metadata?.authorized_urls;
  const authorizedUrls = Array.isArray(rawUrls) && rawUrls.every(isHttpUrl)
    ? rawUrls
    : rawUrls === undefined ? [] : null;
  if (authorizedUrls === null) return null;
  const rawFacts = metadata?.protected_facts;
  const protectedFacts = Array.isArray(rawFacts) && rawFacts.every((fact): fact is ProtectedFactRef => (
    typeof fact === 'object'
    && fact !== null
    && !Array.isArray(fact)
    && typeof (fact as { kind?: unknown }).kind === 'string'
    && MATERIAL_FACT_KINDS.has((fact as { kind: ProtectedFactRef['kind'] }).kind)
    && typeof (fact as { value?: unknown }).value === 'string'
    && (fact as { value: string }).value.trim().length > 0
  ))
    ? rawFacts
    : rawFacts === undefined ? [] : null;
  if (protectedFacts === null) return null;
  const manifest = buildAuthorizedEgress({
    content: sanitized.text,
    authorized_urls: authorizedUrls,
    protected_facts: protectedFacts,
  });
  return verifyAuthorizedEgress({ content: sanitized.text, manifest }).ok
    ? { content: sanitized.text, manifest }
    : null;
}
