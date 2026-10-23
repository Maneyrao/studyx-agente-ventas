import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import type { DbClient } from '@/lib/db/types';
import type { ManagedOutboundSender } from '@/features/messaging/adapters/managed-outbound';
import {
  buildAuthorizedEgress,
  protectedFactsInContentV1,
  verifyAuthorizedEgress,
} from '@/features/orchestration/domain/egress-guard';

async function defaultDatabase(): Promise<postgres.Sql> {
  const database = await import('@/lib/db/orchestrator');
  return database.sql;
}

export const CommercialFollowupNarrativeSchema = z.object({
  message: z.string().trim().min(1).max(900),
}).strict();

type FollowupKind = 'price_objection_checkin' | 'promotion_review';
type PromotionAction =
  | { readonly type: 'schedule_price_objection_checkin'; readonly reason: 'price_objection' }
  | { readonly type: 'request_promotion_review'; readonly reason: 'persistent_price_objection' }
  | { readonly type: 'accept_promotion' };

export interface ScheduledCommercialFollowupV1 {
  readonly id: string;
  readonly kind: FollowupKind;
  readonly due_at: string;
}

export interface CommitCommercialActionResultV1 {
  readonly offer_id: string | null;
  readonly followup: ScheduledCommercialFollowupV1 | null;
}

interface PromotionRow {
  id: string;
  promotion_code: string;
  paid_offering_id: string;
  paid_offering_name: string;
  max_redemptions_per_contact: number;
}

async function activePromotion(
  db: DbClient,
  input: { workspace_id: string; paid_offering_code: string; channel?: 'text' | 'voice' },
): Promise<PromotionRow | null> {
  const rows = await db<PromotionRow[]>`
    SELECT p.id, p.promotion_code, p.paid_offering_id,
      paid.display_name AS paid_offering_name, p.max_redemptions_per_contact
    FROM promotions p
    JOIN offerings paid ON paid.id = p.paid_offering_id AND paid.workspace_id = p.workspace_id
    WHERE p.workspace_id = ${input.workspace_id}::uuid
      AND paid.code = ${input.paid_offering_code}
      AND p.active = true
      AND ${(input.channel ?? 'text')} = ANY(p.channels)
      AND (p.valid_from IS NULL OR p.valid_from <= now())
      AND (p.valid_until IS NULL OR p.valid_until > now())
      AND EXISTS (SELECT 1 FROM promotion_bonus_offerings b WHERE b.promotion_id = p.id)
    ORDER BY p.created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function commitCommercialActionV1(
  db: DbClient,
  input: {
    readonly workspace_id: string;
    readonly contact_id: string;
    readonly conversation_id: string;
    readonly paid_offering_code: string;
    readonly source_turn_id: string;
    readonly source_outbound_message_id: string;
    readonly action: PromotionAction;
    readonly now?: Date;
  },
): Promise<CommitCommercialActionResultV1> {
  const promotion = await activePromotion(db, input);
  if (!promotion) return { offer_id: null, followup: null };

  if (input.action.type === 'accept_promotion') {
    const accepted = await db<Array<{ id: string }>>`
      UPDATE promotion_offers
      SET status = 'accepted', accepted_at = COALESCE(accepted_at, now())
      WHERE workspace_id = ${input.workspace_id}::uuid
        AND contact_id = ${input.contact_id}::uuid
        AND conversation_id = ${input.conversation_id}::uuid
        AND promotion_id = ${promotion.id}::uuid
        AND paid_offering_id = ${promotion.paid_offering_id}::uuid
        AND status IN ('offered','accepted')
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING id
    `;
    return { offer_id: accepted[0]?.id ?? null, followup: null };
  }

  const kind: FollowupKind = input.action.type === 'request_promotion_review'
    ? 'promotion_review'
    : 'price_objection_checkin';
  const offerStatus = kind === 'promotion_review' ? 'pending_review' : 'cancelled';
  const cancelReason = kind === 'promotion_review' ? null : 'CHECKIN_ONLY';
  const source = await db<Array<{ conversation_seq: number; version: number | null }>>`
    SELECT outbound.conversation_seq, state.version
    FROM messages outbound
    LEFT JOIN conversation_sales_context_states_v1 state
      ON state.workspace_id = ${input.workspace_id}::uuid
     AND state.conversation_id = ${input.conversation_id}::uuid
    WHERE outbound.id = ${input.source_outbound_message_id}::uuid
      AND outbound.conversation_id = ${input.conversation_id}::uuid
      AND outbound.direction = 'outbound'
    LIMIT 1
  `;
  if (!source[0]) return { offer_id: null, followup: null };

  const idempotencyKey = `course-bonus:${input.source_turn_id}:${kind}`;
  const existing = await db<Array<{ offer_id: string; id: string; kind: FollowupKind; due_at: Date }>>`
    SELECT offer_id, id, kind, due_at
    FROM course_bonus_followups
    WHERE idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  if (existing[0]) return {
    offer_id: existing[0].offer_id,
    followup: { id: existing[0].id, kind: existing[0].kind, due_at: existing[0].due_at.toISOString() },
  };

  let offer: { id: string } | undefined;
  if (kind === 'promotion_review') {
    const inserted = await db<Array<{ id: string }>>`
      INSERT INTO promotion_offers (
        workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id,
        status, source_turn_id, source_conversation_version, source_state_version, expires_at
      ) VALUES (
        ${input.workspace_id}::uuid, ${input.contact_id}::uuid, ${input.conversation_id}::uuid,
        ${promotion.id}::uuid, ${promotion.paid_offering_id}::uuid, ${offerStatus},
        ${input.source_turn_id}::uuid, ${source[0].conversation_seq}, ${source[0].version},
        ${(input.now ?? new Date()).toISOString()}::timestamptz + interval '48 hours'
      )
      ON CONFLICT (conversation_id, promotion_id)
        WHERE status IN ('pending_review','offered','accepted')
      DO UPDATE SET updated_at = promotion_offers.updated_at
      RETURNING id
    `;
    offer = inserted[0];
  } else {
    const inserted = await db<Array<{ id: string }>>`
      INSERT INTO promotion_offers (
        workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id,
        status, source_turn_id, source_conversation_version, source_state_version,
        cancel_reason, expires_at
      ) VALUES (
        ${input.workspace_id}::uuid, ${input.contact_id}::uuid, ${input.conversation_id}::uuid,
        ${promotion.id}::uuid, ${promotion.paid_offering_id}::uuid, ${offerStatus},
        ${input.source_turn_id}::uuid, ${source[0].conversation_seq}, ${source[0].version},
        ${cancelReason}, ${(input.now ?? new Date()).toISOString()}::timestamptz + interval '24 hours'
      ) RETURNING id
    `;
    offer = inserted[0];
  }
  if (!offer) return { offer_id: null, followup: null };

  const dueAt = new Date((input.now ?? new Date()).getTime()
    + (kind === 'promotion_review' ? 60_000 : 10 * 60_000));
  const rows = await db<Array<{ id: string; kind: FollowupKind; due_at: Date }>>`
    INSERT INTO course_bonus_followups (
      offer_id, kind, due_at, idempotency_key, expected_conversation_seq,
      source_outbound_message_id
    ) VALUES (
      ${offer.id}::uuid, ${kind}, ${dueAt.toISOString()}::timestamptz, ${idempotencyKey},
      ${source[0].conversation_seq}, ${input.source_outbound_message_id}::uuid
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = course_bonus_followups.updated_at
    RETURNING id, kind, due_at
  `;
  return {
    offer_id: offer.id,
    followup: rows[0] ? {
      id: rows[0].id,
      kind: rows[0].kind,
      due_at: rows[0].due_at.toISOString(),
    } : null,
  };
}

interface FollowupSource {
  id: string;
  offer_id: string;
  kind: FollowupKind;
  status: string;
  claim_token: string | null;
  attempt_count: number;
  max_attempts: number;
  due_at: Date;
  expected_conversation_seq: number | null;
  source_outbound_message_id: string | null;
  workspace_id: string;
  contact_id: string;
  conversation_id: string;
  promotion_id: string;
  offer_status: string;
  expires_at: Date | null;
  paid_offering_id: string;
  paid_offering_code: string;
  paid_offering_name: string;
  promotion_code: string;
  promotion_active: boolean;
  valid_from: Date | null;
  valid_until: Date | null;
  channels: string[];
  max_redemptions_per_contact: number;
  contact_status: string;
  consent_status: string | null;
  deleted_at: Date | null;
  selected_offering_code: string | null;
  botpress_conversation_id: string;
  academy_name: string;
  customer_name: string | null;
}

async function followupSource(db: DbClient, id: string): Promise<FollowupSource | null> {
  const rows = await db<FollowupSource[]>`
    SELECT f.id, f.offer_id, f.kind, f.status, f.claim_token, f.attempt_count,
      f.max_attempts, f.due_at, f.expected_conversation_seq, f.source_outbound_message_id,
      po.workspace_id, po.contact_id, po.conversation_id, po.promotion_id,
      po.status AS offer_status, po.expires_at, po.paid_offering_id,
      paid.code AS paid_offering_code, paid.display_name AS paid_offering_name,
      p.promotion_code, p.active AS promotion_active, p.valid_from, p.valid_until,
      p.channels, p.max_redemptions_per_contact,
      c.status AS contact_status, permission.consent_status, c.deleted_at,
      state.selected_offering_code,
      thread.metadata->>'botpress_conversation_id' AS botpress_conversation_id,
      w.display_name AS academy_name, c.name AS customer_name
    FROM course_bonus_followups f
    JOIN promotion_offers po ON po.id = f.offer_id
    JOIN promotions p ON p.id = po.promotion_id
    JOIN offerings paid ON paid.id = po.paid_offering_id
    JOIN workspaces w ON w.id = po.workspace_id
    JOIN contacts c ON c.id = po.contact_id
    JOIN conversations conversation ON conversation.id = po.conversation_id
    JOIN channel_threads thread ON thread.id = conversation.channel_thread_id
    LEFT JOIN contact_channel_permissions permission
      ON permission.contact_id = c.id AND permission.channel = conversation.channel
    LEFT JOIN conversation_sales_context_states_v1 state
      ON state.workspace_id = po.workspace_id AND state.conversation_id = po.conversation_id
    WHERE f.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function cancellationReason(db: DbClient, source: FollowupSource): Promise<string | null> {
  const now = Date.now();
  if (!source.promotion_active
    || (source.valid_from && source.valid_from.getTime() > now)
    || (source.valid_until && source.valid_until.getTime() <= now)
    || !source.channels.includes('text')) return 'PROMOTION_INACTIVE';
  if (source.contact_status === 'inactivo' || source.deleted_at || source.consent_status === 'revoked') {
    return 'CONTACT_NOT_ELIGIBLE';
  }
  if (source.selected_offering_code !== source.paid_offering_code) return 'COURSE_CHANGED';
  if (source.expires_at && source.expires_at.getTime() <= now) return 'OFFER_EXPIRED';
  if (source.kind === 'promotion_review' && source.offer_status !== 'pending_review') return 'OFFER_NOT_PENDING';
  if (source.kind === 'price_objection_checkin' && source.offer_status !== 'cancelled') return 'CHECKIN_INVALID';
  const facts = await db<Array<{
    latest_seq: number;
    newer_inbound: boolean;
    paid: boolean;
    redeemed: number;
  }>>`
    SELECT
      COALESCE((SELECT max(conversation_seq) FROM messages WHERE conversation_id = ${source.conversation_id}::uuid), 0)::bigint AS latest_seq,
      EXISTS(
        SELECT 1
        FROM messages newer
        JOIN messages source_message ON source_message.id = ${source.source_outbound_message_id}::uuid
        WHERE newer.conversation_id = ${source.conversation_id}::uuid
          AND newer.direction = 'inbound'
          AND (newer.created_at, newer.id) > (source_message.created_at, source_message.id)
      ) AS newer_inbound,
      EXISTS(SELECT 1 FROM payments WHERE workspace_id = ${source.workspace_id}::uuid
        AND contact_id = ${source.contact_id}::uuid AND offering_id = ${source.paid_offering_id}::uuid
        AND status IN ('paid','refunded')) AS paid,
      (SELECT count(*)::integer FROM promotion_offers prior
        WHERE prior.promotion_id = ${source.promotion_id}::uuid
          AND prior.contact_id = ${source.contact_id}::uuid
          AND prior.status IN ('attached')) AS redeemed
  `;
  const fact = facts[0];
  if (!fact) return 'FOLLOWUP_CONTEXT_MISSING';
  if (fact.newer_inbound || (source.expected_conversation_seq !== null
    && Number(fact.latest_seq) > source.expected_conversation_seq)) {
    return 'NEWER_CONVERSATION_ACTIVITY';
  }
  if (fact.paid) return 'PURCHASE_ALREADY_RECORDED';
  if (Number(fact.redeemed) >= source.max_redemptions_per_contact) return 'REDEMPTION_LIMIT_REACHED';
  return null;
}

export async function claimCommercialFollowupV1(
  id: string,
  botpressConversationId: string,
  providerEventId: string,
  deps: { readonly db?: postgres.Sql } = {},
) {
  const db = deps.db ?? await defaultDatabase();
  return db.begin(async (tx) => {
    const source = await followupSource(tx, id);
    if (!source || source.botpress_conversation_id !== botpressConversationId) return { claimed: false as const };
    const reason = await cancellationReason(tx, source);
    if (reason) {
      await tx`
        UPDATE course_bonus_followups SET status = 'cancelled', terminal_reason = ${reason},
          claim_token = NULL, claimed_by = NULL, lease_until = NULL
        WHERE id = ${id}::uuid AND status IN ('pending','processing')
      `;
      if (source.kind === 'promotion_review') await tx`
        UPDATE promotion_offers SET status = 'cancelled', cancel_reason = ${reason}
        WHERE id = ${source.offer_id}::uuid AND status = 'pending_review'
      `;
      return { claimed: false as const };
    }
    const token = randomUUID();
    const rows = await tx<Array<{ id: string }>>`
      UPDATE course_bonus_followups SET status = 'processing', claim_token = ${token}::uuid,
        claimed_by = 'botpress-commercial-followup', lease_until = now() + interval '120 seconds',
        attempt_count = attempt_count + 1, provider_event_id = COALESCE(provider_event_id, ${providerEventId})
      WHERE id = ${id}::uuid AND due_at <= now() AND attempt_count < max_attempts
        AND (status = 'pending' OR (status = 'processing' AND lease_until <= now()))
      RETURNING id
    `;
    if (!rows[0]) return { claimed: false as const };
    const bonuses = await tx<Array<{ code: string; display_name: string; position: number }>>`
      SELECT offering.code, offering.display_name, bonus.position
      FROM promotion_bonus_offerings bonus
      JOIN offerings offering ON offering.id = bonus.offering_id
      WHERE bonus.promotion_id = ${source.promotion_id}::uuid
      ORDER BY bonus.position
    `;
    const history = await tx<Array<{ direction: string; content: string }>>`
      SELECT direction, content FROM messages
      WHERE conversation_id = ${source.conversation_id}::uuid
      ORDER BY created_at DESC, id DESC LIMIT 8
    `;
    const memories = await tx<Array<{ text: string }>>`
      SELECT value_normalized AS text FROM selected_memories
      WHERE contact_id = ${source.contact_id}::uuid AND status = 'active'
        AND memory_type IN ('study_goal','study_context','timeline')
      ORDER BY updated_at DESC LIMIT 1
    `;
    return {
      claimed: true as const,
      claim_token: token,
      kind: source.kind,
      academy_name: source.academy_name,
      customer_first_name: source.customer_name?.trim().split(/\s+/u)[0] ?? '',
      paid_offering_name: source.paid_offering_name,
      bonus_offerings: bonuses,
      customer_goal: memories[0]?.text ?? null,
      history: history.reverse(),
    };
  });
}

export type CommercialFollowupContentResult = { ok: true } | {
  ok: false;
  reason:
    | 'PROMOTION_URL_NOT_ALLOWED'
    | 'PROMOTION_PRICE_CHANGED'
    | 'PROMOTION_FAKE_APPROVAL'
    | 'PROMOTION_BONUS_NOT_NAMED'
    | 'PROMOTION_UNAUTHORIZED_COURSE'
    | 'PROMOTION_PREMATURE_DISCLOSURE';
};

export function validateCommercialFollowupNarrativeV1(
  source: {
    readonly kind: FollowupKind;
    readonly paid_offering_name: string;
    readonly bonus_offerings: ReadonlyArray<{ display_name: string }>;
    readonly all_offering_names: readonly string[];
  },
  message: string,
): CommercialFollowupContentResult {
  if (/https?:\/\/|www\./iu.test(message)) return { ok: false, reason: 'PROMOTION_URL_NOT_ALLOWED' };
  if (/\b(?:descuento|rebaja|bajar(?:te)? el precio|precio (?:más |mas )?bajo|por menos|te cobro menos)\b/iu.test(message)) {
    return { ok: false, reason: 'PROMOTION_PRICE_CHANGED' };
  }
  if (/\b(?:lucas|supervisor(?:a)?|gerencia|director(?:a)?|jef[ea])\b.{0,45}\b(?:autoriz|aprob|permit)/iu.test(message)
    || /\b(?:autoriz|aprob|permit)\w*\b.{0,45}\b(?:lucas|supervisor(?:a)?|gerencia|director(?:a)?|jef[ea])\b/iu.test(message)) {
    return { ok: false, reason: 'PROMOTION_FAKE_APPROVAL' };
  }
  const normalized = message.toLocaleLowerCase('es');
  const namedBonuses = source.bonus_offerings.filter((bonus) => (
    normalized.includes(bonus.display_name.toLocaleLowerCase('es'))
  ));
  if (source.kind === 'price_objection_checkin') {
    if (namedBonuses.length > 0 || /\b(?:regal|bonific|gratis|sin costo|promoci[oó]n)\w*\b/iu.test(message)) {
      return { ok: false, reason: 'PROMOTION_PREMATURE_DISCLOSURE' };
    }
    return { ok: true };
  }
  if (namedBonuses.length !== source.bonus_offerings.length) {
    return { ok: false, reason: 'PROMOTION_BONUS_NOT_NAMED' };
  }
  const authorized = new Set([
    source.paid_offering_name.toLocaleLowerCase('es'),
    ...source.bonus_offerings.map((bonus) => bonus.display_name.toLocaleLowerCase('es')),
  ]);
  if (source.all_offering_names.some((name) => (
    normalized.includes(name.toLocaleLowerCase('es'))
      && !authorized.has(name.toLocaleLowerCase('es'))
  ))) return { ok: false, reason: 'PROMOTION_UNAUTHORIZED_COURSE' };
  return { ok: true };
}

export async function deliverCommercialFollowupV1(
  id: string,
  input: {
    readonly claim_token: string;
    readonly botpress_conversation_id: string;
    readonly narrative: z.infer<typeof CommercialFollowupNarrativeSchema>;
  },
  deps: { readonly db?: postgres.Sql; readonly sender?: ManagedOutboundSender } = {},
) {
  const db = deps.db ?? await defaultDatabase();
  const source = await followupSource(db, id);
  if (!source || source.botpress_conversation_id !== input.botpress_conversation_id) {
    return { outcome: 'not_authorized' as const };
  }
  const narrative = CommercialFollowupNarrativeSchema.parse(input.narrative);
  const bonuses = await db<Array<{ code: string; display_name: string; position: number }>>`
    SELECT offering.code, offering.display_name, bonus.position
    FROM promotion_bonus_offerings bonus JOIN offerings offering ON offering.id = bonus.offering_id
    WHERE bonus.promotion_id = ${source.promotion_id}::uuid ORDER BY bonus.position
  `;
  const offerings = await db<Array<{ display_name: string }>>`
    SELECT display_name FROM offerings WHERE workspace_id = ${source.workspace_id}::uuid
  `;
  const validation = validateCommercialFollowupNarrativeV1({
    kind: source.kind,
    paid_offering_name: source.paid_offering_name,
    bonus_offerings: bonuses,
    all_offering_names: offerings.map((offering) => offering.display_name),
  }, narrative.message);
  if (!validation.ok) return { outcome: 'invalid_content' as const, reason: validation.reason };

  const authorization = buildAuthorizedEgress({
    content: narrative.message,
    authorized_urls: [],
    protected_facts: protectedFactsInContentV1(narrative.message),
  });
  if (!verifyAuthorizedEgress({ content: narrative.message, manifest: authorization }).ok) {
    return { outcome: 'invalid_content' as const, reason: 'PROMOTION_EGRESS_INVALID' as const };
  }
  const locked = await db<Array<{ id: string }>>`
    UPDATE course_bonus_followups SET status = 'ambiguous', terminal_reason = 'SEND_IN_PROGRESS'
    WHERE id = ${id}::uuid AND status = 'processing'
      AND claim_token = ${input.claim_token}::uuid AND lease_until > now()
    RETURNING id
  `;
  if (!locked[0]) return { outcome: 'claim_lost' as const };

  const sender = deps.sender ?? (await import('@/features/messaging/adapters/managed-outbound'))
    .createManagedOutboundSender(db, source.botpress_conversation_id);
  let result;
  try {
    result = await sender({
      workspaceId: source.workspace_id,
      contactId: source.contact_id,
      conversationId: source.conversation_id,
      text: narrative.message,
      authorizedEgress: authorization,
      idempotencyKey: `course-bonus-followup:${id}`,
      preferredChannel: 'whatsapp',
      purpose: 'conversational',
    });
  } catch {
    return { outcome: 'ambiguous' as const };
  }
  if (result.outcome !== 'sent') {
    const terminal = result.outcome === 'retryable' ? 'ambiguous' : 'dead_letter';
    await db`
      UPDATE course_bonus_followups SET status = ${terminal}, terminal_reason = ${result.reason},
        lease_until = NULL
      WHERE id = ${id}::uuid AND status = 'ambiguous' AND claim_token = ${input.claim_token}::uuid
    `;
    return { outcome: terminal as 'ambiguous' | 'dead_letter' };
  }

  let deliveredMessageId: string | null = null;
  if (result.deliveryId) {
    const messages = await db<Array<{ message_id: string }>>`
      SELECT message_id FROM outbound_deliveries WHERE id = ${result.deliveryId}::uuid LIMIT 1
    `;
    deliveredMessageId = messages[0]?.message_id ?? null;
  }
  if (!deliveredMessageId) {
    try {
      const { registerMessage } = await import('@/lib/services/message.service');
      const created = await registerMessage({
        conversation_id: source.conversation_id,
        direction: 'outbound',
        content: narrative.message,
        metadata: { commercial_followup_id: id, provider_message_id: result.providerMessageId },
      }, { db, embedding: 'skip' });
      deliveredMessageId = created.message.id;
    } catch {
      return { outcome: 'ambiguous' as const };
    }
  }
  await db.begin(async (tx) => {
    await tx`
      UPDATE course_bonus_followups SET status = 'sent', delivered_message_id = ${deliveredMessageId}::uuid,
        sent_at = now(), lease_until = NULL, terminal_reason = NULL
      WHERE id = ${id}::uuid AND status = 'ambiguous' AND claim_token = ${input.claim_token}::uuid
    `;
    if (source.kind === 'promotion_review') await tx`
      UPDATE promotion_offers SET status = 'offered', offered_at = now(),
        offered_outbound_message_id = ${deliveredMessageId}::uuid
      WHERE id = ${source.offer_id}::uuid AND status = 'pending_review'
    `;
  });
  return { outcome: 'sent' as const };
}

export async function releaseCommercialFollowupV1(
  id: string,
  claimToken: string,
  deps: { readonly db?: postgres.Sql } = {},
) {
  const db = deps.db ?? await defaultDatabase();
  await db`
    UPDATE course_bonus_followups SET status = 'pending', claim_token = NULL, claimed_by = NULL,
      lease_until = NULL, due_at = now() + interval '30 seconds', terminal_reason = 'NARRATIVE_GENERATION_FAILED'
    WHERE id = ${id}::uuid AND status = 'processing' AND claim_token = ${claimToken}::uuid
  `;
  return { outcome: 'released' as const };
}

export async function scheduleCommercialFollowupRetryV1(
  id: string,
  delayMs = 30_000,
  deps: { readonly db?: postgres.Sql; readonly fetchImpl?: typeof fetch } = {},
) {
  const db = deps.db ?? await defaultDatabase();
  const source = await followupSource(db, id);
  if (!source) return { scheduled: false as const };
  const { loadBotpressManagedMessagingConfig } = await import('@/lib/config');
  const managed = loadBotpressManagedMessagingConfig();
  if (!managed) return { scheduled: false as const };
  const response = await (deps.fetchImpl ?? fetch)(`${managed.apiUrl}/v1/chat/events`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${managed.token}`,
      'x-bot-id': managed.botId,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'studyxCommercialFollowup',
      payload: { followup_id: id },
      conversationId: source.botpress_conversation_id,
      schedule: { delay: Math.max(0, delayMs) },
    }),
  });
  return { scheduled: response.ok as boolean };
}
