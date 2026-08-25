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
