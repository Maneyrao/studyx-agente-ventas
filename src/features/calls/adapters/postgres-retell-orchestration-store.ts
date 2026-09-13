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
    if (workspace.course_code !== input.course) {
      return { sent: false, reference: null, reason: 'COURSE_UNAVAILABLE' };
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
    const url = paymentLinkResolver.resolve(input.planCode);
    if (!url) return { sent: false, reference: null, reason: 'PAYMENT_LINK_NOT_CONFIGURED' };
    const presentation = PAYMENT_PLAN_PRESENTATIONS[input.planCode];
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
      idempotencyKey: `agent-a:retell-payment-link:${input.callId}:${input.planCode}`,
      preferredChannel: 'whatsapp',
      purpose: 'transactional',
    });
    return sent.outcome === 'sent'
      ? { sent: true, reference: sent.deliveryId }
      : { sent: false, reference: sent.deliveryId, reason: sent.reason ?? 'OUTBOUND_UNAVAILABLE' };
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
      text: authorized.content,
      authorizedEgress: authorized.manifest,
      idempotencyKey: `retell:material:${input.callId}:${asset.id}`,
      preferredChannel: 'whatsapp',
      purpose: 'support',
    });
    return sent.outcome === 'sent'
      ? { sent: true, reference: sent.deliveryId }
      : { sent: false, reference: sent.deliveryId, reason: sent.reason ?? 'OUTBOUND_UNAVAILABLE' };
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
    }>>`
      SELECT w.id, w.slug, w.metadata, cs.conversation_id,
             COALESCE(NULLIF(btrim(cs.context_snapshot ->> 'curso_interes'), ''), '') AS course_code
      FROM call_sessions AS cs
      JOIN workspaces AS w ON w.id = cs.workspace_id
      JOIN workspace_contacts AS wc
        ON wc.workspace_id = cs.workspace_id
       AND wc.contact_id = cs.contact_id
       AND wc.lifecycle_status = 'active'
      WHERE cs.id = ${callId}::uuid
        AND cs.provider = 'retell'
        AND w.slug = ${workspaceSlug}
        AND w.status = 'active'
        AND cs.contact_id = ${contactId}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
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
  | { readonly ok: false; readonly reason: 'PAYMENT_PLAN_UNAVAILABLE' | 'PAYMENT_PLAN_CHOICE_REQUIRED' };

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
    const installmentOptions = configuredOptions.filter((option) => (
      option.code === 'monthly_12' || option.code === 'monthly_6'
    ));
    if (installmentOptions.length === 1) return { ok: true, planCode: installmentOptions[0].code };
    if (installmentOptions.length > 1) return { ok: false, reason: 'PAYMENT_PLAN_CHOICE_REQUIRED' };
    return { ok: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' };
  }

  if (!retellPaymentPlanIsSupported(plan, checkoutMode, billingInterval)) {
    return { ok: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' };
  }
  return { ok: true, planCode: plan === 'contado' ? 'one_time' : 'monthly_12' };
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
