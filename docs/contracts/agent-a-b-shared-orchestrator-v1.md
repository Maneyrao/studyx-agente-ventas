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
6. Si el cliente elige pagar, B llama `enviar_link_pago`. El formato preferido es:

   ```json
   { "curso": "codigo_canonico", "plan_code": "monthly_12", "promotion_code": "codigo_autorizado_opcional" }
   ```

   El formato ya configurado por Xendra también está admitido, con un solo
   curso y el mismo `plan_code`:

   ```json
   { "cursos": ["codigo_canonico"], "plan_code": "monthly_12", "email": "...", "canal": "whatsapp" }
   ```

   `consultar_curso` acepta nombre o alias y devuelve el código en
   `curso.codigo`; B reutiliza ese valor al pedir el link. `plan_code` sólo
   admite `monthly_12`, `monthly_6` u `one_time`. Si la llamada empezó antes
   de elegir curso, el backend valida el curso activo, persiste curso y plan en
   el estado de la conversación y envía un único mensaje atribuido a A en el
   chat original. Los combos de varios cursos quedan fuera de V0 y se rechazan.
   `promotion_code` es opcional y sólo se envía cuando `consultar_oferta`
   devolvió ese código para el mismo curso. B no compone ni infiere códigos. El
   backend vuelve a validar que la promoción esté activa, corresponda al curso,
   admita el canal `voice` y quede congelada en el mismo pago; un código
   inexistente o no autorizado se rechaza sin enviar el link.
7. `registrar_resultado` llega durante la llamada y conserva la autoridad sobre
   el desenlace operativo; habilita retomar el hilo escrito sin esperar el
   análisis tardío. `call_analyzed` llega después y enriquece el CRM sin
   reemplazarlo; el opt-out es monotónico.
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
{ "curso": "codigo_canonico", "plan_code": "monthly_12", "promotion_code": "codigo_autorizado_opcional" }
```

`plan_code` admite `monthly_12`, `monthly_6` y `one_time`. El formato de Lucas
`{ "cursos": ["codigo_canonico"], "plan_code": "monthly_12", "email": "...", "canal": "whatsapp" }`
está aceptado cuando contiene exactamente un curso. El formato anterior con
`plan: "contado" | "cuotas"` continúa por compatibilidad: `contado` se traduce
a `one_time`, mientras `cuotas` responde `PLAN_SELECTION_REQUIRED` salvo que ya
exista una selección durable de 6 o 12. El backend ignora `email`/`canal` del
modelo y deriva identidad y chat original.

Cuando `consultar_oferta` devuelve `oferta.promocion`, B puede explicar sólo
los cursos bonificados allí enumerados y, ante aceptación, copiar exactamente
`oferta.promocion.codigo` a `enviar_link_pago.promotion_code`. Si la propiedad
no aparece, B no ofrece ningún regalo. La ausencia de promoción no modifica el
precio, el plan ni el flujo ordinario.

En modo direct, la promoción leída del chat original incluye además
`promotion_cycle_id` y `offer_version`. Esta lectura es atómica y no crea,
amplía ni sella el paquete. B puede explicar exclusivamente los cursos de esa
versión. Para aceptar y enviar el link, copia el código, ciclo y versión exactos
en `promotion_code`, `promotion_cycle_id`, `accepted_offer_version` y envía
`accept_promotion: true` sólo tras la aceptación explícita del cliente.
Una versión anterior, identidad parcial, entrega aún no confirmada o llamada
no correlacionada se rechaza sin crear checkout. No se admite agregar regalos
desde la llamada. Los argumentos de la herramienta no autorizan el paquete:
el backend vuelve a validar el estado durable bajo bloqueo.

La herramienta autenticada por firma Retell o secreto del relay autorizado y
correlacionada por el backend registra una fila inmutable en
`promotion_voice_acceptances`: llamada Retell activa, workspace, contacto,
conversación original, ciclo, versión y hora de recepción del servidor posterior
a la entrega confirmada de esa versión. No se crea un mensaje entrante de chat.
Esta evidencia usa las mismas comprobaciones de elegibilidad y paquete que la
aceptación por texto; permite sellar una sola versión y reservar el checkout
con el snapshot completo. Un replay exacto de la misma llamada reutiliza la
evidencia y el checkout; otra llamada no reutiliza la aceptación de voz anterior.
El paquete aceptado permanece inmutable, incluso al volver a modo review, y
el link se entrega al `conversation_id` original de la llamada. El contrato
legacy de promoción review conserva sus argumentos y comportamiento.

La omisión de todos los campos de promoción nunca descarta una obligación:
el backend busca el paquete direct durable del curso efectivo bajo bloqueo.
Si sólo está ofrecido, `enviar_link_pago` responde
`PROMOTION_ACCEPTANCE_REQUIRED` para que B consulte la versión actual y obtenga
aceptación explícita. Si ya está aceptado y sellado, enlaza automáticamente
el ciclo y versión exactos al checkout. Una identidad explícita parcial o stale
se rechaza; un curso sin paquete vigente mantiene el checkout ordinario.

Una selección de curso confirmada por voz registra evidencia inmutable en
`voice_course_selections`, con llamada correlacionada, scope, estado previo,
nuevo curso, versión del contexto y hora del servidor. La selección, cancelación
de ofertas abiertas y supersesión de intentos de pago pendientes ocurren en
una sola transacción. Las supersesiones exigen exactamente una fuente durable:
`source_turn_id` del chat XOR `source_voice_selection_id` de voz. Volver al curso
anterior no reactiva una oferta cancelada ni reexpone un checkout supersedido;
el pago y su snapshot originales permanecen intactos. Un checkout que implica
un cambio de curso usa la misma transición y revierte todos esos efectos si la
reserva falla. Las solicitudes de llamadas anteriores a otra llamada del mismo
scope se rechazan; un resultado autenticado de la llamada recién completada
puede conservar su selección, sin reutilizar el inbound que solicitó la llamada.

No configurar una URL directa de Retell hacia StudyX en este modo: Xendra
conserva el webhook de Retell y reenvía los eventos autenticados.
