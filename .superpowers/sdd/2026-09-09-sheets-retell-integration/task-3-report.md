# Task 3 report — verified Retell webhook and canonical lifecycle

## Status

Complete.

- Implementation commit: `10d9eb81b8f8d5ba83e5e3e0f2de6263f3c226b5`
  (`feat(calls): ingest verified Retell lifecycle events`).
- Independent-review corrective commit: `f52e2d6ae35d16107997f87514849f174b84f918`
  (`fix(calls): bound Retell webhooks and preserve lifecycle races`).

## Scope delivered

- Added the exact public App Router endpoint `POST /retell/eventos`.
- Enforces a documented 256 KiB raw-byte cap while reading the request stream,
  independent of absent or misleading `Content-Length`, before authentication,
  JSON parsing, correlation, or persistence.
- Verifies the untouched request text before JSON parsing with
  `X-Retell-Signature: v=<timestamp_ms>,d=<hex_hmac>`, HMAC-SHA256 over
  `raw_body + timestamp`, `RETELL_API_KEY`, five-minute tolerance, and
  timing-safe digest comparison.
- Strictly accepts the Retell wrappers `call_started`, `call_ended`, and
  `call_analyzed`; malformed wrappers fail closed.
- Resolves only existing `provider='retell'` sessions by the persisted provider
  call ID or by the exact internal/contact/conversation metadata triple. Both
  paths must resolve the same row. A missing provider ID is attached atomically
  only while `dispatching` or `dispatch_ambiguous`.
- If a webhook wins the create/attach race, the original dispatch accepts the
  same provider ID idempotently without reverting `in_progress`, `completed`,
  `no_answer`, or `timed_out` state or rewriting lifecycle timestamps. Different
  IDs and failed/cancelled sessions remain fenced.
- Maps provider callbacks into the existing canonical append/recompute path
  with stable event IDs, provider timestamps, sequences 1/2/3, deterministic
  disconnection classification, and nonnegative duration.
- Persists only canonical started, ended, and structured analysis fields. Test
  fixtures prove transcript, recording, and public-log data are discarded.
- Extended the canonical and Botpress result schemas for `buzon_de_voz` and
  `corto_la_llamada`; both have explicit safe post-call policies that cannot
  claim a sale or verified payment.
- Made terminal state projection independent of a delayed `started` event, and
  classifies voicemail as a retryable no-answer terminal state.

## RED evidence

1. `npm run test:unit -- tests/contract/call-event-schema.test.ts tests/unit/calls/post-call-followup.test.ts`
   - 4 failed, 33 passed.
   - Proved both supplied Retell outcomes were rejected and fell through to the
     generic policy.
2. `npm run test:unit -- tests/unit/calls/retell-webhook.test.ts`
   - 1 failed suite; the webhook application module did not exist.
   - Proved the new authenticated adapter boundary was absent before implementation.
3. `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-call-lifecycle.test.ts`
   - 1 failed, 2 passed.
   - Reproduced the persistence-level out-of-order defect: `ended` before
     `started` projected `failed`, then the terminal immutability trigger
     rejected the late start.
4. `npm run test:unit -- tests/unit/calls/call-state.test.ts`
   - 1 failed, 3 passed.
   - Isolated the incorrect hangup-with-delayed-start projection.
5. `npm run test:unit -- tests/unit/calls/retell-webhook.test.ts`
   - 1 failed, 27 passed.
   - Proved `registered_call_timeout` was incorrectly treated as in-call timeout
     rather than failed-to-connect.
6. Independent review, oversized-body cycle:
   `npm run test:unit -- tests/unit/calls/retell-webhook.test.ts`
   - 3 failed, 28 passed.
   - Oversized signed, unsigned, and streamed misleading-length requests
     returned 400/401 rather than 413, proving the missing pre-parse byte bound.
7. Independent review, create/attach race cycle:
   `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-call-lifecycle.test.ts`
   - 2 failed, 3 passed.
   - Both authenticated `call_started` and `call_ended` races advanced the real
     session but made the paused dispatch incorrectly return
     `dispatch_ambiguous`.
8. Independent review, different-provider-ID fence:
   `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/retell-call-lifecycle.test.ts`
   - 1 failed, 5 passed.
   - A dispatching row with an existing different provider ID was overwritten
     instead of rejected.

## GREEN evidence

- Focused result/schema policy: 37/37 passed.
- Focused Retell webhook adapter/application: 32/32 passed.
- Focused call-state projection: 4/4 passed.
- Focused Retell PostgreSQL lifecycle: 6/6 passed.
- Relevant PostgreSQL integration set (`retell-call-lifecycle`, `call-store`,
  `post-call-followup`): 12/12 passed on disposable loopback PostgreSQL port 55433.
- Full root unit/contract suite: 3,163 passed, 12 skipped, 7 todo; 0 failed.
- Root `npm run typecheck`: passed.
- Root `npm run lint`: passed with zero warnings.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run build`:
  passed; Next.js route manifest contains `ƒ /retell/eventos`.
- Botpress `npm run typecheck && npm run check`: passed; ADK reported `valid: true`,
  no errors or warnings.
- `git diff --check`: passed.

The first build attempt compiled and typechecked successfully but page-data
collection stopped because the repository requires `DATABASE_URL` for an
unrelated payment route. The successful build used the repository-approved
loopback-only placeholder and made no external connection or side effect.

## Self-review

- Signature verification occurs before `JSON.parse`, uses the configured Retell
  API key (not the tool secret), rejects stale/future/malformed signatures, and
  never logs the body, digest, key, transcript, URLs, metadata, or PII.
- The body reader counts streamed bytes and cancels as soon as the cap is
  exceeded. Tests cover signed and unsigned bodies, absent and dishonest length
  headers, and a UTF-8 code point split across chunks to prove HMAC verification
  uses the untouched bytes.
- Correlation cannot create sessions or select contacts from arbitrary payload
  IDs. Cross-provider IDs, partial metadata, mismatched tenant IDs, conflicting
  provider IDs, and invalid attach states return non-2xx before append.
- PostgreSQL concurrency tests pause provider creation, deliver an authenticated
  webhook through the canonical application on an independent connection, then
  resume the provider. Dispatch returns the exact accepted ID while the session
  and its timestamps remain byte-for-byte unchanged from the webhook-advanced
  state.
- Identical retries use the same `(event, provider_call_id)` identity and
  provider timestamp. PostgreSQL proves duplicates are no-ops and changed
  replays conflict.
- Authentication, validation/correlation, replay conflict, and persistence
  failures return explicit non-2xx statuses. A 204 is returned only after the
  canonical append/recompute path records or proves the duplicate.
- App Router module exports only `runtime` and `POST`; the production build
  validates the public route.
- No migration, Agent A naturality, Sheets behavior, Task 4 tool route, Task 5
  delivery path, supplied export, dashboard, external API, live call, or publish
  action was changed.

## Files

- `src/app/retell/eventos/route.ts`
- `src/features/calls/adapters/retell-lifecycle.ts`
- `src/features/calls/adapters/postgres-call-store.ts`
- `src/features/calls/application/retell-webhook.ts`
- `src/features/calls/domain/call-state.ts`
- `src/features/calls/domain/post-call-followup.ts`
- `src/features/calls/ports/retell-call-correlation-store.ts`
- `src/lib/contracts/call-event.ts`
- `botpress-agent/src/schemas/call-events.ts`
- `tests/unit/calls/retell-webhook.test.ts`
- `tests/unit/calls/call-state.test.ts`
- `tests/unit/calls/post-call-followup.test.ts`
- `tests/contract/call-event-schema.test.ts`
- `tests/integration/retell-call-lifecycle.test.ts`

## Concerns / follow-up

- No live Retell webhook smoke was attempted. Production still needs the
  webhook-enabled `RETELL_API_KEY` and the configured public hostname; this does
  not weaken the deterministic local proof.
- Retell documents that custom post-call analysis fields may be absent on calls
  with no conversation. In that case the authenticated `call_analyzed` wrapper
  is rejected as incomplete, while the preceding canonical `call_ended` remains
  durable and drives the safe technical follow-up. A future explicit
  analysis-failed event contract could acknowledge that callback without
  inventing a commercial result.
