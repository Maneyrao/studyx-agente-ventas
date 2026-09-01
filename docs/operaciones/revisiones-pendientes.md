# Revisiones pendientes del Agente A

## Qué es esto, y sobre todo qué no es

Cuando el Agente A falla técnicamente dos turnos seguidos en la misma
conversación, deja de reintentar y **registra la conversación para revisión**.
El cliente recibe exactamente esto:

> Sigo teniendo un inconveniente para procesar tu consulta. Dejé registrada la
> conversación para revisión.

Eso es todo lo que se le promete, porque eso es todo lo que ocurre.

**No hay bandeja. No hay notificación. No hay SLA.** Nadie recibe un aviso
cuando esto pasa. Alguien tiene que ir a mirar. Si nadie mira, la conversación
queda registrada y nada más sucede.

Esto está escrito así a propósito. La alternativa —decir «el equipo lo va a
revisar a la brevedad»— sería la misma clase de mentira que el agente decía
antes cuando afirmaba haber cargado una preinscripción que no existía.

## Cómo mirar, hoy

### Consulta directa

```bash
psql "$TEST_DATABASE_URL" -c "
  SELECT
    state.conversation_id,
    state.human_review_requested_at,
    state.consecutive_technical_fallbacks,
    state.stage,
    state.selected_offering_code,
    state.selected_payment_plan,
    state.payment_reported_at
  FROM conversation_sales_context_states_v1 AS state
  JOIN workspaces AS workspace ON workspace.id = state.workspace_id
  WHERE workspace.slug = 'studyx'
    AND state.human_review_requested_at IS NOT NULL
  ORDER BY state.human_review_requested_at ASC;
"
```

La consulta canónica vive en `PENDING_HUMAN_REVIEWS_QUERY_V1`
(`src/features/observability/adapters/probes.ts`) y tiene su test en
`tests/integration/pending-human-reviews.test.ts`.

**No devuelve nombre, correo ni teléfono.** Identifica la conversación, no a la
persona. Quién es se lee abriendo la conversación, con el control de acceso de
esa ruta, no en un listado de operaciones.

### Contador de operaciones

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/diagnostics \
  | jq '.probes[] | select(.name=="derived_backlog") | .detail | fromjson | .pending_human_reviews'
```

## Qué mirar cuando encontrás una

| Campo | Para qué sirve |
|---|---|
| `consecutive_technical_fallbacks` | Siempre 2 si hay derivación. Un 0 con marca escrita significa que la conversación se recuperó después. |
| `stage`, `selected_offering_code`, `selected_payment_plan` | Dónde quedó la venta. La derivación **no** los toca: un turno técnico no cambió nada comercial. |
| `payment_reported_at` | Si el cliente ya avisó que pagó. Es su afirmación, nunca evidencia de acreditación. |

## Limitación conocida: el contador sólo sube

**No existe todavía la forma de marcar una revisión como atendida.** Una
conversación derivada queda contada para siempre, así que el contador de
`/api/diagnostics` sirve hoy para detectar que algo empezó a fallar, y deja de
servir el día que acumule decenas.

Es deuda explícita, no un olvido. Cerrar revisiones es una capacidad de
operación con su propia superficie —quién la cierra, con qué permiso, qué queda
registrado— y meterla de contrabando en este trabajo habría sido ensanchar el
alcance sin decidirlo.

Mientras tanto, para acotar el ruido, filtrá por fecha:

```sql
AND state.human_review_requested_at > now() - interval '7 days'
```

## Lo que la derivación no hace

- No cierra la conversación. `stage` no pasa a `handoff` ni a `closed`, a
  propósito: una entrada nueva del cliente vuelve a intentar el modelo.
- No se duplica. Máximo una derivación activa por conversación, garantizado en
  SQL contra la fila bloqueada.
- No involucra al Agente B ni dispara ninguna llamada.
- No sobrevive a un commit fallido: si la transacción del turno revierte, la
  marca no se escribe y el mensaje no sale.
