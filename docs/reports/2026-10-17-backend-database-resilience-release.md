# Backend database resilience — production release

Date: 2026-10-17  
Project: `maneyraos-projects/studyx-agente-ventas`  
Branch: `codex/orchestrator-integrity-20261015`

## Outcome

Production now runs deployment `dpl_B3GhfWPegwYFKe9HtR39x4i7Stps` with a least-privilege `orchestrator_role`, bounded database operations, stale-connection detection and one controlled connection recycle. The public alias is `https://studyx-agente-ventas.vercel.app`.

This release does not change Agent A's prompt, wording, sales judgment or Botpress bundle. On an already-live connection it adds no query. After 15 seconds of database inactivity, the next operation performs one liveness query before continuing.

## Root cause and fix

Production logs contained 70 serverless executions that reached the database path and then timed out after 300 seconds. The failure matched a stale pooled TCP connection surviving a suspended serverless instance.

The runtime now:

- probes a connection before reuse after an idle interval;
- cancels expired readiness probes;
- closes and recreates a stale client once;
- fails with `ORCHESTRATOR_DATABASE_UNAVAILABLE` instead of hanging indefinitely;
- verifies the expected runtime role and database deadlines;
- uses a one-connection serverless pool with short connect and idle timeouts.

## Controlled cutover

The first candidate cutover was rolled back before serving production traffic after the full pilot exposed two missing least-privilege grants. The previous deployment `dpl_8JnUTCTrLKxkGXZJpfJhti3kX7xg` and its prior database configuration were restored immediately.

Two append-only grants were then added and applied:

- `20261017010001_orchestrator_sandbox_identity_write.sql`
- `20261017020001_orchestrator_outbound_parts_write.sql`

Both allow only `SELECT` and `INSERT`; `UPDATE`, `DELETE` and `TRUNCATE` remain revoked. The isolated candidate subsequently completed ingest → decision → delivery with the limited role and no permission errors.

The second cutover promoted `dpl_B4RkveXasMcSMHfF2FDa8GxdR6c6`. Five consecutive health/readiness pairs returned HTTP 200. Signed production canaries returned:

- catalog: HTTP 200;
- payment options: HTTP 200;
- deliberately invalid ingest: HTTP 400 `VALIDATION_ERROR`;
- no runtime errors in the post-promotion log window.

Pilot cleanup removed 18 synthetic `+999` identities and their dependent test rows in one transaction. A count over the three exact pilot prefixes returned zero afterward; no real contact was in scope.

Observed readiness database latency was 141 ms on the first cold probe and remained bounded on subsequent probes. End-to-end HTTP readiness stayed between 0.49 s and 1.22 s after promotion.

## Enrollment settlement follow-up

A real sandbox payment for the contact ending in `4399` exposed one compatibility gap after the first release: the Central de Carga worker built its lease fence as a reusable Postgres.js fragment. The resilient adapter treated that fragment as a complete query, producing `syntax error at or near "id"`; Central had accepted the request, but the local job remained leased and no `access_ready` notification could be created.

Commit `e893c93` inlines the fenced predicate in each terminal update and adds an integration regression that runs the complete enrollment worker through the production resilient adapter. The focused regression failed with the exact production signature before the change and passed afterward; all 22 Central de Carga worker tests, the 4,243 unit tests, typecheck, lint and the post-sale integration passed.

Deployment `dpl_B3GhfWPegwYFKe9HtR39x4i7Stps` was then promoted. The expired `4399` job was released and retried through the production endpoint: attempt 2 reconciled the already-created Central enrollment, completed with `lease_lost: 0`, persisted an active enrollment and sent the `access_ready` WhatsApp notification successfully. Final readiness returned HTTP 200 with a 105 ms PostgreSQL probe and the deployment error log was empty.

Before this diagnosis, the test contact ending in `4497` was reset. Its immutable call/continuity ledger could not be deleted by design, so the old contact was tombstoned under a synthetic number, mutable memory and sales state were removed, a fresh contact took the real number, and the Botpress conversation was deleted. Independent verification found zero messages, conversations, memories, sales states, payments, calls and channel threads on the fresh contact.

## Verification

- Unit: 239 files passed; 4,243 tests passed; 17 skipped; 7 todo.
- Focused role integration: 7/7 passed.
- TypeScript: passed.
- ESLint: passed.
- Vercel production build: passed.
- Botpress ADK build: passed earlier in the same candidate series; this release did not change the bundle.
- Full integration: 679/680 passed. The remaining rollback-provenance case fails only in the parallel full run and passes isolated; it is unrelated to this database/runtime change and is not hidden as green.

## Scope boundary

This proves the structural backend path and the limited-role transaction flow. It does not claim a fresh real-money Stripe payment, real Central de Carga enrollment, real email/WhatsApp credential delivery or real voice call was executed during this release, because those actions have external side effects. Those remain supervised acceptance checks.

Immediate rollback target: `dpl_B4RkveXasMcSMHfF2FDa8GxdR6c6`.
