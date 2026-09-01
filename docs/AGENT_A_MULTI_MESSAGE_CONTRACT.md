# Agente A — entrega de 1–3 mensajes reales (contrato diferido)

Estado: **no implementado**. Este documento es el contrato, los invariantes y
los criterios de aceptación de una tarea separada. Las especificaciones
ejecutables viven en `tests/unit/conversation/agent-a-multi-message-contract.test.ts`,
marcadas como pendientes para no dejar la suite en rojo.

## Por qué no se improvisa

El prompt canónico exige "un mensaje = una idea" y permite 2–3 mensajes
seguidos. Hoy el modelo puede producirlos (`response.messages` acepta 1–3),
pero se pierden en tres puntos:

1. `buildSafeAgentABrainCompositionV1` los colapsa en
   `{opening, explanation, next_question}`.
2. `assembleCanonicalConversationResponseV1` los une con `\n\n` en un único
   `content`.
3. `processInboundTurn` hace **como máximo un** `createMessage`.

El bloqueo real es de esquema, no de código, y son **dos** constraints, no una.
Verificado sobre el esquema vivo el 2026-08-31.

```sql
-- supabase/migrations/20260805010008_phase1_agent_decisions.sql
outbound_message_id uuid UNIQUE REFERENCES messages(id)

-- supabase/migrations/20260625000001_contact_summary_and_turn_link.sql
CREATE UNIQUE INDEX messages_in_reply_to_unique
  ON public.messages USING btree (in_reply_to) WHERE (in_reply_to IS NOT NULL);
```

La primera dice que una decisión referencia **un** mensaje saliente. La segunda
es más profunda y más cara: vive en `messages`, la tabla central que comparten
ingestión, embeddings, knowledge, memoria y entrega, y dice que un turno
entrante tiene **un solo** saliente. `decision.service.ts` registra el saliente
con `in_reply_to: turn.id` y traduce su `23505` en `DecisionConflictError`: ese
índice **es** el guardián de replay de todo el camino de salida.

Consecuencia de diseño: la tabla `agent_decision_outbound_parts` propuesta más
abajo **no alcanza por sí sola**. Sin tocar `messages_in_reply_to_unique`, el
segundo `registerMessage` de un mismo turno aborta con conflicto de replay.

Reemplazar ese índice significa agregar `part_index` a `messages` y sustituir el
guardián de replay por `UNIQUE (in_reply_to, part_index)`. Es un cambio al
esquema de una tabla central y a la garantía de idempotencia de la que depende
todo el outbound. No cabe dentro de una corrección conversacional y no se
improvisa: requiere su propia tarea, con revisión del efecto sobre ingestión,
embeddings y `outbound_deliveries` antes de escribir una línea de SQL.

## Contrato propuesto

`ComposedNarrativeV1` deja de ser una tripleta con nombre y pasa a exponer una
lista ordenada:

```ts
interface ComposedNarrativeV2 {
  readonly schema_version: 2;
  /** 1–3 mensajes, en orden de envío. Ninguno vacío. */
  readonly messages: readonly string[];
  readonly call_offer: string | null;
  readonly used_fact_ids: readonly string[];
}
```

`assembleCanonicalConversationResponseV1` devuelve
`{ parts: readonly string[]; used_fact_ids }` en lugar de un `content` único.
Los bloques canónicos determinísticos (lista de áreas, de cursos, de planes,
link de pago) se adjuntan **al mensaje que los cita**, nunca como un cuarto
mensaje huérfano.

Persistencia:

- `messages` gana `part_index integer NOT NULL DEFAULT 0`. El índice parcial
  `messages_in_reply_to_unique` se reemplaza —en una migración aditiva que crea
  el nuevo y dropea el viejo— por `UNIQUE (in_reply_to, part_index) WHERE
  in_reply_to IS NOT NULL`. Con el default en 0, todo mensaje existente y todo
  camino que emita uno solo conservan exactamente la garantía de replay actual.
- `agent_decisions.outbound_message_id` se conserva y apunta al **primer**
  mensaje del turno (compatibilidad hacia atrás, sin reescribir migraciones).
- Migración aditiva: `agent_decision_outbound_parts (decision_id, part_index,
  message_id)` con `UNIQUE (decision_id, part_index)` y
  `UNIQUE (message_id)`. `part_index` arranca en 0.
- Cada parte lleva su propio `authorized_egress` calculado sobre su propio
  texto. El manifiesto no se comparte entre partes.

## Invariantes que la implementación debe preservar

| # | Invariante |
|---|---|
| I1 | Un turno produce entre 1 y 3 partes. Cero partes ⇒ no hay saliente. |
| I2 | El orden de entrega es el orden de `part_index`. Nunca se reordena. |
| I3 | Cada parte pasa el egress guard **por separado**, contra su propio manifiesto. Una parte rechazada se descarta; las demás se envían. |
| I4 | Una URL autorizada aparece en **exactamente una** parte. |
| I5 | Idempotencia: reejecutar el commit del mismo turno no crea partes nuevas ni duplica ninguna. Lo garantizan `UNIQUE (decision_id, part_index)` y el reemplazo de `messages_in_reply_to_unique` por `UNIQUE (in_reply_to, part_index)`. |
| I11 | Un turno que emite una sola parte sigue produciendo exactamente el mismo `23505` → `DecisionConflictError` que hoy ante un replay. El cambio de índice no puede debilitar el guardián para el caso de un mensaje. |
| I6 | Fencing: cada parte tiene su propia fila en `outbound_deliveries` con su propio `attempt_count`. Un reintento de la parte 2 nunca reenvía la parte 1. |
| I7 | Replay: reproducir el turno reconstruye las mismas partes, con el mismo texto y el mismo orden. |
| I8 | Una entrega ambigua de la parte *k* pausa el turno en `retry_pending` desde *k*; no se degrada a un mensaje único ni se reenvían las partes ya confirmadas. |
| I9 | La acción comercial (`send_payment_link`, `request_call_now`) se materializa **una sola vez por turno**, no una por parte. |
| I10 | El `payment_projection_job` sigue siendo uno por decisión, no uno por parte. |

## Criterios de aceptación

1. El modelo produce 3 mensajes; el cliente recibe 3 mensajes en orden.
2. El modelo produce 1 mensaje; el comportamiento es idéntico al actual.
3. Con el link de pago autorizado, el link viaja en una sola parte y las otras
   no lo contienen.
4. Reejecutar el commit 10 veces deja exactamente 3 mensajes salientes.
5. Fallar la entrega de la parte 2 y reintentar entrega sólo la parte 2.
6. Una parte que viola el egress guard se descarta sin arrastrar a las otras.

## Fuera de alcance de esta tarea

Cambiar el transporte de Botpress a más de un `createMessage` sin haber migrado
antes el outbox. El orden correcto es: migración → contrato de ensamblado →
fencing por parte → transporte.

## Por qué la implementación se detuvo acá (2026-08-31)

Se intentó ejecutar esta tarea y se frenó en el primer paso, deliberadamente.
El contrato original contemplaba una sola constraint; el esquema vivo tiene dos,
y la segunda toca `messages` y la garantía de replay del outbound completo.
Escribir esa migración sobre la marcha habría cambiado el guardián de
idempotencia de todo el sistema dentro de una tarea presentada como aditiva.

Lo entregado es la corrección del contrato: la segunda constraint, su efecto
sobre el diseño, la migración correcta (`part_index` con default 0 más el
reemplazo del índice) y el invariante I11 que impide que el caso de un solo
mensaje se degrade. Esa es la precondición que faltaba para poder implementar.
