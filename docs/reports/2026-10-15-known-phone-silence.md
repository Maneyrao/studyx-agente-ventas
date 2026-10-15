# Silencio al aceptar llamada — 15/10/2026

## Evidencia del incidente

Contacto identificado por el usuario: terminación 4497. Conversación Botpress `conv_01M4ZQ4C14J8FVMB50YMKHVR0F`; traza `93f5b4a6-2a63-4ce9-aa11-1d1f9034d931`.

A las 09:06:23–09:06:28 de Argentina llegaron tres mensajes con aceptación de llamada, nombre, apellido y correo. Los tres se agruparon correctamente. A las 09:06:36 el backend confirmó los tres campos nuevos y conservó el teléfono ya confirmado por el canal. No hubo pérdida de identidad.

La primera propuesta y su continuación pidieron el teléfono como faltante. El workflow rechazó `contact_profile.already_confirmed.telefono`, pero a las 09:06:41 persistió `AGENT_A_CONTINUATION_REJECTED` como decisión `suppress` y completó el lote sin salida. No se creó llamada. Por tanto, este incidente ocurrió antes de la entrega a WhatsApp: no fue un mensaje enviado que Meta hubiera perdido.

El backend activo seguía en `927be07` y el bot publicado el 14/10 a las 20:26 UTC, anteriores al candidato de recuperación. Se confirmó por salud del backend, mensajes de Botpress, base y pasos persistidos del workflow. La lectura se hizo sin modificar esa conversación.

## Corrección conjunta

El candidato anterior ya sustituye el cierre silencioso por recuperación durable. Esta revisión añade una política compartida para el contrato de salida del modelo y el control del workflow: un campo confirmado no se puede pedir como faltante. Después de un rechazo concreto, cambiar su etiqueta de `collect` a `clarify` tampoco elude ese rechazo. Las aclaraciones legítimas sobre otros campos siguen disponibles.

La captura de datos sigue ocurriendo antes de validar el resto de la propuesta. La recuperación reclama contexto nuevo, mantiene los datos confirmados y conserva el requisito de disponibilidad antes de llamar. El agente redacta la respuesta; no se añade texto comercial fijo ni se cambia la personalidad canónica v70.

El contrato interno cambia a Brain v107 para explicar la autoridad de los datos confirmados por el canal frente a las pruebas de mensajes requeridas para datos nuevos. La personalidad y el catálogo permanecen iguales.

## Validación y límites

La reproducción automatizada falló antes del control compartido: la continuación podía pedir nuevamente el teléfono bajo `clarify`. Después, el flujo completo rechazó ambos borradores, guardó nombre/apellido/correo, recuperó con contexto nuevo, entregó una sola pregunta de disponibilidad y no creó ninguna llamada. Repetir el evento no duplicó la respuesta.

Las pruebas con el proveedor real confirmaron que restringir el esquema o explicar el error no garantiza por sí solo una reparación correcta: persistió una petición incorrecta del teléfono en la continuación. El caso normal mejoró, pero no se certifica fiabilidad semántica por esa muestra. Por eso la corrección exige validación local y recuperación, en lugar de confiar en el esquema remoto. El presupuesto acumulado conservó las 16 solicitudes máximas y el límite de USD 0,50; no se reinició.

Referencia de formato del proveedor: [Responses API de DeepSeek](https://api-docs.deepseek.com/api/create-response/). La documentación describe JSON Schema; las observaciones de incumplimiento corresponden a esta prueba, no a una garantía general sobre el servicio.

La verificación final de esta revisión y el resultado de publicación se registran en el entregable del incidente. No reingresar automáticamente el evento antiguo: ya tiene una decisión histórica de supresión. La prueba del canal debe usar un mensaje nuevo y verificar la nueva versión.

## Publicación autorizada

El usuario confirmó aplicar sobre la cuenta actual. La publicación coordina las tres migraciones nuevas, el backend y Botpress. Se conserva la configuración remota y se prepara reversión al deployment anterior. El cron de recuperación se puede ejecutar cada minuto en Supabase Cron, cuya extensión está disponible pero requiere habilitación en esta cuenta; su comando solo reconcilia las recuperaciones del workspace StudyX y no envía mensajes ni llamadas.


## Diferencia operativa detectada antes del corte

La conexión `DATABASE_URL` actual inicia como `postgres`, con `statement_timeout=2min`. Los límites nuevos de `orchestrator_role` no acotan esa conexión. No se cambiaron límites globales de `postgres` ni se rotó la conexión a un rol sin verificar todos sus permisos. Las mediciones nuevas identifican el backend por `application_name`; la migración de credencial/rol y la reducción comprobada de latencia quedan como trabajo pendiente. La publicación de recuperación no debe describirse como solución demostrada de los timeouts antiguos.

Validación local final: 4.147 pruebas unitarias y 22 de workflow aprobadas; 17 unitarias omitidas, 7 pendientes de implementación. La integración de backend conserva 662 pruebas aprobadas en el candidato anterior y 23 dirigidas posteriores al orden temporal; esta revisión cambia el agente y su contrato, sin cambiar el backend. Tipos, lint y compilación ADK pasaron.
