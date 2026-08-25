# Task 3 Report — WhatsApp Canary and Release Readiness

## Status

Complete as local preparation only. No package was installed, no Botpress or
Meta integration was configured, no secret was written, no deployment was
performed, and no message was sent.

## Implementation

- Added `whatsappCanaryEnabled` with default `false`; retained
  `automationEnabled` with default `false`.
- Declared `WHATSAPP_CANARY_PHONE_E164S` without a value.
- Added a fail-closed egress decision that requires global automation, the
  canary switch, and exactly one strict, non-synthetic E.164 tester. The final
  workflow send path evaluates this decision immediately before
  `client.createMessage` for official WhatsApp turns.
- Canary observability emits only `allowed` and a reason code. Phone and secret
  values are neither returned nor logged.
- Added a read-only release preflight for public HTTPS, `/api/health`,
  `/api/ready`, the `studyx` workspace, required backend variable presence,
  matching orchestrator key IDs, Stripe test mode/key type, safe Botpress
  switches, canary secret status, and the development integration status.
- Removed example values from the required backend variables and selected
  `PAYMENT_PROVIDER=stripe_test` and `BUSINESS_WORKSPACE_SLUG=studyx`.

## TDD evidence

1. RED: the focal command reported nine missing canary-gate failures and the
   absent readiness script.
2. GREEN: the same focal command passed 37/37 tests.
3. Regression: the WhatsApp envelope/channel/router/logging, inbound workflow,
   and readiness suites passed 79/79 tests.

## Verification

- `npm test -- tests/unit/botpress/whatsapp-channel.test.ts tests/unit/scripts/whatsapp-release-readiness.test.ts`
  — 37 tests passed.
- Six focused channel/workflow/readiness files — 79 tests passed.
- `npm --prefix botpress-agent run typecheck` — passed.
- `npm --prefix botpress-agent run check` — valid, zero errors and warnings.
- `npm run typecheck` — passed after a mechanical explicit type annotation in
  the Task 2 logging test that was required by the branch-wide gate.
- Local readiness dry-run — expected exit 1 with public HTTPS, backend/cloud
  environment, Stripe-test, canary, and integration blockers named; no secret
  value printed.
- `git diff --check` — passed.

## Self-review

- Defaults remain off and the egress gate fails closed for every missing,
  malformed, synthetic, non-exact, or multi-number allowlist.
- The gate is attached at the only physical Botpress send call, so a queued
  official WhatsApp turn is still protected after decision commit.
- Telegram and emulator egress behavior is unchanged.
- Preflight child commands are read-only, bounded by timeouts, and their raw
  output/errors are never forwarded into the result.
- Readiness reasons contain configuration names and stable error codes only.

## Review round 1

Two metadata parsing defects were corrected with structured ADK fixtures:

- RED: a configured required secret (`set:true`, `optional:false`) was rejected
  by the former broad search for any nearby `false`.
- RED: a disabled WhatsApp integration and an enabled wrong-version integration
  were accepted by the former word search.
- GREEN: secret readiness now requires one exact named entry with boolean
  `set:true`; integration readiness requires one exact `whatsapp` alias/name,
  pinned version `4.18.5`, and boolean `enabled:true`.
- Text fallback was removed. Missing, malformed, duplicated, unset, disabled,
  or wrong-version structured metadata fails closed.
- Focal result after the fix: 44/44 tests passed. No metadata or secret value is
  included in readiness output.

## Review round 2

The parsers are now bound to the real ADK command envelopes and requested
environment:

- RED: `{success,dev,prod}` secret output and
  `{ok,target,data:{integrations}}` integration output both failed their valid
  development cases under the collection-only parser.
- GREEN: `development` reads only `dev`; `production` reads only `prod`.
  Integration metadata must additionally report the matching ADK target.
- Failed commands, unknown or mismatched targets, malformed envelopes, unset
  secrets, disabled integrations, missing aliases, and wrong versions all fail
  closed.
- Focal result after the envelope fix: 52/52 tests passed. The parser consumes
  status booleans and metadata names only; readiness still emits no values.
