# Formato de llamada y juez de entrega — 2026-11-01

Dos cambios acotados autorizados antes de la aceptación formal; sin cambios al prompt canónico, al modelo de producción ni a los criterios golden.

## Formato técnico de llamada

Una burbuja completa exactamente igual a `response.call_offer` se elimina sólo de la vista de entrega. El campo dedicado se conserva íntegro. La propuesta bruta y sus índices permanecen intactos para esquema, validación, perfil y auditoría. Así una invitación como única respuesta sigue siendo visible una vez, sin ampliar el esquema ni inventar texto para llenar `messages`. Los guards de Botpress y el backend usan la misma igualdad estricta; las variantes con texto adicional siguen siendo reparables. No hay recortes parciales ni deduplicación por significado.

El anexo técnico v149 especifica que una invitación durante la reparación por escalera pendiente va sólo en `response.call_offer`; `messages` contiene el resto de la respuesta. Autoridad comercial inalterada: prompt :106-123, :206-212, :236 y autorización explícita del usuario del 2026-11-01 para esta adaptación de entrega.

Tests reales cubren ubicación primera/última/única, texto distinto preservado, raw sin mutación, metadata de perfil mapeada a la parte correcta y una sola actualización del contador con recibos repetidos. Se reprodujeron siete fallos antes del arreglo; ahora pasan.

## Juez v3

La evidencia normativa contiene exclusivamente respuesta entregada, efecto comprometido, estado y recibo final. Los rechazos superados y las propuestas descartadas se conservan en las observaciones originales y auditoría; no se envían como motivo normativo para reprobar la entrega. Los hechos anteriores al turno siguen separados del estado final, para que una llamada del mismo turno no autorice retroactivamente un regalo.

La línea :129 se interpreta según el objeto de la promesa: un enlace de inscripción no es un regalo. La prohibición sobre bonificaciones o excepciones conserva su fuerza. No se agregan overrides léxicos ni regex de ventas. Cualquier cita no vacía del juez debe existir en la fuente entregada elegible; una cita de un borrador rechazado produce error explícito del evaluador, no un aprobado. Los must ausentes todavía admiten evidencia vacía.

Se reprodujeron cinco fallos de selección de evidencia y un fallo de cita falsa antes de corregir. Los tests protegen enlace, bonificación indebida real, reparación entregada, error final no resuelto y separación temporal. Prueban el contrato del evaluador; el comportamiento del juez real se mide en la aceptación.

## Verificación

| Control | Resultado |
|---|---|
| Unitarias | 4.949 aprobadas |
| Integración | 957 aprobadas, 1 omitida |
| Evaluador offline | 104 aprobadas, 3 omitidas |
| Tipos / lint / build Next / check ADK | Aprobados |
| Arquitecto | Aprobado, sin hallazgos materiales pendientes |

Logs originales comprimidos sin modificar sus bytes: [evidencia](evidence/2026-11-01-call-format-judge-v3/checks.json). El empaquetado ADK mantiene la limitación local de interfaces documentada previamente; no se declara aprobado ni se despliega.

Tras commit y push se autoriza **una** corrida Flash de las 16 conversaciones: mínimo 41/48, críticos 07/10/11/12/15 completos y cero bonificaciones sin respaldo. 06 y 14 se informan sin gate individual, pero sus turnos siguen dentro del total de 48. No hubo llamadas al modelo durante esta implementación.

La [aceptación formal posterior](2026-11-01-formal-acceptance-v149.md) ejecutó las 16 una vez sobre f1f0f9c: 34/48, críticos completos y cero bonos sin respaldo observados. No alcanza el mínimo de 41/48 y no se desplegó.
