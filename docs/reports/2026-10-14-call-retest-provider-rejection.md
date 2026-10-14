# Prueba de llamada después del reinicio de memoria

Contacto nuevo `bba7f055-bd2d-4a74-84fd-958a354ec536`; conversación `44de18e8-13bb-4b22-a830-4224e416948c`. Backend activo 232611a; agente Brain v100. Horas siguientes en Argentina.

Dos fallos distintos:

1. A las 07:29, «dale me llamas?» todavía sin identidad produjo dos propuestas rechazadas por `MISSING_INTAKE:nombre`, `MISSING_INTAKE:apellido` y `UNSUPPORTED_OPERATIONAL_CLAIM:call_confirmation`. Se publicó el fallback genérico «se cortó mi respuesta». No hubo despacho en ese turno. Esta debilidad de reparación/fallback no está solucionada por la persistencia y sigue pendiente.
2. Tras el nuevo pedido, los fragmentos «Thiago» y «maneyro», el correo y el teléfono declarado se persistieron, con recibos server-side de la pregunta entregada. El agente pidió disponibilidad y el usuario respondió «sii» a las 07:33:34. La decisión a las 07:33:42 autorizó `request_call_now` y creó `0f91c4ff-01c6-4d8a-8563-2e3ff2f69bbd`. Xendra respondió HTTP 400: estado durable failed, `XENDRA_CREATE_REJECTED_400`, sin provider_call_id. El aviso único de fallo salió a las 07:33:46, junto al evento interno de resultado. No hubo llamada aceptada por el proveedor.

El manejo del rechazo confirmado funcionó en esta prueba. El HTTP 400 no determina por sí solo si falló el payload o la configuración/validación de Xendra. `xendra-voice.provider.ts` descarta el cuerpo del error y propaga únicamente su status, por lo que no se conserva aquí el motivo original. Su archivo no tiene diferencias frente a b742e30, anterior al 2 de octubre; esto no basta para demostrar compatibilidad actual del contrato remoto.

Acceso comprobado: CLI y conector Vercel disponibles pertenecen al equipo maneyraos-projects; la inspección explícita de xendrapro-admin no encuentra el proyecto. No hay herramientas de Xendra/Retell/n8n disponibles en esta sesión. El handoff anterior atribuye a Xendra la administración de Retell, SIP y número saliente: tener el endpoint integrado no incluye acceso administrativo a esos registros. Consulta inicial de error logs del deployment de StudyX no devolvió eventos; el fallo confirmado es un resultado manejado, no necesariamente un log de nivel error.

Se solicitó el detalle del rechazo de Xendra para ese internal_call_id y horario. Pendiente: evidencia del servidor remoto o acceso autorizado a sus logs; conservar un diagnóstico acotado del rechazo en futuros despachos; reparar el fallback de propuesta inválida con datos faltantes. No se reprodujo mediante llamadas reales, no se reintentó la llamada y no se cambiaron credenciales ni configuración del proveedor.

Evidencia privada: `tmp/call-retest-20261014-evidence.json` (primer corte) y archivos fechados `tmp/call-retest-20261014-evidence-*.json`, en el workspace padre.
