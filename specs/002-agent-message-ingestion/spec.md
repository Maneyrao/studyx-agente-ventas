# Feature Specification: Agent Message Ingestion Endpoint

**Feature Branch**: `002-agent-message-ingestion`

**Created**: 2026-06-25

**Status**: Draft

**Input**: Construir el endpoint que recibe los mensajes desde el agente de texto, registra el intercambio y devuelve el contexto necesario para que el agente responda. Reemplaza el acceso directo del agente a la base de datos (principio de menor privilegio).

---

## Clarifications

### Session 2026-06-25

- Q: ¿Cómo se decide que un mensaje "alude a una interacción previa" y dispara la memoria de largo plazo? → A: Heurística determinista por marcadores lingüísticos (lista de patrones/keywords como "como te dije", "lo que hablamos", "mi cuenta", "me ofreciste", "el curso que…"). Sin costo ni latencia en triviales; ante ausencia de marcador no se dispara.
- Q: ¿Cómo se correlaciona la respuesta saliente (paso 2) con el turno entrante (paso 1)? → A: El paso 1 (ingesta) devuelve un identificador de turno explícito que el agente reenvía al registrar el outbound (paso 2). Confirma el modelo de dos operaciones/endpoints separados; un identificador ausente o desconocido produce error. Soporta turnos concurrentes del mismo contacto.
- Q: ¿Qué unidad cuenta el contador de interacciones del resumen y cuándo se reinicia? → A: Cuenta turnos completados (par inbound+outbound). Dispara la regeneración al alcanzar el umbral (~10 turnos) y reinicia el contador SOLO tras una regeneración exitosa; ante fallo conserva el contador y reintenta en el siguiente cruce.
- Q: ¿Cómo se reconcilia "trivial no regenera resumen" (FR-006) con el contador por turno cuando un saludo cruza el umbral? → A: Todo turno incrementa el contador, pero la regeneración solo se evalúa/ejecuta en turnos NO triviales; si el umbral se cruza en un turno trivial, el disparo se difiere al próximo turno sustantivo. Así un saludo nunca causa regeneración (SC-001) sin perder turnos del conteo.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Procesar mensaje entrante y devolver contexto consolidado (Priority: P1)

Un prospecto envía un mensaje por WhatsApp. El agente de texto (Botpress), que no tiene
acceso a la base de datos, reenvía ese mensaje al endpoint del orquestador con el número
de teléfono y el contenido. El endpoint identifica (o crea) el contacto, registra el
mensaje entrante y devuelve un paquete de contexto consolidado —estado del contacto,
resumen vigente y últimos turnos— para que el agente genere su respuesta.

**Why this priority**: Es el reemplazo directo del acceso a base de datos del agente.
Sin este punto de entrada, el agente no puede obtener contexto sin credenciales, y nada
del resto de la feature tiene sentido. Es el MVP.

**Independent Test**: Enviar un mensaje entrante con un número y contenido al endpoint y
verificar que (a) el contacto queda resuelto, (b) el mensaje entrante queda registrado y
auditado, y (c) la respuesta contiene estado del contacto, resumen y turnos recientes,
sin ninguna credencial de base de datos.

**Acceptance Scenarios**:

1. **Given** un número de teléfono nuevo y un mensaje de contenido válido,
   **When** el agente invoca el endpoint de ingesta,
   **Then** se crea el contacto, se registra el mensaje como `inbound`, y se devuelve un
   contexto consolidado con el estado inicial del contacto, resumen vacío y lista de
   turnos recientes; ambas operaciones quedan en el audit log.

2. **Given** un contacto existente con conversación activa,
   **When** el agente invoca el endpoint con un nuevo mensaje entrante,
   **Then** el mensaje se asocia a la conversación activa, se registra como `inbound`, y
   el contexto devuelto incluye los últimos turnos en orden cronológico.

3. **Given** un mensaje entrante,
   **When** el endpoint construye la respuesta,
   **Then** el cuerpo devuelto NO contiene credenciales de base de datos, cadenas de
   conexión, ni identificadores internos de infraestructura: solo datos de negocio
   necesarios para la generación de respuesta.

---

### User Story 2 — Registrar la respuesta saliente generada (Priority: P1)

Una vez que el agente genera su respuesta usando el contexto recibido, debe registrarla
de vuelta en el orquestador para que todo el intercambio quede auditado y disponible como
memoria para turnos futuros.

**Why this priority**: El criterio de aceptación "todo mensaje entrante y saliente queda
registrado y auditado" no se cumple sin este paso. Sin registrar la salida, la
conversación queda incompleta y la memoria futura corrupta.

**Independent Test**: Tras procesar un mensaje entrante, registrar la respuesta saliente
correlacionada y verificar que queda persistida como `outbound`, vinculada a la misma
conversación y contacto, y auditada.

**Acceptance Scenarios**:

1. **Given** un mensaje entrante ya procesado en una conversación activa,
   **When** el agente registra la respuesta saliente correlacionada,
   **Then** el mensaje queda persistido con dirección `outbound`, vinculado a la misma
   conversación y contacto, con timestamp; el audit log lo registra.

2. **Given** una solicitud de registro de respuesta saliente que no corresponde a ninguna
   conversación activa del contacto,
   **When** el agente intenta registrarla,
   **Then** la operación falla con un error descriptivo y ningún dato parcial queda
   persistido.

3. **Given** el registro exitoso de una respuesta saliente,
   **When** se completa el turno (entrante + saliente),
   **Then** el contador de interacciones del contacto se incrementa para alimentar la
   lógica de actualización de resumen.

---

### User Story 3 — Recuperar memoria de largo plazo solo ante referencias al pasado (Priority: P2)

Cuando el mensaje del prospecto alude a una interacción previa ("como te dije antes",
"el curso que vimos", "mi cuenta", "lo que me ofreciste"), el endpoint enriquece el
contexto con fragmentos relevantes de la memoria de largo plazo del contacto. Cuando el
mensaje es trivial (un saludo, un "ok", un "gracias"), NO se ejecuta ninguna búsqueda
semántica.

**Why this priority**: Es la optimización de costo y latencia central de la feature. La
recuperación vectorial es cara; dispararla en cada turno desperdicia recursos y agrega
latencia innecesaria. Es valiosa pero el sistema funciona sin ella (degrada a solo
memoria reciente).

**Independent Test**: Enviar un mensaje trivial (saludo) y verificar que NO se ejecuta
ninguna consulta a la memoria de largo plazo; luego enviar un mensaje que referencia algo
previo y verificar que SÍ se ejecuta y los fragmentos devueltos pertenecen únicamente al
contacto solicitado.

**Acceptance Scenarios**:

1. **Given** un mensaje entrante trivial (p. ej. "hola", "buenas", "ok"),
   **When** el endpoint procesa el mensaje,
   **Then** el contexto se devuelve sin fragmentos de memoria de largo plazo y NO se
   ejecuta ninguna búsqueda vectorial.

2. **Given** un mensaje entrante que alude explícitamente a una interacción previa,
   **When** el endpoint procesa el mensaje,
   **Then** se ejecuta una búsqueda semántica filtrada por el `contact_id` del
   solicitante y el contexto incluye los fragmentos más relevantes de ese contacto.

3. **Given** un mensaje que alude al pasado de un contacto,
   **When** existen mensajes de otros contactos semánticamente más cercanos a la consulta,
   **Then** los resultados devueltos pertenecen exclusivamente al contacto solicitante;
   ningún fragmento de otro contacto se filtra.

4. **Given** que la búsqueda de memoria de largo plazo falla o no está disponible,
   **When** el endpoint procesa un mensaje que aludía al pasado,
   **Then** el contexto se devuelve igualmente con la memoria reciente disponible y una
   indicación de que la memoria de largo plazo no pudo recuperarse; la generación de
   respuesta no se bloquea.

---

### User Story 4 — Mantener el resumen del contacto por umbral de interacciones (Priority: P2)

El endpoint mantiene un resumen evolutivo de cada contacto (intereses, objeciones, datos
aportados, estado comercial) que se regenera solo cuando el contador de interacciones
cruza un umbral configurado, no en cada mensaje.

**Why this priority**: El resumen da contexto compacto al agente sin cargar todo el
historial. Regenerarlo en cada turno es costoso; hacerlo por umbral equilibra frescura y
costo. El sistema funciona con el resumen previo entre umbrales.

**Independent Test**: Procesar mensajes por debajo del umbral y verificar que el resumen
no se regenera; cruzar el umbral y verificar que se dispara exactamente una regeneración
y el contexto subsiguiente incluye el resumen actualizado.

**Acceptance Scenarios**:

1. **Given** un contacto con un contador de interacciones por debajo del umbral,
   **When** se procesa un nuevo turno,
   **Then** el resumen NO se regenera y el contexto devuelve el resumen vigente.

2. **Given** un contacto cuyo contador de interacciones cruza el umbral configurado,
   **When** se completa el turno,
   **Then** se dispara exactamente una regeneración del resumen y los turnos siguientes
   reciben el resumen actualizado.

3. **Given** que la regeneración del resumen falla,
   **When** se procesa el turno que cruzó el umbral,
   **Then** el resumen previo se conserva, el turno se completa sin error visible para el
   agente, y la regeneración se reintenta en el siguiente cruce de umbral.

---

### Edge Cases

- **Mensaje vacío o solo espacios**: el endpoint rechaza el contenido vacío con un error
  de validación; no se registra ni crea contacto a partir de contenido inválido.
- **Número de teléfono mal formado**: se rechaza con error de validación antes de tocar
  la base de datos.
- **Contacto en estado opt-out / bloqueado**: el mensaje entrante se registra para
  auditoría, pero el contexto devuelto incluye `blocked: true` (derivado de `status =
  inactivo`) para que el agente no continúe la conversación comercial.
- **Solicitud sin autenticación interna válida**: se rechaza con `401` sin procesar el
  contenido (consistente con el control de acceso del orquestador).
- **Registro de respuesta saliente sin un entrante previo correlacionado**: se rechaza con
  error descriptivo; no se persiste mensaje huérfano.
- **Mensajes concurrentes del mismo contacto**: la resolución de contacto y el registro de
  mensajes no deben crear duplicados ni perder turnos bajo concurrencia.
- **Detección de referencia ambigua**: ante duda razonable sobre si el mensaje alude al
  pasado, el sistema prioriza no disparar la búsqueda vectorial (favorece el costo bajo);
  los falsos negativos degradan a memoria reciente, los falsos positivos son tolerables
  pero a minimizar.
- **Umbral cruzado durante fallo de generación de resumen**: el contador no se reinicia
  hasta una regeneración exitosa, garantizando reintento.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El endpoint MUST recibir un mensaje entrante que contenga, como mínimo, el
  número de teléfono del prospecto y el contenido textual del mensaje.
- **FR-002**: El endpoint MUST identificar el contacto correspondiente al número o crearlo
  si no existe, reutilizando el servicio de resolución de identidad existente, sin crear
  duplicados.
- **FR-003**: El endpoint MUST registrar el mensaje entrante como `inbound`, vinculado al
  contacto y a su conversación activa, antes de construir el contexto de respuesta.
- **FR-004**: El endpoint MUST devolver un contexto consolidado que incluya, como mínimo:
  un **identificador de turno** correlacionable, el estado actual del contacto, una señal
  booleana `blocked` (verdadera cuando el contacto está `inactivo`/bloqueado), el resumen
  vigente del contacto y los últimos N turnos de la conversación en orden cronológico.
- **FR-005**: El endpoint MUST recuperar memoria de largo plazo (búsqueda semántica) ÚNICA
  y exclusivamente cuando el mensaje entrante alude a una interacción previa **y no es
  trivial** (la trivialidad tiene precedencia, ver FR-006); NUNCA en cada turno. La decisión
  se toma mediante una **heurística determinista** que detecta marcadores
  lingüísticos de referencia al pasado (lista mantenible de patrones/keywords, p. ej. "como
  te dije", "lo que hablamos", "mi cuenta", "me ofreciste", "el curso que…"); en ausencia de
  marcador NO se dispara la búsqueda. La heurística no realiza llamadas a modelos ni embebe
  el mensaje, de modo que los turnos triviales no incurren en costo ni latencia adicional.
- **FR-006**: El endpoint MUST NOT ejecutar ninguna búsqueda vectorial ni regeneración de
  resumen para mensajes triviales (saludos, confirmaciones cortas, agradecimientos). En la
  ruta de ingesta la **trivialidad tiene precedencia**: se evalúa `isTrivial(content)`
  ANTES que la heurística de referencia, como short-circuit; si el mensaje es trivial NUNCA
  se ejecuta la búsqueda vectorial, aunque contenga un marcador de referencia al pasado. El
  contador de turnos SÍ se incrementa en turnos triviales, pero la regeneración solo se
  evalúa/ejecuta en turnos NO triviales; si el umbral se cruza en un turno trivial, el
  disparo se difiere al próximo turno sustantivo (ver FR-009).
- **FR-007**: El endpoint MUST proveer una operación separada para registrar la respuesta
  saliente generada por el agente como `outbound`, correlacionada al turno entrante mediante
  el **identificador de turno** devuelto en la ingesta y vinculada a la misma conversación y
  contacto. Un identificador de turno ausente o desconocido MUST rechazarse con error sin
  persistir mensaje huérfano.
- **FR-008**: El endpoint MUST mantener un resumen del contacto que se regenera por umbral
  de **turnos completados** (par inbound+outbound) configurable (por defecto ~10), no en
  cada mensaje.
- **FR-009**: El endpoint MUST contabilizar los turnos completados del contacto e
  incrementar el contador una vez por turno (al registrarse el outbound). La trivialidad del
  turno se juzga sobre el **contenido del mensaje inbound** de ese turno. Al alcanzar el
  umbral, en un turno NO trivial, MUST disparar la regeneración y reiniciar el contador SOLO
  tras una regeneración exitosa; ante fallo MUST conservar el contador y el resumen previo,
  garantizando el reintento en el siguiente cruce (cruce determinista y reintentable). Si el
  umbral se alcanza en un turno trivial (inbound trivial), el disparo se difiere hasta el
  próximo turno sustantivo.
- **FR-010**: El contexto devuelto MUST NOT contener credenciales de base de datos,
  cadenas de conexión ni secretos de infraestructura; el agente no recibe ningún medio de
  acceso directo a datos.
- **FR-011**: Toda búsqueda en memoria de largo plazo MUST estar filtrada por el
  `contact_id` del propietario; una consulta sin ese filtro es una violación crítica
  (Aislamiento de Memoria, Principio VI).
- **FR-012**: Toda operación de escritura (registro de mensaje entrante y saliente,
  actualización de resumen) MUST quedar registrada en el audit log append-only.
- **FR-013**: El endpoint MUST validar la autenticación interna del llamante antes de
  procesar cualquier contenido; las solicitudes sin credencial interna válida se rechazan
  con `401`.
- **FR-014**: El endpoint MUST validar la forma del mensaje entrante (número con formato
  válido, contenido no vacío) y rechazar entradas inválidas con un error descriptivo sin
  persistir datos parciales.
- **FR-015**: Ante fallo en la recuperación de memoria de largo plazo o en la regeneración
  del resumen, el endpoint MUST degradar de forma controlada devolviendo el contexto
  disponible (memoria reciente y resumen previo) sin bloquear la generación de respuesta.
- **FR-016**: El endpoint MUST operar con un rol de base de datos sin permiso de `DELETE`
  sobre tablas críticas; ninguna operación de esta feature elimina datos físicamente
  (Nunca Eliminar Datos, Principio IV).

### Key Entities *(include if feature involves data)*

- **Contacto**: identidad del prospecto anclada al número de teléfono; tiene un estado
  comercial y un contador de interacciones. (Reutilizado de la feature de identidad.)
- **Conversación**: sesión activa que agrupa los turnos de un contacto por canal.
  (Reutilizada.)
- **Mensaje**: turno individual con dirección (`inbound`/`outbound`), contenido y
  timestamp, vinculado a contacto y conversación. (Reutilizado.)
- **Resumen de contacto**: texto compacto y evolutivo que describe intereses, objeciones,
  datos aportados y estado comercial; se versiona/actualiza por umbral.
- **Contador de interacciones**: número de turnos completados (par inbound+outbound) desde
  la última regeneración exitosa; determina cuándo cruzar el umbral. Solo se reinicia tras
  regenerar el resumen con éxito.
- **Señal de referencia al pasado**: clasificación booleana derivada del contenido del
  mensaje entrante que decide si se dispara la recuperación de memoria de largo plazo.
- **Turno**: unidad de correlación entre el mensaje entrante y su respuesta saliente,
  identificada por el identificador de turno devuelto en la ingesta.
- **Paquete de contexto**: estructura de salida consolidada (identificador de turno + estado
  del contacto + resumen + turnos recientes + memoria de largo plazo opcional) que consume el
  agente.
- **Registro de auditoría**: entrada append-only e inmutable por cada operación de
  escritura. (Reutilizado.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los mensajes entrantes triviales (saludos, confirmaciones) se
  procesan con cero búsquedas de memoria de largo plazo; y un turno cuyo inbound es trivial
  nunca dispara una regeneración de resumen en ese turno (se difiere al próximo turno
  sustantivo, ver FR-009).
- **SC-002**: El 100% de los mensajes, entrantes y salientes, queda registrado y reflejado
  en el audit log; no existen turnos sin auditar.
- **SC-003**: El agente nunca recibe credenciales de base de datos: en el 100% de las
  respuestas, el contexto devuelto está libre de secretos de acceso a datos.
- **SC-004**: El resumen del contacto se regenera exactamente una vez por cada cruce del
  umbral de interacciones, nunca en cada mensaje.
- **SC-005**: El 100% de las búsquedas de memoria de largo plazo incluye filtro por
  `contact_id`; cero resultados pertenecientes a otro contacto.
- **SC-006**: Un mensaje trivial obtiene su contexto consolidado en una fracción del tiempo
  de un mensaje que requiere memoria de largo plazo (la ruta trivial evita por completo el
  costo de la búsqueda semántica y la generación de resumen).
- **SC-007**: Ante una falla simulada de la memoria de largo plazo, el 100% de los turnos
  sigue devolviendo un contexto utilizable (memoria reciente + resumen previo) sin error
  para el agente.

## Assumptions

- **Reutilización de la feature 001**: la resolución de contacto, el registro de mensajes,
  la recuperación de memoria reciente y la búsqueda semántica ya existen como primitivos de
  `001-contact-identity-foundation`; esta feature los orquesta detrás de un único punto de
  entrada, sin reimplementarlos.
- **Flujo de dos operaciones separadas**: el agente realiza dos interacciones por turno —
  (1) enviar el mensaje entrante y recibir el contexto junto con un **identificador de
  turno**, (2) registrar la respuesta saliente una vez generada, reenviando ese
  identificador para la correlación (ver Clarifications y FR-007). La generación de la
  respuesta ocurre en el agente, no en el endpoint.
- **Umbral de resumen por defecto**: la regeneración del resumen se dispara cada cierto
  número de turnos completados (valor configurable; por defecto del orden de ~10
  interacciones), ajustable sin cambio de contrato.
- **Detección de referencia al pasado**: heurística determinista por marcadores lingüísticos
  (ver Clarifications y FR-005). La lista de patrones es mantenible y ampliable sin cambio de
  contrato; ante ausencia de marcador (ambigüedad) se favorece NO disparar la búsqueda
  vectorial.
- **Cantidad de turnos recientes (N)**: el contexto incluye una ventana fija de los últimos
  turnos (valor configurable, p. ej. los últimos 5–10), heredando el criterio de la
  feature 001.
- **Autenticación interna**: el llamante (agente) se autentica mediante el mecanismo de
  clave interna del orquestador ya existente; esta feature no introduce un esquema de auth
  nuevo.
- **Canal inicial**: el alcance de esta feature es el agente de texto (WhatsApp/Botpress);
  la integración del canal de voz reutilizará el mismo endpoint pero queda fuera del MVP.

## Dependencies

- Feature `001-contact-identity-foundation` desplegada (servicios de identidad, mensajes y
  memoria; roles de base de datos separados; middleware de autenticación interna; audit
  log).
- Constitución v1.0.0 — esta feature DEBE satisfacer los Principios I (Fuente Única de
  Verdad), II (Menor Privilegio), IV (Nunca Eliminar Datos), VI (Aislamiento de Memoria) y
  VII (Scope Acotado).
