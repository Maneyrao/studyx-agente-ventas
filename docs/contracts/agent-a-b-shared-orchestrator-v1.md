# Contrato A ↔ B sobre un único orquestador

Estado: arquitectura implementada y verificada localmente. Activación real de
Retell pendiente de credenciales y configuración externa.

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
2. Ante aceptación, A envía exactamente `Ok, ya te llamo en breve.`
3. Sólo después de confirmarse ese envío, el orquestador despacha la llamada.
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
7. Al terminar B, el worker post-llamada reanuda el chat en el mismo
   `conversation_id`. Un pedido de no contacto revoca permiso antes de todo
   outbound; una venta sólo se afirma con pago verificado en el backend.

## Configuración pendiente para activación

Retell:

- `VOICE_PROVIDER=retell`
- `RETELL_API_KEY`
- `RETELL_FROM_NUMBER`
- `RETELL_AGENT_ID` y `RETELL_AGENT_VERSION`
- `RETELL_LLM_ID` y `RETELL_LLM_VERSION`
- `RETELL_ADVISOR_NAME`
- `RETELL_TOOLS_SECRET`
- URL pública del orquestador en el webhook y las custom functions de Retell

Canal y proyecciones:

- credenciales del canal WhatsApp que hará el envío físico
- `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`,
  `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_TAB_NAME`
- `PAYMENT_LINK_12M`, `PAYMENT_LINK_6M`, `PAYMENT_LINK_CONTADO`
- `CRON_SECRET`

La activación requiere actualizar en Retell la definición de
`enviar_link_pago` al contrato anterior. El export viejo que acepta
`cursos/plan/email/canal` debe considerarse incompatible y no publicarse.
