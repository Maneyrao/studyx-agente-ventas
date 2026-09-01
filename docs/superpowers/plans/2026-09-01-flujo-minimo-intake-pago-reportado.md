# Flujo mínimo: curso → plan → datos → link → pago reportado → proyección

> **Para ejecutores:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Objetivo:** cerrar el flujo comercial mínimo con seis datos congelados y una única
proyección local de Sheets para revisión humana, disparada por `payment_reported`
y nunca por el envío del link.

**Arquitectura:** se reutiliza toda la maquinaria existente. `sheet_projection_rows`
sigue siendo el outbox idempotente (una fila por `lead:{ws}:{contact}`),
`enqueueLeadProjection` sigue siendo la primitiva de upsert y
`payment_projection_jobs` sigue siendo el job durable. Lo que cambia es el
**evento que libera la proyección**: deja de ser la entrega del link y pasa a ser
"los seis datos completos + payment_reported". No se crean tablas ni proyecciones nuevas.

**Contrato comercial congelado (seis campos, ninguno más):**
nombre, apellido, correo, teléfono, curso canónico, plan canónico.

| Campo | Fuente durable |
|---|---|
| nombre, apellido | `contacts.name` (una sola identidad, `splitFullName`) |
| correo | `contacts.email` |
| teléfono | `contacts.phone` (identidad de canal) |
| curso canónico | `conversation_sales_context_states_v1.selected_offering_code` |
| plan canónico | `conversation_sales_context_states_v1.selected_payment_plan` |

## Global Constraints

- `payment_reported` ≠ `payment_verified`. Nunca se afirma pago confirmado,
  inscripción confirmada, preinscripción cargada ni acceso habilitado sin
  evidencia durable.
- Sheets no se dispara al enviar el link.
- Replays y mensajes repetidos producen una sola fila (`projection_key` único).
- Supabase es fuente de verdad; Sheets es proyección.
- Sin PII en memoria vectorial, logs ni prompts.
- Sin Sheets, Stripe, Telegram ni servicios reales.
- Sin push, deploy, multi-mensaje.
- Ninguna frase de un caso de eval se copia al prompt ni a una regex.

---

### Checkpoint 1 — Interpretación de pagos

**Archivos:** `conversation-pipeline.ts`, `conversation-planner.ts`, ambos schemas
espejo, `conversation-interpreter-v1.ts`.

Tres defectos de interpretación, tres movimientos nuevos:

- `report_payment` — el cliente declara haber pagado. Hoy cae en `unknown`.
  Produce `payment_reported`, jamás una acción de negocio ni una verificación.
- `ask_current_state` — el cliente pregunta por lo ya decidido o enviado
  ("¿ese link es el del pago?", "¿qué plan me diste?"). Se responde la pregunta
  sin reenviar el link y sin acción de negocio.
- `provide_contact_details` — el cliente aporta identidad para el intake.

base_01 no necesita un movimiento nuevo: el planner ya encadena
`select_payment_plan` + `request_payment_link`. El defecto está en el contrato del
intérprete, que enuncia la regla de composición con un único ejemplo (curso+chat)
y no la generaliza. Se generaliza la regla.

### Checkpoint 2 — Intake de seis campos

`awaiting_reply: 'contact_details'`, `missing_information: 'contact_details'`,
`response_goal: 'request_contact_details'`. El planner pide los datos que faltan
antes del link y nunca pide un séptimo campo. La identidad se persiste en
`contacts`; no hay tabla nueva.

### Checkpoint 3 — payment_reported + proyección idempotente

Migración aditiva (misma forma que `20260828010001`): columna
`payment_reported_at timestamptz` en el estado y en sus eventos.
La proyección se encola sólo cuando los seis campos están completos y existe
`payment_reported_at`. `estado_pago = 'reportado_por_cliente'`,
`ultima_senal = 'payment_reported'`, `estado_alta = 'pendiente_operador'`.

### Checkpoint 4 — Promesas operativas

El egress no deja afirmar un resultado operativo durable (inscripción,
preinscripción, alta, acceso) que ninguna acción comprometida respalda.
Es una clase de aserción, no una lista de frases.

### Checkpoint 5 — Ofertas de llamada

Invariante: ofertas visibles ≤ entradas del ledger. Hoy el ensamblador ledgerea
sólo su propia oferta y deja pasar la que el modelo escribe dentro de la
narrativa. El ensamblador pasa a ser el único autor de ofertas de llamada.

### Cierre — Runner

Se extiende el runner existente (`scripts/lib/agent-a-conversation-runner.ts`)
con oráculos para intake, pago reportado y proyección. 20 casos base. No se
ejecutan 50.
