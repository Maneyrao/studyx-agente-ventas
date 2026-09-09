import type postgres from 'postgres';
import { buildAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import type { sendOutboundMessage, SendOutboundMessageResult } from '@/features/messaging/application/send-outbound-message';
import { reservePayment, type ReservedPayment } from '@/features/payments/application/reserve-payment';
import { createCheckout, type CreateCheckoutResult } from '@/features/payments/application/create-checkout';
import type { PaymentProvider } from '@/features/payments/ports/payment-provider';
import type { RetellOrchestrationStore } from '../application/retell-tools';

export type RetellOutboundSender = (
  input: Parameters<typeof sendOutboundMessage>[0],
) => Promise<SendOutboundMessageResult>;

export interface PostgresRetellOrchestrationStoreOptions {
  readonly paymentProvider?: PaymentProvider;
  readonly sendOutbound?: RetellOutboundSender;
  readonly now?: () => Date;
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

  async createPaymentLink(input: Parameters<RetellOrchestrationStore['createPaymentLink']>[0]) {
    if (input.channel !== 'whatsapp') return { sent: false, reference: null, reason: 'CHANNEL_UNAVAILABLE' };
    if (!this.options.paymentProvider || !this.options.sendOutbound) {
      return { sent: false, reference: null, reason: 'PAYMENT_UNAVAILABLE' };
    }
    if (input.courses.length !== 1) return { sent: false, reference: null, reason: 'COURSE_UNAVAILABLE' };
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId);
    if (!workspace) return { sent: false, reference: null, reason: 'CONTACT_UNAVAILABLE' };
    const offerings = await this.db<Array<{ id: string; code: string }>>`
      SELECT o.id, o.code
      FROM offerings AS o
      WHERE o.workspace_id = ${workspace.id}::uuid
        AND o.code = ${input.courses[0]}
        AND o.status = 'active'
    `;
    const offering = offerings[0];
    if (!offering) return { sent: false, reference: null, reason: 'COURSE_UNAVAILABLE' };
    await this.db`
      UPDATE contacts AS c
      SET email = ${input.email}
      FROM workspace_contacts AS wc
      WHERE c.id = wc.contact_id
        AND wc.workspace_id = ${workspace.id}::uuid
        AND c.id = ${input.contactId}::uuid
    `;
    const planCode = input.plan === 'contado' ? 'one_time' : 'monthly_12';
    const idempotencyKey = `retell:payment:${input.callId}:${offering.id}:${planCode}`;
    let reserved: ReservedPayment;
    try {
      reserved = await reservePayment(this.db, {
        workspace_id: workspace.id,
        contact_id: input.contactId,
        offering_id: offering.id,
        idempotency_key: idempotencyKey,
      });
    } catch (error) {
      return { sent: false, reference: null, reason: error instanceof Error ? error.message.replace(/^Payment reservation rejected: /u, '') : 'PAYMENT_UNAVAILABLE' };
    }
    let checkout: CreateCheckoutResult;
    try {
      checkout = await createCheckout(this.db, { payment_id: reserved.payment_id }, {
        provider: this.options.paymentProvider,
        now: () => (this.options.now?.() ?? new Date()).getTime(),
      });
    } catch {
      return { sent: false, reference: reserved.payment_id, reason: 'CHECKOUT_UNAVAILABLE' };
    }
    if (!checkout.checkout_url) return { sent: false, reference: reserved.payment_id, reason: 'CHECKOUT_UNAVAILABLE' };
    const text = `Te comparto el link seguro para completar tu inscripción: ${checkout.checkout_url}`;
    const sent = await this.options.sendOutbound({
      workspaceId: workspace.id,
      contactId: input.contactId,
      text,
      authorizedEgress: buildAuthorizedEgress({ content: text, authorized_urls: [checkout.checkout_url], protected_facts: [] }),
      idempotencyKey: `retell:payment-send:${reserved.payment_id}`,
      preferredChannel: 'whatsapp',
      purpose: 'transactional',
    });
    return sent.outcome === 'sent'
      ? { sent: true, reference: reserved.payment_id }
      : { sent: false, reference: reserved.payment_id, reason: sent.reason ?? 'OUTBOUND_UNAVAILABLE' };
  }

  async verifyPayment(input: Parameters<RetellOrchestrationStore['verifyPayment']>[0]) {
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId);
    if (!workspace) return { state: 'not_found' };
    const rows = input.reference
      ? await this.db<Array<{ status: string }>>`
          SELECT p.status
          FROM payments AS p
          WHERE p.workspace_id = ${workspace.id}::uuid
            AND p.contact_id = ${input.contactId}::uuid
            AND (p.id::text = ${input.reference} OR p.provider_session_id = ${input.reference})
          ORDER BY p.created_at DESC LIMIT 1
        `
      : await this.db<Array<{ status: string }>>`
          SELECT p.status
          FROM payments AS p
          WHERE p.workspace_id = ${workspace.id}::uuid
            AND p.contact_id = ${input.contactId}::uuid
          ORDER BY p.created_at DESC LIMIT 1
        `;
    return { state: rows[0]?.status ?? 'not_found' };
  }

  async sendMaterial(input: Parameters<RetellOrchestrationStore['sendMaterial']>[0]) {
    if (!this.options.sendOutbound) return { sent: false, reference: null, reason: 'OUTBOUND_UNAVAILABLE' };
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId);
    if (!workspace) return { sent: false, reference: null, reason: 'CONTACT_UNAVAILABLE' };
    const rows = await this.db<Array<{ id: string; content: string }>>`
      SELECT ks.id, ks.content
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
    const sent = await this.options.sendOutbound({
      workspaceId: workspace.id,
      contactId: input.contactId,
      text: asset.content,
      authorizedEgress: buildAuthorizedEgress({ content: asset.content, authorized_urls: [], protected_facts: [] }),
      idempotencyKey: `retell:material:${input.callId}:${asset.id}`,
      preferredChannel: 'whatsapp',
      purpose: 'support',
    });
    return sent.outcome === 'sent'
      ? { sent: true, reference: sent.deliveryId }
      : { sent: false, reference: sent.deliveryId, reason: sent.reason ?? 'OUTBOUND_UNAVAILABLE' };
  }

  async requestHumanHandoff(input: Parameters<RetellOrchestrationStore['requestHumanHandoff']>[0]) {
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId);
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
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId);
    if (!workspace) throw new Error('CONTACT_UNAVAILABLE');
    const scheduledAt = resolveRetellFollowupTimestamp(input.whenText);
    const rows = await this.db<Array<{ id: string; scheduled_at: string | null; needs_resolution: boolean }>>`
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
      RETURNING id, scheduled_at, needs_resolution
    `;
    if (!rows[0]) throw new Error('FOLLOWUP_UNAVAILABLE');
    return {
      requestId: rows[0].id,
      scheduledAt: rows[0].scheduled_at,
      needsResolution: rows[0].needs_resolution,
    };
  }

  private async workspaceForContact(workspaceSlug: string, contactId: string) {
    const rows = await this.db<Array<{ id: string }>>`
      SELECT w.id
      FROM workspaces AS w
      JOIN workspace_contacts AS wc ON wc.workspace_id = w.id
      WHERE w.slug = ${workspaceSlug}
        AND w.status = 'active'
        AND wc.contact_id = ${contactId}::uuid
        AND wc.lifecycle_status = 'active'
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}

/** ISO timestamps with an explicit offset are deterministic; local/free text is not. */
export function resolveRetellFollowupTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
