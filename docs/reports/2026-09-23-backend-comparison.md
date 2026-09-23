# Comparación del backend y límite de llamadas

Producción investigada: `4f96b74`. Primera corrección: `dd49a2e`. La revisión de esa corrección encontró dos inconsistencias adicionales; ambas quedaron corregidas y verificadas en la ampliación posterior. **Los gates determinísticos pasan; el candidato todavía necesita evaluación con DeepSeek real antes del despliegue.** No se hicieron nuevas solicitudes pagas ni se modificó producción.

## Qué mejoró

- Contexto: una conversación nueva ya no hereda automáticamente el curso elegido en otra conversación del mismo contacto.
- Identidad: una respuesta con el nombre completo a la pregunta por apellido no duplica el nombre; `Si` no sustituye la identidad guardada.
- Teléfono: el modelo puede declarar `confirmed_phone`. El commit comprueba que fue el número sugerido en la última respuesta, entregada a ese contacto, compatible con su número local. La actualización y su procedencia son transaccionales.
- Llamada: una solicitud sin teléfono conserva la intención. Una acción imposible llega a la reparación del modelo en lugar de eliminarse silenciosamente mientras se entrega una promesa de coordinación.
- Pago: el teléfono confirmado deja de bloquear el intake y se pudo materializar exactamente un enlace canónico en el workflow real aislado.
- Comportamiento: el prompt canónico pasó de 148 a 47 líneas; se retiraron instrucciones dinámicas redundantes y la oferta de llamada prefabricada del resolver. La calidad resultante todavía necesita evaluación con el modelo real.

## Evaluación general

La base transaccional tiene protecciones concretas: deduplicación de eventos, exclusión y orden de batches, supresión de propuestas superadas por un mensaje posterior, commit serializable, comparación del hash ante reintentos, reserva de llamada en la misma transacción, un registro por turno y exclusión de llamadas activas simultáneas. Los efectos externos se despachan después del commit. Los enlaces se obtienen de configuración y se controlan por curso, plan, datos y permiso; no provienen de una URL inventada por el modelo.

Sheets y memoria son proyecciones derivadas de datos durables; su procesamiento y reintento están separados del commit principal. Las pruebas completas de integración incluyeron esas capas, pagos, opt-out, continuidad A↔B, replay, concurrencia y fallos inyectados. No se introdujeron migraciones ni cambios de proveedores en este candidato.

La debilidad que sigue visible es la duplicación de decisiones semánticas. El contexto de Botpress anuncia capacidades; otro validador revisa la propuesta; el backend vuelve a resolver estado y conserva reglas léxicas de preferencias, además de filtros sobre hechos y afirmaciones. Esos filtros pueden eliminar texto y efectos. Por ello, tener una buena propuesta de DeepSeek no garantiza por sí solo que se entregue íntegra o que persista toda su intención.

## Hallazgos comprobados en dd49a2e, antes de esta ampliación

### 1. Elegir chat puede no reemplazar una intención de llamada

Secuencia reproducida: `Dale, llamame` sin teléfono → intención persistida `call/accepted` → `seguir por aca` con propuesta estructurada `continue_by_chat`.

Resultado: el cliente recibe «Seguimos por aquí…», pero PostgreSQL conserva `call_preference=call`, `call_offer_status=accepted`. El backend exige también que la regla léxica `supportsChatPreferenceV1` reconozca la frase, y esa variante no está cubierta. Esta contradicción puede alimentar una retoma incorrecta de la llamada cuando llegue el teléfono; no se observó una llamada externa en esta prueba.

Código: `src/features/conversation/domain/agent-turn-policy-v2.ts:228`, `src/features/conversation/domain/channel-preference-evidence.ts`. La condición ya existía en el SHA anterior. Corregir la intención pendiente hace más importante que el cambio posterior de preferencia también quede bien persistido.

Corrección aplicada: el movimiento estructurado de continuar por chat actualiza esa preferencia y deja la aceptación previa en `declined`, sin exigir una segunda clasificación por frases. Se conservan los controles de opt-out y los rechazos explícitos que impiden ejecutar una llamada. La prueba vertical ahora agrega la llegada posterior del teléfono y verifica cero sesiones de llamada.

### 2. Contexto y backend discrepan sobre ofrecer una llamada sin nombre

En una apertura sin nombre, el contexto enviado al modelo dice `may_offer_call=true`. El modelo produce una respuesta y una invitación de llamada válida. El backend calcula `may_offer_call=false` porque exige primer nombre, elimina la invitación y entrega sólo el otro mensaje.

Código: `botpress-agent/src/lib/conversation/agent-a-context.ts:814` frente a `src/features/conversation/application/prepare-agent-turn-v2.ts:178`. La discrepancia también es anterior al candidato.

Corrección aplicada: se eliminó la exigencia de nombre en la preparación del backend y se alineó el contexto con llamada activa, etapa y pago reportado. Además, un intake no cargado no se interpreta como un teléfono disponible. El nombre no constituye una condición de seguridad para una invitación opcional. La prueba vertical verifica ahora la entrega y el incremento del contador.

Ambos casos se probaron con el workflow de producción, HTTP firmado, backend compilado y PostgreSQL aislado. Sólo se fijó la respuesta del proveedor externo. **Dos aserciones fallaron en dd49a2e**, una por preferencia incorrecta y otra por eliminación de la invitación. Se conserva esa evidencia anterior; las dos pruebas ya forman parte de la regresión permanente que pasa en el candidato actualizado. [Resultados](evidence/2026-09-23-real-conversation/backend-audit-results.txt), [trazas y estado](evidence/2026-09-23-real-conversation/backend-audit-observed.json.gz).

### 3. El límite conversacional debe incluir el mensaje del enlace

La función existente `physicalOutboundTexts` acepta tres partes. Si el modelo redacta dos mensajes y el backend añade la URL canónica, el cliente recibe tres aunque no exista una lista. Se reprodujo sobre la función real de composición; no se ejecutó una conversación paga para ese caso.

Se ajustó la instrucción existente: al enviar el enlace, el modelo redacta un único mensaje y la URL canónica ocupa el segundo. No se recortan respuestas ni se agrega copy. El cumplimiento por parte de DeepSeek real sigue pendiente de evaluación; la prueba determinística confirma la composición y entrega de un único link.

## Límite de llamadas y memoria

La regla solicitada es un máximo de dos invitaciones proactivas en la misma venta. Una petición posterior del cliente permite tramitar una llamada sin reiniciar ni consumir ese contador. Una invitación adicional no se convierte en permiso porque el cliente siga conversando.

Se encontraron y corrigieron tres problemas del control anterior:

- `CALL_BUDGET_EXHAUSTED` estaba clasificado como orientación no bloqueante; ahora vuelve a la reparación existente del modelo. Si la reparación mantiene la infracción, no se autoriza esa propuesta.
- El backend podía dejar pasar invitaciones dentro de `response.messages` con el contador agotado. El control de permisos revisa tanto la invitación declarada como las invitaciones detectadas por los guards existentes, y rechaza la propuesta completa para que el modelo la repare. No agrega frases ni corta mensajes.
- La caducidad por inactividad reiniciaba `call_offer_count`. Ahora conserva el presupuesto de la misma conversación aunque caduquen las expectativas temporales de respuesta.

El prompt v77 / canónico v43 expresa la excepción por iniciativa del cliente en el mismo apartado de llamadas. Sigue teniendo 47 líneas. No se introdujeron planner, nuevas expresiones regulares comerciales ni cambios de proveedor.

Las pruebas antiguas que exigían una segunda interpretación léxica de `continue_by_chat` se actualizaron al contrato de conducción del modelo. Se mantienen pruebas de rechazo de acciones contra negativas explícitas, prioridad del último mensaje y permiso para solicitar llamadas sin coincidencia literal de frase.

El backend conserva tres fuentes con funciones distintas:

| Fuente | Función | Autoridad sobre acciones |
|---|---|---|
| Estado estructurado en PostgreSQL | Contacto confirmado, curso, plan, contador, preferencia, llamada activa, consentimiento y enlaces | Es la fuente que valida y persiste el commit |
| Historial reciente de mensajes y entregas | Qué preguntó cada parte y qué respuesta llegó efectivamente | Da contexto y prueba de procedencia para confirmaciones |
| Memorias seleccionadas y recuperación vectorial | Objetivos, restricciones y preferencias de fondo | No reinicia contadores ni concede permisos |

En la conversación original, el primer contexto no tenía memorias recuperadas. El curso incorrecto provenía del estado legado del contacto asociado a otra conversación. La confirmación del teléfono tampoco falló por recuperación vectorial: faltaba una vía de persistencia. Por eso no se cambió el modelo de embeddings ni se reconstruyó el índice sin evidencia. Una nueva prueba confirma que una memoria antigua que dice «prefiere llamadas» no habilita una tercera oferta frente al contador durable en dos.

## Prueba posterior y límites

[Traza completa posterior](evidence/2026-09-23-real-conversation/call-budget-observed.json.gz), [resultados de gates](evidence/2026-09-23-real-conversation/call-budget-gates.json).

- 3.481 unitarios aprobados; 16 omitidos y 7 pendientes preexistentes.
- 531 integraciones aprobadas y una omitida; incluye replay, concurrencia, fallos inyectados, Sheets, pagos, A↔B, opt-out y memoria.
- Seis conversaciones verticales aprobadas: 19 turnos y reintentos, con `processInboundTurn`, contexto, validador, HTTP firmado, backend compilado y PostgreSQL reales. Sólo la generación del modelo y la entrega física usan fixtures.
- Typecheck y lint aprobados. Botpress: typecheck y check válidos, build completo. Next.js: build de producción aprobado. El primer build aislado de Botpress informó problemas de acceso a assets remotos; la repetición con lectura de los assets configurados terminó correctamente.

La secuencia del presupuesto quedó registrada en `real-regression-0bb83a65-ed6d-48a6-9f76-0890ab56bfc8`: primera oferta → rechazo → segunda oferta → rechazo → tres días de inactividad → tercer ofrecimiento reparado por el modelo → cliente solicita llamar → teléfono recibido. Contador final **2**; una sola sesión `18c87abb-c564-4191-93ab-b85c045aa27d`, estado `requested`. La consulta posterior al replay confirma que sigue existiendo una sola sesión. Esto prueba reserva durable, no llamada física realizada.

La conversación de pago `real-regression-167681eb-b4d2-4274-a570-f1b098033df1` conserva `Ludmi Medina`, correo y teléfono completo confirmado, y entrega un único enlace canónico del proveedor de pruebas. El cambio a chat `real-regression-2ad00829-07d6-4f56-95bc-96b5eaa648ad` termina en `chat/declined` y cero llamadas incluso después de recibir el teléfono.

El contrato pide declarar las invitaciones en `response.call_offer`. Los detectores narrativos heredados no son una clasificación semántica exhaustiva: una invitación que el modelo omita de ese campo y redacte con una paráfrasis no reconocida puede escapar a la detección. No se afirma una garantía absoluta sobre texto libre ni se agregaron regex para perseguir variantes. La prueba real debe comprobar que el modelo respete el contrato además de redactar con naturalidad.

El intento real anterior devolvió HTTP 401, sin propuesta. Siguen pendientes las tres conversaciones reales autorizadas, el despliegue de Vercel y Botpress desde un único SHA, health/readiness y el canary. La revisión automática rechazó buscar/validar credenciales en otros worktrees; esa autorización continúa pendiente. No se accedió a esas claves por otra vía.
