# Final review fix report — Retell + Sheets

Fecha: 2026-09-09. Base: `31d7ea4`. Branch: `codex/sheets-retell-integration`.

## Resultado

Se cerraron I1–I6 y M1–M2 en una única ola. No se modificaron prompts/naturalidad de Agent A, no se usaron credenciales, no hubo red, deploy, push, merge ni publicación.

## RED → GREEN

Se agregaron regresiones en `tests/unit/calls/retell-post-call-analysis.test.ts` y `tests/unit/calls/retell-final-review-regressions.test.ts`. La primera ejecución focal confirmó fallos funcionales para el DNC legacy y `call_summary` parcial (además de que el test nuevo de wiring inicialmente quedó bloqueado por el guard de `DATABASE_URL`, corregido al ejecutar con la URL local de pruebas; no se conectó a la base). Tras los cambios, las regresiones quedaron verdes.

## Cambios

- **I1:** `retell-lifecycle.ts` acepta `Positive/Neutral/Negative` y las normaliza al enum interno minúsculo; mantiene compatibilidad con fixtures minúsculos y rechaza valores desconocidos.
- **I2:** `mergeCallAnalyses`, la ingestión y las consultas de revalidación/sweep reconocen `resultado/result = no_contactar` como revocación monotónica, además de `pidio_no_contactar=true`. La revocación durable sigue siendo idempotente.
- **I3:** la proyección de análisis Retell solo usa la Sheet global cuando el slug canónico coincide con el workspace configurado; para otros workspaces solo conserva un destino ya ligado a su proyección o falla cerrado.
- **I4:** `route-handler.ts` ya no instala `FakePaymentProvider` ni `stripe_test` junto con outbound live. La dependencia de pago queda ausente y la tool responde fallo estructurado; fake permanece disponible para tests explícitos.
- **I5:** `postgres-call-store.ts` exige `offerings.status = active` y nombre canónico resuelto para una fila comercial; `curso_ofrecido`/código declarado por Retell ya no completa una proyección sin catálogo.
- **I6:** `enviar_link_pago` converge el email mediante la proyección durable Agent B y su fence antes de mutar `contacts`; un checkout fallido no muta PII y un replay viejo no pisa una proyección posterior de Agent A.
- **M1:** el trigger SQL de requests compara directamente `NEW.workspace_id` con el binding `call_sessions.workspace_id` (además de `call_id/contact_id`), sin autorizar por estados comerciales mutables.
- **M2:** validación y mapping de `registrar_resultado` comparten la misma clasificación legacy/extended; `call_summary` solo ya no atraviesa como legacy parcial.

## Archivos principales

- `src/features/calls/adapters/retell-lifecycle.ts`
- `src/features/calls/domain/call-state.ts`
- `src/features/calls/adapters/postgres-call-store.ts`
- `src/features/calls/adapters/postgres-post-call-followup-store.ts`
- `src/features/calls/adapters/postgres-retell-orchestration-store.ts`
- `src/features/calls/application/retell-tools.ts`
- `src/app/retell/tools/route-handler.ts`
- `src/features/calls/domain/retell-final-review-policy.ts`
- `supabase/migrations/20260909000003_retell_orchestration_requests.sql`
- `tests/unit/calls/retell-post-call-analysis.test.ts`
- `tests/unit/calls/retell-final-review-regressions.test.ts`

## Verificación

- `DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test npm test -- --run tests/unit/calls tests/unit/payments/payment-config.test.ts tests/unit/projection/projection-idempotency.test.ts` → **241 passed, 14 skipped; 22 files passed, 1 skipped**.
- `npm run typecheck` → **pass**.
- `npm run lint` → **pass**.
- `git diff --check` → **pass**.

La suite de integración PostgreSQL no se ejecutó porque `TEST_DATABASE_URL` no está configurada en este entorno; debe repetirla el coordinador. La suite unitaria sin `DATABASE_URL` también deja un test de importación dependiente de configuración; con la URL local aprobada de pruebas todos los tests focales pasaron.

## Concerns

- `stripe_live` continúa deshabilitado por el guard de configuración existente; por tanto el wiring Retell live permanece deliberadamente cerrado hasta una habilitación/revisión posterior.
- La prueba de aislamiento cruzado y la convergencia completa de I6 requieren la suite PostgreSQL focal del coordinador para validar triggers, leases y concurrencia real.
