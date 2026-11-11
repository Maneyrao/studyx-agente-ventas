# Agent A Flexible Unpaid Sale Reopening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Emma reopen and continue a safely unpaid sale after a course and payment link were already selected, including in a later verified WhatsApp conversation, while preserving contact data, plan, course, prior bonuses and audit history; allow explicit changes without repeating the same sales argument or making the process rigid.

**Architecture:** Treat the event as a revision of one unpaid sale, not as a reopening of a closed chat. The model continues to interpret the customer and choose the commercial move. The backend exposes only executable capabilities and validates catalog, payment state, package version, identity, idempotency and enrollment effects. Payment and promotion snapshots remain immutable: an accepted change supersedes the old checkout and creates an exact successor. Cross-conversation recovery uses the existing verified continuity graph, never a phone-only or “latest row” lookup.

**Tech Stack:** TypeScript, Botpress ADK, PostgreSQL/Supabase migrations, Vercel backend, Vitest integration tests, DeepSeek synthetic conversation runner.

**Spec:** `AGENTS.md`, `docs/authority/prompt-agente-a-studyx-v2.md`, `docs/authority/spec-backend-bonificacion.md`, and owner decision of 2026-11-11 captured by this plan.

## Global Constraints

- Start from branch `codex/studyx-admissions-cutover`, commit `303e775`.
- Use commit `ca18d31` only as a reviewed implementation reference. Port its unpaid-negotiation primitives onto the current branch; do not cherry-pick its release pin or overwrite newer prompt v122 / brain v211 behavior blindly.
- Preserve everything already working: natural conversation, calls, PDF/image delivery, contact persistence and correction, course/plan changes, payment links, bonuses, enrollment, post-sale, typing behavior, opt-out and never-silence handling.
- A sent link does not close the commercial conversation. It only freezes one checkout snapshot.
- Reopening is allowed only when the old obligation is proven safe: `reserved`, no provider session, no paid/pending event, no open reconciliation, no successor and no paid enrollment evidence.
- `paid`, processing/pending, uncertain or reconciliation states may continue conversationally but must not mutate the package, course, plan or checkout.
- A greeting, a request for information or a return to the chat restores context only. It must not automatically create a promotion, retire a link or send a new link.
- A promotion still requires the model to choose `offer_course_bonus` from a capability that is actually executable. Keep maximum three bonus courses, one new bonus per customer turn and never a fourth.
- Any active complementary course in the StudyX catalog may be proposed when relevant. Do not hard-code English, photography or any fixed pair.
- Do not use regex or backend copy scoring to decide whether the answer sells, advances or sounds natural.
- The economic argument “one first job can help recover the investment” remains authorized, but the model must not reuse it after it already appeared in the same sale continuity.
- Cross-conversation state is resolved from workspace + verified contact + continuity proof + sale lineage. Never select a sale only because it is the latest one for a phone number.
- If two distinct open unpaid sales are plausible, expose ambiguity and let Emma clarify the course; do not mutate either sale.
- The old link may remain externally payable, but it is no longer the current link after supersession. A late payment against it goes to reconciliation and never enrolls twice or silently receives the new package.
- Do not deploy until deterministic payment/promotion tests, core regressions and two narrow model paths pass.

## Review Focus

- The model must be free to continue selling after `payment_link_sent`; the backend must not confuse conversation phase with financial finality.
- Course, plan, intake data and delivered bonuses survive a normal return to the chat and a verified new conversation.
- An explicit change updates only the requested dimension and creates a new immutable checkout revision when the customer is ready to buy.
- A query about another course is not a course change. A clear selection is.
- Reopening negotiation does not itself send another link; renewed buying intent plus an accepted package does.
- The promotion capability shown to the model must equal what the service can commit under the same lock.
- The same economic sales argument is not repeated across linked conversations, but the backend does not rewrite or reject prose.
- A late webhook, duplicate inbound turn or concurrent conversation cannot produce two successors or two enrollments.

---

### Task 1: Freeze the Current Release and Port the Reviewed Baseline Safely

**Files:**
- Read: `AGENTS.md`
- Read: `docs/authority/prompt-agente-a-studyx-v2.md`
- Read: `docs/authority/spec-backend-bonificacion.md`
- Read from reference commit: all files changed by `ca18d31`
- No source edits in this task

**Interfaces:**
- Input: current release candidate `303e775`, prompt v122, brain v211.
- Reference: `ca18d31`, prompt v123, brain v212.
- Output: a checked file-level port map separating reusable same-conversation logic from missing cross-conversation logic.

- [ ] **Step 1: Verify branch, HEAD and cleanliness**

```bash
git branch --show-current
git rev-parse --short HEAD
git status --short
```

Expected: `codex/studyx-admissions-cutover`, `303e775`, clean tree except this approved plan.

- [ ] **Step 2: Review the reference patch without applying it**

```bash
git show --stat ca18d31
git diff 303e775 ca18d31 -- \
  src/features/payments/application \
  src/features/promotions/application \
  src/features/conversation/domain \
  botpress-agent/src \
  supabase/migrations tests/integration
```

- [ ] **Step 3: Record the port decision in the implementation notes**

Reuse: financial safety reader, common sale lock, immutable supersession, successor package, webhook/fulfillment serialization and `may_reopen_negotiation` contract.

Extend: the reference scope currently keys by one `conversation_id`; replace that with a verified conversation family and payment lineage before exposing the capability.

No commit for this read-only task.

### Task 2: Update the Authority and Versioned Contracts

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/authority/prompt-agente-a-studyx-v2.md`
- Modify: `docs/authority/spec-backend-bonificacion.md`
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Regenerate: `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Regenerate: `src/shared/prompts/studyx-agent-a-canonical.generated.ts`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Test: `tests/unit/botpress/agent-a-canonical-prompt.test.ts`
- Test: `tests/unit/botpress/agent-a-brain-prompt.test.ts`

**Interfaces:**
- Prompt version: v122 → v123.
- Brain version: v211 → v212.
- New technical capability: `commercial_state.course_bonus.may_reopen_negotiation: boolean`.
- Brain remains a technical contract; all commercial judgment stays in the authority prompt.

- [ ] **Step 1: Add failing authority tests**

Assert all of the following:

- a safely unpaid link does not end negotiation;
- a return to chat restores context without automatically offering a gift;
- the model may revise course, plan, data or package only from explicit customer intent;
- it may use an authorized economic comparison once, then must change value angle rather than repeat it;
- it must preserve prior selections and data until the customer changes them.

- [ ] **Step 2: Run the focused tests and confirm failure**

```bash
npx vitest run \
  tests/unit/botpress/agent-a-canonical-prompt.test.ts \
  tests/unit/botpress/agent-a-brain-prompt.test.ts
```

- [ ] **Step 3: Edit authority first, then canonical copy and generated modules**

Remove or qualify every “never after link” rule. Keep “never after verified payment”. Add no fixed wording and no new backend sales rule.

- [ ] **Step 4: Keep brain v212 technical**

Document only how to consume `may_reopen_negotiation`, preserved selections and ambiguity. Do not instruct when or how to persuade.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run \
  tests/unit/botpress/agent-a-canonical-prompt.test.ts \
  tests/unit/botpress/agent-a-brain-prompt.test.ts \
  tests/unit/scripts/botpress-release-provenance.test.ts
git add AGENTS.md docs/authority docs/prompts botpress-agent/src/prompts src/shared/prompts tests/unit/botpress
git commit -m "docs(agent-a): allow flexible unpaid sale revisions"
```

### Task 3: Resolve One Sale Across Verified Conversations

**Files:**
- Add: `src/features/payments/application/negotiation-payment-state.ts`
- Add: `src/features/payments/application/resolve-sale-continuity.ts`
- Add: `supabase/migrations/20261111010001_post_link_negotiation.sql`
- Modify: `src/lib/services/channel-thread-continuity.service.ts`
- Test: `tests/integration/post-link-negotiation.test.ts`
- Test: `tests/integration/whatsapp-thread-continuity.test.ts`

**Interfaces:**

```ts
export interface NegotiationSaleScopeV2 {
  workspace_id: string;
  contact_id: string;
  current_conversation_id: string;
  conversation_ids: readonly string[];
  offering_id: string;
  root_payment_id: string;
}

export type NegotiationSaleResolutionV2 =
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidate_root_payment_ids: readonly string[] }
  | { kind: 'single'; scope: NegotiationSaleScopeV2 };

export async function resolveNegotiationSaleScopeV2(
  db: DbClient,
  input: { workspace_id: string; contact_id: string; current_conversation_id: string; offering_id: string }
): Promise<NegotiationSaleResolutionV2>;
```

The resolver may include only the current conversation plus immutable sources proven by `conversation_history_recovery_links` / channel aliases for the same workspace and contact. `root_payment_id` is derived from the supersession chain, not from recency.

- [ ] **Step 1: Write failing continuity tests**

Cover:

1. same conversation, one safely reserved payment → `single`;
2. new canonical conversation linked to closed source → same `root_payment_id`;
3. same phone without continuity proof → `none`;
4. different workspace or contact → `none`;
5. two unrelated open sales → `ambiguous`;
6. plan/data successor chain → one root;
7. explicit course-change chain → old course is not silently selected.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run tests/integration/whatsapp-thread-continuity.test.ts tests/integration/post-link-negotiation.test.ts
```

- [ ] **Step 3: Port the additive migration from `ca18d31` and extend it**

Add `NEGOTIATION_REOPENED`, predecessor package lineage and inherited bonus identity. Extend the trigger so `source_turn_id` may belong to the current canonical conversation when an immutable continuity proof links it to the original payment conversation. Preserve original payment/message ownership.

The database trigger must reject phone-only matches, cross-tenant matches, ambiguous roots and incomplete successor packages.

- [ ] **Step 4: Implement the resolver and root-keyed lock**

Change the advisory lock key from `workspace/contact/conversation/offering` to `workspace/contact/root_payment_id`. This serializes two linked conversations against the same sale.

- [ ] **Step 5: Pass tests and commit**

```bash
npx vitest run tests/integration/whatsapp-thread-continuity.test.ts tests/integration/post-link-negotiation.test.ts
git add src/features/payments src/lib/services/channel-thread-continuity.service.ts supabase/migrations tests/integration
git commit -m "feat(payments): resolve unpaid sales across verified conversations"
```

### Task 4: Expose an Executable Reopening Capability and Revise the Package Atomically

**Files:**
- Modify: `src/features/promotions/application/read-course-bonus-capability.ts`
- Modify: `src/features/promotions/application/direct-course-bonus-service.ts`
- Modify: `src/shared/conversation/deterministic-sales-rules.ts`
- Modify: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Modify: `src/features/conversation/adapters/agent-a-brain-schema.ts`
- Modify: `botpress-agent/src/schemas/agent-a-brain.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-context.ts`
- Test: `tests/unit/conversation/bonus-permission-primitives.test.ts`
- Test: `tests/unit/conversation/agent-turn-policy-v2.test.ts`
- Test: `tests/integration/direct-course-bonus-service.test.ts`
- Test: `tests/integration/post-link-negotiation.test.ts`

**Interfaces:**
- `may_reopen_negotiation=true` only when the same service transaction can commit the successor.
- `may_offer_bonus` remains model-facing permission, not an instruction to offer.
- Resulting successor carries `predecessor_offer_id`, exact delivered gifts, new gift, promotion cycle/version and the current conversation as the revision source.

- [ ] **Step 1: Add failing tests for the complete capability matrix**

| State | Capability | Expected effect |
|---|---|---|
| Link sent, safely unpaid, new price objection | may reopen + may offer | one successor package |
| Link sent, safely unpaid, greeting/info only | may reopen internally; no automatic action | no DB mutation |
| Paid, pending, provider session, reconciliation | no reopen | conversation only |
| Linked new conversation, one sale | may reopen | same root, new revision source |
| Ambiguous sales | no action | ask clarification |
| Three existing bonuses | no fourth | package unchanged |

- [ ] **Step 2: Confirm failures**

```bash
npx vitest run \
  tests/unit/conversation/bonus-permission-primitives.test.ts \
  tests/unit/conversation/agent-turn-policy-v2.test.ts \
  tests/integration/direct-course-bonus-service.test.ts \
  tests/integration/post-link-negotiation.test.ts
```

- [ ] **Step 3: Implement capability from the same locked financial reader**

Do not infer safety from `stage=payment_link_sent` or `paid_at IS NULL`. Read payment rows, provider session, events, reconciliation, supersession and paid evidence under the root sale lock.

- [ ] **Step 4: Implement one atomic successor transaction**

Within one transaction:

1. lock the root sale;
2. re-read safety and capability;
3. retire the old checkout as `NEGOTIATION_REOPENED`;
4. cancel the old attached/accepted offer only for that reason;
5. create one successor offer;
6. inherit all delivered bonuses without redelivery;
7. append exactly one relevant active course chosen by the model;
8. preserve the cap and version;
9. reset checkout state to the prior selected course/plan/data, without sending a new link.

- [ ] **Step 5: Pass tests and commit**

```bash
npx vitest run \
  tests/unit/conversation/bonus-permission-primitives.test.ts \
  tests/unit/conversation/agent-turn-policy-v2.test.ts \
  tests/integration/direct-course-bonus-service.test.ts \
  tests/integration/post-link-negotiation.test.ts
git add src/features/promotions src/features/conversation src/shared/conversation botpress-agent/src
git commit -m "feat(promotions): reopen safely unpaid packages without closing the sale"
```

### Task 5: Preserve and Revise Course, Plan and Contact Data Without Rigidity

**Files:**
- Modify: `src/features/payments/application/replace-pending-checkout.ts`
- Modify: `src/features/payments/application/reserve-payment-link.ts`
- Modify: `src/features/sales/domain/sales-context.ts`
- Modify: `src/lib/services/projection.service.ts`
- Modify: `src/features/orchestration/adapters/postgres-orchestration-store.ts`
- Test: `tests/unit/conversation/incident-a-course-switch.test.ts`
- Test: `tests/unit/conversation/incident-b-email-reconfirmation.test.ts`
- Test: `tests/integration/incident-b-checkout-revision-replay.test.ts`
- Test: `tests/integration/contact-profile-external-writers.test.ts`
- Test: `tests/integration/post-link-negotiation.test.ts`

**Interfaces:**
- A resumed sale loads the last materialized course, explicit plan, intake data and package from the resolved sale lineage.
- A correction changes only the named field.
- A query about another course does not call course supersession.
- An explicit course selection cancels the previous promotion cycle and starts a new one; personal/contact data remain.
- A new payment link is created only after the revised package and data are accepted and a buying signal exists.

- [ ] **Step 1: Add failing replay tests**

Cover same-chat and linked-chat variants for:

- email correction;
- phone/name correction;
- payment-plan change;
- question about another course, with no mutation;
- explicit paid-course change;
- returning to the original course;
- request to resend the current valid link;
- accepted revised package followed by exact new link.

- [ ] **Step 2: Confirm failures**

```bash
npx vitest run \
  tests/unit/conversation/incident-a-course-switch.test.ts \
  tests/unit/conversation/incident-b-email-reconfirmation.test.ts \
  tests/integration/incident-b-checkout-revision-replay.test.ts \
  tests/integration/contact-profile-external-writers.test.ts \
  tests/integration/post-link-negotiation.test.ts
```

- [ ] **Step 3: Materialize lineage state into the current conversation**

Copy only current decisions into the current sales projection. Keep old messages, old payment, old offer and their original conversation IDs immutable.

- [ ] **Step 4: Compare exact checkout equivalence**

Before reusing a link, compare paid course, plan, registration data, environment, provider, promotion cycle, accepted offer version and complete bonus snapshot. Any changed dimension creates a successor; no changed dimension reuses the current safe link.

- [ ] **Step 5: Pass tests and commit**

```bash
npx vitest run \
  tests/unit/conversation/incident-a-course-switch.test.ts \
  tests/unit/conversation/incident-b-email-reconfirmation.test.ts \
  tests/integration/incident-b-checkout-revision-replay.test.ts \
  tests/integration/contact-profile-external-writers.test.ts \
  tests/integration/post-link-negotiation.test.ts
git add src/features/payments src/features/sales src/lib/services src/features/orchestration tests
git commit -m "fix(checkout): preserve flexible sale state across revisions"
```

### Task 6: Prevent Repeated Value Arguments Without Backend Copy Control

**Files:**
- Modify: `botpress-agent/src/lib/conversation/agent-a-context.ts`
- Modify: `src/features/orchestration/adapters/postgres-orchestration-store.ts`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Modify: `docs/authority/prompt-agente-a-studyx-v2.md` only if Task 2 did not fully capture the approved rule
- Test: `tests/unit/botpress/agent-a-context.test.ts`
- Test: `tests/unit/conversation/plannerless-natural-evidence-regression.test.ts`
- Test: `tests/integration/orchestration-lifecycle.test.ts`

**Interfaces:**
- Context exposes prior assistant turns from the verified continuity family in `turn_reasoning.already_said` / continuity summary.
- The model decides whether an argument is repeated. The backend neither regex-matches nor rejects prose.

- [ ] **Step 1: Add failing context tests**

The context for a new linked conversation must include a compact marker that the economic recovery argument was already used, when that fact is present in the model-authored prior-turn reasoning. It must not quote or resend the full old sales message.

- [ ] **Step 2: Implement model-authored argument continuity**

Persist and recover the model's structured `already_said` marker for the sale lineage. Do not derive it by scanning customer-visible text. The prompt instructs Emma to select another value dimension—career opportunity, skill utility, schedule, certificate or fit—rather than repeat the same claim.

- [ ] **Step 3: Verify no rigidity regression**

```bash
npx vitest run \
  tests/unit/botpress/agent-a-context.test.ts \
  tests/unit/conversation/plannerless-natural-evidence-regression.test.ts \
  tests/integration/orchestration-lifecycle.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add botpress-agent/src/lib/conversation botpress-agent/src/prompts src/features/orchestration docs/authority tests
git commit -m "fix(agent-a): vary value arguments across continued sales"
```

### Task 7: Serialize Webhooks, Enrollment and Late Old-Link Payments

**Files:**
- Modify: `src/features/payments/application/record-payment-event.ts`
- Modify: `src/features/fulfillment/central-carga/worker.ts`
- Modify: `src/features/payments/application/negotiation-payment-state.ts`
- Test: `tests/integration/post-link-negotiation.test.ts`
- Test: `tests/integration/agent-loop-exactly-once.test.ts`
- Test: `tests/integration/direct-course-bonus-checkout.test.ts`

**Interfaces:**
- Webhook and enrollment acquire the same root sale lock as negotiation revision.
- Old superseded payment paid late → reconciliation only.
- Current successor paid → enroll exact paid course plus exact sealed bonuses once.

- [ ] **Step 1: Add failing race tests**

Test duplicate turns, two concurrent linked conversations, webhook racing the revision, failure halfway through successor creation and late payment on the retired link.

- [ ] **Step 2: Port the shared lock from `ca18d31` and key it by root sale**

Do not hold a database transaction during the external Central Carga call; use the existing session-lock pattern and re-check the lineage before committing enrollment state.

- [ ] **Step 3: Pass tests and commit**

```bash
npx vitest run \
  tests/integration/post-link-negotiation.test.ts \
  tests/integration/agent-loop-exactly-once.test.ts \
  tests/integration/direct-course-bonus-checkout.test.ts
git add src/features/payments src/features/fulfillment tests/integration
git commit -m "fix(payments): serialize revised sales with payment and enrollment"
```

### Task 8: Run Focused Acceptance and Regression Verification

**Files:**
- Modify only if needed: narrow synthetic fixture under `botpress-agent/evals/`
- Produce: terminal evidence table; do not add a large new golden suite

**Interfaces:**
- Deterministic tests prove financial and state behavior.
- Two real-model synthetic paths verify naturalness and executable actions.

- [ ] **Step 1: Run all deterministic suites for the changed boundaries**

```bash
npm test -- --run \
  tests/unit/botpress/agent-a-context.test.ts \
  tests/unit/botpress/agent-a-canonical-prompt.test.ts \
  tests/unit/conversation/agent-turn-policy-v2.test.ts \
  tests/unit/conversation/bonus-permission-primitives.test.ts \
  tests/unit/conversation/incident-a-course-switch.test.ts \
  tests/unit/conversation/incident-b-email-reconfirmation.test.ts \
  tests/integration/post-link-negotiation.test.ts \
  tests/integration/whatsapp-thread-continuity.test.ts \
  tests/integration/direct-course-bonus-service.test.ts \
  tests/integration/direct-course-bonus-checkout.test.ts \
  tests/integration/incident-b-checkout-revision-replay.test.ts \
  tests/integration/contact-profile-external-writers.test.ts \
  tests/integration/agent-loop-exactly-once.test.ts
```

- [ ] **Step 2: Run the existing no-break regression groups**

At minimum: calls, program/PDF delivery, outbound never-silence, payment link, fulfillment, opt-out and Botpress release provenance.

- [ ] **Step 3: Run only two DeepSeek synthetic conversations**

1. Same conversation: link sent → renewed price objection → one relevant bonus → acceptance → new exact link.
2. Verified new conversation: greeting → resume same course/plan/data → discuss another course without changing it → explicit change or correction → correct revision.

For each turn record: actual text, move, action, capability, backend rejection, state, latency and whether the economic argument repeated. No 16-case or 220-call run is required for this narrow delivery.

- [ ] **Step 4: Architect completion review**

Because this is a payment-sensitive repeated failure, ask the architect to review the final diff and evidence before deployment. Resolve every material finding.

- [ ] **Step 5: Build and verify clean tree**

```bash
npm run build
git status --short
git log --oneline -8
```

### Task 9: Deploy in a Safe Compatibility Order

**Files:**
- Modify: release manifest/provenance files required by the existing runbook
- Read: `docs/runbooks/agent-a-brain-canary.md`
- Read: current Botpress and Vercel deployment runbooks

**Interfaces:**
- Database migration is backward-compatible.
- Botpress v123/v212 understands the new optional capability while the old backend still returns it false/absent.
- Backend activation happens last.

- [ ] **Step 1: Commit and push the final release source**

Record the final SHA, prompt v123 and brain v212. Push `codex/studyx-admissions-cutover` before any production mutation.

- [ ] **Step 2: Apply the additive database migration**

Verify constraints and functions exist. Do not activate behavior if the migration verification fails.

- [ ] **Step 3: Publish Botpress prompt v123 / brain v212**

The new field remains dormant against the old backend, so it cannot promise an effect that is not yet executable.

- [ ] **Step 4: Deploy the backend to the current StudyX Vercel test/production target**

Verify `/health`, readiness, catalog, bonus capability and payment services. Confirm the deployment SHA exactly matches the pushed release SHA.

- [ ] **Step 5: Run one owner-contact canary without resetting financial history**

Use a safely unpaid test checkout:

1. send/select course and plan;
2. receive link;
3. raise a new price objection;
4. verify one relevant promotion is offered naturally;
5. accept it;
6. verify a new exact link is sent only after acceptance;
7. verify contact data and plan persisted;
8. open a verified new conversation and confirm continuity without an automatic promotion.

- [ ] **Step 6: Verify audit evidence**

Confirm exactly one supersession, one successor package, correct root lineage, no fourth gift, no duplicate payment, no duplicate enrollment and no outbound silence.

- [ ] **Step 7: Roll back if any financial invariant fails**

Redeploy backend `303e775`; leave the additive migration in place; republish prompt v122 / brain v211 only if Botpress compatibility itself fails. A rollback must not delete audit or payment rows.

## Completion Evidence

Report one table with:

| Area | Result | Evidence |
|---|---|---|
| Same-chat reopening | APROBADO/FALLIDO | payment + promotion lineage |
| Cross-chat continuity | APROBADO/FALLIDO | verified recovery link + preserved state |
| Contact/plan/course changes | APROBADO/FALLIDO | exact revision tests |
| Bonus cap and catalog flexibility | APROBADO/FALLIDO | service tests |
| Repetition/naturalness | APROBADO/FALLIDO | two model transcripts |
| Late old-link payment | APROBADO/FALLIDO | reconciliation test |
| Enrollment exactly once | APROBADO/FALLIDO | fulfillment evidence |
| Calls/PDF/outbound regressions | APROBADO/FALLIDO | regression suites |
| Deployment identity | APROBADO/FALLIDO | SHA + prompt/brain versions |

Do not say “listo” unless every row is approved or an explicitly accepted limitation is documented.
