# Plan de refactor de la capa conversacional de Bot A

Fecha de corte: 2026-08-24. Estado: diseño, no implementación. Este documento parte de `EVALUACION-BOT-A.md`; cuando la evidencia no alcanza, declara `[FALTA DATO]`.

El subagente arquitecto no materializó el documento luego de dos intentos acotados. El agente principal cerró este diseño sin modificar código de producción.

## 1. Resultado objetivo e invariantes

Bot A debe conservar la tubería durable actual —ingesta, claim exclusivo, decisión validada, commit, envío y reporte— y reemplazar la cadena creciente de parches conversacionales por cuatro piezas aditivas:

1. un resolvedor puro de catálogo;
2. una proyección explícita del estado comercial, integrada a los estados existentes;
3. un router comercial único compartido por el workflow y el runner;
4. un plan de respuesta estructurado con validación bloqueante de egreso.

Invariantes no negociables:

- ningún curso, precio, plan, cantidad, requisito, horario, modalidad, certificado, devolución, promesa o link sale sin una referencia verificable al snapshot autorizado del turno;
- Gemini y Groq interpretan intención y pueden redactar partes no factuales, pero nunca son autoridad comercial;
- una consulta por un curso inexistente se resuelve como caso general de catálogo, no mediante una regla para “Python”;
- llamada, pago y entrega conservan sus autoridades actuales; el nuevo estado comercial no las duplica;
- el workflow real y el runner local ejecutan el mismo router y la misma política de egreso;
- toda acción externa sigue siendo post-commit e idempotente.

## 2. Límite de arquitectura

### 2.1 Dependencias

```text
Botpress workflow / runner / HTTP adapters
                    |
                    v
       application: commercial router
          /          |           \
         v           v            v
catalog resolver  commercial   response-plan +
   (domain)       state view   egress policy
         \           |            /
          v          v           v
     ports: snapshot, state, payment, call, clock
                    |
                    v
       PostgreSQL / Botpress / provider adapters
```

El dominio recibe valores y devuelve decisiones; no importa PostgreSQL, Botpress, HTTP, Google Sheets, Stripe ni SDKs de modelos. Los adaptadores construyen el input desde `ClaimedTurn` y materializan las acciones ya autorizadas.

### 2.2 Fuente de verdad y compatibilidad

- `business_context` del claim continúa siendo el snapshot comercial consumible (`src/features/orchestration/domain/business-context.ts:88-113`).
- `allowed_actions` y decision-v4 siguen siendo la autorización del turno; no se crea otro protocolo de acciones.
- el endpoint de decisión sigue revalidando la forma y el dominio antes de aceptar (`src/app/api/agent/turns/[turn_id]/decision/route.ts:27-35`).
- el envío físico existente sigue siendo único en `processInboundTurn` (`botpress-agent/src/workflows/processInboundTurn.ts:678-705`).
- mientras Next.js y Botpress no compartan un paquete compilable, los schemas espejo deben conservar tests de paridad. No se permite que dos implementaciones distintas decidan negocio.

## 3. Pieza 1 — Resolvedor general de catálogo

### 3.1 Responsabilidad

Transformar la necesidad textual y el snapshot del turno en una resolución tipada. No redacta el mensaje, no persiste memoria y no decide pagos o llamadas.

Una ausencia solo puede afirmarse si el snapshot es completo y vigente. Si está truncado, ausente o inválido, el resolvedor devuelve error técnico fail-closed: nunca convierte “no lo veo” en “no existe”.

### 3.2 Contratos

```ts
type OfferingId = string;
type OfferingSku = string;
type SnapshotId = string;

interface AuthorizedCatalogSnapshot {
  snapshotId: SnapshotId;
  checksum: string;
  capturedAt: string;
  complete: boolean;
  offerings: readonly AuthorizedOffering[];
}

interface AuthorizedOffering {
  id: OfferingId;
  sku: OfferingSku;
  name: string;
  area: string | null;
  aliases: readonly string[];
  active: boolean;
}

interface CatalogRequest {
  rawText: string;
  rememberedOfferingId: OfferingId | null;
  rememberedArea: string | null;
}

type CatalogResolution =
  | {
      kind: 'exact';
      offering: AuthorizedOffering;
      match: 'canonical' | 'alias' | 'unique_typo';
    }
  | {
      kind: 'ambiguous';
      requestedText: string;
      candidates: readonly [AuthorizedOffering, AuthorizedOffering, ...AuthorizedOffering[]];
      clarification: 'choose_offering' | 'choose_area';
    }
  | {
      kind: 'not_found';
      requestedText: string;
      requestedArea: string | null;
      alternatives: readonly AuthorizedOffering[]; // máximo 3, todas del snapshot
      memoryCandidate: {
        type: 'study_goal';
        key: 'requested_training';
        value: string;
        sourceQuote: string;
      };
    };

type CatalogResolutionError =
  | { code: 'snapshot_unavailable' }
  | { code: 'snapshot_incomplete' }
  | { code: 'snapshot_invalid' };

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function resolveCatalogRequest(
  request: CatalogRequest,
  snapshot: AuthorizedCatalogSnapshot,
): Result<CatalogResolution, CatalogResolutionError>;
```

### 3.3 Reglas deterministas

1. Normalizar mayúsculas, tildes, espacios y puntuación, conservando el texto original como evidencia.
2. Resolver nombre canónico o alias único.
3. Admitir corrección de typo solo si produce un candidato único por encima de un umbral versionado y no compite con otra oferta. La aproximación nunca cambia un curso ya confirmado sin confirmación explícita.
4. Si quedan dos o más candidatos, devolver `ambiguous` y formular una sola pregunta; no elegir por el modelo.
5. Si no hay candidato y el snapshot es completo, devolver `not_found`.
6. Elegir entre cero y tres alternativas reales: primero área explícita; luego área recordada. Si no hay un área fundada, preguntar el área en vez de listar recomendaciones arbitrarias.
7. Guardar lo pedido como necesidad del cliente, nunca como `course_of_interest` canónico. Esto evita que una oferta inexistente contamine memoria, pago o Sheets.

### 3.4 Inserción y absorción

- agregar el núcleo puro junto al dominio conversacional y un adaptador Botpress que proyecte `ClaimedTurn.business_context` al snapshot;
- invocarlo antes de `matchCourseFactsFastPath` y `matchCourseDiscoveryFastPath`, hoy ordenados en `botpress-agent/src/workflows/processInboundTurn.ts:383-409`;
- absorber la resolución repartida de `transaction-fast-path.ts` y la inferencia de curso de `decision-policy.ts` en un único resultado tipado;
- conservar las plantillas útiles de descubrimiento, pero alimentadas solo por `CatalogResolution`;
- hacer que el runner importe el mismo router; eliminar su cadena duplicada (`scripts/run-agent-a-conversations.ts:325-356`).

No se cambia el catálogo comercial en esta pieza. `[FALTA DATO: snapshot remoto autoritativo, su vigencia y taxonomía definitiva de curso/diplomado/oferta.]`

## 4. Pieza 2 — Estado comercial explícito e integrado

### 4.1 Decisión de diseño

No se crea una quinta máquina persistente. Se agrega una **proyección comercial canónica** al `sales_context`, derivada dentro de la misma transacción/claim a partir de las decisiones, llamadas y pagos existentes. Cada subsistema conserva su autoridad:

- el ledger de llamadas determina si una llamada fue solicitada o está activa;
- el ledger/acción de pago determina plan y link emitido;
- la decisión commiteada determina oferta de llamada y preferencia por chat;
- la conversación/turno determina propiedad, opt-out y completitud.

Solo se persiste un dato comercial nuevo si el inventario de tablas demuestra que no existe un dueño actual. Esa modificación deberá ser aditiva y ocurrir en el store autoritativo de conversación, no en memoria libre ni en Botpress state.

### 4.2 Contratos

```ts
type CommercialPhase =
  | 'advising'
  | 'call_offered'
  | 'call_requested'
  | 'selling_by_chat'
  | 'plan_confirmed'
  | 'payment_link_sent';

interface CommercialStateView {
  phase: CommercialPhase;
  offeringId: OfferingId | null;
  offeringSku: OfferingSku | null;
  requestedNeed: string | null;
  selectedPlanCode: string | null;
  callId: string | null;
  paymentLinkId: string | null;
  optOut: boolean;
  version: number;
}

interface CommercialFacts {
  latestDecision: Readonly<unknown> | null;
  callProjection: { status: string; callId: string } | null;
  paymentProjection: { status: string; planCode: string; linkId: string } | null;
  rememberedOfferingId: OfferingId | null;
  contactPreference: 'call' | 'chat' | null;
  optOut: boolean;
}

function deriveCommercialState(facts: CommercialFacts): CommercialStateView;

type CommercialEvent =
  | { type: 'catalog_resolved'; offeringId: OfferingId }
  | { type: 'call_offered' }
  | { type: 'call_requested'; callId: string }
  | { type: 'chat_selected' }
  | { type: 'plan_confirmed'; planCode: string }
  | { type: 'payment_link_emitted'; linkId: string };

function reduceCommercialProjection(
  current: CommercialStateView,
  event: CommercialEvent,
): Result<CommercialStateView, { code: 'invalid_transition' }>;
```

### 4.3 Reglas de transición

- `optOut=true` domina y prohíbe nuevas acciones comerciales.
- `call_requested` solo puede derivarse de una reserva autoritativa; aceptar una llamada en prosa no basta.
- un rechazo de llamada lleva a `selling_by_chat` sin perder el curso confirmado.
- `plan_confirmed` exige curso exacto y plan autorizado para ese curso.
- `payment_link_sent` exige el ID del link materializado por backend; nunca una URL redactada por el modelo.
- un cambio inequívoco de curso invalida el plan previo y toda autorización de link asociada.
- replay del mismo evento conserva estado y versión; un evento viejo no puede retroceder el estado actual.

### 4.4 Inserción y bloqueo

El loader del claim debe proyectar `CommercialStateView` junto con `sales_context`; `processInboundTurn` deja de inferir la fase desde texto. El endpoint de decisión usa la fase y `allowed_actions` para revalidar transiciones.

`[FALTA DATO: inventario definitivo de tablas/columnas y precedencia temporal de los estados comercial, turno, llamada y pago. Sin este inventario no se autoriza una migración ni persistencia nueva.]`

## 5. Pieza 3 — Router comercial único

### 5.1 Responsabilidad

Seleccionar una capacidad de dominio y devolver una decisión determinista o un encargo acotado para el modelo. El router decide; el modelo no elige acciones ni fuente comercial.

### 5.2 Contratos

```ts
type CommercialCapability =
  | 'opt_out'
  | 'call'
  | 'payment'
  | 'identity'
  | 'catalog'
  | 'course_facts'
  | 'closure'
  | 'social'
  | 'advisory_model';

interface RouterInput {
  claimedTurn: ClaimedTurn;
  commercial: CommercialStateView;
  catalog: Result<CatalogResolution, CatalogResolutionError>;
  pricePolicy: PricePolicy;
}

type RouteResult =
  | {
      kind: 'deterministic';
      capability: Exclude<CommercialCapability, 'advisory_model'>;
      plan: ResponsePlan;
    }
  | {
      kind: 'model';
      capability: 'advisory_model';
      brief: ModelBrief;
      authorizedClaims: readonly AuthorizedClaim[];
    }
  | {
      kind: 'suppressed';
      reason: 'opt_out' | 'duplicate' | 'no_authorized_response';
    };

function routeCommercialTurn(input: RouterInput): RouteResult;
```

Precedencia mínima: opt-out/supresión → consentimiento y llamada directa → selección de pago → identidad → catálogo → hechos de oferta → cierre → saludo/social → asesoramiento con modelo. La lista exacta queda codificada y testeada una vez; no se replica en el workflow.

### 5.3 Integración

- `processInboundTurn.ts` reemplaza el bloque de matchers de `383-422` por una llamada a `routeCommercialTurn`.
- `scripts/run-agent-a-conversations.ts` usa esa misma función; no conserva un switch paralelo.
- `call-handoff-fast-path.ts`, `payment-choice.ts`, las partes deterministas de `transaction-fast-path.ts`, `greeting.ts` y `decision-policy.ts` se vuelven handlers internos o adaptadores del router. Se eliminan solo después de tests de paridad.
- `applyDecisionPolicy` continúa como defensa y normalización de decisiones, pero deja de descubrir curso o reordenar capacidades.
- el prompt versionado recibe `ModelBrief` y claims autorizados; no recibe autoridad para crear acciones.

### 5.4 Presupuesto de ejecución

- fast path: cero llamadas a modelo, objetivo p95 menor a 2,5 s end-to-end;
- turno con modelo: una inferencia normal, objetivo p95 menor a 8 s end-to-end;
- una segunda inferencia solo puede ser reparación de egreso, nunca una cascada de proveedores, y queda limitada por deadline total;
- pacing del evaluador se mide y reporta aparte;
- timeout o proveedor caído degrada a plantilla segura sin hechos no disponibles.

Los SLO son objetivos de diseño hasta medir canal y despliegue reales. `[FALTA DATO: SLO contractual de Telegram/WhatsApp y política de fallback productiva.]`

## 6. Pieza 4 — ResponsePlan, claims autorizados y egreso bloqueante

### 6.1 Principio

Validar prosa libre después de generarla no puede demostrar por sí solo que no haya una alucinación semántica. Por eso los hechos se transportan como referencias estructuradas y se renderizan desde el snapshot. El escaneo del texto final es una defensa adicional, no la única barrera.

### 6.2 Contratos

```ts
type PricePolicy =
  | { mode: 'never_in_chat' }
  | { mode: 'audited_snapshot_only' };

type AuthorizedClaim =
  | {
      id: string;
      kind: 'offering_exists';
      offeringId: OfferingId;
      source: SnapshotFieldRef;
    }
  | {
      id: string;
      kind: 'offering_field';
      offeringId: OfferingId;
      field: 'class_count' | 'modules' | 'requirements' | 'schedule' |
        'modality' | 'certificate' | 'refund' | 'access_duration';
      value: unknown;
      source: SnapshotFieldRef;
    }
  | {
      id: string;
      kind: 'price';
      offeringId: OfferingId;
      amount: number;
      currency: string;
      source: SnapshotFieldRef;
    }
  | {
      id: string;
      kind: 'payment_link';
      offeringId: OfferingId;
      planCode: string;
      linkId: string;
      exactUrl: string;
      source: PaymentResolverRef;
    };

interface SnapshotFieldRef {
  snapshotId: SnapshotId;
  checksum: string;
  offeringId: OfferingId;
  field: string;
}

interface PaymentResolverRef {
  resolver: 'payment_link';
  linkId: string;
  decisionId: string;
}

type ResponseSegment =
  | { kind: 'safe_copy'; text: string }
  | { kind: 'claim'; claimId: string; renderer: string }
  | { kind: 'question'; key: string };

interface ResponsePlan {
  schemaVersion: 1;
  capability: CommercialCapability;
  segments: readonly ResponseSegment[];
  authorizedClaims: readonly AuthorizedClaim[];
  businessAction: Decision['business_action'];
  nextState: Decision['next_state'];
  fallbackTemplate: string;
}

interface EgressEnvelope {
  text: string;
  plan: ResponsePlan;
  snapshotId: SnapshotId;
  snapshotChecksum: string;
  decisionId: string;
  outboundId: string;
  contentHash: string;
}

type EgressViolation =
  | { code: 'unknown_course'; evidence: string }
  | { code: 'unauthorized_claim'; evidence: string }
  | { code: 'unauthorized_price'; evidence: string }
  | { code: 'unauthorized_url'; evidence: string }
  | { code: 'prohibited_claim'; evidence: string }
  | { code: 'snapshot_mismatch'; evidence: string }
  | { code: 'content_hash_mismatch'; evidence: string };

function buildAuthorizedClaims(
  snapshot: AuthorizedCatalogSnapshot,
  resolution: CatalogResolution,
  pricePolicy: PricePolicy,
): readonly AuthorizedClaim[];

function renderResponsePlan(plan: ResponsePlan): string;

function validateEgress(
  envelope: EgressEnvelope,
  snapshot: AuthorizedCatalogSnapshot,
  pricePolicy: PricePolicy,
): Result<EgressEnvelope, readonly EgressViolation[]>;
```

### 6.3 Política de seguridad

- curso y campo factual se insertan mediante `claimId`; el modelo no escribe su valor;
- URLs se comparan por igualdad exacta con el link autorizado y materializado para oferta/plan/decisión; host o prefijo no bastan;
- `never_in_chat` rechaza toda cifra monetaria, incluso si existe en snapshot;
- `audited_snapshot_only` exige `price_assertable=true`, importe/moneda exactos y referencia al snapshot;
- una mención de certificados, clases en vivo semanales por curso, chat directo con profesores o envío de credenciales se bloquea salvo que la política futura la convierta en un claim explícito autorizado. Durante este plan son claims prohibidos;
- números, monedas, URLs, nombres de ofertas y patrones comerciales dentro de `safe_copy` disparan revisión; los hechos deben estar en segmentos `claim`;
- el validador usa detección estructurada y léxica para impedir bypass obvio; un juez LLM puede observar calidad, nunca aprobar un claim.

### 6.4 Reparación y fallback

1. validar el `ResponsePlan` antes del commit;
2. si falla una salida de modelo y queda presupuesto, permitir **una** regeneración con códigos de violación y los mismos claims;
3. si vuelve a fallar, o si el deadline no permite reparar, usar `fallbackTemplate` determinista o suprimir;
4. commitear texto, snapshot/checksum, plan y hash;
5. inmediatamente antes de `client.createMessage`, volver a validar hash, snapshot y URLs sobre el outbound commiteado;
6. cualquier violación post-commit bloquea el envío, registra métrica/auditoría sin PII excesiva y deja el efecto como fallo recuperable; nunca envía la prosa insegura.

La barrera final se inserta entre `committed.outbound.content` y `client.createMessage` (`botpress-agent/src/workflows/processInboundTurn.ts:678-705`). La validación semántica principal ocurre antes del commit para no persistir como respuesta aprobada un texto que jamás debe enviarse.

## 7. Observabilidad, seguridad y operación

### 7.1 Métricas mínimas

- `commercial_route_total{capability,outcome}`;
- `catalog_resolution_total{kind}` y `catalog_resolution_error_total{code}`;
- `model_inference_total{provider,outcome,attempt}`;
- `egress_validation_total{outcome,violation_code}`;
- `deterministic_fallback_total{reason}`;
- latencias por ingesta, batch, claim, router, modelo, validación, commit, envío y reporte;
- idempotency replay/conflict de llamada, pago, Sheet y outbound;
- snapshot ID/checksum, prompt version, router version y policy version, sin secretos ni PII.

### 7.2 Controles

- feature flags independientes: resolvedor, router, state projection y egress enforcement;
- modo sombra para resolvedor/validador: calcula y compara sin cambiar el mensaje; solo antes del enforcement;
- canary por canal/workspace/contactos sintéticos;
- kill switch que vuelve al camino actual únicamente si el validador final permanece activo;
- rollback de código sin rollback destructivo de migraciones; toda migración futura debe ser aditiva;
- logs y auditoría con IDs correlacionables, redacción de PII y sin prompts/secrets completos.

### 7.3 Riesgos abiertos

1. Un snapshot truncado en 40 ofertas impide afirmar ausencia con seguridad.
2. La paridad de schemas entre Next.js y Botpress puede derivar si no hay tests contractuales.
3. Una reparación con modelo aumenta p95; el fallback determinista debe ser el camino preferido ante deadline corto.
4. Detectar claims en prosa libre no es una prueba formal; por eso los valores factuales deben renderizarse desde referencias estructuradas.
5. La divergencia de fallback entre runner y workflow puede dar falsos verdes.
6. No se verificó el snapshot remoto ni la configuración efectiva del deploy.

## 8. Criterio de terminado del diseño técnico

La implementación de estas cuatro piezas estará técnicamente terminada cuando:

- workflow y runner llamen el mismo router, sin cadena duplicada;
- exacto, ambiguo, inexistente e indisponibilidad de snapshot tengan tests de dominio;
- el cambio de curso invalide plan/link anteriores y sobreviva replay/concurrencia;
- el estado comercial sea una proyección integrada con llamadas/pagos, no otra autoridad;
- todo hecho y URL del texto tenga una referencia autorizada o el egreso sea bloqueado;
- un fallo de modelo degrade en un solo ciclo a una respuesta determinista segura;
- la barrera se ejecute antes del commit y antes del único envío físico;
- feature flags, métricas, canary y rollback estén probados;
- la suite de regresión y la evaluación held-out cumplan los gates de `MATRIZ-TESTS-BOT-A.md`;
- ninguna decisión pendiente de precio, catálogo, PSP o política comercial haya sido inventada por ingeniería.

## 9. Consolidación: contradicciones y resolución

El consolidador delegado tampoco produjo patches después de dos intentos. Esta consolidación fue cerrada por el agente principal y mantiene los desacuerdos visibles en lugar de convertirlos en supuestos.

| Tensión encontrada | Evidencia | Resolución para el plan |
|---|---|---|
| El brief afirma cuatro máquinas de estado; la auditoría no verificó un inventario canónico completo. | `EVALUACION-BOT-A.md`, sección 6. | Tratar llamadas, pagos, turnos y conversación como autoridades existentes; G2 empieza por mapear ownership y no crea persistencia hasta probar el dueño. |
| El brief afirma fallback Gemini→Groq y credencial Gemini inválida; el código solo demuestra failover cruzado en el runner. | `EVALUACION-BOT-A.md`, sección 5. | No presentar el runner como producción. Mantener proveedor/fallback como pregunta y testear paridad sobre el transporte real antes del rollout. |
| La base local tiene 40 offerings activos y 9 academias; negocio menciona 35 diplomados. | `EVALUACION-BOT-A.md`, sección 3. | No equiparar offering con diplomado. G1 queda bloqueado para activación hasta recibir snapshot/taxonomía autoritativos; se puede desarrollar con fixtures explícitos. |
| El snapshot se limita a 40 ofertas, por lo que ausencia puede significar truncamiento. | `business-context.ts:180-203`; matriz H04. | `not_found` solo es válido con snapshot completo. En otro caso, error fail-closed y respuesta sin afirmar existencia o ausencia. |
| El brief describe subagentes secuenciales, pero SA-3 no debe ver el diseño de SA-2. | Misión y protocolo held-out. | SA-2 y SA-3 consumieron solo la evaluación y trabajaron de forma independiente; la dependencia converge recién en esta consolidación. |
| “Máximo dos intentos por bloqueo” puede confundirse con reintentos del modelo. | Regla operativa de la misión y sección 6.4. | Dos intentos rigen una tarea de implementación/diagnóstico antes de documentar bloqueo. En runtime hay una inferencia normal y como máximo una regeneración; luego fallback determinista. |
| El objetivo de una inferencia por turno compite con la reparación de egreso. | Secciones 5.4 y 6.4. | Fast path usa cero; camino normal usa una; la reparación excepcional solo ocurre dentro del deadline. Se mide por separado y nunca encadena proveedores sin límite. |
| El validador se pide post-modelo, pero el punto físico único está después del commit. | `EVALUACION-BOT-A.md`, sección 1. | Validar plan/texto antes de commit para no aprobar contenido inseguro y revalidar hash/snapshot/URL después del commit, justo antes del único envío. |
| Una lista de claims más un escáner de prosa no garantiza semántica completa. | Matriz `HARD-01`; sección 6.1. | Los valores comerciales se insertan desde claims estructurados; el escáner es defensa en profundidad y nunca autoridad aprobatoria. |

No hay contradicción entre mantener decision-v4/`allowed_actions` y agregar `ResponsePlan`: el plan describe contenido autorizado; decision-v4 y el backend siguen autorizando el efecto.

## 10. Plan ejecutable por olas

### Reglas comunes

- cada tarea empieza con test rojo o contrato verificable, cambia el mínimo necesario y termina con unitarias, integración relevante, typecheck y `git diff --check`;
- después de dos intentos con el mismo bloqueo, se conserva evidencia, se marca `[BLOQUEADO]` y se continúa solo con trabajo independiente; no se parchea por síntoma;
- ningún agente mezcla archivos de otro track activo; los puntos compartidos se integran en un checkpoint serial;
- modelo económico/rápido: inventario mecánico, fixtures, mirrors y tests directos; modelo fuerte: contratos de dominio, concurrencia, seguridad, review y contradicciones;
- gates C y D son obligatorios. B y A se informan aparte y no compensan seguridad/técnica;
- no se despliega, migra remoto ni cambia secretos sin aprobación separada.

### G1 — Catálogo autoritativo y resolvedor general

**Dependencias:** respuesta sobre snapshot/taxonomía y conducta ante truncamiento para activación. El desarrollo puro puede comenzar con fixtures versionados y marcados como no productivos.

**Track G1-A — Fuente y snapshot (serial respecto de la carga):**

- inventariar `offerings`, tipos, academias, aliases, vigencia, completitud y checksum en `src/features/orchestration/adapters/postgres-business-context.ts`, `src/features/orchestration/ports/business-context-store.ts` y `src/features/orchestration/domain/business-context.ts`;
- comparar seed local `supabase/seed/dev.sql` con el snapshot autoritativo sin sobrescribir ninguno;
- eliminar la ambigüedad “40 offerings = 35 diplomados” mediante taxonomía explícita;
- si hace falta migración, proponerla aditiva en un checkpoint separado después de decidir la fuente; no crearla por inferencia.

**Track G1-B — Dominio puro:**

- crear el resolvedor y tipos de la sección 3;
- cubrir canonical, alias, typo único, ambiguo, inexistente, cambio de curso y snapshot ausente/incompleto;
- devolver necesidad no ofrecida como `study_goal/requested_training`, no curso canónico.

**Archivos probables:** `src/features/orchestration/domain/business-context.ts`, un módulo nuevo de resolución en dominio, adaptador PostgreSQL de business context, mirror/proyección en `botpress-agent/src/schemas/contracts.ts`, tests unitarios de dominio e integración de business context.

**Ownership:** G1-A posee store/adaptador/fixtures; G1-B posee módulo puro/tests. Solo el integrador toca `business-context.ts` y `contracts.ts` al unirlos.

**Modelo sugerido:** rápido para inventario/fixtures; fuerte para la semántica exacta/ambiguo/no encontrado y review del fail-closed.

**Done verificable:** snapshot con ID/checksum/completitud; conteos explicados por tipo; resolución determinista en verde; caso 22 rojo ante la implementación vieja y verde ante el resolvedor; cero afirmación de ausencia con snapshot truncado.

**No hace:** no decide precios, becas, PSP, copy final, estado comercial ni rollout productivo.

### G2 — Router + estado y egreso seguro

G2 comienza cuando los contratos de G1 están congelados. Puede dividirse en dos tracks solo con ownership exclusivo; la integración del workflow es serial.

**Track G2-A — Estado y router:**

- probar ownership de estados y construir `CommercialStateView` como proyección;
- implementar `routeCommercialTurn` y convertir call/payment/identity/catalog/course facts/closure/social en capacidades;
- reutilizar `call-handoff-fast-path.ts`, `payment-choice.ts`, `transaction-fast-path.ts`, `greeting.ts` y `decision-policy.ts` como handlers hasta demostrar paridad;
- hacer que workflow y runner importen el mismo router;
- conservar decision-v4, `allowed_actions`, outbox y revalidación backend.

**Track G2-B — Claims y egreso:**

- implementar `AuthorizedClaim`, `ResponsePlan`, renderer y `validateEgress`;
- parametrizar `never_in_chat` versus `audited_snapshot_only`, sin fijar el modo productivo;
- exigir igualdad exacta de link autorizado y bloquear claims prohibidos;
- agregar una sola reparación como máximo y fallback determinista;
- instrumentar shadow mode, códigos de violación, hash y métricas sin PII.

**Archivos exclusivos G2-A:** nuevos módulos de router/state, tests de router, y adaptadores de proyección en orchestration. **Archivos exclusivos G2-B:** nuevos módulos response-plan/egress y sus tests. **Archivos compartidos —solo integrador serial:** `botpress-agent/src/workflows/processInboundTurn.ts`, `botpress-agent/src/schemas/contracts.ts`, `scripts/run-agent-a-conversations.ts`, `botpress-agent/src/prompts/agent-a-sales-bridge.ts` y tests de contrato/paridad.

**Modelo sugerido:** fuerte para transiciones, contratos y validador; rápido para mover matchers, agregar métricas y fixtures una vez congeladas las interfaces; review fuerte adversarial antes de merge.

**Done verificable:** workflow/runner sin orden duplicado; pruebas de replay/cambio de curso; claims factuales renderizados desde snapshot; URL exacta; barrera pre-commit y pre-envío; un modelo fallido nunca llega a `createMessage`; fast path p95 <2,5 s y modelo p95 <8 s en entorno de referencia, con etapas y pacing separados.

**No hace:** no cambia PSP, no confirma pagos sin webhook, no rediseña llamada B, no activa flags en producción ni elimina fast paths antes de paridad.

### G3 — Regresión endurecida 1–22

**Dependencias:** G2 integrado detrás de flags y caso 22 con oráculo estructurado.

**Tareas:**

- congelar hashes, IDs, prompt/router/policy versions y snapshot por turno;
- corregir el runner para cardinalidad 0/1, assertions por turno, allowlist exacta, PII durable y spans de latencia;
- ejecutar unitarias, integración, typechecks y luego 1–22 en una sola corrida consolidada;
- repetir paridad sobre el camino efectivo de Botpress, no solo el transporte local;
- clasificar todo fallo en C/D/B/A sin editar el corpus durante la corrida.

**Archivos probables:** `scripts/lib/agent-a-conversation-runner.ts`, `scripts/lib/agent-a-persistence-verifier.ts`, `scripts/run-agent-a-conversations.ts`, sus tests unitarios y los dos manifests de eval solo si la modificación fortalece el oráculo y queda versionada.

**Ownership:** un owner del runner; un evaluador independiente conserva los casos/oráculos. No se permite que quien corrige el bot reescriba el esperado.

**Modelo sugerido:** rápido para ejecución y clasificación mecánica; fuerte para cada fallo semántico y review de falsos verdes.

**Done verificable:** 22/22 en un único reporte, caso 22 sin disponibilidad/hechos/link/Sheet inventados, `HARD-01` a `HARD-12` en cero, evidencia DB run-scoped y paridad documentada.

**No hace:** no usa casos held-out, no optimiza copy para pasar frases exactas, no despliega y no tolera fallos C/D.

### G4 — Casos 23–50, held-out, canary y PR

**Dependencias:** G3 verde sin excepciones y respuestas de negocio necesarias para configurar políticas productivas.

**Tareas:**

- ejecutar los 50 efectivos y verificar composición 35+15;
- congelar implementación; luego revelar y correr el corpus held-out bajo custodia independiente;
- auditar PII, Sheets, links, llamadas A↔B, replay, opt-out, provider/fallback y latencia por etapa;
- correr shadow/canary sobre el canal acordado sin efectos reales no autorizados;
- revisar métricas, rollback y kill switch; producir evidencia y PR con alcance acotado.

**Archivos probables:** manifests/runner de evaluación, documentación de evidencia versionada permitida, configuración de feature flags existente y tests de integración de calls/payments/claim. Los secretos y `.env` quedan fuera del PR.

**Ownership:** custodio held-out distinto del implementador; reviewer de seguridad para Gate D; owner comercial para Gate A/B y decisiones pendientes; un integrador final del PR.

**Modelo sugerido:** rápido para ejecutar lotes y resumir métricas; fuerte para red-team, review de seguridad y veredicto final.

**Done verificable:** 50/50; held-out al menos 95% hasta que el dueño fije otro umbral; cero hard failures; gates C/D verdes; B/A reportados; rollback ensayado; PR revisado. Un verde local no se etiqueta como producción validada.

**No hace:** no revela held-out antes del freeze, no compensa seguridad con conversión, no cambia datos remotos sin aprobación, no activa 100% de tráfico directamente.

## 11. Secuencia de release propuesta

```text
fixtures/local -> unit/integration -> shadow -> canary sintético
-> 1–22 -> 50/50 -> freeze -> held-out -> canary canal -> rollout gradual
```

Cada avance exige artefactos del gate anterior. El rollback desactiva router/modelo nuevo, pero mantiene el egreso fail-closed; nunca vuelve a una salida que permita links o claims no autorizados.
