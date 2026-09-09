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

## Fix round 1 — revisión NOT APPROVED

### Hallazgos corregidos

- `registrar_resultado` y `call_analyzed` ahora tienen identidades durables independientes (`retell:tool:call_analyzed:<provider_call_id>` y `retell:webhook:call_analyzed:<provider_call_id>`). Ambos hechos se conservan; la convergencia ordena siempre webhook antes que tool y completa campo por campo sin depender del último payload recibido.
- La proyección de `venta_confirmada` consulta pagos canónicos `paid` ligados al workspace canónico y contacto de la llamada. Sin esa prueba, `call_sessions.result` queda `NULL`; el claim queda únicamente en el evento de análisis acotado y no llega como venta a Agent A.
- La resolución de workspace exige una única membresía/estado activo candidato. La convergencia de email, el outbox de Sheets y el sweep de follow-up fallan cerrado ante dos workspaces y nunca eligen el más reciente.
- La detección de análisis completo reconoce cualquier campo extendido (no solo cinco booleanos), conserva los 14 campos conocidos y mantiene la forma legacy cuando solo llegan los campos legacy. `CallResultSchema` y `registrar_resultado` incluyen `buzon_de_voz` y `corto_la_llamada`.
- Email y Sheet convergen dentro de la misma transacción y en el orden `outbox fence → contacto`. Un evento atrasado rechazado por el fence no muta el contacto; sin destino de Sheet no se actualiza PII.
- `pidio_no_contactar` se evalúa antes de `cancelled`, por lo que revoca incluso una llamada cancelada.

### RED → GREEN de la ronda

Se agregaron primero pruebas unitarias RED para la precedencia/merge de fuentes, DNC sobre cancelación y los dos outcomes faltantes. Luego se agregaron pruebas PostgreSQL para tool-first → webhook completo (14 campos, email y DNC), replays alternados, venta sin pago, workspace ambiguo, y análisis atrasado frente a un orden de Sheet más nuevo de Agent A.

Pruebas focales unitarias:

```text
8 files passed — 108 tests passed
```

Pruebas focales PostgreSQL en `127.0.0.1:55435`:

```text
4 files passed — 30 tests passed
```

Checks adicionales:

```text
npm run typecheck        passed
npm run lint -- --quiet  passed
git diff --check         passed
```

### Archivos tocados en Fix round 1

- `src/features/calls/domain/call-state.ts`
- `src/features/calls/domain/post-call-followup.ts`
- `src/features/calls/adapters/postgres-call-store.ts`
- `src/features/calls/adapters/postgres-post-call-followup-store.ts`
- `src/features/calls/adapters/retell-lifecycle.ts`
- `src/features/calls/application/retell-tools.ts`
- `tests/unit/calls/retell-post-call-analysis.test.ts`
- `tests/unit/calls/retell-tools.test.ts`
- `tests/unit/calls/retell-webhook.test.ts`
- `tests/integration/retell-tools.test.ts`
- `tests/integration/post-call-followup.test.ts`

No migration, deploy, push, merge, or network/provider call was performed.

## Fix round 2 — revisión cerrada

### RED → GREEN

Se agregaron primero los casos RED de export webhook parcial, `registrar_resultado` parcial y precedencia webhook sobre el evento legacy compartido. La ronda también cubre null en los enums requeridos, el fixture legacy real con `objecion_principal`, replay del mismo tool con reloj avanzado, compatibilidad de pago Telegram y la reserva E2E por Agent A.

### Hallazgos corregidos

- El sweep de Retell queda cercado por el hecho webhook autoritativo `retell:webhook:call_analyzed:<provider_call_id>`; no emite outbound post-call antes de ese hecho. La señal `pidio_no_contactar` de cualquier análisis durable conserva la revocación monotónica y puede revocar un contacto aunque todavía falte el webhook.
- `venta_confirmada` solo se proyecta como venta cuando existe un pago `paid` del workspace/contacto ligado a esa llamada por `retell:payment:<callId>:`. `verifyPayment` usa el mismo vínculo; Telegram conserva su semántica histórica sin filtro Retell.
- La migración aditiva `20260909000004_retell_call_workspace_binding.sql` agrega `call_sessions.workspace_id` con FK e índice, backfill únicamente para candidatos únicos, reserva nueva con binding canónico y binding tardío legacy dentro del lock. El trigger permite solo el primer `NULL → workspace_id` validado contra el candidato único; después el tenant es inmutable. Guards, follow-up, email y payment usan el valor ligado.
- Webhook > evento legacy compartido > tool; dentro de un mismo rango no hay desempate lexicográfico. El hash semántico de tool omite solo `occurred_at`, por lo que el mismo payload con reloj distinto es duplicate y un cambio semántico sigue siendo conflicto.
- La forma legacy real permanece compatible: `call_summary` solo y `objecion_principal` legacy no activan el conjunto completo. Si aparece un campo extendido, webhook y tool exigen los siete requeridos (`objecion_principal`, `nivel_interes`, cinco booleanos); enum requerido `null`/ausente falla, mientras `false`, `nulo` y `ninguna` conservan su semántica válida.
- `appendEvent` serializa por `call_sessions ... FOR UPDATE`, haciendo durable el merge frente a tool/webhook concurrentes. La prueba E2E entra por `commitAgentDecision`/`reserveCallForDecision` real de Agent A, despacha Retell, procesa tool + webhook completos, recomputa, ejecuta follow-up una vez y verifica el outbox de Sheets.

### Evidencia

Migración aplicada exitosamente en `postgresql://postgres@127.0.0.1:55435/studyx_test` (incluida la función/trigger de binding validado).

```text
Unit focal: 8 files passed, 114 tests passed
PostgreSQL focal: 4 files passed, 30 tests passed
npm run typecheck: passed
npm run lint: passed
git diff --check: passed
```

Archivos adicionales de esta ronda: `supabase/migrations/20260909000004_retell_call_workspace_binding.sql`, los guards/adapters de calls, `request-call.ts`, contratos de análisis, tests focales y este reporte. No hubo prompts/naturalidad, red externa, deploy, push ni merge.

### Límites residuales

Sesiones legacy con workspace ambiguo o sin candidato siguen `NULL` y fallan cerrado; no se elige otro tenant aunque cambien membresías. El sweep de Retell espera webhook salvo una revocación DNC durable. La evidencia de pago sigue siendo exclusivamente el ledger canónico call-specific para Retell.
