# Agent A Direct Multi-Course Bonus V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the new StudyX sales prompt and direct bonus architecture so Agent A can naturally offer one to three relevant courses in successive customer turns, preserve early call invitations, collect payment for the unchanged USD 360 paid course, and fulfill every promised course without silent failures.

**Architecture:** Keep Agent A as the sole owner of commercial interpretation and customer-facing copy. Add a versioned, append-only promotion package that the backend validates and persists atomically before physical delivery; seal the exact package on acceptance and attach only that version to checkout. Roll out additively behind a review/direct mode flag so the current flow remains a safe rollback path while direct offers are canaried.

**Tech Stack:** TypeScript 5.9, Next.js 16, Botpress ADK, Zod/Zui mirrored schemas, PostgreSQL/Supabase migrations, Vitest, Stripe Payment Links, Central de Carga v2, Retell/Xendra voice bridge.

**Spec:** `/Users/tmaneyro22/Downloads/spec-backend-bonificacion.md`

**Commercial prompt source:** `/Users/tmaneyro22/Downloads/prompt-agente-a-studyx-v2.md`

**Prior safety contract:** `docs/superpowers/specs/2026-10-23-authorized-course-bonus-central-v2.md`

## Global Constraints

- Agent A interprets the sales stage, price resistance, affinity and timing; the backend never classifies customer prose or writes sales copy.
- The paid price remains USD 360: 12 payments of USD 30, 6 payments of USD 60, or one payment of USD 360.
- Exact payment plans may be stated neutrally when requested or when a real budget limit is known; never call them cheap, small, light, “only”, or compare them with daily spending.
- A first price question or first objection never unlocks a bonus. Direct bonus eligibility requires a price objection committed by an earlier customer turn.
- Offer at most one new bonus course per customer turn, never the paid course, never a duplicate, and never more than the configured maximum of three.
- A second or third bonus requires a new customer message after the preceding bonus outbound.
- Existing bonus rows are append-only. A later offer may add a course but may never remove, replace or reorder a course already shown.
- `accept_promotion` accepts and seals the exact `offer_version` whose outbound delivery was confirmed by the channel and to which the customer replied later. Checkout may consume only that sealed version.
- Changing the paid course cancels the open promotion cycle and starts a new one; historical, accepted, attached and paid records remain auditable.
- A rejected or failed bonus effect must never cause silence: the same Agent A rewrites without the unauthorized promise and preserves the useful conversational answer.
- Preserve the current early-call policy: first relevant doubt may produce `response.call_offer` even without an exact course. A call does not replace the WhatsApp answer.
- Preserve Lisandro's natural WhatsApp behavior, one main question, one or two short messages, adaptive tú/vos, no passive-aggressive limits, no invented urgency, income, employment or official accreditation.
- Remove the fixed claim “creada por profesionales del área” unless it becomes an authorized catalog fact.
- No invoice is generated or mentioned.
- Existing accepted, attached or paid direct promotions continue through payment and fulfillment if the global mode is rolled back from `direct` to `review`.
- Rollback disables creation of new direct offers but keeps the new dual-mode ADK active; never restore a bundle that cannot understand versioned direct packages.

## Review Focus

- Two concurrent offers near the three-course limit must produce one append and one structured rejection, never four courses or two messages promising the same course.
- Accepting an older `offer_version` after another course was added must fail and trigger an Agent A rewrite against the current package.
- Changing course after checkout was sent must supersede the old conversational path without losing reconciliation if the old payment later arrives.
- A paid package with one failed bonus enrollment must keep payment confirmed, retry only pending courses, create a durable human case when exhausted, and never claim complete access early.
- Rolling back to review mode with direct offers in `offer_available`, `accepted` and `attached` states must preserve their existing payment and fulfillment obligations.

---

### Task 1: Additive Direct-Bonus Contracts and Rollout Configuration

**Files:**
- Create: `src/features/promotions/application/course-bonus-flow-config.ts`
- Modify: `.env.example`
- Modify: `src/features/promotions/domain/course-bonus.ts`
- Modify: `src/features/conversation/domain/agent-a-brain.ts`
- Modify: `src/features/conversation/adapters/agent-a-brain-schema.ts`
- Modify: `botpress-agent/src/schemas/agent-a-brain.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Test: `tests/unit/promotions/course-bonus-flow-config.test.ts`
- Test: `tests/contract/agent-a-brain-parity.test.ts`
- Test: `tests/unit/conversation/agent-a-brain-schema.test.ts`

**Interfaces:**
- Produces: `CourseBonusFlowModeV1 = 'review' | 'direct'`.
- Produces: `loadCourseBonusFlowConfig()` returning `{ mode, maxBonusCourses }`, with `COURSE_BONUS_FLOW_MODE=review|direct` defaulting to `review` and `COURSE_BONUS_MAX_COURSES=1|2|3` required for direct mode.
- Produces: additive capability fields `enabled` and `max_bonus_courses` while retaining legacy review fields during cutover.
- Produces: `commercial_state.promotion` with `promotion_code`, `promotion_cycle_id`, `offer_version`, status, paid-course identity, ordered bonuses, and `accepted_at`.
- Produces: `offer_course_bonus` and the versioned direct form of `accept_promotion`; legacy `accept_promotion` remains valid only in review mode.

- [ ] **Step 1: Write failing parity and configuration tests**

Pin the new fields and actions in both schema mirrors; assert invalid modes, limits outside 1–3 and direct mode without an explicit limit fail closed.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-flow-config.test.ts tests/contract/agent-a-brain-parity.test.ts tests/unit/conversation/agent-a-brain-schema.test.ts`

Expected: FAIL because the direct fields and actions do not exist.

- [ ] **Step 3: Implement the additive types, schema mirrors and configuration loader**

Use the real proposal shape: `proposed_action` remains an object discriminated by `type`; `move` remains `ConversationMoveV1`, never the simplified string shape shown in the external spec.

- [ ] **Step 4: Run focused tests, typecheck and lint**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-flow-config.test.ts tests/contract/agent-a-brain-parity.test.ts tests/unit/conversation/agent-a-brain-schema.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(promotions): add direct course bonus contracts`

---

### Task 2: Versioned Append-Only Promotion Package

**Files:**
- Create: `supabase/migrations/20261028010001_direct_multi_course_bonus.sql`
- Modify: `tests/integration/course-bonus-invariants.test.ts`
- Test: `tests/integration/direct-course-bonus-persistence.test.ts`

**Interfaces:**
- Consumes: direct contract names from Task 1.
- Produces: a promotion-cycle identity distinct from permanent `conversation + paid course` identity.
- Produces: ordered bonus rows carrying `source_turn_id`, `offered_at`, `offered_outbound_message_id`, confirmed channel `delivered_at` and `offer_version`.
- Produces: database constraints for one course per source turn, no duplicate course, positions 1–3 and append-only history.
- Produces: sealing on acceptance rather than first offer; sealed packages reject further appends.

- [ ] **Step 1: Write migration invariant tests**

Cover first append, delivery confirmation, second/third append only after a distinct customer turn later than the confirmed prior delivery, duplicate course, repeated source turn, fourth append, append after seal, cancellation and a new cycle after switching away and back to the same paid course. Include an offer whose delivery is pending or failed and prove it cannot be accepted or extended.

- [ ] **Step 2: Run integration tests and confirm RED**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-persistence.test.ts tests/integration/course-bonus-invariants.test.ts`

Expected: FAIL because the current first-course snapshot seals immediately.

- [ ] **Step 3: Implement the migration**

Preserve existing immutable rows. Permit only new append operations while the offer is open, increment `offer_version` atomically, and leave `bonus_snapshot_sealed_at` null until acceptance. Correlate each version with its outbound delivery state; channel submission alone is not delivery. Backfill legacy offered/accepted packages as sealed version 1 using their existing delivery evidence, and quarantine ambiguous records for reconciliation instead of assuming delivery.

- [ ] **Step 4: Verify clean migration and database invariants**

Run: `supabase db reset && npm run test:db:lint && npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-persistence.test.ts tests/integration/course-bonus-invariants.test.ts`

Expected: PASS with no database lint errors.

- [ ] **Step 5: Commit**

Commit: `feat(promotions): add versioned bonus packages`

---

### Task 3: Atomic Direct Offer and Acceptance Service

**Files:**
- Create: `src/features/promotions/application/direct-course-bonus-service.ts`
- Modify: `src/features/promotions/application/commercial-followup-service.ts`
- Test: `tests/unit/promotions/direct-course-bonus-service.test.ts`
- Test: `tests/integration/direct-course-bonus-service.test.ts`

**Interfaces:**
- Consumes: versioned tables from Task 2.
- Produces: `offerDirectCourseBonusV1(db, input): Promise<DirectCourseBonusResultV1>`.
- Produces: `acceptDirectCourseBonusV1(db, input): Promise<AcceptDirectCourseBonusResultV1>`.
- Rejection reasons: `bonus_disabled`, `no_price_objection`, `invalid_offering`, `same_as_paid_course`, `duplicate_bonus`, `bonus_limit_reached`, `multiple_bonus_in_turn`, `bonus_without_reply`, `sale_already_closed`, `stale_offer_version`.

- [ ] **Step 1: Write failing service tests**

Pin all nine external-spec validation cases plus idempotent replay, two concurrent appends near the limit, acceptance of a stale version and acceptance/sealing of the current delivered version. Add pending/failed outbound delivery and a customer message arriving before delivery confirmation; neither may accept nor extend that version.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/direct-course-bonus-service.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement `offerDirectCourseBonusV1`**

Lock the open promotion cycle with `SELECT ... FOR UPDATE`, revalidate workspace/contact/conversation/course identities and the committed prior objection count, return the original result on exact replay, and require the previous version's confirmed delivery plus a later customer reply before appending another course. Append one course, increment the version, and never seal during offering.

- [ ] **Step 4: Implement `acceptDirectCourseBonusV1`**

Require matching promotion code, paid course, cycle and current version, confirmed channel delivery for that exact version, and a later correlated customer response; update `accepted`, `accepted_at`, accepted version and `bonus_snapshot_sealed_at` in one transaction. A submitted, pending or failed outbound is not acceptable evidence.

- [ ] **Step 5: Run tests and static gates**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/direct-course-bonus-service.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-service.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat(promotions): persist direct bonus offers atomically`

---

### Task 4: Agent Context Projection, Authorization and No-Silence Repair

**Files:**
- Modify: `src/features/promotions/application/read-course-bonus-capability.ts`
- Modify: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Modify: `src/features/conversation/application/prepare-agent-turn-v2.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/features/conversation/domain/turn-rejection.ts`
- Modify: `botpress-agent/src/schemas/turn-rejection.ts`
- Test: `tests/unit/promotions/course-bonus-capability.test.ts`
- Test: `tests/unit/conversation/agent-turn-policy-v2.test.ts`
- Test: `tests/unit/conversation/prepare-agent-turn-v2.test.ts`
- Test: `tests/integration/agent-turn-direct-bonus-commit.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: direct capabilities and current promotion package in Agent A context.
- Produces: preliminary policy authorization plus final transactional revalidation.
- Produces: structured rejection mapped to `FACT_VALUE_MISMATCH:forbidden_promise` with a machine-readable direct-bonus reason.
- Produces: same-agent repair without bonus wording when the effect is rejected.

- [ ] **Step 1: Write failing context and policy tests**

Assert that the first objection cannot offer and a committed earlier objection can. Authorize the response to recap the union of the already delivered package and the one newly validated course, never unrelated catalog courses. When an attempted expansion is invalid, preserve the already delivered bonuses and the non-promotional answer while removing only the unauthorized new course.

- [ ] **Step 2: Write the atomic commit/recovery test**

Simulate a final transactional rejection after preliminary authorization. Assert no outbound containing the promise is committed, Agent A receives one structured repair opportunity, and the repaired useful response is delivered rather than silence.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-capability.test.ts tests/unit/conversation/agent-turn-policy-v2.test.ts tests/unit/conversation/prepare-agent-turn-v2.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/agent-turn-direct-bonus-commit.test.ts`

Expected: FAIL on missing direct authorization and repair behavior.

- [ ] **Step 4: Implement projection and authorization**

Keep backend validation semantic-free: use Agent A's committed `price_objection` evidence and proposed catalog identities; do not parse customer prose in the backend.

- [ ] **Step 5: Integrate direct persistence into the existing serializable decision transaction**

Reserve the package before physical outbound delivery and bind the committed outbound identity in the same transaction, but keep the version non-acceptable and non-expandable until the channel confirms delivery. Update delivery evidence idempotently from the existing outbound-status path. Abort the whole decision if the direct effect cannot be persisted. Route predictable rejection through the existing one-rewrite path, preserving prior valid bonuses; route exhausted serialization through durable recovery.

- [ ] **Step 6: Run tests and existing rejection/silence regressions**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-capability.test.ts tests/unit/conversation/agent-turn-policy-v2.test.ts tests/unit/conversation/prepare-agent-turn-v2.test.ts tests/unit/botpress/agent-a-action-feedback.test.ts tests/unit/botpress/recovery-feedback.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/agent-turn-direct-bonus-commit.test.ts tests/integration/agent-turn-partial-veto-transition.test.ts`

Expected: PASS; no existing silence recovery contract changes unexpectedly.

- [ ] **Step 7: Commit**

Commit: `feat(agent-a): authorize direct bonus negotiation`

---

### Task 5: Promotion Acceptance, Course Changes and Checkout Correlation

**Files:**
- Modify: `src/features/conversation/application/prepare-agent-turn-v2.ts`
- Modify: `src/features/promotions/application/commercial-followup-service.ts`
- Modify: `src/features/payments/application/reserve-payment-link.ts`
- Modify: `src/lib/services/decision.service.ts`
- Test: `tests/integration/course-bonus-payment-correlation.test.ts`
- Test: `tests/integration/direct-course-bonus-checkout.test.ts`

**Interfaces:**
- Consumes: accepted sealed package from Task 3.
- Produces: checkout authorization tied to `promotion_code`, cycle, paid offering and accepted `offer_version`.
- Produces: explicit supersession behavior for a sent but unpaid link after course change.

- [ ] **Step 1: Write failing acceptance and checkout tests**

Cover 1, 2 and 3 bonuses; mismatched course; stale version; duplicate link request; course change before acceptance; course change after acceptance; and course change after checkout reservation.

- [ ] **Step 2: Add the late-payment reconciliation test**

When an old superseded payment reference later becomes paid, assert the system keeps the signed payment evidence but does not silently enroll the newly selected course or attach a different promotion; create a manual reconciliation case.

- [ ] **Step 3: Run integration tests and confirm RED**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-checkout.test.ts tests/integration/course-bonus-payment-correlation.test.ts`

Expected: FAIL on version and course-change handling.

- [ ] **Step 4: Implement exact-package checkout and supersession**

Reuse the existing immutable copy into `payment_bonus_offerings`; never rebuild from the catalog. Existing attached or paid packages remain consumable during mode rollback.

- [ ] **Step 5: Run tests and static gates**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-checkout.test.ts tests/integration/course-bonus-payment-correlation.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat(payments): bind checkout to accepted bonus version`

---

### Task 6: Central V2 Multi-Course Fulfillment and Durable Human Cases

**Files:**
- Create: `supabase/migrations/20261028010002_bonus_fulfillment_cases.sql`
- Create: `src/features/fulfillment/central-carga/manual-case.ts`
- Modify: `src/features/fulfillment/central-carga/contract.ts`
- Modify: `src/features/fulfillment/central-carga/client.ts`
- Modify: `src/features/fulfillment/central-carga/worker.ts`
- Modify: `src/features/fulfillment/post-sale/service.ts`
- Test: `tests/unit/fulfillment/central-carga-contract.test.ts`
- Test: `tests/integration/central-carga-enrollment-worker.test.ts`
- Test: `tests/integration/post-sale.test.ts`

**Interfaces:**
- Consumes: immutable `payment_bonus_offerings` from Task 5.
- Produces: per-course enrollment evidence and retries only for courses not yet verified.
- Produces: one durable, idempotent human case per payment when retryable recovery is exhausted.
- Produces: post-sale access messaging only after every promised course is verified active.

- [ ] **Step 1: Write failing 1–3 course and partial-result tests**

Pin new and existing student cases, idempotent replay, one failed bonus among three, retry of only the pending item, exhausted retries and no premature complete-access message.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/fulfillment/central-carga-contract.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/central-carga-enrollment-worker.test.ts tests/integration/post-sale.test.ts`

Expected: FAIL on partial per-course recovery and durable human case.

- [ ] **Step 3: Implement per-course evidence and manual case persistence**

Keep the payment confirmed even when fulfillment is incomplete. A human case records expected, active and pending course codes without exposing credentials or secrets.

- [ ] **Step 4: Update post-sale completeness and copy inputs**

The backend supplies only verified immutable course names. Agent A retains conversational wording; no access-ready claim is emitted until the package is complete.

- [ ] **Step 5: Run all fulfillment tests**

Run: `npx vitest run --config vitest.config.mts tests/unit/fulfillment/central-carga-contract.test.ts tests/unit/fulfillment/central-carga.test.ts tests/unit/fulfillment/post-sale.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/central-carga-enrollment-worker.test.ts tests/integration/post-sale.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat(fulfillment): recover partial bonus enrollment`

---

### Task 7: Shared Voice Promotion Continuity

**Files:**
- Modify: `src/features/calls/adapters/postgres-retell-orchestration-store.ts`
- Modify: `docs/contracts/agent-a-b-shared-orchestrator-v1.md`
- Test: `tests/integration/retell-orchestration-store.test.ts`
- Test: `tests/integration/direct-course-bonus-voice.test.ts`

**Interfaces:**
- Consumes: versioned direct promotion state from Tasks 2–5.
- Produces: read-only exposure of the current direct package to Agent B and versioned acceptance before `enviar_link_pago`.

- [ ] **Step 1: Write failing continuity tests**

Cover a text-offered package continued by voice, voice acceptance of the current version, rejection of an older version, no mutation after acceptance and successful payment-link return to the original text conversation.

- [ ] **Step 2: Run integration tests and confirm RED**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-voice.test.ts tests/integration/retell-orchestration-store.test.ts`

Expected: FAIL because voice currently assumes the original sealed-review flow.

- [ ] **Step 3: Implement shared promotion reads and acceptance**

Agent B may explain or accept the current package but must not invent or append bonus courses. Keep one promotion cycle across chat and call.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-voice.test.ts tests/integration/retell-orchestration-store.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(voice): preserve direct bonus package across calls`

---

### Task 8: Merge the New Sales Prompt with the Existing Brain

**Files:**
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Modify: `scripts/generate-agent-a-prompt-module.mjs`
- Regenerate: `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Regenerate: `src/shared/prompts/studyx-agent-a-canonical.generated.ts`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Modify: `botpress-agent/src/lib/conversation/sales-objection-turn-policy.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-brain.ts`
- Test: `tests/unit/botpress/agent-a-brain-prompt.test.ts`
- Test: `tests/unit/botpress/sales-objection-turn-policy.test.ts`
- Test: `tests/unit/botpress/agent-a-brain.test.ts`
- Test: `tests/unit/botpress/resolve-agent-a-plannerless.test.ts`

**Interfaces:**
- Consumes: direct action/context contract from Tasks 1 and 4.
- Produces: canonical prompt v98+ and brain v132+ with synchronized hash/version pins.
- Produces: neutral exact-plan handling and authorized same-turn bonus wording.

- [ ] **Step 1: Write failing prompt and brain tests**

Pin discovery, personalized value, trial closes, friendly objection handling, direct 1→2→3 negotiation, no first-objection gift, no passive aggression, no unauthorized course, early call invitation and one-main-question behavior.

- [ ] **Step 2: Write price-policy tests**

Allow “podés elegir 12 pagos de USD 30” only for a direct payment question or proven budget limit. Reject “son sólo USD 30”, “es la cuota más barata”, daily comparisons and sterile repetition of the plan.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain-prompt.test.ts tests/unit/botpress/sales-objection-turn-policy.test.ts tests/unit/botpress/agent-a-brain.test.ts tests/unit/botpress/resolve-agent-a-plannerless.test.ts`

Expected: FAIL on the new direct and price rules.

- [ ] **Step 4: Adapt, do not paste, the supplied prompt**

Preserve the current call section and operational contracts. Incorporate the stronger sales mindset, discovery, value, trial closes, objection ladder and course affinity guidance. Remove unsupported facts, the obligation to close every turn, and the treatment of every “me interesa” as confirmed purchase.

- [ ] **Step 5: Update dynamic brain guidance and validation**

An authorized `offer_course_bonus` temporarily authorizes the union of active catalog names already delivered in the current package plus exactly the new validated course, so Agent A can recap the full offer. A rejected expansion removes only the unauthorized addition while preserving prior valid bonus wording and the useful conversational answer.

- [ ] **Step 6: Regenerate prompt modules and run all prompt gates**

Run: `npm run generate:agent-a-prompt && npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain-prompt.test.ts tests/unit/botpress/sales-objection-turn-policy.test.ts tests/unit/botpress/agent-a-brain.test.ts tests/unit/botpress/resolve-agent-a-plannerless.test.ts tests/contract/agent-a-brain-parity.test.ts && npm run typecheck && npm run lint`

Expected: PASS with new prompt SHA, line count and versions deliberately pinned.

- [ ] **Step 7: Commit**

Commit: `feat(agent-a): adopt direct bonus sales behavior`

---

### Task 9: End-to-End Commercial Regression Matrix

**Files:**
- Create: `tests/workflow/agent-a-direct-course-bonus-negotiation.test.ts`
- Modify: `tests/workflow/agent-a-course-bonus-negotiation.test.ts`
- Modify: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`
- Modify: `tests/integration/course-bonus-followup.test.ts`
- Create: `docs/reports/2026-10-28-agent-a-direct-bonus-verification.md`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: complete evidence from customer message through Agent A, persistence, payment, Central and post-sale.

- [ ] **Step 1: Implement the direct negotiation workflow**

Exercise: interest without formal course selection, first price objection, personalized value, repeated objection, first bonus in the same response, customer reply, second and third bonuses, rejected fourth bonus with useful reply, acceptance, data confirmation, payment link, paid webhook and all-course access.

- [ ] **Step 2: Add non-happy workflows**

Cover direct price question, real inability to pay, call invitation during negotiation, customer declining the call, course change, opt-out, duplicate inbound delivery, concurrent offer, stale version acceptance, offer persisted with pending/failed channel delivery, a customer message arriving before delivery confirmation, late payment and one failed bonus enrollment.

- [ ] **Step 3: Run workflow and integration gates**

Run: `npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-direct-course-bonus-negotiation.test.ts tests/workflow/agent-a-course-bonus-negotiation.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/course-bonus-followup.test.ts tests/integration/course-bonus-payment-correlation.test.ts tests/integration/direct-course-bonus-checkout.test.ts tests/integration/central-carga-enrollment-worker.test.ts tests/integration/post-sale.test.ts`

Expected: PASS; every inbound commercial turn ends in a delivered answer or durable recovery record.

- [ ] **Step 4: Run project-wide gates and record evidence**

Run: `npm run test:unit && npm run test:integration && npm run typecheck && npm run lint && npm run build`

Expected: PASS. Record exact commands, counts, commit SHA and any external gate still pending in the verification report.

- [ ] **Step 5: Commit**

Commit: `test(agent-a): verify direct multi-course bonus flow`

---

### Task 10: Safe Backend, Botpress and Production Cutover

**Files:**
- Modify: `docs/runbooks/whatsapp-go-live.md`
- Create: `docs/runbooks/direct-course-bonus-v2-cutover.md`
- Modify: `docs/handoffs/curso-de-regalo-en-el-alta.md`
- Modify: `tests/unit/docs/agent-a-brain-canary.test.ts`

**Interfaces:**
- Consumes: verified release from Task 9.
- Produces: reversible production rollout with explicit backend/ADK order and evidence gates.

- [ ] **Step 1: Document the compatibility deployment order**

Deploy migrations and the additive backend with `COURSE_BONUS_FLOW_MODE=review`; verify old Botpress remains compatible. Publish the new ADK bundle, then switch direct mode only for contacts already allowed by `CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS` while global bonus enablement remains off.

- [ ] **Step 2: Define canary acceptance gates**

Require all seven external-spec cases plus: concurrent near-limit offers, stale-version acceptance, course change with prior checkout, partial enrollment, rollback with offered/accepted/attached direct packages, and a real no-silence trace.

- [ ] **Step 3: Define rollback behavior**

Switch creation of new offers back to review mode while keeping the new dual-mode ADK bundle active. Continue accepting, charging and fulfilling already-created direct packages. Never restore an ADK that does not understand `commercial_state.promotion` and versioned acceptance unless a separately tested compatibility adapter exists. Never delete migrations, cancel accepted obligations or reinterpret direct packages as review jobs.

- [ ] **Step 4: Verify Botpress bundle and release manifest**

Run: `cd botpress-agent && npx adk check --format json`

Run: `npm run release:manifest`

Expected: ADK check succeeds and the release manifest identifies the tested backend and prompt/brain versions.

- [ ] **Step 5: Obtain the external Central gate before global enablement**

Confirm Central v2 is deployed, handles 1–3 bonus courses for new and existing students, replays idempotently, and resumes a partial Moodle failure without duplicate enrollment or email.

- [ ] **Step 6: Commit**

Commit: `docs(release): add direct bonus production cutover`

---

## Final Release Gate

- Backend and Botpress schema parity is green.
- Prompt source, generated modules, brain version and release manifest match.
- No direct bonus is available on a first price question or first objection.
- Direct offers 1, 2 and 3 are persisted before physical delivery and survive retry without duplication.
- Every rejection produces a useful Agent A response or a durable recovery record; no plain silence.
- Acceptance seals the exact version whose channel delivery is confirmed and followed by a correlated customer reply; checkout copies only that version.
- Course-change and late-payment paths cannot enroll the wrong package.
- Central verifies every paid and bonus course before access-ready messaging.
- Partial fulfillment creates a durable human case without reversing payment confirmation.
- Early calls, intake confirmation, payment verification, campus access and no-invoice rules remain green.
- Canary evidence is reviewed before global enablement.
