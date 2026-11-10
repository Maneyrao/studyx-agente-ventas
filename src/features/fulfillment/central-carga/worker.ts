import { randomUUID } from 'node:crypto';
import { sql as orchestratorSql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import type postgres from 'postgres';
import { logger } from '@/lib/observability/structured-log';
import { CentralCargaClient, type EnrollmentCallOutcome } from './client';
import {
  isCentralCargaBonusFulfillmentAllowedForContact,
  loadCentralCargaBonusConfig,
  loadCentralCargaConfig,
  type CentralCargaBonusConfig,
  type CentralCargaConfig,
} from './config';
import {
  buildEnrollmentRequest,
  issuePaths,
  type EnrollmentResponse,
  type EnrollmentSource,
} from './contract';
import { computeBackoffSeconds, effectiveMaxAttempts, preflight, sandboxLiveBridgeState } from './policy';
import { openBonusFulfillmentCase } from './manual-case';

const DEFAULT_LIMIT = 10;
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_DEADLINE_MS = 50_000;
/** One job can spend 2 x 15 s on the Central; do not start another past this. */
const MIN_JOB_BUDGET_MS = 35_000;

interface ClaimedJob {
  id: string;
  payment_id: string;
  workspace_id: string;
  attempt_count: number;
  max_attempts: number;
}

interface SourceRow extends EnrollmentSource {
  payment_status: string;
  sandbox_contact: boolean;
}

export interface EnrollmentWorkerResult {
  enabled: boolean;
  claimed: number;
  completed: number;
  retried: number;
  skipped: number;
  dead_lettered: number;
  lease_lost: number;
}

export interface EnrollmentWorkerInput {
  worker_id?: string;
  limit?: number;
  lease_seconds?: number;
  deadline_ms?: number;
  payment_id?: string;
  scoped?: boolean;
}

export interface EnrollmentWorkerDeps {
  sql?: postgres.Sql;
  config?: CentralCargaConfig;
  client?: CentralCargaClient;
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
  bonusConfig?: CentralCargaBonusConfig;
}

type Terminal = (
  | { kind: 'completed'; body: EnrollmentResponse }
  | { kind: 'retry'; code: string; delaySeconds?: number; body?: EnrollmentResponse }
  | { kind: 'skipped'; code: string }
  | { kind: 'dead_letter'; code: string; body?: EnrollmentResponse }
) & { paidOffering?: { code: string; display_name: string }; priorEvidence?: EnrollmentResponse };

/**
 * Leased worker that turns `fulfillment_jobs` into Central de Carga
 * enrollments. Safety order: do nothing unless explicitly enabled, never call
 * the Central for payments that are out of scope, always reconcile with GET
 * before re-POSTing, and fence every post-claim write on the exact claim
 * (status, worker and attempt) so a stale worker can never overwrite a newer
 * one. Errors never carry PII: logs and `last_error_*` hold codes only.
 */
export async function runEnrollmentWorker(
  input: EnrollmentWorkerInput = {},
  deps: EnrollmentWorkerDeps = {},
): Promise<EnrollmentWorkerResult> {
  const result: EnrollmentWorkerResult = {
    enabled: false, claimed: 0, completed: 0, retried: 0, skipped: 0, dead_lettered: 0, lease_lost: 0,
  };
  let config: CentralCargaConfig;
  try {
    config = deps.config ?? loadCentralCargaConfig();
  } catch (error) {
    // Enabled but misconfigured: claim nothing, alert.
    logger.error({
      event: 'central_carga.config_invalid',
      fields: error instanceof Error && 'fields' in error ? String((error as { fields: string }).fields) : 'unknown',
    });
    throw error;
  }
  if (!config.enabled) return result;
  result.enabled = true;
  const bonusConfig = deps.bonusConfig ?? loadCentralCargaBonusConfig();

  const sql = deps.sql ?? orchestratorSql;
  const workerId = input.worker_id ?? `central-carga-enrollment:${randomUUID()}`;
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 50);
  const leaseSeconds = Math.min(Math.max(input.lease_seconds ?? DEFAULT_LEASE_SECONDS, 60), 900);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const deadlineMs = input.deadline_ms ?? DEFAULT_DEADLINE_MS;
  const client = deps.client ?? new CentralCargaClient({
    baseUrl: config.baseUrl,
    signingSecret: config.signingSecret,
    fetchImpl: deps.fetchImpl,
    now,
  });
  const random = deps.random ?? Math.random;

  while (result.claimed < limit) {
    if (deadlineMs - (now() - startedAt) < MIN_JOB_BUDGET_MS) break;
    const claimed = input.scoped ? await sql<ClaimedJob[]>`
      SELECT id, payment_id, workspace_id, attempt_count, max_attempts
      FROM claim_central_enrollment_jobs(${workerId}, ${config.environment}, ${config.paidAfter},
        ${input.payment_id ?? null}::uuid, ${leaseSeconds})
    ` : await sql<ClaimedJob[]>`
      SELECT id, payment_id, workspace_id, attempt_count, max_attempts
      FROM claim_fulfillment_jobs(${workerId}, 1, ${leaseSeconds})
    `;
    const job = claimed[0];
    if (!job) break;
    result.claimed += 1;

    let terminal: Terminal;
    try {
      terminal = await decide(sql, job, config, bonusConfig, client, now);
    } catch (error) {
      // Unexpected local failure (DB read etc.): the Central outcome is
      // unknown, so retry rather than assume anything.
      terminal = { kind: 'retry', code: 'worker_error' };
      logger.error({
        event: 'central_carga.worker_error',
        payment_id: job.payment_id,
        job_id: job.id,
        error_name: error instanceof Error ? error.name : 'unknown',
      });
    }

    const applied = await settle(sql, job, workerId, terminal, random);
    if (!applied) {
      result.lease_lost += 1;
      logger.warn({ event: 'central_carga.lease_lost', payment_id: job.payment_id, job_id: job.id });
      continue;
    }
    if (applied.kind === 'completed') result.completed += 1;
    else if (applied.kind === 'retry') result.retried += 1;
    else if (applied.kind === 'skipped') result.skipped += 1;
    else result.dead_lettered += 1;
  }

  logger.info({ event: 'central_carga.worker_completed', worker_id: workerId, ...result });
  return result;
}

async function loadSource(sql: postgres.Sql, paymentId: string): Promise<SourceRow | null> {
  const rows = await sql<SourceRow[]>`
    SELECT
      p.id AS payment_id, p.workspace_id, p.contact_id, p.environment, p.provider,
      p.provider_session_id, p.paid_at, p.amount::text AS amount, p.currency,
      p.plan_code, p.status AS payment_status,
      COALESCE(p.registration_name, c.name) AS contact_name,
      COALESCE(p.registration_email, c.email) AS contact_email, c.phone AS contact_phone,
      c.declared_phone AS contact_declared_phone,
      COALESCE(e.offering_code_snapshot,o.code) AS offering_code,
      COALESCE(e.offering_display_name_snapshot,o.display_name) AS offering_display_name,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'code', bonus.offering_code_snapshot,
          'display_name', bonus.offering_display_name_snapshot,
          'promotion_code', bonus.promotion_code_snapshot,
          'position', bonus.position
        ) ORDER BY bonus.position)
        FROM payment_bonus_offerings bonus
        WHERE bonus.payment_id = p.id
      ), '[]'::jsonb) AS bonus_offerings,
      EXISTS (SELECT 1 FROM sandbox_identities s WHERE s.contact_id = c.id) AS sandbox_contact
    FROM payments p
    JOIN contacts c ON c.id = p.contact_id
    LEFT JOIN offerings o ON o.id = p.offering_id
    LEFT JOIN central_enrollments e ON e.payment_id=p.id
    WHERE p.id = ${paymentId}::uuid
  `;
  return rows[0] ?? null;
}

function fromOutcome(outcome: EnrollmentCallOutcome, onNotFound: Terminal | null): Terminal {
  switch (outcome.kind) {
    case 'success':
      return { kind: 'completed', body: outcome.body };
    case 'partial':
      return { kind: 'retry', code: 'partial_enrollment', body: outcome.body };
    case 'processing':
      return { kind: 'retry', code: 'enrollment_processing' };
    case 'retry':
      return { kind: 'retry', code: outcome.code, delaySeconds: outcome.retryAfterSeconds };
    case 'dead_letter':
      return { kind: 'dead_letter', code: outcome.code };
    case 'not_found':
      return onNotFound ?? { kind: 'dead_letter', code: 'http_404' };
  }
}

async function decide(
  sql: postgres.Sql,
  job: ClaimedJob,
  config: Extract<CentralCargaConfig, { enabled: true }>,
  bonusConfig: CentralCargaBonusConfig,
  client: CentralCargaClient,
  now: () => number,
): Promise<Terminal> {
  const source = await loadSource(sql, job.payment_id);
  if (!source) return { kind: 'dead_letter', code: 'payment_not_found' };
  if (source.bonus_offerings.length > 0
    && !isCentralCargaBonusFulfillmentAllowedForContact(bonusConfig, source.contact_id, source.contact_phone)) {
    return { kind: 'dead_letter', code: 'bonus_fulfillment_paused' };
  }

  const decision = preflight({
    source,
    paymentStatus: source.payment_status,
    sandboxContact: source.sandbox_contact && !(config.environment === 'test' && config.allowSandboxContacts),
    environment: config.environment,
    paidAfter: config.paidAfter,
  });
  if (decision.action === 'skip') return { kind: 'skipped', code: decision.code };
  if (decision.action === 'dead_letter') return { kind: 'dead_letter', code: decision.code };

  // An attempt beyond the cap (row created with the old default of 5) is
  // never executed.
  if (job.attempt_count > effectiveMaxAttempts(job.max_attempts)) {
    return { kind: 'dead_letter', code: 'max_attempts_exhausted' };
  }

  const request = buildEnrollmentRequest(source);
  if (!request.success) {
    logger.error({
      event: 'central_carga.invalid_request',
      payment_id: job.payment_id,
      invalid_fields: issuePaths(request.error),
    });
    return { kind: 'dead_letter', code: 'invalid_enrollment_request' };
  }
  const withSnapshot = (terminal: Terminal): Terminal => ({ ...terminal, paidOffering: request.data.offering });

  let recoveryBody: EnrollmentResponse | undefined;
  let retryCodes: string[] | undefined;
  if (job.attempt_count > 1) {
    // Previous attempt may have reached the Central (timeout, lost response).
    const expectedBonusCodes = request.data.schema_version === 2
      ? request.data.bonus_offerings.map((offering) => offering.code)
      : [];
    const existing = await client.getEnrollment(job.payment_id, expectedBonusCodes);
    if (existing.kind === 'partial') recoveryBody = existing.body;
    if (existing.kind === 'success' || existing.kind === 'processing'
      || existing.kind === 'retry' || existing.kind === 'dead_letter') {
      return withSnapshot(fromOutcome(existing, null));
    }
    if (request.data.schema_version === 2) {
      const verified = await sql<Array<{ offering_code: string }>>`
        SELECT offering_code FROM central_bonus_enrollment_items WHERE payment_id=${job.payment_id}::uuid
      `;
      const [paid] = await sql`SELECT id FROM central_enrollments WHERE payment_id=${job.payment_id}::uuid
        AND enrollment_status IN ('active','already_enrolled')`;
      const active = new Set(verified.map((item) => item.offering_code));
      if (paid) active.add(request.data.offering.code);
      if (recoveryBody) {
        if (recoveryBody.enrollment_status !== 'processing') active.add(request.data.offering.code);
        if ('bonus_enrollments' in recoveryBody) for (const item of recoveryBody.bonus_enrollments) {
          if (['active', 'already_enrolled'].includes(item.enrollment_status)) active.add(item.offering_code);
        }
      }
      if (recoveryBody || active.size > 0) {
        if (!recoveryBody || !('supports_partial_recovery' in recoveryBody) || !recoveryBody.supports_partial_recovery) {
          return withSnapshot({ kind: 'dead_letter', code: 'partial_recovery_unsupported', body: recoveryBody });
        }
        retryCodes = [request.data.offering.code, ...expectedBonusCodes].filter((code) => !active.has(code));
        if (retryCodes.length === 0) {
          return withSnapshot({ kind: 'retry', code: 'enrollment_reconciliation_pending', body: recoveryBody });
        }
      }
    }
    // 404: nothing completed there; the POST is idempotent, so it is safe.
  }
  // Resolve immediately before POST, including retries that cross the expiry.
  // GET reconciliation above remains available after expiry for an already-created account.
  const bridge = sandboxLiveBridgeState({
    paymentEnvironment: source.environment,
    workerEnvironment: config.environment,
    until: config.sandboxLiveUntil,
    now: now(),
  });
  if (bridge === 'expired') return withSnapshot({ kind: 'dead_letter', code: 'sandbox_live_bridge_expired', body: recoveryBody });
  const recoveryRequest = request.data.schema_version === 2 && retryCodes
    ? { ...request.data, retry_offering_codes: retryCodes } : request.data;
  const outbound = bridge === 'active' ? { ...recoveryRequest, environment: 'live' as const } : recoveryRequest;
  if (bridge === 'active') {
    await sql`
      INSERT INTO payment_events (payment_id, provider, provider_event_id, event_type, payload)
      VALUES (${source.payment_id}::uuid, 'internal',
        ${`internal:sandbox_live_enrollment:${source.payment_id}:${job.attempt_count}`},
        'sandbox_live_enrollment_requested', ${jsonbParam(sql, {
          payment_environment: source.environment,
          central_environment: outbound.environment,
          expires_at: config.sandboxLiveUntil!.toISOString(),
          job_id: job.id,
          attempt_count: job.attempt_count,
        })})
      ON CONFLICT (provider, provider_event_id) DO NOTHING
    `;
    if (now() >= config.sandboxLiveUntil!.getTime()) {
      return withSnapshot({ kind: 'dead_letter', code: 'sandbox_live_bridge_expired', body: recoveryBody });
    }
    logger.warn({
      event: 'central_carga.sandbox_live_bridge_used',
      payment_id: source.payment_id,
      payment_environment: source.environment,
      central_environment: outbound.environment,
      expires_at: config.sandboxLiveUntil!.toISOString(),
    });
  }
  const outcome = fromOutcome(await client.createEnrollment(outbound), null);
  // GET evidence survives a subsequent POST timeout or permanent failure.
  if (recoveryBody && (outcome.kind === 'retry' || outcome.kind === 'dead_letter') && !outcome.body) {
    outcome.body = recoveryBody;
  }
  return withSnapshot({ ...outcome, priorEvidence: recoveryBody });
}

/**
 * Fenced transition. Every write requires the job to still be the exact claim
 * this worker took; 0 affected rows means someone else owns it and nothing
 * else is written.
 */
async function settle(
  sql: postgres.Sql,
  job: ClaimedJob,
  workerId: string,
  outcome: Terminal,
  random: () => number,
): Promise<Terminal | null> {
  return sql.begin(async (tx) => {
    const scoped = tx as unknown as postgres.Sql;
    const [owned] = await tx`
      SELECT id FROM fulfillment_jobs WHERE id=${job.id}::uuid AND status='leased'
        AND leased_by=${workerId} AND attempt_count=${job.attempt_count} FOR UPDATE
    `;
    if (!owned) return null;
    if (outcome.priorEvidence) await persistEvidence(scoped, job, outcome.priorEvidence, outcome.paidOffering!);
    if ('body' in outcome && outcome.body) await persistEvidence(scoped, job, outcome.body, outcome.paidOffering!);
    const applied = await settleStatus(scoped, job, workerId, outcome, random);
    if (applied?.kind === 'dead_letter') await openBonusFulfillmentCase(scoped, job.payment_id, applied.code);
    return applied;
  }) as Promise<Terminal | null>;
}

async function persistEvidence(tx: postgres.Sql, job: ClaimedJob, body: EnrollmentResponse,
  paidOffering: { code: string; display_name: string }) {
  await tx`
    INSERT INTO central_enrollments (
      payment_id, workspace_id, enrollment_id, student_id, enrollment_status,
      student_was_created, welcome_sent, login_email, central_created_at, login_url,
      offering_code_snapshot,offering_display_name_snapshot
    ) VALUES (
      ${job.payment_id}::uuid, ${job.workspace_id}::uuid, ${body.enrollment_id},
      ${body.student_id}, ${body.enrollment_status}, ${body.student_was_created},
      ${body.access.welcome_sent}, ${body.access.login_email}, ${body.created_at ?? null},
      ${body.access.login_url ?? null},
      ${paidOffering.code},${paidOffering.display_name}
    ) ON CONFLICT (payment_id) DO UPDATE SET
      enrollment_status=EXCLUDED.enrollment_status,welcome_sent=EXCLUDED.welcome_sent,
      login_email=EXCLUDED.login_email,login_url=EXCLUDED.login_url
      WHERE central_enrollments.enrollment_status='processing'
  `;
  if ('bonus_enrollments' in body) {
    for (const bonus of body.bonus_enrollments) {
      if (!['active', 'already_enrolled'].includes(bonus.enrollment_status)) continue;
      await tx`
        INSERT INTO central_bonus_enrollment_items (central_enrollment_id,payment_id,offering_code,enrollment_status,position)
        SELECT e.id,e.payment_id,s.offering_code_snapshot,${bonus.enrollment_status},s.position
        FROM central_enrollments e JOIN payment_bonus_offerings s ON s.payment_id=e.payment_id
        WHERE e.payment_id=${job.payment_id}::uuid AND s.offering_code_snapshot=${bonus.offering_code}
        ON CONFLICT (payment_id,offering_code) DO NOTHING
      `;
    }
  }
}

async function settleStatus(
  sql: postgres.Sql, job: ClaimedJob, workerId: string, outcome: Terminal, random: () => number,
): Promise<Terminal | null> {
  let terminal = outcome;
  // Retry budget exhausted: escalate instead of rescheduling.
  if (terminal.kind === 'retry' && job.attempt_count >= effectiveMaxAttempts(job.max_attempts)) {
    terminal = { kind: 'dead_letter', code: `max_attempts_exhausted:${terminal.code}`.slice(0, 80) };
  }

  const detail = (code: string) => `code=${code} attempt=${job.attempt_count}`;
  let fenced: Array<{ id: string }>;

  if (terminal.kind === 'completed') {
    const body = terminal.body;
    const rows = await sql<Array<{ id: string }>>`
        UPDATE fulfillment_jobs
        SET status = 'completed', completed_at = now(), lease_until = NULL, leased_by = NULL,
            last_error_code = NULL, last_error_detail = NULL
        WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${workerId}
          AND attempt_count = ${job.attempt_count}
        RETURNING id
      `;
    if (rows.length === 0) return null;
    logger.info({
      event: 'central_carga.enrollment_completed',
      payment_id: job.payment_id,
      attempt: job.attempt_count,
      enrollment_status: body.enrollment_status,
    });
    return terminal;
  }

  if (terminal.kind === 'retry') {
    const delay = terminal.delaySeconds ?? computeBackoffSeconds(job.attempt_count, random);
    fenced = await sql<Array<{ id: string }>>`
      UPDATE fulfillment_jobs
      SET status = 'failed_retryable', available_at = now() + make_interval(secs => ${delay}),
          lease_until = NULL, leased_by = NULL,
          last_error_code = ${terminal.code}, last_error_detail = ${detail(terminal.code)}
      WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${workerId}
        AND attempt_count = ${job.attempt_count}
      RETURNING id
    `;
    if (fenced.length === 0) return null;
    logger.warn({
      event: 'central_carga.enrollment_retry',
      payment_id: job.payment_id,
      attempt: job.attempt_count,
      code: terminal.code,
      delay_seconds: delay,
    });
    return terminal;
  }

  if (terminal.kind === 'skipped') {
    fenced = await sql<Array<{ id: string }>>`
      UPDATE fulfillment_jobs
      SET status = 'skipped', lease_until = NULL, leased_by = NULL,
          last_error_code = ${terminal.code}, last_error_detail = ${detail(terminal.code)}
      WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${workerId}
        AND attempt_count = ${job.attempt_count}
      RETURNING id
    `;
    if (fenced.length === 0) return null;
    logger.info({
      event: 'central_carga.enrollment_skipped',
      payment_id: job.payment_id,
      code: terminal.code,
    });
    return terminal;
  }

  fenced = await sql<Array<{ id: string }>>`
    UPDATE fulfillment_jobs
    SET status = 'dead_letter', lease_until = NULL, leased_by = NULL,
        last_error_code = ${terminal.code}, last_error_detail = ${detail(terminal.code)}
    WHERE id = ${job.id}::uuid AND status = 'leased' AND leased_by = ${workerId}
      AND attempt_count = ${job.attempt_count}
    RETURNING id
  `;
  if (fenced.length === 0) return null;
  // The enclosing fenced transaction persists a bonus human case as well.
  // Logs remain codes and identifiers only.
  logger.error({
    event: 'central_carga.enrollment_dead_letter',
    payment_id: job.payment_id,
    job_id: job.id,
    workspace_id: job.workspace_id,
    attempt: job.attempt_count,
    code: terminal.code,
    action_required: 'human_enrollment',
  });
  return terminal;
}
