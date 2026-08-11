# Mapa del orquestador StudyX

Estado real del código al 2026-08-11, no el estado deseado. Cada casilla dice si
está implementada, verificada y con qué prueba. Cuando esta página y el código no
coincidan, gana el código y esta página es el bug.

## Fronteras

```mermaid
flowchart LR
  subgraph Canal["Botpress ADK · capa de canal"]
    EMU[Emulator]
    TG[Telegram sandbox]
    WA["WhatsApp oficial<br/>(sin autorizar)"]
    ROUTER[conversations/router.ts<br/>único handler wildcard]
    WF[workflows/processInboundTurn]
  end

  subgraph Next["Next.js 16 · reglas de negocio"]
    INGEST["POST /api/agent/ingest"]
    CLAIM["POST /api/agent/batches/:id/claim"]
    DECISION["POST /api/agent/turns/:id/decision"]
    DELIVERY["POST /api/agent/outbounds/:id/delivery"]
    CATALOG["GET /api/agent/tools/catalog"]
  end

  subgraph PG["PostgreSQL · fuente de verdad"]
    CE[(channel_events)]
    MSG[(messages)]
    BATCH[(inbound_batches)]
    DEC[(agent_decisions)]
    OUT[(outbound_deliveries<br/>outbox_events)]
    AUD[(audit_log)]
    VEC[(pgvector · derivado)]
  end

  EMU --> ROUTER
  TG --> ROUTER
  WA -.BLOCKED_EXTERNAL.-> ROUTER
  ROUTER --> WF
  WF --> INGEST --> CE & MSG & BATCH
  WF --> CLAIM --> BATCH
  CLAIM -.degradable.-> VEC
  WF --> DECISION --> DEC & OUT & AUD
  WF --> DELIVERY --> OUT
  WF -.no conectado aún.-> CATALOG
```

Botpress nunca toca PostgreSQL. No hay credenciales de base en el agente.

## Recorrido de un turno

```mermaid
sequenceDiagram
  participant C as Cliente
  participant B as Botpress
  participant N as Next.js
  participant P as PostgreSQL

  C->>B: mensaje
  B->>N: POST /ingest (firmado HMAC)
  N->>P: reserva evento + inbound + abre/une lote (una transacción)
  N-->>B: turn_id, batch{due_at, hard_deadline_at}
  Note over B: duerme hasta due_at (planBatchWait)
  B->>N: POST /batches/:id/claim
  alt gana el claim
    N->>P: UPDATE con predicado → claim_token
    N->>P: hechos estructurados + mensajes del lote
    N-->>B: 200 contexto controlado
    B->>B: genera decisión
    B->>N: POST /turns/:id/decision
    N->>P: decisión + outbound + outbox + delivery (una transacción)
    B->>B: createMessage (una sola vez)
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

Un solo lote `waiting` por conversación, garantizado por índice parcial único.
Un lote `claimed` con lease vencido **no** vuelve a `waiting`: chocaría con ese
índice si la conversación ya abrió otro. Se roba o se abandona.

## Estado por requisito

| Área | Estado | Dónde | Prueba |
|---|---|---|---|
| Ingesta idempotente | ✅ | `ingestion.service.ts` | `orchestration-lifecycle.test.ts` |
| Un inbound por evento externo | ✅ | `reserve_inbound_channel_event` | `database-invariants.test.ts` |
| Payloads jsonb canónicos | ✅ | `lib/db/json.ts` | `jsonb-canonical-persistence.test.ts` |
| Batching durable | ✅ | `20260811020001_inbound_batches.sql` | `inbound-batching.test.ts` |
| Claim con dueño único | ✅ | `claim_inbound_batch` | `inbound-batching.test.ts` (5 concurrentes) |
| Ventana móvil 2s / deadline 4s | ✅ | `domain/batch-window.ts` + SQL | `batch-window.test.ts` |
| Contexto sólo después del claim | ✅ | `application/claim-batch.ts` | `claim-context.test.ts` |
| Política de turno unificada | ✅ | `domain/turn-policy.ts` | `turn-policy.test.ts` |
| Degradación de pgvector/Gemini | ✅ | `claim-batch.ts` (`allSettled`) | `claim-batch.test.ts`, `claim-context.test.ts` |
| Aislamiento por contacto | ✅ | FKs compuestas + `search_contact_memory` | `claim-context.test.ts` |
| Mensajes con `embedding=skip` | ✅ | `message.service.ts` vía llamadores | `orchestration-lifecycle.test.ts` |
| Dimensión de embeddings coherente | ✅ | `EMBEDDING_DIMENSIONS` | `embedding-dimensions.test.ts` |
| Decisión idempotente y concurrente | ✅ | `decision.service.ts` | `orchestration-lifecycle.test.ts` |
| Entrega sin degradar `submitted` | ✅ | `recordDeliveryReport` | `orchestration-lifecycle.test.ts` |
| `selected_memories` | ❌ pendiente | — | — |
| Validación de memory candidates | ❌ pendiente | — | — |
| KB en el contrato de Botpress | ⚠️ parcial | la devuelve el claim; el schema ADK no la declara | — |
| Catálogo conectado al workflow | ❌ pendiente | `/api/agent/tools/catalog` existe, nadie lo llama | — |
| Decision v3 en uso | ⚠️ parcial | `decision-v3.ts` completo y probado; el commit usa v2 | `decision-v3.test.ts` |
| Workflow con claim | ❌ pendiente | `processInboundTurn` sigue sin dormir ni reclamar | — |
| Reconciliador de claims | ⚠️ parcial | `expire_inbound_batch_claims` existe; falta el cron | `inbound-batching.test.ts` |
| Reconciliador de outbox | ❌ pendiente | — | — |
| `/api/health`, `/api/ready` | ❌ pendiente | — | — |
| Audio detrás de un puerto | ❌ pendiente | `transcribeAudio` se llama directo | — |
| Pruebas de carga | ❌ pendiente | — | — |
| WhatsApp oficial | ⛔ BLOCKED_EXTERNAL | `adk check`: `state: unconfigured` | — |

## Desviaciones respecto de los planes escritos

1. El plan piloto nombra `src/conversations/emulator.ts`; el código real usa
   `router.ts` con adapters en `src/channels/`. El código es correcto: un solo
   handler wildcard, como exige `.claude/rules/botpress.md`.
2. El plan piloto congela Decision v2. La consigna vigente pide v3, que ya está
   implementada como superconjunto estricto. La migración es aditiva y pendiente.
3. `docs/ROADMAP.md` invariante 6 dice «OpenAI»; el proyecto usa Gemini.
4. `docs/FAILURE_MATRIX.md` está vacío.
5. Las Tasks 1 y 2 del plan piloto están terminadas y no se reimplementaron.

## Verificación: sin Docker

No hay runtime de contenedores en esta máquina, así que `supabase start` y todo
lo que dependa de él no corre. El sustituto es PostgreSQL 17 nativo con pgvector:

```bash
./scripts/pg-native-up.sh 55433
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration
./scripts/pg-native-down.sh 55433
bash scripts/verify-native-postgres-loop.sh   # equivale a test:db:reset-loop
```

`supabase db lint` y `supabase test db` (pgTAP) siguen bloqueados por Docker.
