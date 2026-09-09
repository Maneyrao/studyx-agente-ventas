# Task 2 — Five remaining Retell orchestration tools

## Implementation

- Extended the existing Retell authentication, raw-body signature, bounded-body, strict-envelope, correlation, and structured-error boundary to support `enviar_link_pago`, `verificar_pago`, `enviar_material`, `derivar_a_asesor_humano`, and `agendar_seguimiento`.
- Added the five App Router POST endpoints with the exact export names and tool names from the supplied Retell export.
- Added `RetellOrchestrationStore` as the canonical-effects port and a Postgres adapter. Payment links use canonical payment reservation and checkout materialization, stable payment/send idempotency keys, and the existing authorized outbound sender. Payment verification is tenant/contact scoped and only returns persisted payment state.
- Material delivery reads only active, explicitly typed canonical `knowledge_sources` assets and sends through the existing authorized outbound path; missing assets or outbound proof fail closed.
- Human handoff and follow-up requests use durable tenant-bound tables with one request per workspace/contact/call replay fence. Handoff availability is `null` unless workspace metadata contains explicit staffing evidence. Follow-up text is stored verbatim; only an ISO timestamp with an explicit timezone offset is materialized.
- Added migration `20260909000003_retell_orchestration_requests.sql` with constraints, indexes, RLS, and guarded orchestrator policies.

## RED evidence

- Initial focused test run: 6 behavior tests failed at the existing envelope parser because the five names were not present in the supported tool schema (`ToolArgsSchemas[expectedName]` was undefined). This was the expected feature-missing failure.
- Schedule resolver RED run failed because the canonical adapter module did not yet exist.

## GREEN evidence

- Focused five-tool suite: 8 tests passed after the handler/port implementation; final suite includes 9 five-tool tests.
- Route and existing Retell boundary tests: 46 passed.
- Proportional calls suite: 19 files, 195 tests passed.
- `npm run typecheck`: passed.
- `supabase db lint --local --level error --fail-on error`: no schema errors.
- `git diff --check`: passed.

## Files

- `src/features/calls/application/retell-tools.ts`
- `src/features/calls/adapters/postgres-retell-orchestration-store.ts`
- `src/app/retell/tools/route-handler.ts`
- `src/app/retell/tools/enviar-link-pago/route.ts`
- `src/app/retell/tools/verificar-pago/route.ts`
- `src/app/retell/tools/enviar-material/route.ts`
- `src/app/retell/tools/derivar-humano/route.ts`
- `src/app/retell/tools/agendar-seguimiento/route.ts`
- `supabase/migrations/20260909000003_retell_orchestration_requests.sql`
- `tests/unit/calls/retell-five-tools.test.ts`
- `tests/unit/calls/retell-tool-routes.test.ts`

## Self-review

- Authentication and correlation remain before any canonical effect.
- Authenticated validation/business failures remain structured HTTP 200 responses; missing/invalid auth remains HTTP 401.
- Payment and outbound replay keys are stable and scoped to the correlated call/payment; no second payment or provider send is created on replay.
- Arbitrary payment references and model assertions do not override canonical payment state.
- No live network or credentials were used during development; the route’s configured Stripe provider remains the existing test-only provider boundary.
- Agent A prompts and natural-language behavior were not modified.

## Concerns

- The export allows `sms` and `email` for `enviar_link_pago`, but this repository’s canonical outbound provider path currently exposes WhatsApp/Telegram only. Those requested channels fail closed as `CHANNEL_UNAVAILABLE` rather than claiming delivery.
- Material assets must be authored as active `knowledge_sources` rows with `metadata.material_type` (and, for course-specific assets, `metadata.course_code`); absent metadata intentionally fails closed.
- No live Retell, Stripe, WhatsApp, or other external calls were made.

## Round 1 reviewer fixes

- Added canonical payment-plan authority: `contado` requires an active `payment`/`one_time` configuration and `cuotas` requires an active `subscription`/`monthly` configuration. Unsupported or mismatched mappings fail closed before reservation.
- Payment verification now returns a structured `PAYMENT_NOT_FOUND` failure when correlated canonical proof is absent; it never exposes `ok: true` with an invented `not_found` state. Unexpected reservation/database failures map to stable public codes.
- Material delivery now sanitizes the exact canonical asset and builds/verifies its egress manifest from owner-authored URL/protected-fact allowlists. Foreign URLs or unapproved protected facts fail closed.
- Follow-up timestamp parsing validates calendar month/day bounds before JavaScript date conversion. Replay responses return the durable first-write wording/channel/reason, and `cuando` validation no longer trims the stored or returned literal.
- Added composite workspace/contact and call/contact foreign keys plus a workspace-to-call consistency trigger for both durable request tables. RLS remains defense-in-depth rather than the integrity boundary.

### Round 1 RED/GREEN evidence

- RED: focused unit tests reproduced date normalization (`2026-02-30` became March), `ok:true` missing-payment state, replay echoing the new request, and absent canonical plan/material authorization.
- GREEN: focused five-tool tests now pass (13 tests); all calls unit tests pass (19 files, 199 tests).
- Added `tests/integration/retell-five-tools-postgres.test.ts` covering real-Postgres payment idempotency/plan authority, scoped payment reads, material egress, invalid dates, durable replay, and cross-tenant inserts. The disposable endpoint was present but its baseline reset stops earlier at the repository’s pre-existing `extensions.vector` migration mismatch, so the adapter integration file is guarded and could not execute against a migrated schema in this environment.
- `npm run typecheck`, `supabase db lint --local --level error --fail-on error`, and `git diff --check` pass after the fixes.

### Round 1 PostgreSQL rerun

Reviewer reproduction initially reported 2 failures: the payment replay invoked the outbound seam twice, and the scoped-payment fixture violated the canonical `paid_at` invariant. The production adapter now checks the durable outbound delivery fence before invoking the sender again; the fixture now supplies `paid_at` and leaves the schema invariant intact.

Exact command and result:

```text
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test npm run test:integration -- tests/integration/retell-five-tools-postgres.test.ts

Test Files  1 passed (1)
Tests       4 passed (4)
```

Covering command and result:

```text
npm test -- --run tests/unit/calls/retell-five-tools.test.ts tests/unit/calls/retell-tool-routes.test.ts tests/unit/calls/retell-tools.test.ts

Test Files  3 passed (3)
Tests       50 passed (50)

npm run typecheck
passed

git diff --check
passed
```

## Round 2 reviewer fix — StudyX custom payment-plan authority

The remaining reviewer finding was that the first-round guard only understood
`one_time`/`monthly` offering intervals, while StudyX intentionally uses
`billing_interval = 'custom'` and stores the three owner-approved options in
`workspaces.metadata.payment_options`. The adapter now reuses the canonical
`readStudyxPaymentOptions` resolver from the business-context domain. Retell's
coarse `contado` enum resolves only to a configured `one_time` option;
`cuotas` resolves to the sole configured installment option, or returns the
stable `PAYMENT_PLAN_CHOICE_REQUIRED` error when both 6- and 12-payment
options exist. Missing or malformed canonical options return
`PAYMENT_PLAN_UNAVAILABLE`. Custom offerings also require the canonical
`payment` checkout mode, so a subscription cannot materialize a contado link.
Legacy non-custom offerings retain the existing checkout-mode/interval
compatibility.

### Round 2 RED/GREEN evidence

- RED: the new unit test for StudyX `custom/payment_options` initially failed
  with `TypeError: resolveRetellPaymentPlan is not a function`; the additional
  custom-subscription authority assertion then failed until the resolver
  rejected non-`payment` checkout mode.
- GREEN: the focused unit test passed after implementation (14 tests).
- GREEN: the actual StudyX-shaped PostgreSQL fixture uses all three canonical
  owner-confirmed payment options and `billing_interval='custom'`. It proves
  `contado` succeeds and replays durably, `cuotas` fails with
  `PAYMENT_PLAN_CHOICE_REQUIRED` rather than choosing 6/12 arbitrarily, and a
  workspace missing the exact `one_time` configuration fails closed.

Exact PostgreSQL command and result:

```text
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test npm run test:integration -- tests/integration/retell-five-tools-postgres.test.ts

Test Files  1 passed (1)
Tests       4 passed (4)
```

Exact covering commands and results:

```text
npm test -- --run tests/unit/calls/retell-five-tools.test.ts tests/unit/calls/retell-tool-routes.test.ts tests/unit/calls/retell-tools.test.ts

Test Files  3 passed (3)
Tests       51 passed (51)

npm run typecheck
passed

git diff --check
passed
```

### Round 2 files and self-review

- `src/features/orchestration/domain/business-context.ts`: exported the
  existing canonical StudyX payment-options resolver for adapter reuse.
- `src/features/calls/adapters/postgres-retell-orchestration-store.ts`: loads
  workspace metadata, resolves plan authority against canonical options, and
  retains legacy interval behavior for non-StudyX offerings.
- `tests/unit/calls/retell-five-tools.test.ts` and
  `tests/integration/retell-five-tools-postgres.test.ts`: added RED→GREEN
  coverage for custom billing, exact option presence, ambiguous installments,
  and subscription mismatch.

No migration, Agent A prompt, natural-language behavior, live network call, or
credential was changed. The focused PostgreSQL database was the disposable
`127.0.0.1:55435/studyx_test` instance supplied for this review.
