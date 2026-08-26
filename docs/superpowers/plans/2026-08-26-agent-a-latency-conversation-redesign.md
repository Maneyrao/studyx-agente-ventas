# Agent A Latency and Conversation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore natural Agent A conversations and reduce Telegram response latency from 19–41 seconds to p50 ≤ 7 seconds and p95 ≤ 10 seconds.

**Architecture:** Botpress remains a stateless channel/workflow adapter; Supabase remains the sole source of conversational state and memory. Gemini owns semantic interpretation and conversational wording. Deterministic code only authorizes high-risk actions and canonical commercial facts.

**Tech Stack:** Next.js, TypeScript, Botpress ADK, Gemini direct, PostgreSQL/Supabase, Vitest, Vercel.

**Spec:** This plan and the production evidence captured on 2026-08-26: Botpress transcript quota adds 18–30 s; Gemini adds ~8.6 s; delivery retries add ~2.4 s; PostgreSQL claim takes 126–454 ms.

## Global Constraints

- Start from commit `c6927cc` on branch `codex/integration-agent-a-outbound-prod`.
- Work in `/private/tmp/studyx-agent-a-outbound-prod-20260826`; do not merge into `main`.
- One executor, sequential tasks, no subagents, no web research, no broad repository scan.
- Read only this plan and each task's allowlisted files.
- TDD for every behavior change; one focused commit per task.
- Never send Telegram, WhatsApp, Stripe, email, or Sheets test traffic. The user performs external smokes.
- Do not modify Meta/WhatsApp configuration, payment URLs, canonical StudyX catalog data, or Supabase memory content.
- Gemini decides what to say. Rules may only gate payments, calls, consent/opt-out, Sheets writes, URLs, prices, certifications, and prohibited promises.
- Preserve idempotency, exactly-once outbound creation, tenant isolation, HMAC authentication, and delivery fencing.
- Stop immediately if a production preflight differs from this plan; report the exact difference in ≤10 lines.

---

### Task 1: Restore production schema parity and remove delivery retries

**Files:**
- Read: `supabase/migrations/20260821010001_embedding_epoch_gemini_2.sql`
- Read: `supabase/migrations/20260822010001_agent_decisions_send_payment_link.sql`
- Read: `supabase/migrations/20260825010001_payment_projection_jobs.sql`
- Test: `tests/integration/payment-projection-jobs.test.ts`

**Interfaces:**
- Consumes: production `DATABASE_URL` already configured locally.
- Produces: `payment_projection_jobs` plus migration-history/schema parity required by `/api/agent/outbounds/:id/delivery`.

- [ ] **Step 1: Verify the known failure without writing production**

Run read-only queries proving whether each migration's primary objects exist and whether each version appears in `supabase_migrations.schema_migrations`. Expected current defect: `payment_projection_jobs` is absent and delivery logs contain PostgreSQL `42P01`.

- [ ] **Step 2: Rebuild disposable PostgreSQL and run the focused integration test**

Run the repository's existing disposable-PostgreSQL reset, then:

```bash
npm test -- --run tests/integration/payment-projection-jobs.test.ts
```

Expected: PASS with all three migrations applied from zero.

- [ ] **Step 3: Apply only genuinely missing production migrations**

Use the direct production PostgreSQL connection, `ON_ERROR_STOP=1`, and one transaction per migration in version order. Do not blindly replay an unrecorded migration whose objects already exist. For any schema-present/history-missing migration, verify its constraints/functions and repair migration history instead of rerunning DDL.

- [ ] **Step 4: Verify production**

Read-only checks must prove:

```text
payment_projection_jobs table exists
payment_projection_jobs_pending_idx exists
orchestrator_role has SELECT, INSERT, UPDATE
versions 20260821010001, 20260822010001, 20260825010001 are reconciled
```

- [ ] **Step 5: Commit only if a repository change was necessary**

If no repository files changed, record the production migration action without creating an empty commit.

---

### Task 2: Remove Botpress-managed transcript AI from the response path

**Files:**
- Modify: `botpress-agent/src/conversations/router.ts`
- Modify: `tests/helpers/botpress-runtime-stub.ts`
- Test: `tests/unit/botpress/router-dispatch.test.ts`
- Test: `tests/unit/botpress/whatsapp-router-logging.test.ts`

**Interfaces:**
- Consumes: Botpress handler `chat.clearTranscript()` and `chat.saveTranscript()`.
- Produces: `resetManagedTranscript(chat): Promise<void>`, best-effort and non-blocking for the StudyX workflow.

- [ ] **Step 1: Write failing tests**

Add tests proving that every supported inbound clears and saves the Botpress transcript before `processInboundTurn.getOrCreate`, and that a transcript reset failure logs `studyx.router.transcript_reset_failed` but does not block workflow creation. Assert no message content or identifiers enter that log.

- [ ] **Step 2: Run RED**

```bash
npm test -- --run tests/unit/botpress/router-dispatch.test.ts tests/unit/botpress/whatsapp-router-logging.test.ts
```

Expected: new assertions FAIL.

- [ ] **Step 3: Implement the minimal reset**

In `router.ts`, accept `chat` in the handler. For supported inbound messages, call `clearTranscript()` followed by `saveTranscript()` inside a local try/catch before starting the workflow. Continue on failure. Do not read the transcript and do not change Supabase history or memory.

- [ ] **Step 4: Run GREEN and static gates**

```bash
npm test -- --run tests/unit/botpress/router-dispatch.test.ts tests/unit/botpress/whatsapp-router-logging.test.ts
npm run typecheck
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
```

- [ ] **Step 5: Commit**

```bash
git add botpress-agent/src/conversations/router.ts tests/helpers/botpress-runtime-stub.ts tests/unit/botpress/router-dispatch.test.ts tests/unit/botpress/whatsapp-router-logging.test.ts
git commit -m "fix: remove Botpress transcript AI from channel path"
```

---

### Task 3: Give Gemini ownership of commercial-language interpretation

**Files:**
- Modify: `botpress-agent/src/utils/commercial-router.ts`
- Modify: `src/features/orchestration/domain/catalog-resolution.ts` only if required to stop emitting false `not_found`
- Test: `tests/unit/botpress/commercial-router.test.ts`
- Test: `tests/unit/orchestration/catalog-resolution.test.ts`

**Interfaces:**
- Consumes: `ClaimedTurn.business_context`, recent turns, structured catalog resolution.
- Produces: `routeCommercialTurn()` returns `model_required` for open-ended catalog/advisory language; deterministic routes remain only for authorized actions and truly exact facts.

- [ ] **Step 1: Add real transcript regression cases**

Add table-driven tests for:

```text
Me pasas todos los cursos?
Pasame info general, cuáles ofrecen?
Qué opciones tienen?
Estoy buscando algo para trabajar, qué me recomendás?
No sé qué estudiar, orientame
```

Expected: `model_required`, never `catalog_not_found`, and never the singular fallback “No pude verificar ese curso”. Keep existing exact payment, call, opt-out, consent, and exact-course tests unchanged.

- [ ] **Step 2: Run RED**

```bash
npm test -- --run tests/unit/botpress/commercial-router.test.ts tests/unit/orchestration/catalog-resolution.test.ts
```

- [ ] **Step 3: Narrow deterministic routing**

Remove generic catalog navigation/not-found keyword routing from the conversational path. A `not_found` result without a positively identified requested course must fall through to Gemini. Do not add replacement keyword lists.

- [ ] **Step 4: Run GREEN**

Run the two focused suites. Expected: all new natural-language cases reach Gemini while action-safety tests remain green.

- [ ] **Step 5: Commit**

```bash
git add botpress-agent/src/utils/commercial-router.ts src/features/orchestration/domain/catalog-resolution.ts tests/unit/botpress/commercial-router.test.ts tests/unit/orchestration/catalog-resolution.test.ts
git commit -m "fix: let Gemini interpret commercial language"
```

---

### Task 4: Preserve safe Gemini answers instead of replacing the whole message

**Files:**
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/features/orchestration/domain/egress-guard.ts`
- Test: `tests/unit/orchestration/egress-guard.test.ts`
- Test: `tests/integration/orchestration-lifecycle.test.ts`
- Modify: `botpress-agent/src/prompts/agent-a-sales-bridge.ts`
- Test: `tests/unit/botpress/agent-a-sales-bridge-prompt.test.ts`

**Interfaces:**
- Consumes: canonical offering names, academies, prices, URLs, policies and the model response.
- Produces: an egress manifest that allows canonical course/academy facts while still rejecting invented prices, URLs, certifications, guarantees and payment actions.

- [ ] **Step 1: Write failing regressions**

Cover these outcomes:

```text
Canonical academy/course names from the claim snapshot survive unchanged.
An invented course name cannot be asserted as canonical.
An invented price or URL remains blocked.
An unsupported certification or guarantee remains blocked.
A harmless answer is never replaced wholesale merely for naming a canonical academy.
```

- [ ] **Step 2: Run RED**

Run only the selected egress/decision and prompt test files. Expected: canonical-area response currently becomes the generic safe fallback.

- [ ] **Step 3: Implement narrow authorization**

Authorize normalized academy names and exact offering names present in the canonical snapshot. Keep the full-response fallback only for high-risk unsupported facts: money, payment URL/action, certification, guarantees or prohibited promises. Do not weaken URL or payment validation.

- [ ] **Step 4: Compact the model context**

In `agent-a-sales-bridge.ts`, always send a compact catalog index (`code`, `display_name`, `academy`). Send detailed fields only for the currently resolved/remembered offering and retrieved knowledge. Preserve all three canonical payment options only when payment discussion is relevant.

- [ ] **Step 5: Run GREEN, typecheck and lint**

```bash
npm run typecheck
npm run lint
npm --prefix botpress-agent run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/decision.service.ts src/features/orchestration/domain/egress-guard.ts botpress-agent/src/prompts/agent-a-sales-bridge.ts tests/unit/orchestration/egress-guard.test.ts tests/integration/orchestration-lifecycle.test.ts tests/unit/botpress/agent-a-sales-bridge-prompt.test.ts
git commit -m "fix: preserve grounded conversational answers"
```

---

### Task 5: Verify, deploy and measure without generating conversations

**Files:**
- Modify only if required by failing relevant tests.
- Create: `docs/reports/agent-a-latency-redesign-2026-08-26.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: deployed Botpress/Vercel revisions and an evidence report.

- [ ] **Step 1: Run complete local gates**

```bash
npm run typecheck
npm run lint
npm test -- --run
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
npm --prefix botpress-agent run build
```

Run the relevant disposable-PostgreSQL integration suites. Stop on any regression in idempotency, outbound delivery, payment, memory, tenant isolation or catalog grounding.

- [ ] **Step 2: Deploy in order**

Deploy Vercel backend first, confirm `ready:true`, then deploy Botpress from the same commit. Verify configuration remains `decisionProvider=gemini_direct` and `automationEnabled=true`.

- [ ] **Step 3: Wait for user-generated smoke traffic**

Do not send messages. Ask the user to send these five messages manually:

```text
Hola
Me pasas todos los cursos?
No sé qué estudiar, orientame
Me interesa tecnología pero no sé qué elegir
Cuánto sale y qué formas de pago tienen?
```

- [ ] **Step 4: Read logs and calculate gates**

For the five user turns, report: Telegram→router, claim, retrieval, model, commit, send and total. Acceptance:

```text
No Botpress transcript QuotaExceeded on the message path
No payment_projection_jobs 42P01
No delivery-report retry loop
No false catalog_not_found
No whole-response safe fallback for canonical catalog facts
p50 total ≤ 7 s
p95 total ≤ 10 s
Exactly one outbound per inbound
```

- [ ] **Step 5: Write report, commit and push both remotes**

```bash
git add docs/reports/agent-a-latency-redesign-2026-08-26.md
git commit -m "docs: report Agent A latency redesign"
git push personal codex/integration-agent-a-outbound-prod
git push origin codex/integration-agent-a-outbound-prod
```

## Executor token budget protocol

1. Read this file once.
2. Execute one task at a time.
3. Do not open historical specs, Retell documents, PDFs or unrelated tests.
4. After each task, emit at most 10 lines: files, tests, commit, blocker.
5. Reuse test fixtures and existing helpers; do not create parallel abstractions.
6. If blocked, stop after one root-cause proof. Do not retry the same failing external action more than once.
