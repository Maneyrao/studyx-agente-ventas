# Restore Agent A Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Agent A as the sole conversational and action-request owner while retaining the current calls, payments, memory, Agent B, central-load, post-sale and recovery capabilities.

**Architecture:** Preserve the October 2 nonblocking split: Agent A interprets, writes and requests tools; the orchestrator supplies canonical context and transports the request; the backend validates and executes effects. Semantic observations may produce structured feedback but cannot suppress safe Agent A conversation, synthesize an action, or replace Agent A with deterministic commercial copy.

**Tech Stack:** TypeScript 5.9, Botpress ADK, Next.js 16, Vitest 4, PostgreSQL/Supabase, DeepSeek.

**Spec:** `docs/superpowers/specs/2026-10-01-agent-a-nonblocking-orchestrator-design.md`

## Global Constraints

- Agent A owns interpretation, conversational wording, sales guidance, missing-data requests and action requests.
- The backend owns canonical facts, effect authorization, execution, persistence, idempotency, opt-out and security.
- An action rejection must never erase or block safe Agent A prose.
- Backend and orchestrator never author commercial copy or infer a new action from prose or a semantic move.
- Call data requirements are `nombre`, `apellido`, `telefono`; `correo` and course are optional for a call.
- Payment data requirements remain `nombre`, `apellido`, `correo`, `telefono`, plus canonical course and plan.
- Existing Agent B, Stripe, central-load, access delivery, memory and post-sale flows remain intact.

## Review Focus

- A direct call request with missing identity reaches Agent A and produces a model-owned request, not a deterministic response or silence.
- A request-call reply containing natural future language is not treated as proof that an effect already occurred.
- An unavailable call/payment effect is reduced to no effect while safe Agent A conversation survives.
- A previously confirmed profile field cannot cause the whole turn to fail if Agent A asks for it again.
- A direct action request remains idempotent and cannot be synthesized by the orchestrator when Agent A selected `none`.

---

### Task 1: Restore nonblocking conversational acceptance

**Files:**
- Modify: `tests/unit/botpress/resolve-agent-a-plannerless.test.ts`
- Modify: `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-brain.ts`

**Interfaces:**
- Produces: `resolveAgentAPlannerlessProposalV2` preserves Agent A's safe proposal under advisory semantic observations.
- Produces: structured `action_rejection` for unavailable explicit effects without synthesizing an action.

- [ ] Add a regression test using the production shape: `move=request_call`, `proposed_action=none`, missing name/surname, and “Claro, te llamo. Para agendarla necesito…”; assert no repair, no throw, unchanged response and `none` action.
- [ ] Add a regression test asserting a persisted accepted-call state cannot make the resolver synthesize `request_call_now` when Agent A selected `none`.
- [ ] Run the focused tests and observe both failures against current code.
- [ ] Remove call-action materialization and keep advisory semantic observations nonblocking. Restrict hard operational assertions to claims of a completed durable effect, not natural future call language.
- [ ] Run the focused resolver tests and the backend `agent-turn-policy-v2` tests.
- [ ] Commit the task.

### Task 2: Make contact requirements purpose-aware and nonblocking

**Files:**
- Modify: `tests/unit/botpress/agent-a-context.test.ts`
- Modify: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`
- Modify: `botpress-agent/src/schemas/agent-a-brain.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-context.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-action-feedback.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`

**Interfaces:**
- Produces: `capabilities.required_contact_fields` with purpose-specific canonical missing fields for `call`, `payment` and `identity`.
- Consumes: Task 1 nonblocking resolver behavior.

- [ ] Add a context test proving a contact with only phone known receives call missing fields `[nombre, apellido]` and payment missing fields `[nombre, apellido, correo]`.
- [ ] Add a workflow test proving an accidental repeated request for a confirmed field does not reject or silence the model-owned turn.
- [ ] Run both tests and observe the expected failures.
- [ ] Add the purpose-specific capability to the shared Botpress schema/context and instruct Agent A to use the requirement matching its current purpose.
- [ ] Feed action feedback only the missing fields relevant to the rejected action; retain the complete profile separately.
- [ ] Record repeated-field requests as diagnostics while allowing the turn to continue; do not turn them into proposal rejection.
- [ ] Run context, prompt, profile and hot-path tests.
- [ ] Commit the task.

### Task 3: Remove deterministic call ownership and certify the vertical flow

**Files:**
- Modify: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`
- Modify: `tests/workflow/agent-a-call-recovery.test.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`

**Interfaces:**
- Consumes: purpose-aware context from Task 2 and nonblocking proposal handling from Task 1.
- Produces: every authoritative direct-call turn runs through Agent A; the backend still reserves and dispatches the authorized request once.

- [ ] Replace deterministic-call expectations with tests proving `call_direct_request` and `call_accepted_offer` invoke Agent A in authoritative mode.
- [ ] Add a workflow regression for missing call data followed by data capture and a later authorized call request.
- [ ] Run the tests and observe failure while deterministic call handoff still bypasses Agent A.
- [ ] Remove the authoritative-brain call-handoff bypass; retain deterministic routing only for legacy/non-authoritative rollout paths.
- [ ] Run focused workflow and hot-path tests.
- [ ] Run typecheck, lint, all unit tests, relevant integration/workflow suites and production build.
- [ ] Commit the task and perform a whole-branch review.
