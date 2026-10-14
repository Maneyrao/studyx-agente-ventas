# Alta de Lucas y extensión del permiso — 13 de octubre de 2026

## Causa comprobada

Lucas completó el pago de prueba de Oratoria. Stripe confirmó el pago y el orquestador creó la solicitud de alta. La matrícula se detuvo después, con `sandbox_live_bridge_expired`, porque el permiso para convertir un pago de prueba en un alta real vencía el 10-10 a las 00:00 de Argentina (`2026-10-10T03:00:00Z`).

El pago quedó `paid/test`; no faltó el registro ni falló la confirmación de Stripe. El worker pasó la solicitud a `dead_letter` tras un intento, sin crear inscripción. El chat sí recibió los avisos de pago confirmado y alta en revisión. Extender el plazo por sí solo no recuperaba una solicitud ya terminal.

La prueba de Thiago funcionó el 9 de octubre porque estaba dentro del permiso. Su pago `46595744-4993-48cd-87f0-026ec619272e` tiene inscripción activa (`stu_29894`, `enr_1`) y verificación previa de acceso al campus. La diferencia demostrada es temporal/configuración, no un commit de registro omitido.

## Recuperación autorizada y completada

El usuario autorizó dar de alta a Lucas usando el pago confirmado y extender el permiso hasta el final del **15 de octubre de 2026, hora Argentina**. Se publicó `CENTRAL_CARGA_SANDBOX_LIVE_UNTIL=2026-10-16T03:00:00Z`. El backend activo informa el mismo vencimiento; los pagos y links continúan en entorno `test`.

Se consultó primero la central: `not_found`. Luego se reabrió exclusivamente la solicitud identificada, mediante una transacción que verificó pago, contacto, curso, estado y error originales. Se conservó `attempt_count=1` y se añadió un evento de auditoría. El worker volvió a consultar la central antes del POST y reutilizó la misma clave de pago.

| Evidencia | Resultado |
|---|---|
| Pago | `730bbbb9-0f2c-4721-bcbe-85dd24877a49`, `paid/test`, USD 360 de prueba, Oratoria |
| Identidad congelada del registro | Juan; se conservó el correo aportado en el chat, sin sustituirlo por otro |
| Solicitud | `20d2cfe7-f959-4a9f-9d99-e7fafd64199f`, `completed`, intento 2 de 3 |
| Alta | `stu_29902`, inscripción `enr_2`, `active`, cuenta nueva |
| Confirmación | 13-10-2026 21:17:31 Argentina; GET posterior de la central devuelve `success` |
| Identidad del acceso | Correo de acceso coincide con el correo congelado del pago |
| Aviso de acceso | `617c84d8-c4d9-4eaa-9662-dd01ebb764c5`, `sent`, 13-10 21:27:16 Argentina |
| Mensaje del proveedor | `735d70fc-33a6-4d6d-a32a-d0b5dc4caf1a` |
| Mensaje durable | `30006d87-e15f-4baf-8b55-48cf7abc7c69`, incluye curso, usuario y contraseña |

No se creó otro pago ni se efectuó otro cobro. La central informa `welcome_sent=true`; ese valor es la confirmación del proveedor, no una prueba de lectura del correo. La entrega del chat quedó aceptada por el proveedor, no se afirma que Lucas haya leído el mensaje o iniciado sesión. La central no devolvió URL de ingreso; no se inventó una.

## Hallazgo adicional del aviso automático

El primer evento `studyxPostSale` de acceso no produjo un claim antes de la publicación de Botpress. Un segundo evento (`evt_01M4VWF278GH83SBAKZHA6HGCV`, 21:19:46 Argentina) también figuró `processed` en Botpress, sin error, mientras la notificación seguía `dispatched` y el backend no tenía mensaje de salida. Las credenciales entre bot y backend se comprobaron con una petición firmada válida; la URL y los flags remotos también estaban correctos. Esto no basta para atribuir una causa al evento sin ejecución.

Para completar el acceso se utilizó el tercer intento de despacho permitido y se procesó la misma notificación mediante las rutas autenticadas `claim` y `deliver`. El backend validó identidad, matrícula, token de claim y lease, añadió las credenciales autoritativas y usó su clave de envío idempotente habitual. Hubo un único mensaje de acceso; no se forzó su estado a `sent` ni se envió un mensaje por fuera del sistema.

El alta está resuelta; la ejecución automática de ese evento requiere investigación adicional. No debe confundirse el `processed` del proveedor con entrega al usuario. La corrección de llamadas está publicada y conserva pendiente el canario de llamada real, como se detalla en el informe asociado.

## Ubicación de evidencia

Consultas originales, comprobaciones remotas y resultados de recuperación: `tmp/auditoria-alta-lucas-20261013/` en el workspace padre. Los archivos con datos completos tienen permisos privados y no se agregaron a Git. La evidencia de despliegue y esta síntesis no contienen secretos.
