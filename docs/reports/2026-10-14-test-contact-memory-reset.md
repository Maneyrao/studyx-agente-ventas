# Reinicio de memoria para prueba desde cero

Autorización: el usuario pidió borrar toda la memoria de la conversación del número terminado en 4497 para repetir la prueba. Ejecutado el 14-10-2026, verificación final a las `2026-10-14T10:22:12.925Z` (07:22 Argentina).

Contacto anterior: `94916092-e172-44a6-8217-173551c7ca46`; conversación `d1a54587-c73f-4e07-97f2-8b8bafcc83ed`. Contacto nuevo para el mismo número: `bba7f055-bd2d-4a74-84fd-958a354ec536`, prospecto activo en etapa new, sin nombre, correo, teléfono declarado ni resumen.

Se borraron 108 mensajes, 8 recuerdos, 30 decisiones y lotes, estados y eventos de venta, permisos conversacionales, hilos, eventos de transporte, entregas y colas derivadas. Se eliminó también la conversación Botpress `conv_01M3Z5J2N5A47HC5SWNHGG8EXX` y se verificó su ausencia; el segundo hilo histórico ya no existía. No se enviaron mensajes ni se dispararon llamadas.

El contacto anterior tenía cinco registros de pago y una matrícula activa. Para reiniciar exclusivamente la memoria sin alterar identidad financiera inmutable ni acceso al curso, se conservaron esos registros bajo el contacto anterior, marcado deleted, sin datos de intake y con número sintético reservado +999. El número real pertenece al contacto nuevo. El vínculo del pago con la conversación borrada se dejó nulo; el resto de los campos financieros y toda la matrícula se compararon antes/después y permanecieron iguales. No se deshabilitaron constraints ni triggers de eventos inmutables.

La operación completa se comprobó primero en una transacción serializable revertida y después se aplicó en otra transacción serializable, condicionada al contacto exacto, número, 108 mensajes y ausencia de trabajo activo. La verificación independiente de sólo lectura confirmó cero mensajes, conversaciones, recuerdos, estados, hilos, intereses, pagos, llamadas y decisiones en el contexto nuevo; cero memoria conversacional también en el contacto anterior. La matrícula anterior sigue active. La fila proyectada externa en Sheets y el acceso de Central no son fuentes de memoria conversacional y no se modificaron; se borró la proyección local vinculada al contacto anterior.

Evidencia privada sin credenciales: `tmp/reset-1169004497-result.json`, `tmp/reset-1169004497-botpress-result.json` y `tmp/reset-1169004497-verified.json`, en el workspace padre. Esto es una operación de datos; no cambió el deployment 232611a.
