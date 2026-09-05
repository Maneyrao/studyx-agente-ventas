# Agent A como agente: migración del rule engine a un agent loop

Fecha: 2026-09-04
Rama base: `codex/agent-a-plannerless-v2` @ `6a1398c`
Revisión: 2 (enmiendas 1-11 del 4-sep-2026 incorporadas)
Estado: especificación aprobada para planificar. **Nada de esto está implementado.**

---

## 0. Inventario previo del worktree (enmienda 11)

El worktree tiene **nueve archivos rastreados modificados** que **no son de esta
sesión**. Mtimes 22:22–22:28 del 2026-09-04, minutos antes de que empezara este
trabajo. Origen: sesión previa (Codex), sin commitear.

| Archivo | Cambio |
|---|---|
| `botpress-agent/src/utils/payment-choice.ts` | Patrón `one_time` acepta «un pago de 360» |
| `src/features/payments/domain/payment-choice-policy.ts` | Espejo backend del mismo patrón |
| `src/features/orchestration/domain/catalog-resolution.ts` | `CATALOG_REPLACEMENT_AFTER_REJECTION_PATTERN` («ninguno, mejor el de X») + cue `el`/`la` en `partialSubjectMatches` |
| `src/lib/heuristics/contact-identity.ts` | Parseo «Apellido, Nombre es mi nombre» |
| `tests/unit/botpress/payment-choice-mirror.test.ts` | +1 caso |
| `tests/unit/payments/payment-link.test.ts` | +1 caso («un pago de 360») |
| `tests/unit/orchestration/catalog-resolution.test.ts` | +1 caso |
| `tests/unit/heuristics/contact-identity.test.ts` | +1 caso |
| `tests/unit/scripts/agent-a-api-budget.test.ts` | Tope de presupuesto 1,00 → 1,08 USD |

Tema coherente: **endurecimiento de heurísticas léxicas**, cada fix con su test.

**Decisión del usuario (4-sep-2026): NO se integran.** Contradicen la regla de no
seguir agregando regex para frases puntuales, y cuatro de ellos parchean
justamente los módulos que esta migración saca del hot path (`payment-choice`,
`payment-choice-policy`, `catalog-resolution`, `contact-identity`).

**Estado ejecutado:** los nueve archivos fueron restaurados a HEAD. El working
tree está limpio. **No se hizo cherry-pick de `58e7dd6`.**

**Preservación (dos rutas, ambas verificadas):**
- Patch acotado: `.git/preserved/preexisting-lexical-hardening-20260904.patch`
  (11.545 bytes). Recuperación: `git apply <ruta>`.
- Tag `wip/pre-agent-loop-lexical-hardening` → `58e7dd6`. **Ojo:** el snapshot es
  de la revisión 1 de esta spec, así que un `git diff HEAD wip/...` completo
  también revertiría el documento. La recuperación por tag debe acotarse a las
  nueve rutas.

### 0.1 Consecuencia medida: HEAD queda con tres tests rojos

Uno de los nueve archivos no era un regex nuevo: reparaba
`tests/unit/scripts/agent-a-api-budget.test.ts`. En HEAD,
`scripts/agent-a-api-budget.mjs:9` exige `AUTHORIZED_LIMIT_USD = 1.08` y el test
sigue construyendo el ledger con `limitUsd: 1`, así que toda mutación falla con
`AGENT_A_BUDGET_INVALID`.

```
Test Files  1 failed (1)
     Tests  3 failed | 4 passed (7)
```

**Esto bloquea el arranque:** no se puede hacer TDD sobre una suite roja, y ese
ledger es exactamente el mecanismo que gobierna el gasto del smoke de Fase 1
(§5). La reparación **no es** uno de los nueve cambios rechazados: es un fix
independiente que la Tarea 0.1 del plan resuelve por su cuenta, moviendo el tope
a configuración (§5, Fase 1).

---

## 1. Diagnóstico: la hipótesis se confirma

Agent A no es un agente. Es un generador de propuestas dentro de un rule engine.

DeepSeek emite **una sola llamada de salida estructurada**
(`response_format: json_schema`, `botpress-agent/src/lib/conversation/agent-a-brain.ts:135-190`).
No hay array `tools`, no hay `tool_calls`, no hay resultados de herramientas, no
hay segunda vuelta salvo una reparación opcional apagada por defecto.

### 1.1 Las ocho capas que reinterpretan la propuesta

| # | Capa | Archivo | Qué hace |
|---|---|---|---|
| 1 | `bindCurrentCatalogResolutionToMoveV1` | `botpress-agent/src/lib/conversation/agent-a-context.ts:68` | Pisa `move` a `unknown` cuando `catalog_resolution.kind === 'ambiguous'` |
| 2 | `bindCurrentConversationalIntentToMoveV1` | `botpress-agent/src/lib/conversation/agent-a-context.ts:98` | Reescribe el move primario e **inyecta `secondary_moves` derivados de regex** |
| 3 | `resolveAgentAPlannerlessProposalV2` | `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts` | Cuatro podas de texto sin consultar al modelo, más `mayDegradeToBackendBoundary` |
| 4 | `applyDecisionPolicy` | `botpress-agent/src/utils/decision-policy.ts:531` | `withoutRepeatedGreeting` + `withDeterministicMemories` |
| 5 | **`authorizeAgentTurnV2`** | `src/features/conversation/domain/agent-turn-policy-v2.ts:117` | Poda oraciones, recomputa la transición completa, y **materializa `send_payment_link` aunque el modelo haya propuesto `none`** (línea 253) |
| 6 | `decisionFromAuthorizedTurn` | `src/features/conversation/application/prepare-agent-turn-v2.ts:78` | Deriva `response_type` leyendo la prosa con `solicitsACall()` |
| 7 | `materializePaymentLinkAction` / `proseWithoutUrls` | `src/lib/services/decision.service.ts:770-795` | Reescribe el texto final |
| 8 | `enforceCommercialTruthV1` | `src/features/orchestration/domain/commercial-truth-guard.ts:396` | Veto por oración; si no sobrevive ninguna, **sustituye en silencio** por `resolveTechnicalFallbackV1` |

`verifyAuthorizedEgressPortable` (`processInboundTurn.ts:1264`) es la única capa
que ya cumple el contrato deseado: verifica un hash, no modifica nada.

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
(`agent-turn-policy-v2.ts:172`). Un veto **parcial** de `enforceCommercialTruthV1`
deja `preparedAgentTurn` no-nulo, y `decision.service.ts:1259-1260` escribe esa
transición igual.

Consecuencias: `call_offer_count` incrementado por una invitación que el cliente
nunca recibió; `stage='payment_link_sent'` con la oración borrada;
`awaiting_reply` esperando respuesta a una pregunta que se podó. Sólo la
supresión **total** anula la transición (`decision.service.ts:902-903`).

Esto explica el síntoma reportado: **un ajuste válido del prompt no se refleja en
producción** porque el estado que condiciona el turno siguiente no lo escribe el
agente. La enmienda 5 (§3.6) lo convierte en imposible por construcción, no sólo
en corregido.

### 1.5 Contrato real de DeepSeek (verificado en la documentación)

- `/responses` **sí** acepta `tools` (Responses API › Request › Body › tools).
  Nombres de función únicos, no vacíos, con restricciones de caracteres.
- La salida trae items `type: "function_call"` con `call_id`, `name` y
  `arguments` (string JSON). El fin del loop es la ausencia de `function_call`.
- `incomplete_details.reason` puede ser `max_output_tokens`. El código actual fija
  `max_output_tokens: 800`, insuficiente para un loop con artefactos.
- **Gotcha documentado:** con thinking mode, `reasoning_content` es obligatorio en
  cada request posterior o la API devuelve 400. El código actual usa
  `reasoning: { effort: 'none' }`; el loop debe preservar y reenviar los items de
  razonamiento si esa configuración cambia.
- Los ejemplos oficiales de tool calling usan `deepseek-v4-pro`. El repo corre
  `deepseek-v4-flash`.

El riesgo ya no es si la capacidad existe. Es la compatibilidad concreta de
`deepseek-v4-flash` + `/responses` + este contrato de herramientas. **El smoke de
Fase 1 sigue siendo obligatorio y bloqueante.**

---

## 2. Arquitectura objetivo

```
mensaje
  → contexto (estado + historial + memoria + intake)
  → Agent Core loop ──┐
        ↑             │ tool_calls (read | prepare)
        │             ↓
   tool_results ← ToolExecutor
        │
        ├─ integrity_check (devolución INTERNA del orquestador, no herramienta)
        ↓
  → respuesta final: bloques tipados + state_patch
  → renderer (materializa referencias; no interpreta)
  → commit atómico: decisión + efectos preparados + patch inmediato + outbox
  → entrega
  → patch diferido (sólo al aceptarse/entregarse el outbound)
```

### 2.1 Invariantes

1. **El texto entregado es exactamente el que produjo el renderer** a partir de
   los bloques del agente. Ninguna capa posterior lo modifica.
2. **El estado persistido es exactamente el `state_patch` del agente**, aplicado
   sobre la versión que el agente declaró haber visto.
3. **Un contador ligado a visibilidad sólo avanza con un outbound aceptado.**
4. **Un efecto comercial se prepara antes del turno y se commitea una sola vez**,
   dentro de la transacción del turno aceptado.
5. **Ninguna capa produce texto comercial.** El único texto que el sistema puede
   escribir por su cuenta es el fallback técnico de §3.8, que no contiene hechos
   comerciales, acciones ni transición.
6. **Todo turno es atribuible a un release verificable** (§3.9).

### 2.2 Qué deja de hacer el backend

No reinterpreta el mensaje (capas 1, 2 se eliminan). No elige el recorrido
comercial (capa 5 pasa de autor a autorizador). No modifica el `move`. No compone
respuestas (capa 7 pasa a devolver un artefacto, no texto). No poda narrativa
(capas 3, 8). No infiere acciones leyendo prosa. No reemplaza la respuesta en
silencio. No persiste un estado distinto de la decisión del agente.

---

## 3. Contratos

### 3.1 Núcleo independiente (enmienda 1)

El loop vive en `agent-core/`, un paquete TypeScript **sin ninguna dependencia de
Botpress, de Next.js ni de Postgres**. Botpress pasa a ser un adaptador, y Retell
podrá ser otro sobre el mismo cerebro.

```
agent-core/
  src/
    loop.ts                  # runAgentTurn: el ciclo, agnóstico de canal
    ports/
      model-provider.ts      # ModelProvider
      tool-executor.ts       # ToolExecutor
      memory-store.ts        # MemoryStore
      channel-adapter.ts     # ChannelAdapter
    domain/
      response-blocks.ts     # ResponseBlockV3 y renderer
      state-patch.ts         # StatePatchV3 y clasificación de visibilidad
      integrity.ts           # IntegrityRejectionV1 (tipos; la verificación es del backend)
      release-manifest.ts
```

```ts
interface ModelProvider {
  generate(input: {
    readonly instructions: string;
    readonly conversation: readonly ModelTurnItemV3[];
    readonly tools: readonly ToolDefinitionV3[];
    readonly deadline_ms: number;
    readonly signal: AbortSignal;
  }): Promise<ModelOutputV3>;   // { tool_calls[] } | { decision }
}

interface ToolExecutor {
  execute(call: ToolCallV3, ctx: TurnContextV3): Promise<ToolResultV1<unknown>>;
}

interface MemoryStore {
  relevant(ctx: TurnContextV3): Promise<readonly MemoryV1[]>;
  stage(candidates: readonly MemoryCandidateV3[]): Promise<PreparationRefV3>;
}

interface ChannelAdapter {
  readonly channel: 'telegram' | 'whatsapp' | 'voice';
  /** Un canal de voz no entrega bloques idénticos a uno de texto. */
  render(blocks: readonly ResponseBlockV3[], artifacts: ArtifactTableV3): RenderedTurnV3;
  readonly constraints: { readonly max_messages: number; readonly supports_urls: boolean };
}
```

`ChannelAdapter.constraints.supports_urls === false` es lo que hará que Retell
(voz) nunca reciba un bloque de link: el mismo cerebro, distinta materialización.

Adaptadores: `botpress-agent/src/adapters/` (ModelProvider DeepSeek, ToolExecutor
sobre las acciones ADK, ChannelAdapter Telegram/WhatsApp) y `src/adapters/`
(ToolExecutor server-side sobre Postgres). El núcleo no importa de ninguno.

### 3.2 Presupuesto del loop (enmienda 7)

Objetivo operativo: **`event_to_visible_outbound_ms` p95 < 10.000**, incluyendo la
ventana de batching. Ya existe el medidor y su bandera de exceso
(`processInboundTurn.ts:1345-1350`).

| Etapa | Presupuesto p95 |
|---|---|
| Ventana de batch (debounce) | 2.000 ms |
| ingest + claim | 400 ms |
| **Agent Core loop** | **6.500 ms** |
| Integridad + commit | 700 ms |
| Verificación de egress + envío | 400 ms |
| **Total** | **10.000 ms** |

```
MAX_TOOL_ROUNDS = 2                  // dos rondas de herramientas, no tres
MAX_TOOL_CALLS_PER_ROUND = 4         // paralelas dentro de la ronda
AGENT_LOOP_DEADLINE_MS = 6_500       // presupuesto total del cerebro
ROUND_SOFT_DEADLINE_MS = 2_600       // si la ronda 1 lo excede, no hay ronda 2
MAX_OUTPUT_TOKENS = 1_600            // 800 era insuficiente (§1.5)
```

Al agotarse el presupuesto sin respuesta final, el turno cae al fallback técnico
de §3.8. Nunca queda mudo.

### 3.3 Herramientas: lectura, preparación y efecto (enmienda 3)

Tres clases, con garantías distintas.

**Lectura** — sin efectos, repetible, cacheable por turno.

| Herramienta | `canonical_data` |
|---|---|
| `search_catalog` | `{ offerings[], areas[], prices_assertable }` |
| `get_course_information` | `{ code, display_name, delivery, description, facts[] }` |
| `get_payment_options` | `{ plans[] }` con `fact_id` por plan |

**Preparación** — reserva y devuelve un artefacto canónico. **No produce ningún
efecto definitivo ni visible para el cliente.** Devuelve un `preparation_id`.

| Herramienta | Artefacto reservado |
|---|---|
| `prepare_contact_details` | `{ recorded[], still_missing[] }` |
| `prepare_payment_link` | `{ label, url, offering_code, payment_plan }` |
| `prepare_call_request` | `{ call_id, status: 'reserved' }` |
| `prepare_memory` | `{ accepted[], rejected[], supersedes[] }` |
| `prepare_lead_projection` | `{ queued: false }` |

**Efecto** — **el modelo no las puede llamar.** El orquestador commitea, una sola
vez y dentro de la transacción de la decisión, exactamente las preparaciones que
la respuesta final lista en `commit_preparations`, y encola las proyecciones
externas en el outbox existente.

`commit_preparations` es explícito y no se infiere de los bloques: una reserva de
llamada produce un efecto sin bloque visible (el agente lo cuenta en narrativa),
así que deducir el conjunto a commitear de las referencias del texto perdería ese
caso. Toda preparación **ausente** de esa lista **se descarta**: el agente pidió
un link y después decidió no ofrecerlo, y eso no puede cobrarle a nadie.

Reglas de la clase preparación:
- Idempotencia por `(conversation_id, tool, canonical_key)`. Un segundo pedido
  devuelve `idempotency_result: 'duplicate'` con el mismo `canonical_data`.
- La reserva vence con el turno: un `preparation_id` no commiteado se libera.
- El commit es **exactamente una vez** — garantizado por el `turn_id` único de la
  decisión y por el outbox, no por el modelo.

Sobre común, sin excepciones:

```ts
interface ToolResultV1<T> {
  readonly tool: string;
  readonly success: boolean;
  readonly canonical_data: T | null;
  readonly error_code: string | null;
  readonly recoverable: boolean;
  readonly idempotency_result: 'applied' | 'duplicate' | 'not_applicable';
  readonly preparation_id: string | null;   // sólo clase preparación
}
```

Una herramienta valida integridad técnica —IDs, idempotencia, autenticación,
parámetros—. **Nunca dirige la conversación.** Un fallo vuelve al agente y el
agente decide qué decir.

### 3.4 Respuesta final: bloques tipados (enmienda 2)

`messages: string[]` desaparece. Un string libre permite volver a inventar un
precio o un link; los bloques lo hacen imposible por tipo.

```ts
type ResponseBlockV3 =
  | { readonly type: 'narrative'; readonly text: string }
  | { readonly type: 'fact'; readonly fact_id: string }
  | { readonly type: 'artifact'; readonly preparation_id: string };

interface AgentTurnDecisionV3 {
  readonly schema_version: 3;
  readonly blocks: readonly ResponseBlockV3[];
  readonly commit_preparations: readonly string[];       // preparation_id a commitear
  readonly used_memory_ids: readonly string[];
  readonly state_patch: StatePatchV3;
  readonly response_type: DecisionV4['response_type'];   // declarado, no inferido
}
```

**El renderer sólo materializa.** Un bloque `fact` se reemplaza por el valor
renderizado del registro canónico; un bloque `artifact`, por el bloque canónico
de esa preparación. El renderer no interpreta, no reescribe, no reordena, no poda.

**El bloque `narrative` es prosa libre del agente con una restricción
estructural, verificada por el control de integridad**, nunca podada:

- una URL en un `narrative` ⇒ `NARRATIVE_CONTAINS_URL` (rechazo);
- un importe monetario en un `narrative` ⇒ `NARRATIVE_CONTAINS_AMOUNT` (rechazo);
- una duración numérica de curso en un `narrative` ⇒ `NARRATIVE_CONTAINS_DURATION`
  (rechazo).

Precios, links y duraciones sólo pueden viajar como `fact` o `artifact`. Eso
elimina la invención por construcción, y elimina también la razón de existir de
`enforceCommercialTruthV1` como podadora: no hay valor comercial en prosa que
podar.

### 3.5 `integrity_check` es interno, no una herramienta (enmienda 9)

El control de integridad **no aparece en `tools[]`**. El modelo no lo elige.

Cuando el control rechaza, el orquestador inyecta el `IntegrityRejectionV1` en el
hilo como un item de entrada del propio orquestador (rol de sistema/desarrollador,
según lo que acepte `/responses`), no como `role: 'tool'`. El agente lo lee y
produce una segunda respuesta final. **Una sola devolución por turno.**

```ts
interface IntegrityRejectionV1 {
  readonly rejection_id: string;
  readonly attempt: 1;
  readonly violations: readonly { code: string; subject: string; detail?: string }[];
  readonly authorized_alternatives: {
    readonly fact_ids: readonly string[];
    readonly preparations: readonly string[];
    readonly missing_information: readonly string[];
  };
}
```

Verificaciones (todas rechazan; **ninguna poda, ninguna reescritura**):
restricción estructural de los `narrative` (§3.4); `fact_id` existente y
autorizado; `preparation_id` existente, del turno y no vencido; política de
llamada; intake completo antes de commitear una preparación de pago; coherencia
entre `state_patch` y `commit_preparations` (un `stage: payment_link_sent` sin la
preparación de pago en la lista, o al revés, es un rechazo);
`expected_state_version` idéntico al del contexto.

### 3.6 `state_patch` con versión esperada (enmienda 4)

El agente **no reemplaza la fotografía de estado**. Declara qué cambia y sobre qué
versión.

```ts
interface StatePatchV3 {
  readonly expected_state_version: number;
  readonly set: Partial<{
    selected_offering_code: string | null;
    selected_payment_plan: SalesPaymentPlan | null;
    stage: SalesContextStage;
    call_preference: CallPreferenceV1;
    call_offer_status: CallOfferStatusV1;
    call_offer_delta: 0 | 1;          // delta, nunca un valor absoluto
    awaiting_reply: AwaitingReplyV1;
    payment_reported: boolean;
  }>;
}
```

`call_offer_delta` reemplaza a `call_offer_count`: un contador es del sistema, y
el agente sólo puede declarar que hizo una invitación más, no fijar el total.

`expected_state_version` no lo inventa el agente: el contexto del turno lo trae
como `state.version`, leído en el mismo `claimBatch` que arma la fotografía. El
agente lo devuelve tal cual; alterarlo es una violación de integridad.

**La tabla es `conversation_sales_context_states_v1`** (no `conversation_state_v1`,
que no existe). Su tabla de eventos es
`conversation_sales_context_state_events_v1`.

**La columna `version` ya existe y ya funciona.**
`postgres-conversation-state-store.ts:136` la incrementa en cada `DO UPDATE`
(`version = conversation_sales_context_states_v1.version + 1`) y la copia al
evento como `state_version`. **No hace falta migración.** Lo único que falta es
exponerla: `load()` hace `SELECT state.*`, así que el valor ya viaja en la fila,
pero `ConversationStateV1` no lo mapea hacia el contexto ni nadie lo compara al
commitear.

Concurrencia optimista: el commit falla con `STATE_VERSION_CONFLICT` si
`conversation_sales_context_states_v1.version != expected_state_version`. Ese
conflicto **no se resuelve fusionando**: el turno se reintenta completo con el
estado nuevo, porque un patch calculado sobre otra fotografía ya no significa lo
mismo.

### 3.7 Estado ligado a visibilidad (enmienda 5)

El `state_patch` aceptado se parte en dos por una clasificación **estática** de
campos, no por juicio del modelo:

| Campo | Momento | Por qué |
|---|---|---|
| `selected_offering_code`, `selected_payment_plan` | inmediato | Lo declaró el cliente |
| `call_preference`, `call_offer_status ∈ {accepted, declined}` | inmediato | Lo declaró el cliente |
| `payment_reported` | inmediato | Lo declaró el cliente |
| `stage ∈ {course_selected, plan_selected, closed}` | inmediato | Refleja un hecho del cliente |
| **`call_offer_delta`** | **diferido** | Depende de que el cliente vea la invitación |
| **`call_offer_status = 'offered'`** | **diferido** | Ídem |
| **`awaiting_reply`** | **diferido** | Es «lo que pregunté»; sin mensaje no hay pregunta |
| **`stage ∈ {payment_link_sent, handoff}`** | **diferido** | Refleja algo que el agente entregó |

#### Aceptado ≠ entregado

`outbound_deliveries` distingue dos estados terminales distintos, y la máquina de
estados del esquema los separa
(`20260805010005_phase1_outbox_delivery.sql:279`):

| Estado | Qué prueba | Quién lo escribe |
|---|---|---|
| `submitted` | **Aceptación**: el canal tomó el mensaje de forma irrevocable (`createMessage` devolvió un id). **No prueba que el cliente lo haya visto.** | `reportDelivery` desde el workflow |
| `delivered` | **Entrega**: el proveedor confirmó la entrega al destinatario. | Sólo un acuse del proveedor |

El contrato de la API los colapsa hoy en un único `submitted_to_botpress`
(`decision.service.ts:226`), y **esa conflación es la que hay que deshacer**.

**Regla adoptada: el patch diferido se aplica con `submitted`**, y la fila
registra `applied_on: 'accepted'`. Motivo: `delivered` requiere un acuse del
proveedor que hoy **no existe para el sandbox de Telegram**, así que exigirlo
dejaría el estado congelado para siempre en el único canal que corre. Una
aceptación irrevocable es la prueba más fuerte disponible, y es estrictamente
mejor que la actual, que no exige ninguna.

Cuando un canal sí reporte `delivered` (WhatsApp oficial), el campo
`applied_on` sube a `'delivered'` sin cambiar la lógica. La distinción queda
registrada por turno, así que la calidad de la prueba es auditable en vez de
supuesta. **Lo que la spec no hace es llamar «visible» a `submitted`.**

Rutas de fallo:
- Entrega fallida ⇒ el patch diferido se descarta. El estado ligado a visibilidad
  queda donde estaba. Es exactamente la corrección de §1.4, generalizada.
- Entrega ambigua (`OUTBOUND_DELIVERY_UNRESOLVED`, `processInboundTurn.ts:395`)
  ⇒ el patch queda pendiente y lo aplica el reconciliador cuando la aceptación se
  prueba, o lo descarta al vencer.

### 3.8 Fallback técnico, sin poda (enmienda 6)

**Se elimina el piso de «poda mínima».** Después de una reparación fallida —o de
un agotamiento de presupuesto, o de una caída del proveedor— el turno emite un
**fallback técnico completo**:

- texto fijo, íntegro, de una sola pieza (`resolveTechnicalFallbackV1`);
- **cero hechos comerciales, cero artefactos, cero acciones**;
- **`state_patch` vacío**: ni inmediato ni diferido. La conversación no avanza;
- `reason_code = 'AGENT_LOOP_INTEGRITY_FAILED'` o
  `'AGENT_LOOP_BUDGET_EXHAUSTED'`, distinguibles en telemetría;
- traza completa: `rejection_id`, hash de ambos intentos, violaciones,
  herramientas pedidas, release manifest.

Ningún fragmento de la respuesta rechazada llega al cliente. Un texto parcialmente
verdadero es peor que un «se me complicó, en un momento sigo»: el parcial induce
una decisión de compra sobre información incompleta y contamina el estado.

Métrica de salud: `agent_loop_technical_fallback_rate`. Si sube, el problema está
en el prompt o en las herramientas, y es visible.

### 3.9 Release manifest por turno (enmienda 8)

La paridad de prompt deja de depender del Control Panel de Botpress. Cada turno
persiste y loguea:

```ts
interface ReleaseManifestV1 {
  readonly git_sha: string;             // inyectado en build
  readonly bundle_sha: string;          // hash del bundle ADK desplegado
  readonly prompt_sha256: string;       // hash del prompt EFECTIVO, ya sustituido
  readonly agent_version: string;       // 'studyx-agent-a-brain-v21'
  readonly model: string;               // 'deepseek-v4-flash'
  readonly tool_contract_version: string;
}
```

Se guarda en una columna aditiva `release_manifest jsonb` de `agent_decisions` y
se emite en `studyx.turn.completed`. Una consulta contra la base responde qué
prompt corrió en producción, sin acceso a Botpress. `prompt_sha256` es del prompt
**efectivo** (después de sustituir `{{NOMBRE_ASESOR}}` y demás), que es el único
que importa.

Verificación en readiness: `/api/diagnostics` compara el `prompt_sha256` esperado
del build contra el último observado en `agent_decisions`. Una divergencia es una
alerta, no un misterio.

### 3.10 Memoria

El orquestador entrega estado, historial reciente, recuerdos relevantes,
resultados de herramientas del turno y datos confirmados del contacto. El agente
decide qué usa (`used_memory_ids`) y qué escribe (`prepare_memory`).
`withDeterministicMemories` (`decision-policy.ts:489`) se elimina.

Una corrección del cliente invalida la memoria anterior antes del próximo turno:
`prepare_memory` acepta `supersedes: string[]`, y el commit marca las superadas
como inactivas en la misma transacción.

---

## 4. Archivos afectados

### 4.1 Se crean

| Ruta | Contenido |
|---|---|
| `agent-core/src/loop.ts` | El ciclo, agnóstico de canal y de proveedor |
| `agent-core/src/ports/*.ts` | `ModelProvider`, `ToolExecutor`, `MemoryStore`, `ChannelAdapter` |
| `agent-core/src/domain/response-blocks.ts` | `ResponseBlockV3` + renderer |
| `agent-core/src/domain/state-patch.ts` | `StatePatchV3` + clasificación inmediato/diferido |
| `agent-core/src/domain/release-manifest.ts` | `ReleaseManifestV1` |
| `botpress-agent/src/adapters/deepseek-model-provider.ts` | `ModelProvider` sobre `/responses` con `tools` |
| `botpress-agent/src/adapters/botpress-channel-adapter.ts` | Telegram/WhatsApp |
| `botpress-agent/src/adapters/adk-tool-executor.ts` | Despacho de herramientas vía acciones ADK |
| `src/features/conversation/domain/integrity-check-v3.ts` | Control de integridad (backend, autoritativo) |
| `src/features/conversation/application/commit-agent-turn-v3.ts` | Commit atómico: decisión + preparaciones + patch inmediato + outbox |
| `src/app/api/agent/tools/prepare/*` | Endpoints de las 5 preparaciones |
| `agent-core/src/shadow/compare.ts` | Comparador de rutas, offline |

### 4.2 Se reescriben

| Archivo | Cambio |
|---|---|
| `botpress-agent/src/workflows/processInboundTurn.ts` | El bloque `brainEligible` (596-850) queda como: construir contexto → `runAgentTurn` → commit. La orquestación deja de vivir acá |
| `botpress-agent/src/lib/conversation/agent-a-brain.ts` | Se parte: el transporte HTTP va al adapter, el parseo de `function_call` al núcleo |
| `botpress-agent/src/lib/conversation/agent-a-context.ts` | Se borran los dos binders (§1.1 capas 1 y 2); queda la construcción de contexto |
| `botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts` | Se borra. Su rol lo cubren §3.5 y §3.8 |
| `src/features/conversation/domain/agent-turn-policy-v2.ts` | De autor a autorizador: verifica el `state_patch` declarado; no lo recalcula. Se van `dropUnsupportedStateAssertionsV1` del hot path y la materialización de la línea 253 |
| `src/features/conversation/application/prepare-agent-turn-v2.ts` | Usa el `response_type` declarado; se va `solicitsACall()` |
| `src/lib/services/decision.service.ts` | El texto persistido es la salida del renderer, verbatim. Se van la concatenación del bloque de pago y la sustitución silenciosa |
| `src/features/orchestration/domain/commercial-truth-guard.ts` | Devuelve violaciones; deja de podar y de decidir |
| `botpress-agent/src/utils/decision-policy.ts` | Se van `withoutRepeatedGreeting` y `withDeterministicMemories` |
| `botpress-agent/src/actions/reportDelivery.ts` + `src/app/api/agent/outbounds/[outbound_id]/delivery/route.ts` | Aplican el patch diferido (§3.7) |

### 4.3 Se eliminan

`src/features/conversation/domain/conversation-planner.ts` (638 l.),
`botpress-agent/src/prompts/conversation-composer-v1.ts` y `-v2.ts`,
`botpress-agent/src/lib/conversation/conversation-composer.ts` (salvo
`lastAgentReplyV1`, que se muda al context builder),
`botpress-agent/src/actions/planConversation.ts`,
`src/app/api/agent/turns/[turn_id]/plan/route.ts`,
`botpress-agent/src/lib/conversation/resolve-agent-a-proposal.ts`.

### 4.4 Se conservan intactos

`claimBatch`, `ingestTurn`, `dispatchCall`, `verifyAuthorizedEgressPortable`, la
ventana de batch, el fencing por `claim_token`, la idempotencia por `turn_id` y el
outbox de proyecciones. La capa de transporte no cambia.

---

## 5. Migración

### 5.0 La bandera: runtime, y neutral al canal

Esta spec promete «rollback sin deploy», así que la bandera **tiene que ser
runtime de verdad**. Ninguno de los dos mecanismos existentes lo es:

| Mecanismo | Cambiar su valor cuesta | Runtime |
|---|---|---|
| `configuration.*` (`agent.config.ts`) | Agregar un campo nuevo exige **publicar el bundle** en Botpress Cloud. Sólo el valor de un campo ya publicado se cambia desde el Control Panel | No para un campo nuevo |
| `owned.features.*` vía `loadAgentARolloutConfig()` | Lee `process.env.AGENT_A_*`; en Vercel un cambio de variable exige **redeploy** | No |

Publicar el bundle está **actualmente bloqueado** (EXT-05: el registro de la
integración de Telegram falla). Colgar el rollback de eso sería prometer algo que
hoy no se puede ejecutar.

**Decisión: la bandera vive en la base**, en una tabla de rollout que
`claimBatch` ya consulta al armar el turno, y viaja en `features` del claim:

```sql
CREATE TABLE agent_loop_rollout_v3 (
  workspace_id  uuid    NOT NULL REFERENCES workspaces(id),
  contact_id    uuid        NULL REFERENCES contacts(id),  -- NULL = default del workspace
  mode          text    NOT NULL CHECK (mode IN ('off','shadow','authoritative')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, contact_id)
);
```

Resolución: fila del `contact_id` si existe; si no, la fila `contact_id IS NULL`
del workspace; si no hay ninguna, `'off'`. **Rollback = un `UPDATE`.** Sin
publicar bundle, sin redeploy de Vercel, efectivo en el turno siguiente.

**El allowlist es el mismo mecanismo, y es neutral al canal.** Se indexa por
`contact_id` —la identidad canónica que ya existe para todo canal—, nunca por
`phone_e164`. Un contacto de Telegram tiene un E.164 **sintético** derivado del
user id (`+999…`), que `commercialIntakeFromContactRowV1` ya trata como no
comercial: un allowlist telefónico como el de WhatsApp
(`WHATSAPP_CANARY_PHONE_E164S`) **no funcionaría para Telegram**, que es
justamente el canal donde corre el piloto. Por eso no se reusa ese patrón.

El campo `configuration.agentAAgentLoopV3KillSwitch: boolean` se agrega igual como
**freno de mano independiente de la base**, y se publica una sola vez en Fase 2.
Queda documentado que **ese** campo sí exige publicar el bundle, y que por lo
tanto **no** es la vía de rollback: la vía es la tabla.

La ruta `plannerless_v2` sigue viva y sin tocar durante toda la transición.

### Fase −1 — Archivos preexistentes: RESUELTA

No se integran; restaurados a HEAD; preservados en patch y tag (§0). Queda
pendiente la consecuencia medida: **la suite de presupuesto está roja en HEAD**
(§0.1) y se repara en la Tarea 0.1, antes de cualquier trabajo con TDD.

### Fase 0 — Reparar el bug de transición

Regla: **no se persiste una transición calculada sobre texto que no se entregó.**

En `decision.service.ts:1259`, cuando `verdict.removed.length > 0` el turno falla
cerrado hacia la ruta de reparación existente, en vez de escribir
`preparedAgentTurn.transition`. Se descarta recomputar la transición sobre el
texto post-veto: eso sería el backend decidiendo el estado por su cuenta otra vez.

Independiente del agent loop. **Va primero**: mientras el estado mienta, ninguna
comparación de rutas es interpretable. Es el único cambio de esta especificación
que corrige un defecto ya activo en producción.

### Fase 1 — Smoke del proveedor (bloqueante)

Antes de construir nada, un smoke aislado confirma contra la API real:
`deepseek-v4-flash` acepta `tools` en `/responses`; devuelve items
`function_call` con `call_id`/`name`/`arguments`; acepta los resultados de vuelta;
y respeta `MAX_OUTPUT_TOKENS` sin `incomplete_details.reason = max_output_tokens`
en un turno con dos rondas. Se mide la latencia real por ronda contra el
presupuesto de §3.2.

Si el smoke falla, la decisión «function calling nativo» se revisa antes de
escribir el núcleo.

**Gobierno del gasto y de las credenciales del smoke, sin excepciones:**

- El tope **sale del ledger o de la configuración**, nunca de una constante en el
  código. Hoy `scripts/agent-a-api-budget.mjs:9` lo tiene hardcodeado en
  `AUTHORIZED_LIMIT_USD = 1.08`, y esa constante es la causa de los tres tests
  rojos de §0.1. La Tarea 0.1 lo mueve a
  `STUDYX_AGENT_A_BUDGET_LIMIT_USD` (con el mismo default), de modo que subir el
  tope sea una decisión de configuración explícita y auditable en vez de un
  cambio de código acompañado de un ajuste de test.
- El ledger sigue siendo el único punto de reserva y de corte: una reserva que
  exceda el remanente **falla antes de enviar**.
- **La API key nunca se expone.** Sale de `secrets.DEEPSEEK_API_KEY` o del entorno
  del proceso; no se imprime, no se loguea, no se escribe en el ledger, no se
  pasa por línea de comandos y no entra en ningún artefacto de evidencia. El
  smoke registra endpoint, modelo, latencia, códigos y tokens — nunca
  credenciales, y nunca contenido de cliente.
- El smoke corre contra el cluster desechable y datos sintéticos: no toca la
  Supabase de producción ni conversaciones reales.

### Fase 2 — Núcleo y herramientas, sin loop en producción

Se construye `agent-core/`, los adaptadores y las 8 herramientas con sus tests de
contrato, idempotencia y clasificación. La ruta actual no cambia de comportamiento.

### Fase 3 — Loop en shadow local

`mode='shadow'` en el arnés de workflow (`tests/workflow/`) y en la matriz de
evals, **contra el cluster desechable en 127.0.0.1:55433**, nunca contra el
pooler de producción. Se comparan por turno: respuesta actual vs. nueva (diff +
rúbrica de calidad comercial, que existe y nunca se corrió); herramientas pedidas
vs. efectos producidos; estado resultante; latencia p50/p95;
`technical_fallback_rate`.

**Puerta:** cero divergencias de estado no explicadas, cero turnos mudos en
`wf_01..wf_04`, p95 del cerebro ≤ 6.500 ms, `technical_fallback_rate` ≤ 2 %.

### Fase 4 — Shadow productivo asíncrono (enmienda 7)

`mode='shadow'` en tráfico real, restringido a
`AGENT_LOOP_V3_CANARY_PHONE_E164S` (mismo patrón que
`WHATSAPP_CANARY_PHONE_E164S`, `agent.config.ts:75`).

**Fuera del hot path, sin excepción:**
- El turno productivo termina y entrega **antes** de que arranque el shadow.
- El shadow corre como job diferido sobre el **contexto ya materializado** que el
  turno persistió. **Cero lecturas adicionales** a la base.
- Todas las herramientas de preparación corren en `dry_run`, devuelven
  `idempotency_result: 'not_applicable'` y no reservan nada.
- Un fallo, un timeout o una saturación del shadow **no puede** afectar latencia
  ni disponibilidad del turno real: el job es best-effort y se descarta.
- Presupuesto de gasto propio, con corte automático.

Duración mínima: 200 turnos reales o 5 días, lo que llegue después.
**Puerta:** las métricas de Fase 3 sobre tráfico real, más costo por turno dentro
de presupuesto, más **paridad de release manifest verificada** (§3.9).

### Fase 5 — Promoción

`mode='authoritative'` sobre el allowlist, después ampliación por lotes. La ruta
vieja queda detrás de la bandera al menos dos semanas antes de borrar código.

---

## 6. Pruebas

| Nivel | Qué cubre | Dónde |
|---|---|---|
| Unidad | Renderer: la salida es función pura de bloques + artefactos; **no modifica narrativa** (test de identidad de string) | `agent-core/test/response-blocks.test.ts` |
| Unidad | Restricción estructural: URL / importe / duración en `narrative` ⇒ rechazo, nunca poda | `tests/unit/conversation/integrity-check-v3.test.ts` |
| Unidad | Clasificación inmediato/diferido de cada campo del patch | `agent-core/test/state-patch.test.ts` |
| Unidad | Presupuesto: agotamiento de rondas, deadline, `function_call` malformada, `max_output_tokens` | `agent-core/test/loop.test.ts` |
| Unidad | Cada herramienta: éxito, fallo recuperable, fallo no recuperable, duplicado, `dry_run` | `tests/unit/conversation/agent-tools-v3.test.ts` |
| **Concurrencia** | Dos workflows sobre la misma conversación: uno commitea, el otro recibe `STATE_VERSION_CONFLICT` y reintenta con estado nuevo | `tests/integration/agent-loop-concurrency.test.ts` |
| **Replay** | Replay durable del step del loop ⇒ **exactamente un** link y **exactamente una** proyección | `tests/integration/agent-loop-replay.test.ts` |
| **Fallo entre herramienta y commit** | Preparación exitosa + caída antes del commit ⇒ la reserva vence, no queda efecto, el turno siguiente es coherente | `tests/integration/agent-loop-prepare-crash.test.ts` |
| **Fallo de entrega** | Entrega fallida ⇒ patch diferido descartado, `call_offer_count` **no** avanza | `tests/integration/agent-loop-delivery-failure.test.ts` |
| **Exactamente uno** | Un solo link por `(conversation, offering, plan)` y una sola proyección, bajo reintento y bajo replay | `tests/integration/agent-loop-exactly-once.test.ts` |
| **Preparación descartada** | Una preparación ausente de `commit_preparations` no deja efecto ni reserva viva | `tests/integration/agent-loop-prepare-discard.test.ts` |
| **Recuperación del fallback** | Tras un fallback técnico: estado sin tocar, y el turno siguiente conversa normal | `tests/integration/agent-loop-fallback-recovery.test.ts` |
| Integración | Estado persistido == `state_patch` declarado, en los 7 escenarios comerciales | `tests/workflow/agent-a-persisted-outcomes.test.ts` (extender) |
| Integración | Un fallo de herramienta llega al agente y el agente reacciona | `tests/workflow/agent-loop-tool-failure.test.ts` |
| Workflow | `wf_01..wf_04` con `processInboundTurn` real, cero turnos mudos | `tests/workflow/` |
| RED primero | Veto parcial + transición persistida (bug §1.4) | Fase 0 |

Regla que no se negocia: **todo test de integración exige `TEST_DATABASE_URL`
apuntando al cluster desechable.** `tests/setup/integration.ts` pisa
`DATABASE_URL` siempre, nunca con `??=`.

---

## 7. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Compatibilidad concreta de `deepseek-v4-flash` + `/responses` + este contrato de tools (§1.5) | **Alta** | Fase 1 es un smoke bloqueante contra la API real, antes de escribir el núcleo |
| `reasoning_content` obligatorio en requests posteriores con thinking mode (400 documentado) | Media | El adapter preserva y reenvía los items de razonamiento; test de contrato con `effort` distinto de `none` |
| Latencia: dos rondas contra un p95 objetivo de 10 s con batching incluido | **Alta** | `ROUND_SOFT_DEADLINE_MS` corta la segunda ronda; p95 es puerta de fase; el fallback nunca deja el turno mudo |
| Extraer el núcleo a `agent-core/` mientras la ruta vieja sigue viva duplica superficie | Media | El núcleo no importa de Botpress ni de Next; la ruta vieja no lo importa a él. Sin dependencias cruzadas no hay deriva |
| Los bloques tipados endurecen la salida y el modelo puede degradar su naturalidad | **Alta** | La rúbrica de calidad comercial se corre por primera vez en Fase 3 y es puerta explícita |
| Sin poda, más turnos pueden terminar en fallback técnico | Media | `technical_fallback_rate` ≤ 2 % es puerta de fase. Un fallback honesto es preferible a un parcial engañoso (§3.8) |
| `STATE_VERSION_CONFLICT` frecuente si el debounce agrupa mal | Media | Test de concurrencia dedicado; el reintento completo es correcto por construcción |
| Un patch diferido pendiente por entrega ambigua envejece | Media | El reconciliador lo aplica o lo descarta al vencer; test dedicado |
| El bug §1.4 ya contaminó estado real en producción | Media | Fase 0 corrige el mecanismo. La limpieza histórica es decisión aparte (§10) |
| **La suite de presupuesto está roja en HEAD** (§0.1) | **Alta** | Bloquea el TDD. Tarea 0.1 la repara moviendo el tope a configuración, antes de todo lo demás |
| `applied_on: 'accepted'` no es prueba de visibilidad (§3.7) | Media | Queda registrado por turno y sube a `'delivered'` sin cambiar lógica cuando el canal lo reporte. La spec no lo llama «visible» |
| Publicar el bundle está bloqueado (EXT-05) | **Alta** | La bandera de rollout vive en la base, no en el bundle (§5.0). El único cambio que exige publicar es el kill switch, que no es la vía de rollback |
| El allowlist por teléfono no sirve para Telegram (E.164 sintético `+999…`) | Media | El allowlist se indexa por `contact_id`; no se reusa el patrón de `WHATSAPP_CANARY_PHONE_E164S` (§5.0) |

---

## 8. Migraciones

**La migración de `version` que la revisión 2 proponía NO hace falta:** la columna
ya existe en `conversation_sales_context_states_v1` y ya se incrementa (§3.6).

Quedan tres, **todas aditivas y con valor por defecto**:

1. `agent_decisions` + `release_manifest jsonb` — manifiesto por turno (§3.9).
2. `outbound_deliveries` + `deferred_state_patch jsonb` y
   `deferred_patch_applied_on text` — patch diferido y calidad de la prueba (§3.7).
3. `agent_loop_rollout_v3` — tabla nueva, bandera runtime y allowlist neutral al
   canal (§5.0).

Ninguna borra ni transforma datos existentes. Ninguna es bloqueante para la ruta
actual, que simplemente ignora las columnas y la tabla nuevas.

---

## 9. Rollback

- **Fases 1-4:** `UPDATE agent_loop_rollout_v3 SET mode = 'off'`. La ruta
  `plannerless_v2` no fue modificada. **Sin publicar bundle y sin redeploy de
  Vercel**, efectivo en el turno siguiente (§5.0).
- **Fase 5:** `mode = 'shadow'`, después `'off'`, por el mismo `UPDATE`. Los
  turnos ya entregados por el loop quedan persistidos y son válidos: escriben en
  las mismas tablas.
- **Kill switch de bundle:** `configuration.agentAAgentLoopV3KillSwitch` existe
  como freno independiente de la base, pero **cambiarlo exige publicar el
  bundle**, hoy bloqueado por EXT-05. No es la vía de rollback; es el respaldo
  para el caso en que la base sea inalcanzable.
- **Fase 0:** `git revert`. Su rollback deja el bug; no rompe nada más.
- **Migraciones:** no se revierten. Las tres columnas quedan con su default y la
  ruta vieja las ignora. Revertirlas sería el único paso destructivo del plan y no
  hace falta.

Punto de no retorno: **ninguno hasta la Fase 5**. Y dentro de la Fase 5, el
primer turno commiteado por el loop no impide volver: el estado que escribe es
del mismo esquema que el que escribe la ruta actual.

---

## 10. Fuera de alcance

- Limpieza del estado histórico contaminado por el bug §1.4.
- Agente B (voz). El núcleo se diseña para admitirlo vía `ChannelAdapter`, pero
  Retell no se implementa acá.
- Cualquier cambio al prompt canónico. El prompt es el frente siguiente, y sólo
  tiene sentido tocarlo cuando sus ajustes lleguen efectivamente a producción —
  que es precisamente lo que esta migración habilita.
