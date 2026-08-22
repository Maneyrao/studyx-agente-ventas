# Agent A Operational MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar Agent A funcionando con baja latencia, memoria completa, envío seguro de los tres links Stripe y actualización idempotente de Google Sheets; Retell queda limitado a un smoke hipotético.

**Architecture:** Botpress decide conversaciones y ejecuta el envío; Next.js valida acciones y mantiene la fuente de verdad en Supabase. Una acción tipada `send_payment_link` selecciona un código, el backend deriva la URL canónica y la entrega confirmada encola una proyección a Google Sheets. Memoria y KB usan el mismo PostgreSQL con pgvector y un embedding compartido por claim.

**Tech Stack:** Next.js 16, TypeScript, Zod, PostgreSQL/Supabase/pgvector, Botpress ADK, Gemini Embedding 2, Google Sheets API, Stripe Payment Links, Vitest.

**Spec:** `docs/contracts/agent-a-operational-mvp.md`

## Global Constraints

- Retell no se instala, configura ni implementa.
- Cada worker lee sólo este contrato y su allowlist; sin Spec Kit, `grep -r`, specs históricas ni otros planes.
- Branch desde HEAD `417aa05`, no desde `736cc36`; respaldar en `origin` y `personal` antes de editar producción code.
- Sin worktrees nuevos. Agentes paralelos no hacen commits ni instalaciones; el coordinador commitea allowlists en serie.
- TDD focal por tarea; suite completa una sola vez en auditoría.
- No tocar Production hasta que los diez smokes locales estén verdes.
- Secretos fuera de argv, logs, prompts, tests y Git.

## Olas y modelos

```text
Ola 0  Coordinador: branch, backup, dependencias, baseline
Ola 1  A1 memoria/runtime || A2 pago tipado || A3 Sheets
Ola 2  A4 integración workflow/latencia
Ola 3  A5 smokes || A6 auditoría/GitHub
```

A1, A2 y A4 usan modelo fuerte. A3, A5 y A6 usan modelo económico. `/clear` entre agentes.

---

### Task 0: Baseline y respaldo

**Files:**
- Commit: `docs/contracts/agent-a-operational-mvp.md`
- Commit: `docs/superpowers/plans/2026-08-22-agent-a-operational-mvp.md`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: branch `feat/agent-a-operational-mvp` respaldada y dependencias disponibles.

- [ ] Crear `feat/agent-a-operational-mvp` desde `417aa05`; preservar los artefactos untracked del usuario sin agregarlos.
- [ ] Commit de los dos documentos: `docs: define agent a operational mvp`.
- [ ] Push inmediato a `origin` y `personal`; comprobar el mismo SHA.
- [ ] Instalar una sola vez `googleapis`; no instalar Stripe SDK nuevo ni ExcelJS.
- [ ] Ejecutar baseline: root typecheck/unit, Botpress typecheck/check y conteos DB sin PII.
- [ ] Registrar evidencia esperada: Agent A suprimido si `automationEnabled=false`, Gemini 401 si la key sigue inválida, 23 knowledge jobs pending y 0 chunks.

### Task 1: A1 — Recuperar runtime y memoria

**Files:**
- Modify: `.env.example`, `.env.local.example`
- Modify: `src/features/observability/adapters/probes.ts`
- Modify: `vercel.json`
- Modify: `botpress-agent/src/conversations/router.conversation.ts`
- Modify: `botpress-agent/src/utils/http.ts`
- Test: `tests/integration/health-readiness.test.ts`
- Test: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`

**Interfaces:**
- Produces: readiness real de Gemini/backlogs y runtime Botpress reproducible.

- [ ] Escribir RED: 401 Gemini es `unavailable`; backlog de 23 no es `ok`; timeout ausente usa 8000 ms; callback no-message no entra al dispatcher.
- [ ] Reemplazar referencias OpenAI por `GEMINI_API_KEY`; el probe ejecuta un smoke acotado y reporta status/epoch sin exponer key.
- [ ] Agregar diagnóstico para knowledge, selected-memory y message queues: estados, oldest age y epoch coverage.
- [ ] Restaurar schedules compatibles con el plan Vercel vigente para workers bounded; si Hobby sólo admite diario, documentar el runner manual como camino inmediato.
- [ ] Fijar una combinación ADK/Telegram que permita `adk check`, `build` y `dev` desde generado limpio; prohibido parchear `.adk`.
- [ ] Con key válida exigir vector finito 768; drenar los tres runners y verificar 23 fuentes materializadas.
- [ ] Activar `automationEnabled=true` sólo en Development y observar una decisión distinta de `AUTOMATION_DISABLED`.
- [ ] Ejecutar typechecks y los dos tests focales una vez; coordinador commitea `fix: restore agent a runtime and memory`.

### Task 2: A2 — Acción tipada de link de pago

**Files:**
- Create: `src/features/payments/domain/payment-link.ts`
- Create: `src/features/payments/domain/payment-choice-policy.ts`
- Create: `src/features/payments/adapters/config-payment-link.resolver.ts`
- Create: `src/features/payments/application/materialize-payment-link-action.ts`
- Modify: `src/features/orchestration/domain/decision-v4.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/prompts/agent-a-sales-bridge.ts`
- Test: `tests/unit/payments/payment-link.test.ts`
- Test: `tests/unit/orchestration/decision-v4-policy.test.ts`
- Test: `tests/unit/botpress/agent-a-sales-bridge-prompt.test.ts`

**Interfaces:**
- Produces: `PaymentPlanCode`, `PaymentLinkResolver.resolve(planCode)`, `SendPaymentLinkAction`, `materializePaymentLinkAction`.

- [ ] Escribir RED para tres planes, elección ambigua, URL ausente, plan inválido, fallback cruzado, link libre en model response y acción sobre contacto no contactable.
- [ ] Derivar `allowed_payment_plan` únicamente de una elección explícita del batch actual; no usar memoria, resumen, tono ni una elección de un turno anterior.
- [ ] Añadir a v4 `{type:'send_payment_link',plan_code,offering_sku}`; `offering_sku` es string canónico o null y no admite URL, monto ni identidad.
- [ ] El prompt deja de pedir que el modelo copie URLs: emite la acción sólo tras elección explícita y mantiene el resto de la respuesta sin link.
- [ ] Resolver las tres URLs exclusivamente desde env; configuración parcial falla cerrada.
- [ ] Materializar un bloque fijo con plan/link después de revalidar el business snapshot; una lectura DB adicional sólo en esta acción.
- [ ] Ejecutar typechecks y tres tests focales una vez; coordinador commitea `feat: add canonical payment link action`.

### Task 3: A3 — Google Sheets como proyección

**Files:**
- Create: `src/lib/providers/sheets/sheets-provider.ts`
- Create: `src/lib/providers/sheets/google-sheets-provider.ts`
- Create: `src/lib/providers/sheets/fake-sheets-provider.ts`
- Create: `src/lib/services/projection.service.ts`
- Create: `src/app/api/cron/flush-projections/route.ts`
- Create: `scripts/run-sheet-projections.ts`
- Test: `tests/unit/projection/projection-idempotency.test.ts`

**Interfaces:**
- Produces: `SheetsProvider.updateRow`, `enqueueLeadProjection`, `flushSheetProjections`.
- Consumes later: payment delivery/action desde A4.

- [ ] Escribir RED: replay 10x da una fila; dos contactos dan dos filas; edición humana `hecha_por_operador` se preserva; timeout deja outbox reintentable.
- [ ] Reutilizar `sheet_projection_rows`, `projection_key=lead:<workspace>:<contact>` y `row_number`; no crear tabla nueva.
- [ ] Implementar Google `spreadsheets.values.update`, nunca append; auth por ADC (`GOOGLE_APPLICATION_CREDENTIALS`) en local y client email/private key inyectados en Vercel.
- [ ] Implementar worker con lease, deadline, retry/backoff y `CRON_SECRET`; fake para tests.
- [ ] No escribir Sheets dentro de la transacción canónica ni antes de confirmación del canal.
- [ ] Ejecutar typecheck y test focal una vez; coordinador commitea `feat: project agent a sales state to sheets`.

### Task 4: A4 — Integrar decisión, delivery, batch y latencia

**Files:**
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Create: `src/features/orchestration/application/commit-claimed-decision.ts`
- Modify: `src/lib/config.ts`
- Modify: `botpress-agent/src/actions/commitDecision.ts`
- Create: `botpress-agent/src/actions/flushLeadProjection.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Test: `tests/integration/orchestration-lifecycle.test.ts`
- Test: `tests/integration/delivery-attempt-fencing.test.ts`
- Test: `tests/contract/botpress-response-parity.test.ts`

**Interfaces:**
- Consumes: materializador A2 y proyección A3.
- Produces: acción E2E, batch cerrado y Sheets post-delivery.

- [ ] Escribir RED: acción válida materializa sólo URL configurada; decisión/outbound son únicos; delivery fallido no marca link enviado; delivery confirmado encola una proyección; batch termina completed.
- [ ] Revalidar `send_payment_link` en backend y sustituir cualquier URL modelada por el bloque canónico antes de persistir.
- [ ] Guardar acción y plan en decisión/audit; no registrar link ni precio como memoria seleccionada.
- [ ] Tras `recordDeliveryReport(submitted_to_botpress)`, encolar la proyección `payment_link_sent`; no bloquear la respuesta.
- [ ] Botpress ejecuta `flushLeadProjection` después de createMessage/reportDelivery; si falla, el outbox queda para cron/runner.
- [ ] Extender commit con `batch_id` y `claim_token`; commit o replay exitoso intenta `completeBatch`. Fallo de cierre pausa sin duplicar decisión/outbound.
- [ ] Mantener hot path: cero catalog call, un embedding, ≤5 statements antes del modelo; la lectura de pago ocurre sólo para esa acción.
- [ ] Ejecutar typechecks y tres tests focales una vez; coordinador commitea `feat: execute agent a payment and projection workflow`.

### Task 5: A5 — Smokes operativos

**Files:**
- Create: `scripts/smoke-agent-a-operational.mjs`
- Create: `scripts/smoke-hypothetical-call.mjs`

**Interfaces:**
- Consumes: HTTP y canales públicos locales; no importa funciones internas.
- Produces: tabla de diez casos y métricas de latencia.

- [ ] Sembrar/limpiar sólo datos sintéticos en `127.0.0.1:55433/studyx_test`.
- [ ] Ejecutar por canal/API los casos 1–9 del contrato; medir event→decision y event→provider submission.
- [ ] Verificar el ciclo de memoria: candidato accepted/pending→ready y recuperación literal en turno 2.
- [ ] Verificar KB con una fuente conocida y los tres contadores: embedding=1, memory search=1, KB search=1.
- [ ] Verificar pago: URL exacta del plan elegido, replay sin duplicado y fake Sheets actualizado después de delivery.
- [ ] Smoke de llamada: fake provider, evento analyzed simulado y post-call existente; cero imports/credenciales Retell.
- [ ] Correr al menos 30 turnos controlados para gates p50/p95; exit 1 ante cualquier incumplimiento.
- [ ] Coordinador commitea `test: add agent a operational smokes`.

### Task 6: A6 — Auditoría y GitHub

**Files:**
- Modify: `SESSION.md`
- No production-code fixes.

**Interfaces:**
- Produces: evidencia final, branch en ambos remotos y PR.

- [ ] Auditar que no existan imports/configuración Retell nuevos ni secretos/artefactos generados en Git.
- [ ] Ejecutar una vez root typecheck/lint/unit/integration focal/build, Botpress check/typecheck/build y ambos smokes.
- [ ] Confirmar: Agent A responde; Gemini 768; 23 fuentes proyectadas; memoria turno 2; tres planes; una fila; batch completed; gates de latencia.
- [ ] Actualizar `SESSION.md` con SHAs, métricas y bloqueos externos exactos.
- [ ] Push a `origin` y `personal`; verificar SHA idéntico.
- [ ] Abrir PR contra `origin/main`, declarando los commits acumulados incluidos; no mergear automáticamente.

## Definition of Done

Después de ejecutar este plan sólo quedan pruebas conversacionales de agentes y tipos de clientes. No se considera terminado si falta alguna credencial requerida, si Google Sheets sólo está fake, si la memoria no se recupera en turno 2, si Botpress depende del shim `.adk`, si el link lo genera el modelo o si no se cumplen los gates de latencia.
