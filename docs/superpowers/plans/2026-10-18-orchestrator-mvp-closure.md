# Cierre MVP del orquestador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar funcionando el flujo mínimo de venta: Agent A responde y conduce sin silencios ante entradas recuperables, el orquestador puede derivar una llamada a Agent B y un pago confirmado puede dar de alta al cliente una sola vez y enviar el mensaje de acceso.

**Architecture:** Mantener la arquitectura existente y corregir únicamente el borde que hoy convierte una orientación válida sobre planes de pago en `AGENT_A_VALIDATION_EXHAUSTED`. Después, certificar por separado las tres rutas ya construidas —conversación/pago, Agent B y alta posventa— contra PostgreSQL descartable; no agregar otra capa, otro modelo ni reglas conversacionales nuevas.

**Tech Stack:** TypeScript, Vitest, Botpress ADK, Next.js, PostgreSQL 17/pgvector, Stripe sandbox, Xendra/Retell y Central Carga mediante los adaptadores existentes.

**Spec:** `docs/superpowers/specs/2026-10-01-agent-a-nonblocking-orchestrator-design.md`

## Global Constraints

- Agent A sigue siendo el único autor de prosa comercial visible para el cliente.
- El orquestador sigue siendo autoridad exclusiva de hechos, permisos y efectos.
- Un rechazo de acción no puede borrar una respuesta conversacional útil.
- `MODEL_UNAVAILABLE` queda reservado a una falla real de DeepSeek después del único reintento permitido.
- No agregar planners, enrutamiento de intención por regex, frases comerciales prefabricadas, otro proveedor de modelo ni una reescritura amplia.
- No debilitar autorización, idempotencia, verdad comercial, opt-out ni prevención de duplicados.
- Todo turno comercial activo debe producir una respuesta visible; si falta un dato o la entrada es ambigua/no interpretable, Agent A debe pedir exactamente la aclaración necesaria. El único silencio deliberado permitido es después de un opt-out persistido.
- No modificar prompts, contratos públicos, migraciones ni integraciones salvo que una prueba focal demuestre que es imprescindible para este MVP.
- No publicar, desplegar ni ejecutar un alta real sin la confirmación explícita del usuario después de que los gates locales estén verdes.

## Review Focus

- Entrada ambigua, fuera del hilo o no interpretable: responder, pedir una aclaración útil y volver a la venta sin inventar; lo cubre Task 2.
- Faltante recuperable de plan, curso o datos: pedir sólo lo faltante, conservar la intención y nunca producir silencio o falso `MODEL_UNAVAILABLE`; lo cubren Tasks 1 y 2.
- Aceptación inequívoca de llamada: reservar una sola llamada y permitir continuidad A→B→A; lo cubre Task 2.
- Pago confirmado con mensajes pendientes o eventos concurrentes: crear una sola alta y entregar el mensaje de acceso una sola vez; lo cubre Task 3.
- Memoria y timeout: mantener estado canónico por conversación, memoria vectorial por contacto sin cruces y no repetir efectos ante respuestas ambiguas; lo cubren Tasks 2 y 3.

---

### Task 1: Eliminar el falso bloqueo `PLAN_NOT_SELECTED`

**Files:**
- Modify: `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts:313-331`
- Modify: `tests/unit/botpress/resolve-agent-a-plannerless.test.ts:1973`
- Modify: `tests/workflow/agent-a-action-boundary-regression.test.ts`

**Interfaces:**
- Consumes: `resolveAgentAPlannerlessProposalV2(input)` y su única reparación opcional existente.
- Produces: `mayDegradeToBackendBoundary(proposal, rejection, context): boolean` acepta `PLAN_NOT_SELECTED` sólo como degradación segura después de la reparación; no crea ninguna acción ni cambia contratos.

- [ ] **Step 1: Escribir el test unitario que reproduce la falla actual**

Agregar `preserves the original safe reply when payment-plan repair repeats the structural link request`. El `initial` y la reparación declaran `move: 'request_payment_link'`, `proposed_action: { type: 'none' }` y texto seguro sin prometer un link. Afirmar una reparación, `effective === initial`, `rejection_codes: ['PLAN_NOT_SELECTED']`, `repaired: false` y acción `none`.

- [ ] **Step 2: Confirmar RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/resolve-agent-a-plannerless.test.ts -t "preserves the original safe reply"`

Expected: FAIL porque la segunda validación todavía arroja `AgentAPlannerlessRejectionError` con `PLAN_NOT_SELECTED`.

- [ ] **Step 3: Escribir la regresión vertical del mismo caso**

Agregar `keeps a safe Agent A reply when payment-plan guidance remains after its single repair` en el workflow real. Afirmar `commitSucceeded === true`, el texto original autorizado, cero decisiones `send_payment_link`, ausencia de URL y razón distinta de `AGENT_A_VALIDATION_EXHAUSTED`.

- [ ] **Step 4: Confirmar RED en PostgreSQL descartable**

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-action-boundary-regression.test.ts -t "keeps a safe Agent A reply"`

Expected: FAIL porque el workflow reemplaza la respuesta por el aviso de validación agotada.

- [ ] **Step 5: Implementar el cambio mínimo**

En `mayDegradeToBackendBoundary`, admitir `PLAN_NOT_SELECTED` junto a `REPEATED_AGENT_REPLY` y la guía no bloqueante. Mantener intactos los bloqueos duros para promesas de link, acciones de pago sin autorización, datos faltantes de llamada y afirmaciones de llamada no respaldadas.

- [ ] **Step 6: Confirmar GREEN focal**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/resolve-agent-a-plannerless.test.ts`

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-action-boundary-regression.test.ts`

Expected: ambas suites PASS; el caso sin plan conserva conversación y no crea un efecto.

- [ ] **Step 7: Commit atómico**

```bash
git add botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts \
  tests/unit/botpress/resolve-agent-a-plannerless.test.ts \
  tests/workflow/agent-a-action-boundary-regression.test.ts
git commit -m "fix(orchestrator): preserve safe reply without payment plan"
```

### Task 2: Certificar conversación, pago y Agent B

**Files:**
- Verify: `tests/workflow/agent-a-action-boundary-regression.test.ts`
- Verify: `tests/workflow/agent-a-commercial-truth-repair.test.ts`
- Verify: `tests/workflow/agent-a-call-recovery.test.ts`
- Verify: `tests/workflow/agent-a-nonblocking-vertical.test.ts`
- Verify: `tests/workflow/agent-a-deterministic-outcomes.test.ts`
- Verify: `tests/integration/agent-a-xendra-agent-b-e2e.test.ts`
- Verify: `tests/integration/conversation-state-v1.test.ts`
- Verify: `tests/integration/sales-context-state.test.ts`
- Verify: `tests/integration/agent-a-memory-projection.test.ts`
- Verify: `tests/integration/memory-context-concurrency.test.ts`
- Verify: `tests/integration/agent-loop-memory-workspace-isolation.test.ts`
- Verify: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`
- Verify: `tests/unit/botpress/agent-a-context.test.ts`

**Interfaces:**
- Consumes: workflow `processInboundTurn`, reserva idempotente de llamada, Xendra/Retell fake server y handback existente.
- Produces: evidencia local de que el estado canónico persiste por conversación, la memoria vectorial persiste por contacto sin fugas, Agent A puede reservar una llamada una sola vez, Agent B puede completarla y el mismo chat retoma sin fallback falso.

- [ ] **Step 1: Reconstruir desde cero la base descartable**

Run: `bash scripts/pg-native-down.sh 55434`

Run: `LC_ALL=C bash scripts/pg-native-up.sh 55434 --seed`

Expected: `cluster ready` y migraciones aplicadas sobre una base vacía.

- [ ] **Step 2: Certificar las dos memorias antes de probar acciones**

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.integration.config.mts tests/integration/conversation-state-v1.test.ts tests/integration/sales-context-state.test.ts tests/integration/agent-a-memory-projection.test.ts tests/integration/memory-context-concurrency.test.ts tests/integration/agent-loop-memory-workspace-isolation.test.ts --reporter=verbose`

Expected: PASS; curso/plan y versiones sobreviven en el estado de la conversación, las memorias seleccionadas se proyectan una sola vez y la recuperación queda aislada por contacto y workspace.

- [ ] **Step 3: Certificar autonomía y ausencia de silencios recuperables**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/process-inbound-turn-hot-path.test.ts tests/unit/botpress/agent-a-context.test.ts`

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-nonblocking-vertical.test.ts tests/workflow/agent-a-deterministic-outcomes.test.ts --reporter=verbose`

Expected: PASS; cada turno activo entrega al menos un mensaje, los faltantes de llamada o plan generan una pregunta útil, la entrada no interpretable pide reenvío/aclaración y ninguna falla de política se etiqueta como caída del modelo.

- [ ] **Step 4: Ejecutar las regresiones restantes del workflow**

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-action-boundary-regression.test.ts tests/workflow/agent-a-commercial-truth-repair.test.ts tests/workflow/agent-a-call-recovery.test.ts --reporter=verbose`

Expected: PASS; cero links o llamadas duplicadas y ningún `MODEL_UNAVAILABLE` causado por política.

- [ ] **Step 5: Ejecutar el recorrido A→B→A**

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.integration.config.mts tests/integration/agent-a-xendra-agent-b-e2e.test.ts --reporter=verbose`

Expected: PASS en recorrido completo, reconciliación `409`, no-contactar y timeout ambiguo sin redial.

- [ ] **Step 6: Tratar cualquier rojo como bloqueo, no como permiso para rediseñar**

Si falla, aislar una reproducción mínima, identificar la causa antes de editar y aplicar TDD sólo si pertenece a conversación, llamada o handback. Si el fallo es contaminación de DB o infraestructura local, reconstruir el cluster y no cambiar producción para hacer pasar el test.

### Task 3: Certificar el alta idempotente del cliente

**Files:**
- Verify: `tests/integration/post-sale.test.ts`
- Verify: `tests/integration/central-carga-enrollment-worker.test.ts`
- Verify: `tests/integration/payments-canonical.test.ts`
- Modify: `tests/integration/post-sale.test.ts`
- Verify: `tests/unit/botpress/post-sale-trigger.test.ts`
- Verify: `tests/unit/fulfillment/post-sale.test.ts`
- Verify: `tests/unit/payments/stripe-webhook-route.test.ts`

**Interfaces:**
- Consumes: pago canónico confirmado, job de fulfillment, adaptador existente de Central Carga y notificación posventa.
- Produces: evidencia local y operativa de pago registrado → confirmación visible → alta única → mensaje de acceso visible, con recuperación segura ante concurrencia, `409`, `503`, timeout y reintentos.

- [ ] **Step 1: Reconstruir nuevamente la base descartable para aislar posventa**

Run: `bash scripts/pg-native-down.sh 55434`

Run: `LC_ALL=C bash scripts/pg-native-up.sh 55434 --seed`

Expected: cluster vacío y listo.

- [ ] **Step 2: Completar la regresión vertical del mensaje postinscripción**

En `tests/integration/post-sale.test.ts`, reemplazar el avance manual del estado `payment_received` por el ciclo real `dispatch → claim → deliver`. Luego ejecutar el worker de alta, repetir `dispatch → claim → deliver` para `access_ready` y capturar ambos envíos. Afirmar exactamente dos mensajes, estados finales `sent`, una sola fila de `central_enrollments`, credenciales sólo en el segundo mensaje y ausencia de un segundo envío al reejecutar el pipeline.

- [ ] **Step 3: Ejecutar pago, trigger Botpress, posventa y alta**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/post-sale-trigger.test.ts tests/unit/fulfillment/post-sale.test.ts tests/unit/payments/stripe-webhook-route.test.ts`

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.integration.config.mts tests/integration/payments-canonical.test.ts tests/integration/post-sale.test.ts tests/integration/central-carga-enrollment-worker.test.ts --reporter=verbose`

Expected: PASS; un pago confirmado programa el pipeline, genera un solo job, una sola alta, una confirmación de pago y un mensaje de acceso, sin duplicar envíos ni matrículas.

- [ ] **Step 4: Diagnosticar el corte observado en producción con evidencia de sólo lectura**

Verificar presencia —sin imprimir valores— de `POST_SALE_ENABLED`, entorno de pagos, corte de altas y configuración de egress administrado. Inspeccionar los estados recientes de `post_sale_notifications`, `fulfillment_jobs` y `central_enrollments`, y confirmar que el bundle Botpress desplegado contiene y ejecuta `onStudyxPostSale`. Clasificar el corte por el último estado durable: `pending` (pipeline no despachó), `dispatched` (evento Botpress no reclamado), `processing` (trigger quedó a mitad), `ambiguous` (envío incierto) o `dead_letter` (falla terminal).

- [ ] **Step 5: Mantener separada la corrección de posventa si aparece un defecto real**

Si una prueba reproduce un defecto de alta, escribir primero una regresión con un único pago y dos ejecuciones concurrentes, hacer el cambio mínimo en el worker/adaptador responsable y crear un commit separado `fix(fulfillment): preserve idempotent enrollment`.

### Task 4: Gate final del candidato local y frontera de publicación

**Files:**
- Verify: `package.json`
- Verify: `botpress-agent/package.json`
- Verify: working tree and commit history

**Interfaces:**
- Consumes: los cambios y evidencias de Tasks 1–3.
- Produces: un SHA local reproducible, árbol limpio y decisión explícita `READY_FOR_SUPERVISED_CANARY` o `BLOCKED` con la falla exacta.

- [ ] **Step 1: Ejecutar calidad estática y pruebas unitarias**

Run: `npm run typecheck && npm run lint && npm run test:unit`

Expected: todos salen con código 0.

- [ ] **Step 2: Ejecutar la suite de integración sobre una base limpia**

Run: `bash scripts/pg-native-down.sh 55434 && LC_ALL=C bash scripts/pg-native-up.sh 55434 --seed`

Run: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npm run test:integration`

Expected: PASS sin contaminación entre pruebas.

- [ ] **Step 3: Construir backend y Botpress**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npm run build`

Run: `npm --prefix botpress-agent run typecheck && npm --prefix botpress-agent run build`

Expected: ambos builds salen con código 0 y no modifican fuentes manualmente.

- [ ] **Step 4: Verificar cierre local**

Run: `git status --short && git log -1 --oneline`

Expected: árbol limpio y un SHA identificable que contiene la corrección mínima.

- [ ] **Step 5: Detenerse antes de efectos externos**

Presentar al usuario el SHA, conteos de pruebas y cualquier limitación. Pedir confirmación antes de `git push`, despliegue de Vercel/Botpress o canario real de llamada/pago/alta. El canario supervisado debe usar exactamente el mismo SHA y comprobar una conversación, una llamada A→B→A y un pago sandbox con una sola matrícula.
