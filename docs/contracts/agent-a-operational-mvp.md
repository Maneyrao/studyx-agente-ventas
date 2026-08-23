# CONTRATO — Agent A Operational MVP

Este archivo es la única fuente de verdad para la ejecución actual. Retell y Agent B no existen en esta fase. Los agentes de ejecución no leen `specs/`, otros planes ni documentos históricos.

## 1. Objetivo

Agent A debe:

1. Recibir y responder mensajes por Telegram Development usando el mismo diseño que luego usará WhatsApp.
2. Responder con el contexto comercial canónico de Supabase.
3. Mantener memoria estructurada, memoria seleccionada vectorial y recuperación de conocimiento.
4. Priorizar una llamada opcional; si el usuario no quiere, completar la venta por mensajes.
5. Enviar exactamente uno de los tres links de Stripe cuando el cliente elija explícitamente un plan.
6. Actualizar Google Sheets sin bloquear la respuesta al cliente.
7. Mantener baja latencia, idempotencia, consentimiento y auditoría.

## 2. Fuera de alcance

- Retell real, credenciales Retell, firma de webhooks y herramientas Retell.
- Implementación productiva de Agent B.
- Provisionamiento automático del campus.
- Creación de Checkout Sessions o precios mediante Stripe API.
- Confirmar pagos sin webhook Stripe válido.
- Modificar `offering_payment_configs` para resolver links.

Se conserva un único smoke sintético de llamada: A propone/solicita una llamada, un fake provider acepta y un evento `analyzed` simulado vuelve al pipeline. No se llama a Retell.

## 3. Tres planes permitidos

| Código | Presentación | Fuente del link |
|---|---|---|
| `monthly_12` | 12 pagos mensuales de USD 30 | `PAYMENT_LINK_12M` |
| `monthly_6` | 6 pagos mensuales de USD 60 | `PAYMENT_LINK_6M` |
| `one_time` | un pago de USD 360 | `PAYMENT_LINK_CONTADO` |

- Las tres URLs ya fueron aprobadas por el dueño y se inyectan por entorno.
- No existe una cuarta opción ni fallback entre planes.
- El modelo nunca escribe ni selecciona una URL libre.
- Si falta una URL, A informa que debe confirmar el medio de pago y no envía ningún link.
- El link se ofrece sólo después de que el cliente elige explícitamente una opción.

## 4. Acción de pago de Agent A

La decisión v4 admite una acción nueva:

```json
{
  "type": "send_payment_link",
  "plan_code": "monthly_12",
  "offering_sku": "reparacion-celulares"
}
```

`offering_sku` admite `null`. El backend:

1. Deriva `allowed_payment_plan` del mensaje actual mediante reglas determinísticas: `12 meses/12 cuotas/12 pagos`, `6 meses/6 cuotas/6 pagos` o `contado/pago único/todo junto`. Una elección ausente o ambigua obliga a clarificar.
2. Revalida que `plan_code` coincida con `allowed_payment_plan` y que el offering exista en el business snapshot canónico.
3. Obtiene la URL desde configuración; nunca de la respuesta del modelo.
4. Agrega al texto del modelo un bloque fijo con etiqueta y link.
5. Commita decisión, outbound y delivery por el pipeline existente.
6. Sólo después de entrega confirmada encola/actualiza la proyección de Sheets.

Un `suppress`, contacto bloqueado, consentimiento revocado, plan inválido o configuración incompleta no puede ejecutar esta acción.

## 5. Google Sheets

PostgreSQL/Supabase es la fuente de verdad. `sheet_projection_rows` es el outbox; Google Sheets es una proyección para operadores.

Clave: `lead:<workspace_id>:<contact_id>`. Se usa `values.update` sobre un `row_number` reservado; nunca `append` como operación primaria.

Existe exactamente una fila por `contact_id` (clave `lead:<workspace_id>:<contact_id>`); cada evento posterior actualiza esa misma fila reservada de forma idempotente vía `values.update` y nunca crea una fila duplicada.

Columnas:

```text
fecha_alta | contact_id | nombre | apellido | email | telefono | etapa_comercial |
curso_interes | plan | estado_pago | fecha_pago | estado_alta | call_id | ultima_senal | trace_id
```

Reglas:

- Link confirmado: `etapa_comercial=proposal`, `estado_pago=pendiente`, `plan=<plan_code>`, `ultima_senal=payment_link_sent`.
- `mark_hot_lead` y `log_objection` también actualizan la misma fila.
- `estado_alta` nace `pendiente_operador`; el software preserva `hecha_por_operador` si una persona la modificó.
- La escritura ocurre después del envío y no aumenta la latencia percibida por el usuario.
- Un fallo de Google deja el outbox pendiente/reintentable; no revierte mensaje ni decisión.

## 6. Memoria

Las tres capas deben funcionar y distinguirse:

- Estructurada: contacto, consentimiento, conversación, estados y decisiones en PostgreSQL.
- Seleccionada: hechos explícitos y seguros del cliente en `selected_memories`, con embedding del epoch vigente.
- Conocimiento: 23 fuentes activas proyectadas en documentos/chunks vectoriales.

Requisitos:

- `gemini-embedding-2`, 768 dimensiones, epoch `gemini-embedding-2:768:retrieval-v1`.
- Exactamente un embedding de consulta por claim semántico.
- Un fallo vectorial degrada la respuesta, pero aparece como `unavailable`; nunca como memoria vacía saludable.
- Un segundo turno debe recuperar una preferencia o restricción literal guardada en el primero.
- La KB debe responder una consulta conocida y mantener aislamiento por workspace.
- Los runners de knowledge, message y selected-memory deben quedar operables y con scheduling/fallback documentado.

## 7. Latencia

- Saludo determinístico: `event → decision` p95 ≤ 2.5 s.
- Turno comercial con modelo: p50 ≤ 3.2 s y p95 ≤ 4.5 s, medido sobre al menos 30 turnos locales/controlados.
- Pago: una única lectura canónica adicional sólo cuando existe `send_payment_link`.
- `catalog_calls=0` en el hot path, `embedding_calls≤1` y máximo cinco statements desde claim hasta modelo en warm path.
- La actualización de Sheets ocurre después de `createMessage`/delivery report.

## 8. Seguridad e idempotencia

- `automationEnabled=true` sólo en Development hasta aprobar smokes.
- Bloqueo o consentimiento revocado impiden outbound comercial.
- Replay del mismo inbound produce una decisión, un outbound y una fila.
- La respuesta del modelo no puede contener una URL distinta de las tres configuradas.
- El modelo no puede autorizar un plan: `send_payment_link.plan_code` debe coincidir con `allowed_payment_plan` derivado del mensaje actual.
- Secretos sólo por entorno; nunca logs, argv, prompts o commits.
- El batch debe terminar `completed`; no puede quedar `claimed` con lease vencida después del commit.

## 9. Credenciales necesarias

```text
GEMINI_API_KEY=
PAYMENT_LINK_12M=
PAYMENT_LINK_6M=
PAYMENT_LINK_CONTADO=
GOOGLE_SHEETS_CLIENT_EMAIL=
GOOGLE_SHEETS_PRIVATE_KEY=
GOOGLE_APPLICATION_CREDENTIALS= # local: ruta absoluta al JSON de service account
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SHEETS_TAB_NAME=
CRON_SECRET=
```

Botpress Development conserva sus credenciales/configuración propias. El token Telegram ya compartido debe rotarse antes de producción.

En local, Google Sheets usa Application Default Credentials mediante `GOOGLE_APPLICATION_CREDENTIALS`. En Vercel, donde no existe ese archivo, se usan `GOOGLE_SHEETS_CLIENT_EMAIL` y `GOOGLE_SHEETS_PRIVATE_KEY` como variables cifradas del entorno.

## 10. Acceptance matrix

| # | Caso | Resultado |
|---:|---|---|
| 1 | Saludo | una respuesta rápida |
| 2 | Consulta comercial | respuesta grounded, sin segunda lectura de catálogo |
| 3 | Rechaza llamada | continúa venta completa por mensajes |
| 4 | Elige `monthly_12` | un único link 12m y Sheet `proposal` |
| 5 | Replay del caso 4 | cero links y filas adicionales |
| 6 | URL de plan ausente | no link, respuesta segura |
| 7 | Expresa restricción y pregunta después | memoria recuperada en segundo turno |
| 8 | Pregunta de KB | fuente vectorial disponible y respuesta fundamentada |
| 9 | Contacto bloqueado | cero outbound y cero actualización comercial |
| 10 | Llamada hipotética | fake provider + `analyzed` simulado, sin Retell |

La fase está terminada sólo si los diez casos pasan y un reinicio limpio mantiene el comportamiento.
