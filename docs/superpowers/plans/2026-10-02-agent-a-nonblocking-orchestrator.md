# Agent A Nonblocking Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent policy, action and projection failures from replacing or blocking Agent A's DeepSeek-authored conversation while preserving every existing StudyX effect.

**Architecture:** Refactor the current plannerless hot path incrementally rather than introducing a parallel orchestration stack. First classify and retry genuine DeepSeek transport failures; then separate conversational validation from action authorization, persist exact diagnostics, and prove that canonical state is synchronous while external projections remain nonblocking.

**Tech Stack:** TypeScript 5.9, Next.js 16, Botpress ADK 2.0.5, Vitest 4, PostgreSQL/Supabase, DeepSeek direct API.

**Spec:** `docs/superpowers/specs/2026-10-01-agent-a-nonblocking-orchestrator-design.md`

## Global Constraints

- DeepSeek is the sole conversational provider; never fail over silently to Gemini, Groq or backend-authored sales copy.
- Retry DeepSeek exactly once and only for timeout, network failure or HTTP `5xx`.
- Agent A owns wording, tone, commercial guidance and how missing data is requested.
- The backend owns canonical facts, opt-out/security, action authorization, idempotency and persistence.
- A rejected action must not be classified as `MODEL_UNAVAILABLE` and must not erase safe Agent A prose.
- Canonical lead, commercial and action state remains synchronous; Sheets, embeddings and summaries remain nonblocking projections.
- No regex intent router, new planner, phrase library, fixed bubble count or conversational length gate.
- Preserve current calls, Agent B, Stripe, payment verification, memory, campaign, multi-course, Telegram and WhatsApp behavior.
- Use baseline commit `422c4c9` only as a pinned naturalness reference, not as a code rollback target.
- Do not stage or alter pre-existing unrelated dirty files in this worktree.

## Review Focus

- A valid reply plus unauthorized call/payment action must deliver the reply or a model-authored repair, never a technical fallback.
- A successful external effect followed by continuation failure must reuse its receipt and never execute twice.
- A genuine DeepSeek timeout must make exactly two total DeepSeek attempts, use no other LLM, and produce one bounded technical channel notice only after both fail.
- A Sheets or memory projection failure must not change the committed outbound or delivery status.
- Asynchronous Agent B events must update the same lead and allow a later Agent A turn without replaying call dispatch or re-requesting confirmed data.

---

## File map

- `botpress-agent/src/lib/conversation/agent-a-attempt.ts`: pure failure taxonomy and bounded DeepSeek attempt runner.
- `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts`: distinguish conversational safety from action authorization and preserve safe model prose.
- `botpress-agent/src/workflows/processInboundTurn.ts`: narrow generation/resolution catches, invoke the bounded runner and emit structured diagnostics.
- `botpress-agent/src/schemas/contracts.ts`: optional decision diagnostics on the Botpress-to-Next.js wire contract.
- `src/app/api/agent/turns/[turn_id]/decision/route.ts`: validate and pass optional diagnostics.
- `src/lib/services/decision.service.ts`: persist exact turn diagnostics with the immutable decision.
- `supabase/migrations/20261002010001_agent_decision_diagnostics.sql`: additive diagnostics column with a bounded JSON shape.
- `tests/unit/botpress/agent-a-attempt.test.ts`: transport classification and retry budget.
- `tests/unit/botpress/resolve-agent-a-plannerless.test.ts`: mixed action/fact rejection survival.
- `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`: production-workflow branching and provider isolation.
- `tests/integration/agent-a-nonblocking-orchestrator.test.ts`: PostgreSQL commit, diagnostics, idempotency and nonblocking projections.
- `tests/workflow/agent-a-nonblocking-vertical.test.ts`: same workflow/resolver/backend vertical certification.

### Task 1: Classify genuine DeepSeek failures and restore one bounded retry

**Files:**
- Create: `botpress-agent/src/lib/conversation/agent-a-attempt.ts`
- Create: `tests/unit/botpress/agent-a-attempt.test.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts:867-1135`
- Modify: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts:1077-1210`

**Interfaces:**
- Produces: `classifyAgentAAttemptFailure(error): AgentAAttemptFailureV1`
- Produces: `runAgentADeepSeekAttemptV1(generate, onRetry): Promise<T>`
- Consumed by: Task 2 workflow failure branching.

- [ ] **Step 1: Write the failure-taxonomy unit tests**

```ts
it.each([
  ['BRAIN_DEEPSEEK_TIMEOUT', true, 'provider_transport'],
  ['BRAIN_DEEPSEEK_NETWORK_ERROR', true, 'provider_transport'],
  ['BRAIN_DEEPSEEK_HTTP_503', true, 'provider_transport'],
  ['BRAIN_DEEPSEEK_HTTP_429', false, 'provider_rejected'],
  ['PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:request_call_now', false, 'policy'],
])('classifies %s', (code, retryable, stage) => {
  expect(classifyAgentAAttemptFailure(Object.assign(new Error(code), { code })))
    .toMatchObject({ code, retryable, stage });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-attempt.test.ts`

Expected: FAIL because `agent-a-attempt.ts` does not exist.

- [ ] **Step 3: Implement the pure classifier and bounded runner**

```ts
export type AgentAAttemptFailureStageV1 =
  | 'provider_transport' | 'provider_rejected' | 'schema' | 'policy' | 'unknown';

export interface AgentAAttemptFailureV1 {
  readonly stage: AgentAAttemptFailureStageV1;
  readonly code: string;
  readonly retryable: boolean;
}

export async function runAgentADeepSeekAttemptV1<T>(input: {
  readonly generate: () => Promise<T>;
  readonly onRetry: (failure: AgentAAttemptFailureV1) => void;
}): Promise<{ value: T; attempts: 1 | 2 }> {
  try {
    return { value: await input.generate(), attempts: 1 };
  } catch (first) {
    const failure = classifyAgentAAttemptFailure(first);
    if (!failure.retryable) throw first;
    input.onRetry(failure);
    return { value: await input.generate(), attempts: 2 };
  }
}
```

Classification must read stable `code` fields and exact message prefixes only for existing typed errors; it must never inspect customer content.

- [ ] **Step 4: Extend RED coverage for retry behavior**

Add tests proving timeout→success calls `generate` twice, HTTP 400/policy rejection calls it once, and two timeouts throw the second error after exactly two calls.

Run the command from Step 2.

Expected: FAIL until the runner implements the exact call budget; then PASS.

- [ ] **Step 5: Wire only DeepSeek generation through the runner**

Replace the direct `step('generate-agent-a-turn-proposal-v1-deepseek', ...)` call with two explicitly named durable steps inside `runAgentADeepSeekAttemptV1`: first generation and one retry. Keep resolver, repair and commit outside this retry closure so a policy rejection can never trigger a provider retry.

Record `agent_a_generation_attempts` and the first retry code in `safeLog`, without PII.

- [ ] **Step 6: Update the hot-path RED/GREEN tests**

Change the timeout case to expect exactly two DeepSeek calls, zero Gemini/Groq calls, and one technical notice only after the second timeout. Add a policy-rejection case expecting one DeepSeek generation plus at most the existing model repair, never the transport retry step.

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-attempt.test.ts tests/unit/botpress/process-inbound-turn-hot-path.test.ts`

Expected: PASS with no failover-provider calls.

- [ ] **Step 7: Commit Task 1**

```bash
git add botpress-agent/src/lib/conversation/agent-a-attempt.ts \
  botpress-agent/src/workflows/processInboundTurn.ts \
  tests/unit/botpress/agent-a-attempt.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts
git commit -m "fix(agent-a): classify and retry transient deepseek failures"
```

### Task 2: Separate conversational validity from action authorization

**Files:**
- Modify: `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts`
- Modify: `src/features/conversation/application/prepare-agent-turn-v2.ts`
- Modify: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Modify: `tests/unit/botpress/resolve-agent-a-plannerless.test.ts`
- Modify: `tests/unit/conversation/prepare-agent-turn-v2.test.ts`
- Modify: `tests/unit/conversation/agent-turn-policy-v2.test.ts`

**Interfaces:**
- Consumes: Task 1 failure taxonomy only for workflow classification, not for policy decisions.
- Produces: `PlannerlessResolutionV2.action_rejection` as structured data separate from `effective` conversation.
- Produces: `AgentActionRejectionV1` with action, codes and missing fields; no customer-facing text.
- Consumed by: Tasks 3 and 4 diagnostics/vertical tests.

- [ ] **Step 1: Add RED tests for mixed rejections**

Cover these exact cases:

```ts
it('preserves safe guidance when candidate detail and call action are rejected together', async () => {
  const result = await resolveAgentAPlannerlessProposalV2(/* proposal with:
    FACT_VALUE_MISMATCH:candidate_course_detail and
    ACTION_NOT_AUTHORIZED:request_call_now */);
  expect(result.effective.proposal.response.messages).not.toEqual([]);
  expect(result.effective.proposal.proposed_action).toEqual({ type: 'none' });
  expect(result.action_rejection?.codes).toContain('ACTION_NOT_AUTHORIZED');
});
```

Also cover missing surname/phone for a call, missing payment plan, repeated action receipt, and safe prose plus an unsupported payment-success claim.

- [ ] **Step 2: Run focused resolver tests and verify RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/resolve-agent-a-plannerless.test.ts tests/unit/conversation/prepare-agent-turn-v2.test.ts tests/unit/conversation/agent-turn-policy-v2.test.ts`

Expected: at least the mixed-rejection assertion fails because the current resolver throws `PLANNERLESS_PROPOSAL_REJECTED`.

- [ ] **Step 3: Add the action-rejection result type**

```ts
export interface AgentActionRejectionV1 {
  readonly action: 'request_call_now' | 'send_payment_link' | 'send_test_payment_link';
  readonly codes: readonly string[];
  readonly missing_fields: readonly string[];
  readonly retryable: boolean;
}

export interface PlannerlessResolutionV2<T> {
  readonly effective: T;
  readonly evidence: AgentAProposalCycleEvidenceV1;
  readonly rejection: TurnRejectionV1 | null;
  readonly action_rejection: AgentActionRejectionV1 | null;
}
```

Split rejection reasons into narrative/fact reasons and action reasons. Keep the existing one model repair when the response claims an effect occurred. After that repair, remove only an unauthorized structured action; preserve model prose only when it contains no false success claim. Never manufacture replacement sales copy.

- [ ] **Step 4: Make backend authorization return action data instead of rejecting safe prose**

Keep `authorizeAgentTurnV2` strict for effects. In `prepareAgentTurnV2`, convert an effect-only rejection into `proposed_action: none`, preserve the already-authorized response, and derive the pending durable state. Any fact/security/opt-out rejection still fails closed.

Do not loosen canonical price, course, payment-verification or consent checks.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS; no test accepts a false “link sent”, “payment verified” or “call connected” statement.

- [ ] **Step 6: Commit Task 2**

```bash
git add botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts \
  src/features/conversation/application/prepare-agent-turn-v2.ts \
  src/features/conversation/domain/agent-turn-policy-v2.ts \
  tests/unit/botpress/resolve-agent-a-plannerless.test.ts \
  tests/unit/conversation/prepare-agent-turn-v2.test.ts \
  tests/unit/conversation/agent-turn-policy-v2.test.ts
git commit -m "refactor(agent-a): isolate action rejection from conversation"
```

### Task 3: Narrow workflow catches and persist exact diagnostics

**Files:**
- Create: `supabase/migrations/20261002010001_agent_decision_diagnostics.sql`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/actions/commitDecision.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Modify: `src/lib/services/decision.service.ts`
- Create: `tests/integration/agent-a-nonblocking-orchestrator.test.ts`
- Modify: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`

**Interfaces:**
- Consumes: Task 1 `AgentAAttemptFailureV1` and Task 2 `action_rejection`.
- Produces: optional `turn_diagnostics` wire field and persisted `agent_decisions.diagnostics` JSON.
- Consumed by: Task 5 certification metrics.

- [ ] **Step 1: Write the migration contract test first**

In the new integration test, insert/commit a decision with:

```ts
turn_diagnostics: {
  schema_version: 1,
  generation_attempts: 1,
  failure_stage: 'action_authorization',
  failure_codes: ['ACTION_NOT_AUTHORIZED'],
  action_status: 'needs_input',
}
```

Assert it persists on exactly one immutable `agent_decisions` row and contains no customer text, email, phone, token or secret.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' npm run test:integration -- tests/integration/agent-a-nonblocking-orchestrator.test.ts`

Expected: FAIL because the column and contract do not exist.

- [ ] **Step 3: Add the additive diagnostics column and strict optional schema**

Migration shape:

```sql
ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS diagnostics jsonb;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_diagnostics_shape_check CHECK (
    diagnostics IS NULL OR (
      jsonb_typeof(diagnostics) = 'object'
      AND diagnostics ->> 'schema_version' = '1'
      AND COALESCE(jsonb_typeof(diagnostics -> 'failure_codes') = 'array', false)
    )
  );
```

The Zod contract allowlists only schema version, attempt count, failure stage, bounded codes and action status. It rejects unknown keys to prevent accidental PII persistence.

- [ ] **Step 4: Persist diagnostics in the same decision transaction**

Thread optional diagnostics from Botpress through the route into `commitDecision`. Add it to the immutable insert; do not update diagnostics after commit.

- [ ] **Step 5: Split the workflow catch boundaries**

Use separate try/catch blocks for:

1. DeepSeek transport/schema generation;
2. plannerless validation/repair;
3. backend commit;
4. action dispatch;
5. delivery and projection.

Only block 1 may classify `MODEL_UNAVAILABLE`. Policy/action rejection records its exact stage and proceeds with the Task 2 effective conversation. Projection failures remain logs/outbox state and cannot change the committed outbound.

- [ ] **Step 6: Add workflow RED/GREEN assertions**

Assert:

- combined action/fact rejection commits an Agent A decision, never `MODEL_UNAVAILABLE`;
- two genuine DeepSeek timeouts commit one technical channel notice with provider stage diagnostics;
- action rejection performs no transport retry;
- commit failure returns `paused_error` and does not pretend the model failed;
- projection failure occurs after outbound submission and does not alter delivery status.

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/process-inbound-turn-hot-path.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the integration test and verify GREEN**

Run the command from Step 2.

Expected: PASS with one decision, one outbound, one diagnostic record and no duplicate effects.

- [ ] **Step 8: Commit Task 3**

```bash
git add supabase/migrations/20261002010001_agent_decision_diagnostics.sql \
  botpress-agent/src/schemas/contracts.ts \
  botpress-agent/src/actions/commitDecision.ts \
  botpress-agent/src/workflows/processInboundTurn.ts \
  'src/app/api/agent/turns/[turn_id]/decision/route.ts' \
  src/lib/services/decision.service.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/integration/agent-a-nonblocking-orchestrator.test.ts
git commit -m "feat(orchestration): persist exact nonblocking turn diagnostics"
```

### Task 4: Prove effect receipts, asynchronous Agent B continuation and nonblocking projections

**Files:**
- Modify: `tests/integration/agent-a-nonblocking-orchestrator.test.ts`
- Modify: `tests/integration/agent-a-xendra-agent-b-e2e.test.ts`
- Modify: `tests/integration/post-call-followup.test.ts`
- Modify: `tests/integration/delivery-attempt-fencing.test.ts`
- Modify only if a test exposes a defect: existing call/payment/projection implementation owning that defect.

**Interfaces:**
- Consumes: existing call/session/payment ids plus Task 3 diagnostics.
- Produces: verified guarantees, not a new framework.
- Consumed by: Task 5 vertical certification.

- [ ] **Step 1: Add RED tests for a successful effect followed by response failure**

Create one call reservation/dispatch receipt, simulate continuation failure, retry with the same logical turn/action key, and assert:

```ts
expect(callCount).toBe(1);
expect(receipt.status).toMatch(/accepted|already_dispatched/);
```

Repeat the pattern for one payment link reservation.

- [ ] **Step 2: Add Agent B lifecycle coverage**

Exercise `call_started`, `call_ended`, `call_analyzed` and a tool result against the same `lead_id`, `conversation_id`, `internal_call_id` and provider call id. Assert the later Agent A context contains confirmed voice data and does not dispatch the call again.

- [ ] **Step 3: Add projection-failure coverage**

Force the existing Sheets projection trigger/provider to fail after a committed outbound. Assert:

- outbound remains submitted;
- canonical contact/course/plan/action state remains committed;
- `sheet_projection_rows` is retryable with its exact error;
- the same lead keeps one projection row.

- [ ] **Step 4: Run the tests and observe RED only where behavior is missing**

Run:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' \
DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' \
npm run test:integration -- \
  tests/integration/agent-a-nonblocking-orchestrator.test.ts \
  tests/integration/agent-a-xendra-agent-b-e2e.test.ts \
  tests/integration/post-call-followup.test.ts \
  tests/integration/delivery-attempt-fencing.test.ts
```

Expected: any new failing assertion identifies a specific existing boundary; pre-existing coverage remains green.

- [ ] **Step 5: Implement only demonstrated missing behavior**

If an effect duplicates, repair its existing reservation/idempotency lookup. If a projection blocks, move only the external flush after delivery while keeping canonical state synchronous. If Agent B data is absent, fix its existing correlation/persistence adapter. Do not introduce a second action system.

- [ ] **Step 6: Re-run the Task 4 command and verify GREEN**

Expected: PASS with no duplicated call, payment link, contact or Sheets row.

- [ ] **Step 7: Commit Task 4**

Stage only files actually changed by the failing tests, then:

```bash
git commit -m "test(orchestration): certify action receipts and async continuity"
```

### Task 5: Vertical production-path certification

**Files:**
- Create: `tests/workflow/agent-a-nonblocking-vertical.test.ts`
- Create: `docs/reports/2026-10-02-agent-a-nonblocking-orchestrator-results.md`
- Modify: `botpress-agent/src/workflows/processInboundTurn.source.json` by running the repository's source-generation/build command, not by hand.

**Interfaces:**
- Consumes: Tasks 1-4 complete behavior.
- Produces: deployable same-SHA Vercel/Botpress candidate and evidence report.

- [ ] **Step 1: Pin the vertical cases before implementation-specific assertions**

The workflow test must run the real `processInboundTurn`, resolver, backend route/service and PostgreSQL boundary for:

1. `entonces` followed by `decime q onda` in one batch;
2. unsupported candidate detail plus direct call request;
3. missing surname/phone while requesting a call;
4. missing payment plan while requesting a link;
5. payment action accepted and delivery continuation retried;
6. Agent B call event followed by Agent A continuation;
7. Sheets projection failure after successful delivery;
8. two true DeepSeek transient failures.

For cases 1-7 assert `reason_code !== 'MODEL_UNAVAILABLE'`. For case 8 assert two DeepSeek attempts, no other LLM and one technical notice.

- [ ] **Step 2: Run the vertical test and verify RED if any boundary is incomplete**

Run: `npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-nonblocking-vertical.test.ts`

Expected: PASS only after Tasks 1-4 satisfy all boundaries.

- [ ] **Step 3: Run focused and full gates**

Run:

```bash
npm run test:unit
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' npm run test:integration
npm run typecheck
npm run lint
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
npm --prefix botpress-agent run build
git diff --check
```

Expected: every command exits `0`; report any unrelated pre-existing failure by exact test name rather than hiding it.

- [ ] **Step 4: Generate the evidence report**

Record commit SHAs, commands, pass/fail counts, the eight vertical outcomes, failure-stage metrics and confirmation that unrelated dirty files were not included.

- [ ] **Step 5: Commit Task 5**

```bash
git add tests/workflow/agent-a-nonblocking-vertical.test.ts \
  docs/reports/2026-10-02-agent-a-nonblocking-orchestrator-results.md \
  botpress-agent/src/workflows/processInboundTurn.source.json
git commit -m "test(agent-a): certify nonblocking orchestration vertically"
```

### Task 6: Release candidate verification and controlled deployment

**Files:**
- Modify only generated release manifest/evidence files required by the existing release process.

**Interfaces:**
- Consumes: one green candidate SHA from Task 5.
- Produces: Vercel and Botpress deployments from that same SHA.

- [ ] **Step 1: Verify migration and environment readiness without writing production**

Confirm the migration applies cleanly in the disposable PostgreSQL environment and verify production configuration names without printing values: DeepSeek model/key presence, backend URL, database URL, Botpress secret and feature flags.

- [ ] **Step 2: Stop for external-release authorization**

Present the candidate SHA and fresh gate evidence. Deployment changes production and therefore requires explicit authorization at this point even though implementation was pre-authorized.

- [ ] **Step 3: Deploy one SHA to Vercel and Botpress**

After authorization, apply the additive migration, deploy Vercel, deploy the Botpress bundle built from the same SHA, and verify `/api/health` plus Botpress ADK production status.

- [ ] **Step 4: Run one clean supervised smoke**

Use a fresh WhatsApp or Telegram conversation. Verify a normal reply, one call request, one link request, post-call continuation, exact diagnostics and no duplicate effects. Do not run a paid telephone call without separate authorization.

- [ ] **Step 5: Record release evidence**

Append deployment ids, production SHA, smoke correlation ids and final counts to the Task 5 evidence report; commit the evidence-only update.
