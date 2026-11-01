import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import { sql as defaultDb } from '@/lib/db/orchestrator';
import { loadBotpressManagedMessagingConfig } from '@/lib/config';
import { createManagedOutboundSender, type ManagedOutboundSender } from '@/features/messaging/adapters/managed-outbound';
import {
  buildAuthorizedEgress,
  protectedFactsInContentV1,
  verifyAuthorizedEgress,
} from '@/features/orchestration/domain/egress-guard';
import { runEnrollmentWorker } from '../central-carga/worker';
import { logger } from '@/lib/observability/structured-log';
import { auditLog } from '@/lib/audit/logger';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { backendReleaseSha } from '@/lib/services/turn-evidence.service';
import { assertsModelCredentialValueV1, assertsRequiredPasswordChangeV1, assertsUnverifiedPostSaleAccessV1 } from '@/shared/conversation/post-sale-facts';

import { loadAccessTemplateConfig, renderAccessTemplate, type AccessTemplateConfig } from './access-template';
export type NotificationKind = 'payment_received' | 'access_ready' | 'access_delayed';
interface Source {
  id: string; payment_id: string; kind: NotificationKind; status: string; claim_token: string | null;
  dispatch_attempts: number; lease_until: Date | null; workspace_id: string; contact_id: string;
  conversation_id: string; botpress_conversation_id: string; academy_name: string;
  offering_name: string; registration_email: string; registration_name: string;
  enrollment_status: string | null; student_was_created: boolean | null;
  login_email: string | null; login_url: string | null;
  bonus_offerings: Array<{ code: string; display_name: string; position: number }>;
  verified_bonus_enrollments: Array<{ offering_code: string; enrollment_status: string; position: number }>;
  known_offering_names: string[];
}
export interface PostSaleConfig { enabled: boolean; environment: 'test' | 'live'; paidAfter: Date; accessTemplate?: AccessTemplateConfig }
export interface Deps { db?: postgres.Sql; config?: PostSaleConfig; sender?: ManagedOutboundSender; fetchImpl?: typeof fetch }
export function loadPostSaleConfig(): PostSaleConfig {
  const enabled = process.env.POST_SALE_ENABLED === 'true';
  const environment = process.env.PAYMENT_LINK_ENVIRONMENT;
  const cutoff = process.env.CENTRAL_CARGA_ENROLL_PAID_AFTER;
  if (enabled && (!['test', 'live'].includes(environment ?? '') || !cutoff || !Number.isFinite(Date.parse(cutoff)))) {
    throw new Error('POST_SALE_CONFIG_INVALID');
  }
  return { enabled, environment: environment === 'test' ? 'test' : 'live', paidAfter: new Date(cutoff ?? '2100-01-01'), accessTemplate: enabled ? loadAccessTemplateConfig() : undefined };
}
async function sources(db: postgres.Sql, config: PostSaleConfig, id?: string, paymentId?: string) {
  return db<Source[]>`
    SELECT n.*, p.workspace_id, p.contact_id, p.source_conversation_id AS conversation_id,
      t.metadata->>'botpress_conversation_id' AS botpress_conversation_id,
      w.display_name AS academy_name, COALESCE(e.offering_display_name_snapshot,o.display_name) AS offering_name,
      COALESCE(p.registration_email, c.email) AS registration_email,
      COALESCE(p.registration_name, c.name) AS registration_name,
      e.enrollment_status, e.student_was_created, e.login_email, e.login_url,
      ARRAY(SELECT known.display_name FROM offerings known WHERE known.workspace_id=p.workspace_id) AS known_offering_names,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'code', bonus.offering_code_snapshot,
          'display_name', bonus.offering_display_name_snapshot,
          'position', bonus.position
        ) ORDER BY bonus.position)
        FROM payment_bonus_offerings bonus WHERE bonus.payment_id = p.id
      ), '[]'::jsonb) AS bonus_offerings,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'offering_code', verified.offering_code,
          'enrollment_status', verified.enrollment_status,
          'position', verified.position
        ) ORDER BY verified.position)
        FROM central_bonus_enrollment_items verified WHERE verified.payment_id = p.id
      ), '[]'::jsonb) AS verified_bonus_enrollments
    FROM post_sale_notifications n JOIN payments p ON p.id = n.payment_id
    JOIN contacts c ON c.id = p.contact_id JOIN workspaces w ON w.id = p.workspace_id
    JOIN workspace_contacts wc ON wc.workspace_id = p.workspace_id AND wc.contact_id = p.contact_id
    JOIN offerings o ON o.id = p.offering_id AND o.workspace_id = p.workspace_id
    JOIN conversations v ON v.id = p.source_conversation_id AND v.contact_id = p.contact_id
    JOIN channel_threads t ON t.id = v.channel_thread_id AND t.contact_id = p.contact_id
    LEFT JOIN central_enrollments e ON e.payment_id = p.id
    WHERE p.status = 'paid' AND p.paid_at >= ${config.paidAfter} AND p.environment = ${config.environment}
      AND p.provider = 'stripe' AND p.plan_code IS NOT NULL AND c.deleted_at IS NULL
      AND n.status IN ('pending', 'dispatched', 'processing')
      AND (${id ?? null}::uuid IS NOT NULL OR (n.available_at <= now() AND (n.lease_until IS NULL OR n.lease_until <= now())))
      AND (n.kind <> 'access_delayed' OR e.payment_id IS NULL OR e.enrollment_status='processing' OR EXISTS (
        SELECT 1 FROM payment_bonus_offerings pending WHERE pending.payment_id=p.id
          AND NOT EXISTS (SELECT 1 FROM central_bonus_enrollment_items active
            WHERE active.payment_id=p.id AND active.offering_code=pending.offering_code_snapshot
              AND active.position=pending.position AND active.enrollment_status IN ('active','already_enrolled'))
      ))
      AND NULLIF(t.metadata->>'botpress_conversation_id', '') IS NOT NULL AND t.unusable_at IS NULL
      AND (${id ?? null}::uuid IS NULL OR n.id = ${id ?? null}::uuid)
      AND (${paymentId ?? null}::uuid IS NULL OR p.id = ${paymentId ?? null}::uuid)
      AND (n.kind = 'payment_received' OR EXISTS (SELECT 1 FROM post_sale_notifications prior
        WHERE prior.payment_id = p.id AND prior.kind = 'payment_received'
          AND prior.status IN ('sent', 'cancelled')))
    ORDER BY n.created_at LIMIT 20
  `;
}

/**
 * A verified enrollment result contains the payment acknowledgement already.
 * If it arrives before the first notification has begun an external send, keep
 * only the newest useful state. `ambiguous` is deliberately excluded because
 * that row may already have reached WhatsApp and can no longer be superseded
 * safely.
 */
async function supersedePostSalePredecessors(
  db: postgres.Sql,
  scope: { paymentId?: string; notificationId?: string } = {},
) {
  await db`
    WITH target_payment AS (
      SELECT payment_id
      FROM post_sale_notifications
      WHERE (${scope.notificationId ?? null}::uuid IS NOT NULL AND id = ${scope.notificationId ?? null}::uuid)
        OR (${scope.notificationId ?? null}::uuid IS NULL AND ${scope.paymentId ?? null}::uuid IS NULL)
      UNION
      SELECT ${scope.paymentId ?? null}::uuid
      WHERE ${scope.paymentId ?? null}::uuid IS NOT NULL
    )
    UPDATE post_sale_notifications stale
    SET status = 'cancelled', lease_until = NULL, claim_token = NULL,
      last_error_code = 'SUPERSEDED_BY_FULFILLMENT_STATE'
    WHERE stale.payment_id IN (SELECT payment_id FROM target_payment)
      AND stale.status IN ('pending', 'dispatched', 'processing')
      AND (
        (stale.kind = 'payment_received' AND EXISTS (
          SELECT 1 FROM post_sale_notifications newer
          WHERE newer.payment_id = stale.payment_id
            AND newer.kind IN ('access_ready', 'access_delayed')
            AND newer.status NOT IN ('cancelled', 'dead_letter')
        ))
        OR
        (stale.kind = 'access_delayed' AND EXISTS (
          SELECT 1 FROM post_sale_notifications newer
          WHERE newer.payment_id = stale.payment_id
            AND newer.kind = 'access_ready'
            AND newer.status NOT IN ('cancelled', 'dead_letter')
        ))
      )
  `;
}
type BonusEvidence = {
  bonus_offerings?: ReadonlyArray<{ code: string; display_name: string; position: number }>;
  verified_bonus_enrollments?: ReadonlyArray<{ offering_code: string; enrollment_status: string; position: number }>;
};

function hasCompleteBonusEvidence(source: BonusEvidence): boolean {
  const expected = source.bonus_offerings ?? [];
  const verified = source.verified_bonus_enrollments ?? [];
  if (expected.length === 0) return verified.length === 0;
  return verified.length === expected.length && expected.every((bonus, index) => {
    const item = verified[index];
    return item?.offering_code === bonus.code
      && item.position === bonus.position
      && ['active', 'already_enrolled'].includes(item.enrollment_status);
  });
}

function hasVerifiedAccess(source: Pick<Source, 'enrollment_status'> & BonusEvidence): boolean {
  return ['active', 'already_enrolled'].includes(source.enrollment_status ?? '')
    || (source.bonus_offerings ?? []).some(bonus => (source.verified_bonus_enrollments ?? []).some(item =>
      item.offering_code === bonus.code && item.position === bonus.position
      && ['active', 'already_enrolled'].includes(item.enrollment_status)));
}

function usesAccessTemplate(source: Pick<Source, 'kind' | 'enrollment_status'> & BonusEvidence): boolean {
  return source.kind === 'access_ready' || (source.kind === 'access_delayed' && hasVerifiedAccess(source));
}

function accessConfig(config: PostSaleConfig): AccessTemplateConfig {
  return config.accessTemplate ?? loadAccessTemplateConfig();
}

export function validateNotificationSource(
  source: Pick<Source, 'kind' | 'enrollment_status' | 'login_email' | 'registration_email'> & BonusEvidence,
): boolean {
  if (!usesAccessTemplate(source)) return true;
  return (source.kind !== 'access_ready' || ['active', 'already_enrolled'].includes(source.enrollment_status ?? ''))
    && !!source.login_email
    && source.login_email.trim().toLowerCase() === source.registration_email?.trim().toLowerCase()
    && (source.kind !== 'access_ready' || hasCompleteBonusEvidence(source));
}
export async function dispatchNotifications(paymentId?: string, deps: Deps = {}) {
  const config = deps.config ?? loadPostSaleConfig();
  if (!config.enabled) return { dispatched: 0 };
  accessConfig(config);
  const db = deps.db ?? defaultDb;
  const managed = loadBotpressManagedMessagingConfig();
  if (!managed) throw new Error('POST_SALE_BOTPRESS_UNCONFIGURED');
  const fetchImpl = deps.fetchImpl ?? fetch;
  await supersedePostSalePredecessors(db, { paymentId });
  let dispatched = 0;
  for (const source of await sources(db, config, undefined, paymentId)) {
    if (!validateNotificationSource(source)) {
      await db`UPDATE post_sale_notifications SET status = 'dead_letter', last_error_code = 'ENROLLMENT_IDENTITY_MISMATCH'
        WHERE id = ${source.id}::uuid AND status IN ('pending', 'dispatched')`;
      continue;
    }
    // `processing` only covers Botpress narrative generation. `deliverNotification`
    // moves the row to `ambiguous` before any external send, so an expired
    // processing lease is proven pre-send and is safe to reclaim.
    await db`UPDATE post_sale_notifications SET status = 'pending', claim_token = NULL,
      lease_until = NULL, available_at = now(), last_error_code = 'NARRATIVE_LEASE_EXPIRED'
      WHERE id = ${source.id}::uuid AND status = 'processing' AND lease_until <= now()
        AND provider_message_id IS NULL`;
    await db`UPDATE post_sale_notifications SET status = 'dead_letter', last_error_code = 'DISPATCH_ATTEMPTS_EXHAUSTED'
      WHERE id = ${source.id}::uuid AND status IN ('pending', 'dispatched') AND dispatch_attempts >= 3
        AND (lease_until IS NULL OR lease_until <= now())`;
    const token = randomUUID();
    const [claimed] = await db<Array<{ id: string }>>`
      UPDATE post_sale_notifications SET status = 'dispatched', claim_token = ${token}::uuid,
        lease_until = now() + interval '90 seconds', dispatch_attempts = dispatch_attempts + 1
      WHERE id = ${source.id}::uuid AND status IN ('pending', 'dispatched') AND available_at <= now()
        AND (lease_until IS NULL OR lease_until <= now()) AND dispatch_attempts < 3 RETURNING id`;
    if (!claimed) continue;
    try {
      const response = await fetchImpl(`${managed.apiUrl}/v1/chat/events`, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${managed.token}`, 'x-bot-id': managed.botId, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'studyxPostSale', payload: { notification_id: source.id }, conversationId: source.botpress_conversation_id }),
      });
      if (!response.ok) throw new Error(`EVENT_HTTP_${response.status}`);
      const payload = await response.json() as { event?: { id?: string } };
      await db`UPDATE post_sale_notifications SET provider_event_id = ${payload.event?.id ?? null}
        WHERE id = ${source.id}::uuid AND status = 'dispatched' AND claim_token = ${token}::uuid`;
      dispatched++;
    } catch {
      await db`UPDATE post_sale_notifications SET status = 'pending', lease_until = NULL,
        available_at = now() + make_interval(secs => ${30 * 2 ** source.dispatch_attempts}), last_error_code = 'EVENT_DISPATCH_FAILED'
        WHERE id = ${source.id}::uuid AND status = 'dispatched' AND claim_token = ${token}::uuid`;
    }
  }
  return { dispatched };
}
export async function claimNotification(id: string, botpressConversationId: string, deps: Deps = {}) {
  const config = deps.config ?? loadPostSaleConfig();
  if (!config.enabled) return { claimed: false as const };
  accessConfig(config);
  const db = deps.db ?? defaultDb;
  await supersedePostSalePredecessors(db, { notificationId: id });
  const [source] = await sources(db, config, id);
  if (!source || source.botpress_conversation_id !== botpressConversationId || !validateNotificationSource(source)) return { claimed: false as const };
  const token = randomUUID();
  const [claimed] = await db<Array<{ id: string }>>`
    UPDATE post_sale_notifications SET status = 'processing', claim_token = ${token}::uuid,
      lease_until = now() + interval '120 seconds'
    WHERE id = ${id}::uuid AND status = 'dispatched' AND lease_until > now() RETURNING id`;
  if (!claimed) return { claimed: false as const };
  const history = usesAccessTemplate(source) ? [] : await db<Array<{ direction: string; content: string }>>`
    SELECT direction, content FROM messages WHERE conversation_id = ${source.conversation_id}::uuid
    ORDER BY created_at DESC LIMIT 6`;
  return { claimed: true as const, claim_token: token, kind: source.kind,
    delivery_mode: usesAccessTemplate(source) ? 'access_template' as const : 'agent_narrative' as const,
    academy_name: source.academy_name, offering_name: source.offering_name,
    customer_first_name: source.registration_name?.split(' ')[0] ?? '',
    existing_user: source.student_was_created === false, new_user: source.student_was_created === true,
    history: history.reverse() };
}
export const NarrativeSchema = z.object({
  intro: z.string().trim().min(1).max(500),
  suggestion: z.string().trim().max(180),
}).strict();

export type PostSaleContentErrorCode =
  | 'POST_SALE_UNAUTHORIZED_PROSE'
  | 'POST_SALE_UNEXPECTED_SUGGESTION'
  | 'POST_SALE_CHANGE_MUST_BE_OPTIONAL'
  | 'POST_SALE_ACCESS_NOT_VERIFIED';

export class PostSaleContentError extends Error {
  constructor(readonly code: PostSaleContentErrorCode) {
    super(code);
    this.name = 'PostSaleContentError';
  }
}

export function assemblePostSaleMessage(
  source: Pick<Source, 'kind' | 'student_was_created' | 'login_email' | 'login_url'>
    & Partial<Pick<Source, 'enrollment_status' | 'registration_name' | 'offering_name' | 'bonus_offerings' | 'verified_bonus_enrollments' | 'known_offering_names'>>,
  narrative?: z.infer<typeof NarrativeSchema>,
  templateConfig?: AccessTemplateConfig,
) {
  if (usesAccessTemplate({ ...source, enrollment_status: source.enrollment_status ?? null })) {
    return renderAccessTemplate({ ...source, enrollment_status: source.enrollment_status ?? null,
      offering_name: source.offering_name ?? '' }, templateConfig ?? loadAccessTemplateConfig());
  }
  const authored = NarrativeSchema.parse(narrative);
  const prose = `${authored.intro}\n${authored.suggestion}`;
  if (assertsRequiredPasswordChangeV1(prose)) throw new PostSaleContentError('POST_SALE_CHANGE_MUST_BE_OPTIONAL');
  if (/https?:|www\.|@|(?:Studyx|Escuela)\.123/iu.test(prose) || assertsModelCredentialValueV1(prose)) {
    throw new PostSaleContentError('POST_SALE_UNAUTHORIZED_PROSE');
  }
  if (assertsUnverifiedPostSaleAccessV1({ text: prose, access_ready: false,
    activated_course_names: [], known_course_names: source.known_offering_names ?? [] })) {
    throw new PostSaleContentError('POST_SALE_ACCESS_NOT_VERIFIED');
  }
  if (authored.suggestion) throw new PostSaleContentError('POST_SALE_UNEXPECTED_SUGGESTION');
  return authored.intro;
}
export async function deliverNotification(id: string, input: { claim_token: string; botpress_conversation_id: string; narrative?: z.infer<typeof NarrativeSchema> }, deps: Deps = {}) {
  const config = deps.config ?? loadPostSaleConfig();
  if (!config.enabled) return { outcome: 'disabled' };
  const templateConfig = accessConfig(config);
  const db = deps.db ?? defaultDb;
  const [source] = await sources(db, config, id);
  if (!source || source.botpress_conversation_id !== input.botpress_conversation_id || !validateNotificationSource(source)) return { outcome: 'not_authorized' };
  const deterministic = usesAccessTemplate(source);
  const narrative = deterministic ? undefined : input.narrative;
  const evidenceKey = `post-sale-evidence:${id}:${input.claim_token}:${sha256Hex(narrative ?? { template: 'access_v1' })}`;
  if (!deterministic) await auditLog({ action: 'post_sale.narrative.received', entity_type: 'post_sale_notification', entity_id: id,
    event_key: `${evidenceKey}:proposal`, payload: { narrative, backend_sha: backendReleaseSha() },
  }, db);
  let text: string;
  try {
    text = assemblePostSaleMessage(source, narrative, templateConfig);
  } catch (error) {
    if (error instanceof PostSaleContentError) {
      await auditLog({ action: 'post_sale.narrative.rejected', entity_type: 'post_sale_notification', entity_id: id,
        event_key: `${evidenceKey}:rejection`, payload: { code: error.code, subject: 'post_sale_narrative' },
      }, db);
      return { outcome: 'invalid_content' as const, reason: error.code };
    }
    throw error;
  }
  const authorization = buildAuthorizedEgress({
    content: text,
    authorized_urls: deterministic ? [templateConfig.campusUrl] : [],
    // Owner-authorized deterministic content carries its full fact manifest.
    // Model prose on payment/delay events retains all normal egress controls.
    protected_facts: deterministic ? protectedFactsInContentV1(text) : [],
  });
  if (!verifyAuthorizedEgress({ content: text, manifest: authorization }).ok) {
    await auditLog({ action: 'post_sale.narrative.rejected', entity_type: 'post_sale_notification', entity_id: id,
      event_key: `${evidenceKey}:egress-rejection`, payload: { code: 'POST_SALE_EGRESS_INVALID', subject: 'post_sale_narrative' },
    }, db);
    return { outcome: 'invalid_content' as const, reason: 'POST_SALE_EGRESS_INVALID' as const };
  }
  const [locked] = await db<Array<{ id: string }>>`
    UPDATE post_sale_notifications SET status = 'ambiguous', last_error_code = 'SEND_IN_PROGRESS'
    WHERE id = ${id}::uuid AND status = 'processing' AND claim_token = ${input.claim_token}::uuid
      AND lease_until > now() RETURNING id`;
  if (!locked) return { outcome: 'claim_lost' };
  await auditLog({ action: 'post_sale.narrative.authorized', entity_type: 'post_sale_notification', entity_id: id,
    event_key: `${evidenceKey}:authorized`, payload: { authorized_text: deterministic && source.student_was_created
        ? text.split(templateConfig.initialPassword).join('[REDACTED]') : text,
      authorized_content_hash: authorization.content_hash,
      ...(deterministic ? { template_version: 'access_v1', delivery_mode: 'access_template' }
        : { authorized_egress: authorization }), backend_sha: backendReleaseSha() },
  }, db);
  // Transition before external I/O: a crash cannot silently send the credentials twice.
  const sender = deps.sender ?? createManagedOutboundSender(db, source.botpress_conversation_id);
  let result;
  try {
    result = await sender({ workspaceId: source.workspace_id, contactId: source.contact_id,
      conversationId: source.conversation_id, text, authorizedEgress: authorization,
      idempotencyKey: `post-sale:${source.payment_id}:${source.kind}`, purpose: 'transactional',
      ...(deterministic && source.student_was_created ? { auditRedactions: [templateConfig.initialPassword] } : {}) });
  } catch {
    return { outcome: 'ambiguous' };
  }
  const status = result.outcome === 'sent' ? 'sent' : result.outcome === 'retryable' ? 'ambiguous' : 'dead_letter';
  await db`UPDATE post_sale_notifications SET status = ${status}, provider_message_id = ${result.providerMessageId},
    sent_at = CASE WHEN ${status} = 'sent' THEN now() ELSE NULL END, last_error_code = ${result.reason}, lease_until = NULL
    WHERE id = ${id}::uuid AND status = 'ambiguous' AND claim_token = ${input.claim_token}::uuid`;
  if (status === 'sent') await dispatchNotifications(source.payment_id, deps);
  return { outcome: status };
}
export async function runPostSalePipeline(paymentId?: string) {
  if (!loadPostSaleConfig().enabled) return { enabled: false };
  const startedAt = Date.now();
  let enrollment;
  // The webhook responds immediately; its bounded background task retries transient
  // Central failures without requiring a minute-level cron or another customer turn.
  for (let attempt = 0; attempt < 3; attempt++) {
    enrollment = await runEnrollmentWorker({ scoped: true, payment_id: paymentId, limit: paymentId ? 1 : 10 });
    await dispatchNotifications(paymentId).catch(() => logger.warn({ event: 'post_sale.dispatch_failed' }));
    if (!paymentId) break;
    const [job] = await defaultDb<Array<{ status: string; available_at: Date; attempt_count: number }>>`
      SELECT status, available_at, attempt_count FROM fulfillment_jobs WHERE payment_id = ${paymentId}::uuid`;
    if (!job || job.status !== 'failed_retryable' || job.attempt_count >= 3) break;
    const delay = Math.max(0, job.available_at.getTime() - Date.now() + 250);
    if (Date.now() - startedAt + delay + 60000 > 240000) break;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return { enabled: true, enrollment };
}

export async function releaseNotification(id: string, token: string, deps: Deps = {}) {
  const db = deps.db ?? defaultDb;
  await db`UPDATE post_sale_notifications SET status = 'pending', lease_until = NULL,
    available_at = now() + interval '30 seconds', last_error_code = 'NARRATIVE_GENERATION_FAILED'
    WHERE id = ${id}::uuid AND status = 'processing' AND claim_token = ${token}::uuid`;
  return { outcome: 'released' };
}
