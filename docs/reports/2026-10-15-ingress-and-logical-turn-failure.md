# Reapertura: pérdida de entrada y fragmentación del turno

Estado: fallo confirmado en el canario real de la versión `2027514` / Brain v107. La certificación de estabilidad está rechazada. Esta investigación no acredita una corrección completa.

## Recorrido real (Argentina, 15/10)

| Hora | Hecho verificado |
| --- | --- |
| 10:00:36–37 | Dos mensajes se agruparon; el contexto tenía los cuatro datos completos. |
| 10:01:01 | El modelo pidió el teléfono como faltante con `profile_requests.mode=clarify` en su primera propuesta. La política nueva lo permitió. |
| 10:30:57–59 | «Sii» y «asi es» formaron un lote de dos mensajes y produjeron un solo enlace de pago. |
| 10:31:25.930 | Llegó «como sé si es seguro». |
| 10:31:28.714 | Llegó «el acceso como se me da?», 2,784 segundos después. |
| 10:33:04.266 | Solo la pregunta del acceso llegó al historial canónico, después de varias esperas HTTP. |
| 10:33:13.549 | Se respondió sobre el acceso, 104,835 segundos después de recibir esa pregunta. |
| 10:36:56.463 | La ejecución de la pregunta de seguridad terminó en Botpress con resultado `paused_error`, `STUDYX_TIMEOUT`, sin turn_id ni respuesta. |
| 10:45:32 | La pregunta de seguridad seguía ausente de la tabla de mensajes. |

Hay errores reales de disponibilidad y consistencia. La agrupación normal funciona en algunos casos; eso no cubre retrasos asimétricos de entrada. La separación de 10 segundos entre «seguimos por acá» y la consulta de dinámica corresponde a dos ventanas normales de cinco segundos; el caso seguridad/acceso sí estaba dentro de la misma ventana nominal y se fragmentó por el fallo de entrada.

## Fronteras estructurales que fallan juntas

1. **Recepción durable y procesamiento canónico no comparten una unidad de recuperación.** Botpress conserva cada mensaje, pero cada burbuja intenta ingerirse independientemente. La base solo puede agrupar lo que logró entrar. Una burbuja posterior puede avanzar mientras otra sigue fuera del contexto canónico.
2. **La recuperación agregada el 15/10 empieza demasiado tarde para este incidente.** `inbound_batch_recoveries` requiere lote y token. Si falla la ingesta, no existen. El workflow devuelve `paused_error`, pero el ejecutor queda `completed`; el registro de recuperación de lotes no cubre esa salida.
3. **Los datos confirmados no dominan todas las variantes del contrato de salida.** La política compartida prohíbe `collect` y también `clarify` después de un rechazo específico. Permite `clarify` en la propuesta inicial. El canario demostró que el modelo usó esa variante para afirmar falsamente que faltaba el teléfono.
4. **La observabilidad previa empieza después de operaciones que pueden quedar pendientes.** `db.transaction.started` se emite cuando se obtiene la conexión y comienza la transacción. No permitía distinguir una espera de pool de una lectura HTTP detenida. Las solicitudes fallidas de Vercel muestran 300 segundos y carecen de logs de aplicación; las exitosas guardan el mensaje en aproximadamente 0,65 segundos.
5. **Los límites del rol nuevo no protegen la conexión real.** Sigue conectando como `postgres`. Este desajuste es real, pero no prueba que una consulta SQL sea la causa de estos 300 segundos.

El proyecto combina módulos verticales con dominio, aplicación, puertos y adaptadores. Esa organización de carpetas no garantiza por sí sola las invariantes anteriores. El contrato de turno lógico se rompe entre transporte y persistencia; el contrato de recuperación tiene dos zonas con desenlaces distintos.

## Lo realizado en esta reapertura

- Lectura correlacionada de mensajes de WhatsApp, pasos persistidos de Botpress, base y solicitudes Vercel del despliegue exacto.
- Conservación de registros de solicitudes, incluidos 504 de 300 segundos. Las búsquedas iniciales solo de consola no mostraban esas solicitudes sin logs; se amplió a registros HTTP.
- Doce solicitudes firmadas sintéticas inválidas devolvieron 400 antes de persistir. Confirman que el transporte funciona desde el entorno local en esa muestra, no que el camino Botpress–Vercel esté sano en todo momento.
- Una lectura de actividad de PostgreSQL no encontró consultas/bloqueos activos. Es una fotografía posterior, no una exclusión retrospectiva del pool.
- Medición añadida en entrada del proxy, lectura del cuerpo, autenticación, entrada del handler y cola de transacción. No contiene texto del cliente ni credenciales y no cambia reglas de conversación.

## Cierre necesario

Primero localizar la espera con las nuevas fronteras medidas. Luego corregir la recepción/recuperación con una prueba de dos fragmentos donde el primero falla y el segundo puede llegar: ninguna pregunta puede desaparecer ni permitir una respuesta basada en un turno incompleto. La salida al agotar reintentos debe conservar trabajo pendiente y tener un mecanismo real de reanudación; un resultado llamado `paused_error` no basta.

El contrato de perfil debe diferenciar aclarar/corregir un dato conocido de declararlo inexistente, preservando confirmaciones y correcciones legítimas. La prueba debe empezar con `clarify` en la primera propuesta, además del caso de reparación ya cubierto.

Validar juntos: ráfagas, demoras, reintentos, historial, datos confirmados, consentimiento de llamadas, pago único, dudas posteriores al enlace, recepción fuera de orden y ausencia de duplicados. Mantener la personalidad canónica v70 y la autoría de Agent A. No afirmar solución integral por una prueba local ni por salud HTTP.

Posible hipótesis pendiente: reutilización de conexiones TCP inactivas en serverless. Está descrita por [Supabase](https://supabase.com/docs/guides/troubleshooting/troubleshooting-connect_timeout-or-hanging-queries-in-vercel-serverless-functions-775f92), pero no está probada en este incidente. No aplicar una rotación de pool o una modificación de límites globales solo por coincidencia de síntomas.
