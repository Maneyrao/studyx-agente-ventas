# Agent A Conversation Architecture Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable, natural sales conversations by giving Agent A one coherent task per turn while the backend remains the sole authority for facts, permissions, state and side effects.

**Architecture:** Replace text-derived sales markers with durable structured state, make one contextual course projection feed both generation and validation, and compile prompt plus backend obligations into one `TurnBriefV1`. Keep hard transactional validation for prices, courses, consent, payments, promotions, fulfillment and idempotency; move stylistic and sales-quality judgment out of the commit boundary. Release Botpress and Vercel as a pinned, observable pair.

**Tech Stack:** TypeScript, Next.js, PostgreSQL/Supabase, Vitest, Botpress ADK, DeepSeek, WhatsApp, Vercel.

**Spec:** `AGENTS.md`, `docs/authority/prompt-agente-a-studyx-v2.md`, `docs/authority/spec-backend-bonificacion.md`, and the verified Gabi incident traces documented on 2026-11-03.

## Global Constraints

- Do not grant `orchestrator_role` direct access to `audit_log`.
- Agent A owns interpretation, sales strategy and customer-facing wording unless an explicit owner rule requires a structural effect.
- Backend validates facts and effects: catalog, USD 360 plans, links, consent, contact data, payment, promotion limits, enrollment and idempotency.
- Preserve every function listed under `AGENTS.md` “No romper”.
- Never convert an infrastructure exception into `bonus_disabled`, `not_authorized`, or another commercial fact.
- A model-authored reply may not claim an effect that did not commit.
- No production deployment until the full acceptance table and release manifest are approved.
- Preserve the current prompt authority; any behavioral change outside it requires a separate owner decision.

## Review Focus

- A demonstrative reference such as “ese curso” after the agent named exactly one course resolves to that course; multiple named courses remain ambiguous.
- An ambiguous answer followed by “sí, sólo el precio” advances the persisted price-probe state instead of remaining `asked`.
- A requested gift survives the price-only question and becomes the selected bonus only after the authorized confirmation.
- A noncritical capability read failure remains observable and does not abort an otherwise valid conversational commit.
- Botpress and backend version mismatch is detected before a live test and cannot be reported as an accepted release.

---

### Task 1: Freeze the incident and establish a release gate

**Files:**
- Create: `tests/fixtures/agent-a/gabi-20261103-conversation.json`
- Modify: `tests/workflow/agent-a-real-conversation-regression.test.ts`
- Modify: `tests/integration/agent-loop-commit-regressions.test.ts`
- Create: `docs/reports/2026-11-03-gabi-regression-baseline.md`

**Interfaces:**
- Consumes: the recorded messages and rejection/commit outcomes from conversation `conv_01M5D8GETEB0RMSWVF3RY6V76A`.
- Produces: deterministic regression fixtures for Tasks 2–6; no remote model call.

- [ ] **Step 1: Add the exact Gabi sequence as a fixture**

  Include “curso de realtor”, the Real Estate recommendation, “sí, ese curso es el que me interesa”, “qué no entendés?” and “hola?”. Preserve expected course identity and the distinction between model proposal, accepted proposal, committed outbound and delivered message.

- [ ] **Step 2: Add failing workflow assertions**

  Assert that `ese curso` resolves to `real_estate`, no generic clarification is delivered, every inbound has a committed outbound, and no capability reports `bonus_disabled` because of an exception.

- [ ] **Step 3: Add a production-role parity integration test**

  Run the commit path with the same grants as `orchestrator_role`. Assert no runtime query touches `audit_log` and a valid `proposed_action=none` turn commits successfully.

- [ ] **Step 4: Run the focused red suite**

  Run: `npm test -- tests/workflow/agent-a-real-conversation-regression.test.ts tests/integration/agent-loop-commit-regressions.test.ts`

  Expected before implementation: failures for contextual reference and durable sales-flow state; no test may require production credentials.

- [ ] **Step 5: Record the baseline and commit**

  Commit message: `test: freeze Gabi conversation regression`

---

### Task 2: Replace text-derived sales markers with durable state

**Files:**
- Create: `supabase/migrations/20261103010001_conversation_sales_flow_state.sql`
- Create: `src/features/conversation/domain/sales-flow-state-v1.ts`
- Create: `src/features/conversation/adapters/postgres-sales-flow-state-v1.ts`
- Modify: `src/features/promotions/application/sales-flow-markers.ts`
- Modify: `src/features/promotions/application/read-course-bonus-capability.ts`
- Modify: `src/features/promotions/application/read-course-bonus-ladder.ts`
- Modify: `src/lib/services/decision.service.ts`
- Create: `tests/unit/conversation/sales-flow-state-v1.test.ts`
- Create: `tests/integration/agent-a-sales-flow-state.test.ts`

**Interfaces:**
- Produces: `SalesFlowStateV1` with `price_probe_status`, probe source identifiers, answer source identifier, `pending_gift_offering_code`, pending-gift source identifier, `retention_used_at`, `version`, and `updated_at`.
- Produces: `readSalesFlowStateV1(db, conversationId)` and an atomic transition applied inside the normal decision transaction.
- Consumes later: Task 4’s `TurnBriefV1` and the existing course-bonus capability.

- [ ] **Step 1: Write state-machine unit tests**

  Cover `not_asked → asked → yes`, `not_asked → asked → no`, an ambiguous reply followed by a later confirmation, once-only retention, pending gift creation/consumption, and idempotent replay of the same source turn.

- [ ] **Step 2: Write the migration red/green integration test**

  Assert `orchestrator_role` has only the required `SELECT/INSERT/UPDATE`, cannot delete/truncate, cannot cross workspace membership, and can read/write the state without `audit_log` access.

- [ ] **Step 3: Implement the state and repository**

  Use row versioning and `SELECT … FOR UPDATE` in the existing decision transaction. Every transition carries a source turn/message identity so retries cannot advance the state twice.

- [ ] **Step 4: Move price-probe, pending-gift and retention reads to structured state**

  Remove message-text reconstruction as business authority. Message parsing may propose a transition, but only the persisted state is read on later turns.

- [ ] **Step 5: Make capability failures explicit**

  Replace catch-to-`enabled:false` behavior with a typed `capability_unavailable` diagnostic. A failed optional read must not claim the promotion is disabled; a required transactional read must fail visibly and be recoverable.

- [ ] **Step 6: Verify state and promotion integration**

  Run: `npm test -- tests/unit/conversation/sales-flow-state-v1.test.ts`

  Run: `npm run test:integration -- tests/integration/agent-a-sales-flow-state.test.ts tests/integration/agent-turn-direct-bonus-commit.test.ts`

  Expected: all pass under production-equivalent database permissions.

- [ ] **Step 7: Commit**

  Commit message: `fix: persist Agent A sales flow state`

---

### Task 3: Use one contextual course reference for generation and validation

**Files:**
- Create: `botpress-agent/src/lib/conversation/contextual-offering-reference.ts`
- Modify: `botpress-agent/src/utils/commercial-router.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-context.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-brain.ts`
- Modify: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Modify: `tests/unit/botpress/commercial-router.test.ts`
- Modify: `tests/unit/botpress/agent-a-context.test.ts`
- Modify: `tests/unit/conversation/agent-turn-policy-v2.test.ts`
- Modify: `tests/workflow/agent-a-real-conversation-regression.test.ts`

**Interfaces:**
- Produces: `resolveContextualOfferingReferenceV1(input): exact | ambiguous | not_found` with evidence source `current_customer_named_course`, `prior_agent_named_candidate`, or durable selection.
- Contract: the exact same projection is serialized into model context and passed to policy validation.

- [ ] **Step 1: Write contextual-reference tests**

  Pin: one prior course + “ese curso” resolves; two prior courses + “ese” is ambiguous; a newly named active course wins; a durable explicit selection wins; a later course change supersedes the previous reference.

- [ ] **Step 2: Implement the shared resolver**

  Resolve from canonical catalog identities and causal conversation turns. Never infer a course from an unrelated old memory, and never persist a selection from a pronoun alone.

- [ ] **Step 3: Feed one projection to context and validator**

  Remove any second interpretation that can classify the same reference differently after generation. An exact contextual reference authorizes that course’s factual bundle but does not authorize payment or promotion.

- [ ] **Step 4: Change clarification behavior**

  Ask “a cuál de estos dos te refieres?” only when evidence is genuinely ambiguous. Never use the generic “no te entendí” when one canonical referent exists.

- [ ] **Step 5: Verify the Gabi replay**

  Run: `npm test -- tests/unit/botpress/commercial-router.test.ts tests/unit/botpress/agent-a-context.test.ts tests/unit/conversation/agent-turn-policy-v2.test.ts tests/workflow/agent-a-real-conversation-regression.test.ts`

  Expected: the Real Estate turn passes without fallback.

- [ ] **Step 6: Commit**

  Commit message: `fix: preserve contextual course references`

---

### Task 4: Compile one authoritative task per turn

**Files:**
- Create: `src/shared/conversation/agent-a-turn-brief.ts`
- Modify: `src/shared/conversation/deterministic-sales-rules.ts`
- Modify: `botpress-agent/src/lib/conversation/deterministic-rules-turn.ts`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Modify: `botpress-agent/src/schemas/agent-a-brain.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `tests/unit/conversation/deterministic-sales-rules.test.ts`
- Modify: `tests/unit/botpress/agent-a-brain-prompt.test.ts`
- Modify: `tests/integration/deterministic-sales-rules-runtime.test.ts`

**Interfaces:**
- Produces: `AgentATurnBriefV1` containing current customer intent evidence, commercial phase, known objective, authorized facts, permitted effects, one primary obligation, optional call obligation, and forbidden effects.
- Precedence: post-sale/payment safety → explicit checkout → explicit call request → promotion/retention effect → price probe → optional proactive call → ordinary model-led sale.

- [ ] **Step 1: Write turn-brief precedence tests**

  Cover purchase intent versus promotion, checkout versus proactive call, a direct call request, a first price objection, an authorized bonus, retention, opt-out and post-sale.

- [ ] **Step 2: Implement the turn brief**

  Rules decide only structural obligations required by authority: effect identity, maximums and timing. They must not grade whether ordinary copy “sells enough”.

- [ ] **Step 3: Make the canonical prompt the only general sales guide**

  Keep the brain’s execution contract, facts, effect boundaries and the final turn brief. Remove duplicated general selling instructions that are already literal in the authority prompt. Do not change the authority document in this task.

- [ ] **Step 4: Reduce post-hoc copy interpretation**

  Keep structural checks: required action, exact course identity, price, maximum messages/questions where authority fixes them, and prohibited unsupported claims. Move general tone, persuasion and progression judgments to golden evaluation instead of transaction rejection.

- [ ] **Step 5: Verify current owner rules**

  Prove calls, price probe, promotions, selected gift, bonus swap, retention, checkout precedence and opt-out still behave exactly as authorized.

- [ ] **Step 6: Run focused tests**

  Run: `npm test -- tests/unit/conversation/deterministic-sales-rules.test.ts tests/unit/botpress/agent-a-brain-prompt.test.ts`

  Run: `npm run test:integration -- tests/integration/deterministic-sales-rules-runtime.test.ts tests/integration/agent-turn-direct-bonus-commit.test.ts`

- [ ] **Step 7: Regenerate prompt modules and bump versions**

  Run: `npm run generate:agent-a-prompt`

  Increment the brain version only after the generated files and parity tests pass.

- [ ] **Step 8: Commit**

  Commit message: `refactor: give Agent A one turn brief`

---

### Task 5: Preserve natural conversation across rejected effects and failures

**Files:**
- Modify: `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts`
- Modify: `botpress-agent/src/lib/conversation/recovery-feedback.ts`
- Modify: `botpress-agent/src/utils/decision-policy.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `tests/unit/botpress/resolve-agent-a-plannerless.test.ts`
- Modify: `tests/unit/orchestration/decision-policy.test.ts`
- Modify: `tests/integration/agent-loop-fallback-recovery.test.ts`
- Modify: `tests/integration/agent-loop-delivery-failure.test.ts`
- Modify: `tests/workflow/agent-a-commercial-truth-repair.test.ts`

**Interfaces:**
- Produces: typed failure classes `provider_unavailable`, `context_ambiguous`, `effect_rejected`, `capability_unavailable`, `commit_failed` and `delivery_ambiguous`.
- Produces: a safe conversational candidate whose effects are fenced but whose valid customer-facing content remains model-authored.

- [ ] **Step 1: Write failure-classification tests**

  Assert a policy rejection is not reported as provider failure, a SQL exception is not reported as disabled promotion, and a real ambiguous course reference is distinct from an unauthorized action.

- [ ] **Step 2: Test preservation of safe model copy**

  For an unauthorized effect, retain the response that answers the customer, remove the uncommitted effect claim, and ask only for required information. Never replace it with “no te entendí” unless the input is genuinely ambiguous or unreadable.

- [ ] **Step 3: Isolate optional capability reads from the commit transaction**

  A promotion-state read failure may make that effect temporarily unavailable with an internal diagnostic, but it cannot abort an ordinary `none` action response. Required state writes and outbound creation remain atomic.

- [ ] **Step 4: Define the honest no-silence boundary**

  Guarantee a conversational response for model schema/policy/action/capability failures. For a total database or channel outage, preserve exactly-once safety, enqueue recovery, raise an operator alert and avoid claiming delivery. Do not promise mathematical “never silence” during simultaneous loss of both durable stores without introducing a second idempotent outbox.

- [ ] **Step 5: Remove generic technical continuity from normal commercial failures**

  Keep fixed copy only for a verified provider outage or a truly unreadable input. Include the customer’s actual topic whenever canonical context is available.

- [ ] **Step 6: Run recovery suites**

  Run: `npm test -- tests/unit/botpress/resolve-agent-a-plannerless.test.ts tests/unit/orchestration/decision-policy.test.ts`

  Run: `npm run test:integration -- tests/integration/agent-loop-fallback-recovery.test.ts tests/integration/agent-loop-delivery-failure.test.ts`

  Expected: no safe conversational turn becomes suppressed; ambiguous physical delivery remains fenced against duplicates.

- [ ] **Step 7: Commit**

  Commit message: `fix: preserve Agent A conversation on rejected effects`

---

### Task 6: Verify every protected workflow and commercial behavior

**Files:**
- Modify: `evals/golden/` scenarios only where required to add the verified Gabi regression and failure classifications.
- Create: `evals/golden/results/agent-a-architecture-recovery-<sha>.md`
- Create: `evals/golden/results/agent-a-architecture-recovery-<sha>.json`
- Create: `docs/reports/2026-11-03-agent-a-architecture-recovery-acceptance.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: one acceptance table tied to a source SHA, prompt version, brain version, database migration and Botpress artifact hash.

- [ ] **Step 1: Run static and local verification**

  Run: `npm run typecheck && npm run lint && npm run build`

  Run: `npm --prefix botpress-agent run typecheck && npm --prefix botpress-agent run check && npm --prefix botpress-agent run build`

- [ ] **Step 2: Run the full unit suite**

  Run: `npm run test:unit`

- [ ] **Step 3: Run all “No romper” integration suites**

  Include calls/Agent B, profile intake, payment links and USD 0.50, payment verification, Central enrollment with bonuses, post-sale access, memory, lead projection, opt-out, follow-ups, audio and exactly-once behavior.

- [ ] **Step 4: Replay all recorded observations without a model call**

  Compare accepted response, action, state transition and rejections against the prior accepted baseline. Any change outside the intended layers is a regression requiring review.

- [ ] **Step 5: Run the full current golden suite once with the real staging model**

  Never use production or Vertice for this run. Store raw model output, action, state, backend rejections, tokens and judge evidence.

- [ ] **Step 6: Apply acceptance criteria**

  Require: zero evaluator errors; 100% pass for Gabi continuity, checkout, calls, payment, bonus ladder, post-sale access and temarios; zero silent turns; zero runtime `audit_log` access; zero capability exceptions misclassified as commercial state; naturalness average at least 4/5 with no dimension under 3 in supervised samples.

- [ ] **Step 7: Obtain architect review and address material findings**

  The reviewer verifies authority boundaries, DB permissions, failure isolation, exactly-once behavior and evidence provenance before completion is declared.

- [ ] **Step 8: Commit**

  Commit message: `test: accept Agent A architecture recovery`

---

### Task 7: Deploy a pinned backend/Botpress release with canary and rollback

**Files:**
- Modify: `scripts/generate-release-manifest.mjs`
- Modify: `src/app/api/health/route.ts` or the existing release-health endpoint
- Modify: Botpress deployment metadata/configuration files used by the ADK bundle
- Create: `docs/reports/2026-11-03-agent-a-pinned-release.md`

**Interfaces:**
- Produces: a release identity containing backend SHA, prompt version, brain version, migration head, Botpress artifact hash and configured backend URL.
- Produces: a preflight that fails before testing when the live pair is mismatched.

- [ ] **Step 1: Add release identity tests**

  Assert the health endpoint and Botpress startup log expose the same backend SHA, prompt, brain and expected URL. A mismatch blocks the canary.

- [ ] **Step 2: Apply the migration in staging and verify grants**

  Run permission, state transition, commit and outbound smoke tests as `orchestrator_role`, not as an owner or service-role connection.

- [ ] **Step 3: Deploy the backend candidate to staging**

  Verify health, migration and release identity before pointing a Botpress test bundle at it.

- [ ] **Step 4: Deploy the matching Botpress candidate to a test bot**

  Run the Gabi sequence, price objection/promotion, call, test payment, paid fulfillment and access message. Capture trace IDs and actual WhatsApp messages.

- [ ] **Step 5: Approve or roll back the pair**

  Rollback always restores both the compatible backend and Botpress artifact. Never roll back one half while retaining the other without a proven compatibility manifest.

- [ ] **Step 6: Production rollout**

  Publish backend first, confirm readiness, then Botpress; use one authorized canary contact before general traffic. Monitor 5xx commits, repair rate, fallback rate, silent-turn count, promotion capability errors and delivery ambiguity.

- [ ] **Step 7: Close only with evidence**

  Report SHA, prompt version, brain version, migration, Botpress artifact, acceptance table, canary transcript and rollback target. Do not say “listo” without that table.

- [ ] **Step 8: Commit deployment evidence**

  Commit message: `docs: record pinned Agent A release`

---

## Estimated sequence

| Phase | Estimate | Production status |
|---|---:|---|
| Incident fixture and release freeze | 0.5 day | No deployment |
| Structured commercial state | 1.5–2 days | No deployment |
| Contextual course resolution | 1 day | No deployment |
| One authoritative turn brief | 2–3 days | No deployment |
| Recovery and no-silence behavior | 1–2 days | No deployment |
| Full verification and independent review | 1–2 days | No deployment |
| Staging, canary and production | 0.5–1 day | Only after approval |

Expected engineering effort: **7–11 working days**, assuming staging database access and model availability. The P0 database-permission hotfix and Gabi regression can be validated earlier, but they are not the complete architectural correction.

## Explicit non-solutions

- Do not give `orchestrator_role` broad `audit_log` access.
- Do not keep reconstructing durable sales state with regular expressions over chat text.
- Do not add more commercial copy to the brain when it already exists in the authority prompt.
- Do not solve naturalness by removing price, payment, consent, promotion or idempotency validation.
- Do not deploy Botpress and Vercel independently and then test across a moving release boundary.
- Do not treat a fixed fallback, an HTTP 200, or a model-generated draft as proof that the customer received the intended response.
