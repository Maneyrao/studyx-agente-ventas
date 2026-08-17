# Matriz de fallos

Qué se rompe, qué tiene que pasar cuando se rompe, y qué prueba lo demuestra.

Regla de lectura: **una fila sin prueba es una intención, no una garantía.**
Las filas marcadas ⛔ dicen exactamente qué falta para poder verificarlas.

---

## Idempotencia y duplicados

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| El canal reentrega el mismo mensaje 10 veces | Un solo inbound, un solo turno, un solo outbound | `reserve_inbound_channel_event` + UNIQUE `(provider, integration_id, external_message_id)` | `orchestration-lifecycle.test.ts` |
| Mismo `external_message_id`, contenido distinto | 409, sin escribir | hash canónico del payload | `orchestration-lifecycle.test.ts` |
| Dos decisiones concurrentes idénticas | Mismo `decision_id`, un solo outbound | UNIQUE `agent_decisions_turn_id_uq` + comparación de hash | `reconcile-orchestration.test.ts` |
| Dos decisiones concurrentes distintas | Una gana, la otra 409 `DECISION_CONFLICT` | idem | `reconcile-orchestration.test.ts` |
| Reporte de entrega repetido | `duplicate`, sin cambiar estado | UNIQUE `delivery_reports.event_key` | `orchestration-lifecycle.test.ts` |

## Concurrencia

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| 5 workflows reclaman el mismo lote | 1 `claimed`, 4 `absorbed`; los perdedores no llaman al modelo | un solo UPDATE con predicado, serializado por el lock de fila | `inbound-batching.test.ts` |
| Ráfaga de mensajes rápidos | Una ventana, una respuesta | `open_or_join_inbound_batch` + índice parcial de un lote abierto por conversación | `inbound-batching.test.ts`, `batch-window.test.ts` |
| Dos reconciliadores en paralelo | Un veredicto por entrega | `FOR UPDATE` en `apply_delivery_reconciliation` | `reconcile-orchestration.test.ts` |
| Dos turnos del mismo contacto activan la misma clave de memoria | Un solo `active`; el anterior queda `superseded` | lock sobre `contacts` + índice parcial único | `selected-memories.test.ts` |

## Entrega

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| Fallo **confirmado antes** del envío | Reenvío autorizado | reporte `failed` con `botpress_message_id = null` | `reconcile-orchestration.test.ts` |
| Resultado **ambiguo** tras intentar enviar | `ambiguous_paused`. Nunca reenvío automático. | lease vencido sin reporte → veredicto pegajoso | `delivery-reconciliation.test.ts`, `reconcile-orchestration.test.ts` |
| Botpress devolvió id y falló el reporte | El workflow pausa; el reconciliador marca `confirmed_sent`. Jamás se recrea. | `provider_message_id` gana sobre cualquier otra señal | `delivery-reconciliation.test.ts` |
| Intentos agotados | `dead_letter`, sin reenviar | presupuesto de intentos | `reconcile-orchestration.test.ts` |
| Lease de claim vencido | `abandoned`, nunca de vuelta a `waiting` | `expire_inbound_batch_claims` | `reconcile-orchestration.test.ts` |
| Una entrega `submitted` intenta degradarse a `failed` | Rechazado | `recordDeliveryReport` + máquina de estados | `orchestration-lifecycle.test.ts` |

## Política y consentimiento

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| Contacto bloqueado | Suprime. Sin búsqueda vectorial ni llamada al modelo. | `evaluateTurnPolicy` (una sola regla, en ingest y en commit) | `turn-policy.test.ts`, `claim-batch.test.ts` |
| Opt-out explícito | Sólo `opt_out_ack`, `next_state=completed`, sin memorias | política + `agent_decisions_opt_out_shape_check` | `turn-policy.test.ts`, `decision-policy.test.ts` |
| Turno posterior a un opt-out | Suprime | `consent_status = 'revoked'` | `turn-policy.test.ts` |
| El agente intenta derivar a un humano | Rechazado con `HUMAN_HANDOFF_FORBIDDEN` | ausente del schema productor + `assertBusinessActionPermitted` + CHECK en la base | `decision-v3-policy.test.ts`, `decision-v3.test.ts` |
| El agente intenta una acción comercial hacia afuera | Rechazado con `BUSINESS_ACTION_NOT_PERMITTED` | lista blanca de dos acciones observacionales | `decision-v3-policy.test.ts`, `decision-v3.test.ts` |

## Memoria de largo plazo

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| Cita inventada | Rechazo `QUOTE_NOT_FOUND`, archivado con motivo | la cita tiene que existir en el lote reclamado | `memory-selection.test.ts`, `selected-memories.test.ts` |
| Dato agregado que la cita no contiene | Rechazo `VALUE_NOT_GROUNDED` | contención de tokens; los números nunca aparecen de la nada | `memory-selection.test.ts` |
| Fuente de otro contacto | Imposible: `23503` | FK compuesta `(source_message_id, conversation_id, contact_id, 'inbound')` | `selected-memories.test.ts` |
| Cita de un mensaje **outbound** | Imposible: `23503` | misma FK, columna `direction` generada | `selected-memories.test.ts` |
| Dato sensible (tarjeta, CBU, DNI, credencial, salud) | Rechazo `SENSITIVE_DATA` | patrones cerrados sobre valor **y** cita | `memory-selection.test.ts` |
| Memory poisoning (instrucción disfrazada de hecho) | Rechazo `INSTRUCTION_LIKE` | patrones imperativos | `memory-selection.test.ts` |
| Clave reservada (precio, pago, cupo) | Rechazo `RESERVED_KEY` | lista cerrada; esos hechos los posee el backend | `memory-selection.test.ts` |
| Duplicado | `duplicate`, refresca vigencia, no acumula | índice parcial único `(contact_id, dedupe_hash)` | `selected-memories.test.ts` |
| Contradice un dato estructurado | Rechazo `CONTRADICTS_STRUCTURED_DATA` con el campo en conflicto | `detectStructuredContradiction` | `select-memories.test.ts` |
| Reemplazo | El anterior queda `superseded` y pierde su vector | `record_selected_memory` bajo un solo lock | `selected-memories.test.ts` |
| Expiración | `expired`, irrecuperable, sin vector | `expire_selected_memories` + filtro de vigencia en la búsqueda | `selected-memories.test.ts` |
| Vectorizar algo no aceptado | Imposible: `23514` | `selected_memories_embedding_scope_check` | `selected-memories.test.ts` |
| Recuperación desbordada | 2–5 memorias, tope duro | `search_selected_memories` + `capRetrievedItems` | `selected-memories.test.ts` |

## Degradación

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| Gemini caído | La conversación sigue con hechos estructurados, mensajes recientes y resumen | `Promise.allSettled` en el claim | `claim-batch.test.ts`, `claim-context.test.ts` |
| pgvector caído | Igual, con `long_term_memory_available=false` | el retriever lanza de verdad; el caso de uso degrada | `claim-context.test.ts`, `selected-memories.test.ts` |
| KB caída | `knowledge_base_available=false`; el turno se responde | idem | `claim-batch.test.ts` |
| Catálogo caído | `prices_assertable=false`; el agente no cotiza | `buildBusinessCatalogView` + degradación en el workflow | `business-context.test.ts` |
| Tabla de memoria inaccesible | El turno se commitea y se entrega igual | la selección corre **después** del commit, en otra conexión | `selected-memories.test.ts` |
| Embeddings de memoria fallando | Quedan `pending`/`failed`; nunca bloquean | cron de mantenimiento con presupuesto de intentos | `selected-memories.test.ts` |
| PostgreSQL caído | `/api/ready` 503 — el único caso que saca el proceso de rotación | separación required / degradable | `health-readiness.test.ts` |

## Inyección y contenido no confiable

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| Injection directa del cliente | No obedece; no revela instrucciones | cerca `UNTRUSTED_CONTEXT_*` + reglas duras del prompt | eval `studyx-conversational-matrix` ⛔ EXT-04 |
| Injection dentro de un documento de KB | Los marcadores se eliminan; el intento queda contado | `sanitizeRetrievedText` | `retrieved-context.test.ts` |
| Injection en la descripción de un producto | Igual que un chunk de KB | `buildBusinessContextView` → `sanitizeRetrievedText` | `catalog-detail.test.ts` |
| Documento que cierra la cerca del contexto | Imposible: se le quita el marcador | `FENCE_PATTERN` | `retrieved-context.test.ts` |
| Caracteres de control que fingen un cambio de rol | Se eliminan | `CONTROL_CHARS` | `retrieved-context.test.ts` |
| KB creciendo sin límite | Tope de ítems, de caracteres por ítem y total; lo descartado se reporta | `capRetrievedItems` | `retrieved-context.test.ts` |

## Seguridad de transporte

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| Firma inválida | 401 | HMAC sobre `timestamp\|method\|path\|body` | `proxy-signature.test.ts` |
| Timestamp viejo | 401 `STALE_REQUEST` | ventana de 5 minutos | `proxy-signature.test.ts` |
| Clave de idempotencia que no corresponde a la ruta | 409 | `expectedIdempotencyKey` | `proxy-signature.test.ts` |
| `trace_id` del body distinto al del header | 409 | comparación en el proxy | `proxy-signature.test.ts` |

## Persistencia canónica

| Fallo | Comportamiento exigido | Mecanismo | Prueba |
|---|---|---|---|
| jsonb guardado como string JSON | Imposible | `jsonbParam` + guard estático que prohíbe cualquier cast jsonb sobre un bind | `jsonb-canonical-persistence.test.ts`, `jsonb-parameters.test.ts` |
| Embedding con dimensión equivocada | Rechazado | `EMBEDDING_DIMENSIONS` como única fuente | `embedding-dimensions.test.ts` |
| Decisión modificada después del commit | `23514` | `enforce_agent_decision_immutability` (incluye `retrieval_used`) | `database-invariants.test.ts` |

---

## Filas todavía sin cobertura

| Fila | Por qué falta | Qué la desbloquea |
|---|---|---|
| Evals conversacionales end-to-end | `adk evals` exige la integración `chat`, que la consigna prohíbe agregar | `adk integrations add chat` + autorización |
| Recorrido real por Telegram | La integración `telegram` no está instalada en Botpress Cloud | `adk integrations add telegram` + `adk deploy` + autorización |
| `supabase db lint` / pgTAP | No hay runtime de contenedores en esta máquina | Docker Desktop u OrbStack |
| Pruebas de carga | No implementadas | — |
