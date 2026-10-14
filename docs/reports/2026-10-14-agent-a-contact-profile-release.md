# Agent A — perfil canónico y recolección por campo

Estado: validación aprobada; publicación en curso. Autorización: «Excelente, entonces modificalo y publicalo».

## Problema corregido

La interpretación conversacional y la captura de identidad tenían autoridades distintas. A podía reconocer un nombre mientras la ingesta no lo guardaba; un apellido parcial se descartaba al reconstruir `contacts.name`; una pregunta dejaba de ser capturable cuando salía otra burbuja. No hubo evidencia de un commit perdido: el límite estaba también en `b742e30`, anterior al 2 de octubre. El diagnóstico y la comparación están en `2026-10-14-ori-intake-architecture.md`.

## Implementación general

A devuelve `profile_updates` con campo, operación, UUID físico de origen y evidencia literal. El backend comprueba procedencia, formato técnico, orden y versión de cada campo, sin interpretar nombres. El perfil JSONB guarda nombre, apellido, correo y teléfono independientemente, incluidas retractaciones. Las columnas anteriores son proyecciones de compatibilidad.

Una fase de captura firmada y cercada por el token del lote confirma los datos antes de validar texto o efectos. Cada reparación que proponga datos nuevos pasa por la misma persistencia. Los recibos reconstruyen el contexto de A y el backend vuelve a leer esa fuente para autorizar llamadas y pagos. Un veto, una reparación o una respuesta reemplazada no borra los datos ya confirmados. La confirmación de un teléfono sugerido conserva su prueba de entrega y también se guarda en esta fase independiente.

Las preguntas pendientes son metadatos de las partes realmente entregadas. El mapa conserva sus índices al unir burbujas y descarta preguntas eliminadas o reescritas. La entrega debe preceder a la entrada interpretada; cada campo respondido cierra su solicitud. El cierre también contempla datos confirmados durante una llamada.

La ingesta marcada como propiedad de A deja de interpretar identidad mediante expresiones regulares. Los escritores de voz actualizan los mismos campos con evidencia correlacionada y replay acotado. Un análisis tardío no pisa una corrección de chat posterior al inicio de la llamada. La ruta V3 lee el perfil canónico y rechaza escrituras preparadas que intentarían competir con él.

Una llamada pendiente puede continuar con los datos recién confirmados y la interpretación de A; el backend conserva consentimiento, disponibilidad, exclusividad y límites del ledger. Una recomendación de ofrecer llamada no revoca un pago que ya cumple los datos, curso, plan y permisos canónicos. Los errores operacionales siguen siendo hechos para A, que conserva la redacción de sus respuestas.

Brain v103 cambia únicamente el contrato de ejecución. Los dos módulos generados de personalidad canónica v69 y su fuente permanecen idénticos byte por byte. Se conserva el máximo de dos solicitudes físicas al modelo; el límite de salida de DeepSeek pasa a 1.600 tokens para incluir la nueva estructura sin truncarla.

## Evidencia

- 4.027 pruebas unitarias aprobadas; 17 omitidas y siete pendientes previas. Cobertura configurada: 98,91 % de líneas y 93,07 % de ramas; no equivale a cobertura de todo el producto.
- Regresión de integración final: 639 aprobadas y una omitida, en 77 archivos y una base nueva. El rerun detectó una diferencia de 108 microsegundos en el fixture; se corrigió únicamente su separación temporal de 2 ms, manteniendo el control causal productivo.
- Nuevos workflows generales: cuatro aprobados. Pago original con elección de chat antes de una oferta: uno aprobado. Regresiones de llamadas: ocho aprobadas; catálogo: cinco. Rerun final: cuatro escenarios nuevos y siete manuales aprobados (11/11).
- Canario con DeepSeek real: seis entradas y seis solicitudes HTTP; nombres compuestos, identidad de terceros, corrección, retractación, referencia y respuesta breve. Se verificaron campos persistidos, contexto del turno siguiente y respuestas visibles. Costo contabilizado por el ledger existente: USD 0,02017844; acumulado USD 1,245622688 de USD 1,30.
- Tipos, lint, compilación Next.js y ADK, `adk check` y preflight del mismo bot aprobados. Sin cambios destructivos de almacenamiento de Botpress. Fuente productiva congelada: 308 archivos.
- Revisión independiente: todos los hallazgos materiales corregidos y verificados, sin comportamientos descartados del alcance.

El canario ejecutó el workflow y el backend reales contra PostgreSQL aislado; las entregas se capturaron y los pagos fueron ficticios. No ejecutó llamadas reales ni probó el scheduler o el canal de Botpress Cloud. La interpretación del modelo puede seguir necesitando aclaración ante datos ambiguos: estas pruebas no prometen cero errores futuros.

Se conservan dos expectativas históricas de múltiples cursos que exigían poda o reparación bajo la política anterior; ya se reprodujeron en `a69970a` y no se debilitaron para cerrar esta corrección. La tercera expectativa histórica, el pago detenido por `CALL_OFFER_REQUIRED`, sí queda corregida y su escenario original pasa.

## Publicación

Migración aditiva aplicada y verificada a las 14:37:05 Argentina: `20261014163031` (SHA-256 `3f39c453487f483e11c95df7a047b3c3871f2a36ab1c07f6efa75eb51bd13fb2`). Backend y Botpress v103 pendientes de publicar y verificar. La revisión previa comprobó que la migración no cambia permisos ni RLS.
