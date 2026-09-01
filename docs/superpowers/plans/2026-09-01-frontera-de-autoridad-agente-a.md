# Frontera de autoridad del Agente A — Plan de ejecución

> **Para ejecutores agénticos:** REQUIRED SUB-SKILL: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan `- [ ]` para seguimiento.

**Goal:** Que DeepSeek decida la conversación completa —interpretación, etapa, movimiento, tono y mensajes— mientras el backend valida y ejecuta consecuencias sin redactar nunca, y que ningún turno entrante termine en silencio.

**Architecture:** Se conserva el orden actual de la ruta autoritativa (contexto → propuesta del modelo → planner → validación → commit → egress), que ya es el correcto para la Opción 1. Se le agregan tres cosas: autorización de afirmaciones de estado por cita contra estado durable en vez de por detección léxica; un contrato de rechazo estructurado con una única reparación; y un piso técnico que garantiza un turno visible. La ruta duplicada (compositor Gemini + `modelUnavailableFallback`) se retira recién en la Fase 3.

**Tech Stack:** TypeScript, Next.js 16.3.3, Vitest, PostgreSQL 17 (Supabase), Botpress ADK, Zod, DeepSeek `deepseek-v4-flash`.

**Spec:** `docs/architecture/2026-09-01-frontera-de-autoridad-agente-a.md` (se vendoriza en T0.1; fuente publicada: https://claude.ai/code/artifact/281637c5-78d7-41f3-87b5-a554bc116383)

**Branch:** `codex/agent-a-chanl-evals` · **Base:** `404bc8c`

---

## Desviaciones aprobadas y sus condiciones

D1, D2 y D3 aprobadas con condiciones; P11 agregado. Lo que sigue es el registro de qué se aprobó y qué obliga cada condición.

**D1 · N3 y `human_review_requested` se adelantan de la Fase 2 a la Fase 0.** La especificación ubicaba la escalera N1–N3 en la Fase 2, pero el gate de la Fase 0 pide varianza de casos ≤ ±1 y hoy la mayor fuente de varianza es el silencio de `decision.service.ts:788`. N2 y `TurnRejectionV1` **siguen** en la Fase 2.

Condiciones que impone:

- **N3 cuenta como fallo conversacional, no como éxito.** Un turno que entrega el piso técnico no contestó al cliente; que ahora sea visible lo vuelve medible, no correcto. Afecta el denominador de todas las métricas de la Fase 0 (T0.10) y agrega una fila al gate.
- **Se mide `technical_fallback_count`, motivo, reparación y revisión** por turno y por corrida.
- **Hay que demostrar cómo consulta un operador las revisiones pendientes** (T0.9).
- **No existe bandeja monitoreada** — verificado: no hay UI de operador; `src/app/api` sólo expone `agent/*`, `cron/*`, `webhooks/*`, `conversations`, `contacts`, `messages`, `memory/*`, `health`, `ready` y un `diagnostics` cerrado con `CRON_SECRET`. Por lo tanto rige el texto alternativo, sin «del equipo»: **«Sigo teniendo un inconveniente para procesar tu consulta. Dejé registrada la conversación para revisión.»** No promete atención ni respuesta humana, sólo el registro, que es lo único que efectivamente ocurre.

**D2 · El recorte de contexto de §03 ya está implementado casi entero.** `buildAgentAContextV1` (`agent-a-context.ts:316-390`) ya emite `catalog.payment_plans: []` sin offering resuelto, ya recorta `catalog.selected_offering`, y ya expone `capabilities` con `may_send_payment_link`, `may_offer_call` y `may_request_call_now` condicionados por estado. Lo único que falta de §03 es `intake_missing`.

Condición: **el rollback no construye una ruta sin recorte que hoy no existe.** Los flags gobiernan únicamente lo nuevo — `AGENT_A_CONTEXT_SCOPING` sobre `intake_missing`, `AGENT_A_REPAIR_ENABLED` sobre la reparación. El recorte ya desplegado no tiene flag: su rollback es `git revert`.

**D3 · Corrección obligatoria, y el barrido es más grande de lo que yo había planificado.** Empezó como una línea (`agent-a-brain.ts:879`) y son **once sitios** en cinco categorías: prompt canónico, dos prompts más (`agent-a.json`, `agent-a-sales-bridge.ts`), un fallback del backend, dos fixtures de evaluación y cinco tests. La lista completa está en T0.4, que dejó de ser una edición y pasó a ser un barrido con test de repositorio.

El intake permitido es exclusivamente **nombre, apellido, correo, teléfono, curso y plan**. La pregunta la redacta DeepSeek desde `intake_missing`; un fallback transitorio sólo puede mencionar esos campos.

**P11 · Promesas de entrega y de seguimiento.** Se elimina el envío de PDF, todo link o archivo de programa no disponible, «te escribo en {{PLAZO_CONCRETO}}» y cualquier promesa de seguimiento futuro no ejecutable. Único reemplazo autorizado: **«Puedo contarte el contenido del programa por acá.»** Una entrega documental futura exigirá una capacidad estructurada propia, no una instrucción de prompt.

---

## Dos tensiones que el plan resuelve explícitamente

Ninguna requiere decisión tuya; las dejo escritas porque un ejecutor que no las vea va a tropezar.

**`intake_missing` llega en la Fase 1, y D3 lo nombra como el mecanismo de la pregunta.** Entre la Fase 0 y la Fase 1 el modelo no tiene el campo. No es un bloqueo: tu propia condición contempla el hueco («si queda un fallback transitorio, sólo puede mencionar esos campos»), y en ese intervalo el objetivo `request_contact_details` cae en `safeContextualOpening` → «Para dejarlo listo necesito unos datos tuyos», que no nombra ningún campo prohibido. El modelo ya ve la conversación completa y el `commercial_state`; `intake_missing` lo vuelve preciso, no posible.

**Retell está fuera de alcance por §01 y contiene ciudad y ZIP. Queda intacto.** `botpress-agent/retell/retell-agent-a-chat-llm.json` es un prompt del Agente A para otro canal, excluido por la especificación. Resolución aprobada: **no se toca**. El guard de T0.4 lo excluye explícitamente y con motivo escrito, para que la exclusión sea una decisión visible y no un olvido. Cuando Retell entre en alcance, se saca esa línea del guard y el archivo aparece solo en la lista de fallos.

---

## Global Constraints

Copiadas literalmente de la especificación y del contrato comercial congelado. Los requisitos de cada tarea las incluyen implícitamente.

- **Los únicos datos son: nombre; apellido; correo; teléfono; curso canónico; plan canónico.** No pedir ni agregar más campos. **Ciudad, estado y código postal no existen** en ningún prompt, fallback, fixture, contrato ni test (D3). La pregunta la redacta DeepSeek desde `intake_missing`; un fallback transitorio sólo puede mencionar esos seis campos.
- **P11 · Nada de entregas ni de plazos.** Prohibido prometer PDF, archivo o link de programa, «te escribo en {{PLAZO}}», o cualquier seguimiento futuro que el agente no pueda ejecutar. Único reemplazo autorizado: «Puedo contarte el contenido del programa por acá.» Una entrega documental exige una capacidad estructurada, no una instrucción de prompt.
- **N3 es un fallo conversacional, no un éxito.** Un turno que entrega el piso técnico cuenta como fallo en toda métrica y todo gate (D1).
- **El silencio intencional por opt-out está permitido y se conserva.** A7 cubre el silencio *técnico*, no la decisión de callar. Un contacto que pidió no ser contactado, o que está bloqueado, no recibe N3 ni ningún otro texto: el piso técnico nunca puede usarse para responderle. Las métricas cuentan «silencios no deliberados»; un opt-out no entra en ese numerador.
- **El rollback se conserva hasta que el held-out y el canary estén verdes.** Ningún flag se retira, ninguna ruta duplicada se borra y el prompt v1 no se saca del repositorio antes de eso.
- **No se abren decisiones arquitectónicas nuevas durante la ejecución.** Un hallazgo que exigiría una se reporta y frena la tarea; no se resuelve sobre la marcha.
- `payment_reported ≠ payment_verified`. «Ya pagué» es afirmación del cliente, jamás verificación.
- No afirmar «pago confirmado», «inscripción confirmada», «preinscripción cargada» ni «acceso habilitado» sin evidencia durable.
- Sheets se proyecta únicamente con los seis datos completos **y** `payment_reported`. El envío del link no la habilita. Replays generan una sola fila.
- Supabase es fuente de verdad; Sheets es proyección.
- Tres planes canónicos exclusivamente: `monthly_12`, `monthly_6`, `one_time`. Máximo dos ofertas de llamada por conversación.
- Ninguna URL escrita por el modelo. El link canónico lo inserta el backend.
- **A3 · El backend no redacta.** Único texto visible que el backend puede emitir: N3 y el aviso de derivación (§07). Nada más.
- **A8 · Sin respuestas comerciales por regex.** Ninguna frase de un caso de evaluación entra al prompt ni a una expresión regular.
- **R1 · Todo cambio de conducta entra detrás de flag, apagado por defecto.** Nada se enciende en el mismo commit que lo introduce.
- **R3 · Migraciones aditivas.** Ninguna columna se borra; un rollback de código no requiere rollback de esquema.
- No PII en memoria vectorial, logs ni prompts.
- No ejecutar Sheets, Stripe, Telegram, WhatsApp/Meta, Retell ni Botpress Cloud reales. No push ni deploy.
- No involucrar al Agente B. No romper los eventos que lo incorporan después.
- Multi-mensaje queda contemplado en el contrato (1–3) pero **no** se implementa en la entrega.
- **Si una misma causa bloquea tres intentos, frenar y reportar evidencia.**

**Gates que corren en cada commit** (ninguna tarea se da por cerrada sin los siete verdes):

```bash
npm run lint                       # eslint --max-warnings=0
npm run typecheck                  # raíz
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
npm run test:unit
npm run test:integration           # requiere cluster PG: scripts/pg-native-up.sh <port> --seed
git diff --stat                    # revisión del alcance del diff
```

---

## File Structure

### Archivos nuevos

| Archivo | Responsabilidad |
|---|---|
| `docs/architecture/2026-09-01-frontera-de-autoridad-agente-a.md` | La especificación aprobada, versionada en el repo |
| `src/features/conversation/domain/state-fact-registry.ts` | Vocabulario de los cuatro hechos de estado/proceso y su materialización desde la transición planificada |
| `src/features/conversation/domain/technical-fallback.ts` | N3 y el aviso de derivación. Único lugar del backend con copy visible |
| `src/features/conversation/domain/turn-rejection.ts` | `TurnRejectionV1`: códigos, sujetos y alternativas autorizadas (Fase 2) |
| `src/features/conversation/adapters/turn-rejection-schema.ts` | Espejo Zod lado `src` |
| `botpress-agent/src/schemas/turn-rejection.ts` | Espejo Zod lado `botpress-agent` |
| `scripts/lib/rejected-draft-sink.ts` | Sumidero único de borradores rechazados: local, gitignored, PII redactada (Fase 2) |
| `supabase/migrations/20260902010001_agent_a_human_review_and_fallback_counter.sql` | Única migración del plan |
| `docs/operaciones/revisiones-pendientes.md` | Cómo consulta un operador las derivaciones, y qué **no** hace el sistema |
| `tests/unit/conversation/state-fact-registry.test.ts` | |
| `tests/unit/conversation/technical-fallback.test.ts` | |
| `tests/unit/contracts/intake-fields-repo-guard.test.ts` | Guard de repositorio: ciudad/ZIP no vuelven por ningún archivo (D3) |
| `tests/unit/prompts/canonical-prompt-v2.test.ts` | El prompt no puede ordenar lo que V5 bloquea (P1–P11) |
| `tests/integration/conversation/commit-before-outbound.test.ts` | O1–O3 con fallo inyectado |
| `tests/integration/conversation/human-review-derivation.test.ts` | P·1 end-to-end |
| `tests/integration/observability/pending-human-reviews.test.ts` | La consulta del operador (D1) |
| `tests/unit/conversation/turn-rejection.test.ts` | Fase 2 |

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `docs/prompts/studyx-agent-a-canonical.md` | Fuente del prompt: P1–P11 |
| `scripts/generate-agent-a-prompt-module.mjs` | `expectedSha256`, `lineCount`, versión `v2` |
| `botpress-agent/src/lib/conversation/agent-a-brain.ts:879` | Eliminar el copy con ciudad/estado/ZIP |
| `botpress-agent/src/prompts/agent-a.json:99` | Barrido D3 |
| `botpress-agent/src/prompts/agent-a-sales-bridge.ts:208` | Barrido D3 |
| `botpress-agent/evals/personas/studyx-happy-path-cases-v6.json` | Barrido D3, 5 turnos |
| `botpress-agent/evals/personas/studyx-client-personas-v6.json` | Barrido D3, 3 turnos |
| `src/features/observability/adapters/probes.ts` | `pending_human_reviews` (D1) |
| `src/features/conversation/domain/operational-promise-guard.ts` | El detector léxico deja de decidir validez |
| `src/features/conversation/domain/conversation-pipeline.ts` | `human_review_requested_at`, `consecutive_technical_fallbacks` en estado y transición |
| `src/features/conversation/adapters/conversation-pipeline-schema.ts` | Espejo |
| `botpress-agent/src/schemas/conversation-pipeline.ts` | Espejo |
| `src/features/conversation/adapters/postgres-conversation-state-store.ts` | Persistir las dos columnas nuevas |
| `src/features/conversation/domain/canonical-response-assembler.ts:166,365` | `LAST_RESORT_OPENING` → N3 |
| `src/lib/services/decision.service.ts:755-796, 1080-1130` | N3 en el sitio de supresión; O2; derivación P·1 |
| `botpress-agent/src/lib/conversation/agent-a-context.ts` | `capabilities.intake_missing` (Fase 1) |
| `botpress-agent/src/schemas/agent-a-brain.ts` | `stage_hypothesis`, `repair_of` (Fase 2) |
| `src/features/conversation/adapters/agent-a-brain-schema.ts` | Espejo (Fase 2) |
| `botpress-agent/src/workflows/processInboundTurn.ts` | Lazo de reparación (Fase 2); retiro de ruta (Fase 3) |
| `scripts/lib/agent-a-conversation-runner.ts` | Métricas por turno (T0.9) |
| `.gitignore` | `artifacts/rejected-drafts/` |

---

# FASE 0 — Cimientos

Sin cambio de arquitectura. Elimina las contradicciones que hoy hacen que el prompt ordene exactamente lo que el guard borra, y pone el piso que garantiza un turno visible.

---

### Task 0.1: Vendorizar la especificación

**Files:**
- Create: `docs/architecture/2026-09-01-frontera-de-autoridad-agente-a.md`
- Test: `tests/unit/contracts/architecture-spec-present.test.ts`

**Interfaces:**
- Produces: la ruta que todas las tareas siguientes citan como fuente normativa.

**Por qué esto lleva test y no un `grep`.** Las diecisiete tareas siguientes citan reglas por identificador —A9, V5, O1–O3, P6, P11— y un plan que cita una regla que el documento no define es un plan que no se puede ejecutar. El test es el que garantiza que la fuente normativa está completa antes de que alguien construya contra ella.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/unit/contracts/architecture-spec-present.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const specPath = fileURLToPath(new URL(
  '../../../docs/architecture/2026-09-01-frontera-de-autoridad-agente-a.md',
  import.meta.url,
));

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : '';

/** Cada regla que el plan de ejecución cita por identificador. */
const AUTHORITY = ['A1','A2','A3','A4','A5','A6','A7','A8','A9'];
const VALIDATION = ['V1','V2','V3','V4','V5','V6','V7','V8'];
const ORDERING = ['O1','O2','O3'];
const PROMPT = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11'];
const DECISIONS = ['Q1','Q2','Q3','Q4','Q5','Q6'];
const ROLLBACK = ['R1','R2','R3','R4','R5','R6'];
const SECTIONS = ['01','02','03','04','05','05b','06','07','08','09','10','11','12','13','14'];

describe('la especificación aprobada vive en el repositorio', () => {
  it('el documento existe', () => {
    expect(existsSync(specPath)).toBe(true);
  });

  it.each([
    ['autoridad', AUTHORITY], ['validación', VALIDATION], ['orden', ORDERING],
    ['prompt', PROMPT], ['decisiones', DECISIONS], ['rollback', ROLLBACK],
  ])('define todas las reglas de %s', (_group, rules) => {
    const missing = rules.filter((rule) => !new RegExp(`\\b${rule}\\b`, 'u').test(spec));
    expect(missing).toEqual([]);
  });

  it('define las quince secciones', () => {
    const missing = SECTIONS.filter((s) => !new RegExp(`§\\s?${s}\\b`, 'u').test(spec));
    expect(missing).toEqual([]);
  });

  it('fija el contrato de seis datos y ninguno más', () => {
    for (const field of ['nombre', 'apellido', 'correo', 'teléfono', 'curso', 'plan']) {
      expect(spec.toLowerCase()).toContain(field);
    }
    // El propio documento normativo no puede nombrar los campos prohibidos
    // ni siquiera para prohibirlos: el guard de T0.4 lo excluye del barrido,
    // así que una mención acá no se detectaría en ningún otro lado.
    expect(spec).not.toMatch(/\bzip\b|c[oó]digo postal/iu);
  });

  it('fija los textos aprobados palabra por palabra', () => {
    expect(spec).toContain(
      'Registré tus datos. Cuando informes el pago, el equipo lo revisará '
      + 'y, si está acreditado, gestionará tu acceso.',
    );
    expect(spec).toContain(
      'Recibí tu mensaje, pero tuve una demora para procesarlo. '
      + 'Probá nuevamente en unos segundos.',
    );
    expect(spec).toContain(
      'Sigo teniendo un inconveniente para procesar tu consulta. '
      + 'Dejé registrada la conversación para revisión.',
    );
    expect(spec).toContain('Puedo contarte el contenido del programa por acá.');
  });

  it('distingue pago informado de pago verificado', () => {
    expect(spec).toMatch(/payment_reported\s*≠\s*payment_verified/u);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

```bash
npx vitest run --config vitest.config.mts tests/unit/contracts/architecture-spec-present.test.ts
```
Esperado: FAIL en los ocho tests — el documento no existe.

- [ ] **Step 3: Escribir la especificación**

Convertir el artefacto aprobado a markdown conservando la numeración (§01–§14, incluida §05b) y todas las reglas: A1–A9, V1–V8, O1–O3, P1–**P11**, Q1–Q6, R1–**R6**. Incluye las decisiones de D1, D2, D3 y las cinco correcciones. El markdown es la fuente citable; el artefacto queda como versión legible.

- [ ] **Step 4: Correr y ver el verde**

```bash
npx vitest run --config vitest.config.mts tests/unit/contracts/architecture-spec-present.test.ts
npm run lint && npm run typecheck && npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/2026-09-01-frontera-de-autoridad-agente-a.md \
        docs/superpowers/plans/2026-09-01-frontera-de-autoridad-agente-a.md \
        tests/unit/contracts/architecture-spec-present.test.ts
git commit -m "docs(agent-a): la frontera de autoridad entra al repositorio"
```

---

### Task 0.2: Vocabulario de hechos de estado y proceso

Es el corazón de §05b y precede a todo lo demás: sin él, V5 no tiene contra qué autorizar y el prompt v2 no puede escribir la frase P6.

**Files:**
- Create: `src/features/conversation/domain/state-fact-registry.ts`
- Test: `tests/unit/conversation/state-fact-registry.test.ts`

**Interfaces:**
- Consumes: `ContactIntakeV1`, `CONTACT_INTAKE_FIELDS_V1`, `missingContactIntakeFieldsV1` de `src/features/conversation/domain/conversation-planner.ts`.
- Produces:
```ts
export type StateFactIdV1 =
  | 'state:intake_recorded:v1'
  | 'state:payment_reported:v1'
  | 'process:human_verification:v1'
  | 'process:access_after_verification:v1';

export const STATE_FACT_IDS_V1: readonly StateFactIdV1[];

export interface StateFactSubjectV1 {
  readonly intake: ContactIntakeV1 | undefined;
  /** La transición que este turno VA a escribir, no la ya persistida (O1). */
  readonly planned_payment_reported: boolean;
}

export function materializeStateFactsV1(
  subject: StateFactSubjectV1,
): ReadonlySet<StateFactIdV1>;
```

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it } from 'vitest';
import {
  STATE_FACT_IDS_V1,
  materializeStateFactsV1,
} from '@/features/conversation/domain/state-fact-registry';

const completeIntake = {
  nombre: 'Ana', apellido: 'Pérez',
  correo: 'ana@example.com', telefono: '+15551234567',
} as const;

describe('registro de hechos de estado y proceso', () => {
  it('expone exactamente los cuatro hechos decididos, ni uno más', () => {
    expect([...STATE_FACT_IDS_V1].sort()).toEqual([
      'process:access_after_verification:v1',
      'process:human_verification:v1',
      'state:intake_recorded:v1',
      'state:payment_reported:v1',
    ]);
  });

  it('materializa intake_recorded sólo con los cuatro campos presentes', () => {
    expect(materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: false,
    })).toContain('state:intake_recorded:v1');
  });

  it('no materializa intake_recorded si falta un campo', () => {
    for (const field of ['nombre', 'apellido', 'correo', 'telefono'] as const) {
      const partial = { ...completeIntake, [field]: '   ' };
      expect(materializeStateFactsV1({
        intake: partial, planned_payment_reported: false,
      })).not.toContain('state:intake_recorded:v1');
    }
  });

  it('no materializa intake_recorded sin intake', () => {
    expect(materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    })).not.toContain('state:intake_recorded:v1');
  });

  // O1: el hecho se materializa desde la transición que el turno va a escribir.
  // Es lo que permite responder "Registré tus datos" en el mismo turno en que
  // el cliente los entrega, en vez de en el siguiente.
  it('materializa payment_reported desde la transición planificada', () => {
    expect(materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: true,
    })).toContain('state:payment_reported:v1');
    expect(materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: false,
    })).not.toContain('state:payment_reported:v1');
  });

  it('los hechos de proceso son canónicos y siempre están disponibles', () => {
    // Describen lo que hace el equipo humano, no lo que hizo el agente:
    // no hay estado que pueda volverlos falsos.
    const empty = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    expect(empty).toContain('process:human_verification:v1');
    expect(empty).toContain('process:access_after_verification:v1');
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/state-fact-registry.test.ts
```
Esperado: FAIL — `Failed to resolve import "@/features/conversation/domain/state-fact-registry"`.

- [ ] **Step 3: Implementación mínima**

```ts
import {
  missingContactIntakeFieldsV1,
  type ContactIntakeV1,
} from '@/features/conversation/domain/conversation-planner';

export type StateFactIdV1 =
  | 'state:intake_recorded:v1'
  | 'state:payment_reported:v1'
  | 'process:human_verification:v1'
  | 'process:access_after_verification:v1';

export const STATE_FACT_IDS_V1: readonly StateFactIdV1[] = [
  'state:intake_recorded:v1',
  'state:payment_reported:v1',
  'process:human_verification:v1',
  'process:access_after_verification:v1',
];

/**
 * Los dos hechos de proceso describen lo que el equipo humano hace después
 * de la conversación. Ningún estado los vuelve falsos, así que no se
 * materializan: están.
 */
const CANONICAL_PROCESS_FACTS: readonly StateFactIdV1[] = [
  'process:human_verification:v1',
  'process:access_after_verification:v1',
];

export interface StateFactSubjectV1 {
  readonly intake: ContactIntakeV1 | undefined;
  readonly planned_payment_reported: boolean;
}

export function materializeStateFactsV1(
  subject: StateFactSubjectV1,
): ReadonlySet<StateFactIdV1> {
  const facts = new Set<StateFactIdV1>(CANONICAL_PROCESS_FACTS);
  if (missingContactIntakeFieldsV1(subject.intake).length === 0) {
    facts.add('state:intake_recorded:v1');
  }
  if (subject.planned_payment_reported) facts.add('state:payment_reported:v1');
  return facts;
}
```

- [ ] **Step 4: Correr y ver el verde**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/state-fact-registry.test.ts
```
Esperado: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/conversation/domain/state-fact-registry.ts \
        tests/unit/conversation/state-fact-registry.test.ts
git commit -m "feat(agent-a): cuatro hechos de estado, ninguno más"
```

---

### Task 0.3: V5 autoriza por estado, no por texto

El detector léxico sigue existiendo —hace falta para reconocer que una oración afirma un estado— pero deja de decidir si es válida. Eso lo decide la cita contra el estado durable.

**Files:**
- Modify: `src/features/conversation/domain/operational-promise-guard.ts`
- Test: `tests/unit/conversation/operational-promises.test.ts` (existente, se extiende)

**Interfaces:**
- Consumes: `StateFactIdV1`, `materializeStateFactsV1` de T0.2.
- Produces:
```ts
export interface OperationalAssertionV1 {
  readonly sentence: string;
  /** El hecho que debe estar materializado para que la oración sea cierta. */
  readonly requires: StateFactIdV1;
}

/** Detector léxico. Reconoce la afirmación; ya no juzga su validez. */
export function detectOperationalStateAssertionsV1(
  text: string,
): readonly OperationalAssertionV1[];

/** V5. Las afirmaciones cuyo hecho no está materializado. */
export function unsupportedOperationalAssertionsV1(
  text: string,
  materialized: ReadonlySet<StateFactIdV1>,
): readonly OperationalAssertionV1[];
```
`assertsCompletedOperationalOutcome`, `stripUnsupportedOperationalClaims`, `solicitsACall` y `stripModelAuthoredCallOffers` conservan su firma: las usan el ensamblador y la Fase 2.

- [ ] **Step 1: Escribir el test que falla**

El caso central es el defecto que la especificación documenta en §05: la frase aprobada por P6 hoy es bloqueada por el guard.

```ts
import { describe, expect, it } from 'vitest';
import {
  detectOperationalStateAssertionsV1,
  unsupportedOperationalAssertionsV1,
} from '@/features/conversation/domain/operational-promise-guard';
import { materializeStateFactsV1 } from '@/features/conversation/domain/state-fact-registry';

const APPROVED = 'Registré tus datos. Cuando informes el pago, el equipo lo '
  + 'revisará y, si está acreditado, gestionará tu acceso.';

const completeIntake = {
  nombre: 'Ana', apellido: 'Pérez',
  correo: 'ana@example.com', telefono: '+15551234567',
} as const;

describe('V5 autoriza por estado, no por texto', () => {
  it('reconoce las afirmaciones de estado de la frase aprobada', () => {
    const found = detectOperationalStateAssertionsV1(APPROVED).map((a) => a.requires);
    expect(found).toContain('state:intake_recorded:v1');
  });

  // El defecto documentado en §05: hoy esta frase se bloquea entera.
  it('autoriza la frase aprobada cuando el intake está completo', () => {
    const materialized = materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: false,
    });
    expect(unsupportedOperationalAssertionsV1(APPROVED, materialized)).toEqual([]);
  });

  // La consecuencia deseada: la MISMA frase es falsa sin datos, y cae.
  it('bloquea la misma frase cuando el intake está incompleto', () => {
    const materialized = materializeStateFactsV1({
      intake: { ...completeIntake, correo: '' }, planned_payment_reported: false,
    });
    const rejected = unsupportedOperationalAssertionsV1(APPROVED, materialized);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.requires).toBe('state:intake_recorded:v1');
  });

  // Más estricto que el detector léxico de hoy, que dejaba pasar esto por no
  // contener ningún sustantivo operativo.
  it('bloquea «Registré tus datos» a secas cuando no se registró nada', () => {
    const materialized = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    expect(unsupportedOperationalAssertionsV1('Registré tus datos.', materialized))
      .toHaveLength(1);
  });

  it('autoriza afirmar el pago informado sólo con la transición planificada', () => {
    const text = 'Tengo registrado que informaste el pago.';
    expect(unsupportedOperationalAssertionsV1(text, materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: true,
    }))).toEqual([]);
    expect(unsupportedOperationalAssertionsV1(text, materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: false,
    }))).toHaveLength(1);
  });

  it('los hitos externos no tienen hecho que los respalde, con estado completo o no', () => {
    // §05b: ningún turno conversacional puede establecerlos, así que caen sin
    // necesidad de una regla especial.
    const todo = materializeStateFactsV1({
      intake: completeIntake, planned_payment_reported: true,
    });
    for (const claim of [
      'Tu inscripción quedó confirmada.',
      'Te doy el alta académica y genero tus credenciales de acceso.',
      'Ya te dejo la preinscripción cargada en el sistema.',
      'Tu acceso al campus está habilitado.',
      'Tu pago fue verificado.',
    ]) {
      expect(unsupportedOperationalAssertionsV1(claim, todo).length).toBeGreaterThan(0);
    }
  });

  it('no toca una oración que no afirma ningún estado', () => {
    const todo = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    for (const neutral of [
      'El curso dura seis meses y queda grabado.',
      '¿Cuál de las tres opciones te resulta más cómoda?',
      'Contame qué te gustaría aprender.',
    ]) {
      expect(unsupportedOperationalAssertionsV1(neutral, todo)).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/operational-promises.test.ts
```
Esperado: FAIL — `detectOperationalStateAssertionsV1 is not a function`.

- [ ] **Step 3: Implementación mínima**

Agregar a `operational-promise-guard.ts`, sin tocar los exports existentes. Cada clase léxica se mapea al hecho que la vuelve cierta; las clases que no tienen hecho apuntan a un centinela que nunca se materializa.

```ts
import type { StateFactIdV1 } from './state-fact-registry';

export interface OperationalAssertionV1 {
  readonly sentence: string;
  readonly requires: StateFactIdV1;
}

/**
 * Los hitos externos —inscripción, alta, matrícula, credenciales, acceso
 * entregado, pago verificado— no tienen fact_id porque ningún turno
 * conversacional puede establecerlos. Se les asigna un requisito imposible:
 * caen por ausencia de respaldo, igual que cualquier otra afirmación sin
 * hecho, sin una regla especial que los enumere.
 */
const UNREACHABLE_MILESTONE = 'state:__external_milestone__:v1' as StateFactIdV1;

const ASSERTION_CLASSES: readonly {
  readonly pattern: RegExp;
  readonly requires: StateFactIdV1;
}[] = [
  {
    // afirmar que los datos quedaron guardados
    pattern: /\b(?:registr[éeo]|guard[éeo]|anot[éeo]|tom[éeo])\b[^.;]{0,40}\b(?:tus\s+)?datos\b/iu,
    requires: 'state:intake_recorded:v1',
  },
  {
    // afirmar que consta el pago informado
    pattern: /\b(?:tengo|qued[óo])\s+registrad[oa]\b[^.;]{0,40}\b(?:pago|abonaste|pagaste)\b/iu,
    requires: 'state:payment_reported:v1',
  },
  {
    pattern: /\b(?:inscripci[óo]n|matr[íi]cula|preinscripci[óo]n)\b[^.;]{0,30}\b(?:confirmad|carga|complet|realizad)/iu,
    requires: UNREACHABLE_MILESTONE,
  },
  {
    pattern: /\b(?:alta\s+acad[ée]mica|credenciales|usuario\s+y\s+contrase|acceso)\b[^.;]{0,40}\b(?:gener|entreg|habilit|activ|doy|dar)/iu,
    requires: UNREACHABLE_MILESTONE,
  },
  {
    pattern: /\bpago\b[^.;]{0,30}\b(?:verificad|acreditad|confirmad)/iu,
    requires: UNREACHABLE_MILESTONE,
  },
];

/**
 * Las oraciones que atribuyen el resultado al equipo humano y lo sitúan
 * después de una verificación no afirman un estado alcanzado: describen el
 * proceso. Son los dos hechos canónicos de §05b y por eso «el equipo lo
 * revisará y, si está acreditado, gestionará tu acceso» no cae, mientras
 * «gestioné tu acceso» sí.
 */
const ATTRIBUTED_TO_TEAM = /\b(?:el\s+equipo|una\s+persona|el\s+[áa]rea)\b/iu;
const AFTER_VERIFICATION = /\b(?:cuando|si\s+est[áa]\s+acreditad|una\s+vez\s+(?:que\s+)?(?:lo\s+)?verifi|tras\s+(?:la\s+)?verifica)/iu;

function splitSentences(text: string): readonly string[] {
  return text.split(/(?<=[.;!?])\s+/u).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function detectOperationalStateAssertionsV1(
  text: string,
): readonly OperationalAssertionV1[] {
  const found: OperationalAssertionV1[] = [];
  for (const sentence of splitSentences(text)) {
    if (ATTRIBUTED_TO_TEAM.test(sentence) && AFTER_VERIFICATION.test(sentence)) continue;
    for (const { pattern, requires } of ASSERTION_CLASSES) {
      if (pattern.test(sentence)) {
        found.push({ sentence, requires });
        break;
      }
    }
  }
  return found;
}

export function unsupportedOperationalAssertionsV1(
  text: string,
  materialized: ReadonlySet<StateFactIdV1>,
): readonly OperationalAssertionV1[] {
  return detectOperationalStateAssertionsV1(text)
    .filter((assertion) => !materialized.has(assertion.requires));
}
```

- [ ] **Step 4: Correr y ver el verde**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/operational-promises.test.ts
```
Esperado: PASS, incluidos los tests preexistentes del archivo. **Si alguno de los preexistentes rompe, no ajustar el test: son el contrato de `7041787` y `404bc8c`.** Frenar y reportar.

- [ ] **Step 5: Commit**

```bash
git add src/features/conversation/domain/operational-promise-guard.ts \
        tests/unit/conversation/operational-promises.test.ts
git commit -m "feat(agent-a): una frase es válida por el estado, no por la cadena"
```

---

### Task 0.4: Barrido de ciudad, estado y ZIP en todo el repositorio (D3)

Empezó como una línea. Son once sitios en cinco categorías, y por eso el cierre no es una edición sino un test que recorre el repositorio: si vuelve a entrar por cualquier archivo, falla.

**Files:**
- Modify: `botpress-agent/src/lib/conversation/agent-a-brain.ts:879` — fallback del backend
- Modify: `botpress-agent/src/prompts/agent-a.json:99` — prompt
- Modify: `botpress-agent/src/prompts/agent-a-sales-bridge.ts:208` — prompt
- **No se toca:** `botpress-agent/retell/retell-agent-a-chat-llm.json` — fuera de alcance por §01; excluido del guard con motivo escrito
- Modify: `botpress-agent/evals/personas/studyx-happy-path-cases-v6.json` — 5 turnos
- Modify: `botpress-agent/evals/personas/studyx-client-personas-v6.json` — 3 turnos
- Modify: `tests/unit/botpress/agent-a-brain.test.ts:483`
- Modify: `tests/unit/botpress/agent-a-brain-model-copy.test.ts:63`
- Modify: `tests/unit/botpress/agent-a-sales-bridge-prompt.test.ts:183,342`
- Modify: `tests/unit/scripts/agent-a-conversation-runner.test.ts:826`
- Test: `tests/unit/contracts/intake-fields-repo-guard.test.ts` (nuevo)

*(`docs/prompts/studyx-agent-a-canonical.md:11,141` se edita en T0.5 junto con el resto de P1–P11; el guard de esta tarea lo cubre igual.)*

**Interfaces:**
- Produces: nada nuevo. `transactionalFallback` conserva su firma.

- [ ] **Step 1: Escribir el guard de repositorio que falla**

```ts
// tests/unit/contracts/intake-fields-repo-guard.test.ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * El contrato comercial congelado tiene seis datos: nombre, apellido, correo,
 * teléfono, curso y plan. Ciudad, estado y código postal no están.
 *
 * Este guard recorre el repositorio en vez de un archivo porque el defecto
 * estaba repartido en cinco categorías —prompt canónico, dos prompts más, un
 * fallback del backend, dos fixtures y cinco tests— y arreglar una sola deja
 * el contrato roto en las otras cuatro.
 */
const FORBIDDEN = [
  { name: 'ciudad', pattern: 'ciudad' },
  { name: 'zip', pattern: 'zip[ _]?code|\\bZIP\\b' },
  { name: 'código postal', pattern: 'c[oó]digo postal' },
  { name: 'nombre completo', pattern: 'nombre completo|full name' },
];

// Fuera del alcance: dependencias, artefactos y este mismo archivo.
const EXCLUDED = [
  ':(exclude)**/node_modules/**', ':(exclude)**/package-lock.json',
  ':(exclude)**/*.generated.ts', ':(exclude)artifacts/**',
  ':(exclude)docs/superpowers/plans/**', ':(exclude)docs/architecture/**',
  ':(exclude)tests/unit/contracts/intake-fields-repo-guard.test.ts',
  // Retell está fuera de alcance por §01 de la especificación. La exclusión
  // es deliberada y va escrita para que sea visible: el archivo contiene
  // ciudad y ZIP y NO se corrige en este trabajo. Cuando Retell entre en
  // alcance, se borra esta línea y el archivo aparece solo en los fallos.
  ':(exclude)botpress-agent/retell/**',
];

function hits(pattern: string): string[] {
  try {
    return execFileSync('git', ['grep', '-nIE', pattern, '--', '.', ...EXCLUDED], {
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
  } catch {
    return []; // git grep sale con 1 cuando no hay coincidencias
  }
}

describe('el intake es de seis campos en todo el repositorio', () => {
  for (const { name, pattern } of FORBIDDEN) {
    it(`no existe «${name}» en ningún prompt, fallback, fixture, contrato ni test`, () => {
      expect(hits(pattern)).toEqual([]);
    });
  }

  it('el archivo generado del prompt tampoco lo contiene', () => {
    // Excluido del git grep porque es derivado, pero si el generador corrió
    // con una fuente sucia hay que enterarse acá y no en producción.
    expect(hits('ciudad|zip[ _]?code').length + 0).toBe(0);
    const generated = require('node:fs').readFileSync(
      'botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts', 'utf8',
    );
    expect(generated).not.toMatch(/ciudad|zip\s*code|c[oó]digo postal/iu);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

```bash
npx vitest run --config vitest.config.mts tests/unit/contracts/intake-fields-repo-guard.test.ts
```
Esperado: FAIL con la lista completa de sitios. **Esa lista es la tarea**; si aparece alguno que no está en el bloque **Files**, agregarlo en vez de excluirlo.

- [ ] **Step 3: El fallback del backend**

`confirm_payment_link` deja de tener fallback transaccional. El objetivo de pedir datos ya tiene el suyo en `safeContextualOpening('request_contact_details')` — «Para dejarlo listo necesito unos datos tuyos» — que no nombra ningún campo y por lo tanto es el fallback transitorio válido hasta que `intake_missing` llegue en la Fase 1.

```ts
function transactionalFallback(responseGoal: TurnPlanV1['response_goal']): string | null {
  switch (responseGoal) {
    case 'confirm_selected_plan':
      return 'Queda registrada tu elección. Avisame cuando quieras avanzar.';
    // `confirm_payment_link` tenía acá una cadena que pedía nombre completo,
    // correo, ciudad, estado y ZIP: tres campos fuera del contrato y una
    // fusión de nombre con apellido. Quién pide los datos es el modelo; qué
    // datos son lo define `intake_missing`, no una cadena fija del backend.
    case 'acknowledge_payment_deferral':
      return 'De acuerdo, lo dejamos para más adelante.';
    default:
      return null;
  }
}
```

- [ ] **Step 4: Los dos prompts restantes**

`botpress-agent/src/prompts/agent-a.json:99`:

```diff
-      "Pedir nombre completo, email, ciudad y código postal si faltan",
+      "Pedir los datos que falten de: nombre, apellido, correo y teléfono",
```

`botpress-agent/src/prompts/agent-a-sales-bridge.ts:208`. Hoy prohíbe inventar un requisito «for name, email, phone, city, ZIP code, country or budget». La prohibición era correcta pero la lista enumera campos que ya no existen, y enumerar campos prohibidos es la forma más fácil de que alguien los reponga:

```diff
-  requirement for name, email, phone, city, ZIP code, country or budget.
+  requirement for any field outside the frozen intake contract, which is
+  exactly: first name, last name, email, phone.
```

- [ ] **Step 5: Los dos fixtures**

Ocho turnos donde el cliente entrega ciudad y ZIP. No es que el cliente no pueda mencionarlos —una persona real lo hace—, sino que estos fixtures **verifican el flujo viejo**: existen para que el agente capture esos campos.

```diff
-  "Soy Ana Prueba, ana.happy01+{{run_id}}@example.com, Miami, ZIP 33101."
+  "Soy Ana Prueba, mi correo es ana.happy01+{{run_id}}@example.com y mi teléfono +1 305 555 0101."
```

Mismo patrón en los cinco de `studyx-happy-path-cases-v6.json` y los tres de `studyx-client-personas-v6.json`. **Verificar el oráculo:** si algún caso afirma que el agente capturó ciudad o ZIP, ese aserto se borra, no se adapta.

- [ ] **Step 6: Los cinco tests**

| Sitio | Qué afirma hoy | Acción |
|---|---|---|
| `agent-a-brain.test.ts:483` | que el modelo produce el bloque con ciudad/estado/zip | reescribir: afirma que **no** lo produce |
| `agent-a-brain-model-copy.test.ts:63` | idem, en variante de una línea | idem |
| `agent-a-sales-bridge-prompt.test.ts:183` | `not.toContain('Ask for full name, email, city and ZIP code')` | ya es protectivo; actualizar la cadena a la redacción nueva |
| `agent-a-sales-bridge-prompt.test.ts:342` | espera la lista vieja de campos prohibidos | actualizar a la redacción del Step 4 |
| `agent-a-conversation-runner.test.ts:826` | turno de fixture con ZIP | reescribir el turno |

Los dos primeros codificaban el defecto: afirmaban que el agente pide tres campos fuera del contrato. **Se invierten, no se borran** — la aserción negativa es lo que impide que vuelvan.

- [ ] **Step 7: Correr y ver el verde**

```bash
npx vitest run --config vitest.config.mts tests/unit/contracts/intake-fields-repo-guard.test.ts
npm run test:unit
npm --prefix botpress-agent run typecheck
```
Esperado: PASS. El guard queda como gate permanente en la suite.

- [ ] **Step 8: Commit**

```bash
git add botpress-agent/src/lib/conversation/agent-a-brain.ts \
        botpress-agent/src/prompts/agent-a.json \
        botpress-agent/src/prompts/agent-a-sales-bridge.ts \
        botpress-agent/evals/personas/studyx-happy-path-cases-v6.json \
        botpress-agent/evals/personas/studyx-client-personas-v6.json \
        tests/
git commit -m "fix(agent-a)!: ciudad, estado y ZIP dejan de existir

El contrato comercial tiene seis datos y tres de ellos no estaban. No era
sólo el prompt: había un fallback del backend que los pedía, dos prompts
más, dos fixtures que verificaban el flujo viejo y dos tests que afirmaban
el defecto como si fuera la conducta esperada.

El cierre es un guard de repositorio, no una edición: si vuelven a entrar
por cualquier archivo, la suite falla. Retell queda excluido a propósito y
con motivo escrito: está fuera de alcance por §01."
```

---

### Task 0.5: Prompt canónico v2 (P1–P11)

**Files:**
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Modify: `scripts/generate-agent-a-prompt-module.mjs:13,17,24`
- Regenerate: `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Test: `tests/unit/prompts/canonical-prompt-v2.test.ts` (nuevo)

**Interfaces:**
- Consumes: `unsupportedOperationalAssertionsV1` y `materializeStateFactsV1` de T0.2 y T0.3.
- Produces: `STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = 'studyx-agent-a-canonical-v2'`.

**Nota de ubicación.** La especificación dice «§6 Onboarding» en P10. En la fuente, «FASE 6 — Onboarding» es una subsección de **§4 FLUJO DE VENTA**; §6 es SEGUIMIENTO y no se toca. P4 está en §5 FRICCIÓN DE PAGO; P5 en §4 FASE 5.

- [ ] **Step 1: Escribir el test que falla**

Es el gate permanente de §08: el prompt no puede volver a ordenar lo que V5 borra.

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  STUDYX_AGENT_A_CANONICAL_PROMPT,
  STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
} from '../../../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';
import { unsupportedOperationalAssertionsV1 } from '@/features/conversation/domain/operational-promise-guard';
import { materializeStateFactsV1 } from '@/features/conversation/domain/state-fact-registry';

const source = readFileSync(
  fileURLToPath(new URL('../../../docs/prompts/studyx-agent-a-canonical.md', import.meta.url)),
  'utf8',
);

describe('prompt canónico v2', () => {
  it('está versionado como v2 y el generado coincide con la fuente', () => {
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION).toBe('studyx-agent-a-canonical-v2');
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).toBe(source);
  });

  // P1 · P3
  it('pide los cuatro campos del contrato y ninguno más', () => {
    for (const term of [/\bciudad\b/iu, /\bzip\s*code\b/iu, /\bestado\b(?!\s+de\s+la\s+conversaci)/iu]) {
      expect(source).not.toMatch(term);
    }
    for (const field of ['nombre', 'apellido', 'correo', 'teléfono']) {
      expect(source.toLowerCase()).toContain(field);
    }
  });

  // P2
  it('no pide curso ni plan como dato de inscripción', () => {
    expect(source).not.toMatch(/necesito[^.]{0,60}\b(?:curso|plan)\b/iu);
  });

  // P4 · P5
  it('no contiene las dos promesas eliminadas', () => {
    expect(source).not.toContain('preinscripción cargada');
    expect(source).not.toContain('alta académica');
    expect(source).not.toContain('credenciales de acceso');
  });

  // P6
  it('contiene el copy autorizado, palabra por palabra', () => {
    expect(source).toContain(
      'Registré tus datos. Cuando informes el pago, el equipo lo revisará '
      + 'y, si está acreditado, gestionará tu acceso.',
    );
  });

  // P8 · P9
  it('mantiene los tres planes y el tope de dos ofertas', () => {
    for (const plan of ['monthly_12', 'monthly_6', 'one_time']) {
      expect(source).toContain(plan);
    }
    expect(source).toMatch(/m[áa]ximo\s+2\s+ofrecimientos|nunca\s+m[áa]s\s+de\s+dos/iu);
  });

  // P10
  it('no ordena entregar campus, usuario, contraseña ni credenciales', () => {
    for (const term of [
      /link\s+al\s+campus/iu, /usuario\s*\+?\s*contrase/iu,
      /contrase[ñn]a/iu, /credenciales/iu,
    ]) {
      expect(source).not.toMatch(term);
    }
  });

  // P11 · entregas
  it('no ordena mandar PDF, archivo ni link de programa', () => {
    for (const term of [/\bPDF\b/u, /mand[áa]\s+el\s+(?:archivo|programa)/iu]) {
      expect(source).not.toMatch(term);
    }
  });

  // P11 · plazos y seguimiento
  it('no promete plazos ni mensajes futuros que no puede ejecutar', () => {
    for (const term of [
      /\{\{PLAZO_CONCRETO\}\}/u,
      /te\s+escribo\s+(?:antes|el|en|ma[ñn]ana)/iu,
      /d[áa]\s+un\s+plazo\s+concreto/iu,
      /te\s+llamo\s+\d+\s+minutos/iu,
      /seguimiento\s+en\s+24\s*h/iu,
    ]) {
      expect(source).not.toMatch(term);
    }
  });

  it('contiene el único reemplazo autorizado para el contenido del programa', () => {
    expect(source).toContain('Puedo contarte el contenido del programa por acá.');
  });

  // §08: la contradicción de hoy convertida en gate permanente.
  it('ninguna línea del prompt ordena algo que V5 bloquearía', () => {
    // Se evalúa con el estado MÁS permisivo posible. Lo que cae acá cae
    // siempre: son los hitos externos que ningún turno puede establecer.
    const todoMaterializado = materializeStateFactsV1({
      intake: {
        nombre: 'Ana', apellido: 'Pérez',
        correo: 'ana@example.com', telefono: '+15551234567',
      },
      planned_payment_reported: true,
    });
    const offending = source
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => unsupportedOperationalAssertionsV1(line, todoMaterializado).length > 0);

    expect(offending.map((o) => `${o.number}: ${o.line.trim()}`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

```bash
npx vitest run --config vitest.config.mts tests/unit/prompts/canonical-prompt-v2.test.ts
```
Esperado: FAIL en versión, P1/P3, P4/P5, P6, P10 y el gate de V5.

- [ ] **Step 3: Editar la fuente del prompt**

Sitios exactos, en orden de aparición:

| # | Sección | Texto actual | Acción |
|---|---|---|---|
| P1·P3 | §1 IDENTIDAD | «capturando nombre completo, email y ciudad + zip code» | → «capturando nombre, apellido, correo y teléfono» |
| P2·P1·P3·P5·P6 | §4 FASE 5 | bloque «Para la inscripción necesito: - Nombre completo - Correo electrónico - Ciudad, estado y zip code / Con estos datos te doy el alta académica y genero tus credenciales de acceso.» | → bloque nuevo (abajo) |
| P10 | §4 FASE 6 — Onboarding | subsección completa, seis ítems | eliminar entera y reemplazar por el reparto (abajo) |
| P4 | §5 FRICCIÓN DE PAGO, punto 2 | «Asegurá el lugar: *"Ya te dejo la preinscripción cargada en el sistema."*» | eliminar el punto; renumerar «tres cosas» → «dos cosas» |
| P7 | §7 REGLAS DURAS, NUNCA | — | agregar tres viñetas (abajo) |
| P10 | §7 REGLAS DURAS, SIEMPRE | «Confirmá la recepción del comprobante de inmediato» | → «Confirmá que registraste el aviso de pago; la verificación y el acceso son del equipo» |
| P8·P9 | §3, §4 POLÍTICA DE LLAMADA, §7 | ya correctos | verificar, no tocar |
| **P11** | §2, L23 | «Si la información es larga, partila en mensajes o mandá el PDF.» | → «Si la información es larga, partila en mensajes.» |
| **P11** | §2, L30 | Regla de latencia + «*"Dejame confirmarlo con el área académica y te escribo antes de las 6 PM."*» | eliminar el ejemplo y la instrucción de dar plazo; conservar «respondé rápido» sin número |
| **P11** | §4 FASE 3, L104 | «Después mandá el PDF del programa y el link de la web/Instagram.» | → «Puedo contarte el contenido del programa por acá.» |
| **P11** | §5 CONFIANZA, L208 | «Respondé con evidencia…: web, Instagram, videos de graduados…» | reescribir sin URLs ni materiales: responder con lo confirmado en el catálogo (también lo exige V7) |
| **P11** | §7 NUNCA, L271 zona | «Prometas una llamada sin dar día y hora concretos» | → «Prometas una llamada, un plazo, un archivo o un mensaje futuro» |
| **P11** | §7 SIEMPRE, L271 | «Ante una queja: reconocé, dá un plazo concreto, cumplilo» | → «Ante una queja: reconocé y registrá el caso para revisión del equipo» |
| **P11** | §8, L288 | «*"…Te escribo {{PLAZO_CONCRETO}}."*» y «Y transferí de verdad.» | reescribir sin plazo y sin transferencia en vivo: registrar para revisión |
| **P11** | §6 SEGUIMIENTO, tabla | cuatro mensajes programados (+24 h … +14 días) y «+7 días: si querés te llamo 10 minutos» | eliminar la tabla entera y la oferta de llamada con duración |
| **P11** | §4 FASE 5 | «Luego seguimiento en 24 h con un mensaje corto» | eliminar |
| **P11** | §9 VARIABLES | fila `{{PLAZO_CONCRETO}}` si existe | eliminar |

**Sobre §6 SEGUIMIENTO.** La tabla no es una promesa hecha al cliente sino una instrucción de mandar mensajes a las 24 h, 72 h, 7 y 14 días. Cae bajo P11 igual, por una razón concreta: **no hay agendador**. No existe en el repositorio un mecanismo que dispare un turno saliente por tiempo transcurrido, así que la instrucción ordena algo que el sistema no puede hacer — exactamente el género de contradicción entre prompt y backend que este trabajo elimina. El «+7 días: si querés te llamo 10 minutos» es además una promesa de llamada con duración, que P11 prohíbe explícitamente.

Bloque de reemplazo de FASE 5:

```markdown
Cuando exista autorización explícita, pedí los cuatro datos y enviá el link:

```
Para dejarlo registrado necesito:
- Nombre
- Apellido
- Correo electrónico
- Teléfono
```
```
{{LINK_CANÓNICO_DEL_PLAN_ELEGIDO}}
Cuando hagas el pago, avisame por acá.
```

El curso y el plan no se piden: ya están elegidos y el backend los tiene.
No pidas ciudad, estado, código postal ni ningún otro dato.

Con los cuatro datos registrados, la única frase autorizada sobre qué pasa
después es esta, textual:

> Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.
```

Bloque de reemplazo de FASE 6:

```markdown
### FASE 6 — Aviso de pago

Cuando la persona avise que pagó, tu turno se termina ahí. Confirmá que
quedó registrado para revisión y no prometas nada más.

**No entregás acceso.** No mandás link al campus, ni usuario, ni contraseña,
ni credenciales, ni factura, ni tutorial. Verificar el pago y entregar el
acceso es del equipo humano, después de comprobar la acreditación. Vos
registrás los datos y el aviso de pago; nada más.

Que la persona diga que pagó no es que el pago esté acreditado. Nunca lo
trates como confirmado.
```

Viñetas nuevas en §7 NUNCA:

```markdown
- Digas que un pago fue verificado, acreditado o confirmado: sólo el equipo lo establece
- Digas que una inscripción, matrícula o preinscripción quedó cargada o confirmada
- Entregues o prometas acceso, campus, usuario, contraseña, credenciales o alta académica
- Prometas o mandes un PDF, un archivo, un temario descargable o un link
- Prometas una llamada, un plazo, un horario o un mensaje futuro
```

Bloque de reemplazo de §4 FASE 3 (P11):

```markdown
No mandes archivos ni links: no podés. Si piden el programa, el temario o
más detalle, la respuesta autorizada es:

> Puedo contarte el contenido del programa por acá.

Y después contás lo que esté confirmado en el catálogo, en mensajes cortos.
```

- [ ] **Step 4: Actualizar los pines del generador y regenerar**

El generador fija SHA-256 y cantidad de líneas para impedir deriva accidental. Editar la fuente exige actualizar los dos pines y la versión.

```bash
cd "$(git rev-parse --show-toplevel)"
SHA=$(shasum -a 256 docs/prompts/studyx-agent-a-canonical.md | cut -d' ' -f1)
LINES=$(grep -c '' docs/prompts/studyx-agent-a-canonical.md)
echo "sha256=$SHA lines=$LINES"

python3 - "$SHA" "$LINES" <<'PY'
import re, sys
sha, lines = sys.argv[1], sys.argv[2]
p = 'scripts/generate-agent-a-prompt-module.mjs'
s = open(p, encoding='utf8').read()
s = re.sub(r"const expectedSha256 = '[0-9a-f]{64}';",
           f"const expectedSha256 = '{sha}';", s)
s = re.sub(r"if \(lineCount !== \d+\)",
           f"if (lineCount !== {lines})", s)
s = s.replace("studyx-agent-a-canonical-v1", "studyx-agent-a-canonical-v2")
open(p, 'w', encoding='utf8').write(s)
PY

npm run generate:agent-a-prompt
```

Esperado: sin excepción. Si tira `AGENT_A_CANONICAL_PROMPT_LINE_COUNT` o `..._SHA256`, el conteo de `grep -c ''` no coincide con `match(/\n/g).length` porque el archivo no termina en salto de línea — corregir el archivo, no el pin.

- [ ] **Step 5: Correr y ver el verde**

```bash
npx vitest run --config vitest.config.mts tests/unit/prompts/canonical-prompt-v2.test.ts
npm run test:unit
npm --prefix botpress-agent run typecheck
```
Esperado: PASS. Un fallo del último test («ninguna línea ordena algo que V5 bloquearía») lista número de línea y texto: es la lista de sitios que faltan editar, no un bug del test.

- [ ] **Step 6: Commit**

```bash
git add docs/prompts/studyx-agent-a-canonical.md \
        scripts/generate-agent-a-prompt-module.mjs \
        botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts \
        tests/unit/prompts/canonical-prompt-v2.test.ts
git commit -m "feat(agent-a)!: el prompt deja de ordenar lo que el guard borra

El prompt canónico mandaba dar el alta académica, generar credenciales y
cargar la preinscripción. El guard borraba esas frases. El modelo obedecía
y el backend deshacía: la contradicción producía turnos vacíos.

v1 -> v2. El test de §08 la convierte en gate permanente."
```

---

### Task 0.6: Migración — derivación a revisión humana y contador de fallbacks

Única migración del plan. Aditiva (R3).

**Files:**
- Create: `supabase/migrations/20260902010001_agent_a_human_review_and_fallback_counter.sql`
- Modify: `src/features/conversation/domain/conversation-pipeline.ts:112-125`
- Modify: `src/features/conversation/adapters/conversation-pipeline-schema.ts`
- Modify: `botpress-agent/src/schemas/conversation-pipeline.ts`
- Modify: `src/features/conversation/adapters/postgres-conversation-state-store.ts`
- Test: `tests/integration/conversation/human-review-derivation.test.ts`

**Decisión de reutilización, y por qué no es `stage: 'handoff'`.** Mi propuesta original decía `stage: handoff`. Tu ajuste dice *«una nueva entrada puede volver a intentar DeepSeek»*, y `handoff` es terminal (`conversation-planner.ts:125`): una entrada posterior abriría sesión nueva y perdería el contexto comercial. Se usa en cambio una columna dedicada sobre la tabla que ya existe. `escalate_to_human` en `agent_decisions` tampoco sirve: la base lo rechaza por diseño desde `20260811040001`, y `request_call_now` involucraría al Agente B, que está fuera de alcance.

**Interfaces:**
- Produces:
```ts
// ConversationStateV1 gana:
readonly human_review_requested_at: string | null;
readonly consecutive_technical_fallbacks: number;

// ConversationStateTransitionV1 gana:
/** Idempotente: sólo escribe si human_review_requested_at es NULL. */
readonly request_human_review: boolean;
readonly consecutive_technical_fallbacks: number;

// Y ConversationStateStoreV1 gana un método angosto. Hace falta porque la
// rama de supresión anula `preparedPipeline` (decision.service.ts:796) y por
// lo tanto NO ejecuta la transición de la línea 1128: un turno técnico no
// tiene curso, plan ni etapa que escribir, sólo el contador. Forzar una
// transición completa ahí exigiría inventar valores comerciales para un turno
// que deliberadamente no los tiene.
recordTechnicalFallbackV1(input: {
  readonly workspace_slug: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly source_turn_id: string | null;
  readonly consecutive_technical_fallbacks: number;
  readonly request_human_review: boolean;
}): Promise<void>;
```

- [ ] **Step 1: Escribir la migración**

```sql
-- Dos N3 consecutivos no producen un tercer fallback: producen una
-- derivación durable a revisión del equipo.
--
-- Idempotencia: `human_review_requested_at` se escribe sólo si es NULL, así
-- que hay como máximo una derivación activa por conversación por más veces
-- que se repita el turno.
--
-- No es `stage = 'handoff'`. `handoff` es terminal, y la conversación tiene
-- que poder seguir: una entrada nueva vuelve a intentar el modelo. Esto es
-- una marca para el equipo, no un cierre.
--
-- Aditiva: ninguna columna se borra (R3).

BEGIN;

ALTER TABLE conversation_sales_context_states_v1
  ADD COLUMN IF NOT EXISTS human_review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_technical_fallbacks integer NOT NULL DEFAULT 0;

ALTER TABLE conversation_sales_context_states_v1
  DROP CONSTRAINT IF EXISTS conversation_sales_context_states_v1_fallback_count_check;

ALTER TABLE conversation_sales_context_states_v1
  ADD CONSTRAINT conversation_sales_context_states_v1_fallback_count_check
  CHECK (consecutive_technical_fallbacks BETWEEN 0 AND 2);

ALTER TABLE conversation_sales_context_state_events_v1
  ADD COLUMN IF NOT EXISTS human_review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_technical_fallbacks integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN conversation_sales_context_states_v1.human_review_requested_at IS
  'Cuándo la conversación quedó marcada para revisión del equipo tras dos fallos técnicos consecutivos. Se escribe una sola vez: no promete atención inmediata ni transferencia en vivo.';

COMMENT ON COLUMN conversation_sales_context_states_v1.consecutive_technical_fallbacks IS
  'Fallbacks técnicos seguidos. Un turno exitoso lo reinicia a 0. Tope 2: en el segundo se deriva.';

-- No hay constraint que ate la marca al contador. Sería tentador exigir
-- `human_review_requested_at IS NULL OR consecutive_technical_fallbacks >= 2`,
-- pero contradice la regla de reinicio: un turno exitoso posterior pone el
-- contador en 0 y la marca sigue escrita, porque el equipo ya fue avisado y
-- ese aviso es histórico. La garantía de que la marca no exista sin su commit
-- la da la transacción (O2), no un CHECK.

COMMIT;
```

- [ ] **Step 2: Aplicarla en un cluster limpio y ver el esquema**

```bash
./scripts/pg-native-up.sh 54399 --seed
psql "postgresql://postgres@127.0.0.1:54399/postgres" -c \
  "\d conversation_sales_context_states_v1" | grep -E "human_review|consecutive"
```
Esperado: las dos columnas presentes.

- [ ] **Step 3: Escribir el test de integración que falla**

```ts
// tests/integration/conversation/human-review-derivation.test.ts
import { describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
// … helpers del harness de integración existente (ver
// tests/integration/conversation/conversation-pipeline-v1.test.ts)

describe('derivación a revisión humana', () => {
  it('la primera derivación queda escrita y las repeticiones no la mueven', async () => {
    const store = new PostgresConversationStateStoreV1(db);
    const base = { /* workspace_slug, conversation_id, contact_id, … */ };

    await store.transition({
      ...base, consecutive_technical_fallbacks: 2, request_human_review: true,
      source_turn_id: turnA,
    });
    const first = await store.load(ws, conversationId, contactId);
    expect(first!.human_review_requested_at).not.toBeNull();

    // Máximo una derivación activa por conversación: repetir no la reescribe.
    await store.transition({
      ...base, consecutive_technical_fallbacks: 2, request_human_review: true,
      source_turn_id: turnB,
    });
    const second = await store.load(ws, conversationId, contactId);
    expect(second!.human_review_requested_at).toBe(first!.human_review_requested_at);
  });

  it('un turno exitoso reinicia el contador y deja la marca en pie', async () => {
    // La marca es histórica: el equipo ya fue avisado. Lo que se reinicia es
    // el contador, para que un fallo futuro vuelva a contar desde cero.
    await store.transition({
      ...base, consecutive_technical_fallbacks: 0, request_human_review: false,
      source_turn_id: turnC,
    });
    const after = await store.load(ws, conversationId, contactId);
    expect(after!.consecutive_technical_fallbacks).toBe(0);
    expect(after!.human_review_requested_at).not.toBeNull();
  });

  it('la conversación no queda terminal: el estado sigue siendo el comercial', async () => {
    const state = await store.load(ws, conversationId, contactId);
    expect(state!.stage).not.toBe('handoff');
    expect(state!.stage).not.toBe('closed');
  });
});
```

- [ ] **Step 4: Correr y ver el fallo**

```bash
npm run test:integration -- tests/integration/conversation/human-review-derivation.test.ts
```
Esperado: FAIL — `request_human_review` no existe en `ConversationStateTransitionV1`.

- [ ] **Step 5: Extender contratos, espejos y store**

En `conversation-pipeline.ts`, agregar los dos campos a `ConversationStateV1` y los dos a `ConversationStateTransitionV1` con las firmas del bloque **Interfaces**. Replicar en los dos espejos Zod. En `postgres-conversation-state-store.ts`, tanto `transition` como el `recordTechnicalFallbackV1` nuevo escriben las dos columnas con la misma expresión:

```sql
human_review_requested_at = COALESCE(
  conversation_sales_context_states_v1.human_review_requested_at,
  CASE WHEN ${input.request_human_review} THEN now() ELSE NULL END
),
consecutive_technical_fallbacks = ${input.consecutive_technical_fallbacks}
```

`COALESCE` sobre la columna existente es la idempotencia, y vive en SQL a propósito: dos turnos concurrentes de la misma conversación no pueden producir dos derivaciones, porque la condición se evalúa contra la fila bloqueada, no contra un valor leído antes. La primera gana y ninguna posterior la mueve.

`recordTechnicalFallbackV1` escribe **sólo** esas dos columnas y `source_turn_id`; no toca curso, plan, etapa, preferencia de llamada ni `awaiting_reply`. Un turno técnico no cambió nada comercial y no debe simular que sí.

- [ ] **Step 6: Correr y ver el verde**

```bash
npm run test:integration -- tests/integration/conversation/human-review-derivation.test.ts
npm run typecheck && npm --prefix botpress-agent run typecheck
npm run test:unit
```
Esperado: PASS. El typecheck va a listar todos los sitios que construyen una transición sin los campos nuevos — completarlos, sin valores por defecto silenciosos en el tipo.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260902010001_agent_a_human_review_and_fallback_counter.sql \
        src/features/conversation/domain/conversation-pipeline.ts \
        src/features/conversation/adapters/conversation-pipeline-schema.ts \
        src/features/conversation/adapters/postgres-conversation-state-store.ts \
        botpress-agent/src/schemas/conversation-pipeline.ts \
        tests/integration/conversation/human-review-derivation.test.ts
git commit -m "feat(agent-a): la derivación a revisión humana es durable e idempotente"
```

---

### Task 0.7: N3 y la derivación — el piso que hace imposible el silencio

**Files:**
- Create: `src/features/conversation/domain/technical-fallback.ts`
- Create: `tests/unit/conversation/technical-fallback.test.ts`
- Modify: `src/features/conversation/domain/canonical-response-assembler.ts:166,365`
- Modify: `src/lib/services/decision.service.ts:772-796`

**Interfaces:**
- Produces:
```ts
export const TECHNICAL_FALLBACK_TEXT_V1: string;
export const HUMAN_REVIEW_NOTICE_TEXT_V1: string;

export interface TechnicalFallbackV1 {
  readonly text: string;
  /** true en el segundo fallback consecutivo. Exige commit antes de entregar. */
  readonly requests_human_review: boolean;
  readonly next_consecutive_count: 1 | 2;
}

export function resolveTechnicalFallbackV1(input: {
  readonly consecutive_technical_fallbacks: number;
  readonly human_review_already_requested: boolean;
}): TechnicalFallbackV1;
```

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it } from 'vitest';
import {
  HUMAN_REVIEW_NOTICE_TEXT_V1,
  TECHNICAL_FALLBACK_TEXT_V1,
  resolveTechnicalFallbackV1,
} from '@/features/conversation/domain/technical-fallback';
import { unsupportedOperationalAssertionsV1 } from '@/features/conversation/domain/operational-promise-guard';
import { materializeStateFactsV1 } from '@/features/conversation/domain/state-fact-registry';

const resolve = (count: number, already = false) => resolveTechnicalFallbackV1({
  consecutive_technical_fallbacks: count,
  human_review_already_requested: already,
});

describe('N3 y la derivación', () => {
  it('usa el texto técnico aprobado, palabra por palabra', () => {
    expect(TECHNICAL_FALLBACK_TEXT_V1).toBe(
      'Recibí tu mensaje, pero tuve una demora para procesarlo. '
      + 'Probá nuevamente en unos segundos.',
    );
  });

  it('usa el aviso de derivación aprobado, palabra por palabra', () => {
    // Texto alternativo: no existe bandeja monitoreada (verificado en D1), y
    // «marcada para revisión del equipo» insinúa que hay un equipo mirando.
    expect(HUMAN_REVIEW_NOTICE_TEXT_V1).toBe(
      'Sigo teniendo un inconveniente para procesar tu consulta. '
      + 'Dejé registrada la conversación para revisión.',
    );
  });

  it('no nombra un equipo ni sugiere que alguien esté mirando', () => {
    expect(HUMAN_REVIEW_NOTICE_TEXT_V1).not.toMatch(/\bequipo|\bpersona|\basesor|\balguien/iu);
  });

  it('el primer fallo entrega N3 y no deriva', () => {
    expect(resolve(0)).toEqual({
      text: TECHNICAL_FALLBACK_TEXT_V1,
      requests_human_review: false,
      next_consecutive_count: 1,
    });
  });

  it('el segundo fallo consecutivo deriva en vez de repetir N3', () => {
    expect(resolve(1)).toEqual({
      text: HUMAN_REVIEW_NOTICE_TEXT_V1,
      requests_human_review: true,
      next_consecutive_count: 2,
    });
  });

  it('no hay un tercer fallback: con la derivación ya activa, no vuelve a derivar', () => {
    // Máximo una derivación activa por conversación. El cliente sigue viendo
    // un turno visible, pero el equipo no recibe una segunda marca.
    const third = resolve(2, true);
    expect(third.requests_human_review).toBe(false);
    expect(third.text).toBe(HUMAN_REVIEW_NOTICE_TEXT_V1);
  });

  // Q2: N3 es exclusivamente técnico.
  it('ninguno de los dos textos vende, interpreta ni pide datos', () => {
    for (const text of [TECHNICAL_FALLBACK_TEXT_V1, HUMAN_REVIEW_NOTICE_TEXT_V1]) {
      expect(text).not.toMatch(/\bcurso|precio|USD|plan|pago|llamada\b/iu);
      expect(text).not.toMatch(/\?/u);            // no pide datos
      expect(text).not.toMatch(/contame|decime/iu); // no interpreta ni invita
    }
  });

  // No prometer atención inmediata ni transferencia en vivo.
  it('el aviso no promete atención inmediata ni transferencia en vivo', () => {
    expect(HUMAN_REVIEW_NOTICE_TEXT_V1).not.toMatch(
      /\b(?:ahora|enseguida|de\s+inmediato|te\s+contact|te\s+llam|te\s+comunic|transfier)/iu,
    );
  });

  // A9 · V5: el propio piso del backend tiene que sobrevivir a su guard.
  it('ambos textos pasan V5 con el estado más pobre posible', () => {
    const nada = materializeStateFactsV1({
      intake: undefined, planned_payment_reported: false,
    });
    for (const text of [TECHNICAL_FALLBACK_TEXT_V1, HUMAN_REVIEW_NOTICE_TEXT_V1]) {
      expect(unsupportedOperationalAssertionsV1(text, nada)).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/technical-fallback.test.ts
```
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementación mínima**

```ts
/**
 * El único copy visible que el backend puede emitir (A3). No vende, no
 * interpreta y no pide datos: existe para que un fallo técnico no termine en
 * silencio.
 *
 * Reemplaza a LAST_RESORT_OPENING —«Seguimos por acá. Contame cómo puedo
 * ayudarte.»—, que después de un «ya pagué» simulaba conversación y le pedía
 * al cliente que repitiera lo que ya había dicho.
 */
export const TECHNICAL_FALLBACK_TEXT_V1 =
  'Recibí tu mensaje, pero tuve una demora para procesarlo. '
  + 'Probá nuevamente en unos segundos.';

/**
 * Segundo fallo consecutivo. Si la causa del rechazo es determinista,
 * reintentar produce el mismo N3 y el cliente entra en un bucle de disculpas
 * técnicas. Este texto sólo puede entregarse DESPUÉS de que el commit de la
 * derivación fue exitoso (O2): afirma un hecho, y afirmarlo sin haberlo
 * escrito sería exactamente el defecto que este trabajo elimina.
 *
 * Dice «registrada», no «marcada para revisión del equipo», y no nombra a
 * nadie. No hay bandeja monitoreada: lo único que ocurre de verdad es que la
 * conversación queda consultable (T0.9). Prometer atención o respuesta
 * humana sería la misma clase de mentira que P4 y P5, con otra ropa.
 */
export const HUMAN_REVIEW_NOTICE_TEXT_V1 =
  'Sigo teniendo un inconveniente para procesar tu consulta. '
  + 'Dejé registrada la conversación para revisión.';

export interface TechnicalFallbackV1 {
  readonly text: string;
  readonly requests_human_review: boolean;
  readonly next_consecutive_count: 1 | 2;
}

export function resolveTechnicalFallbackV1(input: {
  readonly consecutive_technical_fallbacks: number;
  readonly human_review_already_requested: boolean;
}): TechnicalFallbackV1 {
  if (input.consecutive_technical_fallbacks === 0) {
    return {
      text: TECHNICAL_FALLBACK_TEXT_V1,
      requests_human_review: false,
      next_consecutive_count: 1,
    };
  }
  return {
    text: HUMAN_REVIEW_NOTICE_TEXT_V1,
    // Máximo una derivación activa por conversación.
    requests_human_review: !input.human_review_already_requested,
    next_consecutive_count: 2,
  };
}
```

- [ ] **Step 4: Correr y ver el verde**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/technical-fallback.test.ts
```
Esperado: PASS, 10 tests.

- [ ] **Step 5: Reemplazar `LAST_RESORT_OPENING` en el ensamblador**

En `canonical-response-assembler.ts`, borrar la constante de la línea 166 y usar `TECHNICAL_FALLBACK_TEXT_V1` en el retorno de la 365. El ensamblador no consulta el contador: cuando llega ahí ya no hay contenido, y contar es del servicio.

- [ ] **Step 6: Correr los tests del ensamblador**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/
```
Esperado: PASS. El test de `404bc8c` que recorre los 18 `response_goal` sigue verde con el texto nuevo.

- [ ] **Step 7: Commit**

```bash
git add src/features/conversation/domain/technical-fallback.ts \
        src/features/conversation/domain/canonical-response-assembler.ts \
        tests/unit/conversation/technical-fallback.test.ts
git commit -m "feat(agent-a): el piso técnico nombra la falla en vez de simular conversación"
```

---

### Task 0.8: Cero silencios — N3 en el sitio de supresión, con O1–O3

Es donde el silencio existe hoy: `decision.service.ts:788` pone `finalResponse = null` y el turno desaparece.

**Files:**
- Modify: `src/lib/services/decision.service.ts:772-796, 1080-1130`
- Create: `tests/integration/conversation/commit-before-outbound.test.ts`
- Modify: `tests/unit/botpress/brain-unavailable.test.ts`

**Interfaces:**
- Consumes: `resolveTechnicalFallbackV1` (T0.7), `materializeStateFactsV1` (T0.2), `unsupportedOperationalAssertionsV1` (T0.3), `request_human_review` (T0.6).

- [ ] **Step 1: Escribir el test de integración que falla**

```ts
// tests/integration/conversation/commit-before-outbound.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('ningún turno entrante termina en silencio', () => {
  it('una supresión de egress entrega N3 en vez de nada', async () => {
    // El defecto medido: EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED
    // anulaba el turno entero. 4 supresiones en 88 turnos de línea base.
    await ingestInbound(conversationId, '¿cuáles son las opciones de pago?');
    const outbound = await outboundMessagesFor(conversationId);

    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.content).toBe(TECHNICAL_FALLBACK_TEXT_V1);
  });

  it('la caída del proveedor entrega N3, no copy enlatado', async () => {
    // BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK se conserva: lo único que cambia
    // es que ahora hay un turno visible.
    withBrainProvider(() => { throw new Error('DEEPSEEK_TIMEOUT'); });
    await ingestInbound(conversationId, 'hola');
    const outbound = await outboundMessagesFor(conversationId);

    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.content).toBe(TECHNICAL_FALLBACK_TEXT_V1);
  });

  it('el segundo fallo consecutivo deriva y el aviso sale después del commit', async () => {
    withBrainProvider(() => { throw new Error('DEEPSEEK_TIMEOUT'); });
    await ingestInbound(conversationId, 'hola');
    await ingestInbound(conversationId, '¿estás?');

    const outbound = await outboundMessagesFor(conversationId);
    expect(outbound.at(-1)!.content).toBe(HUMAN_REVIEW_NOTICE_TEXT_V1);

    const state = await loadState(conversationId);
    expect(state.human_review_requested_at).not.toBeNull();
    expect(state.consecutive_technical_fallbacks).toBe(2);
  });

  // O2 · O3 · A9. El invariante central: un mensaje que afirma un estado y
  // una transacción que no lo escribió no pueden coexistir.
  it('si el commit de la derivación falla, no se afirma que fue realizada', async () => {
    withBrainProvider(() => { throw new Error('DEEPSEEK_TIMEOUT'); });
    await ingestInbound(conversationId, 'hola');

    // Fallo inyectado en la escritura durable, no en la entrega.
    const spy = vi.spyOn(PostgresConversationStateStoreV1.prototype, 'transition')
      .mockRejectedValueOnce(new Error('INJECTED_COMMIT_FAILURE'));

    await ingestInbound(conversationId, '¿estás?').catch(() => undefined);
    spy.mockRestore();

    const outbound = await outboundMessagesFor(conversationId);
    expect(outbound.map((m) => m.content)).not.toContain(HUMAN_REVIEW_NOTICE_TEXT_V1);

    const state = await loadState(conversationId);
    expect(state.human_review_requested_at).toBeNull();
  });

  // O2 sobre la afirmación comercial, no sólo sobre la derivación.
  it('si el commit del estado falla, no sale un mensaje que diga «Registré tus datos»', async () => {
    const spy = vi.spyOn(PostgresConversationStateStoreV1.prototype, 'transition')
      .mockRejectedValueOnce(new Error('INJECTED_COMMIT_FAILURE'));

    await ingestInbound(conversationId, 'Ana Pérez, ana@example.com, +15551234567')
      .catch(() => undefined);
    spy.mockRestore();

    const outbound = await outboundMessagesFor(conversationId);
    expect(outbound.map((m) => m.content).join(' ')).not.toMatch(/registr[ée]\s+tus\s+datos/iu);
  });

  it('un turno exitoso posterior reinicia el contador', async () => {
    restoreBrainProvider();
    await ingestInbound(conversationId, 'quiero saber de barista');
    expect((await loadState(conversationId)).consecutive_technical_fallbacks).toBe(0);
  });

  it('un opt-out sigue produciendo silencio deliberado, sin N3', async () => {
    // A7: el piso cubre el fallo técnico, no la decisión de callar. El
    // silencio intencional está permitido y se conserva: sólo el ack del
    // opt-out sale, y ningún turno posterior recibe nada.
    await ingestInbound(optOutConversationId, 'no me escribas más');
    await ingestInbound(optOutConversationId, 'hola');
    expect(await outboundMessagesFor(optOutConversationId)).toHaveLength(1);
  });

  it('un contacto que optó por salir no recibe N3 ni con el proveedor caído', async () => {
    // El caso peligroso: el piso técnico se instala en la ruta de fallo, y
    // esa ruta no debe poder escribirle a quien pidió no ser contactado.
    // Romper el silencio por un timeout sería peor que el silencio.
    withBrainProvider(() => { throw new Error('DEEPSEEK_TIMEOUT'); });
    await ingestInbound(optOutConversationId, '¿hola?');
    expect(await outboundMessagesFor(optOutConversationId)).toHaveLength(1);
  });

  it('un contacto bloqueado tampoco recibe el piso técnico', async () => {
    withBrainProvider(() => { throw new Error('DEEPSEEK_TIMEOUT'); });
    await ingestInbound(blockedConversationId, 'hola');
    expect(await outboundMessagesFor(blockedConversationId)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

```bash
npm run test:integration -- tests/integration/conversation/commit-before-outbound.test.ts
```
Esperado: FAIL — el primer test recibe `[]` en vez de un mensaje.

- [ ] **Step 3: Implementación mínima**

Primero, el contador tiene que estar leído **antes** de la rama de supresión, porque esa rama anula `preparedPipeline` y con él todo el estado que traía. Cerca de `:438`, junto a `preparedPipeline`:

```ts
// El contador de fallbacks sobrevive a la supresión. `preparedPipeline` no:
// la rama de :796 lo anula, y con él se iría la única lectura del estado.
const pipelineStateBefore = await new PostgresConversationStateStoreV1(db)
  .load(workspaceSlug, turn.conversation_id, turn.contact_id);
let technicalFallback: TechnicalFallbackV1 | null = null;
```

Luego, en la rama `else` de la supresión (`decision.service.ts:772-796`), en vez de `finalResponse = null`:

```ts
// El silencio deja de ser un resultado posible (A7). El turno sigue siendo
// una supresión desde el punto de vista comercial —no se compromete ninguna
// acción, ningún hecho, ninguna proyección— pero el cliente recibe el piso
// técnico en vez de nada.
const fallback = resolveTechnicalFallbackV1({
  consecutive_technical_fallbacks: pipelineStateBefore?.consecutive_technical_fallbacks ?? 0,
  human_review_already_requested: pipelineStateBefore?.human_review_requested_at != null,
});
decision = parseDecisionAnyVersion({
  ...decision,
  kind: 'respond',
  response: fallback.text,
  response_type: 'clarification',
  business_action: null,
  memory_candidates: [],
  missing_information: [],
  next_state: 'completed',
  reason_code: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED',
  confidence: 1,
});
finalResponse = fallback.text;
technicalFallback = fallback;
// La acción, los hechos y la proyección siguen anulados: sólo el texto cambia.
authorizedUrls = [];
authorizedProtectedFacts = [];
authorizedEgress = null;
committedBusinessAction = null;
preparedPipeline = null;
effectiveAuthorizedOfferingCode = null;
egressSuppressed = true;
```

Y en el bloque de transición (`:1113-1128`), la parte que hace cumplir O1–O3. Hoy `if (preparedPipeline)` saltea la escritura cuando la supresión anuló el pipeline; ahora el contador **tiene** que escribirse igual, por la vía angosta:

```ts
if (preparedPipeline) {
  // Camino normal. O1: los hechos de estado de este turno se materializaron
  // desde ESTA transición, no desde el estado ya persistido.
  await new PostgresConversationStateStoreV1(db).transition({
    ...preparedPipeline.transition,
    // Un turno exitoso reinicia el contador.
    consecutive_technical_fallbacks: 0,
    request_human_review: false,
  });
} else if (technicalFallback) {
  // Turno técnico. No hay nada comercial que escribir, sólo el contador y,
  // en el segundo consecutivo, la derivación.
  await new PostgresConversationStateStoreV1(db).recordTechnicalFallbackV1({
    workspace_slug: workspaceSlug,
    conversation_id: turn.conversation_id,
    contact_id: turn.contact_id,
    source_turn_id: turn.id,
    consecutive_technical_fallbacks: technicalFallback.next_consecutive_count,
    request_human_review: technicalFallback.requests_human_review,
  });
}
```

**Por qué esto es O2 y no una convención.** El `INSERT` del outbound ocurre en `:934-957` sobre el mismo handle `db`, y el encolado al outbox también. Si cualquiera de las dos escrituras de arriba lanza, la transacción entera revierte y el mensaje se va con ella: nunca se entrega una afirmación cuyo commit falló. El test del Step 1 con `mockRejectedValueOnce` lo prueba en vez de asumirlo — el orden textual (mensaje antes de estado) hace que la única garantía sea la transacción, y una garantía que depende de una transacción hay que ejercitarla con un fallo real.

Aplicar el mismo `technicalFallback` en la ruta `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`. **No** llamar a `modelUnavailableFallback`: el test `brain-unavailable.test.ts:28` lo prohíbe y ese contrato se conserva.

- [ ] **Step 4: Actualizar `brain-unavailable.test.ts`**

Su premisa —«resuelve ambas rutas de fallo con la misma decisión silenciosa»— era correcta cuando el silencio era la política. Ahora la política es N3. Reescribir las aserciones para que exijan que **ambas** rutas resuelvan con el mismo `resolveTechnicalFallbackV1`, conservando intacto el tercer test (`modelUnavailableFallback` confinado a un solo call site).

- [ ] **Step 5: Correr y ver el verde**

```bash
npm run test:integration -- tests/integration/conversation/commit-before-outbound.test.ts
npm run test:unit && npm run test:integration
```
Esperado: PASS, 9 tests nuevos y la suite completa verde.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/decision.service.ts \
        tests/integration/conversation/commit-before-outbound.test.ts \
        tests/unit/botpress/brain-unavailable.test.ts
git commit -m "feat(agent-a): el silencio deja de ser un resultado posible

La supresión de egress anulaba el turno entero: 4 de 88 turnos de la línea
base terminaban sin nada. Ahora entrega N3, y el segundo fallo consecutivo
deriva a revisión del equipo con la marca escrita ANTES de afirmarla.

O2 con fallo inyectado: si la transición revierte, el outbound se va con
ella. Una mentira respaldada por un commit fallido sería peor que el
defecto que esto elimina."
```

---

### Task 0.9: Cómo consulta un operador las revisiones pendientes (D1)

Tu condición pide demostrarlo, no afirmarlo. Y como **no hay bandeja monitoreada**, lo honesto es entregar dos superficies reales y decir con todas las letras que no son una bandeja: una consulta SQL documentada y probada, y un contador en el endpoint de operaciones que ya existe.

**Files:**
- Create: `docs/operaciones/revisiones-pendientes.md`
- Modify: `src/features/observability/adapters/probes.ts` (`probeDerivedBacklog`)
- Modify: `src/app/api/diagnostics/route.ts` (sin cambio de forma: el probe ya viaja en el cuerpo)
- Test: `tests/integration/observability/pending-human-reviews.test.ts`

**Interfaces:**
- Consumes: `conversation_sales_context_states_v1.human_review_requested_at` (T0.6).
- Produces:
```ts
// Se suma al backlog derivado que /api/diagnostics ya publica.
readonly pending_human_reviews: number;
```

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/integration/observability/pending-human-reviews.test.ts
import { describe, expect, it } from 'vitest';
import { probeDerivedBacklog } from '@/features/observability/adapters/probes';
import { pendingHumanReviewsQueryV1 } from '@/features/observability/adapters/probes';

describe('las revisiones pendientes son consultables', () => {
  it('la consulta documentada devuelve la conversación derivada', async () => {
    await deriveToHumanReview(conversationId);          // helper de T0.6
    const rows = await db.unsafe(pendingHumanReviewsQueryV1, [workspaceId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.conversation_id).toBe(conversationId);
    expect(rows[0]!.human_review_requested_at).not.toBeNull();
  });

  it('la consulta no expone PII', () => {
    // Un operador necesita saber QUÉ conversación revisar, no quién es.
    // El nombre y el correo se leen abriendo la conversación, con el
    // control de acceso de esa ruta, no en un listado de operaciones.
    expect(pendingHumanReviewsQueryV1).not.toMatch(/\b(name|email|phone)\b/iu);
  });

  it('el probe de backlog cuenta las revisiones pendientes', async () => {
    await deriveToHumanReview(conversationId);
    const probe = await probeDerivedBacklog();
    expect(probe.detail.pending_human_reviews).toBe(1);
  });

  it('una conversación que nunca se derivó no aparece', async () => {
    expect((await probeDerivedBacklog()).detail.pending_human_reviews).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — `pendingHumanReviewsQueryV1` no existe.

- [ ] **Step 3: Implementar la consulta y el contador**

```sql
-- pendingHumanReviewsQueryV1
SELECT
  s.conversation_id,
  s.contact_id,
  s.human_review_requested_at,
  s.consecutive_technical_fallbacks,
  s.stage,
  s.selected_offering_code,
  s.selected_payment_plan,
  s.payment_reported_at
FROM conversation_sales_context_states_v1 AS s
WHERE s.workspace_id = $1
  AND s.human_review_requested_at IS NOT NULL
ORDER BY s.human_review_requested_at ASC;
```

Sin `contacts`: identifica la conversación, no a la persona.

- [ ] **Step 4: Escribir `docs/operaciones/revisiones-pendientes.md`**

Tiene que decir, sin adornos:

1. **Qué es y qué no es.** La derivación registra la conversación; no avisa a nadie. No hay bandeja, no hay notificación, no hay SLA. Alguien tiene que ir a mirar.
2. **Cómo mirar, hoy:** el `psql` con la consulta de arriba, y `GET /api/diagnostics` con `Authorization: Bearer $CRON_SECRET` para el contador `pending_human_reviews`.
3. **Qué ve el cliente** cuando esto pasa, textual — para que un operador entienda qué se le prometió y qué no: nada.
4. **Que no hay cierre.** No existe todavía la forma de marcar una revisión como atendida. Una conversación derivada queda contada hasta que se agregue esa capacidad.

El punto 4 es una limitación real y va escrita: un contador que sólo sube deja de ser útil el día que llegue a treinta. **Lo dejo anotado como deuda explícita, no lo resuelvo acá** — cerrar revisiones es una capacidad de operación con su propia superficie, y meterla de contrabando en este plan sería exactamente el ensanchamiento de alcance que el trabajo evita.

- [ ] **Step 5: Correr y ver el verde**

```bash
npm run test:integration -- tests/integration/observability/pending-human-reviews.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/features/observability/adapters/probes.ts \
        docs/operaciones/revisiones-pendientes.md \
        tests/integration/observability/pending-human-reviews.test.ts
git commit -m "feat(agent-a): una revisión derivada se puede consultar, y se dice que no avisa"
```

---

### Task 0.10: Harness — métricas por turno y replay reproducible

**Files:**
- Modify: `scripts/lib/agent-a-conversation-runner.ts`
- Modify: `scripts/run-agent-a-conversations.ts`
- Modify: `botpress-agent/evals/personas/studyx-agent-a-conversational-baseline.json`

**Interfaces:**
- Produces:
```ts
export type TechnicalFallbackReasonV1 =
  | 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED'
  | 'BRAIN_UNAVAILABLE'
  | 'ASSEMBLED_CONTENT_INVALID'
  | 'SCHEMA_UNPARSEABLE'
  | 'REPAIR_FAILED';   // sólo alcanzable desde la Fase 2

export interface TurnMetricsV1 {
  readonly case_id: string;
  readonly turn_index: number;
  readonly visible_message_count: number;
  readonly silent: boolean;                 // 0 mensajes y sin opt-out
  /** D1: un turno con N3 es un FALLO conversacional, no un éxito. */
  readonly technical_fallback: boolean;
  readonly technical_fallback_reason: TechnicalFallbackReasonV1 | null;
  readonly repaired: boolean;               // llegó a N2 y validó (Fase 2)
  readonly repair_attempted: boolean;
  readonly human_review_requested: boolean;
  readonly latency_ms: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly false_operational_promises: readonly string[];
  readonly visible_call_offers: number;
  readonly ledger_entries: number;
}

export interface RunMetricsV1 {
  readonly turns: readonly TurnMetricsV1[];
  readonly p50_ms: number;
  readonly p95_ms: number;
  /** D1 · las cuatro que tu condición pide medir. */
  readonly technical_fallback_count: number;
  readonly technical_fallback_by_reason: Readonly<Record<TechnicalFallbackReasonV1, number>>;
  readonly repair_rate: number;             // repair_attempted ÷ turnos
  readonly repair_success_rate: number;     // repaired ÷ repair_attempted
  readonly human_review_count: number;
  /** Turnos que contestaron de verdad. N3 NO entra en el numerador. */
  readonly conversational_success_rate: number;
}
```

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/unit/scripts/turn-metrics.test.ts
import { describe, expect, it } from 'vitest';
import { summarizeRunMetricsV1 } from '../../../scripts/lib/agent-a-conversation-runner';

describe('métricas por turno', () => {
  // Un caso que falla por un turno dejaba de contar los otros cuatro. La
  // varianza 18/15/16 sobre el MISMO commit venía en parte de eso.
  it('cuenta cada turno, no cada caso', () => {
    const m = summarizeRunMetricsV1([
      { case_id: 'base_01', turn_index: 0, visible_message_count: 1, /* … */ },
      { case_id: 'base_01', turn_index: 1, visible_message_count: 0, silent: true, /* … */ },
    ]);
    expect(m.turns).toHaveLength(2);
  });

  it('p95 se calcula sobre turnos visibles', () => { /* … */ });

  // D1: la condición central. Que el cliente reciba algo no es que el agente
  // haya contestado. Si N3 contara como éxito, este trabajo se «mediría» como
  // una mejora de 4 casos por el solo hecho de romper el silencio.
  it('un turno con N3 no cuenta como silencio, pero tampoco como éxito', () => {
    const m = summarizeRunMetricsV1([
      turn({ visible_message_count: 1, technical_fallback: true,
             technical_fallback_reason: 'BRAIN_UNAVAILABLE' }),
      turn({ visible_message_count: 1, technical_fallback: false }),
    ]);
    expect(m.turns.filter((t) => t.silent)).toHaveLength(0);
    expect(m.technical_fallback_count).toBe(1);
    expect(m.conversational_success_rate).toBe(0.5);
  });

  it('agrupa los fallbacks por motivo', () => {
    const m = summarizeRunMetricsV1([
      turn({ technical_fallback: true, technical_fallback_reason: 'BRAIN_UNAVAILABLE' }),
      turn({ technical_fallback: true, technical_fallback_reason: 'BRAIN_UNAVAILABLE' }),
      turn({ technical_fallback: true,
             technical_fallback_reason: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED' }),
    ]);
    expect(m.technical_fallback_by_reason.BRAIN_UNAVAILABLE).toBe(2);
    expect(m.technical_fallback_by_reason.EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED).toBe(1);
  });

  it('cuenta las derivaciones a revisión', () => {
    const m = summarizeRunMetricsV1([
      turn({ technical_fallback: true, human_review_requested: false }),
      turn({ technical_fallback: true, human_review_requested: true }),
    ]);
    expect(m.human_review_count).toBe(1);
  });

  it('la tasa de reparación exitosa se calcula sobre los turnos que llegaron a N2', () => {
    // Denominador repair_attempted, no turnos totales: un turno que nunca
    // necesitó reparación no habla de si la reparación funciona.
    const m = summarizeRunMetricsV1([
      turn({ repair_attempted: true, repaired: true }),
      turn({ repair_attempted: true, repaired: false }),
      turn({ repair_attempted: false, repaired: false }),
    ]);
    expect(m.repair_rate).toBeCloseTo(2 / 3);
    expect(m.repair_success_rate).toBe(0.5);
  });

  it('detecta promesas operativas falsas escaneando el texto entregado', () => {
    // §12: «oraciones que V5 habría bloqueado en el texto entregado».
    // Escaneo post-entrega, no una regex comercial nueva (A8).
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — `summarizeRunMetricsV1 is not exported`.

- [ ] **Step 3: Implementar `summarizeRunMetricsV1` y el escaneo post-entrega**

El escaneo reutiliza `unsupportedOperationalAssertionsV1` contra los hechos materializados de ese turno. No se agrega ninguna expresión regular comercial nueva (A8).

- [ ] **Step 4: Separar el caso de caída técnica**

`fail_13` mide indisponibilidad del proveedor, no conducta comercial. Marcarlo en el JSON con `"category": "technical"` y excluirlo del denominador comercial, reportándolo aparte.

- [ ] **Step 5: Congelar contextos para replay**

Volcar el `AgentAContextV1` de cada turno de una corrida a `artifacts/frozen-contexts/<run-id>.jsonl` y agregar `--replay <path>` al runner, que reejecuta el modelo contra esos contextos exactos. Es lo que permite iterar el prompt con el prompt como única variable (Fase 3).

- [ ] **Step 6: Correr y ver el verde**

```bash
npx vitest run --config vitest.config.mts tests/unit/scripts/turn-metrics.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/agent-a-conversation-runner.ts scripts/run-agent-a-conversations.ts \
        botpress-agent/evals/personas/studyx-agent-a-conversational-baseline.json \
        tests/unit/scripts/turn-metrics.test.ts .gitignore
git commit -m "test(agent-a): la unidad de medida es el turno, no el caso"
```

---

### Task 0.11: Confirmar flags de producción y correr el gate

- [ ] **Step 1: Confirmar con qué flags corre producción**

```bash
grep -rn "CONVERSATION_PIPELINE_V1_ENABLED\|AGENT_A_BRAIN_V1_ENABLED" \
  --include=".env*" --include="*.json" --include="*.md" . | grep -v node_modules
```
Registrar el resultado en el plan. **Si producción corre con `AGENT_A_BRAIN_V1_ENABLED=false`, frenar y reportar:** todo este trabajo está sobre la ruta autoritativa y no tendría efecto.

- [ ] **Step 2: Correr los siete gates**

```bash
npm run lint && npm run typecheck && npm --prefix botpress-agent run typecheck \
  && npm --prefix botpress-agent run check && npm run test:unit && npm run test:integration
```

- [ ] **Step 3: Tres corridas consecutivas sobre el mismo commit**

```bash
for i in 1 2 3; do
  npm run test:agent-a -- --persona studyx-agent-a-conversational-baseline \
    --out "artifacts/runs/fase0-$i.json"
done
```

## Gate Fase 0

| Criterio | Umbral | Fuente |
|---|---|---|
| Silencios **no deliberados** | **0** | `messages` |
| Silencio por opt-out o bloqueo | **conservado** — nunca recibe N3 | `messages` + test de T0.8 |
| Promesas operativas falsas | **0** | escaneo post-entrega |
| Varianza de casos entre 3 corridas | ≤ ±1 | `artifacts/runs/fase0-{1,2,3}.json` |
| `technical_fallback_count` | **medido y desglosado por motivo** | `RunMetricsV1` |
| `human_review_count` | medido | `RunMetricsV1` |
| Revisiones pendientes consultables | consulta y contador verdes | T0.9 |
| Ciudad / estado / ZIP en el repositorio | **0 ocurrencias** | guard de T0.4 |
| Prompt sin instrucciones que V5 bloquee | test verde | `canonical-prompt-v2.test.ts` |
| Replay reproducible | contextos congelados reejecutan | `--replay` |
| Los siete gates | verdes | CI local |

**Lo que este gate deliberadamente NO exige.** No pone umbral a `conversational_success_rate` ni a `technical_fallback_count`. La Fase 0 no mejora la conversación: elimina contradicciones y hace visible lo que estaba oculto. Con N3 contando como fallo (D1), es esperable que la tasa de éxito medida **empeore** respecto de la línea base 18/15/16 — no porque el agente conteste peor, sino porque antes 4 turnos de 88 desaparecían sin contarse como nada. Un gate que exigiera mejora acá empujaría a maquillar el número.

**Umbral decidido.** `technical_fallback_count` ≤ 2 % de los turnos es condición dura del **gate de la Fase 2**, no del de la Fase 0. Línea base medida: 4 supresiones en 88 turnos ≈ 4,5 %.

**Rollback Fase 0:** revertir el prompt a v1 (`git revert` del commit de T0.5 + `npm run generate:agent-a-prompt`). No hay flag; los cambios de V5, N3, la derivación y el barrido de D3 son correcciones de defecto, no conducta opcional. La migración queda: es aditiva y no estorba (R3).

---

# FASE 1 — Recorte de contexto y medición

Reducida a una tarea por D2. La medición se conserva entera: es lo que produce el número que decide si la Fase 2 arranca.

---

### Task 1.1: `capabilities.intake_missing`

**Files:**
- Modify: `botpress-agent/src/lib/conversation/agent-a-context.ts:378-390`
- Modify: `botpress-agent/src/schemas/agent-a-brain.ts` (AgentAContextV1)
- Modify: `src/features/conversation/adapters/agent-a-brain-schema.ts` (espejo)
- Modify: `src/lib/config.ts` (flag `AGENT_A_CONTEXT_SCOPING`)
- Test: `tests/unit/botpress/agent-a-context-scoping.test.ts`

**Interfaces:**
- Consumes: `missingContactIntakeFieldsV1`, `ClaimedTurn.contact_intake`.
- Produces: `capabilities.intake_missing: readonly ('nombre'|'apellido'|'correo'|'telefono')[]`.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('recorte de contexto por alcanzabilidad', () => {
  it('anuncia qué falta de los cuatro campos, no de seis', () => {
    const ctx = buildAgentAContextV1(claimWithIntake({ nombre: 'Ana' }), null);
    expect(ctx!.capabilities.intake_missing)
      .toEqual(['apellido', 'correo', 'telefono']);
  });

  it('con el intake completo la lista queda vacía', () => {
    expect(buildAgentAContextV1(claimWithFullIntake(), null)!
      .capabilities.intake_missing).toEqual([]);
  });

  it('nunca incluye curso ni plan: no son datos de intake', () => {
    // Vienen del estado canónico (P2). Ponerlos acá reabriría el contrato.
    const ctx = buildAgentAContextV1(claimWithIntake({}), null);
    expect(ctx!.capabilities.intake_missing).not.toContain('curso');
    expect(ctx!.capabilities.intake_missing).not.toContain('plan');
  });

  // Estos ya pasan hoy. Se fijan para que el recorte existente no se pierda.
  it('no expone planes de pago sin curso resuelto', () => {
    expect(buildAgentAContextV1(claimWithoutOffering(), null)!
      .catalog.payment_plans).toEqual([]);
  });

  it('nunca recorta la conversación, la memoria ni el estado comercial', () => {
    const ctx = buildAgentAContextV1(claimWithoutOffering(), null)!;
    expect(ctx.turn.batch_messages.length).toBeGreaterThan(0);
    expect(ctx.commercial_state.payment_reported).toBeDefined();
    expect(ctx.catalog.areas.length).toBeGreaterThan(0);
  });

  it('con el flag apagado, intake_missing queda vacío y nada más cambia', () => {
    // R1: el cambio de conducta entra apagado.
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — `intake_missing` no existe en el schema.

- [ ] **Step 3: Implementar** — agregar el campo al schema de ambos espejos y calcularlo desde `claimed.contact_intake`, detrás de `AGENT_A_CONTEXT_SCOPING`.

- [ ] **Step 4: Correr y ver el verde** + paridad de espejos.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-a): el modelo sabe qué datos le faltan, en vez de deducirlo"
```

---

### Task 1.2: Medición

- [ ] **Step 1: Tres corridas con el flag apagado** → línea base.
- [ ] **Step 2: Tres corridas con `AGENT_A_CONTEXT_SCOPING=true`.**
- [ ] **Step 3: Calcular** tasa de rechazo, tasa de reparación esperada, p50/p95, tokens, varianza.
- [ ] **Step 4: Registrar** el resultado en `docs/architecture/` junto a la especificación.

## Gate Fase 1

| Tramo | Tasa de reparación | Acción |
|---|---|---|
| Pasa | ≤ 10 % | seguir a Fase 2 |
| Advertencia | 10–15 % | pasa, se registra la advertencia y se revisa el recorte |
| Bloqueo | > 15 % | **bloquea la Fase 2** y reabre la decisión de arquitectura |

En los tres tramos, **p95 < 6 s es condición dura**. Varianza entre corridas ≤ ±1 caso.

**Rollback Fase 1 (D2):** `AGENT_A_CONTEXT_SCOPING=false` — `intake_missing` vuelve a lista vacía y el modelo deduce lo que falta como hoy, que es exactamente el comportamiento anterior. **El flag gobierna únicamente lo nuevo.** El recorte preexistente de `payment_plans` y `selected_offering` no tiene flag y no lo va a tener: darle uno significaría escribir un modo sin recorte que hoy no existe, es decir construir a propósito el camino peor para poder volver a él. Su rollback es `git revert`.

El mismo criterio rige en la Fase 2: `AGENT_A_REPAIR_ENABLED` gobierna la reparación —conducta nueva— y nada más.

---

# FASE 2 — Propuesta → validación → reparación

Sólo arranca si el gate de la Fase 1 no la bloqueó.

---

### Task 2.1: `TurnRejectionV1` y paridad de espejos

**Files:**
- Create: `src/features/conversation/domain/turn-rejection.ts`
- Create: `src/features/conversation/adapters/turn-rejection-schema.ts`
- Create: `botpress-agent/src/schemas/turn-rejection.ts`
- Modify: el test de paridad de espejos existente
- Test: `tests/unit/conversation/turn-rejection.test.ts`

**Interfaces:**
- Produces:
```ts
export type TurnRejectionCodeV1 =
  | 'FACT_NOT_AUTHORIZED' | 'FACT_VALUE_MISMATCH' | 'ACTION_NOT_AUTHORIZED'
  | 'MISSING_INTAKE' | 'CALL_BUDGET_EXHAUSTED'
  | 'UNSUPPORTED_OPERATIONAL_CLAIM' | 'PLAN_NOT_SELECTED' | 'COURSE_NOT_RESOLVED';

export interface TurnRejectionV1 {
  readonly schema_version: 1;
  readonly rejection_id: string;
  readonly attempt: 1;
  readonly rejections: readonly {
    readonly code: TurnRejectionCodeV1;
    /** Identificador o código. NUNCA una frase para el cliente (A4). */
    readonly subject: string;
  }[];
  readonly authorized_alternatives: {
    readonly fact_ids: readonly string[];
    readonly actions: readonly string[];
    readonly missing_information: readonly string[];
  };
}
```

- [ ] **Step 1: Test que falla** — el central:

```ts
it('nunca contiene prosa para el cliente', () => {
  // A4: el backend devuelve identificadores, códigos y listas. No dice
  // «pedile que elija un curso»; dice COURSE_NOT_RESOLVED. Cómo se dice
  // sigue siendo de DeepSeek.
  const rejection = buildTurnRejectionV1(/* … */);
  for (const { subject } of rejection.rejections) {
    expect(subject).not.toMatch(/\s(?:que|para|cuando|porque)\s/iu);
    expect(subject).toMatch(/^[a-z0-9_:.-]+$/iu);
  }
});

it('attempt es siempre 1: no hay segundo reintento (A5)', () => {
  expect(buildTurnRejectionV1(/* … */).attempt).toBe(1);
});
```

- [ ] **Steps 2–5:** ver fallo → implementar → verde → commit.

```bash
git commit -m "feat(agent-a): un rechazo devuelve códigos, no instrucciones de redacción"
```

---

### Task 2.2: `stage_hypothesis` y `repair_of`

**Files:** `botpress-agent/src/schemas/agent-a-brain.ts`, `src/features/conversation/adapters/agent-a-brain-schema.ts`, test de paridad.

Test clave: `stage_hypothesis` **no persiste y no autoriza nada** (§09) — se registra para diagnóstico y el hito duro sigue saliendo de la evidencia durable.

```bash
git commit -m "feat(agent-a): la etapa es hipótesis del modelo; el hito es del backend"
```

---

### Task 2.3: El validador devuelve rechazos en vez de sólo podar

**Files:** `botpress-agent/src/lib/conversation/agent-a-brain.ts:736-845`

`buildSafeAgentABrainCompositionV1` se parte en dos: `validateAgentATurnProposalV1` (V1–V7, devuelve `TurnRejectionV1 | null`) y la composición, que conserva la poda. Riesgo alto de regresión: este archivo carga el comportamiento de `082aadf` y `404bc8c`. **Ningún test existente se ajusta para pasar.**

```bash
git commit -m "refactor(agent-a): validar y componer dejan de ser la misma función"
```

---

### Task 2.4: Decisión N1 frente a N2

N1 se intenta primero; su resultado se acepta sólo si conserva al menos un párrafo **y** el turno resultante sigue respondiendo la intención detectada. Un rechazo de `proposed_action` nunca es podable: va directo a N2.

```bash
git commit -m "feat(agent-a): podar sólo si lo que queda todavía contesta"
```

---

### Task 2.5: N2 — la reparación única, apagada

**Files:** `botpress-agent/src/workflows/processInboundTurn.ts:880-895`, `src/lib/config.ts`

Detrás de `AGENT_A_REPAIR_ENABLED`, **apagada** (R1). Tests: una sola reparación (A5), revalidación completa V1–V8 incluido el egress (A6), y que reparación fallida cae a N3 (nunca a silencio, R2).

```bash
git commit -m "feat(agent-a): una reparación, ninguna más"
```

---

### Task 2.6: Observabilidad del rechazo

**Files:** `scripts/lib/rejected-draft-sink.ts`, `.gitignore`

Sumidero único, artefacto local, gitignored. Se redactan nombre, apellido, correo y teléfono **antes** de escribir. Se guarda texto redactado, `rejection_id`, códigos y conjunto autorizado. El borrador rechazado **no** entra en `messages` productivos. Tabla con TTL: sólo si la Fase 3 la justifica.

Test clave: `no escribe PII ni siquiera cuando el borrador la contiene` — con un borrador que incluye los cuatro campos, ninguno aparece en el archivo.

```bash
git commit -m "feat(agent-a): el borrador rechazado se diagnostica sin guardar quién era"
```

---

## Gate Fase 2

| Criterio | Umbral |
|---|---|
| Silencios | 0 en 20 casos × 3 corridas |
| Turnos en una sola llamada | ≥ 95 % |
| p95 extremo a extremo | < 6 s |
| Reparación exitosa | ≥ 80 % de los turnos que llegan a N2 |
| `technical_fallback_count` | **≤ 2 % de los turnos** (línea base ≈ 4,5 %) |
| Paridad de espejos | test verde para los dos contratos nuevos |
| Los 15 casos del flujo mínimo | estables en 3 corridas |

Acá sí hay umbral sobre los fallbacks, y no en la Fase 0: la Fase 2 es la que agrega N1 y N2, o sea la que efectivamente **reduce** las causas por las que un turno cae al piso técnico. Exigir el número antes de construir la reparación sería exigirlo a la fase que no tiene con qué cumplirlo.

**Rollback Fase 2:** `AGENT_A_REPAIR_ENABLED=false` — el rechazo vuelve a N1/N3. Sin silencio (R2).

---

# FASE 3 — Ruta única e iteración de prompt

---

### Task 3.1: Retirar el compositor Gemini y la ruta pre-pipeline

Bajo flag. Se conservan planner, registro de hechos, ensamblador y egress. La ruta duplicada **no se borra** hasta que la ruta única pase su gate en tres corridas (R5).

```bash
git commit -m "refactor(agent-a): una sola ruta escribe el turno"
```

### Task 3.2: Eliminar `modelUnavailableFallback`

Nueve regex sobre el texto del cliente que producían saludos, líneas de identidad y respuestas de precio. Con N3 en pie, no tiene razón de existir. El test de contención de `brain-unavailable.test.ts:37` pasa de «un call site» a «cero».

```bash
git commit -m "refactor(agent-a)!: nueve regex dejan de escribir en nombre del agente"
```

### Task 3.3: Iterar el prompt

Recién acá. Con visibles y contextos congelados; el prompt como única variable. Los held-out los escribe un agente independiente fuera de este worktree y no se leen antes de la evaluación final.

**Protocolo de revelación.** De un held-out fallido llegan exactamente cuatro campos —categoría del fallo, gate incumplido, turno, capa probable— y nunca el texto. El procedimiento es reproducir esa clase de fallo con un caso visible nuevo y arreglarlo ahí. Un held-out revelado se retira del conjunto y el agente independiente escribe uno nuevo para reemplazarlo.

## Gate Fase 3

| Criterio | Umbral |
|---|---|
| Rutas activas | 1 |
| Regresión en los 15 casos del flujo mínimo | 0 |
| Held-out | sin caída respecto de la Fase 2 |
| Naturalidad | ≥ 18/20 |
| Iniciativa preservada | ≥ 1 caso donde el modelo propone un movimiento válido que el planner no habría elegido |

**Rollback Fase 3:** reactivar `CONVERSATION_PIPELINE_V1_ENABLED` como kill switch hasta el retiro definitivo.

---

# Rollback consolidado

| Nivel | Mecanismo | Deja silencio |
|---|---|---|
| R1 · conducta nueva | flag apagado por defecto | no |
| R2 · reparación | `AGENT_A_REPAIR_ENABLED=false` → N1/N3 | **no** |
| R2 · recorte | `AGENT_A_CONTEXT_SCOPING=false` | no |
| R3 · esquema | una migración, aditiva; no se revierte | — |
| R4 · prompt | revert de T0.5 + `npm run generate:agent-a-prompt` | no |
| R5 · ruta duplicada | no se borra hasta que la única pase su gate ×3 | no |

**R6 · El rollback se conserva hasta que el held-out y el canary estén verdes.** Es una condición de retiro, no de encendido, y alcanza a todos los niveles de arriba: ningún flag se elimina del código, la ruta duplicada no se borra, `modelUnavailableFallback` no se retira y el prompt v1 no sale del repositorio antes de que **ambas** señales estén verdes. Que una fase pase su gate habilita seguir; no habilita quedarse sin vuelta atrás.

Consecuencia práctica sobre el orden de las tareas: **T3.1 y T3.2 dejan de poder cerrarse dentro de la Fase 3.** Retiran caminos de rollback, así que su borrado definitivo queda detrás de R6 aunque el código nuevo ya esté activo — se desactivan por flag en la Fase 3 y se eliminan después. El commit 19 (`nueve regex dejan de escribir en nombre del agente`) pasa a ser una desactivación, y el borrado va en un commit posterior a R6.

El canary no está definido en esta especificación y **no lo defino acá**: definirlo sería abrir una decisión de rollout que el plan no tiene. Se especifica al llegar al rollout de la Fase 3, con la misma regla que el resto — gate medible antes de avanzar.

---

# Criterios de aceptación finales

- [ ] Cero silencios no deliberados en 20 casos × 3 corridas
- [ ] p95 extremo a extremo < 6 s
- [ ] ≥ 95 % de turnos resueltos en una sola llamada
- [ ] Reparación exitosa ≥ 80 % de los turnos que llegan a N2
- [ ] Cero promesas operativas falsas en todas las transcripciones
- [ ] Un link por contacto y una fila de operador por contacto, bajo replay
- [ ] Ofertas de llamada visibles = entradas del ledger, máximo dos
- [ ] Los 15 casos del flujo mínimo estables en 3 corridas consecutivas
- [ ] Naturalidad ≥ 18/20
- [ ] Variación entre corridas del mismo commit ≤ ±1 caso
- [ ] El prompt no contiene ninguna instrucción que V5 bloquearía
- [ ] Ningún outbound entregado afirma un estado cuyo commit durable falló (fallo inyectado)
- [ ] Máximo una derivación activa por conversación, verificada bajo replay
- [ ] Cero ocurrencias de ciudad, estado, código postal o «nombre completo» en el repositorio (D3)
- [ ] Cero promesas de PDF, archivo, link, plazo o mensaje futuro en el prompt (P11)
- [ ] N3 contabilizado como fallo en toda métrica y todo gate (D1)
- [ ] Las revisiones pendientes son consultables, y la documentación dice que el sistema no avisa
- [ ] Iniciativa preservada: ≥ 1 caso donde DeepSeek propone un movimiento comercial válido que el planner no habría elegido por sí solo

---

# Resumen de commits

| # | Tarea | Mensaje |
|---|---|---|
| 1 | T0.1 | `docs(agent-a): la frontera de autoridad entra al repositorio` |
| 2 | T0.2 | `feat(agent-a): cuatro hechos de estado, ninguno más` |
| 3 | T0.3 | `feat(agent-a): una frase es válida por el estado, no por la cadena` |
| 4 | T0.4 | `fix(agent-a)!: ciudad, estado y ZIP dejan de existir` |
| 5 | T0.5 | `feat(agent-a)!: el prompt deja de ordenar lo que el guard borra` |
| 6 | T0.6 | `feat(agent-a): la derivación a revisión humana es durable e idempotente` |
| 7 | T0.7 | `feat(agent-a): el piso técnico nombra la falla en vez de simular conversación` |
| 8 | T0.8 | `feat(agent-a): el silencio deja de ser un resultado posible` |
| 9 | T0.9 | `feat(agent-a): una revisión derivada se puede consultar, y se dice que no avisa` |
| 10 | T0.10 | `test(agent-a): la unidad de medida es el turno, y N3 es un fallo` |
| 11 | T1.1 | `feat(agent-a): el modelo sabe qué datos le faltan, en vez de deducirlo` |
| 12 | T2.1 | `feat(agent-a): un rechazo devuelve códigos, no instrucciones de redacción` |
| 13 | T2.2 | `feat(agent-a): la etapa es hipótesis del modelo; el hito es del backend` |
| 14 | T2.3 | `refactor(agent-a): validar y componer dejan de ser la misma función` |
| 15 | T2.4 | `feat(agent-a): podar sólo si lo que queda todavía contesta` |
| 16 | T2.5 | `feat(agent-a): una reparación, ninguna más` |
| 17 | T2.6 | `feat(agent-a): el borrador rechazado se diagnostica sin guardar quién era` |
| 18 | T3.1 | `refactor(agent-a): una sola ruta escribe el turno` |
| 19 | T3.2 | `refactor(agent-a)!: nueve regex dejan de escribir en nombre del agente` |

**Migraciones: una sola.** `20260902010001_agent_a_human_review_and_fallback_counter.sql`, aditiva.
