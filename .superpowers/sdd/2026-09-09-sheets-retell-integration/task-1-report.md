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

## Fix Round 1 — ordering fence and coverage completion

### Implementation

- Added `sheet_projection_rows.source_order` through the additive migration
  `20260909000001_sheet_projection_source_order.sql`. It is durable outbox
  metadata, not part of the visible four-field JSON payload.
- Agent A captures the inbound message's monotonic `conversation_seq` with the
  deferred lead snapshot. `enqueueLeadProjection` updates an existing stable
  row only when that source order is strictly newer; equal or older accepted
  deliveries are no-ops. This keeps a late older delivery from restoring stale
  values after a correction was already accepted.
- Retained a safe default source order of zero for legacy/non-Agent-A callers;
  it cannot overwrite a newer Agent A snapshot.

### New focused coverage

- Multi-turn capture in non-field order: selected course exists, email is
  accepted first, then name/surname are accepted; exactly one complete row is
  created only after the final required values exist.
- Out-of-order acceptance: a second-turn surname correction is accepted before
  the first outbound; accepting the first outbound afterward leaves the newer
  surname intact.
- `Promise.all` ten-way same-lead enqueue: one outbox row and one stable Sheet
  row.
- Repeated simulated provider timeouts: the row reaches `dead_letter` at its
  configured maximum attempt count.

### RED evidence

`TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-tools-commit-effects.test.ts`

Before the fence, the new out-of-order test failed as intended: after accepting
the newer `García` correction and then the older outbound, the stored payload
was rolled back to `Pérez`.

### GREEN evidence

1. Applied the additive migration to the disposable local database:
   `psql postgresql://postgres@127.0.0.1:55433/studyx_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260909000001_sheet_projection_source_order.sql`
   — `ALTER TABLE`, `COMMENT`.
2. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`
   — 10/10 passed.
3. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-tools-commit-effects.test.ts`
   — 14/14 passed.
4. `npm run typecheck` — passed.
5. `git diff --check` — passed.

### Files changed in this round

- `supabase/migrations/20260909000001_sheet_projection_source_order.sql`
- `src/lib/services/projection.service.ts`
- `src/features/conversation/application/commit-agent-turn-v3.ts`
- `tests/unit/projection/projection-idempotency.test.ts`
- `tests/integration/agent-tools-commit-effects.test.ts`

### Round self-review and concerns

The fence is per stable projection key and does not alter the A:D payload,
retry/dead-letter state machine, delivery gate, or sandbox guard. No live
Google effect ran. No concerns remain.

## Fix Round 2 — complete multi-turn proof and legacy refresh compatibility

### Implementation

- Reworked the complete-lead integration case to start with neither selected
  course nor complete identity. It accepts email first, sets the canonical
  selected course in a second accepted turn, then ingests and accepts
  name/surname in a third turn. The test proves no stable row exists before
  completion and exactly one four-column row exists afterwards.
- Treat a missing `sourceOrder` as absence of ordering proof rather than as
  the equal numeric order `0`. Legacy callers can therefore refresh the same
  stable row when the merged payload changes, while leaving its stored source
  order intact. Ordered Agent A writes retain the strict greater-than fence.

### RED evidence

`TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`

Before the implementation, the new source-less identity-refresh test failed
as intended: its second enqueue expected `after@example.com`, but the existing
row still held `before@example.com` because both calls were coerced to source
order zero and the equality fence returned unchanged.

### GREEN evidence

1. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`
   — 11/11 passed.
2. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-tools-commit-effects.test.ts`
   — 14/14 passed.
3. `npm run typecheck` — passed.
4. `git diff --check` — passed.

### Files changed in this round

- `src/lib/services/projection.service.ts`
- `tests/unit/projection/projection-idempotency.test.ts`
- `tests/integration/agent-tools-commit-effects.test.ts`

### Round self-review and concerns

The visible payload remains exactly `nombre`, `apellido`, `mail`, and
`tipo_de_curso`; no migration, Retell code, export, credentials, or live Google
effect was touched. The test obtains all required contact fields across actual
accepted turns in a deliberately non-field order. No concerns remain.

## Fix Round 3 — independent field capture and legacy-order fence

### Implementation

- The integration proof now starts empty and accepts the four required values
  independently in non-field order: first name, canonical selected course,
  email, then surname. It asserts no stable projection after each of the first
  three accepted deliveries and exactly one complete four-column row after the
  fourth.
- A source-less refresh may only update an existing legacy row whose durable
  `source_order` is zero. It is a no-op once Agent A has written a positive
  ordered snapshot. The SQL update repeats that condition, preventing a
  source-less read/update race from overwriting an ordered correction.

### RED evidence

`TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`

Before the new fence, the source-less-after-ordered test failed as intended:
the delayed unversioned enqueue returned `changed: true` after an ordered
source-order-2 correction, demonstrating that it could overwrite the newer
payload.

### GREEN evidence

1. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:unit -- tests/unit/projection/projection-idempotency.test.ts`
   — 12/12 passed.
2. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-tools-commit-effects.test.ts`
   — 14/14 passed.
3. `npm run typecheck` — passed.
4. `git diff --check` — passed.

### Files changed in this round

- `src/lib/services/projection.service.ts`
- `tests/unit/projection/projection-idempotency.test.ts`
- `tests/integration/agent-tools-commit-effects.test.ts`

### Round self-review and concerns

The positive-order guard is both checked before updating and included in the
durable SQL predicate. This leaves source-order-zero compatibility intact,
maintains strict monotonic ordered writes, and keeps the visible A:D payload
unchanged. No migration or live Google effect was used. No concerns remain.
