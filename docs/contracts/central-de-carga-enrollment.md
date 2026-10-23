# CONTRATO — Orquestador StudyX → Central de Carga mystudyx (alta de alumnos)

> **Actualización 22-10-2026:** `schema_version: 2` agrega `bonus_offerings`, cursos de regalo que se inscriben en la misma alta que el curso pagado (§3.5). La Central lo implementó pero todavía no lo desplegó; el orquestador no lo implementó. La versión 1 sigue vigente sin cambios. Las decisiones nuevas están en §9.7–§9.9. La API v1 de la Central ya está en producción (el "sin desplegar" del antecedente del 06-10 quedó viejo).

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
| `schema_version` | integer | sí | constante | `1`, o `2` si el request trae `bonus_offerings` (§3.5). La Central rechaza versiones que no conoce con `422`. |
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

"Payload distinto" se evalúa sobre `student.email`, `offering.code`, `payment.amount`, `payment.currency`, `environment` y, en `schema_version: 2`, el conjunto de `bonus_offerings[].code` (sin importar el orden; ausente equivale a vacío). Diferencias en `full_name`, `phone` o `display_name` no son conflicto (el orquestador puede haber corregido un dato entre reintentos); la Central puede actualizarlas o ignorarlas.

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
| `bonus_enrollments` | array | Sólo en `schema_version: 2`. Ver §3.5. |

### 3.5 Cursos de regalo (`schema_version: 2`)

Para promociones del tipo "comprando un curso te regalamos otro". El regalo forma parte del **mismo pago** y del **mismo request**: un `payment_id`, un job y un alta que cubre todos los cursos. Así la idempotencia de §0 no cambia (un pago produce como máximo un alta) y el alumno no queda con el curso pagado sin el regalo, ni al revés.

**Request.** Igual que la versión 1, con `schema_version: 2` y un campo más en la raíz:

```json
{
  "schema_version": 2,
  "payment_id": "6f1c2a9e-4b7d-4c1e-9a55-0d3e8b2f71aa",
  "…": "resto igual que §3.1",
  "offering": { "code": "ESTETICA-INTEGRAL", "display_name": "Estética Integral" },
  "bonus_offerings": [
    { "code": "MAQUILLAJE-SOCIAL", "display_name": "Maquillaje Social", "promotion_code": "2X1-OCT-2026" }
  ]
}
```

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `bonus_offerings` | array, 1–3 elementos | sí en v2 | Si no hay regalo, el orquestador manda `schema_version: 1`. |
| `bonus_offerings[].code` | string | sí | Mismo mapa que `offering.code`. No puede repetirse ni ser igual a `offering.code`. |
| `bonus_offerings[].display_name` | string | sí | Sólo informativo. |
| `bonus_offerings[].promotion_code` | string 1–64 | sí | Código de la promoción que justifica el regalo, para trazabilidad y reportes. La Central no lo valida contra nada. |

Por qué una versión nueva y no un campo opcional en la v1: la Central ignora campos desconocidos (§3.2). Una Central sin soporte de regalos que recibiera `bonus_offerings` en la v1 daría de alta el curso pagado, respondería `201` y descartaría el regalo sin avisar. Con la v2, esa Central responde `422 unsupported_schema_version` y el job falla de forma visible.

**Validación.** Se valida todo antes de tocar Moodle. Si cualquier `code` (el pagado o un regalo) no está mapeado, la respuesta es `422 unknown_offering` y no se crea nada. Un código repetido o igual a `offering.code` → `422 validation_failed`.

**Proceso en la Central.**

- El alumno se crea o se reutiliza una sola vez para toda el alta.
- Cada curso (pagado y regalos) se inscribe con la misma lógica de §3.3. Si el alumno ya estaba inscripto en un curso de regalo, no es error y no se duplica la inscripción.
- El alta está completa sólo cuando **todos** los cursos quedaron inscriptos. Hasta entonces el GET responde `202` o `404`, igual que §6. Un reintento vuelve a recorrer todos los cursos sin duplicar inscripciones.
- Si el alumno es nuevo se envía **un solo** email de bienvenida (el email no nombra cursos).
- En el panel de Inscripciones queda una fila por curso. El panel no guarda monto, `payment_id` ni `promotion_code`, así que la fila del regalo no se distingue de una venta.

**Response.** El cuerpo de §3.4 se mantiene. `enrollment_id` y `enrollment_status` siguen describiendo el curso pagado. Se agrega:

```json
{
  "…": "campos de §3.4",
  "bonus_enrollments": [
    { "offering_code": "MAQUILLAJE-SOCIAL", "enrollment_status": "active" }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `bonus_enrollments[].offering_code` | string | Eco de `bonus_offerings[].code`, en el mismo orden. |
| `bonus_enrollments[].enrollment_status` | `"active"` | Siempre `"active"`, aunque el alumno ya estuviera inscripto en ese curso. Nunca `"processing"`: mientras falte algún curso, el estado general es `processing` (`202`). |

Un `200`/`201` en la v2 garantiza que todos los cursos de `bonus_offerings` aparecen en `bonus_enrollments`. El agente puede decirle al alumno que tiene acceso al regalo sólo con esa respuesta (§7).

**Referencia en Zod:**

```ts
export const EnrollmentRequestV2 = EnrollmentRequestV1.extend({
  schema_version: z.literal(2),
  bonus_offerings: z
    .array(z.object({
      code: z.string().min(1),
      display_name: z.string().min(1),
      promotion_code: z.string().min(1).max(64),
    }))
    .min(1)
    .max(3),
}).superRefine((req, ctx) => {
  const codes = req.bonus_offerings.map((b) => b.code);
  if (new Set(codes).size !== codes.length || codes.includes(req.offering.code)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bonus_offerings'], message: 'códigos repetidos o iguales a offering.code' });
  }
});
```

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
- [ ] v2: un `bonus_offerings[].code` desconocido devuelve `422 unknown_offering` sin crear alumno ni inscripciones.
- [ ] v2: si Moodle falla después de inscribir el curso pagado y antes de inscribir el regalo, el GET no devuelve `200`, y el reintento completa el regalo sin duplicar inscripciones.
- [ ] v2: reintentar con otro conjunto de `bonus_offerings` para el mismo `payment_id` devuelve `409`.
- [ ] v2: un alumno nuevo recibe un único email de bienvenida.
- [ ] v2: `200`/`201` incluye un elemento en `bonus_enrollments` por cada regalo pedido.

## 9. Decisiones ABIERTAS (cerrar antes de producción)

1. **Nombre y email obligatorios.** En el orquestador `contacts.name` y `contacts.email` son nullable. Opciones: (a) el orquestador exige ambos antes de mandar el link de pago, o (b) la Central acepta alta sólo con teléfono y completa el resto después. Este contrato asume (a).
2. **Documento y país.** El orquestador hoy no guarda DNI/pasaporte ni país. Si la Central los necesita para el alta, hay que agregarlos al flujo de venta (migración aditiva + intake) y a este contrato como `schema_version: 2`.
3. **Mapa de cursos.** Quién mantiene la equivalencia `offering.code` → curso/campus de la Central, y dónde vive (configuración de la Central recomendada).
4. **Reembolsos y bajas.** `payments.status` admite `refunded`. Falta definir si un reembolso debe dar de baja (p. ej. `POST /api/v1/enrollments/{payment_id}/revoke`) y si las cuotas impagas de `monthly_*` suspenden el acceso. Fuera de `schema_version: 1`.
5. **Auth.** HMAC (este contrato) vs. bearer token estático. HMAC protege contra replay y alteración; bearer es más simple. Recomendado: HMAC.
6. **Bienvenida.** Quién envía las credenciales de acceso: la Central (email) o el orquestador (WhatsApp, con un link de activación que provee la Central). Decisión del 09-10-2026: el agente envía las credenciales en el chat original tras la confirmación de alta, independientemente del email de bienvenida.
7. **Dónde vive la promoción en el orquestador.** Hoy no hay modelo de promociones. El regalo tiene que quedar fijado en el pago (o en el link de pago) **antes** de cobrar, para que el worker arme siempre el mismo request y los reintentos no den `409`. Un regalo que se ofrece después de pagar (p. ej. más adelante en la misma conversación de WhatsApp) no entra en este contrato: necesitaría su propio `payment_id` y un alta aparte.
8. **Regalos y reembolsos.** Si se reembolsa el curso pagado, ¿se da de baja también el regalo? Va junto con §9.4.
9. **Habilitación.** El orquestador manda la v2 sólo cuando la Central confirme que la desplegó. Mientras tanto, una venta con regalo debe frenarse antes de cobrar, no cobrarse y mandarse como v1.
