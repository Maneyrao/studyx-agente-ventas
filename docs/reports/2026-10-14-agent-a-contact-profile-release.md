# Agent A — perfil canónico y recolección por campo

Estado: publicado en producción y verificado el 14-10-2026 a las 14:47 Argentina. Autorización: «Excelente, entonces modificalo y publicalo».

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

Fuente publicada: `4abe256192109ab8f99cf46b476b2cda4a93ba8c`, disponible en `origin/codex/lucas-call-recovery`. Se verificaron los hashes de los 308 archivos de fuente antes y después del despliegue. Este cierre documental no cambia el código publicado.

Migración aditiva aplicada y verificada a las 14:37:05 Argentina: `20261014163031` (SHA-256 `3f39c453487f483e11c95df7a047b3c3871f2a36ab1c07f6efa75eb51bd13fb2`). La comprobación previa y posterior confirmó que no cambia permisos ni RLS.

Backend Vercel `dpl_DAyd8b5tKNdSus6Hpa5ZHaM7rgTn`, estado READY, promovido a `https://studyx-agente-ventas.vercel.app`. La salud del dominio principal devolvió HTTP 200 y el SHA publicado a las 14:47:01 Argentina. La comprobación firmada del nuevo endpoint de perfil rechazó un turno ficticio con `CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED` (HTTP 409), sin escribir datos.

Botpress publicó exitosamente Brain v103 en el mismo bot `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`, `deployedAt=2026-10-14T17:44:50.168Z`. La consulta posterior confirmó modo plannerless, modelo `deepseek-v4-flash`, asesora Emma, timeout de 10 segundos y URL del backend principal. La personalidad canónica v69 y sus dos módulos generados siguen idénticos byte por byte.

El sondeo final de sólo lectura respondió HTTP 200 a las 14:47:02 Argentina: Central Carga accesible, Botpress HTTP 200 con el bot correcto y ventana sandbox conservada hasta `2026-10-16T03:00:00Z` (final del 15-10 Argentina). La consulta de errores de Vercel de los diez minutos previos no devolvió entradas; esto no sustituye una prueba real del canal o del scheduler.

Bundle final congelado: 23.823.976 bytes, SHA-256 `ab045c8e73904e872fa0986b5e3f55b4c2a169a8ed9586574d723cc80175b229`. Evidencia privada conservada en `tmp/agent-profile-owner-4abe256-release.json` y `tmp/agent-profile-owner-4abe256-index.cjs.gz` del workspace principal, fuera de Git. El manifiesto reúne versiones, hashes, comprobaciones y límites de la validación.
