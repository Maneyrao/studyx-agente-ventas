# Agente A — autoridad única de redacción y de decisión

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar exactamente un componente con autoridad para redactar (DeepSeek) y exactamente uno con autoridad para decidir (el planner V1), sin perder seguridad, idempotencia ni catálogo canónico.

**Architecture:** El commit `1a0ff5c` ya degradó cuatro capas de sustitución a fallback en el camino feliz. Quedan dos lugares donde otro componente todavía escribe o decide: el motor léxico de `decision-policy.ts` (se activa cuando DeepSeek falla) y la tabla `sales_context_states` (participa en la materialización de pago). Este plan los retira, mueve la identidad al contexto estructurado, calibra la ventana de sesión con datos reales, implementa el multi-mensaje que la migración bloquea, y convierte la evaluación conversacional en un gate de CI para que el resultado se sostenga.

**Tech Stack:** TypeScript, Next.js 16, PostgreSQL/Supabase, Botpress ADK, Vitest, DeepSeek `deepseek-v4-flash`.

**Spec:** La misión de sesión del 2026-08-31 (síntomas de producción 1–5, objetivos A–D, gates de calidad) más `docs/AGENT_A_MULTI_MESSAGE_CONTRACT.md` para la Tarea 6.

**Punto de partida:** branch `codex/agent-a-chanl-evals`, commit `1a0ff5c`, worktree limpio.

## Global Constraints

- Migraciones **sólo aditivas**. Nunca editar una ya aplicada (`20260623000001` … `20260806010009`).
- Integración **sólo** contra `TEST_DATABASE_URL` en `127.0.0.1`, puertos `54322`/`55432`-`55435`, base `studyx_test`. `DATABASE_URL` de `.env.local` es **producción**: nunca usarla.
- El prompt canónico `docs/prompts/studyx-agent-a-canonical.md` no se resume ni se reescribe. Sólo se resuelven sus variables de identidad.
- Planes autorizados: lista cerrada `monthly_12`, `monthly_6`, `one_time`. Precio total canónico USD 360. Ningún otro plan, beca, descuento ni medio de pago.
- Los links de pago los resuelve exclusivamente el backend desde configuración de Stripe. Ningún componente los escribe, copia ni acepta del modelo.
- Un filtro puede **descartar** un hecho o un mensaje; **nunca puede escribir uno**. Esta es la regla que separa seguridad de sustitución.
- Máximo dos ofrecimientos de llamada por conversación; ninguno después de que la persona elija chat o rechace.
- Idempotencia: un turno produce como máximo una acción comercial, un link y una proyección, sin importar cuántas veces se reejecute el commit.
- Un test que falla se arregla en el código, nunca debilitando el test. Si un test se relaja, se justifica por escrito en el commit.
- No hacer push, deploy, migraciones remotas ni pruebas reales en Telegram salvo en la Tarea 8, y sólo con aprobación explícita.
- Verificación por tarea, en este orden y no antes: focal del archivo → suite de la carpeta → integración afectada. Suite completa + typecheck + lint sólo al cerrar la tarea.

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `docs/evals/2026-XX-agent-a-conversational-baseline.md` | Evidencia de las 12 conversaciones. Crear. | 1 |
| `botpress-agent/src/utils/brain-unavailable.ts` | Único fallback ante caída del cerebro. Sin léxico, sin claims comerciales. Crear. | 2 |
| `botpress-agent/src/utils/decision-policy.ts:85-160` | `modelUnavailableFallback` deja de gobernar el camino V1. Modificar. | 2 |
| `botpress-agent/src/workflows/processInboundTurn.ts:1055-1075` | El `catch` del pipeline usa el nuevo fallback. Modificar. | 2 |
| `src/lib/services/decision.service.ts:495-600` | La materialización de pago deja de leer el store legacy en el camino V1. Modificar. | 3 |
| `botpress-agent/src/schemas/agent-a-brain.ts:35-90` | `AgentAContextV1` gana bloque `identity`. Modificar. | 4 |
| `src/features/orchestration/application/claim-batch.ts` | El claim publica la identidad del workspace. Modificar. | 4 |
| `botpress-agent/src/prompts/agent-a-brain-v1.ts` | La identidad viene del contexto, no de `process.env`. Modificar. | 4 |
| `src/features/conversation/domain/conversation-planner.ts:36-82` | Ventana de sesión configurable y calibrada. Modificar. | 5 |
| `supabase/migrations/2026XXXXXXXXXX_agent_decision_outbound_parts.sql` | Migración aditiva multi-mensaje. Crear. | 6 |
| `src/features/conversation/domain/canonical-response-assembler.ts` | Devuelve `parts[]` en vez de `content`. Modificar. | 6 |
| `tests/evals/agent-a-conversational-gates.eval.test.ts` | Gates de calidad determinísticos en CI. Crear. | 7 |

---

### Task 1: Línea base conversacional real

Sin esto todo lo demás es especulación. Ninguna corrección posterior se justifica sin una regresión demostrada aquí.

**Files:**
- Create: `docs/evals/2026-08-31-agent-a-conversational-baseline.md`
- Read only: `scripts/run-agent-a-conversations.ts`

**Interfaces:**
- Produces: un documento con 12 transcripciones y su puntuación por gate. Las Tareas 2, 3 y 5 citan filas de este documento como justificación.

- [ ] **Step 1: Exportar el entorno correcto**

Sin esto se ejerce el camino legacy y no se reproduce ni se valida nada. `loadConversationPipelineConfig` devuelve `false` salvo el literal `'true'`.

```bash
export CONVERSATION_PIPELINE_V1_ENABLED=true
export AGENT_A_ADVISOR_NAME='<nombre real del asesor>'
export AGENT_A_ACADEMY_NAME='StudyX'
export TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test'
```

Verificar que el flag llegó:

```bash
node -e "console.log(process.env.CONVERSATION_PIPELINE_V1_ENABLED)"
```

Esperado: `true`.

- [ ] **Step 2: Leer el runner antes de usarlo**

Leer `scripts/run-agent-a-conversations.ts` completo. Anotar: cómo recibe los casos, si pega contra DeepSeek real o contra un stub, y qué imprime. No asumir.

- [ ] **Step 3: Correr las 12 conversaciones**

Los 12 guiones son exactamente los síntomas de producción más los gates de la misión:

| # | Guion |
|---|---|
| 1 | `Buenas tardes` con estado previo curso + plan + link enviado |
| 2 | `¿Ese link que enviaste es el del pago?` con link ya enviado |
| 3 | `Acá te lo pasé` |
| 4 | `¿Qué pago me estás dando?` con plan ya elegido |
| 5 | curso → oferta de llamada → `Prefiero seguir por chat` → pregunta pendiente |
| 6 | dos consultas de precio consecutivas con distinta redacción |
| 7 | `¿cuánto sale?` antes de la Fase 3 |
| 8 | `es caro` |
| 9 | `¿me lo podés cobrar por transferencia?` |
| 10 | `¿tengo que saber algo antes de empezar?` |
| 11 | `quiero el de barista` seguido de `mejor el de redes` |
| 12 | `dale, mandame el link` → pago → `ya pagué` |

```bash
npm run test:agent-a
```

- [ ] **Step 4: Puntuar cada conversación**

Para cada una, registrar los ocho gates de la misión con SÍ/NO y la cita textual que lo justifica:

```
responde la pregunta actual | no revive curso previo | no repite pregunta contestada
| no usa copy prohibido | no hay dos respuestas idénticas | tono comercial cordial
| siguiente paso coherente | naturalidad 1-10
```

Naturalidad, continuidad y ausencia de repetición se puntúan 1–10. El umbral de la misión es 9.

- [ ] **Step 5: Escribir el documento de evidencia**

Estructura obligatoria por conversación: guion, transcripción completa, tabla de gates, y una línea `VEREDICTO: PASA | REGRESIÓN: <descripción>`. Al final, una lista numerada de regresiones demostradas. Esa lista es el único input autorizado para las tareas siguientes.

- [ ] **Step 6: Commit**

```bash
git add docs/evals/2026-08-31-agent-a-conversational-baseline.md
git commit -m "docs(agent-a): línea base conversacional de 12 turnos con DeepSeek real"
```

---

### Task 2: Retirar el motor léxico del camino de falla

`botpress-agent/src/utils/decision-policy.ts:85` es un motor de reglas: nueve regex sobre el texto del cliente que producen frases en español ya escritas. Se dispara en el `catch` del pipeline V1 (`processInboundTurn.ts:1071`), o sea cada vez que DeepSeek timeoutea o pega rate limit. Es el quinto redactor.

**DECISIÓN QUE REQUIERE APROBACIÓN ANTES DE EMPEZAR.** Hay dos salidas y no son equivalentes:

- **(A) Mensaje de espera único, recomendada.** Una sola frase honesta, sin ninguna afirmación comercial: *"Dame un momento, en breve te respondo."* No responde nada falso y el turno queda marcado para que el siguiente lo retome. El cliente no queda en silencio.
- **(B) Pausa en `retry_pending`.** El turno no responde nada y espera. Es el idioma que el repo ya usa para entrega ambigua (`.claude/rules/botpress.md`). Más puro, pero deja al cliente sin respuesta durante un incidente de proveedor.

El resto de esta tarea asume (A). Si se elige (B), los Steps 3 y 4 cambian.

**Files:**
- Create: `botpress-agent/src/utils/brain-unavailable.ts`
- Create: `tests/unit/botpress/brain-unavailable.test.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts:1055-1075`
- Modify: `tests/unit/botpress/decision-policy.test.ts` si asserta copy léxico en el camino V1

**Interfaces:**
- Consumes: `Decision`, `ClaimedTurn`, `BrainFailureReason` de `botpress-agent/src/utils/decision-policy.ts`.
- Produces: `brainUnavailableDecision(reason: BrainFailureReason): Decision` con `response_type: 'technical_fallback'` y `next_state: 'waiting_user'`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// tests/unit/botpress/brain-unavailable.test.ts
import { describe, expect, it } from 'vitest';
import { brainUnavailableDecision } from '../../../botpress-agent/src/utils/brain-unavailable';

const REASONS = ['timeout', 'rate_limited', 'invalid_schema', 'policy_rejected'] as const;

describe('brain unavailable decision', () => {
  it('emits the same honest holding message for every failure reason', () => {
    const responses = new Set(REASONS.map((reason) => brainUnavailableDecision(reason).response));

    expect(responses.size).toBe(1);
    expect([...responses][0]).toBe('Dame un momento, en breve te respondo.');
  });

  it('never makes a commercial claim, names a course or emits a link', () => {
    for (const reason of REASONS) {
      const { response } = brainUnavailableDecision(reason);
      expect(response).not.toMatch(/https?:\/\//u);
      expect(response).not.toMatch(/USD|cuota|pago|precio|curso|diplomado/iu);
    }
  });

  it('leaves the turn open so the next one answers the real question', () => {
    const decision = brainUnavailableDecision('rate_limited');

    expect(decision.next_state).toBe('waiting_user');
    expect(decision.business_action).toBeNull();
    expect(decision.reason_code).toBe('BRAIN_UNAVAILABLE_RATE_LIMITED');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/brain-unavailable.test.ts
```

Esperado: FAIL con `Cannot find module '.../brain-unavailable'`.

- [ ] **Step 3: Implementar el mínimo**

Antes de escribir, leer `botpress-agent/src/utils/decision-policy.ts:39-60` para copiar la forma exacta de `Decision` que usa `technicalFallback()`.

```typescript
// botpress-agent/src/utils/brain-unavailable.ts
import type { Decision } from '../schemas/contracts'
import type { BrainFailureReason } from './decision-policy'

/**
 * Único texto autorizado cuando el cerebro no está disponible.
 *
 * Un incidente de proveedor no habilita a otro componente a redactar. El
 * motor léxico anterior producía saludos, respuestas de precio y frases de
 * preferencia de canal a partir de regex sobre el mensaje del cliente: eso es
 * inventar conversación bajo carga, que es justo cuando menos se lo controla.
 * Esta frase no afirma nada comercial y deja el turno abierto.
 */
const HOLDING_MESSAGE = 'Dame un momento, en breve te respondo.'

export function brainUnavailableDecision(reason: BrainFailureReason): Decision {
  return {
    schema_version: 3,
    intent: 'unknown',
    kind: 'reply',
    response: HOLDING_MESSAGE,
    response_type: 'technical_fallback',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    reason_code: `BRAIN_UNAVAILABLE_${reason.toUpperCase()}`,
    confidence: 1,
    retrieval_used: null,
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/brain-unavailable.test.ts
```

Esperado: PASS, 3 tests.

- [ ] **Step 5: Cablear el camino V1 al nuevo fallback**

En `processInboundTurn.ts:1071`, reemplazar:

```typescript
pipelineFailureDecision = modelUnavailableFallback(owned, brainFailureReason)
```

por:

```typescript
pipelineFailureDecision = brainUnavailableDecision(brainFailureReason)
```

Agregar el import. **No tocar** la llamada de la línea 1223: ésa es el camino legacy y se retira en su propia tarea.

- [ ] **Step 6: Test de integración del camino de falla**

Agregar a `tests/unit/botpress/process-inbound-turn-hot-path.test.ts` un caso que fuerce `AgentABrainError` con `code: 'BRAIN_RATE_LIMITED'` y asserte que el saliente es exactamente `HOLDING_MESSAGE` y que no contiene ninguna de las frases del motor léxico:

```typescript
expect(outbound.content).toBe('Dame un momento, en breve te respondo.');
expect(outbound.content).not.toMatch(/asesora virtual|Bien, gracias|Contame qué te gustaría aprender/u);
```

- [ ] **Step 7: Extender el gate de copy prohibido**

En `tests/unit/conversation/prohibited-conversational-copy.test.ts`, agregar al array `PROHIBITED_COPY` las frases del motor léxico que ya no deben poder alcanzar el camino V1. Si el escaneo las sigue encontrando en `decision-policy.ts` porque el camino legacy las usa, acotar el escaneo a los archivos del camino V1 y dejar comentado por qué.

- [ ] **Step 8: Verificar y commitear**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress tests/unit/conversation
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' npm run test:integration
npm run typecheck && npm run lint
git add -A
git commit -m "fix(agent-a): un solo mensaje honesto ante caída del cerebro, sin motor léxico"
```

---

### Task 3: Quitarle al estado legacy la autoridad sobre el pago

`sales_context_states` y `conversation_sales_context_states_v1` coexisten. La legacy no es sólo paralela: `decision.service.ts:502` la lee y su `selected_payment_plan` alimenta `materializePaymentLinkAction`. Después de un saludo de reapertura, V1 queda limpio y la legacy no, así que la legacy todavía puede decidir **qué plan** se materializa.

**Files:**
- Modify: `src/lib/services/decision.service.ts:495-600`
- Test: `tests/integration/conversation-pipeline-v1.test.ts`

**Interfaces:**
- Consumes: `preparedPipeline.plan.selected_payment_plan` de `prepareConversationPipelineCommitV1`.
- Produces: invariante — en el camino V1, `existingSalesContext` no participa de ninguna decisión comercial. Se sigue **escribiendo** (`decision.service.ts:1106`) para auditoría y compatibilidad.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `tests/integration/conversation-pipeline-v1.test.ts`, continuando la conversación existente:

```typescript
it('ignores a legacy plan that the V1 session already retired', async () => {
  // El saludo cierra la sesión comercial en V1. La tabla legacy conserva
  // monthly_12 del recorrido anterior: no debe poder resucitarlo.
  await commitTurn('Buenas tardes', move('greeting'));

  const legacy = await salesStore.load(workspaceSlug, /* contact */ '');
  expect(legacy?.selected_payment_plan).toBe('monthly_12');

  const state = await stateStore.load(workspaceSlug, /* conversation */ '', /* contact */ '');
  expect(state).toMatchObject({
    selected_offering_code: null,
    selected_payment_plan: null,
    stage: 'exploring',
  });

  // Un pedido de link sin curso ni plan vigente no puede materializar nada.
  const resumed = await commitTurn('dale, mandame el link', move('request_payment_link'));
  expect(resumed.committed.outbound?.content).not.toContain(paymentLinks.monthly_12);
  expect(resumed.committed.outbound?.content).not.toContain(paymentLinks.monthly_6);
});
```

Completar los tres argumentos vacíos con los ids reales del `claimed` del turno, como hacen los tests vecinos del archivo.

- [ ] **Step 2: Correr y verificar que falla**

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' \
  npx vitest run --config vitest.integration.config.mts tests/integration/conversation-pipeline-v1.test.ts
```

Esperado: FAIL. Anotar el mensaje exacto: si falla en el assert del link, la legacy tuvo autoridad; si falla antes, el planner no reseteó y el problema es otro.

- [ ] **Step 3: Implementar el mínimo**

En `decision.service.ts`, dentro del bloque de `materializePaymentLinkAction`, condicionar las dos entradas legacy a que no haya pipeline:

```typescript
        // El planner V1 es la única autoridad sobre curso y plan cuando el
        // pipeline está activo. `sales_context_states` sigue escribiéndose
        // para auditoría, pero una sesión que V1 cerró no puede reabrirse
        // desde la tabla legacy.
        deferredPlanCode: preparedPipeline ? null : deferredPlanCode,
        selectedPlanCode: preparedPipeline
          ? preparedPipeline.plan.selected_payment_plan
          : existingSalesContext?.selected_payment_plan ?? null,
```

Revisar también el bloque de `deferredPlanCode` de las líneas 566-575: la rama que lo deriva de `existingSalesContext` debe quedar fuera cuando `preparedPipeline` existe.

- [ ] **Step 4: Correr y verificar que pasa**

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' \
  npx vitest run --config vitest.integration.config.mts tests/integration/conversation-pipeline-v1.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Verificar que no rompió el camino legacy**

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' npm run test:integration
```

Los tests de `delivery-attempt-fencing` y `orchestration-lifecycle` ejercen el camino sin pipeline. Si alguno se pone rojo, la condición está mal puesta: el legacy debe seguir funcionando idéntico.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(agent-a): el estado legacy deja de decidir el plan en el camino V1"
```

---

### Task 4: Identidad desde el contexto estructurado

Hoy `buildAgentABrainInstructionsV1` lee `process.env`. Eso funciona pero pone identidad de negocio en configuración de proceso, no en el contexto que el backend gobierna. La identidad pertenece al workspace.

**Files:**
- Modify: `botpress-agent/src/schemas/agent-a-brain.ts:35-90`
- Modify: `src/features/orchestration/application/claim-batch.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-context.ts:261`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Test: `tests/unit/botpress/agent-a-canonical-prompt-identity.test.ts`, `tests/unit/botpress/agent-a-brain-prompt.test.ts`

**Interfaces:**
- Consumes: `AgentAIdentityV1` de `botpress-agent/src/prompts/agent-a-identity.ts` (ya existe, commit `1a0ff5c`).
- Produces: `AgentAContextV1.identity: { advisor_name: string; academy_name: string; website: string | null; instagram: string | null } | null`. `buildAgentABrainInstructionsV1(context)` vuelve a tener un solo parámetro.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// tests/unit/botpress/agent-a-brain-prompt.test.ts
it('resolves the canonical identity from the structured context, not the process env', () => {
  const withIdentity = context();
  withIdentity.identity = {
    advisor_name: 'Camila', academy_name: 'StudyX',
    website: 'studyx.com', instagram: '@studyx',
  };

  const instructions = buildAgentABrainInstructionsV1(withIdentity);

  expect(instructions).toContain('Sos **Camila**, asesor/a educativo/a de **StudyX**');
  expect(instructions).not.toContain('{{NOMBRE_ASESOR}}');
});

it('ships the canonical prompt verbatim when the workspace declares no identity', () => {
  const instructions = buildAgentABrainInstructionsV1({ ...context(), identity: null });

  expect(instructions).toContain('{{NOMBRE_ASESOR}}');
  expect(instructions).toContain('Never echo an unresolved {{placeholder}}');
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain-prompt.test.ts
```

Esperado: FAIL por propiedad `identity` desconocida en el schema estricto.

- [ ] **Step 3: Extender el schema**

En `botpress-agent/src/schemas/agent-a-brain.ts`, dentro de `AgentAContextV1Schema`, junto a `commercial_state`:

```typescript
  identity: z.object({
    advisor_name: z.string().trim().min(1).max(120),
    academy_name: z.string().trim().min(1).max(240),
    website: z.string().trim().min(1).max(240).nullable(),
    instagram: z.string().trim().min(1).max(120).nullable(),
  }).strict().nullable(),
```

- [ ] **Step 4: Cambiar la firma del builder**

En `agent-a-brain-v1.ts`, quitar el parámetro `environment` y leer `context.identity`:

```typescript
export function buildAgentABrainInstructionsV1(context: AgentAContextV1): string {
  const canonicalPrompt = context.identity === null
    ? STUDYX_AGENT_A_CANONICAL_PROMPT
    : resolveCanonicalPromptIdentityV1(STUDYX_AGENT_A_CANONICAL_PROMPT, context.identity).prompt;
  // … resto igual
}
```

`loadAgentAIdentityV1` se conserva: pasa a usarse en el backend, no acá.

- [ ] **Step 5: Publicar la identidad desde el claim**

En `claim-batch.ts`, junto a `conversationStateV1`, agregar `identity` derivada de `rawBusiness.workspace` más `loadAgentAIdentityV1(process.env)` para el nombre del asesor. Reflejarla en `ClaimedTurn` y propagarla en `buildAgentAContextV1` (`agent-a-context.ts:261`).

Leer primero `buildBusinessContextView` para confirmar qué campos del workspace están disponibles: si `website` o `instagram` ya existen en el catálogo, usarlos de ahí y no del entorno.

- [ ] **Step 6: Correr y verificar que pasa**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' \
  npx vitest run --config vitest.integration.config.mts tests/integration/claim-context.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(agent-a): la identidad del prompt viaja en el contexto autorizado"
```

---

### Task 5: Calibrar la ventana de sesión con datos

`CONVERSATION_SESSION_IDLE_MS = 4h` es un número elegido a mano. La regla robusta —el saludo de reapertura— no depende del tiempo, pero la ventana igual gobierna cuándo vence una pregunta pendiente.

**Files:**
- Modify: `src/features/conversation/domain/conversation-planner.ts:36-82`
- Modify: `src/lib/config.ts`
- Test: `tests/unit/conversation/conversation-session-boundary.test.ts`

**Interfaces:**
- Produces: `loadConversationSessionConfig(env): { sessionIdleMs: number }`, leído de `CONVERSATION_SESSION_IDLE_MINUTES`, con default el valor calibrado.

- [ ] **Step 1: Medir los huecos reales**

Sobre el cluster local sembrado con datos de conversaciones reales (no fixtures):

```sql
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY gap_s) AS p50,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY gap_s) AS p90,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_s) AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_s) AS p99
FROM (
  SELECT EXTRACT(EPOCH FROM (created_at - lag(created_at) OVER (
           PARTITION BY conversation_id ORDER BY conversation_seq))) AS gap_s
  FROM messages WHERE direction = 'inbound'
) AS gaps
WHERE gap_s IS NOT NULL;
```

La ventana debe caer por encima de p95 de los huecos **dentro de un mismo hilo activo** y por debajo del hueco típico entre sesiones distintas. Registrar los cuatro percentiles en el commit.

- [ ] **Step 2: Escribir el test que falla**

```typescript
it('reads the session window from configuration', () => {
  expect(loadConversationSessionConfig({ CONVERSATION_SESSION_IDLE_MINUTES: '90' }))
    .toEqual({ sessionIdleMs: 90 * 60 * 1_000 });
});

it('falls back to the calibrated default for an absent or invalid value', () => {
  expect(loadConversationSessionConfig({}).sessionIdleMs).toBe(CONVERSATION_SESSION_IDLE_MS);
  expect(loadConversationSessionConfig({ CONVERSATION_SESSION_IDLE_MINUTES: 'x' }).sessionIdleMs)
    .toBe(CONVERSATION_SESSION_IDLE_MS);
});

it('never lets configuration exceed the full-state expiry', () => {
  expect(loadConversationSessionConfig({ CONVERSATION_SESSION_IDLE_MINUTES: '9999' }).sessionIdleMs)
    .toBeLessThanOrEqual(CONVERSATION_STATE_MAX_IDLE_MS);
});
```

- [ ] **Step 3: Correr y verificar que falla**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation/conversation-session-boundary.test.ts
```

Esperado: FAIL con `loadConversationSessionConfig is not exported`.

- [ ] **Step 4: Implementar**

Agregar el loader en `src/lib/config.ts` con el clamp contra `CONVERSATION_STATE_MAX_IDLE_MS`, y hacer que `effectiveConversationStateV1` acepte la ventana como tercer parámetro opcional con default `CONVERSATION_SESSION_IDLE_MS`. Ajustar el valor de la constante al percentil medido en el Step 1.

- [ ] **Step 5: Correr, verificar y commitear**

```bash
npx vitest run --config vitest.config.mts tests/unit/conversation
git add -A
git commit -m "fix(agent-a): ventana de sesión configurable y calibrada sobre huecos reales

p50/p90/p95/p99 medidos: <valores>"
```

---

### Task 6: Multi-mensaje real

El contrato completo, los diez invariantes y los seis criterios de aceptación están en `docs/AGENT_A_MULTI_MESSAGE_CONTRACT.md`. Las especificaciones pendientes están en `tests/unit/conversation/agent-a-multi-message-contract.test.ts` marcadas con `describe.todo`. **Leer ambos antes de empezar.** Encenderlas es la definición de terminado.

Bloqueo real: `agent_decisions.outbound_message_id uuid UNIQUE` en `supabase/migrations/20260805010008_phase1_agent_decisions.sql:53`.

**Files:**
- Create: `supabase/migrations/2026XXXXXXXXXX_agent_decision_outbound_parts.sql`
- Modify: `src/features/conversation/domain/canonical-response-assembler.ts`
- Modify: `botpress-agent/src/lib/conversation/agent-a-brain.ts` (`ComposedNarrativeV1` → V2)
- Modify: `src/lib/services/decision.service.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts:1422`
- Test: `tests/unit/conversation/agent-a-multi-message-contract.test.ts`, `tests/integration/delivery-attempt-fencing.test.ts`

**Interfaces:**
- Produces: `assembleCanonicalConversationResponseV1` devuelve `{ parts: readonly string[]; used_fact_ids: readonly string[] }`. `ComposedNarrativeV2 { schema_version: 2; messages: readonly string[]; call_offer: string | null; used_fact_ids: readonly string[] }`.

- [ ] **Step 1: Escribir la migración aditiva**

```sql
CREATE TABLE agent_decision_outbound_parts (
  decision_id  uuid    NOT NULL REFERENCES agent_decisions(id) ON DELETE CASCADE,
  part_index   integer NOT NULL CHECK (part_index >= 0 AND part_index <= 2),
  message_id   uuid    NOT NULL REFERENCES messages(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, part_index)
);

CREATE UNIQUE INDEX agent_decision_outbound_parts_message_uq
  ON agent_decision_outbound_parts (message_id);
```

`agent_decisions.outbound_message_id` se conserva y apunta a la parte 0. No se toca su índice UNIQUE.

- [ ] **Step 2: Aplicar la migración en local y verificar**

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' npm run test:db:reset-loop
npm run test:db:lint
```

- [ ] **Step 3: Encender el primer test pendiente**

En `agent-a-multi-message-contract.test.ts`, cambiar `describe.todo` por `describe` y dejar sólo el primer `it` con cuerpo real: *delivers three ordered parts*. Correr y verificar que falla.

- [ ] **Step 4 en adelante: un invariante por ciclo**

Encender de a un `it` por vez, en este orden, cada uno con su ciclo RED→GREEN→commit completo:

1. tres partes ordenadas (I1, I2)
2. una sola parte se comporta como hoy (compatibilidad)
3. el link en exactamente una parte (I4)
4. diez replays dejan tres mensajes (I5)
5. reintento sólo de la parte fallada (I6)
6. una parte rechazada por el egress guard no arrastra a las otras (I3)
7. la acción comercial se materializa una vez por turno (I9, I10)

**Regla de corte:** si tres intentos sobre el mismo invariante fallan, detenerse y reportar que requiere rediseño. No intentar un cuarto.

- [ ] **Step final: Verificación completa**

```bash
npm run typecheck && npm run lint && npm run test:unit
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' npm run test:integration
npm run test:db:invariants
```

---

### Task 7: Convertir los gates conversacionales en CI

Llegar a 10/10 una vez no sirve si la próxima sustitución vuelve sin que nadie lo note. Los defectos estructurales necesitan aserciones determinísticas, no un juez LLM.

**Files:**
- Create: `tests/evals/agent-a-conversational-gates.eval.test.ts`
- Read only: `tests/evals/aburridont-matrix.eval.test.ts` como patrón
- Modify: `tests/unit/conversation/prohibited-conversational-copy.test.ts`

**Interfaces:**
- Consumes: las 12 transcripciones de la Tarea 1 como fixtures congelados.
- Produces: un gate por cada criterio de la misión, todos determinísticos.

- [ ] **Step 1: Leer el patrón existente**

Leer `tests/evals/aburridont-matrix.eval.test.ts` completo y `vitest.config.mts` para confirmar si `tests/evals` entra en `test:unit` o corre aparte.

- [ ] **Step 2: Escribir los gates determinísticos**

Sobre las transcripciones congeladas de la Tarea 1, un `it` por gate:

```typescript
it('never emits two identical consecutive outbound messages', () => {
  for (const conversation of TRANSCRIPTS) {
    const outbound = conversation.turns.filter((t) => t.direction === 'outbound');
    for (let i = 1; i < outbound.length; i += 1) {
      expect(outbound[i].content).not.toBe(outbound[i - 1].content);
    }
  }
});

it('never answers a greeting with a course, a plan or a link', () => {
  for (const { greetingReply } of TRANSCRIPTS.filter((c) => c.opensWithGreeting)) {
    expect(greetingReply).not.toMatch(/https?:\/\//u);
    expect(greetingReply).not.toMatch(/USD|cuota/iu);
  }
});

it('never offers a call after the customer chose chat or declined', () => {
  for (const conversation of TRANSCRIPTS) {
    const declineAt = conversation.turns.findIndex((t) => t.declinesCall);
    if (declineAt === -1) continue;
    const after = conversation.turns.slice(declineAt + 1).filter((t) => t.direction === 'outbound');
    expect(after.some((t) => /llamada|llamarte|coordinar una llamada/iu.test(t.content))).toBe(false);
  }
});
```

Naturalidad, continuidad y tono se puntúan con juez LLM **como señal complementaria**, nunca como única autoridad, y su umbral (9/10) se registra sin bloquear el build salvo caída de dos puntos respecto de la línea base.

- [ ] **Step 3: Correr, ajustar y commitear**

```bash
npx vitest run --config vitest.config.mts tests/evals
git add -A
git commit -m "test(agent-a): gates conversacionales determinísticos sobre la línea base"
```

---

### Task 8: Cierre — smoke supervisado

**Requiere aprobación explícita antes de cada paso.** Nada acá es reversible solo.

- [ ] **Step 1: Verificación completa sobre el SHA final**

```bash
npm run typecheck && npm run lint && npm run test:unit
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/studyx_test' npm run test:integration
npm run build
```

- [ ] **Step 2: Repetir las 12 conversaciones de la Tarea 1**

Comparar contra la línea base. Requisito de salida: ningún gate que pasaba ahora falla, y todas las regresiones listadas en la Tarea 1 quedan resueltas.

- [ ] **Step 3: Confirmar variables de entorno en destino**

`CONVERSATION_PIPELINE_V1_ENABLED`, `AGENT_A_ADVISOR_NAME`, `AGENT_A_ACADEMY_NAME`, `CONVERSATION_SESSION_IDLE_MINUTES` en Vercel y Botpress. Sin el primero, todo este trabajo queda inactivo.

- [ ] **Step 4: Deploy de Vercel y Botpress sobre el mismo SHA**

Nunca uno sin el otro: el contrato de commit V1 los acopla.

- [ ] **Step 5: Un único smoke en Telegram, conversación nueva y supervisada**

Guion mínimo: saludo → curso → precio → chat → link → pregunta sobre el link. Seis turnos. Si algo se desvía, `automationEnabled = false` y volver a la Tarea 1.

---

## Self-Review

**Cobertura contra el diagnóstico:**

| Brecha identificada | Tarea |
|---|---|
| Motor léxico redactando bajo fallo de proveedor | 2 |
| Estado legacy decidiendo el plan | 3 |
| Identidad desde `process.env` | 4 |
| Ventana de 4 h arbitraria | 5 |
| Multi-mensaje pendiente | 6 |
| Sin validación conversacional | 1, 8 |
| Sin gate que sostenga el resultado | 7 |

**Lo que este plan deliberadamente no hace:** retirar el camino legacy completo (`commercial-router.ts`, 780 líneas). Es un subsistema propio y merece su propio plan. Mientras el flag V1 esté encendido en producción, el legacy no gobierna ninguna conversación real; retirarlo es higiene, no corrección.

**Decisión abierta que bloquea la Tarea 2:** opción (A) mensaje de espera único vs. (B) pausa en `retry_pending`.
