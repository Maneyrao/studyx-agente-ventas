# La frontera de autoridad del Agente A

**Especificación arquitectónica · v3 · aprobada · 2026-09-01**

| | |
|---|---|
| branch | `codex/agent-a-chanl-evals` |
| base | `404bc8c` |
| decisión | Opción 1 + recorte de contexto |
| plan de ejecución | `docs/superpowers/plans/2026-09-01-frontera-de-autoridad-agente-a.md` |
| preguntas abiertas | ninguna |

DeepSeek propone un turno completo — interpretación, etapa, movimiento, mensajes y acción. El backend valida y ejecuta, **nunca redacta**. Un rechazo devuelve un motivo estructurado y abre una única reparación. El silencio técnico deja de ser un resultado posible.

---

## § 01 Alcance

### Dentro

- Recorte del contexto comercial que recibe DeepSeek, por alcanzabilidad desde el estado.
- Extensión de `AgentATurnProposalV1` con `stage_hypothesis` y `repair_of`.
- Contrato nuevo `TurnRejectionV1` y lazo de reparación única.
- Escalera de tres niveles que garantiza que ningún turno termine en silencio técnico.
- Reescritura versionada del prompt canónico.
- Retiro progresivo de la ruta duplicada bajo feature flag.

### Fuera

- Multi-mensaje en la entrega. El contrato ya admite 1–3; la entrega sigue en uno.
- Agente B, Retell, WhatsApp/Meta, Sheets real, Stripe real, Botpress Cloud, Vercel.
- Cambios al catálogo comercial y a los tres planes autorizados.
- Verificación de pago. Sigue siendo humana y externa.

### Invariantes que no se tocan

Seis datos · `payment_reported` ≠ `payment_verified` · revisión humana · Sheets idempotente · tres planes · máximo dos ofertas de llamada · eventos del Agente B.

### El contrato comercial congelado

Los únicos datos son **nombre, apellido, correo, teléfono, curso canónico y plan canónico**. No se pide ni se agrega ningún otro campo.

**Campos explícitamente prohibidos: ciudad, estado y ZIP.** Se nombran acá porque una prohibición que no puede nombrar lo que prohíbe obliga a cada lector a adivinar qué son «los campos de domicilio», y adivinar es exactamente cómo volvieron a entrar. Estaban repartidos en el prompt canónico, en un fallback del backend, en dos prompts más, en dos fixtures de evaluación y en dos tests que los afirmaban como conducta esperada.

Junto a ellos queda prohibido **«nombre completo»**, que no es un campo de más sino una fusión de dos: pedirlo así hace imposible separar nombre de apellido, que son dos de los seis datos.

Y la distinción que sostiene todo lo demás: **payment_reported ≠ payment_verified**. «Ya pagué» es la afirmación del cliente, fechada y durable. La acreditación del dinero es externa, humana y posterior; ningún turno conversacional puede establecerla, y no existe ni existirá acá una columna que diga que el dinero llegó.

---

## § 02 Modelo de autoridad

Normativo. Cada regla es verificable como test; ninguna es una intención.

| | |
|---|---|
| **A1** | **DeepSeek decide la conversación.** Interpretación, `stage_hypothesis`, próximo mejor movimiento, manejo de objeciones, si ofrecer llamada, tono, mensajes y preguntas. Ningún componente del backend puede sustituir, reescribir ni reordenar su texto. |
| **A2** | **El backend decide las consecuencias.** Existencia del curso, precios y planes canónicos, emisión del link, tope de llamadas, idempotencia, seis datos, `payment_reported`, proyección a Sheets, opt-out y persistencia de hitos. |
| **A3** | **El backend no redacta.** No emite copy visible al cliente salvo el nivel N3 y el aviso de derivación (§ 07), que existen únicamente para que no haya silencio técnico y no afirman nada que no sea cierto. |
| **A4** | **Un rechazo no termina el turno.** Devuelve `TurnRejectionV1` con códigos y alternativas autorizadas. Nunca con prosa ni con instrucciones de redacción. |
| **A5** | **Una sola reparación.** Tope duro. No hay segundo reintento ni lazo. |
| **A6** | **El egress guard permanece.** Revalida también la respuesta reparada. Que el modelo haya reescrito no lo exime. |
| **A7** | **Todo turno entrante produce exactamente un turno visible**, salvo silencio deliberado por opt-out o bloqueo, que se conserva íntegro. |
| **A8** | **Sin respuestas comerciales por regex.** Ninguna frase de un caso de evaluación entra al prompt ni a una expresión regular. |
| **A9** | **Nada se afirma antes de ser cierto.** Un mensaje que afirma un estado sólo se entrega si el commit durable que lo establece fue exitoso. Ver O1–O3 en § 05b. |

---

## § 03 Recorte de contexto

Sólo se recortan hechos y capacidades comerciales. **La conversación se entrega entera.**

| Bloque del contexto | Regla |
|---|---|
| `catalog.payment_plans` · precios | Se recorta. Presente sólo si hay `selected_offering_code` resuelto. |
| `catalog.selected_offering` | Se recorta. Presente sólo si hay curso resuelto por el backend. |
| `catalog.areas` · `offerings` | Siempre presente. Descubrir el catálogo es parte de la venta. |
| Capacidad `send_payment_link` | Se recorta. Anunciada sólo con curso y plan seleccionados. |
| Capacidad `request_call_now` | Se recorta al agotarse el ledger de dos ofertas. |
| `turn.batch_messages` · `recent_turns` | Nunca se recorta. |
| `customer.memories` · preferencias · objeciones | Nunca se recorta. |
| `commercial_state` completo | Nunca se recorta. Incluye `payment_reported`. |
| `identity` · asesor y academia | Nunca se recorta. |

**Principio de alcanzabilidad, no de minimalidad.** Se recorta lo que el estado hace imposible de autorizar en este turno, no lo que parece innecesario. Ante la duda, el hecho se incluye: un recorte agresivo produce un agente que no puede contestar preguntas legítimas, que es un defecto peor que una reparación ocasional.

### Capacidades declaradas

```ts
capabilities: {
  can_request_payment_link: boolean,   // curso Y plan seleccionados
  can_offer_call: boolean,             // ledger < 2 y sin rechazo previo
  can_request_call_now: boolean,
  intake_missing: ['apellido', 'correo'],  // de los cuatro de contacto
}
```

---

## § 04 Contratos

### Modelo → backend

```ts
AgentATurnProposalV1 {
  schema_version: 1,
  move: ConversationMoveV1,
  response: {
    messages: [Msg] | [Msg, Msg] | [Msg, Msg, Msg],
    call_offer: Msg | null,
  },
  proposed_action: { type: 'none' }
    | { type: 'request_call_now', reason }
    | { type: 'send_payment_link', offering_code, payment_plan },
  used_fact_ids: ['payment:redes:monthly_6:label:v1', …],
  used_memory_ids: […],
  memory_candidates: […],
  // ── nuevo ──────────────────────────────────────────
  stage_hypothesis: 'exploring' | 'qualified' | 'course_selected'
    | 'plan_selected' | 'payment_link_sent' | 'handoff' | 'closed',
  // asesor. No persiste. No autoriza nada.
  repair_of: null | { rejection_id: uuid, attempt: 1 },
}
```

### Backend → modelo (nuevo)

```ts
TurnRejectionV1 {
  schema_version: 1,
  rejection_id: uuid,
  attempt: 1,                        // siempre 1; no hay attempt 2
  rejections: [{
    code: 'FACT_NOT_AUTHORIZED'          // citó un hecho no materializado
      | 'FACT_VALUE_MISMATCH'            // afirmó un valor distinto al canónico
      | 'ACTION_NOT_AUTHORIZED'          // pidió una acción sin precondición
      | 'MISSING_INTAKE'                 // faltan datos de contacto
      | 'CALL_BUDGET_EXHAUSTED'          // tercera oferta de llamada
      | 'UNSUPPORTED_OPERATIONAL_CLAIM'  // afirmó alta / acceso / inscripción
      | 'PLAN_NOT_SELECTED'
      | 'COURSE_NOT_RESOLVED',
    subject: 'payment:barista:monthly_6:price:v1',
    // identificador o código. Nunca una frase para el cliente.
  }],
  authorized_alternatives: {
    fact_ids: [ … ],                 // lo que SÍ puede citar ahora
    actions: [ … ],                  // lo que SÍ puede pedir ahora
    missing_information: ['course_selection'],
  },
}
```

**Regla que hace que esto no viole A3:** el backend devuelve identificadores, códigos y listas. No dice «pedile que elija un curso»; dice `COURSE_NOT_RESOLVED` y entrega los `fact_id` disponibles. Cómo se dice sigue siendo de DeepSeek.

### Espejo de contratos

Ambos schemas viven duplicados en `src/features/conversation/adapters/` y `botpress-agent/src/schemas/`, con test de paridad. Los dos contratos nuevos entran en ese test desde el primer commit: la deriva de espejos ya causó un fallo en producción local (`contact_details`).

---

## § 05 Reglas de validación

Orden fijo. La primera que falla determina el código; se acumulan todas antes de responder.

| | |
|---|---|
| **V1** | **Schema.** La propuesta parsea contra `AgentATurnProposalV1`. Un fallo acá no es reparable: va directo a N3. |
| **V2** | **Hechos citados.** Cada `used_fact_id` existe en el registro materializado del turno. Si no: `FACT_NOT_AUTHORIZED`. |
| **V3** | **Valores afirmados.** Todo hecho protegido detectado en el texto coincide, por `(kind, valor normalizado)`, con un hecho seleccionado. Si no: `FACT_VALUE_MISMATCH`. |
| **V4** | **Acción.** `proposed_action` es compatible con el plan del backend y sus precondiciones: curso resuelto, plan elegido, datos de contacto completos, ledger disponible. |
| **V5** | **Afirmaciones de estado y proceso.** Toda oración que afirme un estado operativo —datos registrados, pago informado, revisión, acceso— debe citar un hecho de estado o de proceso materializado para este turno. Sin respaldo: `UNSUPPORTED_OPERATIONAL_CLAIM`. Ver § 05b. |
| **V6** | **Ledger de llamada.** Ofertas visibles ≤ entradas del ledger, tope dos. |
| **V7** | **URLs.** Ninguna URL escrita por el modelo. El link canónico lo inserta el backend. |
| **V8** | **Egress final.** Se ejecuta después de todo lo anterior y también después de una reparación. |

### Defecto detectado al escribir esta especificación

El guard actual **bloquea la frase de reemplazo aprobada**. Verificado ejecutándolo contra «Registro tus datos y, cuando informes el pago, el equipo lo verificará y gestionará el acceso.» → `true`.

Causa: es un detector léxico. Ve un resultado operativo junto a un verbo en primera persona y bloquea, sin mirar a quién se atribuye el resultado, cuándo ocurre, ni si es cierto.

---

## § 05b Autorización por estado, no por texto

Una frase no se permite por coincidir con una cadena aprobada, sino porque **el estado durable la respalda**.

La salida fácil sería agregar la frase aprobada a una lista blanca. Sería un error: la misma oración es verdadera si los datos están registrados y falsa si no, y una lista blanca no distingue esos dos casos. Se autorizaría igual una promesa vacía.

La autorización usa el mecanismo que el sistema ya tiene para los hechos comerciales —cita por identificador— extendido a hechos de **estado** y de **proceso**.

### Vocabulario de hechos de estado y proceso

| `fact_id` | Qué lo respalda | Habilita afirmar |
|---|---|---|
| `state:intake_recorded:v1` | Los cuatro campos de contacto presentes | «Registré tus datos.» |
| `state:payment_reported:v1` | `payment_reported_at` no nulo | «Tengo registrado que informaste el pago.» |
| `process:human_verification:v1` | Canónico. Siempre disponible: describe lo que hace el equipo, no lo que hizo el agente. | «El equipo lo revisará.» |
| `process:access_after_verification:v1` | Canónico. Siempre disponible. | «Si está acreditado, gestionará tu acceso.» |

Son **cuatro y ninguno más**.

### Cómo queda la frase aprobada

> Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.

```ts
used_fact_ids: [
  'state:intake_recorded:v1',            // ← falso si faltan datos ⇒ se bloquea
  'process:human_verification:v1',
  'process:access_after_verification:v1',
]
```

**Consecuencia deseada:** si el intake está incompleto, `state:intake_recorded:v1` no se materializa, la cita falla y la misma frase queda bloqueada. Es más estricto que hoy — el detector léxico actual dejaría pasar «Registré tus datos» aunque no se hubiera registrado nada, porque no contiene ningún sustantivo operativo.

El detector léxico **no desaparece**: sigue haciendo falta para reconocer que una oración hace una afirmación de estado. Lo que cambia es que ya no decide si es válida; eso lo decide la cita contra el estado durable.

### Transición planificada frente a commit durable

Un hecho de estado puede materializarse sobre la **transición planificada** del turno, no sólo sobre el estado ya persistido. Es lo que permite que el cliente entregue sus datos y reciba «Registré tus datos» en ese mismo turno, en vez de en el siguiente. A cambio, el orden se vuelve obligatorio y verificable:

| | |
|---|---|
| **O1** | El hecho de estado se materializa desde la transición que el turno **va a escribir**. |
| **O2** | **El outbound sólo puede entregarse si el commit durable fue exitoso.** Si la transacción falla o revierte, el mensaje no sale — ni siquiera parcialmente. |
| **O3** | Un mensaje que afirma un estado y una transacción que no lo escribió **no pueden coexistir**. Es un test de integración con fallo inyectado, no una convención. |

Sin O2 la afirmación se vuelve exactamente el defecto que este trabajo elimina: el agente diciendo que registró algo que no quedó registrado. La diferencia con hoy es que ahora sería **una mentira respaldada por una cita**, que es peor.

### Lo que queda prohibido siempre

No existe hecho que respalde inscripción confirmada, alta académica, matrícula, credenciales, usuario, contraseña ni acceso entregado, porque **ningún turno conversacional puede establecerlos**. Son los dos hitos externos de § 09. Cualquier oración que los afirme se rechaza por ausencia de respaldo, sin necesidad de una regla especial.

---

## § 06 Secuencias

### Camino feliz — 1 llamada · objetivo ≥ 95 % de los turnos

1. Claim + contexto acotado (hechos por alcanzabilidad, conversación completa)
2. DeepSeek propone el turno (move · stage · mensajes · acción · `fact_ids`)
3. Validación V1–V7
4. Commit transaccional (decisión · estado · acción · idempotencia)
5. Egress V8 y entrega

### Camino de reparación — 2 llamadas · sólo ante rechazo no podable

1. DeepSeek propone
2. Validación rechaza; N1 (poda) no alcanza
3. Backend devuelve `TurnRejectionV1` — códigos + alternativas, sin prosa
4. DeepSeek reescribe con `repair_of`, attempt 1, sin segundo intento
5. Revalidación completa V1–V8
6. Válido → entrega · inválido → N3

### Caída del proveedor

Timeout, rate limit o respuesta vacía de DeepSeek no producen ni copy enlatado ni reparación: van directo a N3. El comportamiento actual (`BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`) se conserva, con la única diferencia de que ahora N3 emite un turno visible en vez de silencio.

---

## § 07 Escalera de reparación

Se baja un escalón sólo cuando el anterior no alcanza. El tercero es un piso, no una opción.

| Nivel | Cuándo | Qué hace | Costo |
|---|---|---|---|
| **N1 · poda** | El hecho inválido está aislado y el resto del mensaje se sostiene | Quita sólo esa oración o ese párrafo. Reutiliza `retainAuthorizedEgressParagraphs` y los guards de oración. | 0 |
| **N2 · reparación** | Podar dejaría la respuesta sin contenido, o el rechazo es de acción | Devuelve `TurnRejectionV1`; DeepSeek reescribe con `authorized_alternatives`. | +1 llamada |
| **N3 · fallback técnico** | La reparación también falla · el schema no parsea · el proveedor cayó | Mensaje técnico. No vende, no interpreta, no pide datos. | 0 |

### Decisión N1 frente a N2

Se intenta N1 primero. Se acepta su resultado sólo si conserva al menos un párrafo **y** el turno resultante sigue respondiendo la intención detectada. Si la poda deja un texto que ya no contesta, se descarta y se pasa a N2. Un rechazo de `proposed_action` nunca es podable: va directo a N2.

### N3 · texto y alcance

N3 es **exclusivamente un fallback técnico**. No vende, no interpreta y no pide datos adicionales.

> Recibí tu mensaje, pero tuve una demora para procesarlo. Probá nuevamente en unos segundos.

Reemplaza a `LAST_RESORT_OPENING`, que hoy dice «Seguimos por acá. Contame cómo puedo ayudarte.» — una frase que después de «ya pagué» simula conversación y le pide al cliente que repita lo que ya dijo. La nueva no simula: nombra la falla.

**N3 cuenta como fallo conversacional, no como éxito.** Que el cliente reciba algo no es que el agente haya contestado. Entra como fallo en toda métrica y todo gate.

### Derivación tras dos fallos consecutivos

Si la causa del rechazo es determinista, reintentar produce el mismo N3 y el cliente entra en un bucle de disculpas técnicas. **Dos N3 consecutivos no producen un tercer fallback.** En el segundo:

1. Se crea de manera **idempotente** un estado/evento durable `human_review_requested`.
2. Se commitea.
3. **Únicamente después del commit** se envía:

> Sigo teniendo un inconveniente para procesar tu consulta. Dejé registrada la conversación para revisión.

No se promete atención inmediata, respuesta humana ni transferencia en vivo. El texto dice «registrada» y no nombra a nadie porque **no existe bandeja monitoreada**: lo único que ocurre de verdad es que la conversación queda consultable.

Reglas:

- Máximo **una derivación activa** por conversación.
- Un turno exitoso **reinicia el contador** de N3. La marca es histórica y no se borra.
- Una entrada nueva **puede volver a intentar** DeepSeek: la conversación no queda terminal, y por eso la derivación **no** es `stage: 'handoff'`.
- Si el commit de la derivación falla, **no se afirma que fue realizada** (O2).
- Se reutiliza la infraestructura existente antes de crear otra.
- No involucra al Agente B.

### Silencio deliberado

El silencio por **opt-out o bloqueo está permitido y se conserva**. A7 cubre el silencio técnico, no la decisión de callar. Un contacto que pidió no ser contactado no recibe N3 ni el aviso de derivación, ni siquiera con el proveedor caído: romper el silencio por un timeout sería peor que el silencio. Las métricas cuentan «silencios no deliberados»; un opt-out no entra en ese numerador.

### Observabilidad del rechazo

El borrador rechazado **no entra en `messages` productivos**. Se escribe a un artefacto local de diagnóstico, a través de un **sumidero único**, **gitignored**, y **sin PII ni secretos**: los cuatro campos de contacto se redactan antes de escribir. Se guarda el texto redactado, el `rejection_id`, los códigos y el conjunto autorizado.

Una tabla restringida con TTL se evalúa recién en la Fase 3, y sólo si la necesidad aparece en producción. El sumidero único existe para que ese cambio sea de una línea.

**Costo aceptado:** con la PII redactada no se puede diagnosticar un fallo que dependa de la identidad del cliente. Las clases de fallo que importan —hechos, precios, promesas, acciones— no dependen de ella, así que la pérdida es aceptable.

---

## § 08 Prompt canónico v2

Se edita la fuente completa y se versiona. No se resume ni se parchea el generado.

| Archivo | Rol |
|---|---|
| `docs/prompts/studyx-agent-a-canonical.md` | Fuente. Se edita acá. |
| `scripts/generate-agent-a-prompt-module.mjs` | Generador. `npm run generate:agent-a-prompt` |
| `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts` | Derivado. Nunca se edita a mano. |
| `STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION` | `studyx-agent-a-canonical-v1` → `v2` |

### Cambios exactos

| | |
|---|---|
| **P1** | Solicitar únicamente nombre, apellido, correo y teléfono. |
| **P2** | Curso y plan provienen del estado canónico; el prompt no los pide como dato de inscripción. |
| **P3** | Eliminar **ciudad, estado y ZIP** de toda la fuente, y también «nombre completo». |
| **P4** | Eliminar «Ya te dejo la preinscripción cargada en el sistema.» (§ 5 Fricción de pago). |
| **P5** | Eliminar «te doy el alta académica y genero tus credenciales de acceso.» (§ 4 Fase 5). |
| **P6** | Reemplazar por el copy autorizado: «Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.» |
| **P7** | Prohibir afirmar pago verificado, inscripción confirmada o acceso habilitado sin evidencia durable. |
| **P8** | Mantener exclusivamente 12 cuotas, 6 cuotas y pago único. |
| **P9** | Mantener el tope de dos ofertas de llamada. |
| **P10** | Eliminar por completo toda instrucción de entregar link de campus, usuario, contraseña o credenciales. Afecta la Fase 6 Onboarding entera. El Agente A registra datos e informa el pago; nada más. |
| **P11** | Eliminar envío de PDF, todo link o archivo de programa no disponible, «te escribo en {{PLAZO_CONCRETO}}» y cualquier promesa de seguimiento futuro no ejecutable. Único reemplazo autorizado: «Puedo contarte el contenido del programa por acá.» Una futura entrega documental exige una capacidad estructurada propia. |

**Sobre P11 y la tabla de seguimiento.** Las instrucciones de mandar mensajes a las 24 h, 72 h, 7 y 14 días caen bajo P11 aunque no sean promesas hechas al cliente: **no hay agendador**. Nada en el repositorio dispara un turno saliente por tiempo transcurrido, así que la instrucción ordena algo que el sistema no puede hacer — la misma contradicción entre prompt y backend que esta especificación elimina.

### Prueba de que el prompt y el backend dejaron de contradecirse

Un test recorre la fuente del prompt y falla si contiene una instrucción que V5 bloquearía. Es la contradicción de hoy convertida en **gate permanente**: el prompt no puede volver a ordenar algo que el guard borra.

---

## § 09 Etapa flexible, hitos duros

`stage_hypothesis` es contexto: entra en la propuesta, se registra para diagnóstico, **no persiste y no autoriza nada**. El backend conserva únicamente siete hitos, y sólo con evidencia durable.

| Hito | Evidencia que lo establece | Dónde vive |
|---|---|---|
| curso seleccionado | Resolución exacta contra el catálogo | `selected_offering_code` |
| plan seleccionado | Plan canónico elegido | `selected_payment_plan` |
| datos completos | Los cuatro campos de contacto | `contacts` |
| link enviado | Acción comprometida y entregada | `stage` + decisión |
| pago informado | Afirmación del cliente | `payment_reported_at` |
| pago verificado | Externa. Ningún turno puede establecerlo. | fuera de alcance |
| acceso entregado | Externa. Ningún turno puede establecerlo. | fuera de alcance |

---

## § 10 Rollout

Cada fase termina en un gate medible. Ninguna fase empieza si la anterior no pasó.

### Fase 0 — cimientos · sin cambio de arquitectura

Corregir las contradicciones del prompt canónico (P1–P11) y versionar a v2. Corregir V5 para que autorice por estado (§ 05b). Barrer del repositorio los campos fuera del contrato. Instalar N3 y la derivación. Estabilizar el harness con métricas por turno. Separar el caso de caída técnica del conjunto de conversación. Fijar contextos reproducibles para replay. Confirmar con qué flags corre producción.

**Gate:** cero silencios no deliberados · silencio por opt-out conservado · cero promesas operativas falsas · varianza de casos ≤ ±1 en 3 corridas · `technical_fallback_count` medido y desglosado por motivo · revisiones pendientes consultables · cero campos fuera del contrato en el repositorio · replay reproducible.

Este gate deliberadamente **no** pone umbral a la tasa de éxito. La Fase 0 no mejora la conversación: elimina contradicciones y hace visible lo que estaba oculto. Con N3 contando como fallo, es esperable que la tasa medida empeore respecto de la línea base.

*rollback: revertir el prompt a v1; el flag no existe todavía.*

### Fase 1 — recorte + medición

Implementar `intake_missing` y el bloque `capabilities` completo. Medir tasa de rechazo, tasa esperada de reparación, p50/p95, tokens y variación. Mínimo 3 corridas.

**Gate de tres tramos sobre la tasa de reparación:** ≤ 10 % pasa · 10–15 % pasa con advertencia registrada y revisión del recorte · **> 15 % bloquea la Fase 2** y reabre la decisión de arquitectura. En los tres tramos, **p95 < 6 s es condición dura**.

*rollback: `AGENT_A_CONTEXT_SCOPING=false`. El flag gobierna únicamente lo nuevo; el recorte ya desplegado no tiene flag, porque dárselo significaría escribir un modo sin recorte que hoy no existe.*

### Fase 2 — propuesta → validación → reparación

`TurnRejectionV1`, `stage_hypothesis`, `repair_of` y paridad de espejos. Escalera N1–N3 completa. Reparación detrás de `AGENT_A_REPAIR_ENABLED`, apagada; se enciende al final.

**Gate:** cero silencios en 20 casos × 3 corridas · ≥ 95 % de turnos elegibles con un único llamado al LLM (§ 12) · p95 < 6 s · reparación exitosa ≥ 80 % · `technical_fallback_count` ≤ 2 % de los turnos.

*rollback: `AGENT_A_REPAIR_ENABLED=false`; el rechazo vuelve a N1/N3, sin silencio.*

### Fase 3 — ruta única + iteración de prompt

Desactivar el compositor Gemini y la ruta pre-pipeline bajo flag; conservar planner, registro de hechos, ensamblador y egress. Desactivar `modelUnavailableFallback`. Recién entonces: iterar el prompt con visibles y held-out.

**Gate:** una sola ruta activa · sin regresión en los 15 casos del flujo mínimo · held-out sin caída respecto de la Fase 2 · naturalidad ≥ 18/20 · iniciativa preservada.

*rollback: reactivar `CONVERSATION_PIPELINE_V1_ENABLED` como kill switch.*

---

## § 11 Rollback

| | |
|---|---|
| **R1** | Todo cambio de conducta entra detrás de flag y por defecto apagado. Nada se enciende en el mismo commit que lo introduce. |
| **R2** | Apagar un flag nunca reintroduce silencio. Con la reparación apagada el sistema cae a N1/N3, no al comportamiento actual. |
| **R3** | Las migraciones son aditivas. Ninguna columna se borra en este trabajo; un rollback de código no requiere rollback de esquema. |
| **R4** | El prompt se revierte por versión. v1 queda en el repositorio; volver es cambiar la constante y regenerar. |
| **R5** | La ruta duplicada no se borra hasta la Fase 3, y sólo después de que la ruta única pase su gate en tres corridas. |
| **R6** | **El rollback se conserva hasta que el held-out y el canary estén verdes.** Es una condición de retiro, no de encendido: ningún flag se elimina del código, la ruta duplicada no se borra, `modelUnavailableFallback` no se retira y el prompt v1 no sale del repositorio antes de que ambas señales estén verdes. Que una fase pase su gate habilita seguir; no habilita quedarse sin vuelta atrás. |

El canary no está definido en esta especificación. Se especifica al llegar al rollout de la Fase 3, con la misma regla que el resto: gate medible antes de avanzar.

---

## § 12 Métricas

Por turno, no por caso. Un caso que falla por un turno deja de borrar la información de los otros cuatro.

| Métrica | Definición | Fuente |
|---|---|---|
| tasa de rechazo | turnos con ≥ 1 rechazo de validación ÷ turnos | validador |
| tasa de reparación | turnos que llegan a N2 ÷ turnos | validador |
| reparación exitosa | turnos N2 que validan al segundo intento ÷ turnos N2 | validador |
| `technical_fallback_count` | turnos que entregan N3 o el aviso de derivación | runner |
| desglose por motivo | `technical_fallback_count` agrupado por causa | runner |
| `human_review_count` | derivaciones a revisión | estado |
| tasa de éxito conversacional | turnos que contestaron de verdad ÷ turnos. **N3 no entra en el numerador.** | runner |
| llamadas por turno | 1 + reparaciones | runner |
| `provider_failover_calls` | invocaciones extra por caída, timeout o cuota del proveedor primario | runner |
| silencios | turnos entrantes con cero mensajes visibles **y sin opt-out ni bloqueo** | `messages` |
| p50 / p95 | latencia extremo a extremo por turno visible | runner |
| tokens | entrada y salida por llamada | proveedor |
| promesas falsas | oraciones que V5 habría bloqueado en el texto entregado | escaneo post-entrega |
| ofertas vs ledger | ofertas visibles − entradas del ledger | estado |
| variación | desvío de casos aprobados entre 3 corridas del mismo commit | runner |

**Línea base actual:** p50 2.854 ms · p95 3.456 ms · ~5.900 tokens de entrada por turno · 4 supresiones en 88 turnos (≈ 4,5 %) · variación 18/15/16 de 20 sobre el mismo código.

### Un único llamado al LLM por turno elegible en ≥ 95 %

El criterio de aceptación decía «≥ 95 % de turnos resueltos en una sola llamada». Así no es accionable: no dice qué turno entra en el denominador ni qué invocación cuenta como llamada. Queda definido así.

**Turno elegible** — el denominador. Un turno entrante que llegó a la ruta autoritativa del modelo, es decir que cumple **todas** estas condiciones:

- la automatización está encendida;
- la política permite responder;
- el contacto no está bloqueado y no pidió opt-out;
- el turno no fue resuelto por una ruta determinística;
- el proveedor fue efectivamente invocado al menos una vez.

Quedan **fuera del denominador**: opt-out y bloqueados (su silencio es deliberado y correcto), las rutas determinísticas (no consultan al modelo, así que no hablan de si la arquitectura ahorra llamadas) y los turnos donde el proveedor nunca llegó a ser invocado.

**Llamada** — el numerador cuenta los turnos elegibles resueltos con **exactamente una invocación de generación de propuesta**. Una invocación es un intento de producir una `AgentATurnProposalV1`. No cuentan como llamada: embeddings, recuperación de memoria, ni el intérprete o el compositor de la ruta legacy que la Fase 3 retira.

**Failover y reparación se cuentan por separado, y esto no es un tecnicismo.** Son dos causas distintas con dos arreglos distintos:

| Métrica | Qué cuenta | Qué significa que suba |
|---|---|---|
| `repair_rate` | turnos elegibles que invocaron N2 | la validación rechaza demasiado: el recorte de contexto o el prompt están mal |
| `provider_failover_calls` | invocaciones extra por caída, timeout o cuota del proveedor primario | el proveedor está degradado; no dice nada sobre la arquitectura |

El gate de **≥ 95 % se mide sobre `repair_rate`**: turnos elegibles resueltos sin invocar N2, dividido turnos elegibles. El failover se reporta al lado y **nunca** entra en ese cociente.

El motivo es que mezclarlos rompe la métrica en las dos direcciones. Una caída de DeepSeek se leería como un fallo de arquitectura y dispararía un rediseño que no arregla nada; y a la inversa, un período de proveedor impecable podría enmascarar una tasa de reparación en ascenso. Un número que sube por dos causas que se arreglan distinto no sirve para decidir nada.

---

## § 13 Criterios de aceptación

- Cero silencios no deliberados en 20 casos × 3 corridas
- Silencio por opt-out o bloqueo conservado: nunca recibe N3
- p95 extremo a extremo < 6 s
- **≥ 95 % de turnos elegibles resueltos con un único llamado al LLM**, medido sobre `repair_rate` según la definición de § 12; el failover de proveedor se reporta aparte y no entra en el cociente
- Reparación exitosa ≥ 80 % de los turnos que llegan a N2
- Cero promesas operativas falsas en todas las transcripciones
- Un link por contacto y una fila de operador por contacto, bajo replay
- Ofertas de llamada visibles = entradas del ledger, máximo dos
- Los 15 casos del flujo mínimo estables en 3 corridas consecutivas
- Naturalidad ≥ 18/20
- Variación entre corridas del mismo commit ≤ ±1 caso
- El prompt no contiene ninguna instrucción que V5 bloquearía
- Ningún outbound entregado afirma un estado cuyo commit durable falló (fallo inyectado)
- Máximo una derivación activa por conversación, verificada bajo replay
- Cero campos fuera del contrato comercial en el repositorio
- Cero promesas de archivo, link, plazo o mensaje futuro en el prompt
- N3 contabilizado como fallo en toda métrica y todo gate
- Las revisiones pendientes son consultables, y la documentación dice que el sistema no avisa
- Iniciativa preservada: al menos un caso donde DeepSeek propone un movimiento comercial válido que el planner no habría elegido por sí solo

### Evaluación · separación de conjuntos

- **Visibles — 20 casos.** Legibles durante el desarrollo. Son el único conjunto contra el que se itera.
- **Held-out** — creados por un agente independiente, fuera de este worktree. No se leen antes de la evaluación final, no se editan y no se usan para depurar.
- **Replay** de contextos congelados para iterar el prompt con el prompt como única variable.

### Protocolo de revelación

Cuando un caso held-out falla, se entrega exactamente esto y nada más:

| Campo | Ejemplo | Texto del caso |
|---|---|---|
| categoría del fallo | `UNSUPPORTED_OPERATIONAL_CLAIM` | nunca |
| gate incumplido | «cero promesas operativas falsas» | nunca |
| turno | 4 | nunca |
| capa probable | validación V5 · intérprete · recorte | nunca |

Un held-out revelado **deja de serlo**: ese caso se retira del conjunto y el agente independiente escribe uno nuevo para reemplazarlo, de modo que el tamaño del conjunto no baje y su valor no se erosione con el uso.

**Consecuencia aceptada:** un fallo held-out llega como categoría, no como caso. El procedimiento es reproducir esa clase de fallo con un caso visible nuevo y arreglarlo ahí — nunca pedir la transcripción. Es más lento, y es lo que hace que la medición signifique algo.

---

## § 14 Decisiones

| | |
|---|---|
| **Q1 ✓** | **Onboarding eliminado.** El Agente A no entrega campus, usuario, contraseña ni credenciales. Copy autorizado en P6. La autorización es por estado durable (§ 05b), no por excepción de texto. |
| **Q2 ✓** | **N3 es fallback técnico y sólo eso.** No vende, no interpreta, no pide datos. Texto fijado en § 07. |
| **Q3 ✓** | **Artefacto local**, sumidero único, gitignored, sin PII ni secretos. Tabla con TTL sólo si la Fase 3 la justifica. |
| **Q4 ✓** | **Umbrales.** Reparación ≤ 10 % pasa · 10–15 % advertencia · > 15 % bloquea la Fase 2. p95 < 6 s siempre. |
| **Q5 ✓** | **Held-out por agente independiente**, fuera de este worktree, no legible hasta la evaluación final. |
| **Q6 ✓** | **Cuatro hechos**, ninguno más. Pueden materializarse sobre la transición planificada, con O1–O3 como contrapartida. |

### Desviaciones aprobadas sobre el plan de ejecución

- **D1** — N3 y `human_review_requested` se adelantan a la Fase 0. N3 cuenta como fallo. Se mide el conteo, el motivo, la reparación y la revisión. Las revisiones pendientes deben ser consultables. Como no hay bandeja monitoreada, rige el texto que no promete atención humana.
- **D2** — El recorte de § 03 ya estaba implementado casi entero. Los flags gobiernan únicamente lo nuevo; el rollback no construye una ruta sin recorte que hoy no existe.
- **D3** — Corrección obligatoria y barrida a todo el repositorio: prompts, fallbacks, fixtures, contratos y tests. La pregunta por los datos la redacta DeepSeek desde `intake_missing`; un fallback transitorio sólo puede mencionar los campos del contrato. Retell queda **intacto** por estar fuera de alcance (§ 01), y su exclusión se declara explícitamente en el guard.

---

**Estado:** aprobada · en ejecución desde la Fase 0 · plan en `docs/superpowers/plans/2026-09-01-frontera-de-autoridad-agente-a.md`.

**Verificado en código:** orden del pipeline en `processInboundTurn.ts` (:561 · :631 · :850) · supresión en `decision.service.ts` (:755, :788) · contrato en `schemas/agent-a-brain.ts` · fuente del prompt en `docs/prompts/studyx-agent-a-canonical.md` · guard V5 ejecutado contra la frase aprobada · ausencia de bandeja de operador en `src/app/api`.
