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

export const INITIAL_PASSWORD = 'Escuela.123';
export const CAMPUS_URL = 'https://mystudyx.com/campus-virtual';
const OFFICIAL_CONTACTS = [
  'C A N A L E S  O F I C I A L E S  D E  C O N T A C T O',
  '',
  'WHATSAPP OFICIAL DE LA ACADEMIA: 786-916-4372 (solo WhatsApp)',
  'NÚMERO DE ASISTENCIA AL ALUMNO: 866-217-7282 ☎️📚',
  'ADMINISTRACIÓN: info@mystudyx.com',
  'DEPARTAMENTO DE PROFESORES: studyxtutorias@gmail.com',
].join('\n');
export type NotificationKind = 'payment_received' | 'access_ready' | 'access_delayed';
interface Source {
  id: string; payment_id: string; kind: NotificationKind; status: string; claim_token: string | null;
  dispatch_attempts: number; lease_until: Date | null; workspace_id: string; contact_id: string;
  conversation_id: string; botpress_conversation_id: string; academy_name: string;
  offering_name: string; registration_email: string; registration_name: string;
  enrollment_status: string | null; student_was_created: boolean | null;
  login_email: string | null; login_url: string | null;
}
export interface PostSaleConfig { enabled: boolean; environment: 'test' | 'live'; paidAfter: Date }
export interface Deps { db?: postgres.Sql; config?: PostSaleConfig; sender?: ManagedOutboundSender; fetchImpl?: typeof fetch }
export function loadPostSaleConfig(): PostSaleConfig {
  const enabled = process.env.POST_SALE_ENABLED === 'true';
  const environment = process.env.PAYMENT_LINK_ENVIRONMENT;
  const cutoff = process.env.CENTRAL_CARGA_ENROLL_PAID_AFTER;
  if (enabled && (!['test', 'live'].includes(environment ?? '') || !cutoff || !Number.isFinite(Date.parse(cutoff)))) {
    throw new Error('POST_SALE_CONFIG_INVALID');
  }
  return { enabled, environment: environment === 'test' ? 'test' : 'live', paidAfter: new Date(cutoff ?? '2100-01-01') };
}
async function sources(db: postgres.Sql, config: PostSaleConfig, id?: string, paymentId?: string) {
  return db<Source[]>`
    SELECT n.*, p.workspace_id, p.contact_id, p.source_conversation_id AS conversation_id,
      t.metadata->>'botpress_conversation_id' AS botpress_conversation_id,
      w.display_name AS academy_name, o.display_name AS offering_name,
      COALESCE(p.registration_email, c.email) AS registration_email,
      COALESCE(p.registration_name, c.name) AS registration_name,
      e.enrollment_status, e.student_was_created, e.login_email, e.login_url
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
      AND (n.kind <> 'access_delayed' OR e.payment_id IS NULL)
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
export function validateNotificationSource(source: Pick<Source, 'kind' | 'enrollment_status' | 'login_email' | 'registration_email'>): boolean {
  if (source.kind !== 'access_ready') return true;
  return ['active', 'already_enrolled'].includes(source.enrollment_status ?? '')
    && !!source.login_email && source.login_email.trim().toLowerCase() === source.registration_email?.trim().toLowerCase();
}
export async function dispatchNotifications(paymentId?: string, deps: Deps = {}) {
  const config = deps.config ?? loadPostSaleConfig();
  if (!config.enabled) return { dispatched: 0 };
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
  const history = await db<Array<{ direction: string; content: string }>>`
    SELECT direction, content FROM messages WHERE conversation_id = ${source.conversation_id}::uuid
    ORDER BY created_at DESC LIMIT 6`;
  return { claimed: true as const, claim_token: token, kind: source.kind,
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
  | 'POST_SALE_CHANGE_MUST_BE_OPTIONAL';

export class PostSaleContentError extends Error {
  constructor(readonly code: PostSaleContentErrorCode) {
    super(code);
    this.name = 'PostSaleContentError';
  }
}

const OPTIONAL_PASSWORD_CHANGE = /^(?:(?:si quieres,?\s+)?(?:puedes\s+)?(?:cambiar|actualizar|modificar)\s+(?:tu|la)\s+contraseña|te\s+(?:sugiero|recomiendo)(?:\s+que)?\s+(?:cambiar|actualizar|modificar|cambies|actualices|modifiques)\s+(?:tu|la)\s+contraseña)(?:\s+(?:después de|al)\s+(?:ingresar|entrar))?[.!]?$/iu;

function deterministicAccessBlocks(
  source: Pick<Source, 'kind' | 'student_was_created' | 'login_email' | 'login_url'>,
): string[] {
  if (source.kind !== 'access_ready') return [];
  const credentials = source.student_was_created
    ? `📌 USUARIO: ${source.login_email}\n\n📌 CONTRASEÑA: ${INITIAL_PASSWORD}\n\nRECUERDA LA «E» EN MAYÚSCULA`
    : `📌 USUARIO: ${source.login_email}\n\n📌 CONTRASEÑA: la que ya utilizas`;
  const campus = `LINK DIRECTO AL CAMPUS VIRTUAL 👇🏻\n\n${CAMPUS_URL}`;
  return [campus, credentials, OFFICIAL_CONTACTS];
}

export function assemblePostSaleMessage(source: Pick<Source, 'kind' | 'student_was_created' | 'login_email' | 'login_url'> & Partial<Pick<Source, 'registration_name' | 'offering_name'>>, narrative: z.infer<typeof NarrativeSchema>) {
  // The model authors the conversation. Credentials are bound to verified backend data, outside the model.
  if (/https?:|www\.|@|\b(?:usuario|contraseña|password|clave)\b|(?:Studyx|Escuela)\.123/iu.test(narrative.intro)) {
    throw new PostSaleContentError('POST_SALE_UNAUTHORIZED_PROSE');
  }
  // Brand casing and a repeated first name/course are style concerns. They
  // must never strand verified access. Normalize the one mechanical issue and
  // let the transactional message through.
  const intro = narrative.intro.replace(/\bStudyX\b/gu, 'Studyx');
  if (source.kind !== 'access_ready') {
    if (narrative.suggestion) throw new PostSaleContentError('POST_SALE_UNEXPECTED_SUGGESTION');
    return intro;
  }
  if (narrative.suggestion && !OPTIONAL_PASSWORD_CHANGE.test(narrative.suggestion.trim())) {
    throw new PostSaleContentError('POST_SALE_CHANGE_MUST_BE_OPTIONAL');
  }
  return [intro, ...deterministicAccessBlocks(source), narrative.suggestion]
    .filter(Boolean).join('\n\n');
}
export async function deliverNotification(id: string, input: { claim_token: string; botpress_conversation_id: string; narrative: z.infer<typeof NarrativeSchema> }, deps: Deps = {}) {
  const config = deps.config ?? loadPostSaleConfig();
  if (!config.enabled) return { outcome: 'disabled' };
  const db = deps.db ?? defaultDb;
  const [source] = await sources(db, config, id);
  if (!source || source.botpress_conversation_id !== input.botpress_conversation_id || !validateNotificationSource(source)) return { outcome: 'not_authorized' };
  let text: string;
  try {
    text = assemblePostSaleMessage(source, NarrativeSchema.parse(input.narrative));
  } catch (error) {
    if (error instanceof PostSaleContentError) {
      return { outcome: 'invalid_content' as const, reason: error.code };
    }
    throw error;
  }
  const authorization = buildAuthorizedEgress({
    content: text,
    authorized_urls: [CAMPUS_URL, ...(source.login_url ? [source.login_url] : [])],
    // Only backend-owned blocks receive fact authorization. Model-authored
    // prose remains subject to the commercial guard, so a fabricated price,
    // modality or certification in `narrative` still fails closed.
    protected_facts: protectedFactsInContentV1(
      deterministicAccessBlocks(source).join('\n\n'),
    ),
  });
  if (!verifyAuthorizedEgress({ content: text, manifest: authorization }).ok) {
    return { outcome: 'invalid_content' as const, reason: 'POST_SALE_EGRESS_INVALID' as const };
  }
  const [locked] = await db<Array<{ id: string }>>`
    UPDATE post_sale_notifications SET status = 'ambiguous', last_error_code = 'SEND_IN_PROGRESS'
    WHERE id = ${id}::uuid AND status = 'processing' AND claim_token = ${input.claim_token}::uuid
      AND lease_until > now() RETURNING id`;
  if (!locked) return { outcome: 'claim_lost' };
  // Transition before external I/O: a crash cannot silently send the credentials twice.
  const sender = deps.sender ?? createManagedOutboundSender(db, source.botpress_conversation_id);
  let result;
  try {
    result = await sender({ workspaceId: source.workspace_id, contactId: source.contact_id,
      conversationId: source.conversation_id, text, authorizedEgress: authorization,
      idempotencyKey: `post-sale:${source.payment_id}:${source.kind}`, purpose: 'transactional' });
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
