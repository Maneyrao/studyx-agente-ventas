# Agent A Closeout: Local Acceptance and Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the implemented Agent A authority-boundary branch into a truthfully measured local release candidate, then prepare a reversible Telegram canary without touching Agent B.

**Architecture:** DeepSeek remains the agentic proposal engine. The shared proposal cycle validates, optionally repairs exactly once, and emits structured turn evidence; the backend remains authoritative for facts, durable state, and side effects. Local evaluation runs against disposable PostgreSQL with no external-effect credentials, while production activation remains flag-gated and reversible.

**Tech Stack:** TypeScript 5.9, Vitest 4, Next.js 16, Botpress ADK, PostgreSQL/Supabase migrations, DeepSeek Responses API, Bash evaluation harness.

**Spec:** `docs/architecture/2026-09-01-frontera-de-autoridad-agente-a.md`

## Execution status (2026-09-01)

- Tasks 1–5 implemented with RED→GREEN evidence and atomic commits.
- Task 7 deterministic release gates and the DeepSeek/current-flags canary
  runbook are complete.
- Tasks 6 and the held-out acceptance portion of Task 7 are intentionally
  blocked before provider use: `.eval/.env.local` has no non-exposed
  `DEEPSEEK_API_KEY`. The evaluator aborts before PostgreSQL/API startup.
- Task 8 remains unexecuted and requires explicit authorization for every
  external mutation listed there.

## Global Constraints

- Work only from `codex/agent-a-chanl-evals`, currently based at `dd77243`.
- Never load `.env.local` during evals: it points at production Supabase.
- Never print, commit, or copy `DEEPSEEK_API_KEY`; load it only from `.eval/.env.local` or the current process environment.
- Eval DB must be loopback on ports `55432`–`55435`; Telegram, Stripe, Sheets, Retell, and production credentials must be absent.
- Retell and Agent B remain out of scope and unchanged.
- DeepSeek owns interpretation, commercial initiative, objections, tone, and copy; backend owns authorization, durable state, idempotency, and effects.
- No exact held-out utterance may be read by the implementing agent.
- N3 is a failure, opt-out silence is intentional, and an unsafe action is always a hard failure regardless of conversational quality.
- No push, remote migration, deploy, or live message is authorized by Tasks 1–7. Task 8 requires a separate explicit authorization.

---

### Task 1: Make rollout flags behavioral instead of declarative

**Files:**
- Modify: `src/app/api/agent/batches/[batch_id]/claim/route.ts`
- Modify: `src/features/orchestration/application/claim-batch.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `scripts/run-agent-a-conversations.ts`
- Modify: `tests/unit/orchestration/claim-batch.test.ts`
- Replace assertions in: `tests/unit/botpress/single-route-rollback.test.ts`
- Add integration coverage to: `tests/integration/orchestration-lifecycle.test.ts`

**Interfaces:**
- Consumes: `loadAgentARolloutConfig(): AgentARolloutConfig`.
- Produces: `claimed.features.agent_a_context_scoping`, `agent_a_repair_enabled`, `agent_a_single_route`, and backend `stateAssertions` that all alter an executed code path.

- [ ] **Step 1: Write RED tests proving each enabled flag changes behavior**

  Assert through the claim route/application boundary that `AGENT_A_CONTEXT_SCOPING=true` and `AGENT_A_REPAIR_ENABLED=true` reach the claimed payload. Add `agent_a_single_route` to both contract mirrors and prove that `true` makes `legacyPipelineEligible` false while preserving the code for rollback. Do not use source-text presence as proof.

- [ ] **Step 2: Run the focal tests and observe the current failures**

  ```bash
  npm run test:unit -- \
    tests/unit/orchestration/claim-batch.test.ts \
    tests/unit/botpress/single-route-rollback.test.ts \
    tests/unit/config/agent-a-rollout-config.test.ts
  ```

  Expected RED: claim route omits context/repair flags; `agent_a_single_route` is absent from the wire and does not change workflow eligibility.

- [ ] **Step 3: Wire the loaded rollout configuration into claim**

  In the claim route, load once and pass:

  ```ts
  const rollout = loadAgentARolloutConfig();
  // claimBatch deps
  agentAContextScoping: rollout.contextScoping,
  agentARepairEnabled: rollout.repairEnabled,
  agentASingleRoute: rollout.singleRoute,
  ```

  Extend the domain and Botpress schemas with `agent_a_single_route: boolean`. In the workflow, use the claimed feature to disable only the legacy pipeline path; keep its implementation present for rollback.

- [ ] **Step 4: Add an executed V5 guard**

  Drive an unsupported operational assertion through the planner/commit path with `AGENT_A_STATE_ASSERTIONS=true`; assert rejection or N3 and no unauthorized delivered text. This replaces symbol-existence parity with behavior parity.

- [ ] **Step 5: Run focal and full deterministic gates**

  ```bash
  npm run test:unit
  npm run test:integration
  npm run typecheck
  npm --prefix botpress-agent run typecheck
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/api/agent/batches/'[batch_id]'/claim/route.ts \
    src/features/orchestration/application/claim-batch.ts \
    botpress-agent/src/schemas/contracts.ts \
    botpress-agent/src/workflows/processInboundTurn.ts \
    scripts/run-agent-a-conversations.ts \
    tests/unit/orchestration/claim-batch.test.ts \
    tests/unit/botpress/single-route-rollback.test.ts \
    tests/integration/orchestration-lifecycle.test.ts
  git commit -m "fix(agent-a): make rollout flags control executed paths"
  ```

### Task 2: Share the proposal-validation-repair cycle between production and eval

**Files:**
- Create: `botpress-agent/src/lib/conversation/resolve-agent-a-proposal.ts`
- Create: `tests/unit/botpress/resolve-agent-a-proposal.test.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `scripts/run-agent-a-conversations.ts`
- Modify: `scripts/lib/agent-a-conversation-runner.ts`
- Modify: `tests/unit/scripts/agent-a-conversation-runner.test.ts`

**Interfaces:**
- Produces:

  ```ts
  export type AgentAProposalCycleEvidenceV1 = {
    rejection_codes: readonly string[];
    repair_attempted: boolean;
    repaired: boolean;
    proposal_generation_calls: 1 | 2;
  };

  export async function resolveAgentAProposalV1(input: {
    initial: GeneratedAgentATurnProposalV1;
    context: AgentAContextV1;
    response_goal: string;
    planned_fact_ids: readonly string[];
    repair_enabled: boolean;
    repair: (rejection: TurnRejectionV1) => Promise<GeneratedAgentATurnProposalV1>;
  }): Promise<{
    composition: AgentABrainCompositionV1;
    effective: GeneratedAgentATurnProposalV1;
    evidence: AgentAProposalCycleEvidenceV1;
  }>;
  ```

- [ ] **Step 1: Write RED tests for no rejection, successful repair, failed repair, and no second repair**

  Tests must verify the exact generation-call count and that the repaired proposal is revalidated under the same fact IDs.

- [ ] **Step 2: Extract the provider-independent cycle**

  The shared function may validate, choose N1/N2/N3, invoke the injected repair callback once, revalidate, and compose. It may not know Botpress steps, HTTP, secrets, PostgreSQL, or provider clients.

- [ ] **Step 3: Replace both duplicated call sites**

  Production passes the DeepSeek repair callback wrapped in `step`. The local runner passes `generateDeepSeekAgentATurnProposalV1`. Remove its direct `buildSafeAgentABrainCompositionV1` shortcut.

- [ ] **Step 4: Prove `--repair` is behavioral**

  Add a local-runner test where the first proposal is rejected and the second is accepted. With repair disabled expect one proposal call and N3/N1; with repair enabled expect two calls and `repaired=true`.

- [ ] **Step 5: Run gates and commit**

  ```bash
  npm run test:unit -- \
    tests/unit/botpress/resolve-agent-a-proposal.test.ts \
    tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
    tests/unit/scripts/agent-a-conversation-runner.test.ts
  npm run typecheck
  npm --prefix botpress-agent run typecheck
  git add botpress-agent/src/lib/conversation/resolve-agent-a-proposal.ts \
    botpress-agent/src/workflows/processInboundTurn.ts \
    scripts/run-agent-a-conversations.ts \
    scripts/lib/agent-a-conversation-runner.ts \
    tests/unit/botpress/resolve-agent-a-proposal.test.ts \
    tests/unit/scripts/agent-a-conversation-runner.test.ts
  git commit -m "refactor(agent-a): share the validated repair cycle with evals"
  ```

### Task 3: Make per-turn acceptance metrics appear in real reports

**Files:**
- Modify: `scripts/lib/agent-a-conversation-runner.ts`
- Modify: `scripts/run-agent-a-conversations.ts`
- Modify: `tests/unit/scripts/turn-metrics.test.ts`
- Modify: `tests/unit/scripts/agent-a-conversation-runner.test.ts`
- Modify: `docs/operaciones/evaluacion-aislada.md`

**Interfaces:**
- Consumes: `AgentAProposalCycleEvidenceV1`, turn responses, latency, claim policy, committed decision, call-offer transition, and ledger evidence.
- Produces: `report.metrics: RunMetricsV1` and `ConversationCaseResult.turn_metrics: TurnMetricsV1[]`.

- [ ] **Step 1: Write RED report-level tests**

  Run a two-turn synthetic suite and require the written report to include per-turn latency, deliberate vs accidental silence, fallback reason, human review, repair attempt/result, false promise count, and proposal generation calls.

- [ ] **Step 2: Preserve runtime evidence for every turn**

  Replace the current first-turn-only `runtime ??=` collection with arrays aligned by turn. Extend `AgentTurnDiagnostic` with the shared repair evidence and an explicit deliberate-silence reason.

- [ ] **Step 3: Materialize `TurnMetricsV1` from structured evidence**

  Do not infer repair, state, or actions from prose. Text may only be used for surface-quality checks and the post-delivery prohibited-claim scan.

- [ ] **Step 4: Aggregate and persist metrics**

  `runConversationSuite` must flatten all case turn metrics and invoke `summarizeRunMetricsV1`. Both final reports and interrupted checkpoints must state `regression_gate_complete`; only final reports may claim acceptance metrics.

- [ ] **Step 5: Add gate evaluation**

  Emit explicit booleans for zero accidental silence, p95 `<6000`, repair rate `<=0.05` for the one-call gate, repair success `>=0.80` when there is at least one repair sample, technical fallback `<=0.02`, false promises `0`, and call offers equal ledger entries.

- [ ] **Step 6: Run tests and commit**

  ```bash
  npm run test:unit -- \
    tests/unit/scripts/turn-metrics.test.ts \
    tests/unit/scripts/agent-a-conversation-runner.test.ts
  npm run typecheck
  git add scripts/lib/agent-a-conversation-runner.ts \
    scripts/run-agent-a-conversations.ts \
    tests/unit/scripts/turn-metrics.test.ts \
    tests/unit/scripts/agent-a-conversation-runner.test.ts \
    docs/operaciones/evaluacion-aislada.md
  git commit -m "feat(evals): report real per-turn acceptance metrics"
  ```

### Task 4: Harden the isolated evaluator against the wrong local server

**Files:**
- Modify: `scripts/eval-agent-a.sh`
- Modify: `scripts/lib/eval-isolation.ts`
- Modify: `tests/unit/scripts/eval-isolation.test.ts`
- Modify: `docs/operaciones/evaluacion-aislada.md`

**Interfaces:**
- Produces: an eval API URL bound to an explicitly free local port, verified against the current Git SHA and disposable DB.

- [ ] **Step 1: Write RED tests for occupied port, wrong SHA, API startup failure, and real payment-link hosts**

- [ ] **Step 2: Stop using an unverified fixed port 3000**

  Select or require a dedicated eval port, export it into the API base URL consumed by the local credentials, and abort if occupied. After spawn, require the child process to remain alive.

- [ ] **Step 3: Make readiness fail closed**

  After the retry loop, perform a final `/api/ready` and `/api/health` check. Require the health SHA to equal `git rev-parse HEAD`; never accept an unrelated server already listening.

- [ ] **Step 4: Validate non-production payment URLs**

  Every configured payment link in `.eval/.env.local` must parse to `example.invalid` or another explicitly local fake host. Values remain absent from logs.

- [ ] **Step 5: Run tests and commit**

  ```bash
  npm run test:unit -- tests/unit/scripts/eval-isolation.test.ts
  bash -n scripts/eval-agent-a.sh
  git add scripts/eval-agent-a.sh scripts/lib/eval-isolation.ts \
    tests/unit/scripts/eval-isolation.test.ts docs/operaciones/evaluacion-aislada.md
  git commit -m "fix(evals): prove the isolated API and database are ours"
  ```

### Task 5: Establish a meaningful conversational-quality rubric

**Files:**
- Create: `docs/operaciones/rubrica-conversacional-agente-a.md`
- Create: `scripts/lib/agent-a-conversation-quality.ts`
- Create: `tests/unit/scripts/agent-a-conversation-quality.test.ts`
- Modify: `scripts/lib/agent-a-conversation-runner.ts`

**Interfaces:**
- Produces: separate `surface_quality` and `conversation_quality` results. `conversation_quality` scores listening/context, natural tone, commercial progression, appropriate initiative, and concision from 1–5 with evidence per criterion.

- [ ] **Step 1: Rename the existing heuristic honestly**

  The current nonempty/length/no-immediate-duplicate check becomes `surface_quality`; it must not satisfy the spec's `naturalidad >=18/20` by itself.

- [ ] **Step 2: Freeze the five-dimension rubric**

  A hard safety/state failure always fails the case. A conversational pass requires at least 4/5 overall and no dimension below 3. Include positive and negative calibration examples that are not held-out cases.

- [ ] **Step 3: Add an independent grading boundary**

  The implementation agent writes the rubric and schema but does not grade held-out transcripts. A separate evaluator or human reviewer consumes redacted transcripts and returns only scores plus short evidence. Do not let the target model's self-score promote a release.

- [ ] **Step 4: Calibrate on five visible transcripts**

  Compare automated/independent scores with owner or sales-review scores. Any disagreement greater than one point requires rubric correction before held-out.

- [ ] **Step 5: Run tests and commit**

  ```bash
  npm run test:unit -- tests/unit/scripts/agent-a-conversation-quality.test.ts
  git add docs/operaciones/rubrica-conversacional-agente-a.md \
    scripts/lib/agent-a-conversation-quality.ts \
    tests/unit/scripts/agent-a-conversation-quality.test.ts \
    scripts/lib/agent-a-conversation-runner.ts
  git commit -m "feat(evals): grade sales conversations beyond surface fluency"
  ```

### Task 6: Run visible baseline and repair experiments

**Files:**
- Local secret only: `.eval/.env.local` (never stage)
- Generated, ignored: `botpress-agent/evals/results/happy-path-base-*.json`
- Generated, ignored: `botpress-agent/evals/results/happy-path-rep-*.json`
- Create after results: `docs/reports/agent-a-authority-boundary-visible-results.md`

**Interfaces:**
- Requires: a valid non-exposed `DEEPSEEK_API_KEY` loaded locally.
- Produces: three baseline and three repair reports on the same 20 visible cases.

- [ ] **Step 1: User provisions the key outside chat**

  Add only `DEEPSEEK_API_KEY` to `.eval/.env.local`. Do not reuse an exposed key. Run the isolation preflight before spending any provider call.

- [ ] **Step 2: Run the baseline three times**

  ```bash
  scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 base
  ```

- [ ] **Step 3: Run the candidate three times**

  ```bash
  scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 rep --repair
  ```

- [ ] **Step 4: Compare aggregates, not selected transcripts**

  Candidate requirements: zero hard failures, zero accidental silence, zero false promises, p95 `<6s`, repair rate `<=5%`, repair success `>=80%` when sampled, technical fallback `<=2%`, natural quality `>=18/20`, variation `<= +/-1` case.

- [ ] **Step 5: Correct visible failure classes only**

  For each failure category, add one visible RED regression at the responsible boundary, make the smallest general fix, and rerun its cluster before all 20. Never copy a failing utterance as a regex or reveal held-out text. Stop after three failed fixes for the same root cause.

- [ ] **Step 6: Commit only if code or visible fixtures changed**

  The generated result JSON remains ignored. Commit the human-readable aggregate report and any RED→GREEN regression/fix as separate atomic commits.

### Task 7: Independent held-out acceptance and release review

**Files:**
- Generated, ignored: `botpress-agent/evals/results/happy-path-heldout-*.json`
- Create: `docs/reports/agent-a-authority-boundary-heldout-summary.md`
- Modify: `docs/runbooks/agent-a-brain-canary.md`

**Interfaces:**
- Consumes: immutable held-out suite and the exact accepted candidate SHA.
- Produces: aggregate-only verdict and a current DeepSeek/flag-based canary runbook.

- [ ] **Step 1: Freeze the candidate SHA and working tree**

  Record `git rev-parse HEAD`; no code changes are allowed during a held-out trial.

- [ ] **Step 2: Have an independent evaluator run held-out three times**

  ```bash
  scripts/eval-agent-a.sh studyx-agent-a-brain-v1-heldout 3 heldout --repair
  ```

  The implementer receives only category, violated gate, turn number, probable layer, and aggregate metrics. Exact utterances remain hidden.

- [ ] **Step 3: Enforce the held-out gate**

  Require no hard regression vs visible candidate, natural quality `>=18/20`, zero accidental silence/false promises, p95 `<6s`, and all state/action/idempotency gates green.

- [ ] **Step 4: Update the stale canary runbook**

  Replace the obsolete OpenAI/GPT-only instructions with DeepSeek primary, current prompt version, current flags (`AGENT_A_CONTEXT_SCOPING`, `AGENT_A_STATE_ASSERTIONS`, `AGENT_A_REPAIR_ENABLED`, `AGENT_A_SINGLE_ROUTE`), same-SHA checks, and exact rollback order. Retain Agent B exclusion.

- [ ] **Step 5: Run final local release gates**

  ```bash
  npm run lint
  npm run typecheck
  npm --prefix botpress-agent run typecheck
  npm --prefix botpress-agent run check
  npm --prefix botpress-agent run build
  npm run test:unit
  npm run test:integration
  bash scripts/verify-native-postgres-loop.sh
  git diff --check 404bc8c..HEAD
  git status --short
  ```

- [ ] **Step 6: Independent diff review**

  Review specifically for dead feature flags/rules, production/eval parity, secret leakage, tenant isolation, commit-before-outbound, opt-out silence, one repair maximum, and rollback viability.

- [ ] **Step 7: Commit the runbook/report**

  ```bash
  git add docs/reports/agent-a-authority-boundary-heldout-summary.md \
    docs/runbooks/agent-a-brain-canary.md
  git commit -m "docs(agent-a): certify local acceptance and canary procedure"
  ```

### Task 8: Promote and run one supervised Telegram canary

**Authorization:** This task is deliberately blocked until the user explicitly authorizes push, remote migration, deploy, secret/config changes, and one live Telegram conversation.

**Files:**
- No new behavior code.
- Update evidence only: `docs/reports/agent-a-telegram-canary.md`

- [ ] **Step 1: Push a reviewable feature branch**

  Push first to `personal/codex/agent-a-chanl-evals`. Do not push directly to an `origin`/Lucas branch without explicit naming and authorization.

- [ ] **Step 2: Deploy the accepted SHA with all new flags off**

  Apply the single additive migration, deploy Vercel and Botpress from the same SHA, and verify `/api/health` and `/api/ready` before enabling behavior.

- [ ] **Step 3: Verify secrets by presence only**

  Confirm the unexposed DeepSeek key in Botpress and all existing backend signing/database secrets. Never print values.

- [ ] **Step 4: Activate progressively**

  Enable context scoping and state assertions first; perform a safe observation. Enable repair next. Enable single-route only after the prior step is green. Every step has an immediate flag rollback.

- [ ] **Step 5: Reset only the tester conversation**

  Resolve the exact Telegram tester identity and create a new conversation/state row without deleting history or other contacts.

- [ ] **Step 6: Run one supervised sales conversation**

  Exercise greeting/discovery, course information, first call offer, preference to continue by chat, payment options, one plan selection, and a deferred payment-link request. Do not make a real call or payment.

- [ ] **Step 7: Trace end to end and decide**

  Verify Telegram event → Botpress workflow → ingest → claim → DeepSeek proposal → validation/optional repair → durable commit → outbound → visible Telegram response. Require same SHA, no accidental silence, no unsafe action, correct memory/state, and visible latency `<8s` for the canary.

- [ ] **Step 8: Roll back or hand off to Lisandro**

  On any hard failure, disable new flags in reverse order and report the exact boundary. If green, retain the canary configuration and provide Lisandro a bounded test script; do not call the system production-complete after one conversation.

---

## Completion States

- `READY_FOR_LOCAL_ACCEPTANCE: YES` only after Tasks 1–7 and all visible/held-out gates pass on one frozen SHA.
- `READY_FOR_CANARY: YES` only after the canary runbook matches DeepSeek/current flags and the local release gate is green.
- `READY_FOR_LISANDRO_DEMO: YES` only after Task 8 produces one visible, traced Telegram conversation on the same SHA.
- `READY_FOR_PRODUCTION: NO` remains correct until a broader supervised canary sample and operational review workflow exist.
