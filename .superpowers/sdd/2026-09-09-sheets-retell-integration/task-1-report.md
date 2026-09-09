# Task 1 report — four-column complete-lead Sheets projection

## Status

Done. No migration was needed: `sheet_projection_rows.payload` is already a
JSON outbox payload, and the existing stable projection key, reserved row,
lease/retry/dead-letter worker, accepted-delivery gate, and sandbox check are
reused.

## Implementation

- The visible row contract is exactly `nombre`, `apellido`, `mail`, and
  `tipo_de_curso`, in A:D order. The provider's existing calculated terminal
  column therefore resolves to `D`, while its update and sandbox guard remain
  unchanged.
- `enqueueLeadProjection` now persists only those four values and returns no
  row for incomplete data. It keeps canonical `email` and `cursoInteres`
  inputs internally, maps them to `mail` and `tipo_de_curso`, and converges a
  legacy payload to the four-column shape on a later correction.
- The worker obtains the contact ID from the stable
  `lead:<workspace_id>:<contact_id>` key rather than from the now-invisible
  payload, preserving the existing sandbox real-side-effect check.
- Agent A now prepares the existing deferred outbox payload automatically when
  full name, email, and selected course are all present. It still materializes
  only from the accepted-delivery path; neither a payment preparation nor the
  inert lead-projection preparation is required. A later correction uses the
  same stable key and row number.
- The legacy payment reconciliation caller accepts the complete-lead no-op
  result without changing its existing retry/reconciliation behavior.

## Files changed

- `src/lib/providers/sheets/sheets-provider.ts`
- `src/lib/services/projection.service.ts`
- `src/lib/services/decision.service.ts`
- `src/features/conversation/application/commit-agent-turn-v3.ts`
- `tests/unit/projection/projection-idempotency.test.ts`
- `tests/integration/agent-tools-commit-effects.test.ts`

## TDD evidence

### RED

1. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`
   initially failed the four-value contract: the received payload contained
   15 fields including `email` and `curso_interes`, rather than the exact
   four-field payload with `mail` and `tipo_de_curso`.
2. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-tools-commit-effects.test.ts`
   initially failed the non-payment complete-lead case: accepted delivery
   left `sheet_projection_rows` empty because no lead preparation was present.
3. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`
   then failed the incomplete-lead case: one row was created when `apellido`
   was blank.

An attempted focused run against port 54322 was discarded as environment
evidence because that local database had no repository schema. The migrated,
disposable database on port 55433 produced the RED evidence above.

### GREEN

- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`
  — 9/9 passed.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-tools-commit-effects.test.ts tests/integration/telegram-sandbox-intake.test.ts`
  — 17/17 passed.
- `npm run test:unit` — 192 files passed, 2 skipped; 3,089 tests passed, 9
  skipped, 7 todo.
- `npm run typecheck` — passed.
- `git diff --check` — passed.

## Self-review

- Reviewed the complete diff and confirmed the persisted payload has no hidden
  operational, payment, trace, phone, or contact-ID fields.
- Confirmed the provider keeps `spreadsheets.values.update` rather than append;
  the four-element column list makes its existing calculated range A:D.
- Confirmed projection remains accepted-delivery gated and provider failures
  still flow through the unchanged retryable/dead-letter worker tests.
- Confirmed the sandbox provider test still proves a sandbox contact is blocked
  before Google client creation/network activity.
- No migrations, Retell files, supplied export, credentials, or live Google
  calls were touched.

## Concerns

None. The only operational prerequisite for a live projection remains the
existing Sheets configuration and credentials; all verification here used the
fake provider and disposable local PostgreSQL only.
