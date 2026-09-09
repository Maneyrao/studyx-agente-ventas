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
