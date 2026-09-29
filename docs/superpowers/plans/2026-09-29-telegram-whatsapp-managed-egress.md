# Telegram + WhatsApp Managed Egress Implementation Plan

> **For Codex/Claude Code:** Execute this plan task by task with TDD. Do not change Agent A's personality, sales prompt, call-offer rules, or conversational freedom. The work is transport, correlation, persistence, and lifecycle handling.

**Goal:** Make Telegram and WhatsApp use the same reliable A→orchestrator→B→orchestrator→A path, so a payment link or post-call follow-up always returns to the originating Botpress conversation exactly once.

**Architecture:** Normalize the true inbound channel at the boundary, persist the Botpress conversation as the durable return route, and replace the Retell/Xendra tool route's direct-provider sender with the same Botpress-managed outbound gateway already used by post-call follow-up. Keep the direct provider implementation only as an explicit fallback when Botpress-managed delivery is not configured. Lifecycle events remain deterministic and channel-agnostic.

**Tech Stack:** Next.js App Router, TypeScript, Botpress ADK, PostgreSQL/Supabase, Vitest, Xendra/Retell, Stripe Payment Links.

---

## Scope and invariants

- Telegram stays Telegram in canonical state; WhatsApp stays WhatsApp.
- `sandbox_provider = telegram_sandbox` remains a safety marker, not a fake channel name.
- Agent B never writes to Telegram, WhatsApp, Stripe, Sheets, or Supabase directly. It calls authenticated orchestrator tools.
- Tool responses remain HTTP 200 when required by the voice provider, but their body must truthfully expose `ok: false` and a stable error code.
- A Botpress-managed conversation may receive its own transactional message even when the originating identity is a Telegram sandbox identity. Arbitrary external sends from sandbox identities remain prohibited.
- One tool request produces at most one payment link delivery. One call terminal event produces at most one follow-up.
- No regex-based commercial logic, canned sales messages, planner, or new conversational guard is added.
- Existing prompt and natural-language behavior are out of scope.

## Target flow

```text
Telegram or WhatsApp inbound
        ↓
canonical channel identity + Botpress conversation ID
        ↓
Agent A / shared commercial state / call session
        ↓
Xendra starts Agent B
        ↓
Agent B invokes an authenticated orchestrator tool
        ↓
canonical managed-egress gateway
        ↓
the same originating Botpress conversation
        ↓
Telegram or WhatsApp user receives one message
```

---

### Task 1: Pin the two production failures with RED tests

**Files:**
- Create: `tests/integration/retell-managed-egress.test.ts`
- Modify: `tests/integration/post-call-botpress-egress.test.ts`
- Modify: `tests/unit/botpress/telegram-envelope.test.ts`
- Modify: `tests/unit/botpress/telegram-adapter.test.ts`

- [ ] Add a Telegram contract test asserting that `buildTelegramSandboxEnvelope()` emits `channel: 'telegram'` and still emits `sandbox_provider: 'telegram_sandbox'`.
- [ ] Add a WhatsApp control test proving the WhatsApp envelope remains `channel: 'whatsapp'`.
- [ ] Add a vertical tool-egress test with a stored Botpress conversation and Telegram sandbox identity. Invoke `enviar_link_pago` through the real orchestration store and assert:
  - one Botpress message is created in the originating conversation;
  - the message contains the authorized link;
  - the result is `ok: true` / `sent: true`;
  - no `SANDBOX_LOCKED` refusal is recorded;
  - a replay does not create a second message.
- [ ] Run only these tests and confirm they fail for the expected reasons: Telegram is currently labeled WhatsApp, and the Retell tool route currently reconstructs direct channels instead of using managed egress.
- [ ] Do not weaken or delete existing sandbox safety assertions to make the test pass.

**Review focus:** The tests must exercise the real orchestration/egress boundary. Mock only the final Botpress HTTP transport, never the route-selection or identity logic under test.

---

### Task 2: Normalize Telegram as Telegram at ingestion

**Files:**
- Modify: `botpress-agent/src/channels/shared/telegram-envelope.ts`
- Modify: `src/app/api/agent/ingest/route.ts`
- Reuse: `src/lib/contracts/inbound-envelope.ts`
- Reuse: `botpress-agent/src/schemas/contracts.ts`
- Modify: `tests/integration/telegram-sandbox-intake.test.ts`
- Modify: `tests/integration/ingestion-channel-derivation.test.ts`
- Modify: `tests/contract/canonical-envelope.test.ts`

- [ ] Change the Telegram envelope type and builder from `channel: 'whatsapp'` to `channel: 'telegram'`.
- [ ] Replace the API route's duplicated inline canonical schema with `InboundEnvelopeSchema`, or minimally widen it to the already-supported canonical `telegram` channel if importing would introduce a dependency cycle. Prefer one canonical schema.
- [ ] Preserve the synthetic `+999…` phone and `sandbox_provider = telegram_sandbox`; they are still required for sandbox isolation and contact correlation.
- [ ] Update workflow conditions that currently infer "real WhatsApp" from `channel === 'whatsapp' && sandbox_provider !== 'telegram_sandbox'` so they use the true channel without changing behavior.
- [ ] Update tests and fixtures to prove Telegram creates a Telegram conversation/thread/permission and WhatsApp still creates WhatsApp records.
- [ ] Run the focal unit, contract, and ingestion integration suites.

**Review focus:** Channel describes the customer transport. Provider describes the integration implementation. Sandbox status describes side-effect safety. These three concepts must no longer be conflated.

---

### Task 3: Reconcile existing Telegram sandbox identities safely

**Files:**
- Create: `supabase/migrations/20260929010001_reclassify_telegram_sandbox_channel.sql`
- Add/modify: `tests/integration/telegram-channel-reconciliation.test.ts`

- [ ] Inspect uniqueness constraints before writing the migration; do not assume an update cannot collide.
- [ ] Reclassify only records proven to belong to `provider = 'telegram_sandbox'` or to a linked sandbox identity:
  - `channel_threads.channel`: `whatsapp` → `telegram`;
  - `channel_events.channel`: `whatsapp` → `telegram`;
  - linked `conversations.channel`: `whatsapp` → `telegram`;
  - linked contact/workspace origin fields and channel permissions where applicable.
- [ ] Merge permission rows idempotently if both Telegram and WhatsApp rows already exist for the same sandbox contact.
- [ ] Do not rewrite historical outbound delivery audit rows; preserve what the system actually attempted at that time.
- [ ] Make the migration idempotent and add an assertion query proving no Telegram sandbox thread remains mislabeled as WhatsApp.
- [ ] Run the migration against a disposable database twice, then run the focal integration test.

**Review focus:** The selector must never reclassify a real WhatsApp lead. Require positive Telegram sandbox evidence, not a synthetic-phone heuristic alone.

---

### Task 4: Create one canonical managed outbound gateway

**Files:**
- Rename/generalize: `src/features/calls/adapters/post-call-outbound.ts` → `src/features/messaging/adapters/managed-outbound.ts`
- Rename/generalize: `src/features/calls/adapters/post-call-botpress-identity-store.ts` → `src/features/messaging/adapters/botpress-managed-identity-store.ts`
- Modify: `src/app/retell/tools/route-handler.ts`
- Modify: `src/app/retell/eventos/route.ts`
- Modify: `src/app/api/cron/post-call-followup/route.ts`
- Modify: `tests/integration/retell-managed-egress.test.ts`
- Modify: `tests/integration/post-call-botpress-egress.test.ts`

- [ ] Extract `createManagedOutboundSender(db)` from the working post-call implementation.
- [ ] When Botpress-managed configuration exists:
  - resolve the originating Botpress conversation from durable channel identity;
  - use `BotpressManagedChannel` for both Telegram and WhatsApp;
  - send back only to that same conversation;
  - allow the same-conversation send for Telegram sandbox while retaining content authorization and idempotency.
- [ ] When Botpress-managed configuration is absent, explicitly fall back to the existing direct WhatsApp/Telegram adapters.
- [ ] Delete the duplicated channel construction from `src/app/retell/tools/route-handler.ts` and inject the canonical sender into `PostgresRetellOrchestrationStore`.
- [ ] Use the same factory for event-triggered follow-up and the post-call cron route.
- [ ] Do not catch configuration errors and silently set `sendOutbound = undefined`. Return a stable tool error such as `OUTBOUND_UNAVAILABLE` and log the non-sensitive cause class.
- [ ] Run the managed-egress tests and direct-provider fallback tests.

**Review focus:** This is the root structural correction. There must be one route-selection implementation, not a Telegram patch and a WhatsApp patch.

---

### Task 5: Make payment-link execution transactional and observable

**Files:**
- Modify: `src/features/calls/adapters/postgres-retell-orchestration-store.ts`
- Modify: `src/features/calls/application/retell-tools.ts`
- Modify: `src/features/messaging/application/send-outbound-message.ts`
- Modify: `tests/integration/retell-five-tools-postgres.test.ts`
- Modify: `tests/integration/agent-a-xendra-agent-b-e2e.test.ts`

- [ ] Resolve course and plan canonically from durable state or explicit tool arguments; never infer a confirmed plan from a possibility.
- [ ] Reserve the payment link and write the outbound idempotency key before sending.
- [ ] Use an idempotency key derived from workspace, lead/call, course, plan, and tool invocation so retries return the existing result.
- [ ] Mark `link_pago_enviado = true` only after Botpress accepts the message and provides a message ID.
- [ ] If the send fails, leave the reservation retryable and return `ok: false` with a stable code. Never tell Agent B that the link was sent.
- [ ] Add structured logs for `call_id`, `lead_id`, `conversation_id`, channel, delivery ID, Botpress message ID, outcome, and error code; omit PII, links, tokens, and secrets.
- [ ] Preserve the distinction between `payment_reported` and `payment_verified`; only the signed Stripe webhook can verify payment.
- [ ] Run the five-tools and A→B→A integration tests.

**Review focus:** HTTP 200 from a voice tool route is not business success. The response body and persisted delivery state are authoritative.

---

### Task 6: Harden call termination and error follow-up for both channels

**Files:**
- Modify: `src/lib/contracts/call-event.ts`
- Modify: `src/features/calls/adapters/retell-lifecycle.ts`
- Modify: `src/features/calls/application/post-call-followup.ts`
- Modify: `src/features/calls/domain/post-call-followup.ts`
- Modify: `tests/unit/calls/post-call-followup.test.ts`
- Modify: `tests/integration/retell-call-lifecycle.test.ts`
- Modify: `tests/integration/post-call-followup.test.ts`

- [ ] Persist both the normalized disconnect category and a bounded raw provider reason for diagnosis.
- [ ] Tolerate valid event reordering: `call_ended` may arrive before or after `call_analyzed`; a tool-generated interim result must not prematurely close an active call.
- [ ] Wait a short bounded window for `call_analyzed`; use one deterministic technical fallback only when it does not arrive.
- [ ] Produce one channel-agnostic follow-up intent:
  - `no_answer` → offer retry or continue by chat;
  - abrupt/user hangup → ask whether to retry or continue by chat;
  - provider/internal error → explain temporary unavailability and continue by chat;
  - `timed_out` or ambiguous interruption → neutral interruption wording, without blaming the user;
  - normal completion → resume from the state and data collected by B.
- [ ] Route that intent through `createManagedOutboundSender`, never through a channel-specific sender.
- [ ] Enforce exactly-once follow-up with `post-call:<call_id>:<followup_kind>`.
- [ ] Add a Telegram and a WhatsApp test for each terminal family, including duplicate and out-of-order events.

**Review focus:** This improves how known events are handled. It cannot manufacture a precise reason when Xendra/Retell reports only `timed_out`; preserve uncertainty truthfully.

---

### Task 7: Distinguish submission from real delivery

**Files:**
- Modify: `src/features/messaging/adapters/botpress-managed.channel.ts`
- Modify: `src/features/messaging/application/send-outbound-message.ts`
- Modify: `src/lib/observability/structured-log.ts` only if a reusable event shape is needed
- Add/modify: `tests/integration/botpress-managed-delivery.test.ts`

- [ ] Persist `submitted_to_botpress` when Botpress returns a message ID; do not call that physically delivered.
- [ ] If the current token supports message reads or delivery callbacks, reconcile to delivered/failed. If it does not, keep the honest submitted state and emit a metric for unreconciled submissions.
- [ ] Do not resend on an ambiguous response once a Botpress message ID exists.
- [ ] Add tests for accepted, explicit failure, timeout without message ID, and timeout/exception after a known message ID.

**Review focus:** Observability must stop reporting success more strongly than the provider evidence allows.

---

### Task 8: Verify, deploy, and smoke both channels from one SHA

**Files:**
- Modify only if evidence requires it: deployment/evidence reports under `docs/reports/evidence/`

- [ ] Run focal tests after every task; do not run paid conversational campaigns because the prompt is unchanged.
- [ ] Run the final gates once:
  - unit tests;
  - affected PostgreSQL integration tests;
  - typecheck root and Botpress;
  - lint;
  - ADK check/build;
  - production build;
  - `git diff --check`.
- [ ] Deploy Vercel and Botpress from the exact same commit SHA.
- [ ] Verify health/readiness and the deployed SHA before testing.
- [ ] Run one clean Telegram smoke and one clean WhatsApp smoke:
  1. inbound message reaches Agent A;
  2. Agent A requests a call;
  3. Agent B requests a payment link during the call;
  4. exactly one link appears in the same originating chat;
  5. terminate the call abruptly;
  6. exactly one appropriate follow-up appears in the same chat;
  7. Agent A continues with data collected by B;
  8. no duplicate contact, Sheets row, link, call, event, or follow-up exists.
- [ ] Capture evidence from Botpress, Vercel logs, Supabase, Sheets, and the call ledger without recording secrets or full PII.

## Definition of done

- Telegram is persisted as Telegram and WhatsApp as WhatsApp.
- Both channels share one Botpress-managed return path.
- Agent B can request a payment link during a call and the link reaches the same chat exactly once.
- A missed, cut, failed, timed-out, or completed call produces one truthful continuation on either channel.
- Data learned by A or B updates the same lead and the same Sheets projection idempotently.
- No prompt/personality change, conversational blocker, planner, or channel-specific business rule was added.
- Vercel and Botpress run the same verified SHA.

