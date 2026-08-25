# Agent A Validation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retomar desde Task 6, corregir los defectos abiertos y validar el Agente A localmente sin consumir Botpress AI Spend, hasta obtener evidencia reproducible de conversación, persistencia, memoria, pagos y Sheets.

**Architecture:** Se conserva Botpress ADK como adaptador de canal y workflow durable, Next.js como orquestador de reglas y PostgreSQL como fuente de verdad. La validación se divide en un carril determinista sin cuota —para probar pipeline y efectos— y un carril Gemini real —para evaluar calidad conversacional—. Ningún cambio alcanza Production.

**Tech Stack:** Botpress ADK 2.0.5, TypeScript 5.9, Vitest, Next.js 16, PostgreSQL/pgvector, Gemini Generate Content REST.

**Spec:** `docs/superpowers/plans/2026-08-24-agent-a-gemini-direct-35-cases.md`

## Global Constraints

- No tocar Production, desplegar, pushear ni commitear sin autorización.
- Preservar el worktree actual.
- Development usa `gemini_direct`; Production conserva `botpress_managed`.
- No imprimir secretos ni pasarlos explícitamente en comandos registrados.
- No modificar expectativas para aprobar casos.
- No enviar pagos reales ni escribir en Sheets reales durante la suite.
- Máximo 10 rondas; éxito sólo con 35/35 en tres rondas consecutivas.
- El carril simulado valida ingeniería; sólo el carril Gemini real valida calidad conversacional.

---

### Task 0: Recuperar un entorno seguro y reproducible

**Files:**
- Modify: ninguno.
- Evidence: `botpress-agent/evals/INTERNAL_GEMINI_35_REPORT.md`

**Interfaces:**
- Consumes: PostgreSQL desechable `127.0.0.1:55433/studyx_test`, Next.js `localhost:3000`, configuración Development de ADK.
- Produces: fingerprint de entorno sin valores secretos.

- [ ] Detener únicamente los procesos ADK locales pertenecientes a este repo; no tocar Production ni otros procesos.
- [ ] Rotar antes de desplegar las credenciales expuestas previamente y cargarlas mediante el almacén de secretos/configuración de Development, nunca como texto en el plan o informe.
- [ ] Levantar Next.js, PostgreSQL y ADK bajo `caffeinate`, con archivos de log fuera del repo y permisos locales.
- [ ] Verificar `GET /api/health`, `SELECT 1`, `adk check` y un `adk chat` sin modelo para confirmar que el socket/túnel está conectado.
- [ ] Registrar sólo: puertos, proveedor, modelo, prompt version, timestamps y códigos de estado.

**Gate:** no avanzar mientras aparezcan `socket-client Failed to connect`, `Missing bot id header` en tráfico real de `adk chat`, o configuración Development ausente.

---

### Task 1: Cerrar los defectos P1 de seguridad comercial

**Files:**
- Modify: `src/lib/heuristics/opt-out.ts`
- Modify: `src/features/payments/domain/payment-choice-policy.ts`
- Modify: `botpress-agent/src/utils/payment-choice.ts`
- Modify: `scripts/run-agent-a-conversations.ts`
- Test: `tests/unit/heuristics/opt-out.test.ts`
- Test: `tests/unit/payments/payment-link.test.ts`
- Test: `tests/unit/botpress/payment-choice-mirror.test.ts`
- Test: `tests/unit/scripts/agent-a-conversation-runner.test.ts`

**Interfaces:**
- Consumes: mensajes del batch actual.
- Produces: `derivePaymentChoiceFromBatch(...)` que devuelve un plan sólo ante una elección afirmativa inequívoca.

- [ ] Agregar RED: `No me mandes más` debe revocar consentimiento; `No me mandes el link todavía` no debe hacerlo.
- [ ] Agregar RED: `¿Son USD 30 por mes?`, `¿tenés 12 cuotas?` y `cuánto sale en 6 meses` deben devolver `null`.
- [ ] Agregar GREEN esperado: `elijo 12 cuotas`, `quiero el de 6 meses` y `avanzo con un único pago` deben devolver exactamente su plan.
- [ ] Implementar una señal afirmativa separada del reconocimiento del plan; autorizar sólo cuando ambas coincidan y sólo haya un plan.
- [ ] Mantener paridad byte-for-byte de comportamiento entre backend y espejo Botpress.
- [ ] Cambiar la suite default del runner a `studyx-internal-gemini-35-v1.json`, cuyo prompt es v11.
- [ ] Ejecutar las cuatro suites focales y confirmar RED→GREEN.

---

### Task 2: Acotar Gemini y preservar la procedencia durable

**Files:**
- Modify: `botpress-agent/src/lib/decision/decision-generator.ts`
- Modify: `botpress-agent/src/lib/decision/gemini-direct.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Test: `tests/unit/botpress/gemini-direct-decision.test.ts`
- Test: `tests/unit/botpress/decision-provider-parity.test.ts`
- Test: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`

**Interfaces:**
- Extend `GenerateDecisionInput` with `timeoutMs: number`.
- `GeneratedDecision` conserva `{ decision, provider, model, latencyMs }`.
- El durable step debe devolver `GeneratedDecision`; no debe depender de mutaciones externas al callback.

- [ ] Agregar RED: un `fetch` que nunca resuelve se aborta dentro de `requestTimeoutMs` y no espera los cinco minutos del workflow.
- [ ] Agregar RED: 400/401/schema inválido realizan una llamada; 429/503 realizan como máximo dos llamadas totales, no cuatro.
- [ ] Agregar RED de replay: al reutilizar la salida cacheada del step, el commit conserva `google-ai-direct` y el modelo exacto.
- [ ] Combinar el signal del workflow con un timeout por etapa de 8–12 segundos.
- [ ] Hacer que una sola capa sea dueña de los retries: el adaptador Gemini; configurar el step con `maxAttempts: 1` para el camino directo.
- [ ] Generalizar `model.provider` para aceptar `botpress` y `google-ai-direct`; persistir el proveedor real.
- [ ] Mantener `responseSchema` y `DecisionSchema.safeParse` como doble validación.
- [ ] Ejecutar tests focales, typecheck raíz y typecheck Botpress.

---

### Task 3: Completar corrección de identidad y gates de repositorio

**Files:**
- Modify: `src/lib/heuristics/contact-identity.ts`
- Modify: `eslint.config.mjs`
- Test: `tests/unit/heuristics/contact-identity.test.ts`
- Test: `tests/unit/scripts/agent-a-persistence-verifier.test.ts`

**Interfaces:**
- Consumes: una corrección explícita como `me equivoqué: es Suárez, el email correcto es ...`.
- Produces: actualización explícita y acotada del apellido/email sin interpretar frases generales como identidad.

- [ ] Agregar RED con el texto exacto del caso 35 y variantes sin email.
- [ ] Implementar un patrón exclusivo para marcadores de corrección (`me equivoqué`, `corrección`, `el apellido correcto es`).
- [ ] Confirmar que preguntas de cursos y texto comercial nunca se capturan como nombre.
- [ ] Ignorar `.superpowers/**` en ESLint, igual que `.worktrees/**`, porque son snapshots y no código entregable.
- [ ] Ejecutar unitarias, lint y `git diff --check`.

---

### Task 4: Validación determinista sin cuota

**Files:**
- Create: `scripts/run-agent-a-scripted-decisions.ts`
- Create: `botpress-agent/evals/fixtures/studyx-scripted-decisions-v11.json`
- Test: `tests/unit/scripts/agent-a-scripted-decisions.test.ts`
- Append: `botpress-agent/evals/INTERNAL_GEMINI_35_REPORT.md`

**Interfaces:**
- El fixture entrega una `Decision` válida por cada turno de los 35 casos.
- Reutiliza `DecisionSchema`, `applyDecisionPolicy`, ingest, claim, commit, memoria, pago y outbox reales.
- Sustituye únicamente la generación del LLM; nunca las reglas ni la persistencia.

- [ ] Crear fixtures mínimos de decisiones esperadas para los 35 casos, sin copiar respuestas completas cuando una intención/acción sea suficiente.
- [ ] Ejecutar todos los casos contra PostgreSQL desechable.
- [ ] Verificar: decisión única, outbound único, opt-out, llamada hipotética, link canónico, identidad, memoria candidata y fila de outbox.
- [ ] Marcar el resultado como `ENGINEERING_PIPELINE`, nunca como aprobación conversacional.

**Gate:** 35/35 determinista antes de gastar una llamada real de modelo.

---

### Task 5: Cinco smokes Gemini reales

**Files:**
- Append: `botpress-agent/evals/INTERNAL_GEMINI_35_REPORT.md`

**Prerequisite:** una clave/proyecto con cuota suficiente. La suite contiene exactamente 172 turnos; tres rondas requieren 516 generaciones base, más los cinco smokes y cualquier retry. Un límite de 20 solicitudes/día nunca puede completar la definición de terminado.

- [ ] Probar una sola generación estructurada con el modelo elegido y registrar status/latencia, sin contenido ni secreto.
- [ ] Ejecutar en orden los casos 1, 17, 27, 28 y 30 con identidades nuevas.
- [ ] Cortar ante dos fallos iguales de infraestructura; no gastar el resto de la cuota.
- [ ] Confirmar 5/5, cero fallback técnico y cero spans de Botpress AI Spend.
- [ ] Si reaparece `GEMINI_SCHEMA_INVALID`, guardar sólo el mapa de claves/tipos de la respuesta, nunca PII ni prompt completo, y corregir mediante RED focal.

---

### Task 6: Loop completo, memoria y gates finales

**Files:**
- Append: `botpress-agent/evals/INTERNAL_GEMINI_35_REPORT.md`

- [ ] Ejecutar ronda 1 de 35 casos; clasificar fallos por causa raíz.
- [ ] Repetir sólo focales afectados después de cada corrección TDD.
- [ ] Ejecutar nuevas rondas completas únicamente cuando los focales estén verdes.
- [ ] Exigir tres rondas consecutivas 35/35 con identidades nuevas.
- [ ] En casos 12, 28, 29 y 35 confirmar `embedding_state=ready` y recuperación efectiva, no sólo escritura.
- [ ] Ejecutar unitarias, integración local, concurrencia/replay, lint, typechecks, ADK check/build y build raíz.
- [ ] Medir p50/p95 excluyendo fallos 429/503, pero reportar la tasa de fallos por separado.
- [ ] Pedir al usuario un único mensaje real a Amsterdam sólo después de todos los gates locales.

## Definition of Done

- Los defectos P1/P2 están cubiertos por regresiones.
- Pipeline determinista 35/35.
- Smokes Gemini 5/5.
- Tres rondas Gemini consecutivas 35/35.
- Memoria vectorial se escribe y recupera.
- Pagos y Sheets generan efectos locales idempotentes, sin operaciones reales.
- Gates verdes y evidencia versionada.
- Production permanece intacta.

## Self-review

- No repite Tasks 1–5 ya terminadas; retoma el punto real de interrupción.
- Separa validación de ingeniería de calidad conversacional para no confundir mocks con comportamiento real.
- El único prerrequisito externo inevitable es cuota suficiente para el modelo real.
- No contiene placeholders ni secretos.
