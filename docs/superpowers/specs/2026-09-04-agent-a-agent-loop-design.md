# Agent A como agente: migración del rule engine a un agent loop

Fecha: 2026-09-04
Rama base: `codex/agent-a-plannerless-v2` @ `8e84a54`
Estado: especificación aprobada para planificar. **Nada de esto está implementado.**

---

## 1. Diagnóstico: la hipótesis se confirma

Agent A no es un agente. Es un generador de propuestas dentro de un rule
engine.

DeepSeek emite **una sola llamada de salida estructurada**
(`response_format: json_schema`, `botpress-agent/src/lib/conversation/agent-a-brain.ts:135-190`).
No hay array `tools`, no hay `tool_calls`, no hay resultados de herramientas, no
hay segunda vuelta salvo una reparación opcional apagada por defecto. Todo lo
que ocurre después de esa llamada lo decide el backend por su cuenta.

### 1.1 Las ocho capas que reinterpretan la propuesta

| # | Capa | Archivo | Qué hace |
|---|---|---|---|
| 1 | `bindCurrentCatalogResolutionToMoveV1` | `botpress-agent/src/lib/conversation/agent-a-context.ts:68` | Pisa `move` a `unknown` cuando `catalog_resolution.kind === 'ambiguous'` |
| 2 | `bindCurrentConversationalIntentToMoveV1` | `botpress-agent/src/lib/conversation/agent-a-context.ts:98` | Reescribe el move primario (`decline_purchase`→`defer_payment`→`unknown`/`provide_contact_details`), filtra vetoes e **inyecta `secondary_moves` derivados de regex** sobre el batch actual |
| 3 | `resolveAgentAPlannerlessProposalV2` | `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts` | Cuatro podas de texto sin consultar al modelo, más `mayDegradeToBackendBoundary`, que deja pasar una propuesta formalmente rechazada |
| 4 | `applyDecisionPolicy` | `botpress-agent/src/utils/decision-policy.ts:531` | `withoutRepeatedGreeting` + `withDeterministicMemories` |
| 5 | **`authorizeAgentTurnV2`** | `src/features/conversation/domain/agent-turn-policy-v2.ts:117` | Poda oraciones (`dropUnsupportedStateAssertionsV1`), recomputa la transición de estado completa, y **materializa `send_payment_link` aunque el modelo haya propuesto `none`** (línea 253) |
| 6 | `decisionFromAuthorizedTurn` | `src/features/conversation/application/prepare-agent-turn-v2.ts:78` | Deriva `response_type` leyendo la prosa con `solicitsACall()` |
| 7 | `materializePaymentLinkAction` / `proseWithoutUrls` | `src/lib/services/decision.service.ts:770-795` | Reescribe el texto final: añade o arranca el bloque de pago |
| 8 | `enforceCommercialTruthV1` | `src/features/orchestration/domain/commercial-truth-guard.ts:396` | Veto por oración; si no sobrevive ninguna, **sustituye silenciosamente** por `resolveTechnicalFallbackV1` (`decision.service.ts:880-905`) |

`verifyAuthorizedEgressPortable` (`processInboundTurn.ts:1264`) es la única capa
que ya cumple el contrato deseado: verifica un hash y no modifica nada.

### 1.2 Trece módulos leen prosa por regex

`agent-a-context.ts`, `agent-turn-policy-v2.ts`, `channel-preference-evidence.ts`,
`operational-promise-guard.ts` (≈20 patrones), `commercial-truth-guard.ts`,
`payment-choice-policy.ts`, `catalog-resolution.ts`, `egress-guard.ts`,
`canonical-offering-egress.ts`, `contact-identity.ts`, `opt-out.ts`,
`agent-a-brain.ts`, `resolve-agent-a-plannerless.ts`.

### 1.3 Ocho guards podan sin volver a consultar al agente

`dropUnsupportedStateAssertionsV1`, `enforceCommercialTruthV1`,
`pruneRepeatedQuestion`, `pruneUnsupportedPrerequisiteClaimV1`,
`pruneFalseLinkDeliveryClaimV1`, `demoteUnauthorizedPaymentAction`,
`withoutRepeatedGreeting`, `proseWithoutUrls`.

### 1.4 Bug confirmado: transición persistida sin mensaje visible

`authorizeAgentTurnV2` calcula `transition` sobre el texto **pre-veto**
(`visibleCallOffer`, `agent-turn-policy-v2.ts:172`). Un veto **parcial** de
`enforceCommercialTruthV1` deja `preparedAgentTurn` no-nulo, y
`decision.service.ts:1259-1260` escribe esa transición igual.

Consecuencias observables: `call_offer_count` incrementado por una invitación
que el cliente nunca recibió; `stage='payment_link_sent'` con la oración
borrada; `awaiting_reply` esperando una respuesta a una pregunta que se podó.
Sólo la supresión **total** anula la transición (`decision.service.ts:902-903`).

Esto explica directamente el síntoma reportado: **un ajuste válido del prompt no
se refleja en producción** porque el estado que condiciona el turno siguiente no
lo escribe el agente.

### 1.5 Paridad de prompt

`AGENT_A_BRAIN_PROMPT_VERSION = 'studyx-agent-a-brain-v21'`. Dentro del repo el
prompt evaluado y el desplegado son el mismo builder
(`buildAgentABrainInstructionsV1`). La paridad con el bundle efectivamente
desplegado en Botpress Cloud **sigue sin verificarse** — es el mismo agujero
abierto el 29-ago-2026. La especificación lo trata como riesgo, no como hecho.

---

## 2. Arquitectura objetivo

```
mensaje
  → contexto (estado + historial + memoria + intake)
  → Agent A  ──┐
       ↑       │ tool_calls
       │       ↓
   tool_results ← ejecución de herramientas (backend)
       │
  → Agent A: respuesta final única
  → control de integridad (acepta | devuelve error estructurado)
  → persistencia (estado = decisión del agente)
  → entrega
```

**Invariante central:** el `AgentTurnDecisionV3` que produce el agente es la
única fuente del mensaje visible **y** de la transición de estado. Ninguna capa
posterior puede producir texto ni estado por su cuenta.

### 2.1 Qué hace el orquestador

1. Recibe el mensaje y espera la ventana de batch (sin cambios: `claimBatch`).
2. Carga contexto, historial, memoria e intake (sin cambios: `buildAgentAContextV1`).
3. Ejecuta el agent loop.
4. Ejecuta las herramientas pedidas y devuelve sus resultados al agente.
5. Recibe la respuesta definitiva.
6. Corre el control de integridad.
7. Persiste texto + estado + señales, atómicamente.
8. Entrega.

### 2.2 Qué deja de hacer el backend

- No reinterpreta el mensaje (capas 1, 2 se eliminan).
- No elige el recorrido comercial (capa 5 pasa de autor a autorizador).
- No modifica el `move` del agente.
- No compone respuestas (capa 7 pasa a devolver el bloque de pago **como
  resultado de herramienta**, no como texto concatenado).
- No poda narrativa como comportamiento normal (capas 3, 8).
- No infiere acciones leyendo prosa (`solicitsACall` deja de decidir
  `response_type` y `call_offer_count`).
- No reemplaza la respuesta en silencio (capa 8 deja de sustituir por
  `resolveTechnicalFallbackV1`).
- No persiste un estado distinto de la decisión final del agente.

---

## 3. Contratos

### 3.1 Ciclo del agente — `AgentLoopV3`

Function calling nativo de DeepSeek sobre `https://api.deepseek.com/responses`,
modelo `deepseek-v4-flash`. El loop tiene un presupuesto duro.

```
MAX_TOOL_ITERATIONS = 3
MAX_TOOL_CALLS_PER_ITERATION = 4
AGENT_LOOP_DEADLINE_MS = 12_000   // hoy AGENT_A_BRAIN_DEEPSEEK_DEADLINE_MS = 10_000
```

Cada iteración: el modelo devuelve `tool_calls[]` **o** el objeto final
`AgentTurnDecisionV3`. Al agotarse el presupuesto sin respuesta final, el turno
falla cerrado (§5.3).

Herramientas y respuesta final coexisten en el mismo hilo. El `turn_rejection`
actual se convierte en un `tool_result` de la herramienta virtual
`integrity_check`, no en un re-prompt separado.

### 3.2 Sobre de resultado de herramienta

Todas las herramientas devuelven la misma forma, sin excepción:

```ts
interface ToolResultV1<T> {
  readonly tool: string;
  readonly success: boolean;
  readonly canonical_data: T | null;
  readonly error_code: string | null;
  readonly recoverable: boolean;
  readonly idempotency_result: 'applied' | 'duplicate' | 'not_applicable';
}
```

Una herramienta puede validar integridad técnica —IDs existentes, idempotencia,
autenticación, parámetros—. **Nunca dirige la conversación.** Un fallo vuelve al
agente y es el agente quien decide qué decir.

### 3.3 Las ocho herramientas

| Herramienta | Efecto | Origen actual | `canonical_data` |
|---|---|---|---|
| `search_catalog` | lectura | `GET /api/agent/tools/catalog` | `{ offerings[], areas[], prices_assertable }` |
| `get_course_information` | lectura | `GET /api/agent/tools/catalog/[sku]` | `{ code, display_name, delivery, description, facts[] }` |
| `get_payment_options` | lectura | `PAYMENT_PLAN_PRESENTATIONS` | `{ plans[] }` con `fact_id` por plan |
| `save_contact_details` | escritura idempotente | `loadContactIntakeV1` + upsert | `{ recorded[], still_missing[] }` |
| `create_payment_link` | escritura idempotente | `materializePaymentLinkAction` | `{ label, url, offering_code, payment_plan }` |
| `request_call` | escritura idempotente | `reserveCallForDecision` | `{ call_id, status }` |
| `save_memory` | escritura idempotente | `enqueueAgentAMemoryProjectionJobs` | `{ accepted[], rejected[] }` |
| `project_lead` | escritura idempotente | `flushLeadProjection` | `{ queued: boolean }` |

`create_payment_link` devuelve el bloque `{label, url}` **como dato**, no como
texto anexado. El agente lo incorpora a su redacción. La URL sigue siendo la
única frontera que falla cerrado sobre el turno completo (§5.2).

Idempotencia: `create_payment_link` y `request_call` se clavan por
`(conversation_id, offering_code, payment_plan)` y por `call_id`
respectivamente, replicando el dedupe que hoy vive en `decision.service.ts:750-765`.
Un segundo pedido devuelve `idempotency_result: 'duplicate'` con el mismo
`canonical_data`, y el agente decide cómo referirse a él.

### 3.4 Respuesta final — `AgentTurnDecisionV3`

```ts
interface AgentTurnDecisionV3 {
  readonly schema_version: 3;
  readonly messages: readonly string[];      // el mensaje visible, textual
  readonly used_fact_ids: readonly string[];
  readonly used_memory_ids: readonly string[];
  readonly memory_candidates: readonly MemoryCandidateV1[];
  readonly state: {                          // el agente declara la transición
    readonly selected_offering_code: string | null;
    readonly selected_payment_plan: SalesPaymentPlan | null;
    readonly stage: SalesContextStage;
    readonly call_preference: CallPreferenceV1;
    readonly call_offer_status: CallOfferStatusV1;
    readonly call_offer_count: 0 | 1 | 2;
    readonly awaiting_reply: AwaitingReplyV1;
  };
  readonly response_type: DecisionV4['response_type'];  // declarado, no inferido
}
```

Los campos `state` y `response_type` son la reparación estructural del bug §1.4:
el agente **declara** la transición y el tipo de respuesta en vez de que el
backend los infiera leyendo su prosa. El control de integridad los **verifica**
contra política; nunca los recalcula.

### 3.5 Control final de integridad

Corre una sola vez sobre `AgentTurnDecisionV3`. Sólo puede:

- **aceptar**, o
- **devolver un `IntegrityRejectionV1` al agente** como `tool_result` de
  `integrity_check`.

Nunca recorta, reemplaza ni modifica el texto por su cuenta. Tiene **una sola
excepción, declarada y medida**: el piso anti-silencio de §3.5.1. Fuera de ese
piso, cualquier modificación de texto por parte del control es un defecto.

```ts
interface IntegrityRejectionV1 {
  readonly rejection_id: string;
  readonly attempt: 1;
  readonly violations: readonly { code: string; subject: string; detail?: string }[];
  readonly authorized_alternatives: {
    readonly fact_ids: readonly string[];
    readonly actions: readonly string[];
    readonly missing_information: readonly string[];
  };
}
```

Verificaciones (todas rechazan, ninguna poda):
valor de hechos contra el registro canónico; URL contra `authorized_urls`;
promesas prohibidas; política de llamada (`call_offer_count`, decline previo);
intake completo antes de un link de pago; coherencia entre `state` declarado y
los efectos que el agente realmente ejecutó vía herramientas.

#### 3.5.1 Piso anti-silencio (deuda explícita, decisión del 4-sep-2026)

Una sola
devolución al agente. Si la segunda respuesta también viola integridad, se
conserva la poda mínima actual para no dejar el turno mudo — un turno mudo fue el
peor resultado observado en `wf_03_plan_postergacion_link` — y **cada uso emite
`agent_loop_integrity_floor_used`**. La poda deja de ser comportamiento normal;
pasa a ser un piso medido. La métrica es el criterio de salud: si sube, el
problema está en el prompt o en las herramientas, no en el guard.

### 3.6 Memoria

El orquestador entrega estado, historial reciente, recuerdos relevantes,
resultados de herramientas previas y datos confirmados del contacto. El agente
decide qué recuerdos usa (`used_memory_ids`) y qué recuerdos escribe
(`save_memory`). `withDeterministicMemories` (`decision-policy.ts:489`) se
elimina: el backend deja de inyectar memorias que el agente no pidió.

Una corrección del cliente invalida la memoria anterior **antes del próximo
turno**: `save_memory` acepta `supersedes: string[]` y la proyección marca las
superadas como inactivas en la misma transacción del commit.

---

## 4. Archivos afectados

### 4.1 Se eliminan

| Archivo | Motivo |
|---|---|
| `src/features/conversation/domain/conversation-planner.ts` (638 l.) | El planner ya está muerto en esta ruta (`timings.planner_ms = 0`) |
| `botpress-agent/src/prompts/conversation-composer-v1.ts` / `-v2.ts` | El compositor desaparece con el agent loop |
| `botpress-agent/src/lib/conversation/conversation-composer.ts` | Ídem, salvo `lastAgentReplyV1` que se mueve al context builder |
| `botpress-agent/src/actions/planConversation.ts` + `src/app/api/agent/turns/[turn_id]/plan/route.ts` | Sin planner no hay endpoint de plan |
| `botpress-agent/src/lib/conversation/resolve-agent-a-proposal.ts` | Ruta legacy con planner |

### 4.2 Se reescriben

| Archivo | Cambio |
|---|---|
| `botpress-agent/src/lib/conversation/agent-a-brain.ts` | Añadir `tools[]`, parseo de `tool_calls`, loop de iteraciones |
| `botpress-agent/src/workflows/processInboundTurn.ts` | Reemplazar el bloque `brainEligible` (líneas 596-850) por `runAgentLoopV3` |
| `botpress-agent/src/lib/conversation/agent-a-context.ts` | Borrar los dos binders (§1.1 capas 1 y 2); conservar la construcción de contexto |
| `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts` | Queda como cliente delgado del loop: alimenta el `tool_result` de `integrity_check` con el veredicto y aplica el piso medido. La lógica de verificación vive en el backend (§4.3), no acá; el lado Botpress no tiene su propio criterio |
| `src/features/conversation/domain/agent-turn-policy-v2.ts` | De autor a autorizador: verifica el `state` declarado, no lo recalcula. Se va `dropUnsupportedStateAssertionsV1` del hot path y la materialización de `send_payment_link` (línea 253) |
| `src/features/conversation/application/prepare-agent-turn-v2.ts` | `decisionFromAuthorizedTurn` usa el `response_type` declarado; se va `solicitsACall()` |
| `src/lib/services/decision.service.ts` | El texto que se persiste es exactamente `messages.join('\n\n')`. Se van la concatenación del bloque de pago y la sustitución por fallback técnico |
| `src/features/orchestration/domain/commercial-truth-guard.ts` | `enforceCommercialTruthV1` devuelve violaciones; deja de podar y de decidir |
| `botpress-agent/src/utils/decision-policy.ts` | Se van `withoutRepeatedGreeting` y `withDeterministicMemories` |

### 4.3 Se crean

| Archivo | Contenido |
|---|---|
| `botpress-agent/src/lib/conversation/agent-loop-v3.ts` | El loop |
| `botpress-agent/src/lib/conversation/agent-tools-v3.ts` | Definiciones de las 8 herramientas + despacho |
| `botpress-agent/src/schemas/agent-turn-v3.ts` | `AgentTurnDecisionV3`, `ToolResultV1`, `IntegrityRejectionV1` |
| `src/features/conversation/domain/integrity-check-v3.ts` | Control final |
| `src/app/api/agent/tools/*` | Endpoints faltantes para las 5 herramientas de escritura |
| `botpress-agent/src/lib/conversation/agent-loop-shadow.ts` | Comparador de rutas |

### 4.4 Se conservan intactos

`claimBatch`, `ingestTurn`, `reportDelivery`, `dispatchCall`,
`verifyAuthorizedEgressPortable`, la ventana de batch, el fencing por
`claim_token` y la idempotencia por `turn_id`. Nada de la capa de transporte
cambia.

---

## 5. Estrategia de migración

Bandera nueva: `agentAAgentLoopV3Mode: 'off' | 'shadow' | 'authoritative'`
(`botpress-agent/agent.config.ts`), por defecto `'off'`. La ruta
`plannerless_v2` actual sigue viva y sin tocar durante toda la transición.

### Fase 0 — Reparar el bug de transición (independiente)

Regla: **no se persiste una transición calculada sobre texto que no se entregó.**

Implementación elegida en `decision.service.ts:1259`: cuando
`verdict.removed.length > 0`, el turno falla cerrado hacia la ruta de reparación
existente en vez de escribir `preparedAgentTurn.transition`. Se descarta
recomputar la transición sobre el texto post-veto: eso sería el backend
decidiendo el estado por su cuenta otra vez, que es exactamente lo que esta
migración elimina.

No depende del agent loop y **debe ir primero**: mientras el estado mienta,
ninguna comparación de rutas es interpretable. Es también el único cambio de
esta especificación que corrige un defecto ya activo en producción.

### Fase 1 — Herramientas sin loop

Se construyen las 8 herramientas y sus endpoints, con sus tests de contrato e
idempotencia. La ruta actual las consume internamente donde hoy llama a las
mismas funciones. Cero cambio de comportamiento observable.

### Fase 2 — Loop en shadow local

`mode='shadow'` en el arnés de workflow (`tests/workflow/`) y en la matriz de
evals, **contra el cluster desechable en 127.0.0.1:55433**, nunca contra el
pooler de producción. Se comparan por turno:

- respuesta del sistema actual vs. del nuevo agente (diff textual + juicio de
  calidad comercial con la rúbrica que existe pero nunca se corrió);
- herramientas solicitadas vs. efectos que la ruta actual produjo;
- estado resultante (`stage`, `awaiting_reply`, `call_offer_count`, plan, oferta);
- latencia p50/p95;
- `integrity_floor_used`.

**Puerta de salida:** cero divergencias de estado no explicadas, cero turnos
mudos en `wf_01..wf_04`, p95 ≤ 8.000 ms, `integrity_floor_used` ≤ 2 %.

### Fase 3 — Shadow en producción sobre allowlist

`mode='shadow'` en turnos reales, restringido a `AGENT_LOOP_V3_CANARY_PHONE_E164S`
(mismo patrón que `WHATSAPP_CANARY_PHONE_E164S`, `agent.config.ts:75`). El nuevo
loop corre **sin efectos**: las herramientas de escritura se ejecutan en modo
`dry_run` y devuelven `idempotency_result: 'not_applicable'`. Sólo entrega la
ruta actual.

Duración mínima: 200 turnos reales o 5 días, lo que llegue después.

**Puerta de salida:** las mismas métricas de Fase 2 sobre tráfico real, más
costo de DeepSeek por turno dentro de presupuesto.

### Fase 4 — Promoción

`mode='authoritative'` sobre el allowlist, después ampliación por lotes. La ruta
vieja queda intacta detrás de la bandera durante al menos dos semanas antes de
borrar código.

---

## 6. Pruebas

| Nivel | Qué cubre | Dónde |
|---|---|---|
| Unidad | Cada herramienta: éxito, fallo recuperable, fallo no recuperable, duplicado | `tests/unit/conversation/agent-tools-v3.test.ts` |
| Unidad | Control de integridad: acepta, rechaza, **nunca modifica el texto** (test de identidad de string) | `tests/unit/conversation/integrity-check-v3.test.ts` |
| Unidad | Presupuesto del loop: agotamiento de iteraciones, deadline, tool_call malformada | `tests/unit/conversation/agent-loop-v3.test.ts` |
| Integración | El estado persistido == `decision.state` declarado, en los 7 escenarios comerciales | `tests/workflow/agent-a-persisted-outcomes.test.ts` (extender) |
| Integración | Un fallo de herramienta llega al agente y el agente reacciona (no lo tapa el backend) | nuevo `tests/workflow/agent-loop-tool-failure.test.ts` |
| Workflow | `wf_01..wf_04` con `processInboundTurn` real, cero turnos mudos | `tests/workflow/` |
| RED primero | Un test que hoy falla: veto parcial + transición persistida (bug §1.4) | Fase 0 |

Regla que no se negocia: **todo test de integración exige `TEST_DATABASE_URL`
apuntando al cluster desechable.** `tests/setup/integration.ts` pisa
`DATABASE_URL` siempre, nunca con `??=`.

---

## 7. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Latencia: 3 iteraciones × ~2 s contra un deadline de 8 s de Telegram | **Alta** | `MAX_TOOL_ITERATIONS = 3` duro; herramientas de lectura precargadas en el contexto cuando el turno es predecible; p95 es puerta de fase |
| DeepSeek `deepseek-v4-flash` con function calling: comportamiento no verificado en este stack | **Alta** | Fase 1 valida el contrato de tools con un smoke aislado antes de construir el loop |
| Costo: el shadow en producción duplica llamadas al modelo | Media | Allowlist acotado + ventana temporal fija |
| El agente declara un `state` incoherente con los efectos que ejecutó | Media | El control de integridad cruza `state` contra los `tool_result` del turno y rechaza |
| Regresión comercial invisible: menos podas puede significar más afirmaciones falsas entregadas | **Alta** | El control de integridad rechaza en vez de podar; la rúbrica de calidad comercial se corre por primera vez en Fase 2 |
| Paridad de prompt con el bundle desplegado en Botpress Cloud sigue sin verificar (§1.5) | **Alta** | Bloqueante para Fase 4: se necesita acceso al Control Panel o a la API de Botpress para confirmar el bundle |
| El bug §1.4 ya contaminó estado real en producción | Media | Fase 0 corrige el mecanismo; la limpieza de `call_offer_count` histórico es una decisión aparte |

---

## 8. Rollback

Cada fase revierte sin migración de datos:

- **Fases 1-3:** `agentAAgentLoopV3Mode = 'off'`. La ruta `plannerless_v2` no fue
  modificada; el rollback es un cambio de configuración en Botpress, sin deploy.
- **Fase 4:** `mode = 'shadow'`, después `'off'`. Los turnos ya entregados por el
  loop quedan persistidos y son válidos: `AgentTurnDecisionV3` escribe en las
  mismas tablas y columnas que la ruta actual.
- **Fase 0:** es un fix de una condición; revierte con un `git revert` y no tiene
  bandera. Su rollback deja el bug, no rompe nada más.

No hay migración de esquema en ninguna fase. `agent_decisions`,
`conversation_state_v1` y `sales_context` conservan su forma. El único campo
nuevo es `supersedes` en el payload de `save_memory`, que es JSONB existente.

---

## 9. Lo que esta especificación deja fuera a propósito

- La limpieza del estado histórico contaminado por el bug §1.4.
- La verificación del bundle desplegado en Botpress Cloud (requiere acceso del
  usuario al Control Panel).
- Agente B (voz). El loop es de Agent A.
- Cualquier cambio al prompt canónico. El prompt es el siguiente frente de
  trabajo, y sólo tiene sentido tocarlo cuando sus ajustes efectivamente lleguen
  a producción — que es precisamente lo que esta migración habilita.
