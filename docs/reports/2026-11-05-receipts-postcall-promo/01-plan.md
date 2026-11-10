# Plan — recibos de datos, estado posllamada, promoción y programa (2026-11-05)

Base: `4a31c76` (rama `claude/agent-a-model-owned-sales`). Desplegado: backend `e2cc630`, brain v168.
Evidencia: conversación `5b138536-5bbd-41f1-ac6e-3b50de301d3a`, 15:17–15:32 (18:17–18:32Z).

## Evidencia verificada en la base (sólo lectura)

| Hora Z | Cliente | Recibo / decisión | Estado |
|---|---|---|---|
| 18:19:47 | «nada, capacitarme» + «sabes qué dan?» | dec `a2174b90`: acción null, 2 generaciones, `FACT_VALUE_MISMATCH` (proposal_validation). Texto: «No tengo el archivo del programa…» | course_selected real_estate |
| 18:22:08 | «mandame el testimonio de felipe» | dec `81fa8254`: `send_course_program real_estate`; imagen+PDF entregados | — |
| 18:24:00 | «THIAGO MANEYRO 1169004497 tmaneyro@gmail,com» | acepta nombre/apellido; rechaza correo y teléfono `VALUE_MISMATCH`. Prosa: «correo tmaneyro@gmail.com … ¿Están bien así?» | — |
| 18:24:43–47 | «ahi me lo dijiste» / «estaba bien como lo escribiste» | correo rechazado `VALUE_MISMATCH`. Prosa: «Lo dejo así» | — |
| 18:25:33 | «tmaneyro@gmail.com» | correo aceptado | — |
| 18:27:54 | «mi número termina en 8, no en 7» | teléfono rechazado `VALUE_MISMATCH`. Prosa: «tu número queda en +5491169004498» | — |
| 18:28:19 | «me volves a llamar?» | `request_call_now`, marcó **4497** | handoff |
| 18:29:16 | — | 4.ª sesión creada (4497) | v23 handoff/call/accepted |
| 18:29:31 | «okay sigamos por aca» (llamada 4 abierta) | — | **v24 handoff/chat/declined** |
| 18:31:21 | «pero digo que promo me podes ofrecer» | sin acción, `FACT_VALUE_MISMATCH` backend_commit | handoff → `may_offer_bonus=false` |

Subject del `FACT_VALUE_MISMATCH` de `a2174b90`: no está persistido (`diagnostics.failure_codes` guarda sólo el código, la propuesta original no se guarda y el step cache de Botpress no fue accesible). Se expone en diagnósticos (bloque 0) y se reproduce en el replay.

## Bloques (en el orden pedido)

### 0. Diagnóstico durable
`diagnostics.failure_codes` incluye `CODE:subject` (estructurado, ≤128) además del código, para la generación rechazada. Sin texto del cliente.

### 1. Recibos de datos (correo y teléfono)
1a. **La prosa respeta el recibo.** Tras `persistProfileProposal`, si el recibo rechazó un `profile_update` (o `confirmed_phone`) de *esa* propuesta y la prosa contiene el valor propuesto (comparación de valor normalizado: correo en minúsculas, teléfono por dígitos/sufijo ≥8), se rechaza con `UNSUPPORTED_OPERATIONAL_CLAIM:contact_profile_rejected:<campo>` → una reparación con el contexto refrescado. Es una comparación de valor contra el recibo, no un regex de frases.
1b. **Instrucción de reparación** para ese subject: el dato no quedó; correo → pedir que lo reenvíe completo, sin corregirlo; teléfono → proponer el número completo y preguntar si lo confirma, y usar `confirmed_phone` en el turno siguiente. Más una línea en el prompt del brain (v169) con la misma regla. No se toca el prompt comercial.
1c. **`confirmDeliveredContactPhone` admite una corrección del número conocido:** la sugerencia entregada inmediatamente anterior contiene el número completo; el cliente confirma; el candidato tiene la misma longitud que el teléfono conocido (perfil o canal) y sólo cambia en los últimos 4 dígitos. Evidencia `delivered_phone_correction_v1`. Se mantienen las vías actuales.
1d. **Corrección pendiente bloquea la llamada:** si la última respuesta entregada propuso un teléfono completo distinto del teléfono vigente del perfil y este turno no lo confirmó, se rechaza `request_call_now` (`ACTION_NOT_AUTHORIZED:phone_confirmation_pending`). La llamada nunca marca en silencio el número cuestionado.
1e. Sin cambios en `postgres-call-store` (ya usa `COALESCE(declared_phone, phone)`); un test de integración prueba que el despacho recibe 4498.

### 2. Estado posllamada, independiente del orden
2a. `reconcileTerminalCallStateV1`: además del caso actual (preferencia call/accepted), libera `handoff` cuando no hay llamada activa, hay un resultado terminal y el cliente ya eligió chat (`call_preference=chat`). Vuelve a plan_selected / course_selected / exploring y conserva chat/declined, el contador, el curso, el plan y el paquete.
2b. Política: si el cliente elige chat en un turno con stage `handoff` y no hay llamada activa, el mismo turno sale de handoff. Con la llamada activa no se toca; la próxima reconciliación libera cuando llega el resultado terminal.
2c. **Lectores durables:** la capacidad de bonificación (`readCourseBonusCapabilityV1`) y el servicio (`offerDirectCourseBonusV1`) leen el stage crudo. `handoff` cuenta como checkout sólo mientras exista una sesión de llamada no terminal o no exista ningún resultado terminal posterior al pedido. Un predicado SQL compartido, con la misma regla que 2a. Pago, payment_link_sent, closed y paquete aceptado siguen bloqueando.

### 3. Promoción
No se toca la protección global. Tests: tras continuar por chat, `may_offer_bonus=true`; un pedido explícito actual crea exactamente un `promotion_offer` afín; una objeción histórica no sirve de motivo; con llamada activa, pago, checkout o paquete aceptado sigue bloqueado; tope de 3.

### 4. Composición del programa
4a. Una consulta de contenidos de un curso resuelto con material disponible y no enviado → el turno responde con el resumen factual y ejecuta `send_course_program` (texto + imagen + PDF). Se aplica a través de la capacidad estructurada (`course_programs`), no de frases: si la capacidad declara el material disponible para el curso seleccionado, una reparación no puede negar su existencia. El validador rechaza `send_course_program` ausente sólo cuando el move es `request_course_program` o `ask_course_information` con el curso resuelto y el material no fue enviado. Hay que reconfirmar el subject real antes de fijar el arreglo.
4b. Ya enviado → no reenvía. Fallo de entrega → no afirma.

## Pruebas (rojas primero)
Las 11 del pedido, como unit/integración más el replay de la conversación con DeepSeek (las 29 entradas del cliente) y la tabla mensaje → decisión → estado → efecto.

## No se hace
No se toca `postgres-call-store`, no se agregan regex de frases y no se quita la protección de handoff. No se despliega.
