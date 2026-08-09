# Feature Specification: Contact Identity Foundation

**Feature Branch**: `001-contact-identity-foundation`

**Created**: 2026-06-23

**Status**: Draft

**Input**: Fundación de datos y servicio de identidad de contactos para el orquestador.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Resolver identidad de un contacto nuevo (Priority: P1)

Un número de teléfono desconocido inicia una conversación por WhatsApp. El sistema
debe crear su registro de contacto, capturar el canal de origen y registrar el opt-in
de comunicación, de modo que toda interacción futura sea trazable a esa misma identidad.

**Why this priority**: Sin identidad no hay ninguna otra operación posible. Es el
prerequisito absoluto de venta, soporte y voz.

**Independent Test**: Enviar un número nunca visto al endpoint de resolución y
verificar que existe exactamente un contacto creado con estado inicial, canal de
origen y fecha de opt-in registrados.

**Acceptance Scenarios**:

1. **Given** un número de teléfono que no existe en el sistema,
   **When** el orquestador invoca "resolver contacto",
   **Then** se crea un nuevo registro de contacto con estado `prospecto`, canal de
   origen registrado y marca temporal de opt-in; la operación queda en el audit log.

2. **Given** el mismo número de teléfono llamado por segunda vez,
   **When** el orquestador invoca "resolver contacto",
   **Then** se devuelve el contacto existente sin crear un duplicado; el audit log
   refleja el acceso pero no una creación nueva.

3. **Given** dos canales distintos (WhatsApp y voz) que usan el mismo número,
   **When** ambos invocan "resolver contacto",
   **Then** ambos obtienen el mismo registro de contacto con el canal de cada sesión
   registrado en la conversación correspondiente.

---

### User Story 2 — Registrar mensajes de una conversación (Priority: P1)

Durante una sesión activa, el orquestador debe persistir cada turno (mensaje entrante
del usuario y respuesta saliente del agente) asociado a la conversación y al contacto,
con su marca temporal y dirección.

**Why this priority**: El registro de mensajes es la fuente de verdad para soporte,
auditoría y construcción de memoria. Sin él, los turnos previos son invisibles.

**Independent Test**: Registrar tres mensajes alternados en una conversación y
recuperarlos en orden; verificar que cada uno tiene contacto, conversación, dirección
y timestamp correctos.

**Acceptance Scenarios**:

1. **Given** una conversación activa de un contacto existente,
   **When** el orquestador registra un mensaje entrante,
   **Then** el mensaje queda persistido con dirección `inbound`, contenido, timestamp
   y referencia a la conversación y al contacto; el audit log lo registra.

2. **Given** la misma conversación activa,
   **When** el orquestador registra la respuesta saliente del agente,
   **Then** el mensaje queda persistido con dirección `outbound` y los mismos
   vínculos; el audit log lo registra.

3. **Given** una solicitud de registro de mensaje sin conversación activa asociada,
   **When** el orquestador intenta registrar el mensaje,
   **Then** la operación falla con error descriptivo; ningún dato parcial queda
   persistido.

---

### User Story 3 — Recuperar memoria reciente (últimos turnos) (Priority: P2)

El orquestador necesita los últimos N turnos de una conversación en texto plano para
incluirlos como contexto inmediato en el prompt del agente, sin latencia adicional.

**Why this priority**: La memoria reciente es el contexto mínimo para que el agente
mantenga coherencia en una sesión activa.

**Independent Test**: Insertar 10 mensajes en una conversación y solicitar los últimos
5; verificar que se devuelven en orden cronológico y pertenecen al contacto correcto.

**Acceptance Scenarios**:

1. **Given** una conversación con múltiples mensajes registrados,
   **When** el orquestador solicita los últimos N turnos,
   **Then** se devuelven exactamente N mensajes en orden cronológico ascendente,
   todos pertenecientes al mismo contacto y conversación.

2. **Given** una conversación con menos de N mensajes,
   **When** el orquestador solicita los últimos N turnos,
   **Then** se devuelven todos los mensajes disponibles sin error.

---

### User Story 4 — Consultar memoria de largo plazo por similitud semántica (Priority: P2)

El orquestador puede buscar en el historial de mensajes de un contacto usando una
consulta en lenguaje natural, obteniendo los fragmentos más relevantes de
conversaciones pasadas, siempre limitados al propio contacto.

**Why this priority**: Permite al agente recordar información clave de sesiones
anteriores (intereses, objeciones, datos aportados) sin necesidad de cargar todo el
historial.

**Independent Test**: Crear embeddings para mensajes de dos contactos distintos y
ejecutar una búsqueda semántica; verificar que los resultados pertenecen únicamente
al contacto solicitado, aunque mensajes del otro contacto sean semánticamente más
cercanos a la query.

**Acceptance Scenarios**:

1. **Given** un contacto con múltiples mensajes indexados,
   **When** el orquestador realiza una búsqueda semántica para ese contacto,
   **Then** se devuelven los fragmentos más relevantes ordenados por similitud,
   todos pertenecientes exclusivamente a ese contacto.

2. **Given** dos contactos con mensajes similares en contenido,
   **When** el orquestador busca en la memoria del contacto A,
   **Then** ningún mensaje del contacto B aparece en los resultados, aunque sea
   semánticamente muy cercano a la query.

3. **Given** un contacto sin mensajes indexados,
   **When** el orquestador realiza una búsqueda semántica,
   **Then** se devuelve una lista vacía sin error.

---

### Edge Cases

- ¿Qué pasa si el número de teléfono tiene formato inválido (letras, longitud incorrecta)?
  → La operación de resolución rechaza el número con error de validación sin crear registro.
- ¿Qué pasa si se intenta registrar un mensaje con contenido vacío?
  → Se rechaza con error; no se persiste un mensaje en blanco.
- ¿Qué pasa si el servicio de embeddings no está disponible al registrar un mensaje?
  → El mensaje de texto se persiste de todas formas; el embedding se marca como pendiente
  y se reintenta de forma diferida. La indisponibilidad del vector store no bloquea el
  registro de mensajes.
- ¿Qué pasa si se solicita recuperar un contacto usando `contact_id` de otro contacto
  en la búsqueda semántica?
  → El sistema filtra por el `contact_id` del contexto de llamada; no es posible
  solicitar memoria de otro contacto a través de este servicio.
- ¿Qué pasa si dos solicitudes simultáneas intentan crear el mismo número de teléfono?
  → Una única constraint a nivel de base de datos garantiza que solo se crea un registro.
  La segunda solicitud recibe el contacto ya existente (upsert atómico). No se usan
  locks de aplicación; la garantía es estructural en la base de datos.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE crear un contacto único a partir de un número de teléfono
  normalizado, asignando estado inicial `prospecto`, canal de origen y timestamp de opt-in.
  La unicidad se garantiza mediante una constraint a nivel de base de datos y una operación
  de upsert atómica; dos solicitudes concurrentes para el mismo número NUNCA producen
  registros duplicados, sin necesidad de locks de aplicación.
- **FR-002**: El sistema DEBE devolver el contacto existente cuando el número ya está
  registrado, sin crear duplicados.
- **FR-003**: El sistema DEBE rechazar números de teléfono con formato inválido antes
  de cualquier escritura.
- **FR-004**: El sistema DEBE registrar conversaciones vinculadas a un contacto, con
  canal (`whatsapp` / `voice`), estado e intención actual.
- **FR-005**: El sistema DEBE persistir cada mensaje con dirección (`inbound` / `outbound`),
  contenido en texto plano, timestamp y referencias a contacto y conversación.
- **FR-006**: El sistema DEBE rechazar el registro de mensajes sin conversación activa
  asociada válida.
- **FR-007**: El sistema DEBE devolver los últimos N mensajes de una conversación en
  orden cronológico, limitados al contacto propietario.
- **FR-008**: El sistema DEBE generar y almacenar una representación vectorial de cada
  mensaje con valor semántico, vinculada al contacto propietario.
- **FR-009**: El sistema DEBE permitir búsqueda semántica en la memoria de un contacto,
  filtrando obligatoriamente por `contact_id`; una búsqueda sin este filtro DEBE ser
  rechazada por el sistema, no solo por convención.
- **FR-010**: El sistema DEBE registrar cada operación de escritura en el audit log
  de forma append-only e inmutable.
- **FR-011**: El sistema NUNCA debe exponer una operación de borrado físico sobre
  contactos, conversaciones, mensajes ni registros de auditoría.
- **FR-012**: Si el servicio de vectorización no está disponible, el mensaje de texto
  DEBE persistirse de todas formas y el embedding marcarse como pendiente.
- **FR-013**: El servicio DEBE emitir logs estructurados para cada operación relevante
  (resolución de contacto, registro de mensaje, búsqueda semántica, fallo de embedding)
  y exponer contadores incrementales de: contactos creados, mensajes registrados,
  búsquedas semánticas ejecutadas, embeddings en estado pendiente. Los contadores se
  exponen como entradas en el log estructurado (sin endpoint HTTP dedicado en este sprint).
- **FR-014**: El sistema DEBE permitir actualizar el estado (`open`, `closed`)
  y la intención actual (`current_intent`) de una conversación existente,
  vía `PATCH /api/conversations/:id`. La operación falla con `CONVERSATION_NOT_FOUND`
  si la conversación no existe.

### Key Entities

- **Contact**: Identidad unificada de una persona. Atributos clave: número de teléfono
  normalizado (identificador único), estado (`prospecto` / `cliente` / `inactivo`),
  canal de origen del primer contacto, timestamp de opt-in, datos opcionales de perfil
  (nombre, email para 2FA), soft-delete (`deleted_at`).

- **Conversation**: Sesión de interacción entre un contacto y el sistema. Atributos
  clave: referencia al contacto, canal (`whatsapp` / `voice`), estado (`open` /
  `closed`), intención actual (campo libre, actualizable), timestamps
  de inicio y último turno.

- **Message**: Turno individual dentro de una conversación. Atributos clave: referencia
  a conversación y contacto, dirección (`inbound` / `outbound`), contenido en texto
  plano, timestamp, metadatos opcionales (e.g., tipo de mensaje, identificador externo
  del canal).

- **MessageEmbedding**: Representación vectorial de un mensaje para memoria semántica.
  Atributos clave: referencia al mensaje y al contacto (desnormalizada para filtrado
  eficiente), vector de 1 536 dimensiones, estado de indexación (`pending` / `indexed`),
  timestamp de generación.

- **AuditLog**: Registro inmutable de eventos del sistema. Atributos clave: timestamp,
  actor (sistema u orquestador), acción realizada, entidad afectada con su ID, payload
  resumido. Sin soft-delete ni update; solo INSERT.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los números de teléfono válidos recibidos resultan en exactamente
  un registro de contacto (crear o recuperar), sin duplicados, en menos de 200 ms bajo
  carga normal.
- **SC-002**: El 100% de los mensajes registrados aparecen en el audit log; cero mensajes
  registrados sin traza de auditoría.
- **SC-003**: Una búsqueda semántica nunca devuelve resultados de un contacto distinto
  al solicitado, verificable en 100% de los casos de prueba con contactos mezclados.
- **SC-004**: La indisponibilidad del servicio de vectorización no impide el registro de
  mensajes: 0% de pérdida de mensajes de texto por fallo del vector store.
- **SC-005**: La recuperación de los últimos N turnos de una conversación activa se
  completa en menos de 100 ms para conversaciones de hasta 500 mensajes.
- **SC-006**: Ningún flujo de la API expone una operación de borrado físico sobre ninguna
  entidad del sistema, verificable por inspección de contratos.
- **SC-007**: Una búsqueda semántica sobre la memoria de un contacto se completa en
  menos de 2 segundos (p95) para contactos con hasta 1 000 mensajes indexados.
- **SC-008**: El servicio emite al menos un log estructurado por operación crítica y
  mantiene contadores actualizados de los 4 eventos clave; verificable por inspección
  de salida de logs en cualquier entorno de prueba.

---

## Clarifications

### Session 2026-06-23

- Q: ¿Cómo debe el sistema garantizar la unicidad del contacto bajo concurrencia? → A: Unique constraint en base de datos + upsert atómico (INSERT … ON CONFLICT). La BD garantiza exactamente un registro sin locks de aplicación, incluso con múltiples instancias del orquestador.
- Q: ¿Qué nivel de cumplimiento normativo sobre datos personales aplica? → A: Sin requisitos normativos formales en este sprint; compliance se define en un sprint posterior.
- Q: ¿Cuál es la latencia máxima aceptable para una búsqueda semántica sobre la memoria de un contacto? → A: ≤ 2 segundos p95. Operación bajo demanda, no en el camino crítico de cada mensaje.
- Q: ¿Qué nivel de observabilidad mínima debe proveer este servicio? → A: Logs estructurados + contadores de eventos clave (contactos creados, mensajes registrados, búsquedas ejecutadas, embeddings pendientes). Sin trazas distribuidas en este sprint.
- Q: ¿Cuántas dimensiones tendrá el vector de embedding de cada mensaje? → A: 1 536 dimensiones (compatible con OpenAI text-embedding-3-small / ada-002 y la mayoría de stores vectoriales).

---

## Assumptions

- El orquestador es el único consumidor de este servicio; no hay acceso directo de
  agentes conversacionales.
- La normalización del número de teléfono sigue el formato E.164 (e.g., `+5491112345678`).
- El opt-in se registra en el momento de la primera interacción entrante; no requiere
  confirmación explícita del usuario en este primer sprint.
- Los embeddings se generan de forma asíncrona o diferida; la latencia del vector store
  no bloquea el flujo principal de registro de mensajes.
- El tamaño máximo de un mensaje de texto es de 4 096 caracteres (límite de WhatsApp
  Business API).
- La búsqueda semántica devuelve como máximo los 10 fragmentos más relevantes por
  defecto; configurable por el orquestador.
- El audit log es de solo escritura desde la perspectiva del orquestador; su lectura
  está reservada para herramientas de administración fuera del scope de este sprint.
- Los estados del contacto (`prospecto`, `cliente`, `inactivo`) son definidos en este
  sprint pero la transición entre estados la gestiona un módulo posterior (CRM/ventas).
- Los requisitos normativos sobre datos personales (Ley 25.326, GDPR, LGPD) están fuera
  del scope de este sprint y se abordan en un sprint de compliance posterior. El modelo
  de datos no incluye campos de jurisdicción ni mecanismos de anonimización en esta versión.
- Los vectores de embedding tienen 1 536 dimensiones, compatibles con modelos de la
  familia OpenAI text-embedding-3-small / ada-002. Un cambio de modelo que altere las
  dimensiones requiere migración del esquema de la tabla de embeddings.
