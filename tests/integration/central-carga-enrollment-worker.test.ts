import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  openIndependentLocalTestDatabases,
  openLocalTestDatabase,
} from '../helpers/db';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import type { CentralCargaConfig } from '@/features/fulfillment/central-carga/config';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const CUTOFF = new Date('2026-10-01T00:00:00Z');
const config: CentralCargaConfig = {
  enabled: true,
  baseUrl: 'https://central.test/central-carga',
  signingSecret: 'integration-secret-0123456789',
  environment: 'live',
  paidAfter: CUTOFF,
};

interface Call { method: string; url: string; paymentId: string; body?: Record<string, unknown> }
type Responder = (call: Call, n: number) => Response | Promise<Response>;

function mockCentral(responders: Responder[] | Responder) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string, init: RequestInit) => {
    const url = String(input);
    const call: Call = {
      method: String(init.method),
      url,
      paymentId: new URL(url).pathname.split('/').filter(Boolean).slice(-1)[0] === 'enrollments'
        ? String((init.headers as Record<string, string>)['idempotency-key'])
        : new URL(url).pathname.split('/').pop()!,
      ...(init.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
    };
    calls.push(call);
    const responder = Array.isArray(responders)
      ? responders[Math.min(calls.length - 1, responders.length - 1)]
      : responders;
    return responder(call, calls.length);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const body = (paymentId: string, overrides: Record<string, unknown> = {}) => ({
  payment_id: paymentId,
  enrollment_id: 'enr_1',
  student_id: 'stu_1',
  enrollment_status: 'active',
  student_was_created: true,
  access: { login_email: 'alumno@example.com', welcome_sent: true },
  created_at: '2026-10-06T14:03:15Z',
  ...overrides,
});
const json = (status: number, payload: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), { status, headers });
const created = (call: Call) => json(201, body(call.paymentId));
const status = (code: number, errorCode = 'x') => json(code, { error: { code: errorCode, retryable: false } });
const timeout = () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };

async function fixture(options: {
  provider?: 'stripe' | 'fake';
  environment?: 'test' | 'live';
  paidAt?: string;
  name?: string | null;
  email?: string | null;
  maxAttempts?: number;
  declaredPhone?: string | null;
  bonusCourses?: Array<{ code: string; displayName: string; position: number }>;
} = {}) {
  const [workspace] = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name) VALUES (${`enr-${randomUUID().slice(0, 8)}`}, 'Enroll') RETURNING id`;
  const [contact] = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, status, channel_origin, name, email, declared_phone)
    VALUES (${`+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`}, 'prospecto', 'whatsapp',
      ${options.name === undefined ? 'Alumno Prueba' : options.name},
      ${options.email === undefined ? `Alumno-${randomUUID().slice(0, 8)}@Example.com` : options.email},
      ${options.declaredPhone ?? null})
    RETURNING id`;
  const [offering] = await db!<Array<{ id: string }>>`
    INSERT INTO offerings (workspace_id, code, display_name, offering_type, status, description,
      price_type, price_amount, currency, billing_interval)
    VALUES (${workspace.id}::uuid, ${`OFF-${randomUUID().slice(0, 8)}`}, 'Curso', 'course', 'active', 'd',
      'fixed', '45000.00', 'ARS', 'one_time') RETURNING id`;
  const provider = options.provider ?? 'stripe';
  const environment = options.environment ?? 'live';
  const bonusRows: Array<{ id: string; code: string; display_name: string; position: number }> = [];
  let promotion: { id: string; promotion_code: string } | undefined;
  if (options.bonusCourses?.length) {
    [promotion] = await db!<Array<{ id: string; promotion_code: string }>>`
      INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
      VALUES (${workspace.id}::uuid,${`promo-${randomUUID().slice(0, 8)}`},${offering.id}::uuid,
        ARRAY['text']::text[],true) RETURNING id,promotion_code`;
    for (const bonus of options.bonusCourses) {
      const [bonusOffering] = await db!<Array<{ id: string; code: string; display_name: string }>>`
        INSERT INTO offerings (workspace_id, code, display_name, offering_type, status, description,
          price_type, price_amount, currency, billing_interval)
        VALUES (${workspace.id}::uuid,${bonus.code},${bonus.displayName},'course','active','bonus',
          'free',NULL,NULL,NULL) RETURNING id,code,display_name`;
      await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
        VALUES (${promotion.id}::uuid,${workspace.id}::uuid,${bonusOffering.id}::uuid,${bonus.position})`;
      bonusRows.push({ ...bonusOffering, position: bonus.position });
    }
  }
  const [payment] = await db!<Array<{ id: string }>>`
    INSERT INTO payments (workspace_id, contact_id, offering_id, amount, currency, status, provider,
      environment, checkout_mode, idempotency_key, provider_session_id, paid_at, plan_code)
    VALUES (${workspace.id}::uuid, ${contact.id}::uuid, ${offering.id}::uuid, '45000.00', 'ARS',
      ${bonusRows.length ? 'reserved' : 'paid'},
      ${provider}, ${environment}, 'payment', ${randomUUID()}, ${`cs_${randomUUID()}`},
      ${bonusRows.length ? null : options.paidAt ?? '2026-10-06T14:00:00Z'}::timestamptz, 'monthly_12')
    RETURNING id`;
  if (promotion) {
    for (const bonus of bonusRows) await db!`
      INSERT INTO payment_bonus_offerings(payment_id,promotion_id,offering_id,promotion_code_snapshot,
        offering_code_snapshot,offering_display_name_snapshot,position)
      VALUES (${payment.id}::uuid,${promotion.id}::uuid,${bonus.id}::uuid,${promotion.promotion_code},
        ${bonus.code},${bonus.display_name},${bonus.position})`;
    await db!`UPDATE payments SET status='creating_checkout' WHERE id=${payment.id}::uuid`;
    await db!`UPDATE payments SET status='pending' WHERE id=${payment.id}::uuid`;
    await db!`UPDATE payments SET status='paid',paid_at=${options.paidAt ?? '2026-10-06T14:00:00Z'}::timestamptz
      WHERE id=${payment.id}::uuid`;
  }
  const [job] = await db!<Array<{ id: string }>>`
    INSERT INTO fulfillment_jobs (payment_id, workspace_id, max_attempts)
    VALUES (${payment.id}::uuid, ${workspace.id}::uuid, ${options.maxAttempts ?? 3}) RETURNING id`;
  return { paymentId: payment.id, jobId: job.id, workspaceId: workspace.id, contactId: contact.id,
    bonusCodes: bonusRows.sort((a,b)=>a.position-b.position).map((row)=>row.code) };
}

async function job(id: string) {
  const rows = await db!<Array<{
    status: string; attempt_count: number; last_error_code: string | null; leased_by: string | null;
    available_at: Date;
  }>>`SELECT status, attempt_count, last_error_code, leased_by, available_at FROM fulfillment_jobs WHERE id = ${id}::uuid`;
  return rows[0];
}
const enrollments = async (paymentId: string) =>
  db!<Array<{ enrollment_id: string; student_id: string; login_email: string; welcome_sent: boolean }>>`
    SELECT enrollment_id, student_id, login_email, welcome_sent FROM central_enrollments WHERE payment_id = ${paymentId}::uuid`;
const bonusEnrollments = async (paymentId: string) =>
  db!<Array<{ offering_code: string; enrollment_status: string; position: number }>>`
    SELECT offering_code,enrollment_status,position FROM central_bonus_enrollment_items
    WHERE payment_id=${paymentId}::uuid ORDER BY position`;
const makeDue = (id: string) =>
  db!`UPDATE fulfillment_jobs SET available_at = now() - interval '1 second' WHERE id = ${id}::uuid`;
const work = (fetchImpl: typeof fetch, workerId = `w-${randomUUID().slice(0, 6)}`, cfg: CentralCargaConfig = config) =>
  runEnrollmentWorker({ worker_id: workerId, limit: 10 }, { sql: db!, config: cfg, fetchImpl });

beforeEach(async () => {
  if (!db) return;
  await db`DELETE FROM fulfillment_jobs`;
});

run('Central de Carga enrollment worker', () => {
  const bridgeUntil = new Date('2026-10-10T03:00:00Z');
  const bridgeConfig: CentralCargaConfig = { ...config, enabled: true, environment: 'test',
    sandboxLiveUntil: bridgeUntil };
  it('temporarily sends a paid sandbox enrollment as live without rewriting the payment or its session', async () => {
    const f = await fixture({ environment: 'test' });
    const [original] = await db!`SELECT provider_session_id FROM payments WHERE id=${f.paymentId}::uuid`;
    let outbound: Record<string, unknown> | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      outbound = JSON.parse(String(init.body));
      expect((init.headers as Record<string, string>)['idempotency-key']).toBe(f.paymentId);
      expect(outbound).toMatchObject({ payment_id: f.paymentId, environment: 'live',
        payment: { provider_session_id: original.provider_session_id } });
      return json(201, body(f.paymentId));
    }) as unknown as typeof fetch;
    const result = await runEnrollmentWorker({ scoped: true, payment_id: f.paymentId },
      { sql: db!, config: bridgeConfig, fetchImpl, now: () => bridgeUntil.getTime()-1 });
    expect(result.completed).toBe(1);
    const [payment] = await db!`SELECT environment,status,provider_session_id FROM payments WHERE id=${f.paymentId}::uuid`;
    expect(payment).toMatchObject({ environment: 'test', status: 'paid', provider_session_id: original.provider_session_id });
    const [event] = await db!`SELECT provider,event_type,payload FROM payment_events
      WHERE payment_id=${f.paymentId}::uuid AND event_type='sandbox_live_enrollment_requested'`;
    expect(event).toMatchObject({ provider: 'internal', payload: { payment_environment: 'test', central_environment: 'live',
      expires_at: bridgeUntil.toISOString(), attempt_count: 1 } });
    expect(await enrollments(f.paymentId)).toHaveLength(1);
  });

  it('does not POST new sandbox enrollments at or after expiry', async () => {
    const f = await fixture({ environment: 'test' });
    const central = mockCentral(created);
    const result = await runEnrollmentWorker({ scoped: true, payment_id: f.paymentId },
      { sql: db!, config: bridgeConfig, fetchImpl: central.fetchImpl, now: () => bridgeUntil.getTime() });
    expect(result.dead_lettered).toBe(1);
    expect(central.calls).toHaveLength(0);
    expect(await job(f.jobId)).toMatchObject({ last_error_code: 'sandbox_live_bridge_expired' });
  });

  it('reconciles an already-created enrollment after expiry without another POST', async () => {
    const f = await fixture({ environment: 'test' });
    await db!`UPDATE fulfillment_jobs SET attempt_count=1 WHERE id=${f.jobId}::uuid`;
    const central = mockCentral(call => json(200, body(call.paymentId)));
    const result = await runEnrollmentWorker({ scoped: true, payment_id: f.paymentId },
      { sql: db!, config: bridgeConfig, fetchImpl: central.fetchImpl, now: () => bridgeUntil.getTime()+1 });
    expect(result.completed).toBe(1);
    expect(central.calls.map(c=>c.method)).toEqual(['GET']);
  });

  it('does not recreate a missing enrollment after expiry when reconciling a retry', async () => {
    const f = await fixture({ environment: 'test' });
    await db!`UPDATE fulfillment_jobs SET attempt_count=1 WHERE id=${f.jobId}::uuid`;
    const central = mockCentral(() => status(404, 'not_found'));
    const result = await runEnrollmentWorker({ scoped: true, payment_id: f.paymentId },
      { sql: db!, config: bridgeConfig, fetchImpl: central.fetchImpl, now: () => bridgeUntil.getTime()+1 });
    expect(result.dead_lettered).toBe(1);
    expect(central.calls.map(c=>c.method)).toEqual(['GET']);
    expect(await job(f.jobId)).toMatchObject({ last_error_code: 'sandbox_live_bridge_expired' });
  });

  it('claims nothing while the feature flag is off', async () => {
    const f = await fixture();
    const central = mockCentral(created);
    const result = await work(central.fetchImpl, 'w-off', { enabled: false });
    expect(result).toMatchObject({ enabled: false, claimed: 0 });
    expect(central.calls).toHaveLength(0);
    expect(await job(f.jobId)).toMatchObject({ status: 'pending', attempt_count: 0 });
  });

  it('enrolls a paid payment: one POST, job completed, result persisted', async () => {
    const f = await fixture({ declaredPhone: '+5491100001111' });
    const central = mockCentral((call) => json(201, body(call.paymentId)));
    const result = await work(central.fetchImpl);
    expect(result).toMatchObject({ claimed: 1, completed: 1 });
    expect(central.calls.map((c) => c.method)).toEqual(['POST']);
    expect(central.calls[0].url).toBe('https://central.test/central-carga/api/v1/enrollments');
    expect(await job(f.jobId)).toMatchObject({ status: 'completed', attempt_count: 1, last_error_code: null });
    expect(await enrollments(f.paymentId)).toEqual([
      { enrollment_id: 'enr_1', student_id: 'stu_1', login_email: 'alumno@example.com', welcome_sent: true },
    ]);
  });

  it('sends one deterministic v2 request and stores only an exact complete bonus result', async () => {
    const f = await fixture({ bonusCourses: [
      { code: `BONUS-B-${randomUUID().slice(0, 6)}`, displayName: 'Bonus B', position: 2 },
      { code: `BONUS-A-${randomUUID().slice(0, 6)}`, displayName: 'Bonus A', position: 1 },
    ] });
    const central = mockCentral((call) => json(201, body(call.paymentId, {
      bonus_enrollments: f.bonusCodes.map((offering_code) => ({ offering_code, enrollment_status: 'active' })),
    })));
    expect(await runEnrollmentWorker({}, { sql: db!, config, fetchImpl: central.fetchImpl,
      bonusConfig: { enabled: false, fulfillmentPaused: false } })).toMatchObject({ completed: 1 });
    expect(central.calls).toHaveLength(1);
    expect(central.calls[0].body).toMatchObject({
      schema_version: 2,
      bonus_offerings: f.bonusCodes.map((code) => ({ code })),
    });
    expect(await bonusEnrollments(f.paymentId)).toEqual(f.bonusCodes.map((offering_code, index) => ({
      offering_code, enrollment_status: 'active', position: index + 1,
    })));
    expect((await enrollments(f.paymentId))[0].welcome_sent).toBe(true);
  });

  it('persists the immutable snapshot position instead of inventing an array index', async () => {
    const code = `BONUS-GAP-${randomUUID().slice(0, 6)}`;
    const f = await fixture({ bonusCourses: [{ code, displayName: 'Bonus gap', position: 2 }] });
    const central = mockCentral((call) => json(201, body(call.paymentId, {
      bonus_enrollments: [{ offering_code: code, enrollment_status: 'active' }],
    })));
    expect(await work(central.fetchImpl)).toMatchObject({ completed: 1 });
    expect(await bonusEnrollments(f.paymentId)).toEqual([{
      offering_code:code,enrollment_status:'active',position:2,
    }]);
  });

  it('does not complete a v2 job when Central omits, adds, duplicates or leaves a bonus non-active', async () => {
    for (const variant of ['missing','extra','duplicate','processing'] as const) {
      const f = await fixture({ bonusCourses: [
        { code: `BONUS-${variant}-${randomUUID().slice(0, 6)}`, displayName: 'Bonus', position: 1 },
      ] });
      const code = f.bonusCodes[0];
      const bonus_enrollments = variant === 'missing' ? []
        : variant === 'extra' ? [{ offering_code: code, enrollment_status: 'active' }, { offering_code: 'EXTRA', enrollment_status: 'active' }]
          : variant === 'duplicate' ? [{ offering_code: code, enrollment_status: 'active' }, { offering_code: code, enrollment_status: 'active' }]
            : [{ offering_code: code, enrollment_status: 'processing' }];
      const central = mockCentral((call) => json(201, body(call.paymentId, { bonus_enrollments })));
      expect(await work(central.fetchImpl)).toMatchObject({ completed: 0, retried: 1 });
      expect(await job(f.jobId)).toMatchObject({ last_error_code: 'invalid_bonus_response' });
      expect(await enrollments(f.paymentId)).toHaveLength(0);
      expect(await bonusEnrollments(f.paymentId)).toHaveLength(0);
    }
  });

  it('reconciles a partial v2 failure with GET/POST using the identical frozen set', async () => {
    const f = await fixture({ bonusCourses: [
      { code: `BONUS-RESUME-${randomUUID().slice(0, 6)}`, displayName: 'Bonus Resume', position: 1 },
    ] });
    expect(await work(mockCentral(timeout).fetchImpl)).toMatchObject({ retried: 1 });
    await makeDue(f.jobId);
    const second = mockCentral([
      () => status(404, 'not_found'),
      (call) => json(200, body(call.paymentId, { bonus_enrollments: f.bonusCodes.map((offering_code) => ({
        offering_code, enrollment_status: 'active',
      })) })),
    ]);
    expect(await work(second.fetchImpl)).toMatchObject({ completed: 1 });
    expect(second.calls.map((call) => call.method)).toEqual(['GET','POST']);
    expect(second.calls[1].body).toMatchObject({ schema_version: 2,
      bonus_offerings: f.bonusCodes.map((code) => ({ code })) });
    expect(await bonusEnrollments(f.paymentId)).toHaveLength(1);
  });

  it.each(['unknown_offering','unsupported_schema_version'])('dead-letters Central v2 %s explicitly', async (errorCode) => {
    const f = await fixture({ bonusCourses: [
      { code: `BONUS-ERROR-${randomUUID().slice(0, 6)}`, displayName: 'Bonus Error', position: 1 },
    ] });
    expect(await work(mockCentral(() => status(422, errorCode)).fetchImpl)).toMatchObject({ dead_lettered: 1 });
    expect(await job(f.jobId)).toMatchObject({ last_error_code: `central_${errorCode}` });
  });

  it('halts an already-paid bonus obligation only under the explicit fulfillment pause', async () => {
    const f = await fixture({ bonusCourses: [
      { code: `BONUS-PAUSE-${randomUUID().slice(0, 6)}`, displayName: 'Bonus Pause', position: 1 },
    ] });
    const central = mockCentral(created);
    expect(await runEnrollmentWorker({}, { sql: db!, config, fetchImpl: central.fetchImpl,
      bonusConfig: { enabled: true, fulfillmentPaused: true } })).toMatchObject({ dead_lettered: 1 });
    expect(central.calls).toHaveLength(0);
    expect(await job(f.jobId)).toMatchObject({ last_error_code: 'bonus_fulfillment_paused' });
  });

  it('lets the exact canary contact fulfill a paid bonus while the global pause protects everyone else', async () => {
    const f = await fixture({ bonusCourses: [
      { code: `BONUS-CANARY-${randomUUID().slice(0, 6)}`, displayName: 'Bonus Canary', position: 1 },
    ] });
    const central = mockCentral((call) => json(201, body(call.paymentId, {
      bonus_enrollments: f.bonusCodes.map((offering_code) => ({ offering_code, enrollment_status: 'active' })),
    })));

    expect(await runEnrollmentWorker({}, { sql: db!, config, fetchImpl: central.fetchImpl,
      bonusConfig: {
        enabled: false,
        fulfillmentPaused: true,
        canaryContactIds: [f.contactId],
      },
    })).toMatchObject({ completed: 1, dead_lettered: 0 });
    expect(central.calls.map((call) => call.method)).toEqual(['POST']);
  });

  it('two concurrent workers never take the same job', async () => {
    const fixtures = await Promise.all(Array.from({ length: 6 }, () => fixture()));
    const central = mockCentral(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return json(201, body(call.paymentId));
    });
    const [a, b] = openIndependentLocalTestDatabases(2);
    try {
      const results = await Promise.all([
        runEnrollmentWorker({ worker_id: 'w-a', limit: 10 }, { sql: a, config, fetchImpl: central.fetchImpl }),
        runEnrollmentWorker({ worker_id: 'w-b', limit: 10 }, { sql: b, config, fetchImpl: central.fetchImpl }),
      ]);
      expect(results[0].completed + results[1].completed).toBe(6);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
    const posted = central.calls.map((c) => c.paymentId);
    expect(new Set(posted).size).toBe(6);
    expect(posted).toHaveLength(6);
    for (const f of fixtures) expect((await job(f.jobId)).status).toBe('completed');
  });

  it('fences a stale worker: a lease taken over mid-request cannot complete or write results', async () => {
    const f = await fixture();
    const central = mockCentral(async (call) => {
      // While worker A is "in flight", its lease expires and B claims the job.
      await db!`UPDATE fulfillment_jobs SET lease_until = now() - interval '1 second' WHERE id = ${f.jobId}::uuid`;
      await db!`SELECT * FROM claim_fulfillment_jobs('w-b', 1, 120)`;
      return json(201, body(call.paymentId));
    });
    const result = await work(central.fetchImpl, 'w-a');
    expect(result).toMatchObject({ claimed: 1, completed: 0, lease_lost: 1 });
    expect(await job(f.jobId)).toMatchObject({ status: 'leased', leased_by: 'w-b', attempt_count: 2 });
    expect(await enrollments(f.paymentId)).toHaveLength(0);
  });

  it('skips payments paid before the cutoff without calling the Central', async () => {
    const f = await fixture({ paidAt: '2026-09-30T23:59:59Z' });
    const central = mockCentral(created);
    expect(await work(central.fetchImpl)).toMatchObject({ skipped: 1 });
    expect(central.calls).toHaveLength(0);
    expect(await job(f.jobId)).toMatchObject({ status: 'skipped', last_error_code: 'before_enrollment_cutoff' });
  });

  it('skips environment mismatches and the fake provider without calling the Central', async () => {
    const mismatch = await fixture({ environment: 'test' });
    const fake = await fixture({ provider: 'fake' });
    const central = mockCentral(created);
    expect(await work(central.fetchImpl)).toMatchObject({ skipped: 2 });
    expect(central.calls).toHaveLength(0);
    expect(await job(mismatch.jobId)).toMatchObject({ status: 'skipped', last_error_code: 'environment_mismatch' });
    expect(await job(fake.jobId)).toMatchObject({ status: 'skipped', last_error_code: 'unsupported_provider' });
  });

  it('skips a sandbox contact without calling the Central', async () => {
    const f = await fixture();
    const [contact] = await db!<Array<{ id: string }>>`
      SELECT contact_id AS id FROM payments WHERE id = ${f.paymentId}::uuid`;
    const synthetic = `+999${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await db!`UPDATE contacts SET phone = ${synthetic} WHERE id = ${contact.id}::uuid`;
    await db!`INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
      VALUES ('telegram_sandbox', ${randomUUID()}, ${contact.id}::uuid, ${synthetic})`;
    const central = mockCentral(created);
    expect(await work(central.fetchImpl)).toMatchObject({ skipped: 1 });
    expect(central.calls).toHaveLength(0);
    expect(await job(f.jobId)).toMatchObject({ status: 'skipped', last_error_code: 'sandbox_contact' });
    await db!`DELETE FROM sandbox_identities WHERE contact_id = ${contact.id}::uuid`;
  });

  it('dead-letters a missing student identity without calling the Central', async () => {
    const noEmail = await fixture({ email: null });
    const noName = await fixture({ name: null });
    const central = mockCentral(created);
    expect(await work(central.fetchImpl)).toMatchObject({ dead_lettered: 2 });
    expect(central.calls).toHaveLength(0);
    for (const f of [noEmail, noName]) {
      expect(await job(f.jobId)).toMatchObject({ status: 'dead_letter', last_error_code: 'missing_student_identity' });
    }
  });

  it('409 goes straight to dead_letter after a single call', async () => {
    const f = await fixture();
    const central = mockCentral(() => status(409, 'idempotency_conflict'));
    expect(await work(central.fetchImpl)).toMatchObject({ dead_lettered: 1 });
    expect(central.calls).toHaveLength(1);
    expect(await job(f.jobId)).toMatchObject({
      status: 'dead_letter', attempt_count: 1, last_error_code: 'central_idempotency_conflict',
    });
    expect(await enrollments(f.paymentId)).toHaveLength(0);
  });

  it('503 is retried with backoff and then succeeds (GET 404 precedes the retry POST)', async () => {
    const f = await fixture();
    const first = mockCentral(() => status(503));
    expect(await work(first.fetchImpl)).toMatchObject({ retried: 1 });
    const afterFailure = await job(f.jobId);
    expect(afterFailure).toMatchObject({ status: 'failed_retryable', attempt_count: 1, last_error_code: 'http_503' });
    expect(afterFailure.available_at.getTime()).toBeGreaterThan(Date.now());

    // Not yet due: nothing is claimed.
    const idle = mockCentral(created);
    expect(await work(idle.fetchImpl)).toMatchObject({ claimed: 0 });

    await makeDue(f.jobId);
    const second = mockCentral([() => status(404, 'not_found'), created]);
    expect(await work(second.fetchImpl)).toMatchObject({ completed: 1 });
    expect(second.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(await job(f.jobId)).toMatchObject({ status: 'completed', attempt_count: 2 });
    expect(await enrollments(f.paymentId)).toHaveLength(1);
  });

  it('timeout then GET 200 completes without a second POST', async () => {
    const f = await fixture();
    const first = mockCentral(timeout);
    expect(await work(first.fetchImpl)).toMatchObject({ retried: 1 });
    expect(await job(f.jobId)).toMatchObject({ status: 'failed_retryable', last_error_code: 'timeout' });

    await makeDue(f.jobId);
    const second = mockCentral((call) => json(200, body(call.paymentId, { enrollment_id: 'enr_found' })));
    expect(await work(second.fetchImpl)).toMatchObject({ completed: 1 });
    expect(second.calls.map((c) => c.method)).toEqual(['GET']);
    expect(await job(f.jobId)).toMatchObject({ status: 'completed', attempt_count: 2 });
    expect((await enrollments(f.paymentId))[0].enrollment_id).toBe('enr_found');
  });

  it('GET 202 reschedules without a POST', async () => {
    const f = await fixture();
    await work(mockCentral(timeout).fetchImpl);
    await makeDue(f.jobId);
    const central = mockCentral((call) => json(202, body(call.paymentId, { enrollment_status: 'processing' })));
    expect(await work(central.fetchImpl)).toMatchObject({ retried: 1 });
    expect(central.calls.map((c) => c.method)).toEqual(['GET']);
    expect(await job(f.jobId)).toMatchObject({ status: 'failed_retryable', last_error_code: 'enrollment_processing' });
  });

  it('a 2xx that fails validation is never treated as success', async () => {
    const f = await fixture();
    const central = mockCentral(() => json(201, { ok: true }));
    expect(await work(central.fetchImpl)).toMatchObject({ completed: 0, retried: 1 });
    expect(await job(f.jobId)).toMatchObject({ status: 'failed_retryable', last_error_code: 'invalid_response' });
    expect(await enrollments(f.paymentId)).toHaveLength(0);
  });

  it('429 honors retry-after', async () => {
    const f = await fixture();
    const central = mockCentral(() => new Response('', { status: 429, headers: { 'retry-after': '600' } }));
    await work(central.fetchImpl);
    const row = await job(f.jobId);
    expect(row.status).toBe('failed_retryable');
    const delay = (row.available_at.getTime() - Date.now()) / 1000;
    expect(delay).toBeGreaterThan(540);
    expect(delay).toBeLessThanOrEqual(600);
  });

  it('never exceeds three attempts', async () => {
    const f = await fixture();
    const central = mockCentral((call) => (call.method === 'GET' ? status(404, 'not_found') : status(503)));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await work(central.fetchImpl);
      if (attempt < 3) {
        expect((await job(f.jobId)).status).toBe('failed_retryable');
        await makeDue(f.jobId);
      }
    }
    expect(await job(f.jobId)).toMatchObject({
      status: 'dead_letter', attempt_count: 3, last_error_code: 'max_attempts_exhausted:http_503',
    });
    const callsBefore = central.calls.length;
    await makeDue(f.jobId);
    expect(await work(central.fetchImpl)).toMatchObject({ claimed: 0 });
    expect(central.calls).toHaveLength(callsBefore);
    expect(central.calls.filter((c) => c.method === 'POST')).toHaveLength(3);
  });

  it('a legacy row with max_attempts=5 is still capped at three and never calls on attempt 4', async () => {
    const f = await fixture({ maxAttempts: 5 });
    await db!`UPDATE fulfillment_jobs SET status = 'failed_retryable', attempt_count = 3,
      available_at = now() - interval '1 second' WHERE id = ${f.jobId}::uuid`;
    const central = mockCentral(created);
    expect(await work(central.fetchImpl)).toMatchObject({ dead_lettered: 1 });
    expect(central.calls).toHaveLength(0);
    expect(await job(f.jobId)).toMatchObject({
      status: 'dead_letter', attempt_count: 4, last_error_code: 'max_attempts_exhausted',
    });
  });

  it('new fulfillment jobs default to three attempts', async () => {
    const f = await fixture();
    const [row] = await db!<Array<{ max_attempts: number }>>`
      SELECT column_default::int AS max_attempts FROM information_schema.columns
      WHERE table_name = 'fulfillment_jobs' AND column_name = 'max_attempts'`;
    expect(row.max_attempts).toBe(3);
    expect(f.jobId).toBeTruthy();
  });
});
