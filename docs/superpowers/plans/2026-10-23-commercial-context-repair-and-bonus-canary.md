# Commercial Context Repair and Bonus Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist the actual course/price-objection context, stop repeated
`forbidden_promise` rewrites, and activate the existing Inglés 1 + Inglés 2
promotion for a single production canary without changing silence behavior.

**Architecture:** Agent A owns interpretation and prose. Accepted structured
course references, plus a deterministic single-canonical-course reference in
Agent A's own response, feed durable promotion context. Structured rejection
receipts give Agent A precise repair guidance. A contact allowlist fences every
promotion entry point while the global feature flag stays off.

**Spec:** `docs/superpowers/specs/2026-10-23-commercial-context-repair-and-bonus-canary.md`

### Task 1: Persist canonical commercial interest and objections

**Files:**
- Modify: `src/features/orchestration/domain/canonical-offering-egress.ts`
- Modify: `src/features/conversation/application/prepare-agent-turn-v2.ts`
- Modify: `src/features/promotions/application/read-course-bonus-capability.ts`
- Test: `tests/unit/conversation/prepare-agent-turn-v2.test.ts`
- Test: `tests/integration/course-bonus-followup.test.ts`

- [x] Add RED tests for a response that names exactly one canonical course,
  model-owned `price_objection`, no formal selection, and same-turn replay.
- [x] Add a narrow canonical-response resolver and use it only as a fallback
  after structured `course_reference`.
- [x] Make context recording idempotent for the same `source_turn_id`.
- [x] Verify course changes reset the objection counter and selection stays
  null.

### Task 2: Make `forbidden_promise` repair actionable

**Files:**
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Regenerate: `src/shared/prompts/studyx-agent-a-canonical.generated.ts`
- Regenerate: `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Test: `tests/unit/botpress/agent-a-brain-prompt.test.ts`
- Test: `tests/unit/botpress/agent-a-action-feedback.test.ts`

- [x] Add RED tests for an unavailable-promo repair and an authorized review
  repair.
- [x] Add exact `forbidden_promise` guidance without customer-facing canned
  copy.
- [x] Remove the turn-specific contradiction that bans an already-authorized
  bonus offer.
- [x] Bump prompt versions and regenerate both mirrors.

### Task 3: Fence a one-contact promotion canary

**Files:**
- Modify: `src/features/fulfillment/central-carga/config.ts`
- Modify: `src/features/promotions/application/read-course-bonus-capability.ts`
- Modify: `src/features/promotions/application/commercial-followup-service.ts`
- Modify: `src/features/payments/application/reserve-payment-link.ts`
- Modify: `src/features/calls/adapters/postgres-retell-orchestration-store.ts`
- Modify: `src/features/fulfillment/central-carga/worker.ts`
- Modify: `.env.example`
- Test: `tests/unit/promotions/course-bonus-capability.test.ts`
- Test: `tests/integration/course-bonus-followup.test.ts`
- Test: `tests/integration/course-bonus-payment-correlation.test.ts`
- Test: `tests/integration/central-carga-enrollment-worker.test.ts`

- [ ] Add RED tests proving global-off/non-canary denial and exact-canary
  permission across capability, actions, payment, and fulfillment.
- [ ] Implement one shared contact-scope policy and replace direct global-flag
  checks at every promotion entry point.
- [ ] Keep normal enrollments and already-paid obligations unchanged.

### Task 4: Regression, deploy, and canary readiness

**Files:**
- Modify: `tests/workflow/agent-a-course-bonus-negotiation.test.ts`
- Modify: deployment environment and the existing promotion row operationally

- [ ] Replay the observed commercial sequence and verify interest, two
  objections, review request, authorized offer, acceptance, and immutable
  payment snapshot.
- [ ] Run focused unit/integration/workflow suites, typecheck, build, and
  `adk check --format json`.
- [ ] Deploy backend with the global flag off and the 4497 contact UUID as the
  sole canary; publish Botpress through ADK.
- [ ] Activate the existing `ingles_1_mas_ingles_2` row and verify non-canary
  denial plus canary capability from production reads.
- [ ] Do not reset contacts, send WhatsApp messages, or create payments as part
  of deployment verification.
