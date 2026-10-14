# Persistencia de datos en respuestas de varios mensajes

## Problema y cambio

En la charla de Agus, el nombre y el apellido llegaron en mensajes separados del mismo lote. El modelo veía ambos, pero la captura contextual descartaba la pregunta de datos después del primer mensaje entrante. El contacto quedaba como `Agus`; la llamada fallaba por apellido faltante.

La ingesta ahora conserva la relación con una solicitud entregada mientras cada respuesta intermedia tenga un recibo de captura generado por el backend para esa misma pregunta. Un mensaje ajeno a los datos, una nueva pregunta entregada o un campo ya respondido cierran la autorización contextual correspondiente. No se eliminó la comprobación de procedencia ni se habilitó captura desde borradores, otro destino o metadatos aportados por el caller.

Cada recibo `messages.metadata.contact_intake_response_v1` identifica:

- `request_message_id`: la pregunta efectivamente enviada al contacto.
- `captured_fields`: los campos de esa pregunta capturados por la ingesta.
- El mensaje que los aportó: la fila que contiene el recibo.

Nombre, apellido, correo y teléfono siguen usando `contacts` como fuente de verdad. Los fragmentos parciales de identidad conservan `contact_name_answer_v1`. Contacto, mensaje y recibo se escriben dentro de la transacción serializable existente; el contexto y la autorización posterior leen los datos persistidos. No hace falta una migración ni una segunda memoria de identidad.

La captura explícita también genera procedencia cuando responde a una pregunta válida. Eso evita que «mi nombre es Agus» cierre la asociación antes de «maneyro». Una etiqueta como «Mi teléfono es…», «Teléfono …» o «Correo …» no se interpreta como nombre. Repetir el primer nombre tampoco llena el apellido.

## Verificación

Las pruebas nuevas fallaron antes de los cambios con `Agus` en lugar de `Agus Maneyro`. También se observaron y corrigieron el nombre repetido, el cierre de una petición sólo por el nombre y la interpretación de etiquetas de otros campos.

- Unitarias: 3.793 aprobadas, 17 omitidas y 7 pendientes preexistentes.
- Cobertura del alcance configurado: 98,91% de líneas y 93,07% de ramas; umbrales aprobados.
- Integración: 599 aprobadas y 1 omitida, en una base PostgreSQL local exclusiva con esquema y seed completos.
- ESLint, TypeScript y build de producción con Webpack: aprobados.
- Workflow contra backend compilado: 3/3 aprobados. Incluye la oferta previa de llamada, identidad en mensajes separados, `Sii` contextual y replay, junto con los dos casos previos de Lucas.

Se mantuvieron los controles de solicitud entregada, causalidad temporal, otra conversación, identidad completa, metadatos no confiables, cambio de tema, nuevo mensaje del agente y deduplicación. No se hicieron llamadas reales ni se usó un modelo pagado.

## Aislamiento del laboratorio

La primera integración mezcló variables de Sheets propias del runner de workflow y colas acumuladas. La verificación final utiliza una base separada y el entorno de integración sin esas variables. El esquema restaurado conserva `search_path=public,extensions`, necesario para pgvector y digest.

La suite de entrega administrada de Retell creaba un curso temporal en el workspace compartido. La prueba del catálogo luego lo trataba como otro curso legado, alterando su expectativa. Ese fixture ahora reutiliza un curso activo del seed; su idempotencia sigue determinada por la llamada y conserva todas las aserciones de entrega. No se relajan las pruebas del catálogo ni se borran historiales.

Un recorrido inicial de workflow omitía la oferta previa existente en la charla de Agus y por eso no autorizaba `Sii`. El fixture final reproduce también esa oferta; no se amplió la autorización de consentimiento para ponerlo en verde. Una interrupción del laboratorio agotó tiempos en una ejecución posterior; se conservaron los límites originales y se repitió la verificación después de la interrupción.

## Alcance y estado

Corrección publicada en producción el 14-10-2026 a las 07:09 Argentina, con autorización del usuario («aplica los cambios asi lo testeo»). Fuente: `232611aaa5280d9e273f21a1f6d8f4c251fbf9e6`; deployment `dpl_Cb5LoQdkafz2YdmLhdNFHTCEDyEv`, READY. No modifica el bundle de Botpress ni el prompt. No se alteró el contacto de Agus ni se reintentó una llamada después de que pidió continuar por chat.

El build remoto de producción con Turbopack aprobó. Se comprobó health HTTP 200 con la versión exacta y probe autenticado HTTP 200 en el deployment antes de promover el mismo artefacto. Después de promover, `https://studyx-agente-ventas.vercel.app/api/health` confirmó la misma versión a las `2026-10-14T10:09:05.722Z`; el probe canónico confirmó autenticación Botpress 200, bot esperado y vencimiento del permiso `2026-10-16T03:00:00.000Z`. No hubo registros de error en la consulta del nuevo deployment de los últimos diez minutos realizada inmediatamente después de publicar; es una observación inicial, no un canario de conversación o llamada real. No se configuraron nuevos monitores ni drains.

Esto cierra la pérdida de datos en la secuencia verificada. No convierte cualquier texto libre en un dato válido ni elimina la necesidad de reparar las confirmaciones no respaldadas o los fallbacks genéricos descritos en la auditoría. Una afirmación del modelo sigue sin ser prueba de persistencia.

Evidencia y logs: `tmp/auditoria-agus-20261013/` en el workspace padre.
