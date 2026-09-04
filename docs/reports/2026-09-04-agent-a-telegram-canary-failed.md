# Agente A — canario real de Telegram fallido

La charla del usuario del 4 de septiembre, entre 17:18 y 17:23 UTC, **no cumple la aceptación comercial**: cero ofrecimientos de llamada y cero enlaces de pago enviados tras solicitudes explícitas. El despliegue sigue siendo `07328e23f97054aeb92a108562f70b6ef3a88bb4`; el análisis no modificó el runtime. La prueba local anterior no acreditaba este caso.

Se revisaron 21 mensajes entrantes, 20 respuestas/decisiones, los 21 workflows de Botpress correspondientes (uno absorbido por batching), sus pasos persistidos, los eventos de estado en PostgreSQL y los reportes de salida. Evidencia: [transcripción redactada](evidence/2026-09-04-agent-a-telegram-canary/transcript.md), [propuestas y contexto](evidence/2026-09-04-agent-a-telegram-canary/workflow-diagnostics.json), [persistencia](evidence/2026-09-04-agent-a-telegram-canary/persistence.json). Los originales privados permanecen bajo `.eval/codex-20260904/telegram-review/`, fuera de Git; se conservan sus hashes.

## Sí recibe las instrucciones nuevas

Las 20 decisiones y las salidas de los pasos del modelo registran `studyx-agent-a-brain-v20` / `deepseek-v4-flash`. Los claims remotos muestran brain activo, shadow apagado, repair activo y ruta única. `generateDeepSeekAgentATurnProposalV1` envía `buildAgentABrainInstructionsV1(context)` en `instructions`; esta función incluye íntegro el canónico V9 y el contexto autorizado. La reconstrucción gratuita desde los 20 claims remotos, usando la fuente desplegada sin modificar, contiene el canónico completo en todos los casos. El primer texto de instrucciones tiene 30.691 caracteres. Se distingue esta reconstrucción de una captura HTTP literal, que no existe.

Recibir las reglas no demuestra cumplirlas. Aquí el contexto comercial incompleto y transiciones aceptadas sin evidencia hicieron que el comportamiento se desviara.

## Cadena causal comprobada

1. **“Fotografía” no resolvió un curso disponible.** Ambos primeros claims devolvieron `not_found`. El catálogo remoto sí contiene `fotografia_profesional` y `fotografia_celulares_tiendas_online`. Las tres alternativas enviadas fueron Armado y Reparación de PC, AutoCAD y Coaching. El contexto construido tenía curso nulo y planes vacíos. La prueba anterior comenzaba con “Redes Informáticas”, que resuelve exactamente; no cubría el nombre abreviado real.
2. **La llamada estaba deshabilitada desde el inicio.** `may_offer_call` exige un curso canónico seleccionado. Con el fallo anterior resultó false, aunque la preferencia inicial era `unknown` y el contador cero. El modelo siguió haciendo diagnóstico y describiendo fotografía sin resolver la selección. La omisión no activó reparación. Además, la obligación de ofrecer llamada cuando sí está habilitada vive en el prompt; el validador no exige su presencia. Ese último punto es una brecha de cobertura, no la causa del primer turno de este canario.
3. **“Quizás personal” se convirtió en rechazo de llamada.** La propuesta original del paso `wrkflow_01M1PPWQ0NZMYCW9WY5GDQB9YZ` fue `continue_by_chat`, aunque la respuesta se refería a estudiar por interés personal. El backend persistió `chat/declined` en versión 19 a las 17:19:10.086 UTC. No era un rechazo anterior ni explícito del usuario. El comentario preliminar que lo atribuía a una preferencia heredada era incorrecto y fue corregido al revisar los eventos.
4. **Nombre y apellido escritos no se capturaron.** El usuario los dio junto al teléfono y después por separado. `contacts.name` permaneció null; correo y teléfono estaban presentes. La reproducción gratuita con datos sintéticos falla también sin Markdown: el extractor acepta nombres con verbo introductorio o junto a un correo en el mismo mensaje; no recibe el campo solicitado por la respuesta anterior. El formulario etiquetado del laboratorio sí incluía correo en la misma entrada. Durante el bucle tampoco había `awaiting_reply=contact_details`, por lo que usar solamente ese estado no solucionaría este caso.
5. **El plan y el enlace quedaron sin autoridad comercial.** El usuario eligió pago único, pero el curso seguía nulo y el plan nunca se guardó. La propuesta de elección inicial no llevaba `payment_plan`; una reparación sí lo propuso, pero no resolvió el curso. Al pedir el enlace, los gates seguían viendo curso/plan ausentes y nombre/apellido faltantes. Los agradecimientos del bot no equivalían a persistencia. Todas las acciones finalmente comprometidas fueron null.
6. **Hubo un intento de enlace para otro curso, bloqueado.** A las 17:22:39 UTC, tras un apellido aislado, la propuesta pidió `send_payment_link` para `aires_acondicionados` con `one_time`. Fue rechazada por falta de autorización, curso/plan sin resolver e intake incompleto, y reparada a una respuesta sin enlace. Nunca se comprometió esa acción. El control evitó ese envío erróneo; la venta siguió trabada.

Los textos también muestran problemas de calidad: no responde directamente la hora de clase, afirma que dura “unos minutos”, pide datos antes de contestar el precio, repite campos y produce agradecimientos sin próximo paso. No se atribuye todo esto a que falte una instrucción: en varios puntos la instrucción ya estaba y el resultado pasó validaciones insuficientes.

## Qué acreditan los registros y qué no

20 decisiones con salida durable y 20 reportes `submitted_to_botpress`/estado submitted; el usuario confirma haber recibido la conversación. No hay URL autorizada en esos outbounds ni acción de pago comprometida. Un workflow marcado completed sólo acredita finalización técnica, no venta correcta ni cumplimiento de fases.

Hubo 20 generaciones iniciales y seis reparaciones: 30% de turnos requirió reparación. El log recuperado marca cuatro reparadas y dos no reparadas; conservar una respuesta tras una reparación fallida no convierte la conversación en aprobada. La falta de llamada inicial, la falsa preferencia chat y el bucle de identidad son fallos funcionales aunque HTTP y workflow sean verdes.

`agent_decisions.missing_information=[]` y `retrieval_used=null` son constantes del adaptador de esta ruta. No prueban intake completo ni ausencia de instrucciones/contexto. La fuente usada para el diagnóstico son los claims y el estado de contactos, no esas columnas.

## Correcciones necesarias y casos de aceptación

- Resolver nombres parciales del catálogo a candidatos pertinentes y desambiguar Fotografía Profesional frente a Fotografía con Celulares; no continuar una venta sobre selección inexistente.
- Exigir evidencia de una preferencia explícita de canal, o de una respuesta a una oferta de llamada realmente pendiente, antes de guardar `chat/declined`. “Formación personal” no debe modificar el canal.
- Capturar datos según el pedido efectivamente enviado, incluyendo nombre completo con teléfono y respuestas separadas, sin aceptar indiscriminadamente cualquier texto como nombre ni borrar los controles de terceros/negación.
- Mantener curso, plan y permiso de enlace durante el intake; señalar como fallo la divergencia entre prosa comercial y estado que impide ejecutar lo solicitado.
- Repetir esta conversación como regresión, con nombres abreviados, datos en mensajes separados y preguntas durante el cierre. Después verificar envío del enlace correcto y persistencia por Telegram. No resetear el historial del usuario para ocultar el fallo.

La corrección y su nuevo despliegue quedan pendientes. No se enviaron mensajes al usuario desde el bot ni se generaron llamadas al modelo durante este análisis.

## Presupuesto preservado

Se recuperó usage de los 26 pasos remotos: 258.988 tokens de entrada, 186.624 de ellos en caché, y 5.239 de salida. Con las tarifas conservadas en la campaña, la charla agrega USD 0,041368376 al acumulado previo USD 0,858633752: **USD 0,900002128**, margen **USD 0,099997872** hasta USD 1. Se incorporaron entradas retrospectivas identificadas por workflow/paso al mismo ledger, sin reiniciarlo ni inventar reservas previas. Estos valores contabilizan DeepSeek; no incluyen un importe no medido de embeddings ni mensajes posteriores del usuario. La revisión actual no agregó inferencias pagas. [Recibo de presupuesto](evidence/2026-09-04-agent-a-telegram-canary/budget-update.json).
