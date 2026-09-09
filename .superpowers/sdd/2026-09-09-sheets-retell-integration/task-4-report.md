# Task 4 report — Retell P0 tools and complete-lead convergence

## Status

Complete.

- Implementation commit: `9bf3c37b8592696e937c3f7a101803b8deef3613`
  (`feat(calls): add authenticated Retell P0 tools`).

## Scope delivered

- Added the exact public App Router endpoints:
  - `POST /retell/tools/consultar-curso`
  - `POST /retell/tools/consultar-oferta`
  - `POST /retell/tools/guardar-datos-contacto`
  - `POST /retell/tools/registrar-resultado`
- Added one shared 32 KiB streamed-body boundary with dual authentication:
  untouched raw-body Retell HMAC using `RETELL_API_KEY` and a separately hashed,
  timing-safe `x-studyx-tools-secret` comparison using `RETELL_TOOLS_SECRET`.
- Strictly validates `{name, call, args}`, exact route/name pairing, the exact
  metadata UUID trio, bounded P0 argument contracts, and the required Retell
  `call_id`. Extra top-level/argument keys fail closed; non-contract call data is
  discarded.
- Resolves Task 3 Retell correlation and proves the resolved call belongs to the
  configured active workspace before every read or write tool runs.
- Resolves course code, display name, alias, and optional academy through the
  deterministic canonical catalog path. Unknown, ambiguous, truncated, or
  injection-suspected data returns a strict error without an LLM.
- Reads one coherent canonical offer snapshot and returns only assertable fixed
  price/currency and canonical configured payment labels. Multi-course,
  country-specific, missing, truncated, inconsistent, or non-fixed offers fail
  closed without calculating prices, installments, exchange, or discounts.
- Merges bounded contact identity fields transactionally, preserves an existing
  surname on a one-word first-name correction, and never changes the channel
  identity in `contacts.phone`.
- Enqueues the stable lead projection only after first name, surname, email, and
  the call's frozen canonical course are complete. The persisted Sheet payload
  remains exactly `nombre`, `apellido`, `mail`, and `tipo_de_curso`.
- Established the shared safe-integer total order: Agent A uses
  `2 * inbound_source_order`; Agent B uses `2 * call_source_order + 1`. The same
  lead row converges under replay/correction, an older delayed A write loses,
  and a later A write wins. Source-less legacy fencing remains unchanged.
- Maps `registrar_resultado` into the canonical analyzed event identity
  `retell:call_analyzed:<provider_call_id>`, including `nulo -> null`. The shared
  PostgreSQL event path now applies same-call analyzed first-writer-wins across
  tool-first, webhook-first, exact replay, and changed replay.
- No tool writes Google, sends an outbound message, creates payment proof, calls
  Stripe, or performs another direct effect.

## RED evidence

1. Agent A/B ordering boundary:
   `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-tools-commit-effects.test.ts -t 'projects once after contact details arrive|does not let an older accepted outbound'`
   - 2 failed: existing Agent A writes persisted source orders `4` and `2`
     instead of the required even positions `8` and `4`.
2. Safe-integer ordering bound:
   `npm test -- tests/unit/projection/projection-idempotency.test.ts -t 'rejects Agent A source orders'`
   - 1 failed before the bounded mapping helper existed.
3. Shared P0 application boundary:
   `npm test -- tests/unit/calls/retell-tools.test.ts`
   - The first run failed because the new module did not exist; after the
     minimal boundary scaffold, 11/11 contract tests failed with the deliberate
     `NOT_IMPLEMENTED` result.
4. Agent B odd-position mapping:
   `npm test -- tests/unit/projection/projection-idempotency.test.ts -t 'maps Agent B immediately after'`
   - 1 failed before the Agent B mapping helper existed.
5. PostgreSQL contact/result behavior:
   `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-tools.test.ts`
   - 3/3 failed against the minimal adapter: correlated contact persistence was
     a no-op, incomplete-data signaling was wrong, and changed analyzed replay
     raised a conflict instead of applying first-writer-wins.
6. Frozen course identity:
   the same focused PostgreSQL command with the frozen-course assertion
   - 1 failed because a later mutable conversation selection was projected
     instead of the call snapshot's course.
7. Workspace isolation:
   the same focused PostgreSQL command with the cross-workspace read assertion
   - 1 failed because a valid call from another workspace could reach the
     configured workspace catalog.
8. Route structure:
   `npm test -- tests/unit/calls/retell-tool-routes.test.ts`
   - The suite failed while the four App Router modules were absent.

## GREEN evidence

- Focused P0/order unit set:
  `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm test -- tests/unit/calls/retell-tools.test.ts tests/unit/calls/retell-tool-routes.test.ts tests/unit/projection/projection-idempotency.test.ts`
  - 3 files, 30/30 passed.
- Focused PostgreSQL set:
  `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-tools.test.ts tests/integration/retell-call-lifecycle.test.ts tests/integration/agent-tools-commit-effects.test.ts`
  - 3 files, 23/23 passed.
- Full root unit/contract suite: 198 files passed, 2 skipped; 3,179 tests
  passed, 14 skipped, 7 todo; 0 failed.
- Root `npm run typecheck`: passed.
- Root `npm run lint`: passed with zero warnings.
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run build`:
  passed; the route manifest contains all four P0 paths.
- Botpress `npm --prefix botpress-agent run typecheck`: passed.
- Botpress `npm --prefix botpress-agent run check`: passed; valid with no errors
  or warnings.
- Botpress `npm --prefix botpress-agent run build`: passed.
- `git diff --check`: passed.

## Full integration-suite disclosure

`TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration`
was not fully green: 62 files passed and 2 failed; 471 tests passed, 4 failed,
and 1 skipped. The four exact failures are:

1. `tests/integration/delivery-attempt-fencing.test.ts` — `enqueues exactly one
   reported-payment row once the evidence exists, even under replay`
2. `tests/integration/delivery-attempt-fencing.test.ts` — `projects
   Decoración/6 cuotas once across confirmation, delivery replay and a later
   repeated turn`
3. `tests/integration/delivery-attempt-fencing.test.ts` — `keeps only the latest
   delivered proposal authoritative across repeated sweeps`
4. `tests/integration/conversation-pipeline-v1.test.ts` — `completes the governed
   sales journey with one offer, link and projection under replay/concurrency`

These assertions still inspect the pre-Task-1 wide Sheet payload. They expect
removed fields such as `estado_alta`, `estado_pago`, `etapa_comercial`, `plan`,
`ultima_senal`, `email`, and `curso_interes`, or SQL-extract those old keys and
therefore receive `null`. The actual rows are the approved exact Task-1 shape:
`nombre`, `apellido`, `mail`, and `tipo_de_curso`. The two-file reproduction was
24 passed and the same 4 failed. Those historical assertions were not rewritten
under Task 4.

## Self-review

- Authentication is performed on the bounded untouched bytes before JSON
  parsing; secrets, signatures, body data, transcripts, URLs, metadata, and PII
  are never logged or returned.
- The body reader bounds actual streamed bytes independently of `Content-Length`.
  Every accepted string/array is bounded, top-level and argument objects are
  strict, and ignored call fields cannot influence execution.
- Correlation uses Task 3's Retell-only store plus an active workspace/contact
  membership proof. Arbitrary payload IDs cannot select a different tenant,
  contact, conversation, or provider.
- Catalog and offer tools use only canonical bounded views. They fail closed on
  ambiguity, suspected injection, truncation, non-assertable pricing, missing
  payment configuration, or incoherent totals/currencies.
- Contact writes lock and update only the correlated, non-deleted contact in the
  same transaction as outbox convergence. Omitted fields merge, the channel
  phone is untouched, and the call snapshot freezes the projected course.
- The projection helpers reject negative, fractional, non-finite, and overflow
  source positions. Existing source-less behavior in the shared projection
  service is unchanged.
- The analyzed-event exception is deliberately narrow: provider `retell`, event
  type `analyzed`, exact canonical `retell:call_analyzed:` identity, and the same
  call. Cross-call reuse and changed replays for all other events still raise
  conflicts. The database uniqueness constraint makes concurrent first writes
  deterministic.
- `registrar_resultado` invokes only canonical append/recompute; a reported
  `venta_confirmada` cannot establish verified payment or directly enqueue a
  Sheet/outbound/payment action.
- Each `route.ts` exports only `runtime` and `POST`. No migrations, prompts,
  naturality, seven non-P0 tools, supplied export, Retell publish/import, live
  call, external API, deployment, or secret material changed.

## Files

- `src/app/retell/tools/consultar-curso/route.ts`
- `src/app/retell/tools/consultar-oferta/route.ts`
- `src/app/retell/tools/guardar-datos-contacto/route.ts`
- `src/app/retell/tools/registrar-resultado/route.ts`
- `src/app/retell/tools/route-handler.ts`
- `src/features/calls/adapters/postgres-call-store.ts`
- `src/features/calls/adapters/postgres-retell-tools.ts`
- `src/features/calls/application/retell-tools.ts`
- `src/features/conversation/application/commit-agent-turn-v3.ts`
- `src/lib/services/projection.service.ts`
- `tests/integration/agent-tools-commit-effects.test.ts`
- `tests/integration/retell-tools.test.ts`
- `tests/unit/calls/retell-tool-routes.test.ts`
- `tests/unit/calls/retell-tools.test.ts`
- `tests/unit/projection/projection-idempotency.test.ts`

## Concerns / follow-up

- The four stale integration assertions above should be reconciled with the
  approved Task-1 four-column contract in a separately authorized maintenance
  task; Task 4 intentionally did not restore forbidden wide Sheet fields.
- The native Supabase reset loop remains blocked in the pre-existing
  `20260623000005_message_embeddings.sql` path because `extensions.vector` is
  unavailable. Per the controller ruling, Task 4 used the already initialized
  disposable PostgreSQL database on loopback port 55433 and did not repair or
  reset that unrelated migration path.
- No live Retell request or external effect was attempted. Production still
  requires `RETELL_API_KEY`, `RETELL_TOOLS_SECRET`, canonical workspace config,
  and optional Sheets projection config.
