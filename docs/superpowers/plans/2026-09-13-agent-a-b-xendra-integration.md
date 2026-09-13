# Agent A ↔ Agent B via Xendra Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route consented Agent A call requests through Xendra to Agent B, and relay Agent B events and tools back to the originating conversation with authenticated, idempotent PostgreSQL-backed effects.

**Architecture:** Keep the existing `VoiceProvider`, `dispatchCall`, `PostgresCallStore`, Retell event projection, and Retell tool stores. Add Xendra only as the dispatch and relay adapter. The original conversation remains the delivery authority, and PostgreSQL remains the authority for consent, opt-out, payment, correlation, and replay safety.

**Tech Stack:** Next.js route handlers, TypeScript, Zod, PostgreSQL, Vitest, Vercel, Botpress ADK only if its source changes.

**Contract:** `/Users/tmaneyro22/Downloads/ORQUESTADOR_API.md`

**Constraints:** Do not change Agent A prompts, catalog, naturality, or commercial reasoning. Do not add an Xendra migration. Never retry an ambiguous dispatch automatically. Never infer six or twelve installments from `cuotas`. Never make a real phone call in this plan.

---

### Task 1: Add the Xendra dispatch boundary

**Files:**
- Create: `src/features/calls/adapters/xendra-voice.provider.ts`
- Modify: `src/lib/config.ts`
- Modify: `src/app/api/agent/calls/[call_id]/dispatch/route-dependencies.ts`
- Modify: `src/features/calls/application/request-call.ts`
- Test: `tests/unit/xendra-voice-provider.test.ts`
- Test: `tests/unit/call-request.test.ts`

- [x] Write failing tests for the exact payload, returned `call_id`, 409 reconciliation, confirmed 400/401/503 failures, and ambiguous 502/timeout/network behavior.
- [x] Implement `XendraVoiceProvider` with `x-studyx-orchestrator-secret`, no automatic retry, and no unsupported lookup/redial.
- [x] Accept `VOICE_PROVIDER=xendra` while persisting `retell` as the voice provider of record.
- [x] Build a bounded five-to-six-sentence `resumen_whatsapp` from persisted conversation context and pass every required Xendra variable.
- [x] Run the two focal unit files and commit the boundary.

### Task 2: Accept Xendra-relayed Retell events

**Files:**
- Modify: `src/app/retell/eventos/route.ts`
- Modify: `src/features/calls/application/retell-webhook.ts`
- Modify: `src/features/calls/domain/retell-event.ts`
- Create: `src/lib/security/shared-secret.ts`
- Test: `tests/unit/retell-webhook.test.ts`
- Test: `tests/integration/retell-call-lifecycle.test.ts`

- [x] Write failing tests for constant-time shared-secret auth, required/matching `x-studyx-event`, invalid identity correlation, and absent analysis booleans becoming `false`.
- [x] Preserve the direct Retell signature handler and add a separate Xendra relay handler that performs only bounded parsing and PostgreSQL persistence before responding.
- [x] Confirm that transcripts and recordings are never persisted and that replayed lifecycle events remain idempotent.
- [x] Run the focal unit and PostgreSQL lifecycle tests and commit the relay.

### Task 3: Make the two essential Agent B tools gateway-safe

**Files:**
- Modify: `src/app/retell/tools/route-handler.ts`
- Modify: `src/features/calls/application/retell-tools.ts`
- Modify: `src/features/calls/adapters/postgres-retell-orchestration.store.ts`
- Modify: `src/features/calls/adapters/postgres-call.store.ts`
- Test: `tests/unit/retell-tools.test.ts`
- Test: `tests/integration/retell-five-tools-postgres.test.ts`
- Test: `tests/integration/post-call-followup.test.ts`

- [x] Write failing tests showing the Xendra path needs only `x-studyx-tools-secret`, bad auth returns 401, and authenticated failures return HTTP 200 with an enunciable structured result.
- [x] Support canonical `monthly_12`, `monthly_6`, and `one_time`; translate `contado`; require a durable selection for `cuotas` or return `PLAN_SELECTION_REQUIRED`.
- [x] Route a payment link once through the original Telegram or WhatsApp conversation, including replay and concurrency, without hardcoding WhatsApp.
- [x] Persist the operational result, opt-out, objections, course, and next step; reject a declared sale unless backend payment is verified.
- [x] Run the focal unit and PostgreSQL tests and commit the minimum A→B→A bridge.

### Task 4: Verify the remaining seven existing tools

**Files:**
- Modify only if a failing contract test requires it: `src/app/retell/tools/**/route.ts`
- Modify only if required: `src/features/calls/application/retell-tools.ts`
- Test: `tests/unit/retell-tools.test.ts`
- Test: `tests/integration/retell-five-tools-postgres.test.ts`

- [ ] Add or extend table-driven tests for course, offer, lead data, payment verification, material, human handoff, and follow-up scheduling.
- [ ] Preserve existing stores and strict effect schemas while returning a useful Agent B response for every authenticated error.
- [ ] Verify all nine public tool routes without adding tables, routes, or migrations.
- [ ] Commit only contract adaptations demonstrated by a failing test.

### Task 5: Prove the local A→B→A journey

**Files:**
- Create: `tests/integration/agent-a-xendra-agent-b-e2e.test.ts`
- Create: `tests/fixtures/fake-xendra-server.ts`

- [ ] Drive Agent A through offer, consent, visible confirmation, and exactly one dispatch to a local fake Xendra server.
- [ ] Relay `call_started`, send the canonical 12-installment link once to the original chat, record the operational result, relay final and analysis events, and resume Agent A.
- [ ] Replay every effect and prove no duplicate call, link, outbound message, or projection.
- [ ] Cover invalid secrets, 409, ambiguous timeout, ambiguous `cuotas`, crossed identity, opt-out, and an unverified declared sale.
- [ ] Run the complete local smoke against disposable PostgreSQL and commit the evidence.

### Task 6: Complete gates, deploy, and hand off to Lucas

**Files:**
- Modify: `.env.example` and deployment documentation only for variable names and public contracts.

- [ ] Run calls/Xendra/tools tests, the local A→B→A smoke, all unit tests, all PostgreSQL integration tests, typecheck, lint, Next.js build, `git diff --check`, and a tracked-file secret/PII scan.
- [ ] Skip the migration loop because this branch does not modify migration files; apply only the already-integrated Agent B migrations that production is missing.
- [ ] Push `codex/agent-a-b-xendra`, configure Vercel secrets without printing values, and deploy the verified SHA.
- [ ] Skip Botpress deployment unless `botpress-agent` has a real source diff from the validated Agent A base.
- [ ] Probe `/retell/eventos` and all nine `/retell/tools/*` production routes without causing effects, then prepare Lucas's URLs, headers, and canonical payment-contract changes.
- [ ] Stop at `READY_FOR_SUPERVISED_CALL`; obtain explicit authorization before any billed call.
