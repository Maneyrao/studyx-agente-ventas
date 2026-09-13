# Contrato A ↔ B sobre un único orquestador

Estado: arquitectura A→Xendra→B→A implementada y verificada con Xendra fake.
La llamada real queda pendiente de configuración de Lucas y autorización supervisada.

## Autoridad única

- PostgreSQL es la fuente de verdad.
- `contacts` es la única ficha del lead. A y B actualizan ese mismo registro.
- `sheet_projection_rows` es la única cola hacia Google Sheets. La fila visible
  contiene sólo `nombre`, `apellido`, `mail`, `tipo_de_curso`.
- B nunca escribe directamente en Sheets, WhatsApp ni un proveedor de pagos.
- Toda acción de B se correlaciona con `call_id`, `contact_id` y
  `conversation_id`; una mezcla de contacto, tenant o conversación se rechaza.

## Secuencia

1. A ofrece la llamada en el chat.
2. Ante aceptación, A envía su confirmación visible actual, sin alterar su prompt.
3. Sólo después de confirmarse ese envío, el orquestador despacha la llamada por Xendra.
4. B recibe los datos ya conocidos y `campos_faltantes`; no debe volver a pedir
   un dato presente.
5. `guardar_datos_contacto` converge nombre, apellido/mail sobre el mismo
   contacto. Cuando están completos junto con el curso, se actualiza la misma
   fila de Sheets usada por A. Su contrato aditivo es
   `{ nombre?, apellido?, email?, telefono_alternativo? }`; si B pide sólo el
   apellido porque ya conoce el nombre, no reemplaza el nombre existente.
6. Si el cliente elige pagar, B llama `enviar_link_pago` con:

   ```json
   { "curso": "codigo_canonico", "plan_code": "monthly_12" }
   ```

   `plan_code` sólo admite `monthly_12`, `monthly_6` u `one_time`. El backend
   valida el curso congelado en la llamada, resuelve la URL fija desde entorno
   y envía un único mensaje atribuido a A en la conversación original.
7. `registrar_resultado` conserva la autoridad sobre el desenlace operativo.
   `call_analyzed` enriquece el CRM sin reemplazarlo; el opt-out es monotónico.
8. Al terminar B, A puede reanudar el chat en el mismo `conversation_id`. Un
   pedido de no contacto revoca permiso antes de todo outbound; una venta sólo
   se afirma con pago verificado en PostgreSQL.

## Configuración del deployment

Orquestador:

- `VOICE_PROVIDER=xendra`
- `XENDRA_CALL_URL=https://xendrapro-admin.vercel.app/api/studyx/llamar`
- `XENDRA_ORCHESTRATOR_SECRET`
- `RETELL_TOOLS_SECRET`
- opcionales: `XENDRA_ADVISOR_NAME`, `XENDRA_CLOSER_NUMBER`

El camino Xendra no necesita `RETELL_API_KEY`, `RETELL_FROM_NUMBER` ni una API
key privada de Retell.

Canal y proyecciones:

- credenciales del canal WhatsApp que hará el envío físico
- `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`,
  `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_TAB_NAME`
- `PAYMENT_LINK_12M`, `PAYMENT_LINK_6M`, `PAYMENT_LINK_CONTADO`
- `CRON_SECRET`

## Handoff para Lucas

Con `BASE_URL` igual al dominio Vercel desplegado, configurar el relay de eventos:

- `POST BASE_URL/retell/eventos`
- headers: `x-studyx-orchestrator-secret`, `x-studyx-event`

Configurar las nueve herramientas con `POST` y el header obligatorio
`x-studyx-tools-secret`:

- `BASE_URL/retell/tools/consultar-curso`
- `BASE_URL/retell/tools/consultar-oferta`
- `BASE_URL/retell/tools/guardar-datos-contacto`
- `BASE_URL/retell/tools/enviar-link-pago`
- `BASE_URL/retell/tools/verificar-pago`
- `BASE_URL/retell/tools/enviar-material`
- `BASE_URL/retell/tools/derivar-humano`
- `BASE_URL/retell/tools/agendar-seguimiento`
- `BASE_URL/retell/tools/registrar-resultado`

Cambio recomendado en el contrato de pago de Agent B:

```json
{ "curso": "codigo_canonico", "plan_code": "monthly_12" }
```

`plan_code` admite `monthly_12`, `monthly_6` y `one_time`. El formato de Lucas
`{ "cursos": ["..."], "plan": "contado" | "cuotas" }` sigue aceptado para
compatibilidad: `contado` se traduce a `one_time`, mientras `cuotas` responde
`PLAN_SELECTION_REQUIRED` salvo que ya exista una selección durable de 6 o 12.
El backend ignora `email`/`canal` del modelo y deriva identidad y chat original.

No configurar una URL directa de Retell hacia StudyX en este modo: Xendra
conserva el webhook de Retell y reenvía los eventos autenticados.
