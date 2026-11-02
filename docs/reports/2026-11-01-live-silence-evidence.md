# Silencio en la prueba del dueño — 2026-11-01

Dos mensajes reales llegaron por WhatsApp al bot STUDYX y al backend personal,
pero terminaron `paused_error / TURN_EVIDENCE_UNAVAILABLE` antes de comprometer
una decisión o crear una salida. No fue un problema de recepción ni un rechazo
de la redacción comercial.

## Causas verificadas

1. `recordTurnEvidence` leía directamente `audit_log`. El rol efectivo de la
   aplicación es `orchestrator_role`, deliberadamente sin permiso de lectura.
   La reproducción con `SET LOCAL ROLE` falla con `42501`; el mismo servicio
   funciona como administrador. El endpoint firmado devuelve 503. Se reemplaza
   esa lectura por una operación privada y específica de append, con sujeto y
   workspace autorizados dentro de la función. No se amplían permisos de tabla.
2. ADK 2.0.8 crea referencias de workflow con `TrackedState` sin cargar. Tanto
   el iniciador como el callback podían guardar defaults sobre el estado del
   worker. La prueba ejecuta el `TrackedState` del SDK instalado: sin cargarlo
   borra el borrador; hidratando el callback conserva el contenido sin escribir.
   Los iniciadores usan ahora el cliente público sin crear estado local del
   workflow; el callback carga su referencia antes de finalizar.
3. El tag de revisión se guardaba después de `completed`, causando 403. Ahora
   se espera su guardado antes de finalizar, y su fallo auxiliar conserva el
   resultado de revisión. La protección también reconoce el resultado del
   workflow y los cuatro estados terminales, aunque falte el tag.

## Límite de la evidencia original

Los respaldos privados de ambos workflows conservan ingreso, claim y error del
paso de generación. Sus estados ya habían sido sobrescritos con defaults:
`pendingEvidence=[]`. No hay un borrador recuperable en esos respaldos. Eso
**no demuestra que el proveedor no haya sido llamado**. No se reconstruyen
borradores ni se presentan respuestas inventadas como evidencia real.

Los dos intentos se preservan. Al superar el horizonte de diez minutos no se
reinyectan ni se altera su fecha: la comprobación de entrega requiere un mensaje
nuevo del dueño.

## Garantías del arreglo

- Append durable e idempotente, primer SHA conservado entre versiones; un
  payload diferente con la misma identidad sigue rechazado.
- Autorización de sujeto/workspace; sin acceso público al RPC ni lectura
  directa de auditoría por el rol de aplicación.
- Readiness exige que ese rol pueda ejecutar el append requerido.
- Errores con SQLSTATE y trace, sin borradores, credenciales ni parámetros SQL
  en los logs de diagnóstico.
- Sin cambios de prompt, modelo, criterios golden ni reglas de bonificación.
- La aceptación comercial 35/48 permanece como riesgo aceptado para desarrollo;
  estas pruebas técnicas no la convierten en una aceptación formal aprobada.

## Verificación antes de publicación

5.008 pruebas unitarias pasan en la corrida completa; la comprobación real de
registro ADK excedió cinco segundos con carga y se repitió aislada. Integración
de evidencia y postventa: 8 aprobadas. TypeScript de backend/Botpress y lint se
comprueban antes de publicar. El arquitecto revisó el arreglo y sus dos hallazgos
materiales quedaron resueltos.

La publicación y la entrega real se documentan separadamente con sus recibos;
este informe no afirma que haya ocurrido una respuesta al cliente.
