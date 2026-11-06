# Agent A Natural Sales Midpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the decisive, natural sales initiative associated with brain v144 while preserving every operational correction already present in deployed release `9b40a87` (brain v174, canonical prompt v109).

**Architecture:** Create an isolated worktree from the deployed release commit `9b40a87`; do not build on the unshipped v175-v179 chain. Keep commercial behavior in the canonical prompt and keep the brain limited to schema, authorized facts, effects, and repairs. Distinguish a low-pressure trial close (allowed after interest plus value) from operational checkout (requires an actual buying signal).

**Tech Stack:** TypeScript, Vitest, Botpress ADK, DeepSeek golden runner, PostgreSQL-backed replay harness.

**Spec:** `AGENTS.md`, `docs/authority/prompt-agente-a-studyx-v2.md`, and `docs/authority/spec-backend-bonificacion.md`. The execution must first record the owner's approved midpoint decision in the two authority files; editing only the canonical copy is forbidden.

## Global Constraints

- Start from commit `9b40a87`; do not revert wholesale to v144 or v171 and do not merge v175-v179 runtime changes.
- Preserve checkout, calls, contact capture, phone confirmation, post-call handoff, course programs, promotions, payment, enrollment, post-sale, memory, opt-out, idempotency, and zero-silence behavior.
- The canonical prompt is the sole commercial authority. The brain may expose facts and effect contracts, but must not duplicate when or how to sell.
- The backend must not score, reject, or rewrite copy for being insufficiently persuasive, insufficiently advanced, or insufficiently natural.
- A trial close checks fit; it does not collect data, choose a plan, or send a link. Checkout still requires a buying signal or an affirmative response to the trial close.
- A customer's `no sé` closes only the criterion they declined. An ignored question is not a permanent prohibition, but it is not repeated immediately or paraphrased as the same choice.
- Use `tú`, never `vos`; never use opening `¿` or `¡`; keep one principal question per intervention.
- Do not change provider credentials, provider selection, WhatsApp typing, or reply delays in this delivery.
- `BRAIN_DEEPSEEK_HTTP_402` is an environment failure, not a prompt verdict. Stop paid evaluation if the provider preflight fails.
- Never deploy until the owner approves the recorded comparison table.
- This plan is not authorization to modify authority by itself. Execution begins only after the owner explicitly approves this plan; that approval authorizes the narrow authority edits described in Task 2 and nothing else.

## Review Focus

- `no sé` to one career-direction question must not end all future discovery and must not trigger the same choice again.
- An unanswered question may be replaced by a different useful criterion only when that answer can change the recommendation.
- A broad-area request must receive a short, differentiated orientation or recommendation, not a flat catalog dump or `no te entendí` fallback.
- Once course, starting level, and general goal are known, the reply must build value and trial-close instead of interviewing again.
- A provider 402, malformed model response, or media/action rejection must remain distinguishable from commercial-quality failures.

---

## Agent and Token Budget Configuration

Use at most four concurrent slots including the principal agent.

| Role | Model / effort | Scope |
|---|---|---|
| Principal | `gpt-6.1-sol`, medium | Own branch/worktree, commits, commands, evidence, and user handoff. |
| Explorer | `gpt-6-luna`, medium | One short read-only mapping pass; no edits. Use `fork_turns="none"`. |
| Worker | `gpt-6.1-sol`, medium | One writer for the entire delivery; tests and implementation sequentially. |
| Architect | role `architect` (`gpt-6-astra`, high) | Review before implementation, after repeated failure, and before completion; no edits. |

- Give each agent a self-contained brief with exact paths. Do not inherit the full chat unless necessary.
- Do not run two writers or two golden runners simultaneously. The golden harness uses fixed ports `55435` and `3217`.
- Reuse an existing agent with `followup_task` rather than spawning another agent for the same role.
- Agent reports are limited to: decision, files, tests, SHA, and material risks.
- The owner's token-saving requirement overrides per-task reviewer fan-out from `subagent-driven-development`: use one architect review at the beginning and one at the end; add another only after a repeated failure or a high-risk contract change.

### Task 1: Create a Clean Candidate and Freeze the Baseline

**Files:**
- Read: `AGENTS.md`
- Read: `docs/authority/prompt-agente-a-studyx-v2.md`
- Read: `docs/authority/spec-backend-bonificacion.md`
- Read: `scripts/lib/botpress-release-provenance.mjs`
- No source edits

**Interfaces:**
- Consumes: deployed source commit `9b40a87`.
- Produces: isolated branch `codex/agent-a-natural-sales-midpoint` and a baseline evidence note in the terminal log.

- [ ] **Step 1: Create an isolated worktree from the deployed commit**

Use the `superpowers:using-git-worktrees` skill. Create `codex/agent-a-natural-sales-midpoint` from `9b40a87`, not from the dirty current worktree.

- [ ] **Step 2: Verify the frozen baseline identity**

Run:

```bash
git rev-parse HEAD
rg -n "AGENT_A_BRAIN_PROMPT_VERSION|STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION" \
  botpress-agent/src/prompts/agent-a-brain-v1.ts \
  botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts
git status --short
```

Expected: SHA `9b40a87...`, brain v174, prompt v109, clean worktree.

- [ ] **Step 3: Ask the architect to review the intended boundary**

The architect must confirm: no wholesale rollback; commercial guidance in canonical prompt only; operational contracts unchanged; provider configuration out of scope.

- [ ] **Step 4: Run the deterministic baseline once**

Run the targeted suites listed in Task 6 before editing. Record failures without retrying.

### Task 2: Establish the Approved Midpoint in the Authority Chain

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/authority/prompt-agente-a-studyx-v2.md`
- Read: `docs/prompts/studyx-agent-a-canonical.md`

**Interfaces:**
- Consumes: explicit owner approval of this plan.
- Produces: one controlling commercial rule for discovery, trial close, and checkout that later generated prompts may copy without contradiction.

- [ ] **Step 1: Record the owner decision in `AGENTS.md`**

Add a dated decision that supersedes only the conflicting discovery/cadence wording introduced after brain v171: a customer's `no sé` closes only that criterion; do not immediately repeat it; ask a different criterion only when it can change the recommendation; once interest plus verified value are present, use a natural trial close; operational checkout still needs a buying signal or affirmative reply. Preserve every existing authority and no-romper rule not named here.

- [ ] **Step 2: Edit the authority prompt, not just its canonical copy**

In `docs/authority/prompt-agente-a-studyx-v2.md`, make the same narrow behavioral changes:

- distinguish a trial close from data/plan/payment execution;
- require an answer to the current request before any new discovery;
- forbid immediate repetition of an answered or declined criterion, not all future discovery;
- require a concrete commercial advance without forcing enrollment language every turn;
- preserve Gabi/Lisandro identity, tone, price, call, promotion, checkout, and post-sale rules.

- [ ] **Step 3: Verify the authority diff before implementation**

The architect must confirm that the diff changes only the approved midpoint and does not silently rewrite unrelated Gabi/Lisandro behavior. If owner approval is absent, stop here.

- [ ] **Step 4: Commit the authority decision separately**

```bash
git add AGENTS.md docs/authority/prompt-agente-a-studyx-v2.md
git commit -m "docs(agent-a): define natural sales midpoint authority"
```

### Task 3: Pin the Missing Commercial Behavior with Golden Scenarios

**Files:**
- Modify: `evals/golden/owner-rules-scenarios.ts`
- Modify: `evals/golden/owner-rules.test.ts`
- Modify if needed: `evals/golden/golden-suite.test.ts`
- Reference only: existing cases 47, 48, and 49 from the current development worktree

**Interfaces:**
- Consumes: golden scenario schema already used by cases 47-49.
- Produces: deterministic scenario definitions for `natural_sales_midpoint` without hard-coding exact prose.

- [ ] **Step 1: Port the useful case-49 scenario without runtime commits**

Port only the scenario/test data that exercises: greeting, not remembering a course, broad interest in computers, options request, and recommendation request. Do not port v175-v179 prompt or brain code.

- [ ] **Step 2: Add `50_trial_close_vs_checkout_20261106`**

The scenario must assert by meaning and structured action:

- Real Estate + starting from zero + general goal `entender el negocio` produces verified value and one trial close.
- It does not ask again whether the customer wants to work for an agency or invest.
- It does not request contact details, payment plan, or payment link before the customer responds positively.
- A positive response moves to the existing contact/checkout flow.

- [ ] **Step 3: Add a broad-area orientation turn**

For `algo vinculado con computadoras` followed by `me pasas las opciones`, require a concise differentiated orientation and a useful next step. Forbid a long flat catalog dump and the generic technical fallback. Do not encode an arbitrary permanent maximum in backend policy.

- [ ] **Step 4: Validate the scenario structure, then prove the behavioral baseline from recorded observations**

Run:

```bash
npx vitest run --config evals/golden/vitest.config.mts \
  evals/golden/owner-rules.test.ts \
  evals/golden/golden-suite.test.ts
```

These tests only prove that the scenarios and authority citations are well formed. They do **not** prove model behavior. Use the stored real v174 observation for case 49 (and any other stored v174 observations that match these turns) as the behavioral red baseline. Never hand-write or edit a model response to manufacture a failure.

- [ ] **Step 5: Commit the red tests**

```bash
git add evals/golden/owner-rules-scenarios.ts evals/golden/owner-rules.test.ts evals/golden/golden-suite.test.ts
git commit -m "test(agent-a): pin natural discovery and trial close"
```

### Task 4: Regenerate the Canonical Prompt from the Updated Authority

**Files:**
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Modify: `scripts/generate-agent-a-prompt-module.mjs`
- Generate: `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Generate: `src/shared/prompts/studyx-agent-a-canonical.generated.ts`

**Interfaces:**
- Consumes: the newly approved authority prompt and existing `AgentATurnProposalV1` contract.
- Produces: canonical prompt version `studyx-agent-a-canonical-v110`.

- [ ] **Step 1: Rebuild the canonical file from authority**

Replace the behavioral body of `docs/prompts/studyx-agent-a-canonical.md` with the complete, literal contents of `docs/authority/prompt-agente-a-studyx-v2.md`. Preserve only the existing final technical annex permitted by `AGENTS.md`; do not add another behavioral sentence there.

- [ ] **Step 2: Prove canonical parity**

Add or update a test that compares the canonical behavioral body byte-for-byte with the authority prompt and separately identifies the technical annex. A future canonical-only behavior edit must fail this test.

- [ ] **Step 3: Update generator invariants and version**

Recalculate the canonical prompt SHA-256 and line count in `scripts/generate-agent-a-prompt-module.mjs`; set output version to v110. Do not weaken the hash/line-count checks.

- [ ] **Step 4: Generate both modules**

Run:

```bash
npm run generate:agent-a-prompt
```

Expected: only the source prompt, generator invariants, and both generated modules change.

- [ ] **Step 5: Run prompt and golden tests**

Run the Task 3 suites with `evals/golden/vitest.config.mts` and generated parity checks with `vitest.config.mts`. Expected: structural assertions pass and operational actions in case 48 remain unchanged.

- [ ] **Step 6: Commit the prompt block**

```bash
git add docs/prompts/studyx-agent-a-canonical.md \
  scripts/generate-agent-a-prompt-module.mjs \
  botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts \
  src/shared/prompts/studyx-agent-a-canonical.generated.ts
git commit -m "fix(agent-a): restore decisive trial closes"
```

### Task 5: Remove Duplicated Commercial Policy from the Brain

**Files:**
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Modify: `tests/contract/agent-a-brain-parity.test.ts`
- Modify: `tests/unit/botpress/agent-a-brain-prompt.test.ts`
- Modify: `tests/unit/botpress/agent-a-meta-sales-brain.test.ts`
- Review and modify if required: `botpress-agent/src/lib/conversation/agent-a-brain.ts`
- Create if cleaner: `tests/unit/agent-a-brain-commercial-authority.test.ts`

**Interfaces:**
- Consumes: canonical prompt v110.
- Produces: brain version `studyx-agent-a-brain-v180` whose extra blocks contain only technical contracts and verified facts.

- [ ] **Step 1: Write a failing commercial-authority test**

Assert that the built brain contains the canonical prompt and technical contracts, but does not add separate rules for when to discover, trial-close, request enrollment, or repeat a question.

- [ ] **Step 2: Audit every commercial sentence outside the canonical prompt**

Inspect `MOVE_SEMANTICS`, `ownerSalesPremiseV1`, the `already_said` schema description, and the fallback brain builder. Remove or relocate strategy such as `Ask at most one useful question per turn` and `never open with a negative` when the authority prompt already governs it. Keep move classification, facts, effect contracts, and safe repair behavior.

- [ ] **Step 3: Remove the v174 absolute `already_said` instruction**

Delete the sentence that treats every asked question as permanently forbidden in any wording. Keep `turn_reasoning` as internal evidence only.

- [ ] **Step 4: Reduce `ownerSalesPremiseV1` to technical facts or remove it**

Move any still-required factual exposure (persisted package identity and real promotion expiry) into a clearly named technical facts block. Delete duplicated guidance about proactivity, signals, closing cadence, discovery cadence, and wording. Do not remove capability or repair contracts.

- [ ] **Step 5: Bump the brain version to v180**

Use v180 to avoid colliding with the unshipped v175-v179 history.

- [ ] **Step 6: Run the focused tests**

Run:

```bash
npx vitest run --config vitest.config.mts \
  tests/contract/agent-a-brain-parity.test.ts \
  tests/unit/agent-a-brain-commercial-authority.test.ts
npx vitest run --config vitest.config.mts \
  tests/unit/botpress/agent-a-brain-prompt.test.ts \
  tests/unit/botpress/agent-a-meta-sales-brain.test.ts
npx vitest run --config evals/golden/vitest.config.mts \
  evals/golden/owner-rules.test.ts \
  evals/golden/golden-suite.test.ts
```

Omit the new unit-test path only if the assertion was added to the existing parity test.

- [ ] **Step 7: Commit the brain block**

```bash
git add botpress-agent/src/prompts/agent-a-brain-v1.ts \
  tests/contract/agent-a-brain-parity.test.ts \
  tests/unit/agent-a-brain-commercial-authority.test.ts
git commit -m "refactor(agent-a): keep sales strategy in canonical prompt"
```

### Task 6: Verify Every Operational Boundary Offline

**Files:**
- Tests only; do not change runtime code to satisfy stale tests without citing authority.

**Interfaces:**
- Consumes: prompt v110 and brain v180 candidate.
- Produces: deterministic and replay evidence suitable for the model-evaluation gate.

- [ ] **Step 1: Run type checks**

```bash
npm run typecheck
npm --prefix botpress-agent run typecheck
```

- [ ] **Step 2: Run prompt tests and record the expected stale release pin**

```bash
npx vitest run --config vitest.config.mts \
  tests/unit/scripts/release-manifest-agent-loop.test.ts
```

Run the provenance tests once only to record that the pin is stale after the candidate changes. Do not expect them to pass and do not replace reviewed hashes blindly; the pin is updated in Task 7 after the runtime commit.

- [ ] **Step 3: Run the No romper regression set**

```bash
npx vitest run --config vitest.integration.config.mts \
  tests/integration/contact-profile-phone-confirmation.test.ts \
  tests/integration/agent-a-call-handoff.test.ts \
  tests/integration/post-call-followup.test.ts \
  tests/integration/course-program-delivery.test.ts \
  tests/integration/direct-course-bonus-checkout.test.ts \
  tests/integration/direct-course-bonus-persistence.test.ts \
  tests/integration/payments-canonical.test.ts \
  tests/integration/stripe-webhook.test.ts \
  tests/integration/central-carga-enrollment-worker.test.ts \
  tests/integration/lead-course-interests.test.ts \
  tests/integration/agent-a-memory-projection.test.ts \
  tests/integration/inbound-receipts.test.ts \
  tests/integration/zero-silence.test.ts \
  tests/integration/post-sale.test.ts
npx vitest run --config vitest.config.mts \
  tests/unit/heuristics/opt-out.test.ts \
  tests/unit/botpress/botpress-media-downloader.test.ts \
  tests/unit/botpress/gemini-transcription.test.ts \
  tests/unit/botpress/groq-transcription.test.ts \
  tests/unit/botpress/commercial-followup-trigger.test.ts \
  tests/unit/promotions/commercial-followup-service.test.ts
npx vitest run --config vitest.workflow.config.mts \
  tests/workflow/agent-a-recorded-production-replay.test.ts \
  tests/workflow/agent-a-call-recovery.test.ts \
  tests/workflow/agent-a-payment-consent-regression.test.ts
```

The transcription and follow-up suites use simulated providers. The integration harness must use its disposable local database. Workflow tests must run in their recorded/offline mode; any file marked `live` is excluded from this offline gate.

- [ ] **Step 4: Replay recorded observations without calling a model**

Run the offline replay and baseline-v8 replay suites. Expected: checkout, calls, material, and bonuses do not regress; commercial-quality turns are judged separately from backend rejections.

- [ ] **Step 5: Commit any test-only alignment justified by authority**

Do not alter runtime code in this task. Each changed expectation must cite the controlling authority line in the test.

### Task 7: Commit the Candidate and Run the Minimum Real-Model Acceptance

**Files:**
- Modify after the candidate code commit: `scripts/lib/botpress-release-provenance.mjs`
- Generate results only: `evals/golden/results/**`

**Interfaces:**
- Consumes: clean committed runtime SHA.
- Produces: focused and full acceptance tables with provider calls/tokens and a deployable release pin.

- [ ] **Step 1: Commit any remaining candidate source and record the SHA**

The real-model runner must see no uncommitted runtime changes.

- [ ] **Step 2: Run a single synthetic provider preflight**

Use staging/eval configuration only. If the result is HTTP 402, stop and report an environment failure; do not alter credentials or prompts.

- [ ] **Step 3: Run one focused real-model evaluation**

Run cases 45, 47, 48, 49, and 50 once. Record raw response, move/action, backend rejections, verdict, provider calls, and tokens. Manually inspect any judge attribution that labels a menu as `bonificación` or an authorized real story as invented.

- [ ] **Step 4: Run the 16-golden acceptance exactly once if focused cases pass**

Do not rerun until a concrete cause is fixed. Any critical checkout/call/program/promo failure blocks deployment.

- [ ] **Step 5: Re-pin release provenance from reviewed evidence**

Update `BOT_RELEASE_BASE_SHA`, brain v180, prompt v110, and reviewed hashes in `scripts/lib/botpress-release-provenance.mjs` only after comparing the committed diff and generated artifacts to the accepted evidence. Run `botpress-release-provenance`, `release-provenance`, preparation, and manifest tests again; all must now pass.

- [ ] **Step 6: Ask the architect for final review**

The architect reviews the complete diff, focused/full tables, remaining backend rejection codes, and rollback safety. Address material findings before declaring completion.

- [ ] **Step 7: Push and report without deploying**

Report branch, candidate SHA, prompt/brain versions, deterministic tests, focused/full results, failures by layer, and token usage.

### Task 8: Deploy Only After Explicit Owner Approval

**Files:**
- No new code; release artifacts and deployment receipts only.

**Interfaces:**
- Consumes: approved candidate SHA.
- Produces: Vercel and Botpress running the same SHA/prompt/brain identity, or coordinated rollback to `9b40a87`.

- [ ] **Step 1: Prepare one coordinated release**

Verify backend URL, Botpress profile, workspace/bot IDs, and release provenance before publication.

- [ ] **Step 2: Deploy backend and Botpress from the same candidate**

Never leave one side on the candidate and the other on the old contract.

- [ ] **Step 3: Verify read-only production identity and provider health**

Confirm SHA, brain v180, prompt v110, no 402, and successful model source before testing behavior.

- [ ] **Step 4: Reset only the authorized test contact and run a short smoke test**

Exercise computers orientation, Real Estate trial close, direct call request, program delivery, price objection/promotion, and checkout. Preserve payments and Central enrollment history.

- [ ] **Step 5: Roll back both surfaces together if a critical path fails**

Rollback target: deployed `9b40a87` pair. Report the exact failed turn and evidence; do not patch production live.
