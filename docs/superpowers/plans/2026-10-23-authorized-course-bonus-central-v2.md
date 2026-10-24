# Authorized Course Bonus with Central v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Agent A close a persistent price objection with an authorized related course, freeze that benefit before payment, and complete the paid and bonus courses through one verified Central v2 job.

**Architecture:** Agent A owns semantic interpretation and prose. PostgreSQL owns promotion authorization, delayed-event state, acceptance, and the immutable payment snapshot. The existing correlated Stripe Payment Link and Central worker remain the execution spine; the worker selects schema v1 or v2 for the same endpoint and payment id.

**Tech Stack:** TypeScript, Next.js, PostgreSQL/Supabase, Botpress ADK scheduled events, DeepSeek Agent A, Stripe Payment Links, Central de Carga HMAC API, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-authorized-course-bonus-central-v2.md`

## Global Constraints

- Paid price remains USD 360: 12 × USD 30, 6 × USD 60, or one payment of USD 360.
- Do not call USD 360 a monthly or yearly price.
- Agent A interprets objections and authors prose; backend code validates facts and effects only.
- No gift on a price question or first objection, no price reduction, no invented approval, no false scarcity, no invoice, and no “asesora virtual”.
- Initial mapping is `ingles_1` paid → `ingles_2` bonus, subject to Central's exact configured codes.
- A rejected promotion action never suppresses a safe response.
- A promoted payment uses the same payment id and Central job as its paid course.
- Existing v1 payments and post-sale behavior remain unchanged.
- New promotion offers stay off until Central v2 is committed, deployed, mapped, and tested in Moodle.
- Disabling new offers never discards an already-paid bonus obligation or degrades it to v1.

## Review Focus

- Split messages repeating “caro” are one semantic intervention, not two objections; pin in Task 2.
- An existing static Payment Link reservation replay with a different promotion must fail; pin in Task 4.
- A newer course change during the 60-second wait cancels the offer; pin in Task 3.
- A Central v2 success missing one bonus code is invalid, not partial success; pin in Task 5.
- A verified payment must not announce the gift until the complete v2 result exists; pin in Task 6.

---

### Task 1: Add promotion, offer, follow-up, and payment snapshot state

**Files:**
- Create: `supabase/migrations/20261023010001_authorized_course_bonus_promotions.sql`
- Create: `supabase/migrations/20261023010004_course_bonus_offer_snapshot.sql`
- Create: `src/features/promotions/domain/course-bonus.ts`
- Test: `tests/integration/course-bonus-invariants.test.ts`

**Interfaces:**
- Consumes: `workspaces`, `contacts`, `conversations`, `offerings`, and `payments`.
- Produces: `Promotion`, `PromotionOffer`, `CommercialFollowup`, and `PaymentBonusOffering` rows and typed identifiers.

- [x] **Step 1: Write failing database invariant tests**

Cover same-workspace/distinct offerings, one-to-three gifts, unique promotion code, channel/validity, offer/contact/conversation identity, follow-up idempotency, payment snapshot equality on replay, and mutation refusal after the payment URL can be delivered. Assert against the real initial payment state `reserved`, not the handoff's assumed `pending` state.

- [x] **Step 2: Run the new integration test and verify RED**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/course-bonus-invariants.test.ts`

Expected: FAIL because the tables and types do not exist.

- [x] **Step 3: Implement the additive migration and domain types**

Create `promotions`, `promotion_bonus_offerings`, `promotion_offers`, `commercial_followups`, `payment_bonus_offerings`, and `central_bonus_enrollment_items`. Seed `ingles_1_mas_ingles_2` inactive. Add RLS, orchestrator grants, append-only snapshot protection, due-follow-up leases, and uniqueness by workspace/payment.

- [x] **Step 4: Reset the local database and verify GREEN**

Run: `supabase db reset && npx vitest run --config vitest.integration.config.mts tests/integration/course-bonus-invariants.test.ts && npm run test:db:lint`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/20261023010001_authorized_course_bonus_promotions.sql src/features/promotions/domain/course-bonus.ts tests/integration/course-bonus-invariants.test.ts
git commit -m "feat(promotions): add authorized course bonus state"
```

### Task 2: Give Agent A bounded promotion capabilities and actions

**Files:**
- Create: `src/features/promotions/application/read-course-bonus-capability.ts`
- Modify: `src/features/conversation/domain/agent-a-brain.ts`
- Modify: `src/features/conversation/adapters/agent-a-brain-schema.ts`
- Modify: `botpress-agent/src/schemas/agent-a-brain.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `src/features/orchestration/domain/decision-v4.ts`
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Regenerate: `src/shared/prompts/studyx-agent-a-canonical.generated.ts`
- Regenerate: `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Test: `tests/unit/promotions/course-bonus-capability.test.ts`
- Test: `tests/unit/conversation/agent-a-brain-schema.test.ts`
- Test: `tests/unit/orchestration/decision-v4-policy.test.ts`
- Test: `tests/unit/prompts/canonical-prompt-v2.test.ts`

**Interfaces:**
- Consumes: Task 1 rules/offers and canonical catalog/context.
- Produces: `CourseBonusCapabilityV1`, review/check-in/acceptance proposal actions, and optional `promotion_code` on the active `send_payment_link` contracts.

- [x] **Step 1: Write failing capability, prompt, and schema-parity tests**

Assert: price question and first objection cannot reveal the gift; split-message objection counts semantically once; persistent resistance with exact interest may request review; ambiguous interest clarifies; hidden gift names remain absent before authorization; only a delivered active offer authorizes acceptance and promoted payment.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-capability.test.ts tests/unit/conversation/agent-a-brain-schema.test.ts tests/unit/orchestration/decision-v4-policy.test.ts tests/unit/prompts/canonical-prompt-v2.test.ts`

Expected: FAIL on missing capabilities/actions and the current blanket bonus prohibition.

- [x] **Step 3: Implement the capability projection and all active contract mirrors**

Add strict actions `request_promotion_review`, `schedule_price_objection_checkin`, and `accept_promotion`; extend Agent A's `send_payment_link` and Decision v4 with optional `promotion_code`. Do not add bonus codes, delays, prices, URLs, or identities to model-authored actions.

- [x] **Step 4: Update the canonical prompt and regenerate modules**

Preserve Lisandro's personality, diagnostic sale, objection handling, call behavior, and brevity. Replace the blanket ban only with the configured-promotion path and state that the agent must not name a gift before an authorized result.

- [x] **Step 5: Run tests, prompt generation, and typechecks**

Run: `npm run generate:agent-a-prompt && npx vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-capability.test.ts tests/unit/conversation/agent-a-brain-schema.test.ts tests/unit/orchestration/decision-v4-policy.test.ts tests/unit/prompts/canonical-prompt-v2.test.ts && npm run typecheck && npm --prefix botpress-agent run typecheck`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/features/promotions src/features/conversation src/features/orchestration/domain/decision-v4.ts botpress-agent/src/schemas docs/prompts src/shared/prompts botpress-agent/src/prompts tests/unit
git commit -m "feat(agent-a): authorize configured course bonus offers"
```

### Task 3: Persist and deliver the one-minute commercial review

**Files:**
- Create: `src/features/promotions/application/commercial-followup-service.ts`
- Create: `src/app/api/agent/commercial-followups/[id]/claim/route.ts`
- Create: `src/app/api/agent/commercial-followups/[id]/deliver/route.ts`
- Create: `src/app/api/agent/commercial-followups/[id]/release/route.ts`
- Create: `src/app/api/agent/commercial-followups/[id]/scheduled/route.ts`
- Create: `src/app/api/cron/course-bonus-followups/route.ts`
- Create: `supabase/migrations/20261023010003_course_bonus_followup_dispatch.sql`
- Create: `botpress-agent/src/triggers/commercialFollowup.ts`
- Modify: `botpress-agent/agent.config.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `src/features/conversation/application/commit-agent-turn-v3.ts`
- Modify: `vercel.json`
- Test: `tests/unit/promotions/commercial-followup-service.test.ts`
- Test: `tests/unit/botpress/commercial-followup-trigger.test.ts`
- Test: `tests/integration/course-bonus-followup.test.ts`

**Interfaces:**
- Consumes: Task 2 review/check-in actions and Task 1 rule/offer tables.
- Produces: durable `studyxCommercialFollowup` events and one delivered authorized offer with auditable acceptance state.

- [x] **Step 1: Write failing commit, scheduling, and revalidation tests**

Cover one 60-second review, one optional 10-minute first-objection check-in, duplicate events, crash before/after send, course change, purchase, rejection, opt-out, inactive rule, and a rejected action that still delivers the safe Agent A response.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/promotions/commercial-followup-service.test.ts tests/unit/botpress/commercial-followup-trigger.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/course-bonus-followup.test.ts`

Expected: FAIL because the service/event does not exist.

- [x] **Step 3: Implement atomic action commit and Botpress scheduling**

Commit the ordinary outbound and durable follow-up together. Schedule Botpress after the outbound is accepted and persist the provider event receipt. A minute-level database dispatcher recovers failed or interrupted scheduling with a bounded retry budget. Event payload contains only `followup_id`; claim reloads latest state and promotion facts.

- [x] **Step 4: Implement Agent A follow-up narrative and fenced delivery**

Agent A writes the offer using the lead's goal and authorized course names. Backend-owned delivery records prevent duplicate sends. Cancellation returns `claimed:false` and never fabricates replacement copy.

- [x] **Step 5: Verify GREEN and ADK bundle integrity**

Run the Step 2 command plus `npm --prefix botpress-agent run build && npm --prefix botpress-agent run check`.

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/features/promotions src/app/api/agent/commercial-followups src/features/conversation/application/commit-agent-turn-v3.ts botpress-agent tests
git commit -m "feat(promotions): deliver durable course bonus reviews"
```

### Task 4: Freeze an accepted promotion into the correlated Payment Link

**Files:**
- Modify: `src/features/payments/application/reserve-payment-link.ts`
- Use: `supabase/migrations/20261023010004_course_bonus_offer_snapshot.sql`
- Modify: `src/features/payments/application/materialize-payment-link-action.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/features/payments/application/process-stripe-webhook.ts`
- Test: `tests/unit/payments/payment-link.test.ts`
- Test: `tests/integration/course-bonus-payment-correlation.test.ts`
- Test: `tests/integration/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: Task 2 `promotion_code`, Task 1 accepted offer/rule, and the existing canonical payment reservation.
- Produces: the existing correlated Payment Link plus immutable `payment_bonus_offerings` rows for that payment.

- [x] **Step 1: Write failing reservation and replay tests**

Assert same workspace/contact/conversation/offering/channel, valid accepted offer, snapshot in the same transaction, one-to-three gifts, identical replay success, different-promotion replay failure, flag-off refusal before URL delivery, webhook correlation, and unpromoted flow unchanged.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/payments/payment-link.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/course-bonus-payment-correlation.test.ts tests/integration/stripe-webhook.test.ts`

Expected: FAIL because payment reservation has no promotion input or snapshot.

- [x] **Step 3: Extend `reservePaymentLink` with backend-authorized promotion identity**

Resolve the bonus facts only from the sealed offer snapshot and copy them inside the reservation transaction before returning the URL. Seal the payment snapshot before the URL can leave the transaction, validate the stored promotion set on every idempotent replay, and reject late additions. Store `promotion_code` in the internal payment event; do not make Stripe metadata authoritative.

- [x] **Step 4: Preserve the existing static-link correlation**

Keep `client_reference_id=<payment_id>` and the three configured links. Add a regression proving it survives materialization and signed webhook processing. Do not switch to dynamic live checkout unless this regression fails against the deployed Stripe configuration.

- [x] **Step 5: Run tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/features/payments src/lib/services/decision.service.ts tests/unit/payments/payment-link.test.ts tests/integration/course-bonus-payment-correlation.test.ts tests/integration/stripe-webhook.test.ts
git commit -m "feat(payments): freeze authorized bonus courses"
```

### Task 5: Extend the existing Central worker to schema v2

**Files:**
- Modify: `src/features/fulfillment/central-carga/contract.ts`
- Modify: `src/features/fulfillment/central-carga/client.ts`
- Modify: `src/features/fulfillment/central-carga/config.ts`
- Modify: `src/features/fulfillment/central-carga/worker.ts`
- Create: `supabase/migrations/20261023010002_align_central_bonus_response.sql`
- Modify: `.env.example`
- Test: `tests/unit/fulfillment/central-carga-contract.test.ts`
- Test: `tests/integration/central-carga-enrollment-worker.test.ts`

**Interfaces:**
- Consumes: Task 4 payment snapshots and Lucas contract `cd45ce5`.
- Produces: strict `EnrollmentRequestV2`, `EnrollmentResponseV2`, stored bonus enrollment items, and the existing worker outcome using the same payment id/job/endpoint.

- [x] **Step 1: Write failing v1/v2 contract and worker tests**

Cover v1 unchanged, deterministic gift order, exact response-set validation, 202 polling, identical replay, unknown offering, unsupported version, changed-set 409, timeout/reconciliation, partial Moodle resumption, and one welcome email.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/fulfillment/central-carga-contract.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/central-carga-enrollment-worker.test.ts`

Expected: FAIL because the worker only emits schema v1.

- [x] **Step 3: Implement v2 schema selection and strict response validation**

`buildEnrollmentRequest` reads the payment snapshot, sends v1 when empty and v2 when non-empty, and never reads current promotion/catalog state. `classifyResponse` accepts v2 success only when every requested code appears exactly once and is active.

- [x] **Step 4: Add fail-closed offer/reservation gating and state-aware fulfillment controls**

When `CENTRAL_CARGA_BONUS_ENABLED` is false, Task 4 prevents new offer and link delivery. The worker continues already-paid v2 snapshots while Central is healthy. A separate emergency fulfillment pause moves work to an alerted/manual state and never sends v1. Record specific dead-letter codes without PII.

- [x] **Step 5: Run tests and verify GREEN**

Run the Step 2 command plus `npm run typecheck`.

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/features/fulfillment/central-carga supabase/migrations/20261023010002_align_central_bonus_response.sql .env.example tests/unit/fulfillment/central-carga-contract.test.ts tests/integration/central-carga-enrollment-worker.test.ts
git commit -m "feat(fulfillment): enroll paid and bonus courses atomically"
```

### Task 6: Confirm the gift only from verified Central v2 evidence

**Files:**
- Modify: `src/features/fulfillment/post-sale/service.ts`
- Modify: `botpress-agent/src/triggers/postSale.ts`
- Modify: `botpress-agent/src/utils/post-sale-instructions.ts`
- Test: `tests/unit/fulfillment/post-sale.test.ts`
- Test: `tests/unit/botpress/post-sale-trigger.test.ts`
- Test: `tests/integration/post-sale.test.ts`

**Interfaces:**
- Consumes: Task 5 verified bonus enrollment items and Task 4 payment snapshot.
- Produces: deterministic paid/bonus course confirmation plus existing campus credentials and official contacts.

- [x] **Step 1: Write failing post-sale tests**

Cover no gift, promoted payment still processing, missing/extra/wrong gift response, complete v2 success, existing student, duplicate notification, protected-fact filtering, and no invoice.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/fulfillment/post-sale.test.ts tests/unit/botpress/post-sale-trigger.test.ts && npx vitest run --config vitest.integration.config.mts tests/integration/post-sale.test.ts`

Expected: FAIL because post-sale currently sees only one offering.

- [x] **Step 3: Add verified deterministic bonus blocks**

Name the gift only when a valid complete v2 result exists. Keep Agent A's intro natural, but keep course entitlement, campus, user, password, and official contacts backend-authored and protected.

- [x] **Step 4: Run tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/fulfillment/post-sale botpress-agent/src/triggers/postSale.ts botpress-agent/src/utils/post-sale-instructions.ts tests/unit/fulfillment tests/unit/botpress tests/integration/post-sale.test.ts
git commit -m "feat(post-sale): confirm verified course gifts"
```

### Task 7: Extend the existing voice bridge and run guarded rollout

**Files:**
- Modify: `src/features/calls/application/retell-tools.ts`
- Modify: `src/features/calls/adapters/postgres-retell-orchestration-store.ts`
- Modify: `src/features/payments/application/reserve-payment-link.ts`
- Create: `tests/workflow/agent-a-course-bonus-negotiation.test.ts`
- Modify: `tests/integration/retell-five-tools-postgres.test.ts`
- Modify: `tests/unit/calls/retell-tools.test.ts`
- Modify: `tests/unit/calls/retell-five-tools.test.ts`
- Modify: `docs/contracts/agent-a-b-shared-orchestrator-v1.md`
- Modify: `docs/PILOT_MATRIX.md`
- Modify: `docs/runbooks/whatsapp-go-live.md`

**Interfaces:**
- Consumes: Tasks 1–6 and Lucas's deployed Central v2.
- Produces: promotion-aware `consultar_oferta`, existing `enviar_link_pago` handoff with promotion identity, end-to-end evidence, and reversible production enablement.

- [x] **Step 1: Write failing voice-bridge and workflow tests**

Assert voice can discover only active voice-channel promotions, an accepted promotion reaches the existing WhatsApp payment-link bridge, no invented gift is accepted, and the full WhatsApp negotiation/payment/v2/post-sale flow passes.

- [x] **Step 2: Implement the minimal voice propagation**

Extend the existing tools/store inputs with backend-authorized `promotion_code`. Freeze the exact gift set when the correlated `consultar_oferta` exposes it, reuse an already delivered text snapshot, and require that same sealed offer when `enviar_link_pago` accepts it. Do not create a second voice checkout path.

- [x] **Step 3: Run targeted and full release gates**

Run:

```bash
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-course-bonus-negotiation.test.ts
npx vitest run --config vitest.integration.config.mts tests/integration/course-bonus-invariants.test.ts tests/integration/course-bonus-followup.test.ts tests/integration/course-bonus-payment-correlation.test.ts tests/integration/central-carga-enrollment-worker.test.ts tests/integration/post-sale.test.ts tests/integration/agent-a-call-handoff.test.ts tests/integration/retell-five-tools-postgres.test.ts
npm run typecheck
npm run lint
npm run build
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run build
npm --prefix botpress-agent run check
```

Expected: PASS.

- [ ] **Step 4: Verify Lucas's external release evidence**

Require a Central commit/deploy identifier, mapped `ingles_1`/`ingles_2`, successful Moodle E2E, idempotent replay, and partial-failure recovery. Do not enable from a verbal “implemented” statement.

- [ ] **Step 5: Deploy disabled, canary, and enable**

Deploy migrations, backend, and Botpress ADK with `CENTRAL_CARGA_BONUS_ENABLED=false`; smoke v1; activate only the English promotion; run one supervised WhatsApp purchase through v2; then enable the flag.

- [ ] **Step 6: Roll back on false offer, silence, wrong snapshot, or unverifiable access**

Disable the flag and promotion. Preserve payment/audit evidence and complete any accepted customer benefit manually; do not erase rows or silently discard a promise.

- [ ] **Step 7: Commit release evidence**

```bash
git add src/features/calls tests/workflow tests/integration/agent-a-call-handoff.test.ts docs/PILOT_MATRIX.md docs/runbooks/whatsapp-go-live.md docs/reports/evidence
git commit -m "test(promotions): verify Central v2 course bonus release"
```
