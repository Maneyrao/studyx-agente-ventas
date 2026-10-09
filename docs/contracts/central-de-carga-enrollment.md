# CONTRATO — Orquestador StudyX → Central de Carga mystudyx (alta de alumnos)

> **Actualización 09-10-2026:** worker y avisos del agente implementados. Por autorización explícita del usuario, los pagos Stripe sandbox deben crear usuarios reales con acceso al curso comprado en la plataforma actual. El primer intento recibió `central_environment_mismatch`. Para destrabar la prueba, el usuario autorizó hoy un parche temporal: el pedido de alta se envía como `live`, mientras el pago conserva `test` en el ledger. La excepción vence el 10-10-2026 a las 00:00 de Argentina (§5). El agente entrega credenciales en lista sólo después de confirmar el alta; cuentas existentes conservan su contraseña.
>
> **Corrección de credenciales:** el usuario confirmó que el alta funciona y la contraseña inicial efectiva de la central es `Escuela.123`. El agente debe comunicar esa contraseña para cuentas nuevas. La indicación anterior `Studyx.123` no coincidía con la central; no se modifica la contraseña de la plataforma desde el orquestador.
>
> **Antecedente 06-10-2026:** la Central de Carga implementó ambos endpoints (branch `feature/api-enrollments` de su repo, sin desplegar; guía en su `docs/api-enrollments.md`). El lado orquestador (worker que consume `fulfillment_jobs`) todavía no existe. Las decisiones marcadas como **ABIERTA** (§9) deben cerrarse antes de pasar a producción.
>
> Reemplaza, para el alta, la decisión de `agent-b-signal.md` §0 ("el alta al campus es manual, `estado_alta=pendiente_operador`"): el alta pasa a ser automática vía este contrato, con un humano como fallback (§7).

Este archivo es la única fuente de verdad para la integración. Quien implemente en la Central de Carga no necesita leer el código del orquestador; si algo no está definido acá, para y pregunta, no infiere.

## 0. Decisiones cerradas

- **Quién llama a quién:** el orquestador StudyX llama a la Central de Carga. La Central no consulta la base del orquestador ni recibe webhooks de Stripe para esto.
- **Cuándo:** sólo después de que un pago queda `paid` en el ledger del orquestador. El orquestador sólo acepta pagos confirmados por el webhook de Stripe con firma verificada; la Central confía en ese juicio y **no** vuelve a verificar contra Stripe.
- **Cola:** al pasar a `paid`, el orquestador inserta una fila en `fulfillment_jobs` en la misma transacción (un job por pago, `payment_id` UNIQUE). Un worker reclama el job y llama a la Central. Ningún request HTTP de Stripe espera a la Central.
- **Idempotencia:** la clave es `payment_id` (UUID del orquestador). Un pago produce como máximo un alta. El orquestador puede reintentar el mismo request cuantas veces quiera; la Central debe responder lo mismo sin duplicar alumnos.
- **Entornos:** los pagos de prueba conservan `environment=test` en el ledger. El parche temporal autorizado puede enviar el pedido de alta como `live` a la central actual, con vencimiento y evento de auditoría (§5). La central recibe `live` y puede registrarlo así; esto no representa dinero real cobrado en Stripe.
- **Datos sensibles:** los logs de ambos lados no registran email, teléfono ni nombre completo en claro; usan `payment_id` y `contact_id` para correlacionar.

## 1. Endpoints que la Central de Carga debe exponer

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/api/v1/enrollments` | Crear (o confirmar) el alta de un alumno por un pago. Idempotente. |
| `GET` | `/api/v1/enrollments/{payment_id}` | Consultar el estado de un alta. El orquestador lo usa para reconciliar después de un timeout o respuesta ambigua. |

La ruta base se configura en el orquestador por entorno (`CENTRAL_CARGA_BASE_URL`); no se escribe en código.

## 2. Autenticación (servicio a servicio)

Firma HMAC-SHA256 con un secreto compartido (`CENTRAL_CARGA_SIGNING_SECRET`, distinto de cualquier otro secreto de StudyX y distinto por entorno).

Headers en **todas** las requests:

| Header | Valor |
|---|---|
| `content-type` | `application/json` (en el POST) |
| `x-studyx-timestamp` | Epoch en segundos (entero) del momento del envío. |
| `x-studyx-signature` | `v1=` + hex(HMAC-SHA256(secret, `${timestamp}.${method}.${path}.${rawBody}`)). `path` es el path completo de la URL, incluido el prefijo de despliegue (p. ej. `/central-carga/api/v1/enrollments`), sin query string. En el GET, `rawBody` es la cadena vacía. |
| `idempotency-key` | En el POST: igual a `payment_id`. |
| `x-request-id` | UUID por intento, sólo para trazas. |

La Central debe:

1. Calcular la firma sobre el **body crudo** (antes de parsear JSON) y compararla en tiempo constante.
2. Rechazar si `|now - timestamp| > 300` segundos.
3. Rechazar si `idempotency-key` ≠ `payment_id` del body.

Fallos de auth → `401` (§4). Ver alternativa bearer en §9.

## 3. `POST /api/v1/enrollments`

### 3.1 Request body

```json
{
  "schema_version": 1,
  "payment_id": "6f1c2a9e-4b7d-4c1e-9a55-0d3e8b2f71aa",
  "workspace_id": "0b8d…",
  "contact_id": "c41e…",
  "environment": "live",
  "student": {
    "full_name": "María Pérez",
    "email": "maria@example.com",
    "phone": "+5491155550000"
  },
  "offering": {
    "code": "ESTETICA-INTEGRAL",
    "display_name": "Estética Integral"
  },
  "payment": {
    "plan_code": "monthly_12",
    "amount": "45000.00",
    "currency": "ARS",
    "provider": "stripe",
    "provider_session_id": "cs_live_…",
    "paid_at": "2026-10-06T14:03:12Z"
  }
}
```

### 3.2 Campos

| Campo | Tipo | Req. | Origen en el orquestador | Notas |
|---|---|---|---|---|
| `schema_version` | integer | sí | constante | Hoy `1`. La Central rechaza versiones que no conoce con `422`. |
| `payment_id` | uuid | sí | `payments.id` | Clave de idempotencia. |
| `workspace_id` | uuid | sí | `payments.workspace_id` | Tenant del orquestador. |
| `contact_id` | uuid | sí | `payments.contact_id` | Id estable del lead en StudyX. Útil para soporte. |
| `environment` | `"test"` \| `"live"` | sí | `payments.environment`, salvo el parche temporal de §5 | Identifica el entorno declarado a la central; el ledger no se modifica. |
| `student.full_name` | string 1–200 | sí* | `contacts.name` | *Hoy es nullable en el orquestador. Ver §9. |
| `student.email` | string email | sí* | `contacts.email` | *Hoy es nullable en el orquestador. Ver §9. Llega en minúsculas y sin espacios. |
| `student.phone` | string E.164 | sí | `contacts.declared_phone` si existe; si no, `contacts.phone` | `contacts.phone` es la identidad del canal; `declared_phone` es el que el alumno dijo que usa. |
| `offering.code` | string | sí | `offerings.code` | Código estable del curso. La Central lo mapea a su curso/campus (§9). |
| `offering.display_name` | string | sí | `offerings.display_name` | Sólo informativo; no usar para mapear. |
| `payment.plan_code` | `"monthly_12"` \| `"monthly_6"` \| `"one_time"` \| `null` | sí (puede ser `null`) | `payments.plan_code` | `null` en pagos anteriores a la correlación de Payment Links. |
| `payment.amount` | string decimal | sí | `payments.amount` (numeric 14,2) | **String**, no number, para no perder precisión. Es el primer cobro, no el total del plan. |
| `payment.currency` | string ISO 4217 | sí | `payments.currency` | 3 letras mayúsculas. |
| `payment.provider` | `"stripe"` | sí | `payments.provider` | |
| `payment.provider_session_id` | string | sí | `payments.provider_session_id` | Id de Checkout Session de Stripe, para conciliación contable. |
| `payment.paid_at` | string ISO 8601 UTC | sí | `payments.paid_at` | |

La Central debe ignorar campos desconocidos (compatibilidad hacia adelante) y validar los conocidos con un esquema estricto. Referencia en Zod:

```ts
import { z } from 'zod';

export const EnrollmentRequestV1 = z.object({
  schema_version: z.literal(1),
  payment_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  environment: z.enum(['test', 'live']),
  student: z.object({
    full_name: z.string().trim().min(1).max(200),
    email: z.string().email(),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  }),
  offering: z.object({
    code: z.string().min(1),
    display_name: z.string().min(1),
  }),
  payment: z.object({
    plan_code: z.enum(['monthly_12', 'monthly_6', 'one_time']).nullable(),
    amount: z.string().regex(/^\d{1,12}\.\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    provider: z.literal('stripe'),
    provider_session_id: z.string().min(1),
    paid_at: z.string().datetime(),
  }),
});
```

### 3.3 Semántica de idempotencia

La Central persiste `payment_id` con constraint UNIQUE **en la misma transacción** que crea el alta (no "consultar y después insertar").

| Situación | Respuesta |
|---|---|
| Primer request válido para ese `payment_id`, alta creada | `201` + cuerpo §3.4 |
| Mismo `payment_id`, mismo payload (reintento) | `200` + el mismo cuerpo que la primera vez |
| Mismo `payment_id`, payload distinto en campos de identidad o pago | `409` `idempotency_conflict`. No modifica nada. |
| El alumno (por email) ya existe en la Central por otro pago | Se reutiliza el alumno y se le agrega la inscripción a este curso → `201`. **No** es error. |
| El alumno ya está inscripto en ese curso por otro `payment_id` | `201` con `enrollment_status: "already_enrolled"`. No se duplica la inscripción. |
| La Central acepta el alta pero la completa de forma asíncrona | `202` con `enrollment_status: "processing"`. El orquestador consulta con el GET. |

"Payload distinto" se evalúa sobre `student.email`, `offering.code`, `payment.amount`, `payment.currency` y `environment`. Diferencias en `full_name`, `phone` o `display_name` no son conflicto (el orquestador puede haber corregido un dato entre reintentos); la Central puede actualizarlas o ignorarlas.

### 3.4 Response body (200 / 201 / 202)

```json
{
  "payment_id": "6f1c2a9e-4b7d-4c1e-9a55-0d3e8b2f71aa",
  "enrollment_id": "enr_8a2…",
  "student_id": "stu_41c…",
  "enrollment_status": "active",
  "student_was_created": true,
  "access": {
    "login_email": "maria@example.com",
    "welcome_sent": true
  },
  "created_at": "2026-10-06T14:03:15Z"
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `payment_id` | uuid | Eco del request. |
| `enrollment_id` | string | Id de la Central. El orquestador lo guarda. |
| `student_id` | string | Id del alumno en la Central. |
| `enrollment_status` | `"active"` \| `"already_enrolled"` \| `"processing"` | |
| `student_was_created` | boolean | `false` si el alumno ya existía. |
| `access.login_email` | string | Con qué email entra al campus. |
| `access.welcome_sent` | boolean | Si la Central ya envió credenciales o bienvenida. El orquestador lo usa para decidir qué decirle al alumno por WhatsApp; el agente añade la contraseña inicial acordada únicamente para cuentas nuevas, después de confirmar el alta y la identidad del correo. No reinicia contraseñas existentes. |
| `created_at` | ISO 8601 UTC | |

## 4. Errores

Cuerpo de error uniforme:

```json
{ "error": { "code": "unknown_offering", "message": "offering.code ESTETICA-X no está mapeado", "retryable": false } }
```

| HTTP | `code` | `retryable` | Qué hace el orquestador |
|---|---|---|---|
| `400` | `malformed_json` | no | Dead letter + humano. |
| `401` | `invalid_signature`, `stale_timestamp` | no | Dead letter + alerta (probable secreto mal configurado). |
| `409` | `idempotency_conflict` | no | Dead letter + humano. Nunca reenvía con otro `payment_id`. |
| `422` | `validation_failed`, `unknown_offering`, `unsupported_schema_version`, `environment_mismatch` | no | Dead letter + humano. |
| `429` | `rate_limited` | sí | Reintenta respetando `retry-after` (segundos). |
| `500`, `502`, `503`, `504` | cualquiera | sí | Reintenta con backoff. |
| timeout / error de red | — | sí | Reintenta. Antes de cada reintento puede consultar el GET (§6). |

`retryable` en el cuerpo es una pista; la decisión final del orquestador sale del status HTTP de esta tabla.

## 5. Entornos

### Parche temporal autorizado del 09-10-2026

- `CENTRAL_CARGA_SANDBOX_LIVE_UNTIL=2026-10-10T03:00:00Z` habilita el puente
  únicamente para pagos `paid/test` dentro del alcance vigente del worker `test`.
- Sólo se modifica `environment` del POST firmado hacia la central a `live`.
  El mail registrado, curso, monto, sesión Stripe y `payment_id` se conservan.
  El ledger sigue siendo `test`; no se simula un cobro ni se fabrica una sesión `cs_live`.
- Cada intento deja un evento interno `sandbox_live_enrollment_requested` en
  `payment_events` con los dos entornos, vencimiento, job e intento, sin datos personales.
- Al vencer, no se hacen nuevos POST para estos pagos. Un reintento puede consultar
  el GET y confirmar un alta ya creada; un GET sin alta termina en
  `sandbox_live_bridge_expired`, sin recrearla ni cambiar la clave de idempotencia.
- Configuración vacía desactiva el puente. Si se vuelve al flujo sin parche,
  se aplican las reglas de aceptación explícita de `test` siguientes.
- Este puente no confirma por sí mismo que la central crea cuentas ni que la
  contraseña acordada funciona. Verificar alta, curso, credenciales e ingreso.

### Comportamiento habitual sin el parche

- La Central expone (o es) dos instancias: una de prueba y una de producción, con secretos distintos.
- Por defecto la instancia de producción rechaza `test`. Para la prueba autorizada del 09-10-2026, la central actual debe aceptar explícitamente `test` desde el orquestador autenticado y ejecutar el mismo alta real e inscripción al campus que con un pago `live`. No alcanza con devolver una respuesta simulada ni con crear un alumno en una base de prueba. Un rechazo sigue siendo un fallo de alta, nunca se oculta cambiando el pago a `live`.
- `environment` identifica el entorno del pago, no exige por sí mismo un campus separado. La excepción temporal se administra en la central, sin cambiar la firma HMAC, la validación de identidad, el mapa de cursos ni la idempotencia. Debe quedar desactivada por defecto y poder retirarse al terminar la prueba.
- Durante esta prueba, el orquestador conserva `PAYMENT_LINK_ENVIRONMENT=test` y `CENTRAL_CARGA_ENVIRONMENT=test`. Cambiar sólo esta última a `live` haría que el worker omitiera los pagos sandbox; no habilitaría el alta real.
- La de prueba responde `422 environment_mismatch` a `environment: "live"`.
- Sin la excepción explícita, un error de configuración (URL de prod con pago de prueba) falla cerrado y no crea un alumno real.

## 6. `GET /api/v1/enrollments/{payment_id}`

Mismos headers de auth (sin body, sin `idempotency-key`).

| Situación | Respuesta |
|---|---|
| Alta completa | `200` con el mismo cuerpo que §3.4 |
| Alta en curso | `202` con el cuerpo de §3.4 y `enrollment_status: "processing"` |
| No existe, o el intento anterior falló sin completar el alta | `404` `{ "error": { "code": "not_found", "retryable": false } }` |

Un alta que quedó a medias (p. ej. Moodle cayó entre crear el alumno e inscribirlo) responde `404`, no `200`: el alumno todavía no tiene acceso. El POST siguiente retoma desde donde quedó sin duplicar alumno ni inscripción.

Uso del orquestador: si un POST terminó en timeout, consulta el GET antes de reintentar. `200` → marca el job completo; `202` → vuelve a consultar más tarde; `404` → reintenta el POST (seguro, porque es idempotente).

## 7. Comportamiento del orquestador (informativo para la Central)

- Timeout por request: 15 s.
- Reintentos sólo ante los casos `retryable` de §4, con backoff exponencial y jitter, hasta el límite de intentos del job (`fulfillment_jobs.max_attempts`). Agotados los intentos, el job pasa a `dead_letter` y se escala a un operador humano.
- Mientras el alta no se confirme, el agente **no** le dice al alumno que ya tiene acceso. Pausar antes que afirmar algo falso.
- El pago ya está `paid` y no se revierte por un fallo de alta; el fallo de alta se resuelve operativamente.
- Concurrencia: el worker reclama jobs con lease (`SKIP LOCKED`). Igual pueden llegar dos POST simultáneos con el mismo `payment_id` (lease vencido durante una request lenta); la constraint UNIQUE de la Central es la que garantiza una sola alta.

## 8. Checklist de aceptación para la Central de Carga

- [ ] Firma HMAC verificada sobre body crudo, con comparación en tiempo constante y ventana de 300 s.
- [ ] `payment_id` UNIQUE en base; dos POST concurrentes idénticos producen un solo alumno y una sola inscripción.
- [ ] Reintento idéntico devuelve `200` con el mismo `enrollment_id`.
- [ ] Payload con email/curso/monto distinto para el mismo `payment_id` devuelve `409` sin modificar datos.
- [ ] Alumno existente por email se reutiliza (no se duplica).
- [ ] `environment` que no coincide con la instancia devuelve `422`.
- [ ] `offering.code` desconocido devuelve `422 unknown_offering`.
- [ ] Ningún log contiene email, teléfono o nombre en claro.
- [ ] El GET devuelve `404` antes del alta y `200` después.

## 9. Decisiones ABIERTAS (cerrar antes de producción)

1. **Nombre y email obligatorios.** En el orquestador `contacts.name` y `contacts.email` son nullable. Opciones: (a) el orquestador exige ambos antes de mandar el link de pago, o (b) la Central acepta alta sólo con teléfono y completa el resto después. Este contrato asume (a).
2. **Documento y país.** El orquestador hoy no guarda DNI/pasaporte ni país. Si la Central los necesita para el alta, hay que agregarlos al flujo de venta (migración aditiva + intake) y a este contrato como `schema_version: 2`.
3. **Mapa de cursos.** Quién mantiene la equivalencia `offering.code` → curso/campus de la Central, y dónde vive (configuración de la Central recomendada).
4. **Reembolsos y bajas.** `payments.status` admite `refunded`. Falta definir si un reembolso debe dar de baja (p. ej. `POST /api/v1/enrollments/{payment_id}/revoke`) y si las cuotas impagas de `monthly_*` suspenden el acceso. Fuera de `schema_version: 1`.
5. **Auth.** HMAC (este contrato) vs. bearer token estático. HMAC protege contra replay y alteración; bearer es más simple. Recomendado: HMAC.
6. **Bienvenida.** Quién envía las credenciales de acceso: la Central (email) o el orquestador (WhatsApp, con un link de activación que provee la Central). Decisión del 09-10-2026: el agente envía las credenciales en el chat original tras la confirmación de alta, independientemente del email de bienvenida.
