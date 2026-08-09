# StudyX Botpress Orchestrator Pilot — Execution Ledger

## Baseline

- Date: 2026-08-06
- Branch: `main`
- HEAD: `7d328c7c7edf314f9916856d2886941b2aa9fb01`
- Worktree: dirty before this execution; all prior modified/untracked files must be preserved.
- Root typecheck: PASS.
- Root lint: PASS.
- Root unit tests: PASS — 6 files, 61 tests.
- Botpress typecheck: PASS.
- Botpress `adk check --format json`: PASS — valid, no errors/warnings; missing `agent.json` is informational.
- Botpress `adk status --format json`: 3 custom Actions, 1 Workflow, 1 Conversation; no integration and dev server stopped.
- Botpress CLI profile: BLOCKED EXTERNALLY — `adk profiles list` reports no profile.
- Local Supabase integration runtime: BLOCKED EXTERNALLY — Docker daemon unavailable.

## Audit verdicts

- Functional/DDD: Emulator identity mismatch, prohibited transfer branch, missing commercial truth/action model, and divergent state language.
- Data/DDIA: batching and ordered generation absent; delivery reconciliation absent; concurrent decision unique violation insufficiently handled; memory selection absent.
- Botpress ADK: local structure valid; `client.createMessage` is the supported Workflow API but physical idempotency remains ambiguous; current eval can falsely pass on identity failure.
- Adversarial decision: use corrected minimal PostgreSQL batching. One batch row plus messages as members; atomic claim, lease, and reconciliation. Do not introduce the larger parallel state subsystem.

## Task status

| Task | Status | Red evidence | Green evidence | Review rounds | Open findings |
|---|---|---|---|---:|---|
| 0. Plan and ledger | complete | n/a | Files created | 0 | none |
| 1. Decision v2 / no transfer | complete | Missing domain; old HTTP contract accepted | 88/88 root; 81/81 unit; 7/7 contract; Botpress valid | 2 | PostgreSQL runtime evidence blocked externally |
| 2. Emulator identity | pending | — | — | 0 | — |
| 3. PostgreSQL batching | pending | — | — | 0 | — |
| 4. Context at claim | pending | — | — | 0 | — |
| 5. Selective memory | pending | — | — | 0 | — |
| 6. Botpress workflow | pending | — | — | 0 | — |
| 7. Concurrency/recovery | pending | — | — | 0 | — |
| 8. Audio port | pending | — | — | 0 | — |
| 9. Observability/load | pending | — | — | 0 | — |
| 10. WhatsApp official | externally blocked | no ADK profile/integration | — | 0 | authentication + generated types |

## Correction policy

- Maximum five correction rounds per task.
- No next task with a critical finding open.
- No two implementers edit the same files concurrently.
- Every completion claim requires a fresh command result recorded here.

## Task 1 review record

- Round 1 review found SQL NULL-check gaps, a legacy conversation transfer state, a concurrent `23505` path, overly broad outbound attachment, and missing database tests.
- Correction 1 added NULL-safe constraints, stable unique-constraint recovery in a fresh transaction, restricted immutable linking, an additive conversation-state migration, concurrent/invariant tests, and exact domain parsing.
- Round 2 made the Botpress decision and memory-candidate schemas strict for exact boundary parity.
- Independent reviewer approval: no Critical or Important findings remain.
- Fresh local evidence from the task: root 88/88, unit 81/81, contract 7/7, root typecheck/lint pass, Botpress typecheck/check pass, forbidden functional symbols absent, diff-check pass.
- Deferred evidence: pgTAP and PostgreSQL concurrency tests compile but were not executed because Docker/Supabase local is unavailable.
