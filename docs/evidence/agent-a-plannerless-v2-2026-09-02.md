# Agent A plannerless V2 — local evidence

Date: 2026-09-02
Branch: `codex/agent-a-plannerless-v2`
Base: `cc3b3b5`

## Outcome

The experimental path removes the deterministic conversation planner from the
authoring loop. DeepSeek proposes the conversational move, final messages and
requested action in one structured turn. The backend still validates canonical
facts, call limits, contact intake, payment consent, payment plan, opt-out and
all side effects before a durable commit.

The legacy pipeline remains available. Botpress configuration
`agentAPlannerlessV2Enabled` is disabled by default and is the rollback switch;
this work does not change Retell/Agent B.

## Local evaluation

Full baseline artifact:
`botpress-agent/evals/results/happy-path-20260902200254.json` (local/ignored).

- 20 cases and 90 eligible turns attempted.
- 16/20 passed in the uninterrupted run.
- Zero false operational promises.
- The only product-code failure was an early payment action while one intake
  field was still missing. A failing unit test reproduced it and the action is
  now demoted without replacing safe model-owned copy.
- Three remaining failed cases were not model evaluations: DeepSeek returned
  HTTP 402 after the account stopped accepting requests.
- Two call-offer parity failures were evaluator false negatives for natural
  phrases such as “puedo explicarte ... por una llamada”; the detector and its
  regression test now cover them.

Earlier focused evidence on the same implementation proved the six payment
flows after their individual fixes, including one canonical link, persisted
course/plan, local Sheet projection and replay idempotency.

## Verification after fixes

- Unit: 2,222 passed; 7 skipped; 7 todo.
- Plannerless/runner focal: 103 passed.
- Root TypeScript: pass.
- Botpress TypeScript: pass.
- ESLint: pass.
- ADK check: valid, zero errors/warnings.
- ADK production build: pass.
- Plannerless vertical and conversation-state PostgreSQL suites: 5 passed.
- Legacy orchestration PostgreSQL suite: 56 passed after draining 133 pending
  local evaluation jobs that had initially hidden the test's own projection.

## Release status

No push, deploy, remote migration or production flag activation was performed.
A fresh 20/20 run and independent quality grading require a funded, non-exposed
DeepSeek credential. Until those two gates pass, this branch is suitable for
review but not for a Telegram canary.
