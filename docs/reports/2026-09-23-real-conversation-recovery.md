# Agente A: recuperación de la conversación real del 23 de septiembre

Estado actualizado: **tres conversaciones reales completadas; cuatro fallos adicionales corregidos y reproducidos con sus propuestas exactas**. Regresión final: nueve conversaciones determinísticas y 27 turnos más reintentos. La publicación y el canary se registran en [validación real y cierre](2026-09-23-live-validation.md). Los apartados históricos conservan sus resultados originales.

Worktree: `agent-a-logical-turn-recovery`. Rama: `codex/agent-a-logical-turn-recovery`. Fuente productiva investigada: `4f96b74bbfb572507fed809d71e60097745a93c4`; conversación `3fd53b66-b72a-4932-8a98-6684391d81ce`.

## Reconstrucción y causas por capa

Se correlacionaron mensajes, decisiones, entregas, batches, eventos de estado, contacto, estado comercial y las ejecuciones durables de Botpress. Son 14 mensajes físicos del cliente agrupados en 12 turnos, 12 decisiones y 24 respuestas entregadas. Cada respuesta tuvo una sola entrega. Las cinco llamadas históricas del contacto pertenecían a otras conversaciones; esta conversación no creó ninguna.

La [transcripción completa](2026-09-23-real-conversation-transcript.md) muestra, en orden, cliente, propuesta original, reparación y respuesta autorizada. El [fixture productivo](../../tests/fixtures/agent-a/production-20260923.json.gz) conserva los contextos y propuestas originales con datos personales anonimizados.

| Capa | Causa comprobada | Corrección |
|---|---|---|
| Construcción del contexto | El primer `Info` llegó sin historial ni intención de catálogo, pero con Community Manager ya seleccionado. La carga del estado comercial por contacto trasladaba una elección de otra conversación al nuevo contexto. | La proyección heredada sólo inicializa el estado cuando su `conversation_id` corresponde a la conversación reclamada. |
| Interpretación y propuesta de DeepSeek | Las propuestas repetían curso, duración, precios y datos; intentaban vender, informar, completar intake y ofrecer llamada simultáneamente. El prompt canónico y las instrucciones dinámicas acumulaban avances y exigían una invitación temprana. | Canónico reducido de 148 a 47 líneas, un avance útil por turno, uno o dos mensajes; se retiró la instrucción dinámica redundante. Brain v76, canónico v42. No se introdujeron recortes posteriores ni reglas comerciales nuevas. |
| Validación de la llamada | En `Dsle llamame`, el modelo sí produjo `request_call` y `request_call_now`. El resolver eliminó silenciosamente la acción imposible y conservó el texto que afirmaba coordinarla. | La misma reparación del modelo recibe el rechazo de capacidad. Se conserva `request_call`; sin teléfono, el modelo pide sólo ese dato y usa `none`. Se eliminó además la invitación prefabricada que añadía el resolver. |
| Persistencia de la intención | El backend marcaba `may_request_call_now=true` aunque no existiera teléfono utilizable. Por eso no entraba en la transición existente que conserva la solicitud mientras falta el número. | La capacidad exige teléfono E.164 utilizable y ausencia de llamada activa. La solicitud sin teléfono guarda `call_preference=call`, `call_offer_status=accepted`. |
| Contexto para retomar la llamada | La capacidad expuesta al modelo dependía de una lista de acciones de un router anterior; podía seguir falsa al llegar el teléfono. | Se calcula con permiso de respuesta, bloqueo, llamada activa y teléfono disponible. La selección semántica sigue siendo del modelo. |
| Captura del nombre | Una respuesta con nombre completo a la pregunta por apellido repetía el nombre. La extracción del nombre inicial ante una frase con objetivo aceptaba `Si`. | Se reconoce el nombre ya guardado al separar el apellido; `sí` deja de ser candidato de identidad. |
| Captura y persistencia telefónica | Se guardó el número local. No existía un campo del contrato para materializar la confirmación del formato completo sugerido en la respuesta anterior. | `confirmed_phone` opcional y compatible con propuestas previas. DeepSeek interpreta la confirmación; el commit comprueba E.164, coincidencia con el número local, procedencia de la última respuesta, contacto, conversación y entrega probada. Contacto y procedencia se escriben en la misma transacción. |
| Enrutamiento | La ruta anterior para un `Sí` ambiguo ante oferta de llamada podía sustituir al modelo por una aclaración fija dentro de plannerless. | En plannerless, esa interpretación queda en el workflow del modelo; se mantiene la ruta anterior para el modo legado. |
| Validación del pago | Una observación sobre invitación de llamada podía rechazar una propuesta de link aun cuando hechos y acción estuvieran autorizados. | Las observaciones de estilo no se vuelven bloqueantes por mencionar el envío. Se mantienen las comprobaciones de permiso, curso, plan, intake y URL canónica. |
| Commit de acciones | No hubo fallo de entrega duplicada, Stripe ni worker de llamadas en el caso original: al commit no llegó una acción autorizada de llamada o pago. | Se corrigen las entradas al commit. No se reemplazan proveedores, idempotencia, acción canónica ni efectos de A↔B. |

## Antes y después vertical

El código inicial se exportó en un checkout aislado. Se reprodujeron los **12 turnos originales** con sus propuestas y reparaciones registradas, usando `processInboundTurn`, HTTP firmado, construcción del contexto, validador y commit reales, sobre PostgreSQL desechable. Sólo la red hacia DeepSeek y la entrega física se sustituyeron por registros. Se sembró el antecedente de selección por contacto que existía antes del primer turno.

El replay sobre el SHA inicial reprodujo el resultado defectuoso: nombre `Si Ludmi Medina`, teléfono local `1155550101`, preferencia de llamada `unknown`, estado `plan_selected` y ningún link. [Evidencia antes](evidence/2026-09-23-real-conversation/before-observed.json.gz).

La regresión corregida ejecutó tres conversaciones determinísticas, ocho turnos y reintentos de los mismos eventos contra el **build de producción local**, con los mismos componentes que producción. No sustituye el contexto, la validación ni el commit. [Evidencia después](evidence/2026-09-23-real-conversation/after-observed.json.gz).

| Comprobación | Evidencia persistida |
|---|---|
| `Info` con una elección antigua en otra conversación | Nueva conversación `real-regression-77cd1d92-5a47-49a7-a559-c8c3733bad36`: `selectedOfferingCode=null`, `stage=exploring`; una pregunta breve, sin descarga de precio/datos. |
| Llamada sin teléfono | Conversación `real-regression-289b0a04-d997-411f-aa24-40533f464933`: intención `call/accepted`, cero sesiones hasta recibir el número; la propuesta inicial imposible llega a reparación del modelo. |
| Teléfono recibido y llamada retomada | Una sesión `b696c0dc-548c-4a83-a1fe-d95067fba565`, estado `requested`; una decisión `request_call_now`. El replay del mismo evento no genera otra entrega ni decisión. |
| Nombre completo y confirmación `Si` | Conversación `real-regression-62a898b4-5c91-4e72-9f9c-94ca0fc5afea`: `Ludmi Medina`, `ludmi@example.test`, `+5491155550101`. El siguiente contexto tiene `intake_missing=[]`. |
| `Si, necesito que me agendes y me des el link` | El nombre se conserva. Una decisión `send_payment_link`, un link canónico del proveedor falso (`https://example.invalid/eval/12m`), `stage=payment_link_sent`, `awaitingReply=none`. El reintento y el turno posterior no duplican el link. |
| Procedencia de la confirmación | Se rechazan sugerencias sin entrega, pendientes, sin identificador de proveedor, dirigidas a otro destino, de otra conversación, anteriores a otra respuesta o con un número distinto. Un fallo posterior revierte la actualización del contacto y su prueba de procedencia. |

Los registros incluyen por turno instrucciones y contexto enviados, propuesta inicial, reparación, propuesta enviada al commit, respuesta autorizada, transición leída de PostgreSQL y acción materializada. La recepción observada en estos casos es del adaptador local: no acredita una llamada telefónica realizada ni entrega por Telegram en producción.

## Gates

- Unitarios: **3.470 aprobados**, 16 omitidos y 7 pendientes preexistentes.
- Integración completa, replay, concurrencia y fallos inyectados: **531 aprobados**, 1 omitido, 67 archivos.
- Regresión vertical del build de producción: **3 conversaciones aprobadas**.
- Replay histórico sobre SHA inicial: **12 turnos reproducidos**, aserciones del estado defectuoso aprobadas.
- Typecheck y lint raíz: aprobados.
- Botpress: typecheck, check sin errores ni advertencias, build: aprobados.
- Next.js: build de producción con configuración aislada: aprobado.

[Resultados y huellas de los gates](evidence/2026-09-23-real-conversation/gates.json). La primera corrida amplia reutilizó la base de investigación y la configuración de Sheets del laboratorio: cinco aserciones de proyección también fallaban sobre el SHA inicial y una aserción de memoria quedó detrás de trabajos pendientes. La ejecución en un cluster nuevo, sin inyectar Sheets antes de que lo configuren los tests, pasó completa. No se modificaron esas pruebas ni su implementación para ocultar fallos.

## Evaluación real y publicación

La autorización de credenciales fue concedida y resuelta. Ver [validación real y cierre](2026-09-23-live-validation.md) para las fallas adicionales, sus correcciones, las tres conversaciones reales, el estado de publicación y el canary.
