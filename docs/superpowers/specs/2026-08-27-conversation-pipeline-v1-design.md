# Conversation Pipeline V1 — diseño vertical del Agente A

Fecha: 2026-08-27

Estado: propuesta aprobada en chat; pendiente de revisión de esta especificación

Alcance: Agente A, Botpress, orquestador Next.js y estado comercial PostgreSQL

## 1. Objetivo

Reemplazar la acumulación de reglas frase-por-frase por un controlador conversacional con tres responsabilidades separadas:

1. un intérprete semántico clasifica el significado del turno completo;
2. un planner puro decide el siguiente movimiento comercial permitido;
3. un compositor redacta sólo la narrativa que haga falta y referencia hechos canónicos por identificador.

El recorrido mínimo soportado es:

```text
descubrimiento
→ selección de área o curso
→ asesoramiento
→ oferta de llamada una vez
→ llamada o continuación por chat
→ selección de plan
→ confirmación
→ link de pago
```

El cambio no concede autoridad nueva al modelo. Cursos, áreas, precios, planes, duración, modalidad, links, llamadas, opt-out, Stripe, Sheets y transiciones persistidas continúan bajo control determinístico y validación del backend.

## 2. Alcance y no objetivos

Incluido:

- contratos versionados `ConversationMoveV1`, `TurnPlanV1` y `ComposedNarrativeV1`;
- estado comercial por conversación con `call_preference` y `awaiting_reply`;
- intérprete semántico acotado a un modelo rápido;
- planner puro sin dependencias de red, base de datos ni Botpress;
- registro de facts canónicos con IDs estables;
- compositor opcional de narrativa;
- materialización determinística de bloques comerciales;
- fallback contextual por etapa;
- feature flag desactivado por defecto;
- pruebas verticales, replay, concurrencia, idempotencia y presupuesto de latencia.

Fuera de alcance:

- entrenar o ajustar un modelo;
- sumar regex o listas de sinónimos para reconocer nuevas frases;
- cambiar el catálogo, sus fixtures o sus datos comerciales;
- cambiar reglas de pago, Stripe, Sheets u opt-out;
- eliminar los caminos determinísticos seguros actuales para saludo, opt-out o acciones transaccionales;
- desplegar automáticamente a producción por el solo hecho de que los gates locales estén verdes.

## 3. Principios de autoridad

| Capa | Puede decidir | No puede decidir |
| --- | --- | --- |
| Intérprete | significado probable del mensaje y referencias literales | existencia del curso, código canónico, precio, plan autorizado, llamada, link o side effect |
| Planner | etapa siguiente, objetivo de respuesta, facts requeridos, acción de negocio permitida, pregunta pendiente | redactar hechos, resolver códigos que no estén en el contexto canónico ni ejecutar acciones |
| Compositor | tono, transición narrativa, explicación no factual y CTA autorizado | inventar o reescribir hechos comerciales, links o acciones |
| Fact registry | facts canónicos por ID desde Supabase | inferir intención o elegir el recorrido |
| Backend | resolver códigos, validar acción, persistir, materializar facts, egress e idempotencia | confiar en una afirmación del modelo como autorización |

La autoridad nunca se deriva de volver a leer la prosa con regex. El backend autoriza por IDs y códigos estructurados. El guard de egress existente se conserva como defensa final, no como fuente primaria de autorización.

## 4. Contratos normativos

Los contratos se implementarán una vez en el dominio compartible y tendrán adaptadores Zod espejados en Botpress y backend con pruebas de paridad. Todos los objetos serán estrictos: claves desconocidas fallan.

### 4.1 `ConversationMoveV1`

```ts
type ConversationMoveKindV1 =
  | 'greeting'
  | 'browse_catalog'
  | 'select_area'
  | 'select_course'
  | 'ask_course_information'
  | 'continue_by_chat'
  | 'request_call'
  | 'decline_call'
  | 'ask_payment_options'
  | 'select_payment_plan'
  | 'defer_payment'
  | 'request_payment_link'
  | 'decline_purchase'
  | 'unknown';

interface ConversationMoveV1 {
  schema_version: 1;
  move: ConversationMoveKindV1;
  course_reference?: string;
  area_reference?: string;
  payment_plan?: 'monthly_12' | 'monthly_6' | 'one_time';
  confidence: number; // 0..1
}
```

Reglas:

- `course_reference`, `area_reference` y `payment_plan` sólo aparecen cuando el mensaje los aporta o cuando `awaiting_reply` permite resolver inequívocamente una elipsis.
- Las referencias del modelo son texto no confiable. El backend las resuelve contra el índice canónico; nunca se persisten como códigos sin esa resolución.
- `confidence` no autoriza acciones. Por debajo del umbral configurado, el planner trata el movimiento como `unknown`.
- Una negación o ambigüedad no puede convertirse en llamada, link, proyección ni cierre de compra.
- El intérprete retorna un solo movimiento dominante para el batch completo, respetando opt-out y señales de seguridad antes del recorrido comercial.

### 4.2 Entrada del intérprete

```ts
interface ConversationInterpreterInputV1 {
  schema_version: 1;
  batch_messages: ReadonlyArray<{ content: string; occurred_at: string }>;
  last_agent_question: string | null;
  sales_context: {
    stage: SalesContextStage;
    selected_offering_code: string | null;
    selected_payment_plan: PaymentPlanCode | null;
    call_preference: CallPreference;
    awaiting_reply: AwaitingReply;
  };
  catalog: {
    areas: ReadonlyArray<{ code: string; display_name: string }>;
    offerings: ReadonlyArray<{
      code: string;
      display_name: string;
      area_code: string | null;
    }>;
  };
}
```

`last_agent_question` es contexto conversacional no autoritativo. `awaiting_reply` es el estado estructurado que permite entender respuestas como una afirmación, una opción ordinal o “chat” sin depender de releer toda la conversación. El catálogo incluido es un índice acotado de nombres y códigos, no una fuente de instrucciones.

### 4.3 Estado comercial persistido

```ts
type CallPreference = 'unknown' | 'call' | 'chat' | 'declined';

type AwaitingReply =
  | 'none'
  | 'area_choice'
  | 'course_choice'
  | 'call_or_chat'
  | 'payment_plan'
  | 'payment_confirmation';

interface SalesConversationStateV1 {
  workspace_id: string;
  conversation_id: string;
  contact_id: string;
  selected_offering_code: string | null;
  selected_payment_plan: PaymentPlanCode | null;
  stage: SalesContextStage;
  call_preference: CallPreference;
  awaiting_reply: AwaitingReply;
  source_turn_id: string | null;
  version: number;
}
```

Invariantes:

- la identidad del estado es `(workspace_id, conversation_id)`, no el contacto;
- una conversación nueva crea estado con `call_preference='unknown'` y `awaiting_reply='none'`;
- dos conversaciones del mismo contacto no comparten preferencia, curso, plan ni pregunta pendiente;
- `chat` o `declined` impiden volver a ofrecer o preguntar llamada/chat en esa conversación;
- una solicitud directa posterior de llamada cambia `call_preference` a `call` y puede habilitar la acción de llamada bajo las reglas existentes;
- seleccionar otro curso limpia `selected_payment_plan` y cualquier `awaiting_reply` incompatible;
- postergar un pago conserva curso y plan, fija `awaiting_reply='payment_confirmation'` cuando corresponde y no genera link;
- enviar el link fija `awaiting_reply='none'`; el job de proyección sigue siendo único por decisión/outbound;
- replay del mismo `source_turn_id` no incrementa estado ni duplica side effects.

### 4.4 `TurnPlanV1`

```ts
type ResponseGoalV1 =
  | 'greet_and_discover'
  | 'guide_area_choice'
  | 'guide_course_choice'
  | 'explain_selected_course'
  | 'continue_course_advice'
  | 'offer_call_or_chat'
  | 'acknowledge_chat_preference'
  | 'acknowledge_call_decline'
  | 'confirm_call_request'
  | 'present_payment_options'
  | 'confirm_selected_plan'
  | 'acknowledge_payment_deferral'
  | 'confirm_payment_link'
  | 'acknowledge_purchase_decline'
  | 'clarify_current_step'
  | 'catalog_temporarily_unavailable';

type AllowedBusinessActionV1 =
  | { type: 'none' }
  | { type: 'request_call_now'; reason: 'direct_request' | 'accepted_offer' }
  | {
      type: 'send_payment_link';
      offering_code: string;
      payment_plan: PaymentPlanCode;
    };

interface TurnPlanV1 {
  schema_version: 1;
  next_stage: SalesContextStage;
  response_goal: ResponseGoalV1;
  canonical_fact_requests: readonly string[];
  allowed_business_action: AllowedBusinessActionV1;
  missing_information: readonly string[];
  should_offer_call: boolean;
  next_call_preference: CallPreference;
  next_awaiting_reply: AwaitingReply;
  selected_offering_code: string | null;
  selected_payment_plan: PaymentPlanCode | null;
}
```

El planner es una función total y pura:

```ts
planConversationTurn(input: {
  move: ConversationMoveV1;
  sales_context: SalesConversationStateV1;
  business_context: CanonicalBusinessPlanningContextV1;
}): TurnPlanV1
```

No importa SDKs, Zod, SQL, HTTP, Botpress ni proveedores de modelos. Recibe DTOs y retorna DTOs.

Reglas centrales del planner:

- un curso o área sólo queda seleccionado tras resolución única contra códigos canónicos;
- curso desconocido o ambiguo produce aclaración sin acción;
- `continue_by_chat` con `awaiting_reply='call_or_chat'` fija preferencia `chat`; sin oferta previa no cambia autoridad y continúa o aclara según el contexto disponible;
- `decline_call` fija `declined`, continúa asesorando y no cierra la venta;
- una solicitud directa de llamada puede reemplazar `chat` o `declined` por `call`;
- `should_offer_call` sólo puede ser `true` una vez y únicamente con preferencia `unknown`, curso seleccionado y etapa apta;
- seleccionar plan sólo lo persiste y deja `payment_confirmation`; no envía link;
- `request_payment_link` requiere curso, plan, intención no negada y validación backend del batch actual;
- `defer_payment`, negaciones, baja confianza o `unknown` nunca producen acción;
- opt-out continúa teniendo precedencia fuera del pipeline semántico.

### 4.5 Facts canónicos

```ts
interface CanonicalFactV1 {
  id: string;
  kind:
    | 'area_name'
    | 'offering_name'
    | 'offering_description'
    | 'offering_duration'
    | 'offering_modality'
    | 'payment_plan_label'
    | 'payment_plan_price'
    | 'payment_link';
  source: 'business_snapshot' | 'payment_config';
  value: string;
  offering_code?: string;
  payment_plan?: PaymentPlanCode;
}
```

IDs estables siguen el formato interno versionado, por ejemplo `offering:<code>:duration:v1`; el cliente nunca depende de ese formato. El registro se construye desde el snapshot de Supabase ya reclamado. El link sólo se materializa después de la revalidación de pago existente y nunca se entrega al compositor antes de ser autorizado.

`canonical_fact_requests` es una solicitud del planner, no una autorización. El backend devuelve únicamente IDs existentes, consistentes con curso/plan y permitidos para el objetivo de respuesta.

El compositor no recibe `CanonicalFactV1.value`. Recibe sólo descriptores sin valor:

```ts
interface CanonicalFactRefV1 {
  id: string;
  kind: CanonicalFactV1['kind'];
  offering_code?: string;
  payment_plan?: PaymentPlanCode;
}
```

Así puede decidir dónde conviene incluir una clase de fact sin copiar, resumir ni alterar su contenido. El ensamblador conserva el mapa privado `fact_id → value` y es el único que renderiza el valor. Un link nunca cruza hacia el intérprete ni el compositor.

### 4.6 `ComposedNarrativeV1`

```ts
interface ComposedNarrativeV1 {
  schema_version: 1;
  narrative: {
    opening: string;
    explanation: string | null;
    next_question: string | null;
  };
  used_fact_ids: readonly string[];
}
```

Reglas:

- el compositor recibe el `TurnPlanV1`, `CanonicalFactRefV1[]` sin valores y contexto del cliente estrictamente necesario;
- `used_fact_ids` debe ser subconjunto de los facts entregados y de `canonical_fact_requests`;
- la narrativa puede conectar, explicar encaje con el objetivo declarado y formular la siguiente pregunta;
- precio, duración, modalidad, nombres/listados de cursos y links no se copian desde la narrativa: se insertan mediante bloques renderizados desde `used_fact_ids`;
- un fact ID desconocido, duplicado, no solicitado o incompatible hace fallar la composición de forma cerrada;
- el backend ensambla `opening + canonical blocks + explanation + next_question` y crea el manifiesto de egress a partir de los IDs, no de regex sobre la prosa;
- el guard global existente sigue validando el resultado final como defensa en profundidad;
- si el compositor falla o vence su timeout, se usa copy contextual determinístico basado en `response_goal` y los mismos facts autorizados.

## 5. Flujo de datos

```text
Telegram/Botpress event
  → ingest + batch
  → claim
      ↳ sales state por conversation_id
      ↳ último outbound acotado
      ↳ índice/snapshot canónico
      ↳ feature flag
  → precedencias determinísticas: opt-out, saludo seguro, transacción autorizada
  → intérprete rápido → ConversationMoveV1
  → resolver referencias contra catálogo canónico
  → planner puro → TurnPlanV1
  → fact registry → facts autorizados
  → compositor opcional → ComposedNarrativeV1
  → ensamblador canónico
  → policy + commit transaccional
      ↳ sales state
      ↳ decisión/outbound
      ↳ llamada o payment job idempotente si fue autorizado
  → egress manifest + guard
  → un outbound físico
  → delivery report
```

Botpress no persiste estado comercial propio. El claim del backend es la única vista autoritativa. El commit vuelve a derivar curso y plan desde el batch, estado y snapshot, y rechaza discrepancias.

## 6. Feature flag y compatibilidad

Flag único: `CONVERSATION_PIPELINE_V1_ENABLED`.

- default efectivo: `false` ante ausencia, vacío o valor inválido;
- lo carga el backend y lo proyecta en el claim como `features.conversation_pipeline_v1_enabled`;
- Botpress no mantiene una segunda bandera divergente;
- con `false`, el flujo actual permanece byte-for-byte en su selección de ruta;
- con `true`, sólo los turnos elegibles atraviesan intérprete/planner/compositor;
- saludo, opt-out y acciones transaccionales ya concluyentes conservan caminos determinísticos;
- la migración es backward-compatible: agrega estructura antes de que el flag se active;
- desactivar el flag revierte el comportamiento sin borrar estado ni datos.

No se activa en producción durante la implementación. El orden de promoción es:

1. PostgreSQL local aislado;
2. Botpress dev apuntando a backend local o preview con flag activo;
3. canary controlado sin mensajes a contactos ajenos;
4. revisión humana del diff y evidencia de gates;
5. autorización explícita para producción;
6. migración aditiva remota, Vercel y Botpress con el mismo SHA;
7. smoke supervisado único.

## 7. Migración PostgreSQL

La migración siguiente a `20260827010001_sales_context_states.sql` hará el estado realmente conversacional:

- agrega `call_preference` con `NOT NULL DEFAULT 'unknown'` y CHECK del enum;
- agrega `awaiting_reply` con `NOT NULL DEFAULT 'none'` y CHECK del enum;
- agrega `conversation_id` a eventos si aún no está;
- reemplaza la identidad `(workspace_id, contact_id)` por `(workspace_id, conversation_id)`;
- conserva índice por contacto para consulta/auditoría, sin usarlo como identidad;
- actualiza la FK de eventos y su unicidad a `(workspace_id, conversation_id, state_version)`;
- no elimina filas ni reescribe hechos existentes;
- los registros existentes conservan su `conversation_id` y reciben defaults seguros;
- RLS y grants existentes se mantienen;
- la migración debe pasar tres ciclos PostgreSQL aislados antes de cualquier aplicación remota.

El store cambia a `load(workspaceSlug, conversationId, contactId)` y verifica los tres valores. El upsert usa `(workspace_id, conversation_id)`. Una transición escribe el estado completo; `null` deja de significar implícitamente “conservar”, para poder limpiar el plan al cambiar curso. Replay se cerca por `source_turn_id` y versión dentro de la transacción serializable.

## 8. Fallback contextual

La caída del intérprete o compositor no usa una pregunta genérica. El fallback se deriva sólo de estado y facts disponibles:

| Contexto | Respuesta objetivo |
| --- | --- |
| curso seleccionado | preguntar qué aspecto del curso quiere conocer o continuar el asesoramiento |
| chat elegido/rechazo de llamada | continuar con el curso, sin volver a ofrecer llamada |
| plan seleccionado | preguntar si desea avanzar ahora, sin enviar link |
| esperando área/curso | repetir una selección acotada y canónica |
| catálogo no disponible | explicar indisponibilidad temporal y conservar el objetivo comercial |
| sin contexto suficiente | una aclaración neutral, sin acciones |

El fallback nunca crea llamada, link, proyección ni cambio irreversible.

## 9. Presupuesto de latencia y observabilidad

Métrica principal: desde recepción del evento hasta `submitted_to_botpress`, excluyendo tiempo deliberado de batching ya registrado por separado.

Objetivo: p95 menor a 8 segundos en canary.

Presupuesto por etapa:

| Etapa | p95 máximo |
| --- | ---: |
| ingest + claim + context | 1.50 s |
| intérprete rápido | 1.50 s |
| resolución + planner + facts | 0.25 s |
| compositor, sólo cuando aplica | 2.75 s |
| commit + egress | 1.00 s |
| submit + report | 1.00 s |
| margen | 0.00 s |
| total | 8.00 s |

Timeouts duros iniciales:

- intérprete: 1.8 s;
- compositor: 3.0 s;
- cero reintentos dentro del turno para ambos;
- al timeout, fallback contextual inmediato;
- el compositor se omite para saludo, opt-out, respuestas puramente transaccionales y copy canónico suficiente.

Logs estructurados, sin contenido del cliente:

- versión del pipeline y flag;
- move, confidence bucket y latencia del intérprete;
- response_goal, next_stage, awaiting_reply y si hubo acción permitida;
- cantidad de facts solicitados/usados;
- latencia/timeout del compositor;
- duración total y fast-path;
- IDs de trace/turn/decision/outbound existentes.

El gate de canary requiere muestra suficiente para calcular p95 y ningún turno por encima del timeout total del workflow por causa del pipeline.

## 10. Estrategia TDD por capas

Cada capa empieza con un test que falla por ausencia del contrato o comportamiento, se implementa lo mínimo y vuelve a verde antes de continuar.

### Capa A — contratos

- Zod acepta cada movimiento válido y rechaza campos extra o combinaciones inválidas;
- paridad Botpress/backend;
- compositor rechaza facts desconocidos o no solicitados;
- el feature flag ausente es falso.

### Capa B — estado y migración

- conversación nueva resetea preferencia y pregunta pendiente;
- dos conversaciones del mismo contacto permanecen aisladas;
- cambio de curso limpia plan;
- replay no incrementa versión dos veces;
- concurrencia serializa sin perder preferencia ni duplicar eventos;
- tres ciclos de migración PostgreSQL aislados.

### Capa C — planner puro

- elegir chat luego de oferta fija `chat` y no repregunta;
- “chat” sin oferta previa no concede acción ni inventa selección;
- rechazo de llamada fija `declined` y continúa asesoramiento;
- solicitud directa posterior cambia a `call` bajo autorización existente;
- selección de plan espera confirmación;
- postergación bloquea link y reanudación explícita lo habilita una vez;
- negaciones, baja confianza y ambigüedad cierran sin acciones;
- catálogo indisponible conserva objetivo sin inventar facts.

### Capa D — intérprete y compositor

- adaptadores validan JSON estricto y fallan cerrados;
- timeout del intérprete produce fallback contextual sin acción;
- timeout del compositor usa renderer canónico;
- corpus held-out de al menos 12 paráfrasis vive sólo en tests/evals, con IDs estables y expectativas de movimiento;
- ninguna paráfrasis held-out aparece en prompts ni código de producción;
- el prompt explica enums, precedencias y campos estructurados sin incluir frases de ejemplo usadas por los tests;
- una evaluación del modelo rápido se ejecuta en dev/canary, no en la suite unitaria hermética;
- la suite hermética inyecta un puerto de intérprete/compositor y prueba contratos reales, no respuestas de mocks como resultado final.

### Capa E — vertical completa

Prueba con PostgreSQL aislado:

```text
ingest → batch → claim → interpretación → planner → facts → composición
→ commit → state/event → egress → outbound → delivery/replay
```

Conversaciones obligatorias:

1. tecnología → área real → Redes Informáticas → información canónica;
2. oferta de llamada → elegir chat → continuación sin repregunta;
3. “chat” sin oferta previa;
4. rechazo de llamada → asesoramiento → solicitud posterior de llamada;
5. curso A + plan → cambio a curso B → plan limpio;
6. planes → selección → postergación → reanudación → un link;
7. negaciones y mensajes ambiguos → cero acciones;
8. timeout de intérprete;
9. timeout de compositor;
10. replay del mismo turno;
11. dos commits concurrentes;
12. exactamente un `payment_projection_job` y un outbound de link.

Los oráculos verifican intención, códigos canónicos, estado, actions, manifests, cantidad de outbounds/jobs y ausencia de invenciones. No dependen de igualdad textual salvo copy canónico renderizado.

## 11. Gates y promoción

Antes de revisar el diff:

- tests focales de contratos, planner, estado, intérprete, compositor y vertical;
- suite unitaria completa;
- integración PostgreSQL aislada;
- ambos typechecks;
- `adk check` y build Botpress;
- `git diff --check`;
- escaneo de secretos y artefactos generados;
- evidencia RED y GREEN por capa;
- conteo exacto de links, outbounds y proyecciones;
- reporte de latencia local y canary.

Después de gates verdes se presenta el diff y sus riesgos. No hay push, migración remota, Vercel, Botpress prod ni Telegram real sin revisión humana y autorización explícita de promoción.

## 12. Smoke supervisado

El smoke productivo, una vez autorizado, usa una sola conversación Telegram y el mínimo de mensajes necesario:

1. pedir información de Redes Informáticas;
2. elegir continuar por chat ante la oferta;
3. hacer una consulta de continuación.

Se traza evento → workflow → ingest → claim → intérprete → planner → facts/compositor → commit → egress → outbound → entrega visible. Debe demostrar:

- move semántico correcto;
- `call_preference='chat'` y `awaiting_reply` correcto;
- cero segunda oferta de llamada;
- hechos canónicos por IDs;
- mismo SHA en backend y Botpress;
- cero link y cero proyección, porque el smoke no compra.

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| dos llamadas de modelo exceden p95 | compositor opcional, modelos rápidos, timeouts sin retry y fallback determinístico |
| drift de contratos espejados | pruebas de paridad y schemas estrictos |
| migración cambia identidad histórica | migración aditiva con backfill por conversation_id y ciclos aislados |
| modelo inventa facts en narrativa | facts por ID, bloques canónicos, compositor sin links y guard final intacto |
| preferencia se filtra entre conversaciones | PK por conversation_id y carga con prueba de contact/workspace |
| replay duplica link/proyección | fencing existente más test vertical concurrente |
| flag diverge entre sistemas | backend como única fuente y claim como proyección |

## 14. Criterios de aceptación

El diseño queda implementado cuando:

- no se agrega ninguna regex ni lista de frases para resolver los nuevos movimientos;
- contratos, planner y persistencia cumplen las invariantes anteriores;
- las conversaciones obligatorias pasan end-to-end;
- 12 o más paráfrasis held-out se interpretan semánticamente sin estar copiadas a producción;
- exactamente un link y una proyección aparecen en el recorrido de compra;
- chat/rechazo no repregunta ni reofrece llamada;
- una solicitud directa posterior sí puede pedir llamada;
- facts y egress se autorizan por IDs/códigos, no por prosa;
- el flag permanece falso por defecto;
- p95 de canary es menor a 8 segundos;
- producción sólo se promueve después de revisión y autorización explícita;
- el smoke supervisado confirma el recorrido y el SHA común.
