# Restore October 2 Action Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the October 2 nonblocking Agent A/action boundary so calls and payment links execute when authorized, missing data returns to Agent A as structured input, policy failures never become technical fallbacks, and Agent A keeps Lisandro's natural voice across consecutive turns.

**Architecture:** Reuse the proven October 2 separation instead of adding another recovery layer. Agent A remains the sole conversational author; one backend authority validates canonical facts and effects, returns `succeeded | needs_input | rejected`, and never rewrites prose. Stripe, Central de Carga, credentials and post-sale remain independent event-driven lanes and are certified unchanged.

**Tech Stack:** TypeScript 5.9, Next.js 16, Botpress ADK 2.0.5, Vitest 4, PostgreSQL/Supabase, DeepSeek, Retell, Stripe.

**Spec:** `docs/superpowers/specs/2026-10-01-agent-a-nonblocking-orchestrator-design.md`

## Global Constraints

- Use the October 2 production behavior and commits `579a6cf`, `6949797` and `7dabdb3` as the action-boundary reference; do not wholesale-revert newer product work.
- Preserve canonical Lisandro prompt `studyx-agent-a-canonical-v72` and current brain resources; do not move sales wording into the backend.
- Clarify, without replacing, Lisandro's name-use guidance: knowing a name does not require using it; Agent A avoids consecutive or mechanical direct address and evaluates naturalness across recent turns. This remains model-owned style, never a backend veto or rewrite.
- The backend validates facts, required fields, consent, blocked contacts, active calls, selected offerings/plans, idempotency and effect execution exactly once.
- Botpress may validate proposal shape, cited facts and false success claims, but it must not independently authorize or reject the business effect.
- Missing data is `needs_input`, not a provider outage and not a terminal policy failure.
- `MODEL_UNAVAILABLE` is reserved for an actual DeepSeek transport/provider failure after its bounded retry.
- Never reattach a rejected action or its semantic move to a conversation-only continuation.
- Preserve current batching, durable delivery, database resilience, memory, Agent B, Stripe, Central de Carga, credentials, post-sale and projection behavior.
- No new planner, phrase library, regex router, backend-authored sales response or database queue for semantic retries. A turn uses one Agent A generation plus at most one continuation when a real backend action result changes what the customer must be told.
- Production deployment is allowed only after the complete local gate and exact-SHA checks pass.

## Review Focus

- Pending call offer + complete profile + current explicit acceptance must reserve and dispatch exactly one call in the same turn.
- Missing call identity must produce Agent A's natural request for only the missing fields and zero call sessions.
- Payment-link request without a selected plan must produce Agent A's natural plan question, zero links and no `MODEL_UNAVAILABLE`.
- A completed action replay must return the same receipt and never duplicate a call, link, payment, enrollment or WhatsApp notification.
- Verified payment must still produce Central de Carga enrollment, credentials and warm post-sale delivery even if the conversation lane is unavailable afterward.
- Three consecutive replies after intake must not open with the customer's first name or a fixed acknowledgement pattern; the backend must not strip or inject names to satisfy this.

---

## File map

- `botpress-agent/src/lib/conversation/agent-a-action-feedback.ts`: convert a structured action result into one effect-free Agent A continuation without restoring the rejected move.
- `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts`: keep conversational/factual validation separate from action authorization.
- `botpress-agent/src/lib/conversation/agent-a-context.ts`: expose current-turn call/payment capabilities without requiring a future duplicate confirmation.
- `docs/prompts/studyx-agent-a-canonical.md`: disambiguate optional, occasional first-name use while preserving Lisandro's voice.
- `botpress-agent/src/prompts/agent-a-brain-v1.ts`: make the voice self-review compare the candidate with recent assistant turns.
- `botpress-agent/src/workflows/processInboundTurn.ts`: one generation, one optional action-result continuation, distinct provider/policy failure handling.
- `src/features/conversation/application/prepare-agent-turn-v2.ts`: single authoritative backend effect validation and structured action rejection.
- `src/features/conversation/domain/agent-turn-policy-v2.ts`: canonical effect safety only; no conversational sequencing.
- `tests/workflow/agent-a-action-boundary-regression.test.ts`: exact sanitized production reproductions for call and payment.
- Existing unit/integration suites: focused invariants, idempotency and fulfillment certification.

### Task 1: Pin the two production failures before changing behavior

**Files:**
- Create: `tests/workflow/agent-a-action-boundary-regression.test.ts`
- Modify: `tests/unit/botpress/agent-a-action-feedback.test.ts`
- Modify: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`
- Modify: `tests/unit/botpress/agent-a-brain-prompt.test.ts`

**Interfaces:**
- Consumes: current production workflow, PostgreSQL state transitions and deterministic DeepSeek fixtures.
- Produces: two RED regressions that later tasks must turn GREEN without changing their expectations.

- [ ] **Step 1: Add the call reproduction**

Model the sanitized sequence `call offer -> collect name/surname/email -> "dale de una"` with the WhatsApp phone already canonical. Assert the final turn creates one `call_sessions` row, exposes one `call_request`, dispatches once and never emits `ACTION_NOT_AUTHORIZED` or a no-call apology.

- [ ] **Step 2: Add the payment reproduction**

Model `"ingles, dame el pago"` with a complete profile and no selected plan. Assert the reply is Agent A-authored, asks for the applicable course/plan choice, creates no payment link and never records `MODEL_UNAVAILABLE`; then answer with a canonical plan and assert exactly one link.

- [ ] **Step 3: Run both reproductions and verify RED**

Run:

```bash
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-action-boundary-regression.test.ts
```

Expected: the call case fails with no `call_request`; the payment case fails with `PLAN_NOT_SELECTED` ending as `MODEL_UNAVAILABLE`.

- [ ] **Step 4: Add focused unit assertions for the same contracts**

Pin that conversation-only feedback never restores `request_payment_link` or `request_call`, and that a policy rejection cannot select `technicalFallback()`.

- [ ] **Step 4a: Add the consecutive-name naturalness regression**

Use a three-turn Agent A fixture with a known first name and recent openings such as `Gracias, Thiago` and `Perfecto, Thiago`. Assert the generated instructions tell Agent A that knowing the name does not require using it, prohibit consecutive or mechanical direct address, and require comparing the candidate with recent assistant turns. Do not add a runtime string filter.

- [ ] **Step 5: Commit Task 1**

```bash
git add tests/workflow/agent-a-action-boundary-regression.test.ts \
  tests/unit/botpress/agent-a-action-feedback.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/unit/botpress/agent-a-brain-prompt.test.ts
git commit -m "test(orchestrator): reproduce call and payment action blocks"
```

### Task 2: Restore the October 2 nonblocking action contract

**Files:**
- Modify: `botpress-agent/src/lib/conversation/agent-a-action-feedback.ts`
- Modify: `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `src/features/conversation/application/prepare-agent-turn-v2.ts`
- Modify: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Test: `tests/unit/botpress/agent-a-action-feedback.test.ts`
- Test: `tests/unit/botpress/resolve-agent-a-proposal.test.ts`
- Test: `tests/unit/conversation/prepare-agent-turn-v2.test.ts`

**Interfaces:**
- Produces: `AgentActionResultV1 = { action, status: 'succeeded' | 'needs_input' | 'rejected' | 'temporarily_unavailable' | 'ambiguous', code, missing_fields, canonical_data, retryable }`.
- Produces: one effect-free Agent A continuation for `needs_input` or `rejected`.
- Consumed by: Task 3 call authorization and Task 4 vertical certification.

- [ ] **Step 1: Add RED tests for structured action results**

Assert `PLAN_NOT_SELECTED`, missing intake, blocked contact and active call produce structured results and no customer-facing backend copy. Assert a false success claim still fails closed.

- [ ] **Step 2: Remove rejected-move restoration**

Change `continueAgentAAfterActionFeedbackV1` so the continuation keeps its own safe semantic move. Remove the `original_proposal.move` reassignment and retain only canonical profile observations that were independently accepted.

- [ ] **Step 3: Restore single-pass backend authorization**

Treat Botpress capabilities as context for Agent A, not as a second effect authority. Forward one typed request to `prepareAgentTurnV2`; there, restore the October 2 pattern: validate the effect once; when only the effect is unavailable, replace `proposed_action` with `none`, preserve safe Agent A prose/state and return `action_rejection`. Remove the `authorize(..., false, 'advisory')` reauthorization cycle.

- [ ] **Step 4: Make missing course/plan/intake nonterminal**

Map those cases to `needs_input`. Permit one Agent A continuation from that result; never run the same rejected proposal through the resolver again and never route it to `technicalFallback()`.

- [ ] **Step 5: Narrow failure classification**

Only `provider_transport` and `provider_rejected` may produce `MODEL_UNAVAILABLE`. Persist policy/action failures as `proposal_validation` or `action_authorization` while delivering the Agent A continuation.

- [ ] **Step 5a: Restore cross-turn Lisandro naturalness**

Clarify that first-name use is optional and meaningful, never consecutive or part of mechanical intake/action confirmations. Make the Lisandro voice gate compare the candidate response with recent assistant turns. Keep the correction inside Agent A's prompt and evaluation; add no backend-authored wording, name stripping or style rejection.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npx vitest run --config vitest.config.mts \
  tests/unit/botpress/agent-a-action-feedback.test.ts \
  tests/unit/botpress/resolve-agent-a-proposal.test.ts \
  tests/unit/conversation/prepare-agent-turn-v2.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/unit/botpress/agent-a-brain-prompt.test.ts
```

- [ ] **Step 7: Commit Task 2**

```bash
git add botpress-agent/src/lib/conversation/agent-a-action-feedback.ts \
  botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts \
  botpress-agent/src/workflows/processInboundTurn.ts \
  src/features/conversation/application/prepare-agent-turn-v2.ts \
  src/features/conversation/domain/agent-turn-policy-v2.ts \
  docs/prompts/studyx-agent-a-canonical.md \
  botpress-agent/src/prompts/agent-a-brain-v1.ts \
  botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts \
  tests/unit/botpress/agent-a-action-feedback.test.ts \
  tests/unit/botpress/resolve-agent-a-proposal.test.ts \
  tests/unit/conversation/prepare-agent-turn-v2.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts
git commit -m "refactor(orchestrator): restore nonblocking action boundary"
```

### Task 3: Authorize calls from current evidence without double confirmation

**Files:**
- Modify: `botpress-agent/src/lib/conversation/agent-a-context.ts`
- Modify: `src/features/conversation/application/prepare-agent-turn-v2.ts`
- Modify: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Modify only if required: `src/features/orchestration/application/claim-batch.ts`
- Test: `tests/unit/botpress/agent-a-context.test.ts`
- Test: `tests/integration/agent-a-call-handoff.test.ts`
- Test: `tests/workflow/agent-a-real-conversation-regression.test.ts`

**Interfaces:**
- Consumes: Task 2 structured action result.
- Produces: same-turn call authorization from a pending offer plus current explicit acceptance, or from a current direct request.

- [ ] **Step 1: Add the exact call-state RED tests**

Cover pending offer + `"dale de una"`, direct `"llamame ahora"`, missing phone, blocked contact, active call, explicit decline and replay. Require complete `nombre`, `apellido`, callable `telefono`; email remains payment-only.

- [ ] **Step 2: Compute capability from pre-state plus current evidence**

Authorize when there is no active call and either: a current direct request, or an open offer plus current explicit acceptance. Do not require that the acceptance already be persisted before evaluating the same turn.

- [ ] **Step 3: Commit acceptance and call reservation together**

Persist `call_preference=call`, `call_offer_status=accepted` and the idempotent call reservation in the same authoritative commit. Dispatch remains fenced behind successful customer-message submission and reuses the existing call receipt.

- [ ] **Step 4: Run call unit/integration/workflow tests**

```bash
npx vitest run --config vitest.config.mts \
  tests/unit/botpress/agent-a-context.test.ts \
  tests/integration/agent-a-call-handoff.test.ts
npx vitest run --config vitest.workflow.config.mts \
  tests/workflow/agent-a-real-conversation-regression.test.ts \
  tests/workflow/agent-a-action-boundary-regression.test.ts
```

- [ ] **Step 5: Commit Task 3**

```bash
git add botpress-agent/src/lib/conversation/agent-a-context.ts \
  src/features/conversation/application/prepare-agent-turn-v2.ts \
  src/features/conversation/domain/agent-turn-policy-v2.ts \
  src/features/orchestration/application/claim-batch.ts \
  tests/unit/botpress/agent-a-context.test.ts \
  tests/integration/agent-a-call-handoff.test.ts \
  tests/workflow/agent-a-real-conversation-regression.test.ts \
  tests/workflow/agent-a-action-boundary-regression.test.ts
git commit -m "fix(calls): authorize current-turn acceptance once"
```

### Task 4: Certify the complete retained system and deploy one release

**Files:**
- Modify: `botpress-agent/src/workflows/processInboundTurn.source.json`
- Modify only when a test exposes a defect: existing payment, Central de Carga or post-sale owner.
- Test: `tests/workflow/agent-a-action-boundary-regression.test.ts`
- Test: `tests/workflow/agent-a-commercial-truth-repair.test.ts`
- Test: `tests/integration/delivery-attempt-fencing.test.ts`
- Test: `tests/integration/post-sale.test.ts`
- Test: `tests/unit/fulfillment/central-carga-cron.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: one production SHA with action boundary, fulfillment and delivery evidence.

- [ ] **Step 1: Run the full vertical sales matrix**

Prove: natural missing-data request; same-turn call acceptance; direct call; payment request without plan; plan selection then exactly one link; reported payment; verified Stripe payment; Central de Carga enrollment; credentials; warm StudyX welcome; replay deduplication.

- [ ] **Step 2: Prove retained failure isolation**

Simulate DeepSeek timeout, Retell failure, Stripe replay, Central de Carga retry and WhatsApp ambiguous delivery. Assert each keeps its own error class and never mutates an unrelated lane.

- [ ] **Step 3: Regenerate and verify Botpress source**

Regenerate `processInboundTurn.source.json`, verify byte-for-byte source parity, run Botpress typecheck, ADK check and ADK build.

- [ ] **Step 4: Run repository-wide gates**

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build -- --webpack
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
npm --prefix botpress-agent run build
```

Expected: no new failures; action-rejection-to-technical-fallback count is zero in every workflow assertion.

- [ ] **Step 5: Deploy backend and Botpress from the same commit**

Deploy Vercel production with `STUDYX_RELEASE_SHA` equal to `git rev-parse HEAD`, then deploy the existing StudyX Botpress bot/workspace. Verify `/api/health`, `/api/ready`, bot/workspace IDs and generated workflow version.

- [ ] **Step 6: Run supervised clean-channel canaries**

On clean test conversations, run: ordinary message, call with missing data, accepted call with complete data, payment without plan, payment after plan, verified test payment, automatic access and WhatsApp welcome. Inspect durable receipts after every effect before declaring success.

- [ ] **Step 7: Commit certification evidence**

```bash
git add botpress-agent/src/workflows/processInboundTurn.source.json \
  tests/workflow/agent-a-action-boundary-regression.test.ts \
  docs/reports/2026-10-17-october-2-action-boundary-release.md
git commit -m "chore(release): certify StudyX action boundary end to end"
```

## Completion criteria

- A current explicit call acceptance with complete canonical data creates and dispatches exactly one call.
- Missing call/payment inputs produce Agent A-authored questions and no side effect.
- No policy or action code is persisted as `MODEL_UNAVAILABLE`.
- Backend code never writes, prunes or substitutes commercial prose.
- All three current production paid records remain enrolled and their post-sale receipts remain intact.
- Full unit, integration, workflow, build, Botpress and production readiness gates pass.
- Two clean WhatsApp canaries complete call and payment→alta→credentials→welcome from the exact deployed SHA.
- Agent A does not use the customer's name in consecutive interventions or as a mechanical acknowledgement, and this is enforced through model guidance/evaluation rather than backend prose manipulation.
