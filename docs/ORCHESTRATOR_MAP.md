# Mapa del orquestador StudyX

Estado real del código al 2026-08-11 (fin de la fase 8), no el estado deseado.
Cada casilla dice si está implementada, verificada y con qué prueba. Cuando esta
página y el código no coincidan, gana el código y esta página es el bug.

## Fronteras

```mermaid
flowchart LR
  subgraph Canal["Botpress ADK · capa de canal"]
    TG["Telegram sandbox<br/>(adapter listo · integración sin instalar)"]
    EMU[Emulator]
    WA["WhatsApp<br/>(fuera de alcance)"]
    ROUTER[conversations/router.ts<br/>único handler wildcard]
    WF[workflows/processInboundTurn]
  end

  subgraph Next["Next.js 16 · reglas de negocio"]
    INGEST["POST /api/agent/ingest"]
    CLAIM["POST /api/agent/batches/:id/claim"]
    DECISION["POST /api/agent/turns/:id/decision"]
    DELIVERY["POST /api/agent/outbounds/:id/delivery"]
    CATALOG["GET /api/agent/tools/catalog"]
    RECON["GET /api/cron/reconcile-orchestration"]
    MEM["GET /api/cron/memory-maintenance"]
    HEALTH["/api/health · /api/ready · /api/diagnostics"]
  end

  subgraph PG["PostgreSQL · fuente de verdad"]
    CE[(channel_events)]
    MSG[(messages)]
    BATCH[(inbound_batches)]
    DEC[(agent_decisions)]
    SM[(selected_memories)]
    OUT[(outbound_deliveries<br/>outbox_events)]
    AUD[(audit_log)]
    VEC[(pgvector · derivado)]
  end

  EMU --> ROUTER
  TG --> ROUTER
  WA -.fuera de alcance.-> ROUTER
  ROUTER --> WF
  WF --> INGEST --> CE & MSG & BATCH
  WF --> CLAIM --> BATCH
  CLAIM -.degradable.-> VEC
  CLAIM --> SM
  WF --> CATALOG
  WF --> DECISION --> DEC & OUT & AUD
  DECISION --> SM
  WF --> DELIVERY --> OUT
  RECON --> BATCH & OUT & AUD
  MEM --> SM
  HEALTH --> PG
```

Botpress nunca toca PostgreSQL. No hay credenciales de base en el agente.
El catálogo es **sólo lectura**: no existe contraparte de escritura en ninguna
ruta que el agente pueda alcanzar.

## Recorrido de un turno

```mermaid
sequenceDiagram
  participant C as Cliente (Telegram)
  participant B as Botpress
  participant N as Next.js
  participant P as PostgreSQL

  C->>B: mensaje
  Note over B: normaliza el canal · transcribe audio si hace falta
  B->>N: POST /ingest (firmado HMAC)
  N->>P: reserva evento + inbound + abre/une lote (una transacción)
  N-->>B: turn_id, batch{due_at, hard_deadline_at}
  Note over B: step.sleepUntil(due_at) — durable
  B->>N: POST /batches/:id/claim
  alt gana el claim
    N->>P: UPDATE con predicado → claim_token
    N->>P: hechos estructurados + mensajes del lote + memorias + KB
    N-->>B: 200 contexto controlado (con topes y saneado)
    B->>N: GET /tools/catalog (degradable)
    B->>B: prompt = SÓLO el contexto reclamado → Decision v3
    B->>B: valida localmente (schema + política)
    B->>N: POST /turns/:id/decision
    N->>P: decisión + outbound + outbox + delivery (una transacción)
    N->>P: memoria selectiva (después del commit, otra conexión)
    B->>B: createMessage — exactamente una vez
    B->>N: POST /outbounds/:id/delivery
  else no gana
    N-->>B: 202 waiting / 409 absorbed / 409 completed / 410 abandoned
    Note over B: se detiene. No llama al modelo. No envía.
  end
```

## Estados del lote

```mermaid
stateDiagram-v2
  [*] --> waiting: primer inbound abre la ventana
  waiting --> waiting: otro inbound desliza due_at (tope hard_deadline_at)
  waiting --> claimed: claim con now() >= due_at
  claimed --> claimed: robo de lease vencido (stolen=true)
  claimed --> completed: complete con el claim_token correcto
  waiting --> abandoned: llega un mensaje con la ventana vencida sin reclamar
  claimed --> abandoned: lease vencido y claim_attempt_count agotado
  completed --> [*]
  abandoned --> [*]
```

## Estados de una memoria seleccionada

```mermaid
stateDiagram-v2
  [*] --> rejected: falla una validación estructural
  [*] --> accepted: supera todas las validaciones
  accepted --> active: gana el slot (contacto, tipo, clave)
  active --> superseded: una memoria posterior toma el slot
  active --> expired: se venció la vigencia
  rejected --> [*]
  superseded --> [*]
  expired --> [*]
  note right of active
    Sólo accepted y active pueden vectorizarse.
    superseded y expired pierden el vector
    en la misma sentencia que las cierra.
  end note
```

## Reconciliación de una entrega

```mermaid
stateDiagram-v2
  [*] --> evaluar
  evaluar --> confirmed_sent: hay provider_message_id
  evaluar --> resend_authorized: reporte failed sin id, o nunca arrendada
  evaluar --> abandoned: sin envío probado y sin intentos
  evaluar --> ambiguous_paused: lease vencido sin reporte
  evaluar --> [*]: lease vivo o estado terminal
  ambiguous_paused --> ambiguous_paused: toda pasada posterior
  note right of ambiguous_paused
    Terminal para la máquina.
    Sólo una persona lo saca de ahí.
  end note
```

## Estado por requisito

| Área | Estado | Dónde | Prueba |
|---|---|---|---|
| Ingesta idempotente | ✅ | `ingestion.service.ts` | `orchestration-lifecycle.test.ts` |
| Un inbound por evento externo | ✅ | `reserve_inbound_channel_event` | `database-invariants.test.ts` |
| Payloads jsonb canónicos | ✅ | `lib/db/json.ts` | `jsonb-canonical-persistence.test.ts` |
| Batching durable | ✅ | `20260811020001_inbound_batches.sql` | `inbound-batching.test.ts` |
| Claim con dueño único | ✅ | `claim_inbound_batch` | `inbound-batching.test.ts` (5 concurrentes) |
| Contexto sólo después del claim | ✅ | `application/claim-batch.ts` | `claim-context.test.ts` |
| Política de turno unificada | ✅ | `domain/turn-policy.ts` | `turn-policy.test.ts` |
| **`selected_memories`** | ✅ | `20260811030001_selected_memories.sql` | `selected-memories.test.ts` (13) |
| **Validación de memory candidates** | ✅ | `domain/memory-selection.ts` | `memory-selection.test.ts` (26), `select-memories.test.ts` (9) |
| **Embedding de memoria asíncrono** | ✅ | `/api/cron/memory-maintenance` | `selected-memories.test.ts` |
| **Recuperación limitada a 2–5** | ✅ | `search_selected_memories` + `capRetrievedItems` | `selected-memories.test.ts` |
| **KB en el contrato de Botpress** | ✅ | `ClaimedTurnSchema` | `botpress-response-parity.test.ts` |
| **Límites y saneado de KB** | ✅ | `domain/retrieved-context.ts` | `retrieved-context.test.ts` (11) |
| **Catálogo conectado al workflow** | ✅ | `actions/lookupCatalog.ts` + `domain/catalog-view.ts` | `catalog-view.test.ts` (10) |
| **Decision v3 en uso** | ✅ | `decision.service.ts` (`parseDecisionAny`) | `decision-v3.test.ts` (7), `decision-v3-policy.test.ts` (10) |
| **Workflow con claim y espera durable** | ✅ | `processInboundTurn` (`step.sleepUntil`) | `botpress-response-parity.test.ts`; end-to-end ⛔ EXT-05 |
| **Reconciliador de claims** | ✅ | `application/reconcile-orchestration.ts` | `reconcile-orchestration.test.ts` (11) |
| **Reconciliador de outbox** | ✅ | `20260811050001_orchestration_reconciliation.sql` | `delivery-reconciliation.test.ts` (15) |
| **Entrega ambigua nunca se reenvía** | ✅ | `domain/delivery-reconciliation.ts` | `delivery-reconciliation.test.ts` |
| **`/api/health`, `/api/ready`** | ✅ | `src/app/api/{health,ready}` | `readiness.test.ts` (9), `health-readiness.test.ts` (5) |
| **Diagnóstico separado de degradables** | ✅ | `/api/diagnostics` | `health-readiness.test.ts` |
| **Logs con trace_id y latencia por etapa** | ✅ | `observability/structured-log.ts` (`withTrace`, `timedStage`) | — |
| Degradación de pgvector/Gemini | ✅ | `claim-batch.ts` (`allSettled`) | `claim-batch.test.ts`, `claim-context.test.ts` |
| Aislamiento por contacto | ✅ | FKs compuestas + funciones contact-scoped | `claim-context.test.ts`, `selected-memories.test.ts` |
| Cero handoff humano | ✅ | schema productor + política + CHECK | `decision-v3.test.ts` |
| Acciones comerciales deshabilitadas | ✅ | lista blanca de dos acciones observacionales | `decision-v3-policy.test.ts` |
| Evals conversacionales | ⛔ EXT-04 | `evals/*.eval.ts` escritas | requieren la integración `chat` |
| Piloto real por Telegram | ⛔ EXT-05 | adapter listo | requiere `adk integrations add telegram` |
| Worker de outbound (reenvío físico) | ❌ | — | ver «no implementado» |
| Audio detrás de un puerto | ❌ | `transcribeAudio` se llama directo | — |
| Pruebas de carga | ❌ | — | — |
| WhatsApp oficial | ❌ fuera de alcance | — | — |

## Desviaciones respecto de los planes escritos

1. El plan piloto nombra `src/conversations/emulator.ts`; el código real usa
   `router.ts` con adapters en `src/channels/`. El código es correcto: un solo
   handler wildcard, como exige `.claude/rules/botpress.md`.
2. El plan piloto congela Decision v2. La consigna vigente pidió v3, ya migrada
   de forma aditiva: v2 sigue siendo válido en el alambre.
3. El ADK no expone `tools` de forma verificable en sus tipos, así que el
   catálogo se **inyecta como dato estructurado** en la cerca no confiable en
   vez de exponerse como herramienta con loop. Cumple lo mismo —Botpress no
   toca PostgreSQL, el modelo no puede escribir— y es determinista para evals.
4. Un reenvío autorizado **no** mueve `state`: `pending` y `failed_retryable` ya
   son los estados desde los que un worker toma la entrega, y la máquina de
   estados de la fase 1 sólo permite salir de ellos hacia `leased`. El veredicto
   vive en `reconciliation_state`.
5. `docs/ROADMAP.md` invariante 6 todavía dice «OpenAI»; el proyecto usa Gemini.

## Verificación: sin Docker

```bash
./scripts/pg-native-up.sh 55433
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration
./scripts/pg-native-down.sh 55433
bash scripts/verify-native-postgres-loop.sh   # equivale a test:db:reset-loop
```

`supabase db lint` y `supabase test db` (pgTAP) siguen bloqueados por Docker.
