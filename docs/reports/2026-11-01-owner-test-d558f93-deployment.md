# Despliegue de desarrollo d558f93 y reinicio del lead de prueba

Despliegue activado y verificado en los recursos que el dueño confirmó para desarrollar: Vercel personal `maneyraos-projects` y Botpress STUDYX, en el workspace llamado Vertice, cuenta `tmaneyro@gmail.com`. La aclaración fue: «por ahora en mi vercel, usamos botpress vertice porque seguimos desarrollando». No se creó ni modificó otro proyecto Vercel de Lucas ni se usó la cuenta De Fazio. Esta decisión y la excepción de aceptación están registradas en AGENTS.md.

Se mantiene **35/48 como riesgo aceptado para esta prueba**. No se modificó el criterio formal de aceptación ni se convirtió ese resultado en PASS. No se repitieron las golden con modelos.

| Componente | Versión realmente verificada |
|---|---|
| Backend | `d558f938f849422d2adc12797e4773bf95b29a0d`, por `/api/health`; `/api/ready` aprobado |
| Botpress | Base `d558f938f849422d2adc12797e4773bf95b29a0d`, observada en logs del proceso ejecutándose |
| Brain | `studyx-agent-a-brain-v149` |
| Prompt | `studyx-agent-a-canonical-v101` |
| Instrumentación | `studyx-release-provenance-v1`, SHA256 `28e43d66df4e5aa65594696d73640b6105794342f462bcf9c152c9143a748769` |
| Bundle Botpress publicado | SHA256 `3d4803677e855bce013ac74fa42d070007abe09742c1f9fac3f79e9a7c51413b`, 24.538.705 bytes |

El SHA base y el hash del artefacto son distintos. Para agregar la observabilidad solicitada, el procedimiento exporta la fuente exacta de d558f93 a una copia e instrumenta tres módulos más un módulo generado. No modifica la fuente original ni la lógica restante: la igualdad del AST sin las inserciones está probada. El snapshot completo detecta cambios de código, prompt, catálogo, configuración, lockfiles y archivos agregados. El bundle instrumentado no se presenta como un artefacto sin modificaciones de d558f93.

Backend: `https://studyx-agente-ventas.vercel.app`, proyecto `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM`, deployment `dpl_4W1qvWBCq4jRBGBARvwhKr8k4sYc`. Primero se construyó sin promover el dominio, se comprobaron salud y disponibilidad y luego se promovió. Botpress: bot `0d7c9ecb-4781-4c65-913d-f7e947fa14d4`, workspace `wkspace_01M4XEBZNC10HX2KDHKY36T6R0`, perfil explícito `studyx-detmaneyro`. Su publicación se activó el **1 de noviembre de 2026, 22:09:54 de Argentina**; preservó configuración, 15 integraciones y 2 plugins. El backend configurado en ese bot coincide con la URL personal.

La base asociada se verificó cruzando la identidad exacta de un mensaje entre la API autenticada del backend y la consulta SQL, además del hilo real de Botpress. Se aplicó únicamente la migración existente `20261031010001_agent_negotiation_observations.sql`; se verificaron columna, función e historial de migración. No se modificaron roles, seeds ni Vault.

La versión de Botpress es consultable mediante sus logs nativos: eventos `studyx.release.loaded` y `studyx.release.entry`. El segundo se emite antes del parseo y de las salidas tempranas, con correlación del workflow y del evento/mensaje. Las observaciones durables posteriores también llevan `botpress_version` con el SHA base y `data.release_provenance` con la instrumentación. No depende de un valor manual de configuración del bot.

La comprobación de ejecución usó un evento existente `studyxPostSale`, sólo en la conversación del dueño, con un UUID de notificación previamente comprobado inexistente. El workflow `wrkflow_01M6CX23303JYD7Q413WHKZXAS` terminó `completed` con `outcome:not_claimed`. Los logs reales de arranque y entrada mostraron d558f93, brain v149 y prompt v101. No llamó al modelo, no emitió mensajes al cliente y no ejecutó efectos de alta/pago.

El número **1169004497** se reinició mediante un procedimiento acotado y reanudable. Se verificó el teléfono normalizado, una sola membresía, el participante de WhatsApp y la ausencia de trabajo activo. Se conservó backup privado; el dry-run ejercitó la transacción y verificó su rollback. El contacto anterior quedó archivado y se creó `98807ee2-8e7a-46d5-9f33-b2764669af04`, vacío. El cambio guardó un recibo de fase dentro de la misma transacción y mantuvo bloqueado temporalmente el contacto nuevo hasta completar las comprobaciones externas.

Se retiraron del contexto anterior 19 memorias seleccionadas y sus estados derivados. Se cancelaron sólo dos solicitudes duplicadas de entregas ya aceptadas y se supersedió una proyección pendiente de Sheets. Se preservaron exactamente pagos, matrículas, fulfillment, notificaciones, historial financiero, mensajes históricos y registros ajenos. La conversación anterior de Botpress se eliminó tras verificar al participante correcto.

Botpress no permite a este bot crear manualmente una conversación de WhatsApp vacía. La acción oficial `startConversation` envía una plantilla, por lo que no se utilizó. Tampoco se enviaron mensajes para forzar una conversación nueva. La comprobación posterior verificó que la conversación anterior no existe, no hay conversaciones coincidentes con las etiquetas exactas ni workflows activos del objetivo. La consulta se hace mediante enumeración paginada de workflows: filtrar por una conversación ya eliminada devuelve `400 ReferenceNotFound` y no prueba ausencia de actividad.

El estado final quedó registrado atómicamente como **`ready_for_first_inbound`** y verificado mediante una ejecución separada. El contacto nuevo está activo y desbloqueado, sin mensajes, conversaciones, memorias, perfiles, estados comerciales ni tareas heredadas. `newBotpressConversationId` es `null`: **la integración creará la conversación con el primer mensaje real del usuario**. Todavía no se afirma una prueba completa de ese nuevo recorrido.

Canal para probar: [WhatsApp Studyx, +1 786-916-4375](https://wa.me/17869164375), desde 1169004497. El número del bot fue verificado directamente con Meta, para el phone-number ID `1300545066485709`; no se dedujo de los teléfonos de contacto de la plantilla de postventa.

Validación local final: **4.997 unitarias aprobadas**, TypeScript y lint aprobados. Incluye 14 pruebas de procedencia y 21 del reinicio. El arquitecto revisó el procedimiento, las recuperaciones y las condiciones de desbloqueo. Los comprobantes de publicación, logs reales, probe y verificación del lead están en [la evidencia pública sin credenciales](evidence/2026-11-01-owner-test-d558f93-deployment/verification.json); backups y snapshots privados permanecen fuera de Git.
