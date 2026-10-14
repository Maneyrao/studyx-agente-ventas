# Agent A — veracidad comercial y continuidad conversacional

Estado: corrección implementada; publicación en curso. Autorización del usuario: corregir directamente los fallos, conservar lo resuelto y publicar para sus pruebas exploratorias.

## Problema y alcance

La prueba posterior a v103 confirmó dos pagos de USD 180, una opción inexistente, y siete respuestas con emojis entre ocho intervenciones del modelo. El commit `7dabdb3` del 2 de octubre había convertido las contradicciones comerciales en advertencias. Una prueba exigía publicar un precio falso de USD 47: aprobar esa prueba no demostraba el requisito correcto.

Se conserva la base actual, incluido el perfil canónico por campo de v103, correcciones/retractaciones, evidencia de origen, continuidad entre chat y voz y solicitudes pendientes. No se hizo un rollback ni una migración. La personalidad canónica v69 y sus dos módulos generados permanecen idénticos byte por byte.

## Cambio

- El backend rechaza afirmaciones comerciales sin respaldo antes de confirmar la transacción. Devuelve `COMMERCIAL_TRUTH_VIOLATION` y tipos de contradicción; A recibe las alternativas canónicas y redacta su respuesta completa. No se publica una poda o una plantilla del backend.
- Cantidad e importe de las cuotas se validan como una combinación autorizada. Se rechazan tanto 2×USD 180 como combinaciones de importes conocidos que no constituyen un plan, por ejemplo 2×USD 60. Las negativas de disponibilidad y preguntas de aclaración conservan su sentido. El pago de prueba reservado admite exactamente 1×USD 0,50.
- Coma y punto decimales representan el mismo importe autorizado. La validación contrasta también el token monetario completo para que tres cifras ambiguas no se autoricen por truncamiento del extractor.
- Los valores ya presentes en el contexto autorizado pueden usarse sin exigir una segunda etiqueta de cita para cada palabra. Esto no habilita importes nuevos; el backend vuelve a contrastar el catálogo vigente.
- Las repeticiones y ofertas dobles vuelven a A para una única reformulación. Repetir a pedido explícito del usuario sigue permitido. Si sólo falla la reparación de estilo, una respuesta original que siga siendo segura no se transforma en silencio. Una contradicción factual u operacional no puede usar esa recuperación.
- Las instrucciones del perfil pasan a un bloque interno: serializar evidencia no exige preguntar o agradecer datos. Una pregunta pendiente conserva memoria y no exige repetirla en cada respuesta. El historial sirve para continuidad y no como una personalidad alternativa que deba imitarse.
- Se mantiene el máximo de dos solicitudes físicas al modelo, sin cobros o llamadas durante una continuación. Los datos capturados antes de una respuesta rechazada permanecen guardados. Brain v104 identifica el nuevo contrato de ejecución.

## Verificación

Los casos nuevos fallaron antes de la corrección y aprobaron después. La regresión unitaria completa final aprobó 4.088 pruebas, con siete pendientes previas. La regresión enfocada de integración aprobó 93 casos en seis archivos: veracidad, perfil, autorización, pagos, Stripe y seguimiento de llamadas. Las comprobaciones adicionales cubren el pago de prueba de USD 0,50 y la prohibición de dividirlo en dos.

El workflow nuevo aprobó el recorrido con HTTP firmado, PostgreSQL aislado y modelo simulado: curso, cinco entradas fragmentadas, rechazo real del plan 2×USD 60, exactamente dos solicitudes al modelo, entrega exclusiva de la reformulación de A, persistencia de cuatro campos, cero efectos del turno rechazado y posterior enlace válido una sola vez. El replay no repitió entrega ni generación.

Con DeepSeek real se observaron cinco respuestas entregadas en una conversación sintética: presentación del curso, elección de chat, datos propios, negativa a dos pagos con alternativas reales y explicación del plan de doce pagos. Las cinco no contenían emojis. Es una muestra pequeña, no una garantía de estilo para todas las conversaciones. Los intentos previos y la reanudación permanecen en la evidencia privada; no se presentan como una corrida limpia única.

Ese canario detectó un falso rechazo de una pregunta que usaba «registro» como sustantivo y una repetición que agotaba la reparación. Ambos quedaron reproducidos y corregidos. El sexto turno de un intento no validó una respuesta del modelo: la reserva del presupuesto acumulado lo impidió y produjo el aviso técnico del laboratorio. No se aumentó el límite ni se cuenta ese turno como validación de A. El gasto acumulado quedó en USD 1,280287848 de USD 1,30, con USD 0,03466516 adicionales en esta corrección.

La revisión independiente final no encontró bloqueos materiales. Las compilaciones, tipos, lint configurado y regresión unitaria se verifican sobre la fuente final antes de publicar. Un chequeo adicional fuera de la configuración habitual de lint encontró cuatro errores preexistentes en el workflow y dos advertencias preexistentes; no se mezcló su refactorización con esta corrección.

## Publicación

Pendiente de registrar SHA, despliegue backend, fecha de Botpress y comprobaciones del dominio principal. Se conservan el bot, modelo, asesor y ventana sandbox existentes.
