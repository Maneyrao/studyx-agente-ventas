# Bot A Regression Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover Agent A from the current 2/50 end-to-end result to a trustworthy 50/50 local regression gate without weakening catalog, egress, consent, payment, or persistence safety.

**Architecture:** Keep the existing hexagonal split: catalog resolution and authorization remain pure domain code; claim/commit orchestrate them; Botpress only routes and renders; PostgreSQL remains the durable authority. Fix the pipeline in dependency order—observability, canonical catalog facts, cross-turn course identity, payment/Sheets, persistence, then latency—using small diagnostic suites before one final 50-case run.

**Tech Stack:** TypeScript, Next.js, Botpress ADK, Vitest, PostgreSQL 17/pgvector, Groq/Gemini direct providers, Stripe payment-link projection, Google Sheets outbox projection.

**Spec:** `docs/plans/2026-08-24-bot-a-conversational-refactor/MATRIZ-TESTS-BOT-A.md`; evidence: `botpress-agent/evals/results/happy-path-bot-a-g1g2-final-20260825.json`

## Global Constraints

- Work only on branch `codex/bot-a-lean-g1-g2` and the current repository worktree.
- Never stage or commit `.jez/`.
- Use only disposable PostgreSQL `postgresql://postgres@127.0.0.1:55435/studyx_test`.
- Do not push, deploy, connect production webhooks, or mutate remote Supabase/Botpress/Sheets.
- Never authorize a commercial fact from model prose; authority must come from one exact active offering or a backend-owned catalog list.
- Preserve byte-exact Stripe URL authorization and one link/one projection per confirmed purchase intent.
- Preserve one opt-out acknowledgement followed by silence and direct-call priority.
- Do not tune the sales prompt until the deterministic catalog/payment pipeline passes its diagnostic suite.
- Do not rerun all 50 cases until the 3-case and 8-case gates are green.
- Final acceptance is 50/50, zero hard failures, zero rejected decisions without safe outbound, and `regression_gate_complete=true`.

---

### Task 1: Freeze the Recoverable Baseline

**Files:**
- Preserve: all currently staged and unstaged G1/G2 files
- Exclude: `.jez/**`
- Evidence: `botpress-agent/evals/results/happy-path-bot-a-g1g2-final-20260825.json`

**Interfaces:**
- Consumes: current HEAD `a83c79728878b8b455304bdd304ad3fb751eb995` plus the dirty G1/G2 worktree.
- Produces: one recoverable local checkpoint commit before new diagnostic changes.

- [ ] **Step 1: Verify the exact worktree before changing it**

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: branch `codex/bot-a-lean-g1-g2`, HEAD `a83c797...`, `.jez/` untracked, and `git diff --check` exits 0.

- [ ] **Step 2: Re-run the already-established static gates once**

```bash
npm run typecheck
npm test
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
```

Expected: 1,285 unit tests pass, 266 integration tests pass, Botpress reports `valid:true`, `assetsOk:true`, and `typesOk:true`.

- [ ] **Step 3: Create a safety checkpoint without `.jez/`**

```bash
git add botpress-agent scripts src tests docs
git status --short
git commit -m "checkpoint: preserve bot a g1 g2 recovery baseline"
```

Expected: `.jez/` is not staged and the G1/G2 implementation can be recovered from the checkpoint.

---

### Task 2: Make Every Failed Turn Explain Its Authority Chain

**Files:**
- Modify: `scripts/lib/agent-a-conversation-runner.ts`
- Modify: `scripts/run-agent-a-conversations.ts`
- Modify: `scripts/lib/agent-a-persistence-verifier.ts`
- Test: `tests/unit/scripts/agent-a-conversation-runner.test.ts`
- Test: `tests/unit/scripts/agent-a-persistence-verifier.test.ts`

**Interfaces:**
- Consumes: `ClaimedTurn.catalog_resolution`, `ClaimedTurn.sales_context.offering_code`, `CommitDecisionResponse.outbound.authorized_egress`, and the API error payload `{ error, reason }`.
- Produces: `AgentTurnDiagnostic` persisted in each result turn:

```ts
export type AgentTurnDiagnostic = {
  catalogResolution: AgentCatalogResolutionEvidence;
  selectedOfferingCode: string | null;
  decisionBusinessAction: Record<string, unknown> | null;
  authorizedProtectedFacts: readonly ProtectedFactRef[];
  authorizedUrls: readonly string[];
  commitError: { status: number; error: string; reason: string | null } | null;
};
```

- [ ] **Step 1: Write RED tests for diagnostic preservation**

Add tests proving that an HTTP 422 payload `{error:'DECISION_REJECTED', reason:'EGRESS_UNAUTHORIZED_PROTECTED_FACT'}` survives as structured turn evidence and that a successful turn records catalog resolution, SKU, authorized facts, URLs, and action.

- [ ] **Step 2: Run the focal tests and confirm RED**

```bash
npm test -- tests/unit/scripts/agent-a-conversation-runner.test.ts tests/unit/scripts/agent-a-persistence-verifier.test.ts
```

Expected: failures because commit errors currently collapse to `LOCAL_STUDYX_DECISION_REJECTED` and successful evidence lacks the commit verdict.

- [ ] **Step 3: Implement structured local HTTP errors and turn diagnostics**

In `localSignedJson`, preserve `response.status`, `payload.error`, and `payload.reason`. In `createLocalTurnSender`, attach the claim-time authority chain to both success and failure. In the runner, write that diagnostic beside the transcript instead of relying on console output.

- [ ] **Step 4: Run the focal tests and three diagnostic cases**

```bash
npm test -- tests/unit/scripts/agent-a-conversation-runner.test.ts tests/unit/scripts/agent-a-persistence-verifier.test.ts
npm run test:agent-a -- \
  --file botpress-agent/evals/personas/studyx-council-50-v1.json \
  --cases g35_01_doce_meses_redes,g35_02_seis_meses_decoracion,g35_04_indeciso_seis_doce_fotografia \
  --transport local --provider groq --verify-db \
  --database-url 'postgresql://postgres@127.0.0.1:55435/studyx_test' \
  --run-id bot-a-diagnostic-authority-01
```

Expected: the cases may remain red, but every red turn identifies whether resolution, SKU propagation, canonical fact materialization, policy, or delivery rejected it.

- [ ] **Step 5: Commit the diagnostic contract**

```bash
git add scripts tests/unit/scripts
git commit -m "test: expose agent a authority-chain diagnostics"
```

---

### Task 3: Align Canonical Course Copy with Egress Authorization

**Files:**
- Create: `src/features/orchestration/domain/canonical-commercial-copy.ts`
- Create: `botpress-agent/src/utils/canonical-commercial-copy.ts`
- Modify: `src/features/orchestration/domain/canonical-offering-egress.ts`
- Modify: `botpress-agent/src/utils/transaction-fast-path.ts`
- Modify: `botpress-agent/src/utils/commercial-router.ts`
- Test: `tests/unit/orchestration/egress-guard.test.ts`
- Test: `tests/unit/botpress/transaction-fast-path.test.ts`
- Test: `tests/contract/botpress-response-parity.test.ts`
- Test: `tests/integration/orchestration-lifecycle.test.ts`

**Interfaces:**
- Consumes: exact active offering `{code, display_name, price_amount, currency, delivery}`.
- Produces these closed renderers in backend and Botpress mirrors:

```ts
renderCourseDuration({ displayName, classes }): string
renderCoursePrice({ displayName, currency, amount }): string
renderCourseModality({ displayName, modality }): string
renderUnknownCertification({ displayName }): string
renderCatalogOptions({ area, names, maxItems: 3 }): string
```

- [ ] **Step 1: Write RED parity and full-pipeline tests**

Cover `Redes Informáticas → 16 clases`, `Decoración de Interiores → 34 clases`, unknown requirements, unknown certification, and an area list of at most three exact offerings. Assert that the committed outbound is not the safe fallback and its manifest verifies.

- [ ] **Step 2: Confirm the tests fail for the current fallback**

```bash
npm test -- tests/unit/orchestration/egress-guard.test.ts tests/unit/botpress/transaction-fast-path.test.ts tests/contract/botpress-response-parity.test.ts
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration -- tests/integration/orchestration-lifecycle.test.ts
```

Expected: at least the real deterministic course response is replaced by `No tengo ese dato confirmado en el catálogo`.

- [ ] **Step 3: Implement and consume the closed renderers**

Render deterministic commercial facts only through the five functions above. Make `materializeCanonicalOfferingFacts` recognize exactly those complete statements; continue rejecting comparators, monthly-price reinterpretations, extra classes, homologation, discounts, and promises.

- [ ] **Step 4: Prove both safe and adversarial behavior**

Add explicit assertions that these remain rejected: `desde USD 360`, `USD 360 por mes`, `16 clases adicionales`, `certificado oficial`, `salida laboral garantizada`, and an offering absent from the snapshot.

- [ ] **Step 5: Run Task 3 gates and commit**

```bash
npm test -- tests/unit/orchestration/egress-guard.test.ts tests/unit/botpress/transaction-fast-path.test.ts tests/contract/botpress-response-parity.test.ts
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration -- tests/integration/orchestration-lifecycle.test.ts
git add src/features/orchestration/domain botpress-agent/src/utils tests
git commit -m "fix: authorize canonical course responses end to end"
```

---

### Task 4: Preserve Exact Course Identity Across Follow-Up Turns

**Files:**
- Modify: `src/features/orchestration/domain/catalog-resolution.ts`
- Modify: `src/features/orchestration/application/claim-batch.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/utils/commercial-router.ts`
- Test: `tests/unit/orchestration/catalog-resolution.test.ts`
- Test: `tests/unit/orchestration/claim-batch.test.ts`
- Test: `tests/unit/botpress/commercial-router.test.ts`
- Test: `tests/integration/claim-context.test.ts`

**Interfaces:**
- Consumes: current batch, recent inbound turns, and one bounded complete business snapshot.
- Produces: `sales_context.offering_code` and `course_of_interest` where current exact selection wins; a referential fact/payment follow-up inherits the latest exact SKU; an explicit new, ambiguous, unavailable, or negated course clears the old SKU.

- [ ] **Step 1: Write RED contrast tests**

Cover these sequences:

```ts
['Quiero Decoración de Interiores', '¿Cuántas clases tiene el programa?'] // keeps decoracion_de_interiores
['Quiero Decoración de Interiores', 'Confirmo 6 cuotas']                 // keeps decoracion_de_interiores
['Quiero Decoración de Interiores', 'Mejor Marketing Digital']          // switches SKU
['Quiero Decoración de Interiores', 'No quiero ese curso']              // clears SKU
['Quiero Fotografía', '¿Cuál de las dos?']                              // remains ambiguous/null
```

- [ ] **Step 2: Confirm RED in resolver, claim, and router**

```bash
npm test -- tests/unit/orchestration/catalog-resolution.test.ts tests/unit/orchestration/claim-batch.test.ts tests/unit/botpress/commercial-router.test.ts
```

- [ ] **Step 3: Classify referential fact/payment text as neutral follow-up**

Keep `CatalogResolution` fail-closed for real availability assertions. Treat `el curso`, `el programa`, fact questions, plan choices, identity messages, greetings, and acknowledgements without a new named offering as follow-ups so `deriveCourseSelection` may recover the last exact historical SKU.

- [ ] **Step 4: Run unit and PostgreSQL claim-context gates**

```bash
npm test -- tests/unit/orchestration/catalog-resolution.test.ts tests/unit/orchestration/claim-batch.test.ts tests/unit/botpress/commercial-router.test.ts
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration -- tests/integration/claim-context.test.ts
```

- [ ] **Step 5: Commit the cross-turn identity fix**

```bash
git add src/features/orchestration botpress-agent/src tests
git commit -m "fix: preserve canonical course identity across follow ups"
```

---

### Task 5: Close the Course-to-Stripe-to-Sheets Transaction

**Files:**
- Modify: `src/features/payments/application/materialize-payment-link-action.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `scripts/run-sheet-projections.ts`
- Modify: `scripts/lib/agent-a-persistence-verifier.ts`
- Test: `tests/unit/payments/payment-link.test.ts`
- Test: `tests/integration/orchestration-lifecycle.test.ts`
- Test: `tests/integration/delivery-attempt-fencing.test.ts`
- Test: `tests/unit/scripts/agent-a-persistence-verifier.test.ts`

**Interfaces:**
- Consumes: exact `offering_code`, canonical `plan_code`, explicit non-deferred payment intent, committed outbound, and durable projection event.
- Produces: exactly one authorized Stripe URL and exactly one Sheets projection for a purchase; repeated confirmation returns an idempotent acknowledgement without a second link or row.

- [ ] **Step 1: Write RED end-to-end tests for `g35_02` semantics**

Assert that course selection followed by `6 cuotas` creates one `send_payment_link` decision with the same SKU, one outbound URL, one payment projection event, and one Sheet row. Repeat the confirmation in a new turn and assert counts remain one.

- [ ] **Step 2: Add deferral contrast tests**

Assert zero link and zero row for `no me mandes el link todavía`, `después`, `solo consultaba`, and `si comprara`; a later explicit `ahora sí, mandámelo` creates exactly one.

- [ ] **Step 3: Run RED tests**

```bash
npm test -- tests/unit/payments/payment-link.test.ts tests/unit/scripts/agent-a-persistence-verifier.test.ts
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration -- tests/integration/orchestration-lifecycle.test.ts tests/integration/delivery-attempt-fencing.test.ts
```

- [ ] **Step 4: Implement only the missing transaction links shown by diagnostics**

Require exact SKU equality at commit, persist the authorized manifest with the outbound, enqueue the projection only after commit, and make the projection key `{conversation_id, offering_code, plan_code, source_decision_id}` idempotent.

- [ ] **Step 5: Run Task 5 gates and commit**

```bash
npm test -- tests/unit/payments/payment-link.test.ts tests/unit/scripts/agent-a-persistence-verifier.test.ts
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration -- tests/integration/orchestration-lifecycle.test.ts tests/integration/delivery-attempt-fencing.test.ts
git add src/features/payments src/lib/services scripts tests
git commit -m "fix: complete idempotent course payment projection"
```

---

### Task 6: Make Persistence Verification Match Durable Reality

**Files:**
- Modify: `scripts/run-agent-a-conversations.ts`
- Modify: `scripts/lib/agent-a-persistence-verifier.ts`
- Test: `tests/unit/scripts/agent-a-persistence-verifier.test.ts`
- Test: `tests/integration/selected-memories.test.ts`
- Test: `tests/integration/jsonb-canonical-persistence.test.ts`

**Interfaces:**
- Consumes: run-scoped conversation IDs, decisions, messages, contacts, selected memories, embedding jobs, and projection rows.
- Produces: per-turn durable evidence that waits for bounded local queues and cannot read another case's data.

- [ ] **Step 1: Write RED tests for bounded queue draining**

Test that verification polls local projection/memory queues until terminal or 10 seconds, scopes every query by exact run/case conversation prefix, and reports the outstanding queue/job rather than generic missing memory.

- [ ] **Step 2: Run focal RED tests**

```bash
npm test -- tests/unit/scripts/agent-a-persistence-verifier.test.ts
```

- [ ] **Step 3: Implement bounded deterministic draining**

After each case, invoke local projection and memory flushes, poll at 250 ms intervals up to 10 seconds, then collect contact, memory, embedding, decision, outbound, and Sheet evidence from the same conversation ID. Do not sleep between already-terminal jobs.

- [ ] **Step 4: Run focal and PostgreSQL persistence gates**

```bash
npm test -- tests/unit/scripts/agent-a-persistence-verifier.test.ts
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration -- tests/integration/selected-memories.test.ts tests/integration/jsonb-canonical-persistence.test.ts
```

- [ ] **Step 5: Commit persistence verification**

```bash
git add scripts tests
git commit -m "fix: verify agent a persistence after bounded queue drain"
```

---

### Task 7: Validate Cheaply Before the Final 50

**Files:**
- Evidence only: `botpress-agent/evals/results/*.json`
- No production code changes during this task unless a failing diagnostic test first demonstrates the defect.

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: three increasingly expensive gates and one final release verdict.

- [ ] **Step 1: Run the three-case diagnostic gate**

```bash
npm run test:agent-a -- \
  --file botpress-agent/evals/personas/studyx-council-50-v1.json \
  --cases g35_01_doce_meses_redes,g35_02_seis_meses_decoracion,g35_04_indeciso_seis_doce_fotografia \
  --transport local --provider groq --verify-db \
  --database-url 'postgresql://postgres@127.0.0.1:55435/studyx_test' \
  --run-id bot-a-diagnostic-final
```

Expected: 3/3, no safe fallback for known facts, one correct link/Sheet row where requested, and no decision rejection.

- [ ] **Step 2: Run the eight-case behavior gate**

```bash
npm run test:agent-a -- \
  --file botpress-agent/evals/personas/studyx-council-50-v1.json \
  --cases g35_01_doce_meses_redes,g35_02_seis_meses_decoracion,g35_12_cambia_curso_catering,g35_16_acepta_llamada_marketing,g35_22_curso_inexistente_python,g35_26_optout_real_unas,g35_27_no_link_todavia_maquillaje,g35_28_retoma_memoria_vino \
  --transport local --provider groq --verify-db \
  --database-url 'postgresql://postgres@127.0.0.1:55435/studyx_test' \
  --run-id bot-a-behavior-8-final
```

Expected: 8/8 with catalog, switch, call, absence, opt-out, payment deferral, and memory contracts all green.

- [ ] **Step 3: Run one 15-case extension gate**

Use the 15 `c50_*` cases only. Expected: 15/15, no hard failures, no ungrounded facts, and no link on deferred intent.

- [ ] **Step 4: Run static gates once in parallel**

```bash
npm run typecheck
npm test
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test' npm run test:integration
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
git diff --check
```

- [ ] **Step 5: Run the final 50 exactly once**

```bash
npm run test:agent-a -- \
  --file botpress-agent/evals/personas/studyx-council-50-v1.json \
  --transport local --provider groq --verify-db \
  --database-url 'postgresql://postgres@127.0.0.1:55435/studyx_test' \
  --run-id bot-a-g1g2-acceptance-final
```

Expected: `total=50`, `passed=50`, `failed=0`, `regression_gate_complete=true`, no unauthorized fact/URL, no duplicate Stripe/Sheets event, and no visible silence except the post-opt-out turn explicitly expecting zero responses.

- [ ] **Step 6: Commit the verified recovery**

```bash
git add botpress-agent scripts src tests docs
git status --short
git commit -m "feat: complete bot a g1 g2 regression recovery"
```

Expected: `.jez/` remains untracked and no push or deploy occurs.

---

## Stop Conditions

- If the same root cause survives three focused implementation attempts, stop and report the three hypotheses, probes, and observed evidence.
- If a fix makes an unsafe commercial statement pass by weakening egress detection, revert that fix and keep the gate red.
- If a provider rate limit occurs, allow the existing single failover; do not start another runner concurrently.
- If the 3-case or 8-case gate is red, do not spend tokens on the 15- or 50-case gate.

## Phase 2 Handoff: WhatsApp Deployment Readiness

The 50/50 acceptance result is the entry gate—not an authorization—to execute
`docs/superpowers/plans/2026-08-25-whatsapp-deployment-readiness.md`. Do not
install a production integration, set production secrets, enable
`automationEnabled`, deploy, or connect a Meta phone number before that gate is
green and the user explicitly authorizes the external changes.

## Expected Outcome

Agent A recognizes exact StudyX courses, answers with short canonical facts, keeps the chosen SKU through follow-ups, offers a call without blocking chat selling, emits Stripe only on explicit non-deferred intent, projects exactly once to Sheets, preserves contact/course memory, respects opt-out, and proves all of it with a 50/50 local report. That result leaves the branch eligible for the separately gated WhatsApp deployment-readiness plan.
