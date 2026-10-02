# Agent A nonblocking orchestrator — verification results

Date: 2026-10-02
Branch: `codex/agent-a-logical-turn-recovery`

## Outcome

The candidate keeps DeepSeek as the single conversational owner while limiting
the orchestrator to execution, authorization and durable state. A rejected or
unavailable commercial action no longer discards otherwise safe model-authored
prose. Transient DeepSeek failures receive one bounded retry; invalid model
output and policy failures are not retried blindly.

No production deployment was performed as part of this verification.

## Root causes addressed

1. Provider failures were not classified precisely enough, which mixed
   transient outages with non-retryable schema and policy failures.
2. A rejected action could invalidate the entire conversational proposal,
   erasing useful prose and producing silence or a generic response.
3. Turn diagnostics did not preserve the exact failure stage and action status
   in an immutable, PII-free structure.
4. The integration test that reapplies historical migrations could leave an
   obsolete trigger definition for later tests. It now restores the current
   schema after its lock-safety checks.

## Implemented changes

- `06c5a90` — classify DeepSeek attempts and retry only timeout, network and 5xx
  failures once.
- `579a6cf` — isolate action rejection from conversational prose and preserve
  safe content for call/payment requests that need more information.
- `6949797` — persist structured diagnostics for provider generation, proposal
  validation, action authorization and backend commit.
- Final certification changes — production-equivalent vertical tests, current
  Botpress generated source, inert Stripe-shaped local links, migration
  immutability completion and test-schema isolation.

## Vertical evidence

The vertical workflow uses the real `processInboundTurn`, signed HTTP routes,
backend services and PostgreSQL. DeepSeek is replaced only by a deterministic
fixture so the gate measures orchestration rather than paid model variance.

1. Several rapid customer messages are claimed as one logical turn.
2. A mixed unsupported claim plus call request removes only the unsupported
   claim and preserves the useful request for the missing telephone number.
3. A call request without required data remains recoverable and asks for it.
4. A payment request without a selected plan remains recoverable and asks for
   the plan.
5. A valid payment request reserves and emits one authorized link; replay does
   not duplicate it.
6. Agent A → Agent B → Agent A continuation reads the durable call result.
7. A Sheets projection failure remains retryable and produces one idempotent
   lead row after recovery.
8. A DeepSeek 503 performs exactly two attempts, emits one bounded technical
   notice and persists the diagnostic stage and attempts.

## Verification summary

- New nonblocking vertical workflow: **5/5 passed**.
- Deterministic workflow regression: **5/5 passed**.
- Focused A↔B, payment, lifecycle and Sheets integration: **43/43 passed**.
- Full unit suite: **3,625 passed**, 17 skipped, 7 todo.
- Full integration/replay suite on a fresh seeded PostgreSQL 17 database:
  **554 passed**, 1 intentionally skipped, 0 failed.
- Root TypeScript typecheck: passed.
- Root lint with zero warnings: passed.
- Botpress TypeScript typecheck: passed.
- Botpress ADK check: valid, no errors or warnings, assets and types valid.
- Botpress production build: passed.
- Next.js production build: passed.
- `git diff --check`: passed.

## Remaining production gate

Apply the pending migration, deploy Vercel and Botpress from the same candidate
SHA, verify health/readiness, and run one clean supervised smoke on Telegram or
WhatsApp plus one supervised A→B→A call. This requires explicit deployment
authorization and is not part of this local certification.
