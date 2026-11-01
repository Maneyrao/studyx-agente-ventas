# Contrato de menciones de cursos — 2026-11-01

El backend rechaza cursos adicionales sin rol declarado, aunque `proposed_action=none`. El modelo devuelve `course_mentions` con identidad del catálogo y rol `paid`, `bonus`, `paid_complement` o `alternative`; declarar un rol no concede un efecto. La validación usa nombres canónicos exactos, selección y paquete vigentes recargados en la transacción, y se ejecuta también en modo advisory y conversation_only.

`bonus` exige una acción `offer_course_bonus` autorizada por las nueve reglas más la regla 10, o una entrega anterior confirmada del paquete vigente. Reservas pendientes, paquetes cancelados y declaraciones que intenten convertir un curso adicional en el curso pago se rechazan. El rechazo llega al agente para reparar; el backend no reescribe el mensaje ni infiere roles de frases. El anexo técnico pasa a brain v148; el prompt canónico v101 y el modelo de producción no cambian.

El proveedor exige el campo. La compatibilidad del receptor con propuestas antiguas usa `[]`; un curso adicional sin declarar sigue siendo rechazado. Las selecciones y obligaciones ya entregadas conservan su identidad si un curso deja de estar activo, sin habilitar ventas nuevas ni recuperar paquetes tras cambiar de curso o reiniciar.

## Replay offline

Las cinco entregas sin respaldo de las dos corridas sobre 961c991 quedan rechazadas. Los originales carecen del campo nuevo: producen `COURSE_ROLE_UNDECLARED`. Una anotación explícita del revisor como `bonus`, separada de la salida histórica, activa `forbidden_promise`/`ladder_step_pending`. La oferta autorizada y la recapitulación entregada pasan. El complemento pago positivo es un fixture controlado, no una generación real atribuida al modelo. Son 17 comprobaciones reproducibles, sin llamadas al modelo ni cambios en los originales.

Detalle, textos, roles, hashes y procedencia: [replay](evidence/2026-11-01-course-mentions/offline-replay.md), [datos](evidence/2026-11-01-course-mentions/offline-replay.json).

## Verificación

4.940 unitarias, 954 de integración, 98 del evaluador offline y los cuatro casos del workflow offline de bonificación/alta aprobados. Tipos, lint, compilación del backend y chequeo ADK aprobados. El empaquetado ADK presenta dependencias locales de interfaces no resueltas; también falla en la copia congelada anterior a este cambio. Esa limitación no se presenta como una compilación aprobada ni se modifica configuración para ocultarla.

El workflow de alta encontró una assertion antigua de mayúsculas en postventa, sin respaldo en la autoridad. Se sustituyó por comprobar los tres códigos bonificados activos y su orden; siguen exigidos pago y alta principal, los cuatro nombres y ausencia de factura inventada (prompt :228-230; spec :89-90). Las golden y sus criterios permanecen iguales.

El arquitecto aprobó el código tras corregir la preservación de identidades históricas inactivas. Evidencia de checks: [checks.json](evidence/2026-11-01-course-mentions/checks.json).

## Alcance de la garantía

La detección estructural cubre nombres canónicos exactos y roles declarados. Los alias, insinuaciones sin nombre exacto y roles falsos `alternative`/`paid_complement` requieren evaluación semántica; este contrato no demuestra por sí solo su ausencia. Las dos corridas reales sobre 25970d5 están en el [informe de aceptación](2026-11-01-course-mentions-acceptance.md): 06 y 14 fallan en ambas; no se habilita la suite de 16. No se desplegó.
