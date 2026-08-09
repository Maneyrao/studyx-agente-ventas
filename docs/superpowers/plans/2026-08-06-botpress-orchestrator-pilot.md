# StudyX Botpress Orchestrator Pilot — Implementation Plan

> **Execution rule:** implement each task with strict red-green-refactor, then run the scoped verification and an independent review before advancing. Existing dirty-worktree changes must be preserved. Do not commit, push, deploy, or apply remote migrations.

**Goal:** Leave one inbound text slice locally verified and ready to run in Botpress Emulator, with a demonstrated external-only blocker if ADK authentication or the local database runtime remains unavailable.

**Architecture:** Botpress normalizes the channel, waits for the batching window, proposes one structured decision, and submits the authorized outbound. Next.js owns ingestion, batching claims, context construction, policy, decision validation, idempotency, audit, and recovery. PostgreSQL is canonical. pgvector and summaries are derived and degradable.

**Stack:** Next.js 16.3, TypeScript 5.9, Zod 4, PostgreSQL 17/Supabase, pgvector, Vitest 4, Botpress ADK 2.0.5.

## Frozen decisions

1. The MVP is single-business/single-tenant. Multi-tenant launch is blocked until `organization_id` exists end to end.
2. There is no human transfer path. Human requests receive an automated explanation and controlled choices.
3. No commercial business action is executable in the pilot. `business_action` is always `null`.
4. Botpress cannot state price, availability, payment, enrollment, or resolution unless Next.js supplies a verified structured fact. The first smoke is conversational, not a sales-close proof.
5. One inbound event is persisted before any wait or model call.
6. Batching uses PostgreSQL, not Redis. A single `inbound_batches` row owns the 2–4 second window; existing `messages` rows are the members through `batch_id`, so no redundant membership table is needed.
7. A batch claim uses a short transaction and a lease. Exactly one workflow may generate the decision. Other workflows return `absorbed` and never call the model or send.
8. The logical guarantee is at-most-one canonical outbound per batch. ADK 2.0.5 cannot guarantee exactly one physical send after an ambiguous network result; that state becomes `paused_error`/reconciliation, never blind retry.
9. Technical lifecycle and business outcome are separate. The model may choose only `completed` or `waiting_user`; code owns retry/error/delivery states.
10. All messages remain canonical, but new messages are not automatically vectorized. Only validated memory candidates become eligible for asynchronous embeddings.

## Final flow

```text
Botpress Conversation
  -> POST /api/agent/ingest
     -> channel event + inbound message + open batch (atomic)
  -> step.sleep until batch due time
  -> POST /api/agent/batches/:batch_id/claim
     -> waiting | absorbed | claimed with controlled context
  -> Autonomous.Exit Decision v2
  -> POST /api/agent/batches/:batch_id/decision
     -> validate policy + memory candidates
     -> decision + outbound + outbox + delivery (atomic)
  -> Botpress createMessage once
  -> POST /api/agent/outbounds/:id/delivery
     -> submitted evidence or ambiguous/retryable failure
  -> reconciler closes stale claims and deliveries safely
```

Technical lifecycle:

```text
received -> batching -> processing -> decision_generated
-> decision_committed -> submitted_to_botpress
-> delivered -> completed

recovery: retry_pending | paused_error | failed
```

The Emulator slice can prove through `submitted_to_botpress`; `delivered` needs provider evidence from the official WhatsApp integration.

## Decision v2 contract

```json
{
  "schema_version": 2,
  "intent": "commercial",
  "kind": "clarify",
  "response": "¿Sobre qué curso querés consultar?",
  "response_type": "clarification",
  "confidence": 0.72,
  "reason_code": "MISSING_INFORMATION",
  "business_action": null,
  "memory_candidates": [],
  "missing_information": ["offering"],
  "next_state": "waiting_user"
}
```

Allowed values:

- `intent`: `social | commercial | commercial_decline | complaint | human_request | opt_out | out_of_scope | unknown`
- `kind`: `reply | clarify | suppress`
- `response_type`: `social_reply | commercial_reply | clarification | complaint_ack | automation_only | opt_out_ack | out_of_scope | technical_fallback`
- `next_state`: `completed | waiting_user`

Cross-field invariants:

- `suppress` has no response, response type, missing information, memory candidate side effect, or business action.
- `clarify` has a response, at least one missing field, and `waiting_user`.
- `opt_out` permits only `opt_out_ack`, no memory candidate, and `completed`.
- `human_request` permits only `automation_only`; it never creates another actor or queue.
- `business_action` is always null in schema version 2.
- A memory candidate must quote explicit customer text from the claimed batch and pass backend policy.

## Task 0 — Preserve baseline and ledger

**Files:**

- Create: `.superpowers/ledgers/2026-08-06-botpress-orchestrator-pilot.md`
- Do not modify Git history or existing unrelated files.

**Steps:**

1. Record branch, HEAD, dirty-file inventory, command baselines, and external blockers.
2. Record every task's files, red test, green test, reviewer findings, and correction round.
3. Never use reset, checkout, clean, stash, commit, push, deploy, or remote migration commands.

## Task 1 — Decision v2 and zero transfer paths

**Files:**

- Create: `src/features/orchestration/domain/decision.ts`
- Optional: `src/features/orchestration/domain/lifecycle.ts` only if technical lifecycle logic moves into the domain.
- Create: `tests/unit/orchestration/decision-policy.test.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/lib/services/ingestion.service.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `supabase/migrations/20260805010008_phase1_agent_decisions.sql` only if confirmed unapplied; otherwise create an additive migration.
- Create: `supabase/migrations/20260806010009_remove_transferred_conversation_status.sql` to converge legacy conversation rows to `closed`.
- Modify: `docs/ROADMAP.md`, `docs/FAILURE_MATRIX.md`, `specs/003-botpress-inbound-pilot/tasks.md`, and stale plans only to remove prohibited functional paths.

**Red tests:**

- Reject any old decision shape.
- Reject invalid cross-field combinations.
- Accept `human_request + automation_only + waiting_user`.
- Reject every non-null `business_action`.

**Implementation:**

- Keep the domain files dependency-free: no Zod, Next.js, Supabase, Botpress, or PostgreSQL types.
- Adapt Zod schemas at the HTTP and Botpress edges.
- Persist intent, missing information, next state, and memory candidates with the immutable decision.
- Map legacy `/reply` into Decision v2 without expanding its authority.
- Do not create `lifecycle.ts` in Task 1: technical states remain adapter-owned until Task 3, while the domain exposes only `completed | waiting_user`.

**Verification:**

```bash
npm run test:unit -- tests/unit/orchestration/decision-policy.test.ts
npm run typecheck
npm run lint
(cd botpress-agent && npm run typecheck && npm run check)
```

Expected: tests pass and a repository search has no functional transfer references.

## Task 2 — Explicit Emulator identity

**Files:**

- Modify: `botpress-agent/agent.config.ts`
- Modify: `botpress-agent/src/conversations/emulator.ts`
- Create: `botpress-agent/src/utils/emulatorIdentity.ts`
- Create: `botpress-agent/src/utils/emulatorIdentity.test.ts` if the ADK package test runner supports it; otherwise test through a root contract fixture.
- Modify: `.env.example` and `botpress-agent/README.md` without real credentials.

**Red tests:**

- Emulator payload without configured E.164 identity fails explicitly before HTTP.
- Configured identity appears in the exact ingest envelope.
- WhatsApp still requires the real channel identity and cannot use the Emulator fallback.

**Implementation:**

- Add an explicit development-only `emulatorPhoneE164` configuration validated as E.164.
- Keep `automationEnabled=false` by default. Document the exact test-only command to enable it.

**Verification:**

```bash
(cd botpress-agent && npm run typecheck && npm run check)
npm run test:unit
```

## Task 3 — Durable batching without Redis

**Files:**

- Create: `supabase/migrations/20260806010010_inbound_batches.sql`
- Modify: `src/lib/services/message.service.ts`
- Create: `src/features/orchestration/application/ingest-turn.ts`
- Create: `src/features/orchestration/application/claim-batch.ts`
- Create: `src/features/orchestration/ports/orchestration-store.ts`
- Create: `src/features/orchestration/adapters/postgres-orchestration-store.ts`
- Modify or delegate from: `src/lib/services/ingestion.service.ts`
- Create: `src/app/api/agent/batches/[batch_id]/claim/route.ts`
- Create: `tests/unit/orchestration/batch-window.test.ts`
- Modify: `tests/integration/orchestration-lifecycle.test.ts`
- Modify: `tests/integration/database-invariants.test.ts`

**Schema:**

- `inbound_batches`: `id`, `conversation_id`, `contact_id`, `state`, `due_at`, `hard_deadline_at`, `claim_token`, `lease_until`, `representative_turn_id`, `last_error_code`, timestamps, version.
- `messages.batch_id` nullable FK and `messages.conversation_seq` nullable bigint.
- One open batch per conversation via partial unique index.
- Unique `(conversation_id, conversation_seq)` when sequence is present.
- Composite FKs prevent a batch/message from crossing contact or conversation boundaries.
- The application role gets only required SELECT/INSERT/UPDATE privileges; no delete/truncate.

**Window:**

- First message: `due_at = now + 2s`, `hard_deadline_at = now + 4s`.
- New message in the same open batch: `due_at = least(hard_deadline_at, now + 2s)`.
- Every message is committed before Botpress sleeps.
- Claim returns `waiting` with a bounded delay, `claimed` with a token and context identity, or `absorbed/completed`.

**Red integration tests:**

- Messages at t=0 and t=1 join one batch in stable order and permit one claim.
- A message after hard deadline creates another batch.
- Five concurrent claimers produce one claim token.
- Cross-contact membership fails by constraint.
- Expired claim becomes recoverable, never silently completed.

**Verification:**

```bash
npm run test:unit -- tests/unit/orchestration/batch-window.test.ts
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:integration
npm run test:db:lint
```

If Docker/Supabase local is unavailable, record this as an external gate and still run typecheck/lint/unit tests.

## Task 4 — Controlled context at claim time

**Files:**

- Create: `src/features/orchestration/application/build-turn-context.ts`
- Create: `src/features/orchestration/ports/memory-retriever.ts`
- Create: `src/features/orchestration/adapters/postgres-memory-retriever.ts`
- Modify: `src/lib/services/memory.service.ts`
- Modify: claim route/action contracts.
- Create: `tests/unit/orchestration/context-builder.test.ts`
- Add integration isolation cases.

**Rules:**

- Do not build semantic context during ingest.
- At claim, load structured contact/consent facts, 10–20 recent messages, summary, 2–5 relevant historical memories, then the ordered current batch.
- Clamp limits in code and SQL.
- A pgvector/embedding failure returns recent/structured context with `long_term_memory_available=false`.
- Every query is constrained by the batch's canonical `contact_id` and `conversation_id`.

**Verification:**

```bash
npm run test:unit -- tests/unit/orchestration/context-builder.test.ts
npm run typecheck
npm run lint
```

## Task 5 — Selective memory candidates

**Files:**

- Create: `supabase/migrations/20260806010011_selected_memories.sql`
- Create: `src/features/orchestration/domain/memory-candidate.ts`
- Create: `src/features/orchestration/application/validate-memory-candidates.ts`
- Create: `tests/unit/orchestration/memory-candidate-policy.test.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/lib/services/memory.service.ts`
- Modify: `src/app/api/cron/retry-embeddings/route.ts`

**Validation:**

- Allowed type/key, exact source quote in current batch, confidence threshold, sensitivity policy, freshness, duplicate hash, and same-key contradiction/supersession.
- Store accepted/rejected evidence and reason.
- Only accepted active memories enter the asynchronous embedding queue.
- New inbound/outbound messages use `embedding: skip` by default.
- Semantic retrieval applies a minimum similarity threshold and returns no irrelevant rows.

**Verification:**

- Poisoned instruction, invented quote, other-contact source, sensitive value, duplicate, and contradiction tests.
- Embedding failure leaves the turn available.

## Task 6 — Botpress batching and Decision v2 workflow

**Files:**

- Create: `botpress-agent/src/actions/claimBatch.ts`
- Modify: `botpress-agent/src/actions/commitDecision.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Create: `botpress-agent/evals/text-happy-path.eval.ts`
- Create: `botpress-agent/evals/human-request.eval.ts`
- Modify: `botpress-agent/evals/fail-closed.eval.ts`

**Behavior:**

- Ingest, sleep using stable step names, re-check due time up to the hard deadline, claim once, and stop absorbed workflows.
- Build the prompt from only the claimed controlled context.
- Treat customer content as untrusted data.
- Do not expose HTTP Actions or business mutations as model tools.
- Validate Decision v2 locally, then let Next.js validate it again.
- Unsupported content becomes `out_of_scope`; a human request becomes `automation_only`.
- Keep one outbound message rather than splitting by punctuation.

**Verification:**

```bash
(cd botpress-agent && npm run typecheck && npm run check)
```

Evals and Emulator execution require an authenticated ADK profile and running backend; report exact blockers if absent.

## Task 7 — Decision concurrency and delivery recovery

**Files:**

- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/app/api/agent/outbounds/[outbound_id]/delivery/route.ts`
- Create: `src/features/orchestration/application/reconcile-orchestration.ts`
- Create: `src/app/api/cron/reconcile-orchestration/route.ts`
- Modify: `vercel.json`
- Modify: `tests/integration/orchestration-lifecycle.test.ts`
- Modify: `tests/integration/database-invariants.test.ts`

**Rules:**

- On concurrent unique violation, reload by batch/turn and compare payload hash: same payload returns duplicate; different payload returns 409.
- Distinguish confirmed pre-send failure from ambiguous send result.
- Ambiguous send sets `paused_error`/reconciliation and never becomes automatically retryable.
- A successful Botpress message ID followed by report failure resumes/report-reconciles only; it never calls createMessage again.
- Reconciler expires stale batch claims and marks ambiguous deliveries for investigation. It may re-send only with affirmative proof that no physical send occurred.

**Verification:**

- Twenty identical concurrent decisions converge to one ID without 500.
- Different decisions converge to one commit and conflicts.
- Success + report failure yields one outbound and recoverable report.
- Ambiguous timeout yields no blind retry.

## Task 8 — Audio behind a port

**Files:**

- Create: `src/features/orchestration/ports/transcriber.ts`
- Create: `src/features/orchestration/application/prepare-inbound-content.ts`
- Create: `tests/unit/orchestration/prepare-inbound-content.test.ts`
- Modify WhatsApp adapter only after official generated types exist.

**Rules:**

- Persist the original audio event before download/transcription.
- No guessed WhatsApp payload or integration type.
- Transcription failures use deterministic retry/error states; the model does not invent a transcript.

This task is locally limited to the port and tests until the official integration is authenticated.

## Task 9 — Observability and load harness

**Files:**

- Modify: `src/lib/observability/counters.ts`
- Modify: `src/lib/observability/structured-log.ts`
- Add stage timers to application use cases and Botpress Workflow logs.
- Create: `scripts/load-inbound-pilot.mjs`
- Create: `docs/BOTPRESS_PILOT_RUNBOOK.md`

**Metrics:**

- p50/p95/p99 for ingest, PostgreSQL transaction, batching wait, context, model, decision commit, send, report, and total.
- Duplicates, absorbed workflows, claim contention, serialization retries, stale leases, ambiguous sends, memory fallback, token usage, and backlog.

**Load sequence:** one turn, 25 conversations, 50 conversations, then 150 only in an isolated test environment.

## Task 10 — Official WhatsApp integration

Do this only after ADK authentication and real generated integration types are available. Map real phone, provider message ID, conversation ID, quoted message, audio, image, and provider delivery callbacks. Do not invent interfaces or claim delivery from Botpress acceptance alone.

## Full verification gate

Run fresh:

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
(cd botpress-agent && npm run typecheck && npm run check && npm run build)
(cd botpress-agent && adk status --format json && adk check --format json)
```

Database gates, when local Supabase is available:

```bash
npm run test:db:reset-loop
npm run test:db:lint
npm run test:db:invariants
npm run test:integration
```

Do not claim completion if Botpress Emulator, Supabase integration, WhatsApp, or load gates remain externally blocked. Report the exact command, result, and missing dependency.
