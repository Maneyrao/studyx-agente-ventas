# Task 3 — Complete bounded post-call analysis and convergence

## Implementation

- Extended the canonical bounded call-analysis contract to carry the 14 fields from the brief/export shape: `call_summary`, `user_sentiment`, `resultado`, `curso_ofrecido`, `precio_ofrecido`, `objecion_principal`, `nivel_interes`, `email_capturado`, `link_pago_enviado`, `pago_confirmado`, `pidio_humano`, `pidio_no_contactar`, `pregunto_si_es_ia`, and `compromiso_pendiente`.
- Added strict type, enum, email, and length validation for the analysis fields. `objecion_principal` accepts the canonical domain values including `ninguna`; `resultado` remains the existing `CallResultSchema` enum.
- Kept the legacy event payload shape for old Retell payloads, while complete analysis payloads persist the named structured fields in the canonical `call_events.payload.analysis` JSON. Transcript, transcript objects, recording URLs, and other provider blobs are never copied into the canonical event.
- Tool-time `registrar_resultado` and webhook-time `call_analyzed` both use the existing canonical event/idempotency path. Replays re-run only idempotent convergence and never create another call event or Sheet projection row.
- `email_capturado` is applied only after resolving the call's canonical active workspace membership and correlated contact. The stable four-column lead outbox row is refreshed through `enqueueLeadProjection`, using the existing row target when configuration is absent; no cross-tenant contact mutation is possible through the Retell boundary.
- Follow-up selection now carries `pidio_no_contactar` from the canonical analyzed event. The existing revocation path runs before any post-call send, even if the analysis result says another follow-up outcome.
- Payment truth remains canonical: `pago_confirmado` and `venta_confirmada` prose do not create payment proof. The existing follow-up guard checks the workspace/contact payment ledger and degrades an unverified sale to the payment-pending message.

## RED evidence

Focused RED test added first in `tests/unit/calls/retell-post-call-analysis.test.ts`:

- complete analysis fields were absent from webhook mapping;
- invalid analysis enum/email was accepted;
- complete `registrar_resultado` arguments were rejected;
- `pidio_no_contactar` did not override a scheduled follow-up.

The initial run was 4 failing tests for those expected missing behaviors.

## GREEN evidence

Unit focal run:

```text
npm test -- --run tests/unit/calls/retell-post-call-analysis.test.ts tests/unit/calls/retell-tools.test.ts tests/unit/calls/retell-webhook.test.ts tests/unit/calls/retell-five-tools.test.ts tests/unit/calls/retell-tool-routes.test.ts tests/unit/calls/call-state.test.ts tests/unit/calls/post-call-followup.test.ts tests/unit/calls/record-call-event.test.ts

Test Files  8 passed (8)
Tests       105 passed (105)
```

PostgreSQL focal run on the disposable local cluster at `127.0.0.1:55435`:

```text
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test npm run test:integration -- tests/integration/retell-tools.test.ts tests/integration/retell-call-lifecycle.test.ts tests/integration/post-call-followup.test.ts tests/integration/retell-five-tools-postgres.test.ts

Test Files  4 passed (4)
Tests       26 passed (26)
```

The PostgreSQL coverage includes replay, out-of-order lifecycle arrival, cross-tenant correlation rejection, canonical payment truth, consent revocation before outbound, complete Agent A/call/analysis/follow-up/Sheet-outbox convergence, and the five-tool compatibility suite.

Additional checks:

```text
npm run typecheck        passed
npm run lint -- --quiet  passed
git diff --check         passed
```

## Files

- `src/lib/contracts/call-event.ts`
- `src/features/calls/adapters/retell-lifecycle.ts`
- `src/features/calls/application/retell-tools.ts`
- `src/features/calls/adapters/postgres-call-store.ts`
- `src/features/calls/adapters/postgres-post-call-followup-store.ts`
- `src/features/calls/application/post-call-followup.ts`
- `src/features/calls/domain/post-call-followup.ts`
- `src/features/calls/ports/post-call-followup-store.ts`
- `tests/unit/calls/retell-post-call-analysis.test.ts`
- `tests/integration/retell-tools.test.ts`
- `tests/integration/post-call-followup.test.ts`

No migration was required: the existing append-only `call_events.payload` JSON is the canonical structured analysis record, and the existing `sheet_projection_rows` outbox is the stable projection fence.

## Commits

- `7fd3b1ce50d806f863c38465db2da84255577b2e` — `feat(retell): persist bounded post-call analysis`
- Report commit follows after this report is added; no push, merge, deploy, or live provider call was performed.

## Limits / follow-up

- The Retell `user_sentiment` system preset is bounded to the lowercase domain enum `positive | neutral | negative`; unknown provider values fail closed.
- Conditional string fields may be absent when the export marks them conditional; required boolean values are accepted when present and never treated as payment evidence.
- The Sheet worker remains the existing derived outbox worker; this task only enqueues/converges its canonical row and does not make Google network calls.
- Live Retell credentials/publication, WhatsApp credentials, and production deployment remain outside this task and require the release checkpoint.
