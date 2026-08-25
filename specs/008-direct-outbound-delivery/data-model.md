# Data Model: Entrega Outbound Directa Multicanal

**Feature**: 008 | **Fase**: 1 | **Fecha**: 2026-08-18

## Principio rector

El relevamiento (ver [research.md](./research.md)) mostró que el esquema ya modela las
entidades que la especificación pedía. **Esta feature no crea ninguna tabla.** Agrega un
valor de canal, dos columnas de invalidación lógica y un índice.

Ese es el resultado deseado: cuanto menos esquema nuevo, menos superficie de divergencia
con los invariantes que ya están protegidos por constraints.

## Entidades existentes que se reutilizan

### `channel_threads` — identidad de canal del contacto

Es la tabla de identidades. Ya tiene exactamente la forma que FR-015/FR-016 requieren.

| Columna | Rol en esta feature |
|---|---|
| `contact_id` | Dueño de la identidad |
| `provider` | Origen (`telegram`, `whatsapp_cloud`, `telegram_sandbox`) |
| `integration_id` | Instancia de integración; parte de la identidad de idempotencia |
| `channel` | Canal lógico — **requiere admitir `telegram`** |
| `external_conversation_id` | **El destinatario**: `chat_id` en Telegram, teléfono en WhatsApp |
| `last_seen_at` | Insumo para el orden de preferencia determinístico (FR-019) |

**Constraint que resuelve FR-016 sin trabajo nuevo**:
`UNIQUE (provider, integration_id, external_conversation_id)` ya impide que una misma
identidad de canal quede asociada a dos contactos.

**Índice existente aprovechable**:
`channel_threads_contact_lookup_idx (contact_id, channel, last_seen_at DESC)` sirve
directamente a la consulta de selección de canal.

### `contact_channel_permissions` — elegibilidad por canal

| Columna | Rol en esta feature |
|---|---|
| `consent_status` | `unknown` / `granted` / `revoked` → gate de FR-011 |
| `reply_window_expires_at` | **Ventana de 24h de WhatsApp (FR-025/026)** — ya modelada |
| `channel` | **Requiere admitir `telegram`** |

La ventana de servicio no necesita modelarse: la columna existe. Lo que falta es
*consultarla* en el momento del envío y tratar su vencimiento como indisponibilidad de
canal, no como fallo.

### `contacts` — estado del contacto

`lifecycle_status` (`active` / `blocked` / `deleted`), `status`
(`prospecto` / `cliente` / `inactivo`) y `deleted_at` alimentan `isContactBlocked()`.
Se consumen a través de `evaluateTurnPolicy()`, nunca leyéndolos sueltos (decisión D1).

### `outbound_deliveries` — ledger de entregas

Los estados existentes cubren todos los desenlaces sin agregar ninguno:
`pending → leased → submitted → delivered` / `failed_retryable` / `dead_letter` /
`cancelled`.

Campos clave: `destination` (el identificador de canal usado), `provider`,
`integration_id`, `idempotency_key`, `provider_message_id`, `attempt_count`,
`next_attempt_at`, `last_error_code`.

**Constraint que resuelve FR-008/FR-010 sin trabajo nuevo**:
`UNIQUE (provider, integration_id, idempotency_key)`. La garantía de no duplicación es
una restricción de base de datos, no lógica de aplicación — que es exactamente lo que
FR-010 exige. Bajo concurrencia, la segunda transacción choca contra el índice único y
lee la fila ganadora.

### `sandbox_identities` — candado anti-efectos-reales

Una fila para un `contact_id` significa que ese contacto es sintético y **no debe
producir efectos reales**. Se consulta antes de contactar a cualquier proveedor (FR-034).

### `enqueue_outbound_delivery(...)` — función existente

Crea de forma atómica la fila de entrega y su evento de outbox. Firma en uso:

```
enqueue_outbound_delivery(
  message_id, provider, integration_id, channel,
  purpose, destination, idempotency_key, payload, max_attempts
) → (delivery_id, outbox_id)
```

`purpose` admite hoy `conversational` / `transactional` / `support` /
`consent_confirmation`. Un envío de link de pago encaja en `transactional`, que ya
existe: no requiere ampliar el dominio.

## Cambios de esquema

Una sola migración aditiva: `supabase/migrations/20260818010001_channel_identity_telegram.sql`

### C1 — Admitir `telegram` como canal

El valor `telegram` no es admisible hoy en ninguna tabla. Los `CHECK` afectados:

| Tabla | Migración de origen |
|---|---|
| `conversations` | `20260623000003` |
| `channel_threads` | `20260805010003:21` |
| `channel_events` | `20260805010003:64` |
| `contact_channel_permissions` | `20260805010004:34` |
| `consent_events` | `20260805010004:51` |
| `outbound_deliveries` | `20260805010005:20` |

Se aplica como `DROP CONSTRAINT` + `ADD CONSTRAINT` con el conjunto ampliado
(`'whatsapp'`, `'voice'`, `'telegram'`).

**Nota sobre "aditiva"**: ampliar un `CHECK` no reescribe una migración aplicada ni
destruye datos — solo admite un valor más, y toda fila existente sigue siendo válida. Es
aditivo en el sentido que la regla operativa del proyecto persigue. Aun así debe
verificarse que la validación del constraint nuevo no tome un lock prolongado; con el
volumen actual (piloto) es irrelevante, pero la migración usa `NOT VALID` + `VALIDATE
CONSTRAINT` para dejar el patrón correcto asentado.

### C2 — Invalidación lógica de identidades (FR-022)

```
ALTER TABLE channel_threads
  ADD COLUMN unusable_at     timestamptz,
  ADD COLUMN unusable_reason text;
```

Cuando el proveedor informa un rechazo permanente (el contacto bloqueó el bot, la
identidad no existe), se marca la fila en lugar de borrarla — Principio IV. Una identidad
con `unusable_at` no participa de la selección de canal.

Se agrega el índice parcial que sirve a la selección:

```
CREATE INDEX channel_threads_usable_idx
  ON channel_threads (contact_id, channel, last_seen_at DESC)
  WHERE unusable_at IS NULL;
```

### C3 — Ninguna tabla nueva

En particular, **no** se crea `contact_channel_identities`. La suposición de la
especificación de que hacía falta una tabla nueva quedó refutada por `channel_threads`.

## Transiciones de estado

### Entrega directa

```
      (sin fila)
          │  enqueue_outbound_delivery
          ▼
      pending ──── lease inmediato ────► leased
          │                                │
          │                                │ llamada al proveedor
          │                                ▼
          │        ┌───────────────┬───────────────┬──────────────────┐
          │        ▼               ▼               ▼                  ▼
          │    submitted      failed_retryable  dead_letter      failed_retryable
          │   (aceptado)      (429, 5xx)      (permanente)    (timeout / red)
          │                        │                                  │
          │                        └──── reintento con la misma ──────┘
          │                             clave de idempotencia
          ▼
   (choque con UNIQUE en un pedido repetido → se lee la fila ganadora,
    no se contacta al proveedor si ya está submitted)
```

**Invariante crítico**: el desenlace ambiguo (timeout, error de red) **nunca** produce
`submitted`. El mensaje pudo haber salido; afirmarlo sería mentir y reenviar a ciegas
sería duplicar. Queda `failed_retryable` bajo la misma clave, y el `UNIQUE` garantiza que
el reintento no genere un segundo mensaje.

### Identidad de canal

```
   (no existe) ──ingesta de evento entrante──► activa (unusable_at IS NULL)
                                                  │
                                                  │ rechazo permanente del proveedor
                                                  ▼
                                          inutilizable (unusable_at NOT NULL)
```

Nunca se elimina. Una identidad inutilizable puede reactivarse si el contacto vuelve a
escribir, porque el ingreso la vuelve a tocar.

## Reglas de validación

| Regla | Origen | Dónde se hace cumplir |
|---|---|---|
| Una identidad de canal pertenece a un solo contacto | FR-016 | `UNIQUE (provider, integration_id, external_conversation_id)` — base de datos |
| Un pedido de envío produce como máximo un mensaje | FR-008/010 | `UNIQUE (provider, integration_id, idempotency_key)` — base de datos |
| No se envía a contacto bloqueado o sin consentimiento | FR-011/012 | `evaluateTurnPolicy()` — dominio, compartido con el flujo de turno |
| No se envía por WhatsApp fuera de la ventana | FR-025/027 | `reply_window_expires_at` evaluado en el momento del envío |
| No se producen efectos reales para contactos sandbox | FR-034 | Consulta a `sandbox_identities` antes del proveedor |
| Toda resolución filtra por tenant | FR-013 | `workspace_contacts` en el join de resolución |
| Nada se elimina | FR-032 | `unusable_at`; el rol de base no tiene `DELETE` |

## Entidad nueva (solo en memoria, sin tabla)

**Resultado de envío** — el valor que el caso de uso devuelve al llamador:

```
{
  outcome: 'sent' | 'rejected_by_policy' | 'retryable' | 'permanent' | 'unreachable'
  channel: 'telegram' | 'whatsapp' | null
  providerMessageId: string | null
  deliveryId: string
  reason: string | null      // motivo estable, apto para que el flujo en vivo lo explique
}
```

`unreachable` es un desenlace de primera clase, distinto de `retryable`: significa que el
contacto no tiene ningún canal utilizable (FR-021). El flujo en vivo lo necesita para que
el vendedor ofrezca una alternativa durante la llamada en lugar de prometer un mensaje
que nunca va a llegar.
