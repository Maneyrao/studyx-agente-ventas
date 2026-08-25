# Task 4 Report — Controlled WhatsApp Sandbox Runbook

## Status

Complete as documentation and local verification only. No Vercel, Supabase,
Botpress, Meta, Stripe, Google Sheets, secrets, integrations, deployments, or
messages were changed.

The runbook explicitly records that today's deliverable is a controlled
Botpress WhatsApp Sandbox demo, not production. The current 20/50 regression
does not meet the 50/50 entry gate, so Task 5 and every external canary action
remain blocked pending explicit authorization.

## Implementation

- Added `docs/runbooks/whatsapp-go-live.md` with external prerequisites,
  secret/configuration names only, health/ready/readiness checks, ordered
  Sandbox-to-production gates, a one-tester eight-scenario script, no-PII
  evidence fields, Stripe webhook and Google Sheets projection verification,
  and disable-first rollback.
- Linked the runbook from `README.md` and made its Sandbox-only/non-production
  status visible at the repository entry point.
- Reconciled Telegram-only material without deleting it: `PILOT_RUNBOOK.md`
  is labelled historical evidence, and `ORCHESTRATOR_MAP.md` preserves the
  Telegram row while recording the WhatsApp adapter/canary preparation and its
  blocked external state.
- Added a focused docs test for the required prerequisites, configuration
  names, gate ordering, eight scenarios, rollback order, no-PII evidence, and
  resolvable local runbook links.

## TDD evidence

1. RED: `npm test -- tests/unit/docs/whatsapp-go-live-runbook.test.ts` failed
   5/5 because `docs/runbooks/whatsapp-go-live.md` did not exist.
2. GREEN: after the minimal runbook and reconciled links were added, the docs
   test passed 5/5.
3. A TypeScript compatibility regression from dotAll regex flags was found by
   `npm run typecheck`; the test was corrected to use target-compatible regexes
   and the complete verification passed.

## Verification

- `npm test -- tests/unit/docs/whatsapp-go-live-runbook.test.ts tests/unit/botpress/whatsapp-channel.test.ts tests/unit/scripts/whatsapp-release-readiness.test.ts` — 57 passed.
- `npm run typecheck` — passed.
- `npm --prefix botpress-agent run typecheck` — passed.
- `git diff --check` — passed.

## Self-review

- The only executable-looking cloud commands are clearly fenced behind named
  authorization and regression gates; no command was run against an external
  system.
- Rollback starts with `automationEnabled=false`, then disables the WhatsApp
  integration only if delivery continues; it preserves audit/database records
  and requires reconciliation of `submitted_to_botpress` before retry.
- Production remains a later, separately approved path. The dry-run command
  is documented as preview-only, and no development credential may be copied
  into production.
- Evidence records IDs/hashes, counts, timestamps, statuses, and durations;
  it excludes raw customer data, phone numbers, tokens, payloads, and
  screenshots containing them.
