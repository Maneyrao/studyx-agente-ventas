# Recuperación de silencios y ajustes de datos y acceso — 14/10/2026

El usuario pidió conservar la personalidad aprobada, reducir emojis, reconfirmar datos antes del enlace, explicar la entrega de credenciales por correo y WhatsApp y dar la bienvenida sólo a alumnos nuevos. Durante el trabajo agregó dos conversaciones que habían quedado sin respuesta.

## Causas comprobadas

- En el contacto terminado en 4497, a las 15:45:03 y 15:45:28 Argentina, el backend rechazó una reparación correcta del agente: «no tengo un plan de dos pagos» seguido de los tres planes canónicos. La negación en primera persona se interpretaba como disponibilidad de ese plan. Después del único intento de reparación, el flujo registró `AGENT_A_CONTINUATION_REJECTED` y completó el lote sin salida. La supresión anterior de las 15:44:50 fue supersesión por otro mensaje y no constituye ese defecto.
- En AburridoNT, terminado en 4679, los pedidos de llamada de las 15:49 y 15:52 están en Botpress pero no llegaron a PostgreSQL. Cada ingesta agotó cuatro esperas de diez segundos. El router intentaba ingresar el mensaje antes de crear el workflow durable y, al fallar, no dejaba una ejecución que pudiera retomarlo. No hubo una solicitud nueva al proveedor de llamadas.
- En 4497 un claim también agotó sus esperas; el siguiente mensaje abandonó el lote pendiente anterior mediante `WINDOW_EXPIRED_UNCLAIMED`.
- Vercel registró 24 timeouts de 300 segundos en ese intervalo. No se demostró qué originó el bloqueo. A las 16:10 Argentina `/ready` respondió 200 en 343 ms, PostgreSQL en 16 ms; la inspección de la base no mostró bloqueadores, transacciones largas ni deadlocks. No se atribuye la interrupción al proveedor de llamadas o a la base sin evidencia.

## Correcciones

La frontera comercial excluye de la inspección únicamente el objeto monetario explícitamente negado; conserva las afirmaciones posteriores para validarlas. No elimina oraciones de la respuesta del agente ni habilita precios o cantidades de pagos inexistentes. Se cubrieron negaciones en primera persona y ofertas falsas posteriores con distintos conectores.

El router crea el workflow con el sobre original cuando la ingesta falla transitoriamente. Ingest y claim pueden reanudarse con esperas durables de 15/30/60 segundos, hasta seis grupos de solicitudes y ocho minutos compartidos. Los fallos transitorios quedan como recibos serializables y las señales de suspensión del ADK se propagan. La decisión de reintentar se conserva en el recibo para que el replay no invalide un éxito previamente guardado por el vencimiento posterior del plazo. No se reintentan automáticamente envíos, cobros o llamadas mediante este mecanismo.

La migración `20261014190001_inbound_timeout_recovery.sql` conserva un lote `waiting` vencido con sus mensajes y lo deja inmediatamente reclamable. El mismo dueño puede recuperar el token de un claim vigente sin rotarlo ni renovar el lease; otro dueño sigue recibiendo `absorbed`. No cambian firmas, privilegios ni `SECURITY INVOKER`.

El prompt canónico pasa de v69 a v70 por estos cambios expresamente solicitados: sin emojis por defecto y nunca en datos, pagos o accesos; un resumen de los cuatro datos antes del enlace, esperando confirmación, con nueva reconfirmación sólo si se corrigen; aviso junto al enlace de credenciales por correo y WhatsApp después del pago y alta confirmados; bienvenida al alumno nuevo. El resto de la personalidad se conserva. El contrato operativo se identifica como Brain v105. En el despliegue anterior el Brain sí había cambiado, mientras la personalidad canónica continuaba en v69; eso no garantizaba por sí solo un comportamiento idéntico.

Postventa recibe `new_user=true` únicamente cuando la central confirmó `student_was_created=true`. Un estado desconocido no cuenta como alumno nuevo. El evento de acceso permite la bienvenida y mantiene al agente como autor de la narrativa; el backend incorpora las credenciales verificadas. No se afirma que el correo ya fue enviado usando sólo este evento. La central es responsable del canal de correo según el contrato existente.

## Verificación y límites

Pruebas RED/GREEN de los defectos, revisión independiente, 4122 pruebas unitarias aprobadas (7 pendientes), 23 pruebas de integración seleccionadas y 97 pruebas focalizadas de recuperación. Compilación del backend con webpack, tipos de ambos proyectos y validación ADK aprobados. El constructor local Turbopack no admite el enlace a dependencias compartidas de este worktree; se verificó con webpack sin modificar esa configuración de producción.

La prueba vertical aprobó el caso exacto de negación que falló, conservó cinco mensajes de identidad fragmentada y entregó el enlace una sola vez; usa el workflow real, HTTP firmado y PostgreSQL local y controla el modelo y la entrega externa. El arnés asigna un workflow distinto a cada mensaje, como en Cloud, para no simular varios competidores con la misma identidad de dueño.

No se hicieron llamadas, cobros ni envíos reales para probar. No se reinició la memoria ni se reprodujeron automáticamente pedidos antiguos de llamada. Los lotes ya abandonados y los mensajes históricos que no fueron ingeridos no se restauran con una migración de código. El plazo de recuperación es acotado; no garantiza disponibilidad ante interrupciones prolongadas. La reconfirmación y el estilo son instrucciones al agente, no una nueva máquina de estados persistida.

## Publicación

- Fuente publicada: `00fceae7b24efa7cbd087a995e1750bf901c7a2d`, rama `codex/lucas-call-recovery`, enviada a origin.
- Migración aplicada a las 16:13:06 Argentina, con historial idéntico al archivo y privilegios sin cambios. SHA256 `26d2984ab508f3d66ccff3047a20dd700cebffd2f97151a1bde64a177b084e51`.
- Botpress publicado a las 16:14:18 Argentina en el bot `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`: Brain v105, canónico v70, identidad Emma y modelo `deepseek-v4-flash` conservados.
- Backend `dpl_6fSeab89Wm8DbQigkyJceUEGUEp7`, READY y promovido al dominio habitual. A las 16:15:41 Argentina `/api/health` confirmó HTTP 200 y el commit publicado; `/api/ready` dio HTTP 200, `ready=true`, en 513 ms, PostgreSQL en 16 ms.
- Prueba firmada sin mutaciones: HTTP 409 `CONTACT_PROFILE_CLAIM_NOT_AUTHORIZED` usando identificadores inexistentes. Probe de conexiones: HTTP 200, central `success`, Botpress 200 con el mismo bot y puente sandbox vigente hasta finalizar el 15 de octubre Argentina.
- Verificados 403 hashes de fuentes/configuración/migraciones antes y después de publicar. Bundle final 23.847.616 bytes, SHA256 `b5cc23fec1c0718f7d61b0da8f21ff77abb7f4f1a4dc45f453e411cefd061082`. Archivo congelado y manifiesto de evidencia privados bajo `tmp/agent-silence-owner-00fceae-*` en el workspace padre.
