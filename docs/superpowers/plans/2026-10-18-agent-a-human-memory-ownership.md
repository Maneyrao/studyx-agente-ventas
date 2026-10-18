# Agent A: memoria, autoría y continuidad — Implementation Plan

> **Execution:** apply TDD task by task. Agent A remains the only author of customer-visible conversational prose; the backend may only validate/execute effects and append exact immutable values.

**Goal:** Recover natural, continuous end-to-end selling without backend-authored canned replies, while preserving payment, enrollment, Agent B calls and post-sale idempotency.

**Architecture:** Keep the current plannerless Agent A loop. Enrich the canonical context with durable, bounded conversation history and selected memories; retain semantic rejection as feedback to Agent A instead of converting it into backend prose; keep protocol actions independent so one rejected commercial claim cannot erase a valid call/payment intent. Calls and post-sale remain durable effects, with Agent A composing every variable message.

**Source of conversational behavior:** `docs/prompts/studyx-agent-a-canonical.md`, adapted from the user's humanized prompt reference. Examples are behavioral guidance, never literal scripts.

## Global acceptance criteria

- Neutral Spanish using `tú`; no voseo or regionalisms.
- Agent A identifies the current commercial moment dynamically and chooses one useful next move.
- Backend never invents customer-facing copy. It may append only canonical payment/access values.
- Missing or ambiguous data produces an Agent A clarification, not silence or a canned backend apology.
- A mixed turn preserves independent valid obligations (for example, a call request) when another claim is rejected.
- Conversation state, durable summary/history and vector memory remain isolated by workspace/contact and survive sessions.
- Agent B handoff and post-call continuation have one conversational owner and do not duplicate messages.
- Payment confirmation, enrollment and access delivery remain idempotent.

### Task 1: Lock the ownership and prompt contract

**Files:**
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Regenerate: `src/shared/prompts/studyx-agent-a-canonical.generated.ts`
- Regenerate: `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Modify: focused prompt/context tests

- [ ] Add RED tests for dynamic call timing, explicit backend non-authorship, protocol-driven variable post-sale/call messages, and neutral Spanish.
- [ ] Update only the canonical source prompt, removing the rigid “second intervention” timing and making commercial-stage inference explicit.
- [ ] Regenerate both consumers and make the tests GREEN.

### Task 2: Restore durable conversational memory

**Files:**
- Modify: orchestration claim/context and memory selection files
- Modify or add: durable summary/history projection files and migration only if required
- Modify: integration and context tests

- [ ] Add RED coverage proving a relevant fact outside the ten-turn window reaches Agent A without leaking across contacts/workspaces.
- [ ] Replace the disabled/stale-summary gap with a durable bounded context projection; do not call a summarizer in the inbound request path.
- [ ] Preserve vector retrieval as complementary long-term memory and expose freshness/version metadata.
- [ ] Make focused unit and integration tests GREEN.

### Task 3: Remove backend-authored semantic fallbacks

**Files:**
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: plannerless resolver/repair helpers as required
- Modify: workflow regression tests

- [ ] Add RED coverage for repeated semantic rejection: the workflow must retain/retry Agent A authorship and must not commit the backend canned apology.
- [ ] Separate true provider unavailability from semantic validation; persist/retry recoverable turns without fabricating prose.
- [ ] Prove no backend-authored commercial text is emitted and every recoverable active turn reaches an Agent A-authored response.

### Task 4: Preserve mixed-turn obligations

**Files:**
- Modify: plannerless proposal resolution and effect materialization
- Modify: mixed-intent workflow tests

- [ ] Reproduce the discount-plus-call case where a rejected claim swallowed the valid call request.
- [ ] Keep unsafe prose/effects fenced while preserving independently authorized intent and customer-visible Agent A copy.
- [ ] Prove call, payment and data capture remain idempotent under repair/replay.

### Task 5: Unify Agent B handback ownership

**Files:**
- Modify: post-call follow-up store/application as required
- Modify: unit/integration post-call tests

- [ ] Reproduce the duplicate “call ended” + later post-call message case.
- [ ] Elect one durable owner for each terminal call outcome and suppress/reuse the other path.
- [ ] Prove A→B→A returns to the same conversation exactly once with Agent A-authored text.

### Task 6: Certify payment, enrollment and access

**Files:**
- Verify/modify only on reproduced defect: payment, fulfillment, post-sale and Botpress trigger tests

- [ ] Run the payment-link, confirmed-payment, enrollment and access-message vertical suites.
- [ ] Assert one canonical link, one enrollment and one access delivery under retries/concurrency.
- [ ] Confirm Agent A authors the surrounding text and the backend appends only immutable values.

### Task 7: Final verification and release boundary

- [ ] Run focused tests after every task.
- [ ] Run typecheck, lint, all unit tests, clean-database integration tests and both builds.
- [ ] Review the final diff against every acceptance criterion and record the evidence.
- [ ] Stop before push, migrations, deployment or live canaries; present the verified SHA and request explicit release confirmation.

