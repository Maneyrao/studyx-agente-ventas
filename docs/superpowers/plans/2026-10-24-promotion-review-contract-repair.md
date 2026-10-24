# Promotion Review Contract Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a persistent price objection reliably start the authorized, delayed course-bonus review without defensive copy, including existing conversations created before v130.

**Architecture:** Agent A remains the conversational owner and classifies the customer's objection in structured output. Botpress exposes only actions that the backend has authorized, while the backend validates course identity, persists accepted evidence, schedules the follow-up, and never rewrites sales copy. Existing production history is repaired only from accepted structured model evidence, never by reinterpreting free text.

**Tech Stack:** TypeScript, Botpress ADK, Next.js, PostgreSQL/Supabase, Vitest, Vercel.

**Spec:** `docs/prompts/studyx-agent-a-canonical.md`; `docs/handoffs/curso-de-regalo-en-el-alta.md`

## Global Constraints

- The paid course remains USD 360; never lower or discount its price.
- The bonus may be any active, distinct, contextually coherent course; English 1 + English 2 is only an example.
- Do not reveal the bonus course before the review returns `offer_available`.
- The backend validates facts and effects but does not write, replace, or interpret the commercial response.
- Keep Lisandro's personality and natural WhatsApp style; no defensive phrases such as “no te lo voy a inventar” or “no hay nada para darte”.
- Never leave a valid inbound turn silent.

## Review Focus

- Fragmented WhatsApp input such as “no tenés ninguna oferta / para hacerme / ?” must be treated as one request.
- “Oferta laboral”, “no quiero ofertas” and “hasta cuándo dura la oferta?” must not start a course-bonus review.
- A second objection must work even when no price-objection check-in was scheduled.
- A course change must not carry an objection count or bonus selection from the prior course.
- Replaying historical accepted decisions must be idempotent and must not overwrite an accepted or attached promotion.

---

### Task 1: Align the provider schema with the promotion action

**Files:**
- Modify: `botpress-agent/src/lib/conversation/agent-a-brain.ts`
- Test: `tests/unit/botpress/agent-a-brain.test.ts`

**Interfaces:**
- Consumes: `AgentAContextV1.capabilities.course_bonus`, `catalog.available_offerings`.
- Produces: the real provider JSON schema for `request_promotion_review`, including `bonus_offering_code` when `bonus_selection_mode="any_active_course"`.

- [ ] **Step 1: Write the failing provider-schema test**

Assert that `request_promotion_review` requires `bonus_offering_code` and that its enum contains only active course codes distinct from `interest_offering_code`. Assert that the action is omitted when no eligible complement exists.

- [ ] **Step 2: Run the focused test and verify that it fails**

Run: `pnpm vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain.test.ts`

- [ ] **Step 3: Implement the minimal schema change**

Extend the closed provider schema in `proposalJsonSchema(context)` so the dynamic field is legal and required only for `any_active_course`; retain the configured-promotion shape and backend revalidation.

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `pnpm vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain.test.ts && pnpm typecheck`

- [ ] **Step 5: Commit**

Commit message: `fix(agent-a): expose dynamic bonus choice to provider`

### Task 2: Route real promotion language into the authorized review

**Files:**
- Modify: `botpress-agent/src/lib/conversation/sales-objection-turn-policy.ts`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Test: `tests/unit/botpress/sales-objection-turn-policy.test.ts`
- Test: `tests/unit/botpress/agent-a-brain-prompt.test.ts`

**Interfaces:**
- Consumes: the complete current WhatsApp batch plus `course_bonus.may_request_review`.
- Produces: turn-specific guidance for a promotion request without executing or wording the offer in the backend.

- [ ] **Step 1: Add failing classification cases from production**

Cover “no tenés ninguna oferta para hacerme?”, spelling variants, and three exclusions: offer timing, opt-out from offers, and employment offers.

- [ ] **Step 2: Add the failing capability/guidance test**

Assert that `may_request_review=true` drives the review guidance for the current price/promotion objection even when `recent_turns` does not contain a regex-recognized prior phrase.

- [ ] **Step 3: Run the focused tests and verify that they fail**

Run: `pnpm vitest run --config vitest.config.mts tests/unit/botpress/sales-objection-turn-policy.test.ts tests/unit/botpress/agent-a-brain-prompt.test.ts`

- [ ] **Step 4: Implement intent-aware guidance**

Recognize a customer request for a commercial offer as objection guidance, keep exclusions explicit, and let durable `may_request_review` outrank the shallow recent-turn heuristic. Do not add canned customer-facing copy.

- [ ] **Step 5: Run tests and commit**

Commit message: `fix(agent-a): route promotion requests to authorized review`

### Task 3: Preserve objection evidence across the v128-to-v130 boundary

**Files:**
- Modify: `src/features/promotions/application/read-course-bonus-capability.ts`
- Modify: `src/features/conversation/application/prepare-agent-turn-v2.ts`
- Modify: `src/lib/services/decision.service.ts`
- Create: `scripts/repair-promotion-context-from-decisions.ts`
- Test: `tests/unit/promotions/course-bonus-capability.test.ts`
- Test: `tests/unit/scripts/repair-promotion-context-from-decisions.test.ts`
- Test: `tests/integration/course-bonus-followup.test.ts`

**Interfaces:**
- Consumes: accepted `agent_decisions.memory_candidates` with `type="objection"`, `key="price_objection"`, a customer `source_quote`, conversation/course identity, and chronological source turn IDs.
- Produces: idempotent `conversation_promotion_context_v1` state capped at two objections, scoped to one conversation and course.

- [ ] **Step 1: Write failing continuity tests**

Assert that replaying accepted structured evidence twice has no double count; changing course does not reuse prior objections; and accepted/attached offers are never replaced.

- [ ] **Step 2: Write a dry-run test for the scoped repair command**

Require an explicit conversation ID, print only proposed counts/course/source IDs, and reject free-text inference or workspace-crossing rows.

- [ ] **Step 3: Run the focused unit and integration tests and verify failure**

Run: `pnpm vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-capability.test.ts tests/unit/scripts/repair-promotion-context-from-decisions.test.ts && pnpm vitest run --config vitest.integration.config.mts tests/integration/course-bonus-followup.test.ts`

- [ ] **Step 4: Implement deterministic reconstruction**

Reuse only accepted structured model evidence. Do not scan customer prose with SQL or regex. Keep provenance, course chronology, cap and idempotency explicit.

- [ ] **Step 5: Repair only the demonstrated conversation after reviewing dry-run output**

Target: conversation `a9db399d-0a52-4644-a96e-3c15cbdd0453`. Preserve the current count and only add missing, earlier accepted structured evidence when it belongs to `fotografia_profesional`.

- [ ] **Step 6: Run tests and commit**

Commit message: `fix(promotions): preserve structured objection continuity`

### Task 4: Prove the real WhatsApp negotiation path

**Files:**
- Modify: `tests/workflow/agent-a-course-bonus-negotiation.test.ts`
- Modify: `tests/unit/scripts/release-manifest-agent-loop.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a production-shaped regression covering model proposal, backend commit, delayed follow-up and authorized offer.

- [ ] **Step 1: Add the failing workflow from the captured conversation**

Use three fragmented messages, prior accepted structured objection evidence, an interested but not formally selected paid course, and the real provider schema. Do not seed `records_price_objection:true` manually.

- [ ] **Step 2: Assert the complete transition**

Verify `request_promotion_review` carries one eligible complement, creates one `pending_review` offer and one due follow-up, later emits `offer_available`, keeps the paid course unchanged, and never emits the defensive phrases from the screenshot.

- [ ] **Step 3: Run workflow, unit, integration, lint and typecheck gates**

Run the focused workflow first, then the complete unit suite, promotion integration suite, `pnpm lint`, and `pnpm typecheck`.

- [ ] **Step 4: Commit**

Commit message: `test(promotions): cover persistent offer request end to end`

### Task 5: Deploy and verify without resetting the conversation

**Files:**
- No source changes.

**Interfaces:**
- Consumes: verified commits from Tasks 1-4.
- Produces: Botpress + Vercel deployment evidence for the existing WhatsApp conversation.

- [ ] **Step 1: Deploy backend to the user's Vercel and verify `/api/health` plus `/api/ready`**

- [ ] **Step 2: Deploy the Botpress ADK bundle and verify its production `apiBaseUrl` remains `https://studyx-agente-ventas.vercel.app`**

- [ ] **Step 3: Resume the existing conversation**

Send a promotion/price objection, verify the immediate “lo reviso” response, the delayed related-course offer, and that no silence or defensive denial occurs.

- [ ] **Step 4: Verify durable state**

Confirm one promotion offer, one follow-up, the original paid course, the selected complementary course, and no rejected or duplicate action.

