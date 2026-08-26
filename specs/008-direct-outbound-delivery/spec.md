# Feature Specification: Entrega Outbound Directa Multicanal

**Feature Branch**: `feat/008-direct-outbound-delivery`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "Entrega outbound directa multicanal desde el orquestador. El orquestador debe poder enviar mensajes salientes a un contacto directamente por Telegram (Bot API) y por WhatsApp (Meta Cloud API), sin depender de que Botpress haga la entrega, de modo que un flujo en vivo (por ejemplo, una llamada de voz en curso) pueda confirmar que el mensaje realmente salió antes de responderle al agente. Alcance: un puerto de canal de mensajería con dos adapters (Telegram implementado; WhatsApp detrás del mismo puerto), resolución del destinatario mediante identidades por canal del contacto (hoy contacts solo guarda phone; Telegram necesita chat_id), selección de canal con fallback cuando falta una identidad, verificación de consentimiento (opted_in_at) y de contacto bloqueado antes de enviar, registro en messages y en el ledger existente outbound_deliveries reutilizando el unique (provider, integration_id, idempotency_key) para idempotencia, y mapeo del resultado del proveedor a los estados existentes submitted/delivered/failed_retryable/dead_letter. Fuera de alcance: la integración con Retell y la generación del link de pago de Stripe, que van en una spec posterior. Restricciones: migraciones aditivas, multi-tenant por workspace_id, nunca duplicar un envío ante reintentos, y pausar antes que enviar a un contacto sin consentimiento."

## Contexto y Motivación

Hoy el orquestador no entrega mensajes salientes: los encola y delega la entrega a un
agente conversacional externo, que reporta el resultado más tarde. Eso produce dos
problemas de negocio:

1. **No hay confirmación en vivo.** Un flujo que ocurre en tiempo real —una llamada de
   voz en curso, donde el vendedor le dice al cliente "te lo estoy mandando ahora"— no
   puede saber si el mensaje efectivamente salió. El sistema afirma algo que todavía no
   ocurrió.
2. **Dependencia operativa bloqueante.** El piloto de Telegram está detenido porque la
   integración de ese canal no está habilitada en la plataforma externa. Mientras la
   entrega dependa de ese tercero, el negocio no puede operar el canal.

Esta feature traslada la responsabilidad de entrega al orquestador, alineándose con el
principio constitucional de que el orquestador es el único componente autorizado a
comunicarse con APIs externas y los agentes conversacionales son solo "bocas y oídos".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entrega confirmada en el momento (Priority: P1)

Un flujo de negocio en curso necesita hacerle llegar un mensaje a un contacto y saber,
antes de continuar, si el mensaje salió o falló. El sistema envía el mensaje al canal
del contacto y devuelve un resultado concluyente —entregado al proveedor, o fallido con
motivo— dentro de la misma operación, sin depender de un tercero que reporte después.

**Why this priority**: Es la razón de existir de la feature y el desbloqueo operativo
del piloto. Sin esto, ningún flujo en vivo puede afirmar con verdad que envió algo.

**Independent Test**: Se puede probar de punta a punta invocando el envío para un
contacto con identidad de canal conocida y verificando que el mensaje llega al
dispositivo del destinatario y que la operación devolvió confirmación sincrónica.
Entrega valor por sí sola: habilita el piloto sin ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un contacto con consentimiento vigente y una identidad de canal válida,
   **When** un flujo solicita enviarle un mensaje, **Then** el mensaje llega al
   destinatario y la operación devuelve confirmación de envío junto con el
   identificador que asignó el proveedor.
2. **Given** el proveedor de mensajería responde con un error temporal,
   **When** se solicita el envío, **Then** la operación devuelve fallo con motivo, el
   envío queda registrado como reintentable, y ningún flujo afirma que el mensaje salió.
3. **Given** el proveedor de mensajería no responde dentro del límite de espera,
   **When** se solicita el envío, **Then** la operación devuelve fallo por tiempo
   agotado sin dejar el registro en un estado ambiguo.
4. **Given** un envío fue solicitado, **When** se consulta el historial del contacto,
   **Then** el mensaje saliente aparece registrado con su estado y su trazabilidad,
   igual que cualquier otro mensaje de la conversación.

---

### User Story 2 - Un pedido, un solo mensaje (Priority: P2)

El mismo pedido de envío puede llegar más de una vez: el sistema origen reintenta, o el
usuario repite la solicitud durante una conversación. El contacto debe recibir el
mensaje una sola vez.

**Why this priority**: Un mensaje comercial duplicado —sobre todo si contiene un link de
pago— genera desconfianza y disputas económicas. Es la garantía que hace seguro apoyar
flujos automáticos encima de esta capacidad.

**Independent Test**: Invocar dos veces el envío con la misma clave de pedido y
verificar que el contacto recibió un solo mensaje y que la segunda invocación devolvió
el resultado de la primera en lugar de generar uno nuevo.

**Acceptance Scenarios**:

1. **Given** un envío ya realizado con una clave de pedido determinada, **When** llega
   otra solicitud con la misma clave, **Then** el sistema no envía un segundo mensaje y
   devuelve el resultado del envío original.
2. **Given** dos solicitudes con la misma clave llegan simultáneamente, **When** ambas
   se procesan a la vez, **Then** el contacto recibe exactamente un mensaje.
3. **Given** un envío previo con la misma clave falló de forma reintentable, **When**
   llega una nueva solicitud con esa clave, **Then** el sistema reintenta el envío sin
   crear un registro duplicado.

---

### User Story 3 - Nunca escribirle a quien no corresponde (Priority: P2)

Antes de enviar, el sistema verifica que el contacto haya consentido ser contactado y
que no esté bloqueado, dado de baja o archivado. Ante la duda, no envía.

**Why this priority**: Escribirle a alguien sin consentimiento es un riesgo legal y
reputacional, y el principio operativo del proyecto es pausar antes que equivocarse.
Va junto con la no-duplicación como par de garantías de seguridad del canal.

**Independent Test**: Solicitar el envío para un contacto sin consentimiento registrado
y verificar que no se envía nada, que el rechazo queda registrado con motivo, y que el
flujo solicitante recibe un resultado que le permite explicarlo.

**Acceptance Scenarios**:

1. **Given** un contacto sin consentimiento registrado, **When** se solicita enviarle un
   mensaje, **Then** el sistema no envía nada y devuelve un rechazo con motivo
   explícito de consentimiento.
2. **Given** un contacto marcado como inactivo, archivado o dado de baja, **When** se
   solicita enviarle un mensaje, **Then** el sistema no envía nada y devuelve un rechazo
   con motivo.
3. **Given** un contacto pertenece a otro tenant que el del pedido de envío, **When** se
   solicita el envío, **Then** el sistema rechaza la operación sin revelar información
   del contacto.
4. **Given** un envío fue rechazado por consentimiento, **When** se audita el período,
   **Then** el rechazo es visible con contacto, motivo y momento, sin haber generado un
   mensaje saliente.

---

### User Story 4 - Segundo canal y elección con respaldo (Priority: P3)

Un contacto puede tener más de un canal disponible. El flujo solicitante puede pedir un
canal específico, y si ese canal no está disponible para ese contacto, el sistema usa
otro canal habilitado en lugar de fallar.

**Why this priority**: Aumenta la tasa de entrega, pero el negocio ya obtiene valor con
un solo canal funcionando. Depende de que exista más de una identidad por contacto.

**Independent Test**: Solicitar el envío pidiendo un canal para el que el contacto no
tiene identidad y verificar que el mensaje llega por el canal alternativo, y que el
resultado informa por cuál canal salió realmente.

**Acceptance Scenarios**:

1. **Given** un contacto con identidad en un solo canal, **When** se solicita el envío
   por el canal que no tiene, **Then** el mensaje se entrega por el canal disponible y
   el resultado indica qué canal se usó.
2. **Given** un contacto cuya última conversación por WhatsApp ocurrió hace más de 24
   horas y que tiene identidad de Telegram, **When** se solicita el envío por WhatsApp,
   **Then** el mensaje se entrega por Telegram y el resultado informa el cambio de canal.
3. **Given** un contacto sin ninguna identidad de canal utilizable, **When** se solicita
   el envío, **Then** el sistema devuelve un rechazo que distingue "no hay canal
   disponible" de "el envío falló".
4. **Given** un contacto tiene identidades en varios canales y el solicitante no
   especifica canal, **When** se solicita el envío, **Then** el sistema elige según un
   orden de preferencia determinístico y reproducible.
5. **Given** un contacto que nunca inició conversación con el bot de Telegram y cuya
   ventana de WhatsApp está vencida, **When** se solicita el envío, **Then** el sistema
   rechaza informando que el contacto no es alcanzable por ningún canal, sin intentar
   ningún envío.

---

### Edge Cases

- **Resultado ambiguo del proveedor**: la solicitud sale pero la respuesta se pierde. El
  sistema no puede saber si el mensaje llegó. Debe quedar en un estado que impida tanto
  afirmar la entrega como reenviar a ciegas.
- **Identidad de canal obsoleta**: el contacto bloqueó el bot o borró la conversación.
  El proveedor rechaza el envío de forma permanente; esa identidad debe dejar de
  considerarse utilizable en lugar de reintentarse indefinidamente.
- **Contacto que retira el consentimiento entre el encolado y el envío**: la verificación
  debe ocurrir en el momento del envío, no solo al momento de encolarlo.
- **Mensaje que excede el largo máximo del canal**: debe rechazarse con motivo claro
  antes de enviar, no truncarse silenciosamente.
- **Agotamiento de reintentos**: un envío que falla repetidamente debe terminar en un
  estado terminal visible en lugar de reintentarse para siempre.
- **Dos contactos distintos con la misma identidad de canal**: debe ser imposible dentro
  de un mismo tenant.
- **Canal fuera de servicio**: si el proveedor está caído, los rechazos deben ser
  distinguibles de un problema con el contacto puntual.
- **Ventana de WhatsApp que vence entre la decisión y el envío**: la vigencia debe
  evaluarse en el momento del envío; un envío rechazado por el proveedor por ventana
  vencida no debe contarse como fallo técnico reintentable.
- **Contacto alcanzable por ningún canal**: sin ventana de WhatsApp vigente y sin
  identidad de Telegram, el contacto es inalcanzable. El flujo en vivo debe poder
  distinguir esto para que el vendedor ofrezca una alternativa durante la llamada, en
  lugar de prometer un mensaje que nunca va a llegar.
- **Evento entrante de Telegram de un remitente desconocido**: no debe crear contactos
  implícitos ni vincularse al contacto equivocado.

## Requirements *(mandatory)*

### Functional Requirements

#### Envío y confirmación

- **FR-001**: El sistema MUST entregar mensajes salientes a un contacto contactando
  directamente al proveedor del canal, sin intermediación de un agente conversacional
  externo.
- **FR-002**: El sistema MUST devolver al solicitante un resultado concluyente dentro de
  la misma operación, que distinga: enviado, rechazado por política, fallido
  reintentable, y fallido definitivo.
- **FR-003**: El sistema MUST aplicar un límite de espera al proveedor, acotado para ser
  compatible con un flujo conversacional en vivo, y tratar el vencimiento como fallo.
- **FR-004**: El sistema MUST registrar el identificador de mensaje que devuelve el
  proveedor cuando el envío es exitoso.
- **FR-005**: El sistema MUST registrar todo mensaje saliente en el historial de la
  conversación del contacto, con la misma trazabilidad que el resto de los mensajes.
- **FR-006**: El sistema MUST reflejar el resultado de cada envío en el ledger de
  entregas existente, reutilizando sus estados actuales sin introducir estados nuevos
  específicos de un proveedor.

#### Idempotencia

- **FR-007**: Todo pedido de envío MUST incluir una clave de idempotencia provista por
  el solicitante.
- **FR-008**: El sistema MUST garantizar que dos pedidos con la misma clave de
  idempotencia produzcan como máximo un mensaje entregado al contacto.
- **FR-009**: Ante un pedido repetido cuya entrega ya fue exitosa, el sistema MUST
  devolver el resultado original sin contactar al proveedor.
- **FR-010**: La garantía de no duplicación MUST sostenerse ante pedidos concurrentes, y
  MUST estar respaldada por una restricción de base de datos, no solo por lógica de
  aplicación.

#### Consentimiento y elegibilidad

- **FR-011**: El sistema MUST verificar, en el momento del envío, que el contacto tenga
  consentimiento vigente para ser contactado; si no lo tiene, MUST rechazar sin enviar.
- **FR-012**: El sistema MUST rechazar el envío a contactos bloqueados, inactivos,
  archivados o con baja lógica.
- **FR-013**: El sistema MUST verificar que el contacto pertenezca al tenant del pedido
  antes de resolver cualquier dato del contacto.
- **FR-014**: Todo rechazo por política MUST quedar registrado con contacto, motivo y
  momento, y MUST ser distinguible de un fallo técnico.

#### Identidades de canal y selección

- **FR-015**: El sistema MUST poder almacenar, para un mismo contacto, una identidad de
  destinatario por cada canal, dado que los canales identifican al destinatario de
  formas distintas.
- **FR-016**: Una misma identidad de canal MUST NOT poder asociarse a dos contactos
  distintos dentro de un mismo tenant.
- **FR-017**: El sistema MUST permitir que el solicitante indique un canal preferido.
- **FR-018**: Si el canal preferido no está disponible para ese contacto, el sistema
  MUST intentar con otro canal habilitado antes de rechazar.
- **FR-019**: Si el solicitante no indica canal, el sistema MUST seleccionar según un
  orden de preferencia configurable por tenant y determinístico.
- **FR-020**: El resultado MUST informar por qué canal se envió efectivamente el
  mensaje.
- **FR-021**: El sistema MUST distinguir "el contacto no tiene ningún canal utilizable"
  de "el envío falló".
- **FR-022**: Cuando el proveedor indique que una identidad ya no es válida de forma
  permanente, el sistema MUST marcarla como inutilizable en lugar de seguir
  reintentando contra ella.

#### Canales soportados

- **FR-023**: El sistema MUST soportar el envío por Telegram.
- **FR-024**: El sistema MUST soportar el envío por WhatsApp bajo la misma interfaz de
  envío, de modo que agregar o cambiar un canal no requiera cambiar los flujos que
  solicitan envíos.
- **FR-025**: El sistema MUST enviar por WhatsApp únicamente cuando exista una ventana
  de atención vigente, es decir, cuando el contacto haya escrito por ese canal dentro de
  las últimas 24 horas. Fuera de la ventana, WhatsApp MUST tratarse como canal no
  disponible para ese contacto.
- **FR-026**: El sistema MUST determinar si la ventana de atención de WhatsApp está
  vigente en el momento del envío, a partir del último mensaje entrante del contacto por
  ese canal.
- **FR-027**: Cuando WhatsApp sea el canal preferido pero su ventana esté vencida, el
  sistema MUST tratarlo como canal indisponible y aplicar la regla de respaldo de
  FR-018, en lugar de fallar el envío.
- **FR-028**: El sistema MUST registrar la identidad de Telegram de un contacto de forma
  automática cuando ese contacto inicia conversación con el bot, vinculando el
  identificador de chat recibido al contacto correspondiente.
- **FR-029**: Ante un evento entrante de Telegram cuyo remitente no corresponda a ningún
  contacto conocido del tenant, el sistema MUST registrar el evento sin vincularlo y
  MUST NOT crear un contacto de forma implícita.
- **FR-030**: La vinculación de una identidad de Telegram MUST ser idempotente: recibir
  repetidamente eventos del mismo remitente no MUST producir identidades duplicadas.

#### Candado anti-efectos-reales

- **FR-034**: El sistema MUST verificar, antes de contactar a cualquier proveedor real,
  que el contacto no esté marcado como sintético de laboratorio; si lo está, MUST
  rechazar el envío con un motivo propio y distinguible de un rechazo por consentimiento.

  *Origen*: requisito derivado del Constitution Check, no del pedido original. El
  proyecto ya tiene un candado vigente que impide que un contacto de pruebas dispare
  efectos reales (llamadas, cobros, mensajes de producción). Un camino de envío nuevo que
  lo ignore reintroduce exactamente el riesgo que ese candado cierra.

#### Preservación y compatibilidad

- **FR-031**: Los cambios de esquema MUST ser aditivos; el flujo de entrega existente
  vía agente externo MUST seguir funcionando sin cambios durante la transición.
- **FR-032**: El sistema MUST NOT eliminar registros; toda invalidación se expresa como
  marca lógica.
- **FR-033**: Las credenciales de los proveedores de canal MUST ser accesibles
  únicamente por el orquestador, nunca por un agente conversacional.

### Key Entities

- **Contacto**: la persona con la que el negocio conversa. Tiene un estado de
  consentimiento y un estado de ciclo de vida que determinan si es contactable.
  Pertenece a uno o más tenants.
- **Identidad de canal**: la forma en que un canal específico identifica a un contacto
  (un número telefónico para uno, un identificador de chat para otro). Un contacto puede
  tener varias; cada una pertenece a un tenant y puede quedar marcada como inutilizable.
- **Ventana de atención**: el período durante el cual un canal permite que el negocio
  escriba libremente a un contacto, determinado por el último mensaje que ese contacto
  envió por ese canal. Aplica a WhatsApp; Telegram no la impone.
- **Pedido de envío**: la solicitud de hacerle llegar un contenido a un contacto. Lleva
  una clave de idempotencia, un canal preferido opcional y el propósito del mensaje.
- **Registro de entrega**: el rastro auditable del intento de envío, con estado,
  cantidad de intentos, motivo de fallo, canal y proveedor efectivamente usados, e
  identificador de mensaje del proveedor.
- **Mensaje**: la unidad del historial conversacional del contacto; un envío saliente
  produce uno.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un flujo conversacional en vivo obtiene confirmación de envío en menos de
  5 segundos en el 95% de los casos, tiempo suficiente para que una persona en una
  llamada no perciba una pausa incómoda.
- **SC-002**: Cero mensajes duplicados recibidos por un contacto en una prueba de 100
  pedidos repetidos y concurrentes con claves de idempotencia repetidas.
- **SC-003**: Cero mensajes entregados a contactos sin consentimiento vigente o
  bloqueados, verificable auditando el ledger de entregas contra el estado de los
  contactos.
- **SC-004**: El piloto del canal de Telegram puede ejecutarse de punta a punta sin
  ninguna dependencia de que un tercero tenga habilitada la integración de ese canal.
- **SC-005**: El 100% de los envíos, exitosos o fallidos, deja un registro auditable que
  permite reconstruir qué se le mandó a quién, cuándo, por qué canal y con qué
  resultado.
- **SC-006**: Agregar un canal de mensajería adicional no requiere modificar ningún
  flujo de negocio que solicite envíos.
- **SC-007**: Ningún envío queda indefinidamente en estado intermedio: todo pedido
  alcanza un estado terminal o reintentable dentro de su ventana de reintentos.

## Assumptions

- El solicitante del envío es siempre un componente interno del orquestador; esta
  feature no expone una capacidad de envío a agentes conversacionales externos ni a
  clientes públicos.
- El contenido del mensaje llega ya resuelto al pedido de envío; esta feature no genera
  contenido, no aplica plantillas de negocio ni traduce.
- El ledger de entregas existente y sus estados actuales son suficientes; no se
  introducen estados nuevos.
- La identidad de WhatsApp de un contacto es su número telefónico ya registrado, por lo
  que no requiere alta adicional; solo Telegram necesita una identidad nueva.
- Existe una cuenta de WhatsApp Business operativa. Como v1 solo escribe dentro de la
  ventana de 24 horas, no se requieren plantillas aprobadas por la plataforma. Si el
  negocio necesita más adelante iniciar conversaciones en frío por WhatsApp, será una
  extensión de esta feature, no un cambio de diseño.
- El orden de preferencia de canales por defecto prioriza el canal por el que el
  contacto se originó, y luego el resto de los canales habilitados.
- Los reintentos automáticos en segundo plano siguen siendo responsabilidad del
  mecanismo de reintentos ya existente; esta feature aporta el intento sincrónico y el
  mapeo correcto de estados.
- Se asume que existe al menos un tenant configurado y que todo pedido de envío llega
  con su tenant resuelto.
- El envío se considera exitoso cuando el proveedor lo acepta y devuelve un
  identificador de mensaje. La confirmación de entrega al dispositivo del destinatario
  —y su lectura— no forma parte de v1: no se procesan callbacks de estado del proveedor.
  El sistema afirma "el mensaje salió", nunca "el contacto lo recibió".
- La vinculación automática de la identidad de Telegram (FR-028) se apoya en el flujo de
  eventos entrantes que ya existe. **A verificar en la fase de planificación**: si el
  identificador de chat ya está disponible en la ingesta actual, la vinculación es un
  agregado menor; si no lo está, esta feature debe incorporar la captura de ese dato.
- Un contacto solo puede recibir mensajes por Telegram si previamente inició conversación
  con el bot. Esta es una restricción de la plataforma, no una decisión de diseño:
  implica que el negocio necesita un mecanismo para invitar al contacto a iniciarla
  (por ejemplo, que el vendedor le comparta el enlace del bot durante la llamada).

## Out of Scope

- La integración con el proveedor de voz y la invocación de esta capacidad desde una
  llamada en curso (spec posterior).
- La generación de links de pago (ya existe como capacidad separada; se consume, no se
  construye acá).
- El procesamiento conversacional de mensajes entrantes por Telegram o WhatsApp. De lo
  entrante, esta feature solo toma la vinculación de la identidad de canal al contacto
  (FR-028) y la marca de tiempo que determina la ventana de atención (FR-026).
- Los callbacks de estado de entrega del proveedor (entregado, leído) y su
  reconciliación asíncrona.
- El mecanismo por el que se invita a un contacto a iniciar conversación con el bot de
  Telegram (enlace de invitación, mensaje de la llamada, QR).
- La migración del flujo de entrega existente vía agente externo: convive, no se
  reemplaza en esta feature.
- Contenido, plantillas de negocio, personalización y traducción de mensajes.
