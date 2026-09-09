# Task 2 Report — Retell configuration, provider adapter, and dispatch

## Status

Complete. Retell is wired behind the existing `VoiceProvider` and existing
`dispatchCall` state machine. All HTTP behavior was exercised with injected
fakes. No Retell request, agent publish, phone-number assignment, export copy,
Botpress change, Sheets change, or live external effect was performed.

## Implementation

- Added a fail-closed Retell configuration loader for the API credential,
  outbound number, HTTPS API base URL, explicit Agent ID/version, explicit
  expected LLM ID/version, advisor display name, tool secret, webhook signature
  key, and request timeout. Errors contain only the environment-variable name,
  never its value.
- Documented the supplied non-secret Agent/LLM identifiers and numeric version
  `0` in both environment examples. Credential, phone, advisor, tool-secret,
  and signature-key values remain placeholders.
- Added `RetellVoiceProvider` using injected `fetch` and clock dependencies. It:
  - calls `POST /v2/create-phone-call` exactly once;
  - pins `override_agent_id`, numeric `override_agent_version`, and
    `agent_override.agent.response_engine` to the configured Retell LLM ID and
    numeric version;
  - sends only canonical metadata `internal_call_id`, `contact_id`, and
    `conversation_id`;
  - sends only the five frozen context fields plus backend-configured
    `nombre_asesor` as dynamic variables, excluding transcript history and
    `prompt_version`;
  - checks the canonical sandbox identity immediately before the create-call
    network effect;
  - treats create-call 4xx as confirmed and network/timeout/malformed-success,
    5xx, and other outcomes as ambiguous, without retrying;
  - reconciles through `POST /v3/list-calls` with an
    `internal_call_id` metadata filter, consumes the `items` response, and
    accepts only one exact metadata match;
  - maps cancellation to `POST /v2/stop-call/{call_id}`, with stop 4xx
    confirmed and connection/5xx/unknown outcomes ambiguous.
- Extended the existing dispatchable-call and provider input shapes only with
  `contactId` and `conversationId`; `PostgresCallStore` derives both from the
  canonical call session and `dispatchCall` passes them through.
- The dispatch route now selects Retell only for an explicit Retell config. Its
  Telegram branch constructs the same receipt store, destination resolver,
  Bot API client, timeout, and random nonce as before.

## Files

- `.env.example`
- `.env.local.example`
- `src/lib/config.ts`
- `src/features/calls/ports/voice-provider.ts`
- `src/features/calls/ports/call-store.ts`
- `src/features/calls/adapters/postgres-call-store.ts`
- `src/features/calls/adapters/retell-voice.provider.ts`
- `src/features/calls/application/dispatch-call.ts`
- `src/app/api/agent/calls/[call_id]/dispatch/route.ts`
- `tests/unit/calls/dispatch-call.test.ts`
- `tests/unit/calls/dispatch-route-provider.test.ts`
- `tests/unit/calls/retell-config.test.ts`
- `tests/unit/calls/retell-provider.test.ts`
- `tests/unit/calls/telegram-sim-voice-provider.test.ts`
- `.superpowers/sdd/2026-09-09-sheets-retell-integration/task-2-report.md`

## RED evidence

Command:

`npm run test:unit -- tests/unit/calls/dispatch-call.test.ts tests/unit/calls/retell-config.test.ts tests/unit/calls/retell-provider.test.ts`

Result: exit 1. The dispatch assertion failed because `contactId` and
`conversationId` were absent; the config suite failed because the Retell
configuration contract was absent; and the provider suite failed because the
Retell adapter module did not exist. The existing three remaining dispatch
tests passed.

Command:

`npm run test:unit -- tests/unit/calls/dispatch-route-provider.test.ts`

Result: exit 1, 2/2 failed because `buildDispatchVoiceProvider` did not exist,
proving the route had no Retell selection path and no tested preservation of
the Telegram selection path.

## GREEN evidence

Focused command:

`npm run test:unit -- tests/unit/calls/dispatch-route-provider.test.ts tests/unit/calls/dispatch-call.test.ts tests/unit/calls/retell-config.test.ts tests/unit/calls/retell-provider.test.ts tests/unit/calls/telegram-sim-voice-provider.test.ts`

Result: exit 0, 5 files passed, 42 tests passed, with no warnings or unhandled
errors.

Root unit command:

`npm run test:unit`

Final result: exit 0, 195 files passed and 2 skipped; 3,122 tests passed, 12
skipped, and 7 todo.

Typecheck command:

`npm run typecheck`

The first pre-commit run found only that the synthetic config fixture did not
satisfy this repository's augmented `NodeJS.ProcessEnv` type because it lacked
`NODE_ENV`. The configuration loader boundary was corrected to accept the same
read-only string environment map used by other loaders. The final run exited 0
with no diagnostics.

## Self-review

- Confirmed the provider never loops or recursively retries create-call,
  lookup, or stop-call requests.
- Confirmed only create-call 4xx and stop-call 4xx enter the confirmed-error
  branch; all specified unknown outcomes remain ambiguous.
- Confirmed a failed or positive sandbox lookup occurs before `fetch`, and a
  sandbox identity produces the confirmed `CONTACT_IS_SANDBOX` result with
  zero Retell requests.
- Confirmed reconciliation rechecks returned metadata instead of trusting the
  server-side filter alone, rejects multiple matches/unfinished pagination,
  and reads `items` rather than the legacy array response.
- Confirmed create-call sends no transcript, context `call_id`, prompt version,
  tool secret, webhook key, or idempotency token.
- Confirmed configuration errors and provider errors never include credential
  values or Retell response bodies.
- Confirmed the environment examples contain only names, public non-secret
  identifiers/versions/base URL, numeric timeout defaults, and placeholders.
- Confirmed `git diff --check` passes and all changed paths are Task 2 files.

## Concerns

No code concern remains. Operationally, the supplied Retell Agent and LLM are
still staging/draft version `0`; this task deliberately does not publish them,
assign a phone number, copy the export, or attempt a real call. A live smoke
therefore remains separately gated on approved Retell configuration and
external authorization.
