# Runbook histórico — piloto de Telegram

> **Estado histórico, no autoridad de activación.** Este documento conserva el
> piloto de Telegram y sus decisiones de aislamiento. No autoriza una
> integración, despliegue ni mensaje externo. La preparación vigente para el
> demo controlado de WhatsApp Sandbox está en
> [`runbooks/whatsapp-go-live.md`](runbooks/whatsapp-go-live.md): la regresión
> actual es 20/50 y Task 5 permanece bloqueada hasta autorización explícita.

Telegram fue el único canal real de este piloto histórico. WhatsApp quedó fuera
de las fases 4–8 que documenta esta guía.

Telegram es un adaptador de prueba, nada más. Ninguna regla comercial depende
de él: internamente el recorrido es idéntico al que después usará WhatsApp.

---

## 1. Por qué Telegram viaja como `channel = 'whatsapp'`

Es deliberado, y conviene entenderlo antes de tocar nada:

| Campo | Valor en el piloto | Motivo |
|---|---|---|
| `channel` | `'whatsapp'` | Ejerce exactamente el mismo camino canónico que usará producción. Un canal nuevo sería un camino nuevo, y el piloto dejaría de probar lo que importa. |
| `sandbox_provider` | `'telegram_sandbox'` | `provider` participa de **todas** las constraints de unicidad (`channel_threads`, `channel_events` ×2), así que aísla el sandbox de producción a nivel de esquema. |
| teléfono | sintético `+999…` | Identidad aislada. `contacts.phone` es UNIQUE, así que un teléfono sintético no puede colisionar con un contacto real. |
| `sandbox_identities` | una fila por contacto de prueba | Candado de efectos reales: ninguna acción con efecto hacia afuera puede ejecutarse sobre un contacto que tenga fila acá. |

**No mezclar identidades entre usuarios de Telegram.** Cada usuario de Telegram
tiene que resolver a un teléfono sintético distinto. La separación está
verificada por `tests/unit/botpress/telegram-envelope.test.ts` y, del lado de la
base, por las FKs compuestas de `selected_memories` y `inbound_batches`.

---

## 2. Preparación (una sola vez)

### 2.1 Base de datos

```bash
# Sin Docker en esta máquina: cluster PostgreSQL 17 nativo + pgvector.
./scripts/pg-native-up.sh 55433
export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test
```

Para el entorno real del piloto, aplicar las migraciones nuevas **en orden**:

```
20260811030001_selected_memories.sql
20260811040001_agent_decisions_v3.sql
20260811050001_orchestration_reconciliation.sql
```

> `20260811010001_knowledge_chunks_gemini_768.sql` hace `TRUNCATE knowledge_chunks`.
> Si el entorno ya tenía contenido ingerido, hay que volver a correr
> `scripts/ingest-kb.mjs` o la búsqueda de KB devuelve vacío en silencio.

### 2.2 Catálogo y base de conocimiento

```bash
# Catálogo: las offerings del workspace (tabla `offerings`) son la única fuente de precios;
# sin offerings activas, prices_assertable = false
node scripts/ingest-kb.mjs        # chunks de KB (necesita GEMINI_API_KEY)
```

Verificar que el catálogo quedó cargado:

```bash
curl -s localhost:3000/api/agent/tools/catalog ... | jq '.prices_assertable, .count'
```

`prices_assertable: false` significa que el agente **no va a nombrar ningún
precio**. Es el comportamiento correcto con catálogo vacío, no un bug.

### 2.3 Variables de entorno

Requeridas (sin ellas `/api/ready` devuelve 503):

```
DATABASE_URL
ORCHESTRATOR_API_KEY
ORCHESTRATOR_KEY_ID
STUDYX_SIGNING_SECRET
```

Degradables (sin ellas el sistema funciona peor, no mal):

```
GEMINI_API_KEY   # embeddings + resumen. Sin esto la memoria de largo plazo queda en 'pending'.
CRON_SECRET      # habilita los tres cron y /api/diagnostics
```

Nunca imprimir estos valores. `/api/ready` reporta **nombres** de variables
faltantes, jamás contenidos.

### 2.4 Botpress

```bash
cd botpress-agent
npm run typecheck && npm run check && npm run build
```

`configuration.apiBaseUrl` por defecto es `http://localhost:3000`, **inalcanzable
desde Botpress Cloud**. Para un piloto contra Cloud hay que apuntarlo a una URL
pública antes de desplegar.

---

## 3. Comandos que requieren autorización explícita

No los ejecuté: modifican el proyecto en Botpress Cloud.

```bash
# Instalar el canal Telegram (necesario para recibir mensajes reales)
adk integrations info telegram          # confirmar los nombres reales de los tags primero
adk integrations add telegram

# Habilitar la suite de evals (bloqueo EXT-04)
adk integrations add chat

# Desplegar
adk deploy
```

> La consigna vigente prohíbe agregar la integración `chat`. Los archivos de
> eval están escritos y versionados; corren el día que esa integración exista.

---

## 4. Encender el piloto

```bash
# 1. Next.js
npm run build && npm run start

# 2. Verificar que el proceso responde y puede tomar tráfico
curl -s localhost:3000/api/health | jq
curl -s localhost:3000/api/ready  | jq '.status, .failed_required'

# 3. Verificar los degradables por separado
curl -s -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/diagnostics | jq '.status, .degraded'

# 4. Botpress en modo dev (traces disponibles)
cd botpress-agent && npm run dev
```

### El interruptor

`agent.config.ts` tiene `automationEnabled = false` por defecto. **Con eso en
false, cada turno se suprime**: se persiste, se reclama, se decide `suppress` y
no se envía nada. Es el estado seguro.

Para que el agente responda de verdad hay que ponerlo en `true`. Hacerlo recién
cuando `/api/ready` diga `ready` y el catálogo esté cargado.

---

## 5. Ejecutar un escenario

1. Escribirle al bot desde Telegram con el texto de una fila de
   [`PILOT_MATRIX.md`](PILOT_MATRIX.md).
2. Anotar el `trace_id` (aparece en el primer log `studyx.turn.*`).
3. Recolectar la evidencia:

```bash
# Recorrido completo del turno, en Botpress
cd botpress-agent && adk traces --format json | jq '[.[] | select(.trace_id=="<TRACE>")]'

# Latencia por etapa, del lado de Next.js
#   busca las líneas event="stage.completed"
```

```sql
-- Estado final en PostgreSQL, un turno completo
SELECT m.id AS turn_id, b.id AS batch_id, b.state AS batch_state,
       d.id AS decision_id, d.schema_version, d.intent, d.decision_kind,
       d.response_type, d.next_state, d.reason_code, d.business_action,
       d.retrieval_used,
       o.id AS outbound_id, od.state AS delivery_state,
       od.provider_message_id, od.reconciliation_state
FROM messages m
LEFT JOIN inbound_batches b     ON b.id = m.batch_id
LEFT JOIN agent_decisions d     ON d.turn_id = m.id
LEFT JOIN messages o            ON o.id = d.outbound_message_id
LEFT JOIN outbound_deliveries od ON od.message_id = o.id
WHERE m.id = '<TURN_ID>';

-- Qué recordó y qué rechazó el agente en ese turno
SELECT status, memory_type, memory_key, value_normalized,
       rejection_reason, contradicts_field, embedding_state
FROM selected_memories
WHERE decision_id = '<DECISION_ID>'
ORDER BY status, memory_key;
```

4. Completar la fila de la matriz: resultado esperado, resultado real, latencia
   total, decisión generada, herramientas usadas, estado final, pass/fail.

---

## 6. Convertir un fallo en una regresión

Este es el único paso que no se puede saltear. Un fallo del piloto que no queda
como test se vuelve a producir.

| Tipo de fallo | Dónde va el test |
|---|---|
| El agente afirmó un precio que no vino del catálogo | `tests/unit/orchestration/business-context.test.ts` + fila `not_contains` en `evals/conversational-matrix.eval.ts` |
| El agente prometió un humano | `evals/conversational-matrix.eval.ts` (bloque `NO_HUMAN_PROMISE`) + `tests/integration/decision-v3.test.ts` |
| El agente recordó algo que el cliente no dijo | `tests/unit/orchestration/memory-selection.test.ts` con la cita exacta |
| Un documento de KB cambió la conducta del agente | `tests/unit/orchestration/retrieved-context.test.ts` con el texto real |
| Una ráfaga produjo dos respuestas | `tests/integration/inbound-batching.test.ts` |
| Una entrega quedó ambigua y se reenvió | `tests/unit/orchestration/delivery-reconciliation.test.ts` |

Regla: el test se escribe **primero**, en rojo, con el texto literal que falló.

---

## 7. Vigilancia diaria

```bash
curl -s -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/diagnostics | jq '.probes'
```

| Señal | Qué significa | Acción |
|---|---|---|
| `reconcile_deliveries_ambiguous > 0` | Un cliente **puede o no** haber recibido respuesta. Ninguna máquina va a decidirlo. | Revisar a mano `outbound_deliveries WHERE reconciliation_state='ambiguous_paused'` |
| `pending_memory_embeddings` creciendo | El cron de memoria no corre, o Gemini está caído | Revisar `CRON_SECRET` y `GEMINI_API_KEY` |
| `failed_memory_embeddings > 0` | Memorias que agotaron reintentos | Degradación aceptable; la conversación sigue |
| `batch_claim_absorbed` alto vs `claimed` | Las ráfagas están colapsando como corresponde | Ninguna: es la señal buena |
| `batch_claim_waiting` alto | Los workflows despiertan antes de tiempo | Revisar `due_at` y `retry_after_ms` |
| `memory_rejected` con un motivo repetido | El prompt está induciendo un tipo de invención | Corregir instrucciones + agregar el test |
