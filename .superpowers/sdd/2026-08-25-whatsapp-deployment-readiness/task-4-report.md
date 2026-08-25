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
- Review fix: added presence-only coverage for `PAYMENT_LINK_12M`,
  `PAYMENT_LINK_6M`, `PAYMENT_LINK_CONTADO`,
  `GOOGLE_SHEETS_SPREADSHEET_ID`, and `GOOGLE_SHEETS_TAB_NAME`; no value is
  documented or configured.
- Review fix: added separate development and production Botpress deployment
  procedures. Each requires its own explicit authorization and audit record,
  begins with automation/canary/integration disabled, checks health and
  readiness around `adk deploy`, and uses the existing disable-first rollback.

## TDD evidence

1. RED: `npm test -- tests/unit/docs/whatsapp-go-live-runbook.test.ts` failed
   5/5 because `docs/runbooks/whatsapp-go-live.md` did not exist.
2. GREEN: after the minimal runbook and reconciled links were added, the docs
   test passed 5/5.
3. A TypeScript compatibility regression from dotAll regex flags was found by
   `npm run typecheck`; the test was corrected to use target-compatible regexes
   and the complete verification passed.
4. Review RED: the expanded docs test failed for the five missing payment/Sheets
   keys and missing development/production deploy procedures. GREEN: after
   adding presence-only keys and ordered, auditable procedures, the docs test
   passed 6/6.

## Verification

- `npm test -- tests/unit/docs/whatsapp-go-live-runbook.test.ts tests/unit/botpress/whatsapp-channel.test.ts tests/unit/scripts/whatsapp-release-readiness.test.ts` — 58 passed after the review fix.
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
- The deployment procedures remain inert at the current 20/50 gate: they state
  no external mutation until authorized and do not broaden the existing Task 5
  or production authority.
