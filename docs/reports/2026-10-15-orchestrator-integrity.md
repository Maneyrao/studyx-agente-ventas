# Integridad conjunta del orquestador — 15/10/2026

Estado: implementación y certificación local; pendiente prueba de canal y destino. No se publicó a producción.

Base: `927be073334022b2d71ca67d97ebf4c1ce7742d7`, identificada en el despliegue auditado. Rama: `codex/orchestrator-integrity-20261015`. El parche inconcluso de `lucas-call-recovery` y el checkout principal se conservaron intactos.

## Contrato preservado

Agent A conserva la autoría de la conversación, sus propuestas y la personalidad canónica v70. El backend valida hechos, permisos, pertenencia, persistencia y efectos; los adaptadores ejecutan transporte. V3 no se activa. No se incorporó otra ruta comercial determinista ni una plantilla que simule una respuesta del modelo. Los archivos de personalidad y sus dos módulos generados son idénticos a la base.

La arquitectura existente combina módulos por funcionalidad con dominio, aplicación, puertos y adaptadores. Esta corrección conserva esas fronteras. La recuperación de lotes usa el mismo mecanismo transaccional y orden de bloqueos que la recepción; no reinterpreta la intención comercial.

## Cambios que deben coexistir

1. Los rechazos del backend y sus fallos de transporte conservan su categoría. No se convierten en una supuesta caída del modelo.
2. La enumeración real de Inglés 1, 2 y 3 con una descripción colectiva se acepta. Se mantiene el rechazo de cursos, precios y cuotas inventados.
3. Los planes públicos del workspace tienen identificadores de hechos informativos aun sin curso seleccionado. Contexto, registro de hechos y validador comparten ese alcance. Esto no selecciona un curso ni autoriza un pago.
4. «No me llamaste» deja de contar como revocación. Las negativas reales siguen bloqueando llamadas. La capacidad de llamada se deriva del consentimiento canónico y sus requisitos; una vista comercial antigua no puede concederla por separado.
5. Una llamada aceptada históricamente no sobrescribe la confirmación de un pago posterior ni rearma disponibilidad después de una derivación ya realizada. Dos pruebas fallaron antes de esta corrección y las 91 pruebas de política pasaron después.
6. Dos propuestas rechazadas dejan recuperación durable, causa y propietario. El workflow sucesor vuelve a ingerir idempotentemente y reclamar contexto actual. No reutiliza propuesta, permiso ni token. Hay como máximo dos recuperaciones programadas; el tercer rechazo o el vencimiento registra necesidad de revisión humana. No crea una decisión silenciosa exitosa.
7. Un traspaso a recuperación cuyo ejecutor no arranca vence mediante el reconciliador existente. Una respuesta o un abandono resuelve el registro pendiente. El endpoint exige firma e idempotencia ligadas a lote/token; la función exige pertenencia al workspace. Los roles anónimo y autenticado no pueden ejecutarla.
8. Historial, orden de lote y supersesión usan la misma fecha de ocurrencia confiable. El reloj adelantado del proveedor se acota a recepción para que una pregunta no quede después de su respuesta. Un mensaje antiguo recibido tarde no invalida una negativa posterior. La ventana de tiempo confiable cubre los ocho minutos del reintento de recepción y dos minutos de margen; antes vencía a los cinco minutos, mientras el workflow aún podía reintentar. Fechas anteriores a diez minutos o excesivamente futuras siguen sin considerarse confiables.
9. Se mide espera de conexión, transacción, perfil y encolado de proyección. Los límites de consulta y bloqueo se aplican al rol backend, compatibles con el pool transaccional. El tamaño del pool no se incrementó sin evidencia.

## Verificación y alcance

Resultados: **4.144 pruebas unitarias, 662 de integración y 21 de workflow aprobadas, sin fallas**. La suite unitaria conserva 17 casos omitidos y 7 pendientes de implementación; integración conserva un caso omitido. Después del último ajuste de la ventana temporal se ejecutaron además las 23 pruebas de historial, lotes y recuperación, todas aprobadas. La compilación de Next.js, la de Botpress y lint finalizaron correctamente.

Los workflows usan HTTP firmado, el backend y PostgreSQL local, con adaptadores externos controlados. El laboratorio reconstruyó PostgreSQL con el script existente y sus ajustes de compatibilidad para migraciones históricas, incluida la fixture de embedding. Esto verifica las tres migraciones nuevas sobre el esquema resultante; no certifica que toda la historia de migraciones se pueda reproducir sin ajustes en una cuenta vacía. La nueva cuenta requiere su propia verificación de esquema.

El resumen reproducible y los resultados finales se entregan junto al manifiesto del candidato.

Se reprodujeron cuatro fallas de workflow sobre una exportación limpia de `927be07`: pago inmediatamente después de completar datos, pago tras una llamada, pago después de reparación comercial y expectativa de veto sobre una descripción comercial genérica. No eran regresiones introducidas por este parche. Se corrigió la colisión real entre estados y se actualizaron las pruebas para conservar la confirmación separada de datos/pago ya exigida por el backend. La prueba de veracidad ahora inyecta un precio objetivamente falso, no un consejo comercial genérico.

Se ejecutó además una conversación de nueve turnos con el modelo real: catálogo, planes sin elección, selección de Inglés 2, preferencia por chat, nombre/apellido/correo/teléfono, aplazamiento, duda, confirmación y enlace de seis cuotas. Perfil y selección persistieron; se creó un solo enlace y ninguna llamada. La entrega fue capturada por el adaptador local y el enlace fue ficticio. No hubo cobro, llamada ni mensaje a un cliente. La prueba con el modelo precedió al último ajuste de coexistencia llamada/pago y de orden temporal; esos ajustes quedaron cubiertos por las pruebas automatizadas finales. Esto no certifica WhatsApp ni el scheduler de Botpress Cloud.

## Límites que siguen abiertos

- La conversación con modelo real tuvo una mediana de 8,686 segundos y p95 de 9,293 segundos de duración total del workflow local. **No pasó el umbral de p95 menor a seis segundos** definido por el evaluador. No hubo errores de disponibilidad ni fallback, pero esto no habilita declarar calidad o estabilidad certificadas ni preparación para producción. Las trazas separan esa duración: mediana de espera de lote 4,989 s, generación 2,599 s, recepción 20 ms y commit 60 ms; p95 hasta salida visible local 9,284 s. La ventana de cinco segundos proviene de `646b591` del 20/09, anterior al 02/10, y protege los mensajes fragmentados. Se preservó esa decisión. El umbral de seis segundos y la política de agrupación necesitan una evaluación conjunta, sin confundir esta espera conocida con los bloqueos de 106/298 segundos.
- La causa interna de las demoras de 106/298 segundos observadas en producción no quedó demostrada por los logs disponibles. Los límites y las mediciones nuevos reducen y hacen visible el problema; no prueban retrospectivamente su origen ni acotan por sí solos toda espera de cola.
- El cron de reconciliación actual es diario. El vencimiento de dos minutos se evalúa al ejecutar el reconciliador; no es una promesa de intervención en dos minutos. El destino necesita una frecuencia operativa acordada y compatible con su plan antes del corte de tráfico.
- Falta un número de prueba identificado para WhatsApp/telefonía, comprobar el scheduler durable en Cloud y ejecutar el recorrido completo en destino. La pregunta por ese destinatario quedó pendiente en el chat.
- La conexión Vercel disponible enumera solamente `maneyraos-projects`. No se verificó paridad de la nueva cuenta de destino, sus secretos, catálogo, base, adaptadores y cron.
- Pago confirmado, onboarding, devolución de llamada y entregas ambiguas tienen cobertura automatizada con adaptadores controlados. Falta su canario externo en esta versión.

## Publicación y reversión

1. Verificar el hash del candidato y el destino exacto. No reutilizar como equivalente el paquete del 13/10 basado en `9a50908`.
2. Aplicar en orden las tres migraciones aditivas `20261015000001`, `20261015010001` y `20261015020001`, con el rol administrador de migraciones. Conservar el respaldo y el manifiesto previo.
3. Reciclar/verificar las conexiones del pool del rol `orchestrator_role`; comprobar `statement_timeout=8s`, `lock_timeout=1500ms` e `idle_in_transaction_session_timeout=10s` en una conexión nueva que use el mismo camino que producción. No cambiar límites del rol administrador.
4. Publicar primero el backend compatible, comprobar salud, esquema y autenticación; después desplegar el bundle Botpress de este mismo candidato con configuración y secretos del destino. Mantener la personalidad, flags y catálogo del manifiesto aprobado.
5. Habilitar únicamente el contacto de prueba y verificar los casos críticos de la matriz original, incluidos recuperación, rechazo real, llamada/retorno y pago/acceso. Comprobar causas, registros y mensajes enviados, no solo HTTP 200.
6. Transferir tráfico únicamente después de la prueba de destino. Conservar el deployment y bundle anteriores para reversión coordinada. Las tablas/funciones nuevas pueden permanecer; no borrar historial ni restaurar toda la base para revertir código. Los límites del rol requieren reversión explícita a sus valores previos si fueran la causa de una incompatibilidad.

Fuentes consultadas para compatibilidad: [timeouts de Supabase](https://supabase.com/docs/guides/database/postgres/timeouts) y [precios del proveedor para acotar la prueba](https://api-docs.deepseek.com/quick_start/pricing/). La preparación de publicación usa la skill `vercel:deployments-cicd`; no se realizó despliegue.
