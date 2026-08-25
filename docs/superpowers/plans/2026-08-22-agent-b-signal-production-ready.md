# SUPERSEDED — Agent B Buy Signal Production-Ready Implementation Plan

> **No ejecutar.** Retell fue retirado del alcance el 22-08-2026. Usar `docs/superpowers/plans/2026-08-22-agent-a-operational-mvp.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar hoy Agent A operativo con memoria y una señal de compra de Agent B que genere, entregue y audite el link de pago, además de actualizar un Excel local idempotente; después sólo quedarán matrices conversacionales y tipos de cliente.

**Architecture:** Retell/B emite una única señal autenticada. Next.js/Supabase la convierte en turno canónico y decisión determinística, resuelve el link, encola delivery y proyección; un worker de A usa Botpress para el envío físico. PostgreSQL sigue siendo la fuente de verdad; Botpress es el canal/orquestador conversacional y Excel es una proyección local reemplazable.

**Tech Stack:** Next.js 16, TypeScript, Zod, PostgreSQL/Supabase, Botpress ADK y `@botpress/client`, Gemini embeddings 768, Vitest, ExcelJS, Telegram Development.

**Spec:** `docs/contracts/agent-b-signal.md`

## Global Constraints

- No Spec Kit y ningún comando `/speckit-*`.
- Cada worker lee sólo el contrato y su allowlist. Prohibidos `grep -r`, `specs/`, `docs/superpowers/`, `README.md` y `SESSION.md`, salvo G4.
- Un branch: `feat/senal-compra-agente-b`; cero worktrees nuevos.
- Los agentes paralelos no ejecutan `git add`, `git commit` ni instalaciones. El coordinador revisa y commitea sus allowlists en serie para evitar carreras sobre `.git/index` y `package-lock.json`.
- TDD por tarea; cada agente corre typecheck y su suite focal una sola vez al final.
- Un agente no corrige el trabajo de otro. Dos bloqueos iguales implican parar y reportar.
- `/clear` entre agentes. G1 y G2-A usan modelo fuerte; los demás usan el modelo económico.
- Ningún secreto en argv, logs, commits o prompts. Rotar el token Telegram ya compartido antes de producción.
- No tocar producción durante smokes locales. `DATABASE_URL` debe apuntar a `127.0.0.1:55433/studyx_test`.
- El smoke no puede declarar entrega por encontrar una fila: requiere `provider_message_id` y `delivery_report`.

## Estado real de Git/GitHub al 22-08-2026

- HEAD local: `417aa05`, branch `codex/memory-latency-recovery`, sin upstream.
- `origin/main` y `personal/main`: `aaedd79`; HEAD está 50 commits adelante.
- `origin/feat/studyx-datos-y-sim-local` y `personal/...`: `736cc36`; HEAD está 16 commits adelante.
- `feat/senal-compra-agente-b` todavía no existe en ningún remoto.
- Existen artefactos untracked del usuario (`.jez/`, `botpress-agent/retell/`, tres JSON fuente y un plan previo). No agregarlos, moverlos ni borrarlos.
- El contrato y este plan son los únicos documentos nuevos autorizados para el primer commit.

## Orden y presupuesto de ejecución

```text
Ola 0  Coordinador: respaldo + P0 runtime                         45–90 min
Ola 1  G1 Contrato/dominio                                       30–45 min
Ola 2  G2-A Ingesta+delivery || G2-B Links || G2-C Excel          2–4 h
Ola 3  G3-A Runtime/simulador || G3-B Smokes                      1.5–3 h
Ola 4  G4 Auditoría, push y PR                                    45–75 min
```

La entrega hoy es viable sólo si están disponibles una key Gemini válida, las tres URLs ya aprobadas y credenciales Botpress Development. Retell, Meta, PSP y Google no bloquean.

---

### Task 0: Coordinación, respaldo y baseline

**Files:**
- Commit only: `docs/contracts/agent-b-signal.md`
- Commit only: `docs/superpowers/plans/2026-08-22-agent-b-signal-production-ready.md`

**Interfaces:**
- Consumes: HEAD local `417aa05`.
- Produces: branch respaldada en ambos remotos y baseline reproducible.

- [ ] Verificar que `git rev-parse HEAD` sea `417aa05...` y que `git merge-base --is-ancestor origin/main HEAD` termine 0.
- [ ] Crear `feat/senal-compra-agente-b` desde HEAD actual, nunca desde `736cc36`.
- [ ] Agregar sólo los dos documentos de esta tarea; comprobar con `git diff --cached --name-only` que no haya artefactos del usuario.
- [ ] Commit: `docs: define agent b buy signal contract`.
- [ ] Instalar juntos `@botpress/client@1.46.0` y `exceljs`, verificar un único cambio coherente de lockfile y commit: `chore: add signal delivery dependencies`.
- [ ] Push inmediato del branch a `personal` y `origin`; verificar que ambos SHA coincidan.
- [ ] Capturar baseline sin PII: `npm run typecheck`, `npm run test:unit`, `npm --prefix botpress-agent run typecheck`.
- [ ] Registrar conteos locales: 23 jobs KB pendientes, 0 chunks, Gemini 401, `automationEnabled=false`; cualquier diferencia reemplaza el baseline anterior.

### Task 1: G1 — Dominio único del contrato

**Files:**
- Create: `src/features/calls/domain/buy-signal.ts`
- Create: `tests/unit/calls/buy-signal.test.ts`

**Interfaces:**
- Produces: `BuySignalBodySchema`, `BuySignal`, `BuySignalName`, `BuySignalResponseSchema`, `SIGNAL_ACTION_MAP`.
- Consumed by: G2-A, G2-B, G2-C y G3-A.

- [ ] Leer sólo el contrato y `src/features/calls/domain/post-call-followup.ts`.
- [ ] Escribir seis tests: válido mínimo, campo requerido ausente, cada enum inválido, email inválido, fecha inválida y observaciones de 281 caracteres.
- [ ] Confirmar RED ejecutando sólo `tests/unit/calls/buy-signal.test.ts`.
- [ ] Implementar schemas Zod estrictos y la tabla §2 con `as const`; sin DB, HTTP ni Next.
- [ ] Ejecutar `npm run typecheck` y el test focal una vez.
- [ ] Entregar el diff al coordinador; éste commitea sólo los dos archivos como `feat: define agent b buy signal contract`.

### Task 2: G2-A — Ingesta, decisión diferida y entrega física

**Files:**
- Create: `supabase/migrations/20260822010001_system_buy_signal_events.sql`
- Create: `src/features/calls/application/receive-buy-signal.ts`
- Create: `src/app/api/agent-b/signal/route.ts`
- Modify: `src/lib/services/decision.service.ts`
- Create: `src/features/delivery/ports/outbound-channel.ts`
- Create: `src/features/delivery/application/flush-outbound-deliveries.ts`
- Create: `src/features/delivery/adapters/botpress-outbound-channel.ts`
- Create: `src/app/api/cron/flush-outbounds/route.ts`
- Test: `tests/unit/calls/receive-buy-signal.test.ts`
- Test: `tests/unit/delivery/flush-outbound-deliveries.test.ts`
- Test: `tests/integration/agent-b-signal.test.ts`

**Interfaces:**
- Consumes: G1 schemas y el puerto `PaymentLinkResolver` de G2-B mediante interface local/fake hasta integrar.
- Produces: `receiveBuySignal(input,deps)`, `DeliveryMode='inline_botpress'|'deferred_outbox'`, `flushOutboundDeliveries(input,deps)`.

- [ ] Leer sólo contrato, archivos de G1, `synthesize-call-result-turn.ts`, `post-call-followup.ts`, `decision.service.ts` y la migración `20260817050001_system_call_result_events.sql`.
- [ ] Escribir RED para los seis casos del contrato y para secreto inválido, replay concurrente 10x y presupuesto de respuesta sin network de delivery.
- [ ] Crear migración aditiva que amplíe los checks a `system_buy_signal`; no editar migraciones anteriores ni crear tabla de decisiones.
- [ ] Sintetizar `external_event_id=system:buy_signal:<call_id>:<idempotency-key>`, mensaje inbound y decisión fija. Resolver llamada activa y contacto dentro de una transacción.
- [ ] Agregar `delivery_mode` a `commitAgentDecision`, default `inline_botpress`; en `deferred_outbox` dejar delivery/outbox `pending` y attempt 0.
- [ ] Escribir RED del worker: claim atómico, revalidación de consentimiento, confirmación, error confirmado, resultado ambiguo y segunda corrida vacía.
- [ ] Implementar worker sobre `claim_outbox_events`, tomando también la lease de `outbound_deliveries` en la misma transacción. Sin nuevas tablas.
- [ ] Implementar `BotpressOutboundChannel` con `@botpress/client@1.46.0`: configuración inyectada por constructor, conversation ID desde `channel_threads.external_conversation_id`, `userId=BOTPRESS_BOT_ID`, tags canónicos; nunca leer env dentro del dominio ni pasar PAT en argv.
- [ ] Proteger `GET /api/cron/flush-outbounds` con `Authorization: Bearer $CRON_SECRET`, lote pequeño y deadline menor al límite de función.
- [ ] Tras confirmación llamar `recordDeliveryReport`; ante ambigüedad pausar para reconciliación, sin retry automático.
- [ ] Esperar la señal del coordinador de que G2-B creó el puerto; ejecutar migración desde cero, typecheck y las tres suites focales una vez.
- [ ] Entregar el diff al coordinador; éste commitea el allowlist como `feat: ingest and dispatch agent b buy signals`.

### Task 3: G2-B — Resolver de tres links

**Files:**
- Create: `src/features/payments/domain/payment-link.ts`
- Create: `src/features/payments/adapters/config-payment-link.resolver.ts`
- Test: `tests/unit/payments/payment-link.test.ts`

**Interfaces:**
- Produces: `PaymentPlanSchema`, `PaymentLinkResolver`, `ConfigPaymentLinkResolver`, `PlanNotConfiguredError`.
- Consumed by: G2-A.

- [ ] Leer sólo §5 del contrato.
- [ ] Escribir RED: cada plan correcto, falta de URL, plan inválido y ausencia de fallback cruzado.
- [ ] Implementar exactamente tres env vars; `curso_slug` viaja para trazabilidad pero no elige otra URL en esta fase.
- [ ] No importar Stripe ni consultar `offering_payment_configs`.
- [ ] Ejecutar typecheck y test focal una vez.
- [ ] Entregar el diff al coordinador; éste commitea el allowlist como `feat: resolve configured payment links`.

### Task 4: G2-C — Proyección Excel idempotente

**Files:**
- Create: `src/lib/providers/sheets/sheets-provider.ts`
- Create: `src/lib/providers/sheets/xlsx-file-provider.ts`
- Create: `src/lib/providers/sheets/fake-sheets-provider.ts`
- Create: `src/lib/services/projection.service.ts`
- Create: `src/app/api/cron/flush-projections/route.ts`
- Create: `scripts/run-sheet-projections.ts`
- Test: `tests/unit/projection/projection-idempotency.test.ts`

**Interfaces:**
- Produces: `SheetsProvider.upsertRow(key,values)`, `enqueueLeadProjection`, `flushSheetProjections`.
- Consumes: `sheet_projection_rows` y el payload canónico de G2-A.

- [ ] Leer sólo §6 y `20260817040001_sheet_projection_rows.sql`.
- [ ] Escribir RED: mismo evento 10x genera una sola key/fila; actualización preserva `hecha_por_operador`; dos contactos producen dos filas.
- [ ] Usar el `exceljs` ya instalado por Task 0; implementar fake y `.xlsx` con escritura atómica archivo temporal→rename y configuración inyectada por constructor.
- [ ] Usar `projection_key=lead:<workspace_id>:<contact_id>` y el `row_number` reservado por PostgreSQL.
- [ ] Hacer que `estado_alta` nazca `pendiente_operador` y que el provider preserve cualquier valor humano existente.
- [ ] Proteger flush con `CRON_SECRET`; no agregar este cron a Vercel mientras el provider sea local.
- [ ] Fallar al boot si `SHEETS_PROVIDER=xlsx_local` en producción.
- [ ] Ejecutar typecheck y test focal una vez.
- [ ] Entregar el diff al coordinador; éste commitea el allowlist como `feat: project lead state to local xlsx`.

### Task 5: G3-A — Runtime, memoria y simulador

**Files:**
- Modify: `src/app/api/webhooks/voice/telegram/route.ts`
- Modify: `src/features/calls/application/telegram-webhook.ts`
- Modify: `src/lib/config.ts`, `.env.example`, `.env.local.example`
- Modify: `botpress-agent/src/conversations/router.conversation.ts`, `botpress-agent/src/utils/http.ts`
- Modify: `botpress-agent/src/actions/commitDecision.ts`, `botpress-agent/src/schemas/contracts.ts`, `botpress-agent/src/workflows/processInboundTurn.ts`
- Create: `src/features/orchestration/application/commit-claimed-decision.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Test: `tests/unit/calls/telegram-webhook.test.ts`
- Test: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`
- Test: `tests/integration/orchestration-lifecycle.test.ts`

**Interfaces:**
- Consumes: endpoint HTTP de G2-A.
- Produces: comando `/senal` sin lógica de negocio y runtime reproducible.

- [ ] Agregar `/senal <call_id> signal=intencion_compra plan=12m nivel=alto`; sólo parsea y hace POST al endpoint real.
- [ ] Validar al boot las variables del contrato con errores por nombre, sin imprimir valores.
- [ ] Sustituir referencias `OPENAI_API_KEY` por `GEMINI_API_KEY`; no cambiar modelo/dimensión/epoch actuales.
- [ ] En Development, comprobar explícitamente `automationEnabled=true`; nunca habilitar Production en esta tarea.
- [ ] Con key válida correr `node scripts/smoke-embedding-gemini.mjs`; exigir 200, 768 valores finitos y epoch vigente.
- [ ] Drenar `run-knowledge-projection.ts`, `run-message-embeddings.ts` y `run-selected-memory-embeddings.ts`; exigir 23 fuentes materializadas y cero claimables.
- [ ] Reproducir `npm --prefix botpress-agent run build` desde estado generado limpio. Fijar una combinación ADK/Telegram compatible; queda prohibido depender de un shim en `.adk`.
- [ ] Ignorar callbacks Botpress `type!='message'` antes del dispatcher para quitar el falso `CHANNEL_UNSUPPORTED`.
- [ ] Mantener defaults HTTP finitos aunque Botpress omita configuración.
- [ ] Extender el commit Botpress con `batch_id` y `claim_token`; `commit-claimed-decision` debe intentar `completeBatch` después de un commit o replay exitoso. Un fallo de cierre pausa/reintenta sin crear otra decisión ni otro outbound.
- [ ] Ejecutar typechecks y las tres suites focales una vez.
- [ ] Entregar el diff al coordinador; éste commitea el allowlist como `fix: stabilize agent runtime and memory readiness`.

### Task 6: G3-B — Smokes E2E

**Files:**
- Create: `scripts/smoke-agent-b-signal.mjs`
- Create: `scripts/smoke-agent-a-memory.mjs`
- Test data only: PostgreSQL desechable `127.0.0.1:55433/studyx_test`

**Interfaces:**
- Consumes: endpoints públicos locales, nunca funciones internas.
- Produces: dos comandos con salida tabular y exit code confiable.

- [ ] El smoke B siembra y limpia contacto, permiso, conversación, thread y call session sintéticos.
- [ ] Ejecutar por HTTP los seis casos §10 y comparar conteos/IDs antes y después.
- [ ] Con provider fake, correr flush 10x y comprobar un único envío lógico y una única fila Excel.
- [ ] Con Telegram Development, ejecutar una señal controlada y exigir mensaje físico, Botpress message ID y delivery report. Sin este paso no declarar delivery terminado.
- [ ] El smoke A envía dos turnos: el primero crea una memoria seleccionada `ready`; el segundo debe recuperarla. También verifica una consulta KB conocida.
- [ ] Imprimir únicamente IDs sintéticos, estados y duraciones; nunca contenido/PII/secrets.
- [ ] Ejecutar ambos scripts y guardar la salida exacta para G4.
- [ ] Entregar el diff al coordinador; éste commitea el allowlist como `test: add agent a and b end to end smokes`.

### Task 7: G4 — Auditoría, GitHub y cierre

**Files:**
- Modify: `SESSION.md`
- No production code changes.

**Interfaces:**
- Consumes: todos los commits y evidencia de G3-B.
- Produces: branch respaldado, PR revisable y lista cerrada de casos pendientes.

- [ ] Verificar diff: sin secretos, `.env.local`, `.adk`, `.xlsx`, `.jez`, `retell/` ni JSON fuente no autorizados.
- [ ] Ejecutar una sola vez: root typecheck, lint, unit suite, migración desde cero, integración focal, Botpress check/typecheck/build y ambos smokes.
- [ ] Verificar invariantes: replay 10x, contacto bloqueado, ambigüedad de envío, Excel sin duplicado y una entrega física.
- [ ] Confirmar que el batch de Agent A termina `completed`, no `claimed` vencido. Si sigue abierto, reportar como release blocker; no ocultarlo.
- [ ] Confirmar diagnósticos: Gemini smoke real, backlog/epoch, no sólo presencia de key.
- [ ] Actualizar `SESSION.md` con SHAs, gates, bloqueos externos y comandos de reproducción.
- [ ] Push a `origin` y `personal`; comprobar SHA remoto idéntico.
- [ ] Abrir PR contra `origin/main` (`aaedd79` era el baseline), haciendo explícito que incluye los 50 commits acumulados más esta feature. No mergear automáticamente.

## Definition of Done de hoy

- Agent A responde por Telegram Development tras un reinicio limpio, sin shim.
- Gemini devuelve 768 dimensiones; KB y memoria seleccionada son recuperables.
- Señal B válida responde en menos de 2 s y replay conserva IDs.
- A entrega un único link físico; B nunca usa el canal.
- Excel local contiene una fila idempotente con `pendiente_operador`.
- Dos smokes verdes, suites verdes, branch en ambos GitHub y PR abierto.

## Lo único que puede quedar para después de hoy

- Matriz de personalidades/tipos de cliente.
- Variantes de objeciones y copy conversacional.
- Evals de calidad y latencia con más volumen.
- Provider Retell real, Google Sheets durable y PSP real, todos detrás de puertos ya definidos.

No se considera “sólo testing” si siguen faltando: key Gemini válida, envío físico, worker de outbox, build ADK limpio, memoria en segundo turno o respaldo en GitHub.
