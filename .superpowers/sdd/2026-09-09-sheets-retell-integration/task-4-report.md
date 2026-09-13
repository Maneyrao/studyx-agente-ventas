# Task 4 report — Retell P0 tools and complete-lead convergence

## Status

Complete.

- Implementation commit: `9bf3c37b8592696e937c3f7a101803b8deef3613`
  (`feat(calls): add authenticated Retell P0 tools`).
- Independent-review corrective commit:
  `f850cf1974b43e412a44a3432b30a0be9794e333`
  (`fix(calls): harden Retell tool convergence`).
- Re-review catalog-boundary corrective commit:
  `41bb0d950a417acca3a0ec3f2b6eea08389774f4`
  (`fix(calls): reject padded Retell catalog identities`).

## Scope delivered

- Added the exact public App Router endpoints:
  - `POST /retell/tools/consultar-curso`
  - `POST /retell/tools/consultar-oferta`
  - `POST /retell/tools/guardar-datos-contacto`
  - `POST /retell/tools/registrar-resultado`
- Added one shared 32 KiB streamed-body boundary with dual authentication:
  untouched raw-body Retell HMAC using `RETELL_API_KEY` and a separately hashed,
  timing-safe `x-studyx-tools-secret` comparison using `RETELL_TOOLS_SECRET`.
  Missing/invalid tool secrets and missing/malformed/stale signature headers are
  rejected before consuming the body. A syntactically current signature on an
  oversized body receives transport `413`, because its digest cannot be fully
  verified without exceeding the byte cap.
- Strictly validates `{name, call, args}`, exact route/name pairing, the exact
  metadata UUID trio, bounded P0 argument contracts, and the required Retell
  `call_id`. Extra top-level/argument keys fail closed; non-contract call data is
  discarded.
- Resolves Task 3 Retell correlation and proves the resolved call belongs to the
  configured active workspace inside the same locked transaction, before an
  unbound provider call ID, dispatch state, lease, error, or timestamp can be
  mutated and before every read or write tool runs.
- Resolves the entire normalized course input by exact safe code, display name,
  or owner alias. Optional academy is a mandatory exact filter. Raw codes,
  display names, academies, and aliases are independently bounded and validated
  in their raw representation before the canonical view. Leading/trailing
  padding, overlength, controls, malformed values, or instruction-like
  identities fail closed rather than relying on the builder's trimmed value or
  injection tally. Unknown,
  ambiguous, typo, promotion-suffixed, or truncated requests return a strict
  error without an LLM.
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
  and a later A write wins. A non-visible bounded `source_key` permits an
  equal-order correction only from the exact same trusted Agent A turn or
  correlated Retell call; a different key at the same position loses.
  Source-less legacy fencing remains unchanged.
- Row allocation is serialized per spreadsheet/tab inside a transaction. The
  insert uses a savepoint so a mixed-version unique collision can be retried
  without leaving the containing contact transaction aborted.
- Maps `registrar_resultado` into the canonical analyzed event identity
  `retell:call_analyzed:<provider_call_id>`, including `nulo -> null`. The shared
  PostgreSQL event path now applies same-call analyzed first-writer-wins across
  tool-first, webhook-first, exact replay, and changed replay. Prefix-only or
  wrong-suffix event IDs retain the normal changed-replay conflict.
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
9. Independent-review unit boundary:
   `npm test -- tests/unit/calls/retell-tools.test.ts`
   - 9 failed and 14 passed. Oversized missing/malformed signature requests
     returned `413`; wrong-academy and promotion-suffixed requests resolved;
     five malformed, overlong, control-bearing, or instructional raw catalog
     identities escaped; and an unsafe offer was returned.
10. Independent-review PostgreSQL boundary:
    `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-tools.test.ts`
    - 5 failed and 2 passed. A same-call correction updated the contact but not
      the Sheet row; unbound foreign `dispatching` and `dispatch_ambiguous`
      calls were attached before rejection; a forced two-client row-number
      collision rolled back one complete contact transaction; and an analyzed
      event with only the canonical prefix incorrectly received
      first-writer-wins.
11. Re-review raw identity padding boundary:
    `npm test -- tests/unit/calls/retell-tools.test.ts`
    - 3 failed and 25 passed. A display name containing 100,000 trailing spaces
      was returned successfully as a 100,012-character `curso.nombre`; a
      leading-padded academy and trailing-padded alias were also accepted after
      the builder trimmed them.

## GREEN evidence

- Focused P0/order unit set:
  `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm test -- tests/unit/calls/retell-tools.test.ts tests/unit/calls/retell-tool-routes.test.ts tests/unit/projection/projection-idempotency.test.ts`
  - 3 files, 41/41 passed.
- Focused corrective PostgreSQL boundary:
  `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-tools.test.ts`
  - 7/7 passed, including two independent database clients forced into the
    same empty-sheet allocation window.
- Re-review Retell tool boundary:
  `npm test -- tests/unit/calls/retell-tools.test.ts`
  - 28/28 passed. The adversarial matrix covers leading/trailing raw padding,
    overlength display names and codes, and leading/trailing control characters.
- Re-review `npm run typecheck`: passed.
- Focused PostgreSQL set:
  `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-tools.test.ts tests/integration/retell-call-lifecycle.test.ts tests/integration/agent-tools-commit-effects.test.ts`
  - 3 files, 27/27 passed.
- Full root unit/contract suite: 198 files passed, 2 skipped; 3,190 tests
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
was not fully green: 62 files passed and 2 failed; 475 tests passed, 4 failed,
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

- Clear secret/header auth failures are rejected before the body read. For a
  bounded body, full HMAC authentication is performed on untouched bytes before
  JSON parsing. A current, syntactically valid header whose body exceeds the cap
  receives the documented transport `413`; it cannot reach parsing,
  correlation, or a tool. Secrets, signatures, body data, transcripts, URLs,
  metadata, and PII are never logged or returned.
- The body reader bounds actual streamed bytes independently of `Content-Length`.
  Every accepted string/array is bounded, top-level and argument objects are
  strict, and ignored call fields cannot influence execution.
- Tool correlation uses a specialized Task 3-compatible Retell-only operation.
  The call row is locked and active workspace/contact membership is proven in
  that transaction before any permitted attach. PostgreSQL tests compare every
  provider ID, status, lease, error, and lifecycle/update timestamp before and
  after foreign-workspace rejection.
- Catalog identities are validated from the raw rows before a view can copy
  them. A safe raw label is at most 128 characters, already trimmed, unchanged
  by control/fence sanitization, injection-free, and limited to the accepted
  label alphabet. Thus the original `curso.nombre`, code, or academy can be
  returned only after validating the same representation; aliases are used
  only for matching and never returned. Matching is whole normalized-string
  equality only; academy narrows the result exactly and homonyms without one
  remain ambiguous. Catalog and offer tools also fail closed on suspected
  injection, truncation, non-assertable pricing, missing payment configuration,
  or incoherent totals/currencies.
- Contact writes lock and update only the correlated, non-deleted contact in the
  same transaction as outbox convergence. Omitted fields merge, the channel
  phone is untouched, and the call snapshot freezes the projected course.
- The projection helpers reject negative, fractional, non-finite, and overflow
  source positions and invalid source keys. Equal-order changes require the
  persisted trusted source key to match. The advisory allocator lock covers the
  entire root or caller-owned transaction; savepoint retry cannot poison it.
  Existing source-less behavior and the visible four-field payload are
  unchanged.
- The analyzed-event exception is deliberately narrow: provider `retell`, event
  type `analyzed`, the same call, and event ID exactly equal to
  `retell:call_analyzed:<that call's persisted provider_call_id>`. Cross-call,
  prefix-only, wrong-suffix, and all other changed replays still raise
  conflicts. The database uniqueness constraint makes concurrent first writes
  deterministic.
- `registrar_resultado` invokes only canonical append/recompute; a reported
  `venta_confirmada` cannot establish verified payment or directly enqueue a
  Sheet/outbound/payment action.
- Each `route.ts` exports only `runtime` and `POST`. One additive PostgreSQL
  migration adds only the non-visible projection `source_key`; no prompts,
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
- `src/features/calls/ports/retell-call-correlation-store.ts`
- `src/features/conversation/application/commit-agent-turn-v3.ts`
- `src/lib/services/projection.service.ts`
- `supabase/migrations/20260909000002_sheet_projection_source_identity.sql`
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
