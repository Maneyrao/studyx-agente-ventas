# Backend Database Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale PostgreSQL connections from blocking StudyX requests until Vercel's 300-second ceiling while preserving Agent A behavior and normal-path latency.

**Architecture:** Put a stable, testable resilience boundary around the existing `postgres.js` client. It performs one cached liveness/session-policy check, atomically recycles a stale client, and forwards the original query or transaction without changing application stores. Production then switches from the admin login to the existing limited `orchestrator_role` and is released with a reversible Vercel cutover.

**Tech Stack:** TypeScript 5.9, postgres.js 3.4.9, Vitest 4, PostgreSQL/Supavisor, Next.js 16, Vercel Fluid Compute.

**Spec:** `docs/superpowers/specs/2026-10-16-backend-database-resilience-design.md`

## Global Constraints

- Do not modify prompts, personas, Botpress behavior or commercial decision rules.
- Keep `DB_POOL_MAX=1`, `prepare=false`, `connect_timeout=5`, and use the Supavisor transaction pooler on port 6543.
- Do not retry a business write after an ambiguous connection loss.
- A stale-client recovery must finish or fail in less than four seconds, never 300 seconds.
- Production must use `orchestrator_role` with `statement_timeout<=8s`, `lock_timeout<=1500ms`, and `idle_in_transaction_session_timeout<=10s`.
- Never print or commit database passwords, Vercel tokens, Botpress secrets, payment secrets or customer data.

## Review Focus

- A liveness query that never settles must destroy the old client and execute the business query exactly once on the replacement.
- Concurrent first queries must share one liveness check and one recycle, not multiply connections.
- A role or timeout mismatch must fail closed without executing the business query.
- Cancellation before and after the business query starts must not leave an unhandled rejection or delayed write.
- Ending the stable proxy during tests/shutdown must end the active generation and reject later use deterministically.

---

### Task 1: Stable Resilient PostgreSQL Runtime

**Files:**
- Create: `src/lib/db/resilient-postgres.ts`
- Modify: `src/lib/db/orchestrator.ts`
- Create: `tests/unit/db/resilient-postgres.test.ts`

**Interfaces:**
- Consumes: `postgres.Sql`, `DATABASE_URL`, `DB_POOL_MAX`, and `ORCHESTRATOR_DB_EXPECTED_ROLE`.
- Produces: `createResilientPostgresRuntime(options): { sql, ensureReady, inspect }`, `OrchestratorDatabaseUnavailableError`, and the existing `sql` export backed by a stable proxy.

- [ ] **Step 1: Write the failing runtime tests**

Add tests with callable fake clients proving these literal outcomes:

```ts
it('recycles one stale generation and runs the business query once on the replacement', async () => {
  const result = await runtime.sql`SELECT business`;
  expect(result).toEqual([{ ok: true }]);
  expect(stale.ended).toBe(1);
  expect(replacement.businessQueries).toBe(1);
});

it('shares one liveness check across concurrent first queries', async () => {
  await Promise.all(Array.from({ length: 100 }, () => runtime.sql`SELECT business`));
  expect(healthy.livenessQueries).toBe(1);
  expect(factory).toHaveBeenCalledTimes(1);
});

it('fails closed on an administrative role without running business SQL', async () => {
  await expect(runtime.sql`SELECT business`).rejects.toMatchObject({
    code: 'ORCHESTRATOR_DATABASE_POLICY_MISMATCH',
  });
  expect(admin.businessQueries).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/unit/db/resilient-postgres.test.ts`

Expected: FAIL because `@/lib/db/resilient-postgres` does not exist.

- [ ] **Step 3: Implement the minimal runtime**

Implement a stable callable proxy that distinguishes tagged-template queries from postgres helper calls. Tagged queries and `begin()` await a single-flight `ensureReady`; helper calls delegate immediately. The liveness query reads `current_user` and the three effective timeout settings from the active client. On a 1.500 ms deadline it swaps generations before destroying the old client, verifies one fresh generation, and exposes a cancellable promise for the business query. Cache a successful check for 15 seconds and configure created clients with:

```ts
{
  max: poolMax,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 20,
  connection: { application_name: 'studyx-orchestrator' },
}
```

Validate the role only when `ORCHESTRATOR_DB_EXPECTED_ROLE` is set. Parse PostgreSQL duration units and reject zero or limits looser than 8.000 / 1.500 / 10.000 ms.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/unit/db/resilient-postgres.test.ts`

Expected: all runtime tests pass with no unhandled rejections.

- [ ] **Step 5: Run typecheck and the existing DB deadline integration test**

Run: `npm run typecheck && npm run test:integration -- tests/integration/orchestrator-db-deadline.test.ts`

Expected: typecheck exits 0 and the role deadline test passes against the disposable local database.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/db/resilient-postgres.ts src/lib/db/orchestrator.ts tests/unit/db/resilient-postgres.test.ts
git commit -m "fix(db): recycle stale orchestrator connections"
```

### Task 2: Cancellable Readiness Boundaries

**Files:**
- Modify: `src/features/observability/adapters/probes.ts`
- Create: `tests/unit/observability/database-probe-timeout.test.ts`

**Interfaces:**
- Consumes: cancellable query promises returned by Task 1's stable `sql` proxy.
- Produces: `withCancellableTimeout(operation, ms)` used by PostgreSQL readiness probes so a timed-out probe cannot stay queued.

- [ ] **Step 1: Write the failing timeout tests**

```ts
it('cancels a PostgreSQL probe query when its deadline expires', async () => {
  const probe = await probePostgres(stalledCancellableDatabase);
  expect(probe).toMatchObject({ status: 'down' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('does not cancel a probe that resolves before its deadline', async () => {
  const probe = await probePostgres(healthyCancellableDatabase);
  expect(probe).toMatchObject({ status: 'ok' });
  expect(cancel).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/unit/observability/database-probe-timeout.test.ts`

Expected: the stalled-query test fails because the current `withTimeout` never calls `cancel()`.

- [ ] **Step 3: Implement cancellable timeout handling**

Change the private timeout helper to accept `PromiseLike<T> & { cancel?: () => void }`. At expiry call `cancel()` once, observe a returned cancellation promise without exposing it as an unhandled rejection, reject the probe with `probe timed out after 2000ms`, and clear the timer in every settlement path.

- [ ] **Step 4: Run focused and readiness tests**

Run: `npm test -- tests/unit/observability/database-probe-timeout.test.ts tests/unit/observability/agent-loop-schema-probe.test.ts tests/unit/observability/commercial-snapshot-probe.test.ts tests/unit/observability/ready-route.test.ts`

Expected: all selected observability tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/features/observability/adapters/probes.ts tests/unit/observability/database-probe-timeout.test.ts
git commit -m "fix(readiness): cancel expired database probes"
```

### Task 3: Full Candidate Verification and Production Cutover

**Files:**
- Create: `docs/reports/2026-10-16-backend-database-resilience-release.md`

**Interfaces:**
- Consumes: Task 1's production role enforcement and Task 2's bounded probes.
- Produces: one production Vercel deployment, verified `orchestrator_role` credentials, and an evidence report with rollback target.

- [ ] **Step 1: Verify the complete candidate locally**

Run the following independently and retain their exact totals:

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
(cd botpress-agent && npm run build)
```

Expected: every command exits 0. Any existing skip/todo counts are recorded, not described as passes.

- [ ] **Step 2: Verify remote schema and provision the limited login**

Using the current production admin URL only in process memory, verify migrations `20261015000001` through `20261015040001`, rotate a random password for `orchestrator_role`, and open a fresh pooler connection as `orchestrator_role.<project-ref>`. Assert the query returns:

```json
{
  "current_user": "orchestrator_role",
  "statement_timeout_ms": 8000,
  "lock_timeout_ms": 1500,
  "idle_in_transaction_session_timeout_ms": 10000
}
```

Expected: the role login succeeds and a read/write smoke inside a rolled-back transaction proves required grants without persisting customer data.

- [ ] **Step 3: Update production environment without exposing secrets**

Update `DATABASE_URL` from stdin as a sensitive Vercel variable and set `ORCHESTRATOR_DB_EXPECTED_ROLE=orchestrator_role`. Keep the old production URL only in the cutover process for automatic rollback.

Expected: `vercel env ls production` shows both variable names; no value appears in command output or git.

- [ ] **Step 4: Build and deploy the exact production artifact**

```bash
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

Expected: deployment reaches READY and the production alias points to its immutable URL.

- [ ] **Step 5: Run bounded production canaries**

Verify five consecutive `/api/health` and `/api/ready` calls, a signed invalid-ingest contract check, and non-mutating signed reads for catalog and payment options. Run one isolated synthetic end-to-end workflow using sandbox identities for intake, course selection, plan selection, call request, payment-link materialization and delivery reporting. Trigger the Stripe sandbox payment and Central Carga worker, then verify one active enrollment, one email access notification and one WhatsApp welcome record with no duplicate physical send.

Expected: every HTTP call stays below 10 seconds, readiness reports `orchestrator_role`, no request reaches 300 seconds, one payment yields one enrollment, and Agent A's emitted copy remains model-owned.

- [ ] **Step 6: Scan post-deploy logs and latency**

Inspect the immutable deployment logs and runtime errors from the deployment timestamp. Record p50/p95/p99 for DB preflight, ingest persistence, decision commit and delivery report.

Expected: zero new 300-second timeouts; preflight p95 below 150 ms on healthy connections; no `ORCHESTRATOR_DATABASE_POLICY_MISMATCH`; no duplicate payment, enrollment or delivery.

- [ ] **Step 7: Roll back on any failed production gate**

If Steps 4–6 fail, restore the old `DATABASE_URL`, remove `ORCHESTRATOR_DB_EXPECTED_ROLE`, promote the previous production deployment and rerun health/readiness. Record the failed immutable deployment without deleting history.

Expected: the previous production alias is healthy before the incident is reported.

- [ ] **Step 8: Write and commit the release evidence**

Create `docs/reports/2026-10-16-backend-database-resilience-release.md` with candidate SHA, deployment IDs, schema versions, safe role/timeout values, test totals, canary evidence, latency comparison, log scan, rollback target, and any unverified external boundary.

```bash
git add docs/reports/2026-10-16-backend-database-resilience-release.md
git commit -m "docs: certify backend database resilience release"
```

Expected: the report distinguishes automated proof, production observation and anything still not externally exercised.
