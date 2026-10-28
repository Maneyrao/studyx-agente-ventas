import type postgres from 'postgres';
import { acceptDirectCourseBonusByVoiceV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { loadCourseBonusFlowConfig } from '@/features/promotions/application/course-bonus-flow-config';
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
import {
  PaymentLinkReservationError,
  reservePaymentLink,
} from '@/features/payments/application/reserve-payment-link';
import type { RetellOrchestrationStore } from '../application/retell-tools';
import type { RetellPaymentPlanRequest } from '../application/retell-tools';
import { logger } from '@/lib/observability/structured-log';
import { splitFullName } from '@/lib/heuristics/contact-identity';
import {
  isCentralCargaBonusEnabledForContact,
  loadCentralCargaBonusConfig,
} from '@/features/fulfillment/central-carga/config';

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

  async readCourseBonusPromotion(
    input: Parameters<NonNullable<RetellOrchestrationStore['readCourseBonusPromotion']>>[0],
  ) {
    if (!isCentralCargaBonusEnabledForContact(
      loadCentralCargaBonusConfig(),
      input.contactId,
    )) return null;
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace || workspace.conversation_id !== input.conversationId) return null;
    // Direct packages belong to the original text cycle. Reading never seals,
    // exposes, appends or creates a replacement package.
    const [direct] = await this.db<Array<{
      id: string;
      promotion_code: string;
      promotion_cycle_id: string;
      offer_version: number;
      bonuses: Array<{ code: string; display_name: string }>;
    }>>`SELECT offer.id,promotion.promotion_code,offer.promotion_cycle_id,offer.offer_version,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('code',b.offering_code_snapshot,
          'display_name',b.offering_display_name_snapshot) ORDER BY b.position),'[]'::jsonb)
          FROM promotion_offer_bonus_offerings b WHERE b.offer_id=offer.id) AS bonuses
      FROM promotion_offers offer JOIN promotions promotion ON promotion.id=offer.promotion_id
      JOIN offerings paid ON paid.id=offer.paid_offering_id
      WHERE offer.workspace_id=${workspace.id}::uuid AND offer.contact_id=${input.contactId}::uuid
        AND offer.conversation_id=${input.conversationId}::uuid AND paid.code=${input.course}
        AND offer.package_mode='direct' AND offer.status IN ('offered','accepted','attached')
        AND (offer.status IN ('accepted','attached') OR (promotion.active=true AND paid.status='active'
          AND (promotion.valid_from IS NULL OR promotion.valid_from<=now())
          AND (promotion.valid_until IS NULL OR promotion.valid_until>now())
          AND (offer.expires_at IS NULL OR offer.expires_at>now())))
      ORDER BY offer.created_at DESC LIMIT 1`;
    if (direct) {
      const bonuses = direct.bonuses;
      if (bonuses.length < 1 || bonuses.length > 3 || bonuses.some((bonus) => [bonus.code, bonus.display_name].some((value) => {
        const safe = sanitizeRetrievedText(value, 128);
        return safe.injection_suspected || safe.truncated || safe.text !== value;
      }))) return null;
      return {
        promotionCode: direct.promotion_code,
        promotionCycleId: direct.promotion_cycle_id,
        offerVersion: direct.offer_version,
        bonusOfferings: bonuses.map((bonus) => ({ code: bonus.code, displayName: bonus.display_name })),
      };
    }
    if (loadCourseBonusFlowConfig().mode === 'direct') return null;
    const promotion = await this.db.begin(async (tx) => {
      await tx`
        UPDATE promotion_offers offer
        SET status = CASE
            WHEN offer.expires_at IS NOT NULL AND offer.expires_at <= now()
              THEN 'expired'
            ELSE 'cancelled'
          END,
          updated_at = now()
        FROM promotions promotion, offerings paid
        WHERE promotion.id = offer.promotion_id
          AND promotion.workspace_id = offer.workspace_id
          AND paid.id = offer.paid_offering_id
          AND paid.workspace_id = offer.workspace_id
          AND offer.workspace_id = ${workspace.id}::uuid
          AND offer.contact_id = ${input.contactId}::uuid
          AND offer.conversation_id = ${input.conversationId}::uuid
          AND paid.code = ${input.course}
          AND offer.status IN ('pending_review','offered','accepted')
          AND offer.payment_id IS NULL
          AND (
            (offer.expires_at IS NOT NULL AND offer.expires_at <= now())
            OR promotion.active = false
            OR (promotion.valid_from IS NOT NULL AND promotion.valid_from > now())
            OR (promotion.valid_until IS NOT NULL AND promotion.valid_until <= now())
          )
      `;
      const liveOffers = await tx<Array<{
        id: string;
        promotion_code: string;
        status: 'pending_review' | 'offered' | 'accepted';
        bonus_snapshot_sealed_at: Date | null;
        voice_exposed_at: Date | null;
      }>>`
        SELECT offer.id, promotion.promotion_code, offer.status,
          offer.bonus_snapshot_sealed_at, offer.voice_exposed_at
        FROM promotion_offers offer
        JOIN promotions promotion ON promotion.id = offer.promotion_id
          AND promotion.workspace_id = offer.workspace_id
        JOIN offerings paid ON paid.id = offer.paid_offering_id
          AND paid.workspace_id = offer.workspace_id
        WHERE offer.workspace_id = ${workspace.id}::uuid
          AND offer.contact_id = ${input.contactId}::uuid
          AND offer.conversation_id = ${input.conversationId}::uuid
          AND paid.code = ${input.course}
          AND paid.status = 'active'
          AND promotion.active = true
          AND (promotion.valid_from IS NULL OR promotion.valid_from <= now())
          AND (promotion.valid_until IS NULL OR promotion.valid_until > now())
          AND offer.status IN ('pending_review','offered','accepted')
          AND offer.payment_id IS NULL
          AND (offer.expires_at IS NULL OR offer.expires_at > now())
        ORDER BY
          CASE offer.status WHEN 'accepted' THEN 0 WHEN 'offered' THEN 1 ELSE 2 END,
          offer.created_at DESC
        LIMIT 1
        FOR UPDATE OF offer
      `;
      const liveOffer = liveOffers[0];
      if (liveOffer) {
        if (!liveOffer.bonus_snapshot_sealed_at) return null;
        if (liveOffer.status === 'pending_review' && !liveOffer.voice_exposed_at) return null;
        const bonuses = await tx<Array<{ code: string; display_name: string; position: number }>>`
          SELECT offering_code_snapshot AS code,
            offering_display_name_snapshot AS display_name, position
          FROM promotion_offer_bonus_offerings
          WHERE offer_id = ${liveOffer.id}::uuid
          ORDER BY position
        `;
        if (bonuses.length < 1 || bonuses.length > 3) return null;
        const safe = bonuses.every((bonus) => {
          const code = sanitizeRetrievedText(bonus.code, 128);
          const name = sanitizeRetrievedText(bonus.display_name, 128);
          return !code.injection_suspected && !code.truncated && code.text === bonus.code
            && !name.injection_suspected && !name.truncated && name.text === bonus.display_name;
        });
        if (!safe) return null;
        await tx`
          UPDATE promotion_offers SET voice_exposed_at = COALESCE(voice_exposed_at, now())
          WHERE id = ${liveOffer.id}::uuid AND bonus_snapshot_sealed_at IS NOT NULL
        `;
        return { promotion_code: liveOffer.promotion_code, bonus_offerings: bonuses };
      }
      const promotions = await tx<Array<{
        id: string;
        promotion_code: string;
        paid_offering_id: string;
      }>>`
        SELECT promotion.id, promotion.promotion_code, promotion.paid_offering_id
        FROM promotions promotion
        JOIN offerings paid ON paid.id = promotion.paid_offering_id
        WHERE promotion.workspace_id = ${workspace.id}::uuid
          AND paid.code = ${input.course}
          AND paid.status = 'active'
          AND promotion.active = true
          AND 'voice' = ANY(promotion.channels)
          AND (promotion.valid_from IS NULL OR promotion.valid_from <= now())
          AND (promotion.valid_until IS NULL OR promotion.valid_until > now())
          AND (SELECT count(*) FROM promotion_bonus_offerings item
            WHERE item.promotion_id = promotion.id) BETWEEN 1 AND 3
          AND (SELECT count(*) FROM promotion_offers used
            WHERE used.promotion_id = promotion.id
              AND used.contact_id = ${input.contactId}::uuid
              AND used.status = 'attached') < promotion.max_redemptions_per_contact
        ORDER BY promotion.created_at DESC
        LIMIT 1
        FOR UPDATE OF promotion
      `;
      const configured = promotions[0];
      if (!configured) return null;
      const offers = await tx<Array<{ id: string; bonus_snapshot_sealed_at: Date | null }>>`
        INSERT INTO promotion_offers (
          workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id,
          status, source_turn_id, source_conversation_version, source_state_version,
          expires_at
        ) VALUES (
          ${workspace.id}::uuid, ${input.contactId}::uuid, ${input.conversationId}::uuid,
          ${configured.id}::uuid, ${configured.paid_offering_id}::uuid, 'pending_review',
          ${workspace.source_turn_id}::uuid, ${workspace.source_conversation_version},
          ${workspace.state_version}, now() + interval '48 hours'
        )
        ON CONFLICT (conversation_id, promotion_id)
          WHERE status IN ('pending_review','offered','accepted')
        DO UPDATE SET updated_at = now()
        RETURNING id, bonus_snapshot_sealed_at
      `;
      const offer = offers[0];
      if (!offer) return null;
      if (!offer.bonus_snapshot_sealed_at) {
        await tx`
          INSERT INTO promotion_offer_bonus_offerings (
            offer_id, promotion_id, offering_id, promotion_code_snapshot,
            offering_code_snapshot, offering_display_name_snapshot, position
          )
          SELECT ${offer.id}::uuid, promotion.id, bonus.id, promotion.promotion_code,
            bonus.code, bonus.display_name, configured_bonus.position
          FROM promotions promotion
          JOIN promotion_bonus_offerings configured_bonus
            ON configured_bonus.promotion_id = promotion.id
          JOIN offerings bonus ON bonus.id = configured_bonus.offering_id
          WHERE promotion.id = ${configured.id}::uuid
          ORDER BY configured_bonus.position
          ON CONFLICT DO NOTHING
        `;
        await tx`
          UPDATE promotion_offers
          SET bonus_snapshot_sealed_at = now()
          WHERE id = ${offer.id}::uuid AND bonus_snapshot_sealed_at IS NULL
        `;
      }
      const bonuses = await tx<Array<{ code: string; display_name: string; position: number }>>`
        SELECT offering_code_snapshot AS code,
          offering_display_name_snapshot AS display_name, position
        FROM promotion_offer_bonus_offerings
        WHERE offer_id = ${offer.id}::uuid
        ORDER BY position
      `;
      if (bonuses.length < 1 || bonuses.length > 3) return null;
      const safe = bonuses.every((bonus) => {
        const code = sanitizeRetrievedText(bonus.code, 128);
        const name = sanitizeRetrievedText(bonus.display_name, 128);
        return !code.injection_suspected && !code.truncated && code.text === bonus.code
          && !name.injection_suspected && !name.truncated && name.text === bonus.display_name;
      });
      if (!safe) return null;
      await tx`
        UPDATE promotion_offers SET voice_exposed_at = COALESCE(voice_exposed_at, now())
        WHERE id = ${offer.id}::uuid AND bonus_snapshot_sealed_at IS NOT NULL
      `;
      return { promotion_code: configured.promotion_code, bonus_offerings: bonuses };
    });
    if (!promotion || promotion.bonus_offerings.length === 0) return null;
    return {
      promotionCode: promotion.promotion_code,
      bonusOfferings: promotion.bonus_offerings.map((bonus) => ({
        code: bonus.code,
        displayName: bonus.display_name,
      })),
    };
  }

  async recordConfirmedSelection(input: Parameters<RetellOrchestrationStore['recordConfirmedSelection']>[0]) {
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace) return { recorded: false, reason: 'CONTACT_UNAVAILABLE' };
    if (workspace.conversation_id !== input.conversationId) {
      return { recorded: false, reason: 'CONVERSATION_MISMATCH' };
    }
    if (
      input.paymentPlan !== undefined
      && !(['monthly_12', 'monthly_6', 'one_time'] as const).includes(input.paymentPlan as PaymentPlanCode)
    ) {
      return { recorded: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' };
    }
    if (input.course !== undefined) {
      const offerings = await this.db<Array<{ code: string }>>`
        SELECT code FROM offerings
        WHERE workspace_id = ${workspace.id}::uuid
          AND code = ${input.course}
          AND status = 'active'
        LIMIT 1
      `;
      if (!offerings[0]) return { recorded: false, reason: 'COURSE_UNAVAILABLE' };
    }
    const course = input.course ?? workspace.course_code;
    if (input.paymentPlan !== undefined && !course) {
      return { recorded: false, reason: 'COURSE_SELECTION_REQUIRED' };
    }
    const plan = input.paymentPlan as PaymentPlanCode | undefined;
    const changed = await this.db<Array<{ changed: boolean }>>`
      WITH updated AS (
        UPDATE conversation_sales_context_states_v1 AS state
        SET selected_offering_code = COALESCE(${course || null}::text, state.selected_offering_code),
            selected_payment_plan = COALESCE(${plan ?? null}::text, state.selected_payment_plan),
            stage = CASE
              WHEN state.stage IN ('payment_link_sent', 'handoff', 'closed') THEN state.stage
              WHEN ${plan ?? null}::text IS NOT NULL THEN 'plan_selected'
              WHEN ${input.course ?? null}::text IS NOT NULL THEN 'course_selected'
              ELSE state.stage
            END,
            version = state.version + 1,
            updated_at = now()
        WHERE state.workspace_id = ${workspace.id}::uuid
          AND state.conversation_id = ${input.conversationId}::uuid
          AND state.contact_id = ${input.contactId}::uuid
          AND (
            (${course || null}::text IS NOT NULL AND state.selected_offering_code IS DISTINCT FROM ${course || null}::text)
            OR (${plan ?? null}::text IS NOT NULL AND state.selected_payment_plan IS DISTINCT FROM ${plan ?? null}::text)
          )
        RETURNING state.*
      ), conversation_event AS (
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
      ), updated_sales AS (
        UPDATE sales_context_states AS state
        SET conversation_id = ${input.conversationId}::uuid,
            selected_offering_code = COALESCE(${course || null}::text, state.selected_offering_code),
            selected_payment_plan = COALESCE(${plan ?? null}::text, state.selected_payment_plan),
            stage = CASE
              WHEN state.stage IN ('payment_link_sent', 'handoff', 'closed') THEN state.stage
              WHEN ${plan ?? null}::text IS NOT NULL THEN 'plan_selected'
              WHEN ${input.course ?? null}::text IS NOT NULL THEN 'course_selected'
              ELSE state.stage
            END,
            version = state.version + 1,
            updated_at = now()
        WHERE state.workspace_id = ${workspace.id}::uuid
          AND state.contact_id = ${input.contactId}::uuid
          AND (
            state.conversation_id IS DISTINCT FROM ${input.conversationId}::uuid
            OR (${course || null}::text IS NOT NULL AND state.selected_offering_code IS DISTINCT FROM ${course || null}::text)
            OR (${plan ?? null}::text IS NOT NULL AND state.selected_payment_plan IS DISTINCT FROM ${plan ?? null}::text)
          )
        RETURNING state.*
      ), sales_event AS (
        INSERT INTO sales_context_state_events (
          workspace_id, contact_id, state_version, source_turn_id,
          selected_offering_code, selected_payment_plan, stage
        )
        SELECT
          workspace_id, contact_id, version, source_turn_id,
          selected_offering_code, selected_payment_plan, stage
        FROM updated_sales
        ON CONFLICT DO NOTHING
      )
      SELECT EXISTS(SELECT 1 FROM updated) AS changed
    `;
    return { recorded: changed[0]?.changed ?? false };
  }

  async requestAgentAPaymentLink(input: Parameters<RetellOrchestrationStore['requestAgentAPaymentLink']>[0]) {
    if (!this.options.sendOutbound) return { sent: false, reference: null, reason: 'OUTBOUND_UNAVAILABLE' };
    const workspace = await this.workspaceForContact(input.workspaceSlug, input.contactId, input.callId);
    if (!workspace) return { sent: false, reference: null, reason: 'CONTACT_UNAVAILABLE' };
    if (workspace.conversation_id !== input.conversationId) {
      return { sent: false, reference: null, reason: 'CONVERSATION_MISMATCH' };
    }
    const identity = workspace.contact_name ? splitFullName(workspace.contact_name) : null;
    if (!identity?.nombre.trim() || !identity.apellido.trim()) {
      return { sent: false, reference: null, reason: 'CONTACT_NAME_REQUIRED' };
    }
    if (!workspace.contact_email?.trim()) {
      return { sent: false, reference: null, reason: 'CONTACT_EMAIL_REQUIRED' };
    }
    const paymentPlan = resolveRetellPaymentPlanRequest(
      input.paymentPlan,
      workspace.selected_payment_plan,
    );
    if (!paymentPlan.ok) {
      return { sent: false, reference: null, reason: paymentPlan.reason };
    }
    const offerings = await this.db<Array<{ id: string; code: string; display_name: string }>>`
      SELECT o.id, o.code, o.display_name
      FROM offerings AS o
      WHERE o.workspace_id = ${workspace.id}::uuid
        AND o.code = ${input.course}
        AND o.status = 'active'
    `;
    const offering = offerings[0];
    if (!offering) return { sent: false, reference: null, reason: 'COURSE_UNAVAILABLE' };
    const paymentLinkResolver = this.options.paymentLinkResolver ?? createConfigPaymentLinkResolver();
    const configuredUrl = paymentLinkResolver.resolve(paymentPlan.planCode);
    if (!configuredUrl) return { sent: false, reference: null, reason: 'PAYMENT_LINK_NOT_CONFIGURED' };
    const hasDirectIdentity = input.promotionCycleId !== undefined
      || input.acceptedOfferVersion !== undefined || input.acceptPromotion !== undefined;
    if (hasDirectIdentity) {
      if (!input.promotionCode || !input.promotionCycleId || !input.acceptedOfferVersion || input.acceptPromotion !== true) {
        return { sent: false, reference: null, reason: 'PROMOTION_NOT_AUTHORIZED' };
      }
      const accepted = await acceptDirectCourseBonusByVoiceV1(this.db, {
        workspace_id: workspace.id,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        paid_offering_code: input.course,
        source_turn_id: workspace.source_turn_id,
        call_id: input.callId,
        promotion_code: input.promotionCode,
        promotion_cycle_id: input.promotionCycleId,
        expected_offer_version: input.acceptedOfferVersion,
      });
      if (!accepted.ok) return { sent: false, reference: null, reason: accepted.reason };
    }
    let payment: Awaited<ReturnType<typeof reservePaymentLink>>;
    const idempotencyKey = `retell-payment-link:${workspace.id}:${input.callId}`;
    try {
      payment = await reservePaymentLink(this.db, {
        workspace_id: workspace.id,
        contact_id: input.contactId,
        offering_id: offering.id,
        conversation_id: input.conversationId,
        plan_code: paymentPlan.planCode,
        idempotency_key: idempotencyKey,
        payment_link_url: configuredUrl,
        ...(input.promotionCode ? {
          promotion_code: input.promotionCode,
          promotion_channel: 'voice' as const,
          ...(hasDirectIdentity ? {
            promotion_cycle_id: input.promotionCycleId,
            accepted_offer_version: input.acceptedOfferVersion,
          } : {}),
        } : {}),
      });
    } catch (error) {
      if (error instanceof PaymentLinkReservationError) {
        return { sent: false, reference: null, reason: error.code };
      }
      throw error;
    }
    const url = payment.url;
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
    logger.info({
      event: 'retell.payment_link.outcome',
      call_id: input.callId,
      lead_id: input.contactId,
      conversation_id: input.conversationId,
      channel: sent.channel,
      delivery_id: sent.deliveryId,
      provider_message_id: sent.providerMessageId,
      outcome: sent.outcome,
      error_code: sent.reason,
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
      contact_name: string | null;
      contact_email: string | null;
      source_turn_id: string;
      source_conversation_version: number;
      state_version: number;
    }>>`
      SELECT w.id, w.slug, w.metadata, cs.conversation_id, cs.source_turn_id,
             source.conversation_seq AS source_conversation_version,
             state.version AS state_version,
             contact.name AS contact_name, contact.email AS contact_email,
             state.selected_payment_plan,
             COALESCE(
               NULLIF(btrim(state.selected_offering_code), ''),
               NULLIF(btrim(cs.context_snapshot ->> 'curso_interes'), ''),
               ''
             ) AS course_code
      FROM call_sessions AS cs
      JOIN workspaces AS w ON w.id = cs.workspace_id
      JOIN messages AS source ON source.id = cs.source_turn_id
      JOIN contacts AS contact ON contact.id = cs.contact_id AND contact.deleted_at IS NULL
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
      ), conversation_event AS (
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
        RETURNING 1
      ), updated_sales AS (
        UPDATE sales_context_states AS state
        SET conversation_id = ${input.conversationId}::uuid,
            selected_offering_code = ${input.course},
            selected_payment_plan = ${input.plan},
            stage = 'payment_link_sent',
            version = state.version + 1,
            updated_at = now()
        WHERE state.workspace_id = ${input.workspaceId}::uuid
          AND state.contact_id = ${input.contactId}::uuid
          AND (
            state.conversation_id IS DISTINCT FROM ${input.conversationId}::uuid
            OR state.selected_offering_code IS DISTINCT FROM ${input.course}
            OR state.selected_payment_plan IS DISTINCT FROM ${input.plan}
            OR state.stage IS DISTINCT FROM 'payment_link_sent'
          )
        RETURNING state.*
      )
      INSERT INTO sales_context_state_events (
        workspace_id, contact_id, state_version, source_turn_id,
        selected_offering_code, selected_payment_plan, stage
      )
      SELECT
        workspace_id, contact_id, version, source_turn_id,
        selected_offering_code, selected_payment_plan, stage
      FROM updated_sales
      ON CONFLICT DO NOTHING
    `;
  }
}

type RetellPaymentPlanRequestResolution =
  | { readonly ok: true; readonly planCode: PaymentPlanCode }
  | { readonly ok: false; readonly reason: 'PLAN_SELECTION_REQUIRED' | 'PLAN_SELECTION_CONFLICT' };

export function resolveRetellPaymentPlanRequest(
  requested: RetellPaymentPlanRequest,
  durableSelection: PaymentPlanCode | null,
): RetellPaymentPlanRequestResolution {
  if (requested !== 'cuotas') {
    if (durableSelection !== null && durableSelection !== requested) {
      return { ok: false, reason: 'PLAN_SELECTION_CONFLICT' };
    }
    return { ok: true, planCode: requested };
  }
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
