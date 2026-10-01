# Lisandro behavior and orchestrator alignment

## Goal

Make Lisandro's humanized WhatsApp sales specification the canonical behavior for Agent A while preserving the existing catalog, memory, Stripe, Sheets, A to B to A, permissions, truth, and idempotency boundaries.

## Tasks

1. Align the canonical prompt and configured identity with Emma, the early name and surname intake, Lisandro's conversational principles, and the existing structured action contract.
2. Make call readiness require name, surname, and phone without requiring email, and make Agent A ask only the missing call fields.
3. Reject and repair a call-success promise when no call action was requested; keep factual and transactional guards out of customer-facing wording.
4. Run focused and full verification, inspect the production dependencies, deploy Vercel and Botpress from the same commit, and run readiness checks.

## Constraints

- DeepSeek remains the sole author of ordinary conversational replies.
- No planner, scripted sales fallback, or backend rewriting of tone.
- Backend checks only durable facts, permissions, action coherence, idempotency, and required operational data.
- Preserve unrelated working-tree changes.
- Do not claim Stripe, Sheets, or Xendra readiness without test or production evidence.
