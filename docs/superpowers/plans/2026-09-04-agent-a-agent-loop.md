# Agent A Agent Loop — Plan de implementación (Fases 0-2)

> **Para ejecutores agénticos:** SUB-SKILL REQUERIDA: usá
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`) para seguimiento.

**Goal:** Convertir a Agent A de un generador de propuestas dentro de un rule
engine en un agente real: un núcleo independiente que pide herramientas, recibe
sus resultados, y es dueño del texto y del estado del turno.

**Architecture:** Un núcleo `agent-core/` sin dependencias de Botpress, Next.js
ni Postgres, con cuatro puertos (`ModelProvider`, `ToolExecutor`, `MemoryStore`,
`ChannelAdapter`). La respuesta viaja como bloques tipados —narrativa libre más
referencias a `fact_id` y a artefactos de herramientas—, de modo que un precio o
un link no puedan viajar en prosa. El estado se declara como `state_patch` con
versión esperada, y los campos que dependen de que el cliente haya visto el
mensaje se aplican recién cuando el canal acepta el outbound.

**Tech Stack:** TypeScript, Next.js (App Router), Botpress ADK, PostgreSQL
(Supabase), Vitest, DeepSeek `/responses` con function calling.

**Spec:** `docs/superpowers/specs/2026-09-04-agent-a-agent-loop-design.md`

## Alcance de este plan

Cubre **Fase 0 (base sana), Fase 1 (smoke bloqueante) y Fase 2 (núcleo,
herramientas y commit)**. Al terminarlo el sistema tiene el agent loop completo,
probado y **apagado**: la ruta `plannerless_v2` sigue siendo la que atiende a los
clientes, y nada cambia para ellos.

Las Fases 3-5 (shadow local, shadow productivo, promoción) **no se planifican
acá a propósito**: su contenido depende del resultado del smoke de la Tarea 1.1 y
de las latencias medidas en Fase 2. Planificarlas ahora sería inventar números.

## Global Constraints

Copiadas literalmente de la spec. Aplican a **todas** las tareas.

- **`DATABASE_URL` de `.env.local` es la Supabase de PRODUCCIÓN.** Ningún test,
  script ni comando de este plan la usa. Todo va al cluster desechable:
  `LC_ALL=C bash scripts/pg-native-up.sh 55433`, base `studyx_test` en
  `127.0.0.1:55433`.
- **Todo test de integración exige `TEST_DATABASE_URL`** apuntando a ese cluster.
  `tests/setup/integration.ts` pisa `DATABASE_URL` SIEMPRE, nunca con `??=`.
- **La API key nunca se expone.** No se imprime, no se loguea, no se escribe en
  el ledger ni en evidencia, no se pasa por línea de comandos.
- **El tope de gasto sale de configuración o del ledger**, nunca de una constante
  en el código.
- **`agent-core/` no importa de `botpress-agent/` ni de `src/`.** Es un ciclo de
  dependencia prohibido y la Tarea 2.1 lo hace fallar en CI.
- **El monto de la beca (`699`) nunca puede aparecer en texto recuperable.**
  `BECA_LEAK_PATTERN = /\b699\b/` sigue vigente en dos suites.
- Comandos de test:
  - unitarios: `npx vitest run --config vitest.config.mts <archivo>`
  - integración: `npx vitest run --config vitest.integration.config.mts <archivo>`
  - workflow: `npx vitest run --config vitest.workflow.config.mts <archivo>`
- Gate completo antes de cerrar cada fase: `npm run lint && npm run typecheck &&
  npm run test:unit`.
- **Un commit por tarea.** Nunca mezclar tareas en un commit.

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `scripts/agent-a-api-budget.mjs` | Tope de gasto desde configuración | 0.1 |
| `src/lib/services/decision.service.ts` | No persistir transición sobre texto no entregado | 0.2 |
| `scripts/smoke-deepseek-tools.mjs` | Smoke bloqueante del proveedor | 1.1 |
| `agent-core/src/domain/response-blocks.ts` | `ResponseBlockV3` + renderer puro | 2.1 |
| `agent-core/src/domain/state-patch.ts` | `StatePatchV3` + clasificación de visibilidad | 2.2 |
| `agent-core/src/ports/*.ts` | Los cuatro puertos | 2.3 |
| `agent-core/src/loop.ts` | El ciclo y su presupuesto | 2.3 |
| `src/features/conversation/adapters/postgres-conversation-state-store.ts` | Exponer `version` | 2.4 |
| `supabase/migrations/2026090500000{1,2,3}_*.sql` | Tres migraciones aditivas | 2.5 |
| `src/features/orchestration/domain/agent-loop-rollout.ts` | Resolución de la bandera runtime | 2.6 |
| `src/app/api/agent/tools/*` | Herramientas de lectura y preparación | 2.7, 2.8 |
| `src/features/conversation/domain/integrity-check-v3.ts` | Control final: acepta o devuelve | 2.9 |
| `src/features/conversation/application/commit-agent-turn-v3.ts` | Commit atómico | 2.10 |
| `src/app/api/agent/outbounds/[outbound_id]/delivery/route.ts` | Patch diferido al aceptar | 2.10 |
| `scripts/generate-release-manifest.mjs` | `prompt_sha256` + `tool_contract_version` | 2.11 |
| `tests/helpers/agent-turn-fixtures.ts` | Siembra compartida por ocho tests de integración | 0.2 |
| `supabase/migrations/20260905000004_agent_turn_preparations.sql` | Reservas sin efecto | 2.8 |
| `agent-core/src/loop.ts` (segunda pasada) | Una reparación + fallback técnico | 2.12 |

---

# Fase 0 — Base sana

## Task 0.1: Reparar la suite de presupuesto moviendo el tope a configuración

HEAD tiene **tres tests rojos** en esta suite. `scripts/agent-a-api-budget.mjs:9`
exige `AUTHORIZED_LIMIT_USD = 1.08` hardcodeado y el test construye el ledger con
`limitUsd: 1`, así que toda mutación falla con `AGENT_A_BUDGET_INVALID`. No se
puede hacer TDD sobre una suite roja, y este ledger gobierna el gasto del smoke
de la Tarea 1.1.

**Files:**
- Modify: `scripts/agent-a-api-budget.mjs:9,17`
- Test: `tests/unit/scripts/agent-a-api-budget.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `resolveAuthorizedLimitUsd(environment?: NodeJS.ProcessEnv): number`
  exportada desde `scripts/agent-a-api-budget.mjs`. Lee
  `STUDYX_AGENT_A_BUDGET_LIMIT_USD`; si está ausente devuelve `1.08`. Lanza
  `AGENT_A_BUDGET_LIMIT_INVALID` si el valor no es un número finito mayor a 0.

- [ ] **Step 1: Confirmar el rojo actual**

Run: `npx vitest run --config vitest.config.mts tests/unit/scripts/agent-a-api-budget.test.ts`
Expected: FAIL, `Tests  3 failed | 4 passed (7)`, con
`AssertionError: expected [Function] to throw error including 'timeout' but got 'AGENT_A_BUDGET_INVALID'`.

- [ ] **Step 2: Escribir el test del nuevo contrato de configuración**

Agregar al final de `tests/unit/scripts/agent-a-api-budget.test.ts`:

```ts
import { resolveAuthorizedLimitUsd } from '../../../scripts/agent-a-api-budget.mjs';

describe('authorized limit resolution', () => {
  it('defaults to 1.08 when the environment does not set a limit', () => {
    expect(resolveAuthorizedLimitUsd({})).toBe(1.08);
  });

  it('takes the limit from configuration when present', () => {
    expect(resolveAuthorizedLimitUsd({ STUDYX_AGENT_A_BUDGET_LIMIT_USD: '2.5' })).toBe(2.5);
  });

  it.each(['0', '-1', 'abc', ''])('rejects the invalid configured limit %s', (value) => {
    expect(() => resolveAuthorizedLimitUsd({ STUDYX_AGENT_A_BUDGET_LIMIT_USD: value }))
      .toThrow('AGENT_A_BUDGET_LIMIT_INVALID');
  });
});
```

- [ ] **Step 3: Correrlo y verificar que falla**

Run: `npx vitest run --config vitest.config.mts tests/unit/scripts/agent-a-api-budget.test.ts -t "authorized limit"`
Expected: FAIL con `resolveAuthorizedLimitUsd is not a function`.

- [ ] **Step 4: Implementar la resolución del tope**

En `scripts/agent-a-api-budget.mjs`, reemplazar la línea 9
(`const AUTHORIZED_LIMIT_USD = 1.08;`) por:

```js
const DEFAULT_AUTHORIZED_LIMIT_USD = 1.08;

export function resolveAuthorizedLimitUsd(environment = process.env) {
  const raw = environment.STUDYX_AGENT_A_BUDGET_LIMIT_USD;
  if (raw === undefined) return DEFAULT_AUTHORIZED_LIMIT_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('AGENT_A_BUDGET_LIMIT_INVALID');
  return parsed;
}
```

Y en `mutateLedger`, cambiar la comparación de la línea 17
(`|| ledger.limitUsd !== AUTHORIZED_LIMIT_USD`) por:

```js
      || ledger.limitUsd !== resolveAuthorizedLimitUsd()
```

- [ ] **Step 5: Alinear las fixtures del test con el tope resuelto**

En `tests/unit/scripts/agent-a-api-budget.test.ts`, reemplazar las dos
ocurrencias literales de `limitUsd: 1` por `limitUsd: resolveAuthorizedLimitUsd({})`
y la reserva de `ledger(0.999)` por `ledger(1.079)`, de modo que el caso
«la reserva excede el remanente» siga probando el borde real del tope.

- [ ] **Step 6: Correr la suite completa y verificar verde**

Run: `npx vitest run --config vitest.config.mts tests/unit/scripts/agent-a-api-budget.test.ts`
Expected: PASS, 11 tests, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add scripts/agent-a-api-budget.mjs tests/unit/scripts/agent-a-api-budget.test.ts
git commit -m "fix(agent-a): tomar el tope de gasto de configuracion y reparar la suite"
```

---

## Task 0.2: No persistir una transición calculada sobre texto que no se entregó

El bug §1.4 de la spec. `authorizeAgentTurnV2` calcula la transición sobre el
texto **pre-veto**; un veto parcial de `enforceCommercialTruthV1` deja
`preparedAgentTurn` no-nulo y `decision.service.ts:1259` la escribe igual. Se
persiste `call_offer_count` por una invitación que el cliente nunca recibió.

**Files:**
- Modify: `src/lib/services/decision.service.ts:1259-1262`
- Test: `tests/integration/agent-turn-partial-veto-transition.test.ts` (crear)

**Interfaces:**
- Consumes: `commitAgentDecision` desde `src/lib/services/decision.service.ts`.
- Produces: un nuevo `DecisionPolicyError` con código
  `PARTIAL_VETO_TRANSITION_REFUSED`, lanzado antes de escribir la transición
  cuando `verdict.removed.length > 0` y `preparedAgentTurn !== null`.

- [ ] **Step 1: Levantar el cluster desechable**

```bash
bash scripts/pg-native-down.sh 55433
LC_ALL=C bash scripts/pg-native-up.sh 55433
export TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/studyx_test'
```

- [ ] **Step 2: Crear el helper de fixtures que usan todos los tests de integración**

Crear `tests/helpers/agent-turn-fixtures.ts`. Lo consumen las Tareas 0.2, 2.4,
2.5, 2.6, 2.8, 2.10, 2.12 y 2.14, así que se escribe una sola vez acá:

```ts
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db/orchestrator';

export interface SeededAgentTurn {
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly turn_id: string;
  readonly second_turn_id: string;
  readonly batch_id: string;
  readonly second_batch_id: string;
  readonly claim_token: string;
  readonly trace_id: string;
  readonly state_version: number;
  readonly release_manifest: Record<string, unknown>;
  readonly model: { provider: string; model: string; prompt_version: string };
  readonly placeholderDecision: Record<string, unknown>;
  readonly proposalWithCallOfferAndFalsePrice: Record<string, unknown>;
}

/**
 * Siembra un workspace, un contacto, una conversación y dos turnos entrantes en
 * el cluster DESECHABLE. Nunca toca producción: `tests/setup/integration.ts` ya
 * pisó `DATABASE_URL` con `TEST_DATABASE_URL`.
 */
export async function seedConversationForAgentTurn(options: {
  readonly call_offer_count?: 0 | 1 | 2;
  readonly selected_offering_code?: string | null;
  readonly intake_complete?: boolean;
} = {}): Promise<SeededAgentTurn> {
  const traceId = randomUUID();
  const [workspace] = await sql<Array<{ id: string }>>`
    SELECT id FROM workspaces WHERE slug = 'studyx' AND status = 'active' LIMIT 1
  `;
  if (!workspace) throw new Error('SEED_WORKSPACE_MISSING: correr supabase/seed/studyx.sql');

  const [contact] = await sql<Array<{ id: string }>>`
    INSERT INTO contacts (first_name, last_name, email, phone_e164, status)
    VALUES (
      ${options.intake_complete ? 'Ana' : null},
      ${options.intake_complete ? 'Pérez' : null},
      ${options.intake_complete ? `ana.${traceId}@example.test` : null},
      ${`+54911${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`},
      'activo'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO workspace_contacts (workspace_id, contact_id)
    VALUES (${workspace.id}::uuid, ${contact.id}::uuid)
    ON CONFLICT DO NOTHING
  `;
  const [conversation] = await sql<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel, status)
    VALUES (${contact.id}::uuid, 'whatsapp', 'open')
    RETURNING id
  `;

  const turns: string[] = [];
  const batches: string[] = [];
  for (const [index, text] of ['Hola, quiero info', 'Dale, seguimos'].entries()) {
    const [batch] = await sql<Array<{ id: string; claim_token: string }>>`
      INSERT INTO inbound_batches (conversation_id, due_at, state)
      VALUES (${conversation.id}::uuid, now(), 'open')
      RETURNING id, claim_token
    `;
    const [message] = await sql<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, direction, content, batch_id, conversation_seq)
      VALUES (${conversation.id}::uuid, 'inbound', ${text}, ${batch.id}::uuid, ${index + 1})
      RETURNING id
    `;
    turns.push(message.id);
    batches.push(batch.id);
  }

  await sql`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id, selected_offering_code,
      selected_payment_plan, stage, call_preference, call_offer_status,
      call_offer_count, awaiting_reply
    ) VALUES (
      ${workspace.id}::uuid, ${conversation.id}::uuid, ${contact.id}::uuid,
      ${options.selected_offering_code ?? null}, NULL, 'exploring', 'unknown',
      'not_offered', ${options.call_offer_count ?? 0}, 'none'
    )
    ON CONFLICT (workspace_id, conversation_id) DO NOTHING
  `;
  const [state] = await sql<Array<{ version: number }>>`
    SELECT version FROM conversation_sales_context_states_v1
    WHERE workspace_id = ${workspace.id}::uuid AND conversation_id = ${conversation.id}::uuid
  `;

  const [claim] = await sql<Array<{ claim_token: string }>>`
    SELECT claim_token FROM inbound_batches WHERE id = ${batches[0]}::uuid
  `;

  return {
    workspace_id: workspace.id,
    contact_id: contact.id,
    conversation_id: conversation.id,
    turn_id: turns[0]!,
    second_turn_id: turns[1]!,
    batch_id: batches[0]!,
    second_batch_id: batches[1]!,
    claim_token: claim.claim_token,
    trace_id: traceId,
    state_version: Number(state!.version),
    release_manifest: {
      git_sha: 'a'.repeat(40), botpress_artifact_sha: 'b'.repeat(64),
      prompt_version: 'studyx-agent-a-brain-v21', model: 'deepseek-v4-flash',
      prompt_sha256: 'd'.repeat(64), tool_contract_version: 'agent-tools-v3.0.0',
    },
    model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash', prompt_version: 'studyx-agent-a-brain-v21' },
    placeholderDecision: {
      schema_version: 4, intent: 'commercial', kind: 'reply',
      response: 'El backend preparará la respuesta autorizada.',
      response_type: 'commercial_reply', confidence: 1,
      reason_code: 'CONVERSATION_PIPELINE_V1_PENDING_BACKEND', business_action: null,
      memory_candidates: [], missing_information: [], next_state: 'waiting_user',
      retrieval_used: null,
    },
    // Ofrece llamada Y afirma un precio que el catálogo no respalda: el guard
    // veta la segunda oración y deja viva la primera. Ese veto PARCIAL es el
    // que hoy persiste una transición sobre texto no entregado.
    proposalWithCallOfferAndFalsePrice: {
      schema_version: 1,
      move: { schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [], confidence: 1,
              course_reference: options.selected_offering_code ?? 'diplomado-marketing' },
      response: {
        messages: ['El diplomado sale USD 47.', '¿Te sirve que te llamemos para verlo?'],
        call_offer: null,
      },
      used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      proposed_action: { type: 'none' }, repair_of: null,
    },
  };
}
```

- [ ] **Step 3: Escribir el test RED**

Crear `tests/integration/agent-turn-partial-veto-transition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { sql } from '@/lib/db/orchestrator';

describe('partial commercial-truth veto', () => {
  it('does not persist a transition computed on text that was not delivered', async () => {
    // El turno ofrece una llamada Y afirma un precio inexistente. El guard veta
    // la oración del precio; la invitación sobrevive. La transición se había
    // calculado sobre AMBAS oraciones.
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0,
      selected_offering_code: 'diplomado-marketing',
    });

    await expect(commitAgentDecision({
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      authorized_offering_code: 'diplomado-marketing',
      authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: seeded.proposalWithCallOfferAndFalsePrice,
      },
      decision: seeded.placeholderDecision,
      model: seeded.model,
      batch_id: seeded.batch_id,
      claim_token: seeded.claim_token,
    })).rejects.toThrow('PARTIAL_VETO_TRANSITION_REFUSED');

    const state = await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(state?.call_offer_count).toBe(0);
  });
});
```

- [ ] **Step 4: Correrlo y verificar que falla por la razón correcta**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-turn-partial-veto-transition.test.ts`
Expected: FAIL. El commit **no** lanza y `call_offer_count` quedó en `1`. Ese `1`
es el bug: confirma que el test mide lo que debe.

- [ ] **Step 5: Implementar el rechazo**

En `src/lib/services/decision.service.ts`, inmediatamente antes del bloque
`if (preparedAgentTurn) { await new PostgresConversationStateStoreV1(db).transition(...) }`
de la línea 1259:

```ts
    // La transición se calculó sobre el texto PRE-veto. Si el guard quitó
    // aunque sea una oración, ese cálculo describe un mensaje que el cliente
    // nunca recibió. No se recomputa sobre el texto podado: eso sería el
    // backend eligiendo el estado por su cuenta otra vez. Se rechaza el turno
    // y lo repara el agente.
    if (preparedAgentTurn !== null && egressRemovedSentences) {
      throw new DecisionPolicyError('PARTIAL_VETO_TRANSITION_REFUSED');
    }
```

Y donde hoy se calcula el veredicto (línea ~866, `if (verdict.removed.length > 0)`),
capturar el hecho en una variable que sobreviva al bloque:

```ts
    let egressRemovedSentences = false;
```

declarada junto a `let egressSuppressed = false;` (línea ~806), y asignada
`egressRemovedSentences = verdict.removed.length > 0;` dentro del mismo `if`.

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-turn-partial-veto-transition.test.ts`
Expected: PASS.

- [ ] **Step 7: Correr las suites que tocan el mismo camino**

Run: `npx vitest run --config vitest.workflow.config.mts`
Expected: PASS. Si algún escenario `wf_*` ahora queda mudo, el rechazo está
llegando a un turno que antes se entregaba podado: anotarlo como evidencia de
Fase 3 y **no** aflojar el rechazo.

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/decision.service.ts tests/helpers/agent-turn-fixtures.ts tests/integration/agent-turn-partial-veto-transition.test.ts
git commit -m "fix(agent-a): no persistir una transicion sobre texto no entregado"
```

---

# Fase 1 — Smoke bloqueante del proveedor

## Task 1.1: Verificar function calling real de DeepSeek contra este contrato

**Esta tarea decide el resto del plan.** Si falla, la decisión «function calling
nativo» se revisa antes de escribir una línea del núcleo.

**Files:**
- Create: `scripts/smoke-deepseek-tools.mjs`
- Test: `tests/unit/scripts/smoke-deepseek-tools.test.ts`

**Interfaces:**
- Consumes: `withAgentAApiBudget` y `resolveAuthorizedLimitUsd` de la Tarea 0.1.
- Produces: `buildSmokeRequest(input: { model: string; tools: unknown[] }): object`
  y `classifySmokeOutcome(payload: unknown): { kind: 'function_call' | 'message' | 'incomplete'; call_ids: string[]; reason: string | null }`,
  ambas puras y exportadas.

- [ ] **Step 1: Escribir los tests puros del smoke (sin red)**

Crear `tests/unit/scripts/smoke-deepseek-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSmokeRequest, classifySmokeOutcome } from '../../../scripts/smoke-deepseek-tools.mjs';

describe('smoke request', () => {
  it('never carries the api key inside the request body', () => {
    const body = buildSmokeRequest({ model: 'deepseek-v4-flash', tools: [] });
    expect(JSON.stringify(body)).not.toMatch(/sk-|api[_-]?key/i);
  });

  it('asks for enough output tokens for a two-round tool loop', () => {
    expect(buildSmokeRequest({ model: 'deepseek-v4-flash', tools: [] }).max_output_tokens)
      .toBeGreaterThanOrEqual(1600);
  });
});

describe('smoke outcome', () => {
  it('detects a function_call item and its call_id', () => {
    expect(classifySmokeOutcome({
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'c1', name: 'search_catalog', arguments: '{}' }],
    })).toEqual({ kind: 'function_call', call_ids: ['c1'], reason: null });
  });

  it('detects a plain message as the end of the loop', () => {
    expect(classifySmokeOutcome({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'listo' }] }],
    })).toEqual({ kind: 'message', call_ids: [], reason: null });
  });

  it('surfaces a truncated response instead of pretending it finished', () => {
    expect(classifySmokeOutcome({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
    })).toEqual({ kind: 'incomplete', call_ids: [], reason: 'max_output_tokens' });
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.config.mts tests/unit/scripts/smoke-deepseek-tools.test.ts`
Expected: FAIL, `Cannot find module '.../smoke-deepseek-tools.mjs'`.

- [ ] **Step 3: Implementar las dos funciones puras**

Crear `scripts/smoke-deepseek-tools.mjs`:

```js
export function buildSmokeRequest({ model, tools }) {
  return {
    model,
    instructions: 'Sos un asesor de StudyX. Usá las herramientas disponibles antes de responder.',
    input: 'Quiero saber qué cursos de marketing tienen y cuánto salen.',
    tools,
    reasoning: { effort: 'none' },
    temperature: 0.2,
    stream: false,
    max_output_tokens: 1600,
  };
}

export function classifySmokeOutcome(payload) {
  if (payload?.status === 'incomplete') {
    return { kind: 'incomplete', call_ids: [], reason: payload.incomplete_details?.reason ?? null };
  }
  const calls = (payload?.output ?? []).filter((item) => item?.type === 'function_call');
  if (calls.length > 0) {
    return { kind: 'function_call', call_ids: calls.map((call) => call.call_id), reason: null };
  }
  return { kind: 'message', call_ids: [], reason: null };
}
```

- [ ] **Step 4: Correrlos y verificar que pasan**

Run: `npx vitest run --config vitest.config.mts tests/unit/scripts/smoke-deepseek-tools.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Agregar el runner contra la API real, gobernado por el ledger**

Agregar al final de `scripts/smoke-deepseek-tools.mjs`:

```js
const TOOLS = [{
  type: 'function',
  function: {
    name: 'search_catalog',
    description: 'Busca cursos en el catálogo canónico de StudyX.',
    parameters: {
      type: 'object',
      properties: { area: { type: 'string', description: 'Área temática' } },
      required: ['area'],
    },
  },
}];

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
  if (!process.env.STUDYX_AGENT_A_BUDGET_FILE) throw new Error('AGENT_A_BUDGET_FILE_REQUIRED');
  const model = process.env.STUDYX_SMOKE_MODEL ?? 'deepseek-v4-flash';

  const started = Date.now();
  const response = await fetch('https://api.deepseek.com/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildSmokeRequest({ model, tools: TOOLS })),
  });
  const payload = await response.json();
  const round1 = classifySmokeOutcome(payload);
  // Evidencia SIN credenciales y SIN contenido de cliente: sólo forma y tiempos.
  console.log(JSON.stringify({
    event: 'smoke.round_1', http_status: response.status, model,
    kind: round1.kind, call_count: round1.call_ids.length,
    incomplete_reason: round1.reason, latency_ms: Date.now() - started,
  }));
  if (round1.kind !== 'function_call') throw new Error(`SMOKE_NO_TOOL_CALL:${round1.kind}`);
}

if (process.argv[1]?.endsWith('smoke-deepseek-tools.mjs')) {
  main().catch((error) => { console.error(String(error.message)); process.exit(1); });
}
```

El `import` de `agent-a-api-budget.mjs` vía `STUDYX_AGENT_A_BUDGET_FILE` ya
envuelve `globalThis.fetch` (línea 66-67 de ese archivo), así que la reserva y el
corte de gasto ocurren sin que este script los reimplemente.

- [ ] **Step 6: Correr el smoke real**

```bash
export STUDYX_AGENT_A_BUDGET_FILE="$PWD/.smoke-budget.json"
echo '{"priorSpendUsd":0.38,"limitUsd":1.08,"calls":[]}' > "$STUDYX_AGENT_A_BUDGET_FILE"
node --import ./scripts/agent-a-api-budget.mjs scripts/smoke-deepseek-tools.mjs
```

Expected: una línea JSON con `"kind":"function_call"` y `call_count >= 1`.
Anotar `latency_ms`: es el insumo del presupuesto de §3.2 de la spec.

**PUERTA:** si `kind` no es `function_call`, o si `incomplete_reason` es
`max_output_tokens`, **detener el plan** y volver a la spec. No seguir a la
Fase 2.

- [ ] **Step 7: Registrar la evidencia y commitear**

```bash
mkdir -p docs/evidence
node --import ./scripts/agent-a-api-budget.mjs scripts/smoke-deepseek-tools.mjs \
  > docs/evidence/2026-09-05-deepseek-tools-smoke.jsonl
git add scripts/smoke-deepseek-tools.mjs tests/unit/scripts/smoke-deepseek-tools.test.ts docs/evidence/2026-09-05-deepseek-tools-smoke.jsonl
git commit -m "test(agent-a): smoke de function calling de deepseek con tope del ledger"
```

Verificar antes de commitear que el `.jsonl` **no contiene** la key:
`grep -c 'sk-' docs/evidence/2026-09-05-deepseek-tools-smoke.jsonl` debe dar `0`.
`.smoke-budget.json` **no se commitea**: agregarlo a `.gitignore` si hiciera falta.

---

# Fase 2 — Núcleo, herramientas y commit (todo apagado en producción)

## Task 2.1: Núcleo `agent-core` y bloques tipados con renderer puro

El corazón de la enmienda 2: un precio o un link no pueden viajar en prosa. La
narrativa es libre; los valores comerciales sólo viajan como `fact` o `artifact`.

**Files:**
- Create: `agent-core/src/domain/response-blocks.ts`
- Create: `agent-core/tsconfig.json`
- Test: `tests/unit/agent-core/response-blocks.test.ts`
- Modify: `vitest.config.mts` (incluir `agent-core/src` en el alias de módulos)

**Interfaces:**
- Consumes: nada. El núcleo no importa de `botpress-agent/` ni de `src/`.
- Produces:
  - `type ResponseBlockV3 = { type: 'narrative'; text: string } | { type: 'fact'; fact_id: string } | { type: 'artifact'; preparation_id: string }`
  - `interface ArtifactTableV3 { readonly facts: ReadonlyMap<string, string>; readonly artifacts: ReadonlyMap<string, string> }`
  - `renderBlocksV3(blocks: readonly ResponseBlockV3[], table: ArtifactTableV3): { text: string; missing: readonly string[] }`
  - `narrativeViolationsV3(text: string): readonly ('NARRATIVE_CONTAINS_URL' | 'NARRATIVE_CONTAINS_AMOUNT' | 'NARRATIVE_CONTAINS_DURATION')[]`

- [ ] **Step 1: Escribir los tests del renderer y de la restricción estructural**

Crear `tests/unit/agent-core/response-blocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  narrativeViolationsV3,
  renderBlocksV3,
  type ArtifactTableV3,
} from '../../../agent-core/src/domain/response-blocks';

const table: ArtifactTableV3 = {
  facts: new Map([['fact:price:one_time', 'USD 1200']]),
  artifacts: new Map([['prep-1', 'Link de pago: https://pay.example/abc']]),
};

describe('renderBlocksV3', () => {
  it('materializes facts and artifacts and preserves narrative verbatim', () => {
    expect(renderBlocksV3([
      { type: 'narrative', text: 'Te cuento cómo viene la cursada.' },
      { type: 'fact', fact_id: 'fact:price:one_time' },
      { type: 'artifact', preparation_id: 'prep-1' },
    ], table)).toEqual({
      text: 'Te cuento cómo viene la cursada.\n\nUSD 1200\n\nLink de pago: https://pay.example/abc',
      missing: [],
    });
  });

  it('never alters the narrative it received', () => {
    const original = '  Dale,   perfecto...  ¿arrancamos?  ';
    const { text } = renderBlocksV3([{ type: 'narrative', text: original }], table);
    expect(text).toBe(original.trim());
    expect(text).toContain('Dale,   perfecto...');
  });

  it('reports an unresolved reference instead of dropping it silently', () => {
    expect(renderBlocksV3([{ type: 'fact', fact_id: 'fact:unknown' }], table))
      .toEqual({ text: '', missing: ['fact:unknown'] });
  });
});

describe('narrativeViolationsV3', () => {
  it('rejects a URL in narrative', () => {
    expect(narrativeViolationsV3('Te paso https://pay.example/abc'))
      .toEqual(['NARRATIVE_CONTAINS_URL']);
  });

  it.each(['Sale USD 1200', 'son 1200 usd', 'cuesta $1.200'])('rejects the amount in %s', (text) => {
    expect(narrativeViolationsV3(text)).toContain('NARRATIVE_CONTAINS_AMOUNT');
  });

  it('rejects a course duration in narrative', () => {
    expect(narrativeViolationsV3('Son 38 clases en total'))
      .toEqual(['NARRATIVE_CONTAINS_DURATION']);
  });

  it('allows ordinary sales prose with no commercial value', () => {
    expect(narrativeViolationsV3('Es muy práctico y podés cursarlo a tu ritmo.')).toEqual([]);
  });

  it('allows a plain question with a number that is not a value claim', () => {
    expect(narrativeViolationsV3('¿Arrancamos por el módulo 1?')).toEqual([]);
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/response-blocks.test.ts`
Expected: FAIL, no se resuelve `agent-core/src/domain/response-blocks`.

- [ ] **Step 3: Implementar los bloques y el renderer**

Crear `agent-core/src/domain/response-blocks.ts`:

```ts
export type ResponseBlockV3 =
  | { readonly type: 'narrative'; readonly text: string }
  | { readonly type: 'fact'; readonly fact_id: string }
  | { readonly type: 'artifact'; readonly preparation_id: string };

export interface ArtifactTableV3 {
  readonly facts: ReadonlyMap<string, string>;
  readonly artifacts: ReadonlyMap<string, string>;
}

/**
 * Materializa referencias. No interpreta, no reescribe, no reordena, no poda.
 * Una referencia sin resolver se REPORTA; nunca se descarta en silencio.
 */
export function renderBlocksV3(
  blocks: readonly ResponseBlockV3[],
  table: ArtifactTableV3,
): { readonly text: string; readonly missing: readonly string[] } {
  const parts: string[] = [];
  const missing: string[] = [];
  for (const block of blocks) {
    if (block.type === 'narrative') { parts.push(block.text.trim()); continue; }
    const key = block.type === 'fact' ? block.fact_id : block.preparation_id;
    const source = block.type === 'fact' ? table.facts : table.artifacts;
    const value = source.get(key);
    if (value === undefined) missing.push(key);
    else parts.push(value);
  }
  return { text: parts.filter((part) => part.length > 0).join('\n\n'), missing };
}

const URL_IN_NARRATIVE = /https?:\/\/\S+|\bwww\.\S+/iu;
const AMOUNT_IN_NARRATIVE =
  /(?:\b(?:usd|ars|eur)\s*\$?\s*\d|\$\s*\d|\d[\d.,]*\s*(?:usd|ars|eur|d[oó]lares?)\b)/iu;
const DURATION_IN_NARRATIVE =
  /\b\d+(?:[.,]\d+)?\s*(?:clases?|m[oó]dulos?|semanas?|meses?|a[nñ]os?|horas?)\b/iu;

/**
 * Restricción ESTRUCTURAL de la narrativa. El control de integridad la usa para
 * RECHAZAR, nunca para podar: precios, links y duraciones sólo viajan como
 * `fact` o `artifact`.
 */
export function narrativeViolationsV3(text: string): readonly (
  'NARRATIVE_CONTAINS_URL' | 'NARRATIVE_CONTAINS_AMOUNT' | 'NARRATIVE_CONTAINS_DURATION'
)[] {
  const violations: ('NARRATIVE_CONTAINS_URL' | 'NARRATIVE_CONTAINS_AMOUNT' | 'NARRATIVE_CONTAINS_DURATION')[] = [];
  if (URL_IN_NARRATIVE.test(text)) violations.push('NARRATIVE_CONTAINS_URL');
  if (AMOUNT_IN_NARRATIVE.test(text)) violations.push('NARRATIVE_CONTAINS_AMOUNT');
  if (DURATION_IN_NARRATIVE.test(text)) violations.push('NARRATIVE_CONTAINS_DURATION');
  return violations;
}
```

Crear `agent-core/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "noEmit": true, "paths": {} },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Correrlos y verificar que pasan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/response-blocks.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Escribir el guard de dependencias del núcleo**

Crear `tests/unit/agent-core/no-host-imports.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('agent-core isolation', () => {
  it('never imports from the Botpress agent, the Next app or the database', () => {
    const offenders = tsFiles('agent-core/src').filter((file) => (
      /from\s+['"](?:@\/|.*botpress-agent\/|.*\/src\/lib\/db|postgres|next)/u.test(
        readFileSync(file, 'utf8'),
      )
    ));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 6: Correrlo y verificar que pasa**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/no-host-imports.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agent-core tests/unit/agent-core
git commit -m "feat(agent-core): bloques tipados con renderer puro y aislamiento del nucleo"
```

---

## Task 2.2: `StatePatchV3` y la clasificación inmediato/diferido

La enmienda 5 hecha código: los campos que dependen de que el cliente haya visto
el mensaje no se aplican con el commit.

**Files:**
- Create: `agent-core/src/domain/state-patch.ts`
- Test: `tests/unit/agent-core/state-patch.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `interface StatePatchV3 { readonly expected_state_version: number; readonly set: Partial<StatePatchFieldsV3> }`
  - `type StatePatchFieldsV3 = { selected_offering_code: string | null; selected_payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null; stage: string; call_preference: string; call_offer_status: string; call_offer_delta: 0 | 1; awaiting_reply: string; payment_reported: boolean }`
  - `splitStatePatchV3(patch: StatePatchV3): { immediate: StatePatchV3; deferred: StatePatchV3 }`

- [ ] **Step 1: Escribir los tests de clasificación**

Crear `tests/unit/agent-core/state-patch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { splitStatePatchV3 } from '../../../agent-core/src/domain/state-patch';

describe('splitStatePatchV3', () => {
  it('keeps customer-declared facts in the immediate half', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 7,
      set: { selected_offering_code: 'diplomado-marketing', payment_reported: true },
    });
    expect(immediate.set).toEqual({
      selected_offering_code: 'diplomado-marketing', payment_reported: true,
    });
    expect(deferred.set).toEqual({});
  });

  it('defers everything that depends on the customer seeing the message', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 7,
      set: { call_offer_delta: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' },
    });
    expect(immediate.set).toEqual({});
    expect(deferred.set).toEqual({
      call_offer_delta: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat',
    });
  });

  it('classifies stage by its target value, not by the field name', () => {
    expect(splitStatePatchV3({ expected_state_version: 1, set: { stage: 'course_selected' } })
      .immediate.set).toEqual({ stage: 'course_selected' });
    expect(splitStatePatchV3({ expected_state_version: 1, set: { stage: 'payment_link_sent' } })
      .deferred.set).toEqual({ stage: 'payment_link_sent' });
  });

  it('treats an accepted or declined call offer as customer-declared', () => {
    expect(splitStatePatchV3({ expected_state_version: 1, set: { call_offer_status: 'accepted' } })
      .immediate.set).toEqual({ call_offer_status: 'accepted' });
  });

  it('carries the expected version into both halves', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 42, set: { awaiting_reply: 'contact_details' },
    });
    expect(immediate.expected_state_version).toBe(42);
    expect(deferred.expected_state_version).toBe(42);
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/state-patch.test.ts`
Expected: FAIL, no se resuelve el módulo.

- [ ] **Step 3: Implementar la clasificación**

Crear `agent-core/src/domain/state-patch.ts`:

```ts
export type StatePatchFieldsV3 = {
  selected_offering_code: string | null;
  selected_payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  stage: string;
  call_preference: string;
  call_offer_status: string;
  /** Delta, nunca un total: el contador es del sistema. */
  call_offer_delta: 0 | 1;
  awaiting_reply: string;
  payment_reported: boolean;
};

export interface StatePatchV3 {
  readonly expected_state_version: number;
  readonly set: Partial<StatePatchFieldsV3>;
}

/** Campos que sólo son ciertos si el cliente vio el mensaje. */
const DEFERRED_FIELDS = new Set<keyof StatePatchFieldsV3>([
  'call_offer_delta', 'awaiting_reply',
]);
/** `stage` se clasifica por su VALOR: lo que el agente entregó es diferido. */
const DEFERRED_STAGES = new Set(['payment_link_sent', 'handoff']);
/** `call_offer_status` sólo es diferido cuando afirma haber ofrecido. */
const DEFERRED_CALL_OFFER_STATUS = new Set(['offered']);

function isDeferred(field: keyof StatePatchFieldsV3, value: unknown): boolean {
  if (field === 'stage') return DEFERRED_STAGES.has(String(value));
  if (field === 'call_offer_status') return DEFERRED_CALL_OFFER_STATUS.has(String(value));
  return DEFERRED_FIELDS.has(field);
}

export function splitStatePatchV3(patch: StatePatchV3): {
  readonly immediate: StatePatchV3;
  readonly deferred: StatePatchV3;
} {
  const immediate: Partial<StatePatchFieldsV3> = {};
  const deferred: Partial<StatePatchFieldsV3> = {};
  for (const [field, value] of Object.entries(patch.set) as [keyof StatePatchFieldsV3, never][]) {
    if (value === undefined) continue;
    (isDeferred(field, value) ? deferred : immediate)[field] = value;
  }
  return {
    immediate: { expected_state_version: patch.expected_state_version, set: immediate },
    deferred: { expected_state_version: patch.expected_state_version, set: deferred },
  };
}
```

- [ ] **Step 4: Correrlos y verificar que pasan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/state-patch.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add agent-core/src/domain/state-patch.ts tests/unit/agent-core/state-patch.test.ts
git commit -m "feat(agent-core): separar el estado inmediato del ligado a visibilidad"
```

---

## Task 2.3: Puertos y el loop con su presupuesto

**Files:**
- Create: `agent-core/src/ports/model-provider.ts`, `tool-executor.ts`, `memory-store.ts`, `channel-adapter.ts`
- Create: `agent-core/src/loop.ts`
- Test: `tests/unit/agent-core/loop.test.ts`

**Interfaces:**
- Consumes: `ResponseBlockV3`, `StatePatchV3` de las Tareas 2.1 y 2.2.
- Produces:
  - `interface AgentTurnDecisionV3 { schema_version: 3; blocks: readonly ResponseBlockV3[]; commit_preparations: readonly string[]; used_memory_ids: readonly string[]; state_patch: StatePatchV3; response_type: string }`
  - `interface ToolResultV1<T> { tool: string; success: boolean; canonical_data: T | null; error_code: string | null; recoverable: boolean; idempotency_result: 'applied' | 'duplicate' | 'not_applicable'; preparation_id: string | null }`
  - `runAgentTurnV3(deps, input): Promise<{ outcome: 'decided'; decision: AgentTurnDecisionV3; rounds: number } | { outcome: 'exhausted'; reason: 'MAX_ROUNDS' | 'DEADLINE' }>`
  - Constantes `MAX_TOOL_ROUNDS = 2`, `MAX_TOOL_CALLS_PER_ROUND = 4`, `AGENT_LOOP_DEADLINE_MS = 6_500`, `ROUND_SOFT_DEADLINE_MS = 2_600`.

- [ ] **Step 1: Escribir los tests del ciclo con un `ModelProvider` falso**

Crear `tests/unit/agent-core/loop.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { MAX_TOOL_ROUNDS, runAgentTurnV3 } from '../../../agent-core/src/loop';

const decision = {
  schema_version: 3 as const,
  blocks: [{ type: 'narrative' as const, text: 'Listo.' }],
  commit_preparations: [],
  used_memory_ids: [],
  state_patch: { expected_state_version: 1, set: {} },
  response_type: 'commercial_reply',
};

function provider(script: Array<{ tool_calls?: Array<{ call_id: string; name: string; arguments: string }>; decision?: typeof decision }>) {
  let index = 0;
  return { generate: vi.fn(async () => script[index++]!) };
}

describe('runAgentTurnV3', () => {
  it('returns the decision when the model answers without tools', async () => {
    const model = provider([{ decision }]);
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn() }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({ outcome: 'decided', decision, rounds: 0 });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('feeds tool results back and then returns the decision', async () => {
    const model = provider([
      { tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }] },
      { decision },
    ]);
    const execute = vi.fn(async () => ({
      tool: 'search_catalog', success: true, canonical_data: { offerings: [] },
      error_code: null, recoverable: false,
      idempotency_result: 'not_applicable' as const, preparation_id: null,
    }));
    const result = await runAgentTurnV3(
      { model, tools: { execute }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: 'decided', decision, rounds: 1 });
  });

  it('gives a failed tool result back to the agent instead of hiding it', async () => {
    const model = provider([
      { tool_calls: [{ call_id: 'c1', name: 'prepare_payment_link', arguments: '{}' }] },
      { decision },
    ]);
    const execute = vi.fn(async () => ({
      tool: 'prepare_payment_link', success: false, canonical_data: null,
      error_code: 'LINK_CONFIG_MISSING', recoverable: true,
      idempotency_result: 'not_applicable' as const, preparation_id: null,
    }));
    await runAgentTurnV3(
      { model, tools: { execute }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    const secondCall = model.generate.mock.calls[1]![0] as { conversation: unknown[] };
    expect(JSON.stringify(secondCall.conversation)).toContain('LINK_CONFIG_MISSING');
  });

  it('stops after MAX_TOOL_ROUNDS instead of looping forever', async () => {
    const call = { tool_calls: [{ call_id: 'c', name: 'search_catalog', arguments: '{}' }] };
    const model = provider([call, call, call, call]);
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn(async () => ({
        tool: 'search_catalog', success: true, canonical_data: {}, error_code: null,
        recoverable: false, idempotency_result: 'not_applicable' as const, preparation_id: null,
      })) }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({ outcome: 'exhausted', reason: 'MAX_ROUNDS' });
    expect(model.generate).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
  });

  it('skips the second round when the first one blew the soft deadline', async () => {
    let clock = 0;
    const model = provider([
      { tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }] },
      { decision },
    ]);
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn(async () => { clock = 3_000; return {
        tool: 'search_catalog', success: true, canonical_data: {}, error_code: null,
        recoverable: false, idempotency_result: 'not_applicable' as const, preparation_id: null,
      }; }) }, now: () => clock },
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    // Una ronda lenta consume el presupuesto: se fuerza la respuesta final.
    expect(result).toEqual({ outcome: 'decided', decision, rounds: 1 });
  });

  it('reports DEADLINE when the budget is gone before any decision', async () => {
    let clock = 0;
    const model = { generate: vi.fn(async () => { clock = 7_000; return {
      tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }],
    }; }) };
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn() }, now: () => clock },
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({ outcome: 'exhausted', reason: 'DEADLINE' });
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/loop.test.ts`
Expected: FAIL, no se resuelve `agent-core/src/loop`.

- [ ] **Step 3: Implementar los puertos**

Crear `agent-core/src/ports/tool-executor.ts`:

```ts
export interface ToolCallV3 {
  readonly call_id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ToolResultV1<T = unknown> {
  readonly tool: string;
  readonly success: boolean;
  readonly canonical_data: T | null;
  readonly error_code: string | null;
  readonly recoverable: boolean;
  readonly idempotency_result: 'applied' | 'duplicate' | 'not_applicable';
  /** Sólo la clase preparación devuelve uno. */
  readonly preparation_id: string | null;
}

export interface ToolExecutor {
  execute(call: ToolCallV3): Promise<ToolResultV1>;
}
```

Crear `agent-core/src/ports/model-provider.ts`:

```ts
import type { ResponseBlockV3 } from '../domain/response-blocks';
import type { StatePatchV3 } from '../domain/state-patch';
import type { ToolCallV3 } from './tool-executor';

export interface AgentTurnDecisionV3 {
  readonly schema_version: 3;
  readonly blocks: readonly ResponseBlockV3[];
  /** Preparaciones a commitear. Explícito: no se infiere de los bloques. */
  readonly commit_preparations: readonly string[];
  readonly used_memory_ids: readonly string[];
  readonly state_patch: StatePatchV3;
  readonly response_type: string;
}

export type ModelTurnItemV3 =
  | { readonly role: 'user' | 'assistant' | 'developer'; readonly content: string }
  | { readonly role: 'tool'; readonly call_id: string; readonly content: string };

export interface ModelOutputV3 {
  readonly tool_calls?: readonly ToolCallV3[];
  readonly decision?: AgentTurnDecisionV3;
}

export interface ModelProvider {
  generate(input: {
    readonly instructions: string;
    readonly conversation: readonly ModelTurnItemV3[];
    readonly toolDefinitions: readonly unknown[];
    readonly force_final: boolean;
  }): Promise<ModelOutputV3>;
}
```

Crear `agent-core/src/ports/memory-store.ts`:

```ts
export interface MemoryV1 { readonly id: string; readonly text: string; readonly type: string }
export interface MemoryCandidateV3 {
  readonly text: string; readonly type: string; readonly supersedes: readonly string[];
}
export interface MemoryStore {
  relevant(input: { readonly conversation_id: string }): Promise<readonly MemoryV1[]>;
}
```

Crear `agent-core/src/ports/channel-adapter.ts`:

```ts
import type { ArtifactTableV3, ResponseBlockV3 } from '../domain/response-blocks';

export interface ChannelAdapter {
  readonly channel: 'telegram' | 'whatsapp' | 'voice';
  /** Un canal de voz no materializa igual que uno de texto. */
  render(blocks: readonly ResponseBlockV3[], table: ArtifactTableV3): { readonly text: string };
  readonly constraints: {
    readonly max_messages: number;
    /** `false` impide que un bloque de link llegue a un canal de voz. */
    readonly supports_urls: boolean;
  };
}
```

- [ ] **Step 4: Implementar el loop**

Crear `agent-core/src/loop.ts`:

```ts
import type {
  AgentTurnDecisionV3, ModelProvider, ModelTurnItemV3,
} from './ports/model-provider';
import type { ToolExecutor } from './ports/tool-executor';

export const MAX_TOOL_ROUNDS = 2;
export const MAX_TOOL_CALLS_PER_ROUND = 4;
export const AGENT_LOOP_DEADLINE_MS = 6_500;
export const ROUND_SOFT_DEADLINE_MS = 2_600;

export type AgentLoopResultV3 =
  | { readonly outcome: 'decided'; readonly decision: AgentTurnDecisionV3; readonly rounds: number }
  | { readonly outcome: 'exhausted'; readonly reason: 'MAX_ROUNDS' | 'DEADLINE' };

export async function runAgentTurnV3(
  deps: {
    readonly model: ModelProvider;
    readonly tools: ToolExecutor;
    readonly now: () => number;
  },
  input: {
    readonly instructions: string;
    readonly conversation: readonly ModelTurnItemV3[];
    readonly toolDefinitions: readonly unknown[];
  },
): Promise<AgentLoopResultV3> {
  const startedAt = deps.now();
  const conversation: ModelTurnItemV3[] = [...input.conversation];
  const spent = () => deps.now() - startedAt;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    // La última vuelta permitida exige respuesta final: no se pide más herramientas
    // cuando ya no queda presupuesto para ejecutarlas.
    const forceFinal = round === MAX_TOOL_ROUNDS
      || spent() >= ROUND_SOFT_DEADLINE_MS * MAX_TOOL_ROUNDS;
    const output = await deps.model.generate({
      instructions: input.instructions,
      conversation,
      toolDefinitions: forceFinal ? [] : input.toolDefinitions,
      force_final: forceFinal,
    });

    if (output.decision) return { outcome: 'decided', decision: output.decision, rounds: round };

    const calls = (output.tool_calls ?? []).slice(0, MAX_TOOL_CALLS_PER_ROUND);
    if (calls.length === 0) return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
    if (spent() >= AGENT_LOOP_DEADLINE_MS) return { outcome: 'exhausted', reason: 'DEADLINE' };

    const results = await Promise.all(calls.map((call) => deps.tools.execute(call)));
    calls.forEach((call, index) => {
      // El resultado vuelve al agente TAL CUAL, éxito o fallo. El orquestador no
      // decide qué hacer con un error: eso es del agente.
      conversation.push({ role: 'tool', call_id: call.call_id, content: JSON.stringify(results[index]) });
    });
  }
  return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/loop.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verificar que el guard de aislamiento sigue verde**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/`
Expected: PASS, todos.

- [ ] **Step 7: Commit**

```bash
git add agent-core/src/ports agent-core/src/loop.ts tests/unit/agent-core/loop.test.ts
git commit -m "feat(agent-core): ciclo del agente con presupuesto de dos rondas"
```

---

## Task 2.4: Exponer `version` del estado hacia el contexto del turno

La columna **ya existe** y **ya se incrementa**
(`postgres-conversation-state-store.ts:136`). `load()` hace `SELECT state.*`, así
que el valor ya viaja en la fila; lo que falta es mapearlo al dominio.

**Files:**
- Modify: `src/features/conversation/adapters/postgres-conversation-state-store.ts` (función `mapRow`)
- Modify: `src/features/conversation/domain/conversation-pipeline.ts` (interfaz `ConversationStateV1`)
- Test: `tests/integration/conversation-state-version.test.ts` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `ConversationStateV1.version: number`, disponible para
  `buildAgentAContextV1` y para el control de integridad.

- [ ] **Step 1: Escribir el test RED**

Crear `tests/integration/conversation-state-version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('conversation state version', () => {
  it('exposes the stored version and increments it on every transition', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const store = new PostgresConversationStateStoreV1(sql);

    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(typeof before?.version).toBe('number');

    await store.transition({
      workspace_slug: 'studyx',
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
      selected_offering_code: 'diplomado-marketing',
      selected_payment_plan: null,
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: false,
      source_turn_id: seeded.second_turn_id,
    });

    const after = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(after!.version).toBe(before!.version + 1);
  });
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/conversation-state-version.test.ts`
Expected: FAIL, `expected "undefined" to be "number"`.

- [ ] **Step 3: Mapear la columna al dominio**

En `src/features/conversation/domain/conversation-pipeline.ts`, agregar a
`ConversationStateV1`:

```ts
  /** Versión optimista de la fila. La escribe el store, nunca el modelo. */
  readonly version: number;
```

En `src/features/conversation/adapters/postgres-conversation-state-store.ts`,
dentro de `mapRow`, agregar al objeto devuelto:

```ts
    version: Number(row.version ?? 0),
```

y a `ConversationStateRowV1` el campo `version: number | string`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/conversation-state-version.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar que nada más se rompió**

Run: `npm run typecheck && npx vitest run --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/conversation tests/integration/conversation-state-version.test.ts
git commit -m "feat(agent-a): exponer la version optimista del estado de conversacion"
```

---

## Task 2.5: Las tres migraciones aditivas

**Files:**
- Create: `supabase/migrations/20260905000001_agent_decisions_release_manifest.sql`
- Create: `supabase/migrations/20260905000002_outbound_deferred_state_patch.sql`
- Create: `supabase/migrations/20260905000003_agent_loop_rollout_v3.sql`
- Test: `tests/integration/agent-loop-migrations.test.ts` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `agent_decisions.release_manifest jsonb`,
  `outbound_deliveries.deferred_state_patch jsonb`,
  `outbound_deliveries.deferred_patch_applied_on text`, tabla
  `agent_loop_rollout_v3`.

- [ ] **Step 1: Escribir el test RED de esquema**

Crear `tests/integration/agent-loop-migrations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0]!.n === 1;
}

describe('agent loop migrations', () => {
  it('adds the release manifest to decisions', async () => {
    expect(await columnExists('agent_decisions', 'release_manifest')).toBe(true);
  });

  it('adds the deferred patch and its proof level to deliveries', async () => {
    expect(await columnExists('outbound_deliveries', 'deferred_state_patch')).toBe(true);
    expect(await columnExists('outbound_deliveries', 'deferred_patch_applied_on')).toBe(true);
  });

  it('creates the rollout table with a workspace default row shape', async () => {
    const rows = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'agent_loop_rollout_v3'
    `;
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses an invalid rollout mode', async () => {
    await expect(sql`
      INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
      SELECT id, NULL, 'bananas' FROM workspaces WHERE slug = 'studyx'
    `).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-loop-migrations.test.ts`
Expected: FAIL, las cuatro aserciones.

- [ ] **Step 3: Escribir las tres migraciones**

`supabase/migrations/20260905000001_agent_decisions_release_manifest.sql`:

```sql
-- Manifiesto verificable por turno. Permite responder qué prompt corrió en
-- producción desde la base, sin acceso al Control Panel de Botpress.
ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS release_manifest jsonb;

COMMENT ON COLUMN agent_decisions.release_manifest IS
  'ReleaseManifestV1: git_sha, botpress_artifact_sha, prompt_version, model, prompt_sha256, tool_contract_version.';
```

`supabase/migrations/20260905000002_outbound_deferred_state_patch.sql`:

```sql
-- El estado que depende de que el cliente haya visto el mensaje viaja acá y se
-- aplica recién cuando el canal ACEPTA el outbound. `applied_on` registra la
-- calidad de la prueba: 'accepted' (submitted) o 'delivered'.
ALTER TABLE outbound_deliveries
  ADD COLUMN IF NOT EXISTS deferred_state_patch jsonb,
  ADD COLUMN IF NOT EXISTS deferred_patch_applied_on text;

ALTER TABLE outbound_deliveries
  DROP CONSTRAINT IF EXISTS outbound_deliveries_deferred_patch_applied_on_check;
ALTER TABLE outbound_deliveries
  ADD CONSTRAINT outbound_deliveries_deferred_patch_applied_on_check
  CHECK (deferred_patch_applied_on IS NULL
         OR deferred_patch_applied_on IN ('accepted', 'delivered'));
```

`supabase/migrations/20260905000003_agent_loop_rollout_v3.sql`:

```sql
-- Bandera RUNTIME. El rollback es un UPDATE: no exige publicar el bundle de
-- Botpress (hoy bloqueado por EXT-05) ni redeploy de Vercel.
-- El allowlist se indexa por contact_id, neutral al canal: un contacto de
-- Telegram tiene E.164 sintético y un allowlist telefónico no lo alcanzaría.
CREATE TABLE IF NOT EXISTS agent_loop_rollout_v3 (
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   uuid            NULL REFERENCES contacts(id)   ON DELETE CASCADE,
  mode         text        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_loop_rollout_v3_mode_check
    CHECK (mode IN ('off', 'shadow', 'authoritative'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_loop_rollout_v3_workspace_contact_key
  ON agent_loop_rollout_v3 (workspace_id, COALESCE(contact_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON TABLE agent_loop_rollout_v3 IS
  'Modo del agent loop v3. contact_id NULL = default del workspace. Resolución: contacto, luego workspace, luego off.';
```

- [ ] **Step 4: Aplicar al cluster desechable y correr el test**

```bash
psql "$TEST_DATABASE_URL" -f supabase/migrations/20260905000001_agent_decisions_release_manifest.sql
psql "$TEST_DATABASE_URL" -f supabase/migrations/20260905000002_outbound_deferred_state_patch.sql
psql "$TEST_DATABASE_URL" -f supabase/migrations/20260905000003_agent_loop_rollout_v3.sql
npx vitest run --config vitest.integration.config.mts tests/integration/agent-loop-migrations.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Verificar el lint de esquema**

Run: `npm run test:db:lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/agent-loop-migrations.test.ts
git commit -m "feat(agent-a): migraciones aditivas de manifiesto, patch diferido y rollout"
```

---

## Task 2.6: La bandera runtime y su resolución por contacto

**Files:**
- Create: `src/features/orchestration/domain/agent-loop-rollout.ts`
- Modify: `src/lib/services/claim.service.ts` (donde se arma `features` del claim)
- Modify: `botpress-agent/src/schemas/contracts.ts:562` (agregar `agent_loop_v3_mode`)
- Test: `tests/unit/orchestration/agent-loop-rollout.test.ts`, `tests/integration/agent-loop-rollout-claim.test.ts`

**Interfaces:**
- Consumes: la tabla de la Tarea 2.5.
- Produces: `resolveAgentLoopModeV3(rows: readonly RolloutRowV3[], contactId: string): 'off' | 'shadow' | 'authoritative'`, pura.

- [ ] **Step 1: Escribir el test unitario de resolución**

Crear `tests/unit/orchestration/agent-loop-rollout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveAgentLoopModeV3 } from '@/features/orchestration/domain/agent-loop-rollout';

const C = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('resolveAgentLoopModeV3', () => {
  it('is off when no row matches', () => {
    expect(resolveAgentLoopModeV3([], C)).toBe('off');
  });

  it('uses the workspace default row when there is no contact row', () => {
    expect(resolveAgentLoopModeV3([{ contact_id: null, mode: 'shadow' }], C)).toBe('shadow');
  });

  it('lets the contact row win over the workspace default', () => {
    expect(resolveAgentLoopModeV3([
      { contact_id: null, mode: 'off' },
      { contact_id: C, mode: 'authoritative' },
    ], C)).toBe('authoritative');
  });

  it('ignores rows belonging to another contact', () => {
    expect(resolveAgentLoopModeV3([{ contact_id: OTHER, mode: 'authoritative' }], C)).toBe('off');
  });
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run --config vitest.config.mts tests/unit/orchestration/agent-loop-rollout.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar la resolución**

Crear `src/features/orchestration/domain/agent-loop-rollout.ts`:

```ts
export type AgentLoopModeV3 = 'off' | 'shadow' | 'authoritative';

export interface RolloutRowV3 {
  readonly contact_id: string | null;
  readonly mode: AgentLoopModeV3;
}

/**
 * Precedencia: fila del contacto, luego default del workspace, luego apagado.
 * Neutral al canal a propósito: la clave es `contact_id`, la identidad canónica
 * que existe para Telegram, WhatsApp y voz por igual.
 */
export function resolveAgentLoopModeV3(
  rows: readonly RolloutRowV3[],
  contactId: string,
): AgentLoopModeV3 {
  return rows.find((row) => row.contact_id === contactId)?.mode
    ?? rows.find((row) => row.contact_id === null)?.mode
    ?? 'off';
}
```

- [ ] **Step 4: Correrlo y verificar que pasa**

Run: `npx vitest run --config vitest.config.mts tests/unit/orchestration/agent-loop-rollout.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Escribir el test de integración del claim**

Crear `tests/integration/agent-loop-rollout-claim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { claimInboundBatch } from '@/lib/services/claim.service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('agent loop mode in the claim', () => {
  it('defaults to off and flips to authoritative with a single UPDATE', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });

    const before = await claimInboundBatch({
      batch_id: seeded.batch_id, trace_id: seeded.trace_id, claimed_by: 'test',
    });
    expect(before.features.agent_loop_v3_mode).toBe('off');

    await sql`
      INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
      SELECT w.id, ${seeded.contact_id}::uuid, 'authoritative'
      FROM workspaces w WHERE w.slug = 'studyx'
    `;

    const after = await claimInboundBatch({
      batch_id: seeded.second_batch_id, trace_id: seeded.trace_id, claimed_by: 'test',
    });
    expect(after.features.agent_loop_v3_mode).toBe('authoritative');
  });
});
```

- [ ] **Step 6: Cablear la lectura en el claim y en el contrato**

En `src/lib/services/claim.service.ts`, dentro de la consulta que arma el claim,
leer las filas de rollout del workspace y del contacto, y agregar a `features`:

```ts
    agent_loop_v3_mode: resolveAgentLoopModeV3(rolloutRows, turn.contact_id),
```

En `botpress-agent/src/schemas/contracts.ts:562`, dentro del objeto `features`:

```ts
    agent_loop_v3_mode: z.enum(['off', 'shadow', 'authoritative']).default('off'),
```

- [ ] **Step 7: Correr el test de integración y el gate**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-loop-rollout-claim.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/orchestration/domain/agent-loop-rollout.ts src/lib/services/claim.service.ts botpress-agent/src/schemas/contracts.ts tests/unit/orchestration/agent-loop-rollout.test.ts tests/integration/agent-loop-rollout-claim.test.ts
git commit -m "feat(agent-a): bandera runtime del agent loop resuelta por contacto"
```

---

## Task 2.7: Las tres herramientas de lectura

**Files:**
- Create: `src/features/conversation/application/agent-tools-read.ts`
- Create: `src/app/api/agent/tools/course/[code]/route.ts`
- Create: `src/app/api/agent/tools/payment-options/route.ts`
- Test: `tests/unit/conversation/agent-tools-read.test.ts`

**Interfaces:**
- Consumes: `ToolResultV1` de la Tarea 2.3; `PostgresBusinessContextStore`.
- Produces:
  - `searchCatalogToolV1(deps): Promise<ToolResultV1<{ offerings: {code,display_name,academy}[]; areas: string[]; prices_assertable: boolean }>>`
  - `getCourseInformationToolV1(deps, args: { code: string }): Promise<ToolResultV1<{...}>>` con `error_code: 'COURSE_NOT_FOUND'` cuando no existe.
  - `getPaymentOptionsToolV1(deps): Promise<ToolResultV1<{ plans: { code,label,fact_id }[] }>>`

- [ ] **Step 1: Escribir los tests con un store en memoria**

Crear `tests/unit/conversation/agent-tools-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getCourseInformationToolV1, searchCatalogToolV1,
} from '@/features/conversation/application/agent-tools-read';

const store = {
  loadCompleteIndex: async () => ({
    offerings: [
      { code: 'dip-mkt', display_name: 'Diplomado en Marketing', academy: 'Negocios',
        aliases: [], delivery: { classes: 38, modality: '100% online' },
        price_type: 'fixed', price_amount: '1200.00', currency: 'USD', description: 'Ideal para arrancar.' },
    ],
  }),
};

describe('read tools', () => {
  it('returns the catalog with canonical shape and never throws on success', async () => {
    const result = await searchCatalogToolV1({ store, workspaceSlug: 'studyx' });
    expect(result.success).toBe(true);
    expect(result.idempotency_result).toBe('not_applicable');
    expect(result.preparation_id).toBeNull();
    expect(result.canonical_data!.offerings).toEqual([
      { code: 'dip-mkt', display_name: 'Diplomado en Marketing', academy: 'Negocios' },
    ]);
  });

  it('returns a recoverable failure the agent can react to when the course is unknown', async () => {
    const result = await getCourseInformationToolV1({ store, workspaceSlug: 'studyx' }, { code: 'nope' });
    expect(result).toMatchObject({
      success: false, canonical_data: null,
      error_code: 'COURSE_NOT_FOUND', recoverable: true,
    });
  });

  it('never leaks the beca amount through course information', async () => {
    const result = await getCourseInformationToolV1({ store, workspaceSlug: 'studyx' }, { code: 'dip-mkt' });
    expect(JSON.stringify(result)).not.toMatch(/\b699\b/);
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.config.mts tests/unit/conversation/agent-tools-read.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar las tres herramientas de lectura**

Crear `src/features/conversation/application/agent-tools-read.ts`:

```ts
import type { ToolResultV1 } from '../../../../agent-core/src/ports/tool-executor';

interface ReadDeps {
  readonly store: { loadCompleteIndex(slug: string): Promise<{ offerings: readonly any[] } | null> };
  readonly workspaceSlug: string;
}

function ok<T>(tool: string, data: T): ToolResultV1<T> {
  return { tool, success: true, canonical_data: data, error_code: null,
    recoverable: false, idempotency_result: 'not_applicable', preparation_id: null };
}

function fail(tool: string, code: string, recoverable: boolean): ToolResultV1<never> {
  return { tool, success: false, canonical_data: null, error_code: code,
    recoverable, idempotency_result: 'not_applicable', preparation_id: null };
}

export async function searchCatalogToolV1(deps: ReadDeps) {
  const index = await deps.store.loadCompleteIndex(deps.workspaceSlug);
  if (!index) return fail('search_catalog', 'CATALOG_UNAVAILABLE', true);
  return ok('search_catalog', {
    offerings: index.offerings.map((offering) => ({
      code: offering.code, display_name: offering.display_name, academy: offering.academy ?? null,
    })),
    areas: [...new Set(index.offerings.map((o) => o.academy).filter(Boolean))] as string[],
    prices_assertable: index.offerings.some((o) => o.price_type === 'fixed'),
  });
}

export async function getCourseInformationToolV1(deps: ReadDeps, args: { readonly code: string }) {
  const index = await deps.store.loadCompleteIndex(deps.workspaceSlug);
  const offering = index?.offerings.find((candidate) => candidate.code === args.code);
  if (!offering) return fail('get_course_information', 'COURSE_NOT_FOUND', true);
  // `metadata` NO se proyecta: ahí vive `beca_price_usd`, que nunca puede salir.
  return ok('get_course_information', {
    code: offering.code,
    display_name: offering.display_name,
    delivery: offering.delivery,
    description: offering.description ?? null,
    price: offering.price_type === 'fixed'
      ? { currency: offering.currency, amount: offering.price_amount }
      : null,
  });
}

export async function getPaymentOptionsToolV1(deps: {
  readonly plans: readonly { code: string; label: string }[];
}) {
  return ok('get_payment_options', {
    plans: deps.plans.map((plan) => ({
      code: plan.code, label: plan.label, fact_id: `fact:payment_plan:${plan.code}`,
    })),
  });
}
```

- [ ] **Step 4: Correrlos y verificar que pasan**

Run: `npx vitest run --config vitest.config.mts tests/unit/conversation/agent-tools-read.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/conversation/application/agent-tools-read.ts tests/unit/conversation/agent-tools-read.test.ts
git commit -m "feat(agent-a): herramientas de lectura del catalogo y planes"
```

---

## Task 2.8: Herramientas de preparación con idempotencia y reserva que vence

La enmienda 3: una mutación **no produce efecto definitivo** antes de que el
turno se acepte. La preparación reserva y devuelve el artefacto; el commit lo
ejecuta después, una sola vez.

**Files:**
- Create: `src/features/conversation/application/agent-tools-prepare.ts`
- Create: `supabase/migrations/20260905000004_agent_turn_preparations.sql`
- Test: `tests/integration/agent-tools-prepare.test.ts`

**Interfaces:**
- Consumes: `ToolResultV1`; el resolver de links `createConfigPaymentLinkResolver`.
- Produces:
  - Tabla `agent_turn_preparations (id uuid pk, turn_id uuid, conversation_id uuid, tool text, canonical_key text, canonical_data jsonb, created_at timestamptz, committed_at timestamptz null)`
  - `preparePaymentLinkToolV1(deps, args): Promise<ToolResultV1<{ label: string; url: string; offering_code: string; payment_plan: string }>>`
  - `prepareCallRequestToolV1`, `prepareContactDetailsToolV1`, `prepareMemoryToolV1`, `prepareLeadProjectionToolV1` con la misma forma.

- [ ] **Step 1: Escribir la migración de la tabla de preparaciones**

Crear `supabase/migrations/20260905000004_agent_turn_preparations.sql`:

```sql
-- Una preparación reserva un artefacto SIN producir efecto. El commit del turno
-- la marca `committed_at`; una preparación sin commitear vence con el turno y
-- nunca se convierte en un efecto real.
CREATE TABLE IF NOT EXISTS agent_turn_preparations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id         uuid        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool            text        NOT NULL,
  canonical_key   text        NOT NULL,
  canonical_data  jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  committed_at    timestamptz     NULL
);

-- Idempotencia por (conversación, herramienta, clave canónica): un segundo
-- pedido devuelve la MISMA reserva, nunca una segunda.
CREATE UNIQUE INDEX IF NOT EXISTS agent_turn_preparations_idempotency_key
  ON agent_turn_preparations (conversation_id, tool, canonical_key);
```

- [ ] **Step 2: Escribir el test RED de idempotencia y de no-efecto**

Crear `tests/integration/agent-tools-prepare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('prepare_payment_link', () => {
  it('reserves an artifact without producing any committed effect', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const result = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'dip-mkt', payment_plan: 'one_time' },
    );

    expect(result.success).toBe(true);
    expect(result.preparation_id).toBeTruthy();
    expect(result.canonical_data!.url).toMatch(/^https:\/\//);

    const committed = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_turn_preparations
      WHERE id = ${result.preparation_id}::uuid AND committed_at IS NOT NULL
    `;
    expect(committed[0]!.n).toBe(0);

    const decisions = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_decisions
      WHERE business_action ->> 'type' = 'send_payment_link'
        AND turn_id = ${seeded.turn_id}::uuid
    `;
    expect(decisions[0]!.n).toBe(0);
  });

  it('returns the same reservation on a second identical request', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const args = { offering_code: 'dip-mkt', payment_plan: 'one_time' as const };
    const deps = { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id };

    const first = await preparePaymentLinkToolV1(deps, args);
    const second = await preparePaymentLinkToolV1(deps, args);

    expect(second.preparation_id).toBe(first.preparation_id);
    expect(second.idempotency_result).toBe('duplicate');
    expect(second.canonical_data).toEqual(first.canonical_data);
  });

  it('fails recoverably when the link is not configured, so the agent can react', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const result = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'dip-mkt', payment_plan: 'monthly_12' },
      { resolver: { resolve: () => null } },
    );
    expect(result).toMatchObject({
      success: false, error_code: 'LINK_CONFIG_MISSING', recoverable: true, preparation_id: null,
    });
  });
});
```

- [ ] **Step 3: Aplicar la migración y correr el test**

```bash
psql "$TEST_DATABASE_URL" -f supabase/migrations/20260905000004_agent_turn_preparations.sql
npx vitest run --config vitest.integration.config.mts tests/integration/agent-tools-prepare.test.ts
```

Expected: FAIL, módulo `agent-tools-prepare` inexistente.

- [ ] **Step 4: Implementar la preparación de link de pago**

Crear `src/features/conversation/application/agent-tools-prepare.ts`:

```ts
import { createConfigPaymentLinkResolver } from '@/features/payments/adapters/config-payment-link.resolver';
import type { ToolResultV1 } from '../../../../agent-core/src/ports/tool-executor';

interface PrepareDeps {
  readonly db: any;
  readonly turn_id: string;
  readonly conversation_id: string;
}

export async function preparePaymentLinkToolV1(
  deps: PrepareDeps,
  args: { readonly offering_code: string; readonly payment_plan: string },
  overrides?: { readonly resolver?: { resolve(plan: string): { label: string; url: string } | null } },
): Promise<ToolResultV1<{ label: string; url: string; offering_code: string; payment_plan: string }>> {
  const tool = 'prepare_payment_link';
  const resolver = overrides?.resolver ?? createConfigPaymentLinkResolver();
  const link = resolver.resolve(args.payment_plan);
  if (!link) {
    // El fallo vuelve al agente. El backend NO decide qué decirle al cliente.
    return { tool, success: false, canonical_data: null, error_code: 'LINK_CONFIG_MISSING',
      recoverable: true, idempotency_result: 'not_applicable', preparation_id: null };
  }

  const canonicalKey = `${args.offering_code}:${args.payment_plan}`;
  const data = { ...link, offering_code: args.offering_code, payment_plan: args.payment_plan };

  const rows = await deps.db<Array<{ id: string; canonical_data: typeof data; inserted: boolean }>>`
    WITH attempted AS (
      INSERT INTO agent_turn_preparations (turn_id, conversation_id, tool, canonical_key, canonical_data)
      VALUES (${deps.turn_id}::uuid, ${deps.conversation_id}::uuid, ${tool}, ${canonicalKey}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (conversation_id, tool, canonical_key) DO NOTHING
      RETURNING id, canonical_data, true AS inserted
    )
    SELECT * FROM attempted
    UNION ALL
    SELECT existing.id, existing.canonical_data, false AS inserted
    FROM agent_turn_preparations AS existing
    WHERE NOT EXISTS (SELECT 1 FROM attempted)
      AND existing.conversation_id = ${deps.conversation_id}::uuid
      AND existing.tool = ${tool}
      AND existing.canonical_key = ${canonicalKey}
    LIMIT 1
  `;

  const row = rows[0]!;
  return {
    tool, success: true, canonical_data: row.canonical_data, error_code: null,
    recoverable: false,
    idempotency_result: row.inserted ? 'applied' : 'duplicate',
    preparation_id: row.id,
  };
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-tools-prepare.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/conversation/application/agent-tools-prepare.ts supabase/migrations/20260905000004_agent_turn_preparations.sql tests/integration/agent-tools-prepare.test.ts
git commit -m "feat(agent-a): preparacion idempotente de link de pago sin efecto definitivo"
```

---

## Task 2.9: El control de integridad que acepta o devuelve, y nunca poda

**Files:**
- Create: `src/features/conversation/domain/integrity-check-v3.ts`
- Test: `tests/unit/conversation/integrity-check-v3.test.ts`

**Interfaces:**
- Consumes: `narrativeViolationsV3` (2.1), `AgentTurnDecisionV3` (2.3).
- Produces:
  - `interface IntegrityRejectionV1 { rejection_id: string; attempt: 1; violations: readonly { code: string; subject: string; detail?: string }[]; authorized_alternatives: { fact_ids: readonly string[]; preparations: readonly string[]; missing_information: readonly string[] } }`
  - `checkAgentTurnIntegrityV3(input): { ok: true } | { ok: false; rejection: IntegrityRejectionV1 }`

- [ ] **Step 1: Escribir los tests**

Crear `tests/unit/conversation/integrity-check-v3.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkAgentTurnIntegrityV3 } from '@/features/conversation/domain/integrity-check-v3';

const base = {
  decision: {
    schema_version: 3 as const,
    blocks: [{ type: 'narrative' as const, text: 'Dale, te cuento.' }],
    commit_preparations: [] as string[],
    used_memory_ids: [],
    state_patch: { expected_state_version: 5, set: {} },
    response_type: 'commercial_reply',
  },
  context: {
    state_version: 5,
    authorized_fact_ids: ['fact:price:one_time'],
    open_preparations: ['prep-1'],
    intake_missing: [] as string[],
  },
  rejection_id: 'r-1',
};

describe('checkAgentTurnIntegrityV3', () => {
  it('accepts a clean turn', () => {
    expect(checkAgentTurnIntegrityV3(base)).toEqual({ ok: true });
  });

  it('rejects a URL in narrative instead of pruning it', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, blocks: [{ type: 'narrative', text: 'Acá: https://x.com/a' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejection.violations[0]!.code)
      .toBe('NARRATIVE_CONTAINS_URL');
  });

  it('never returns modified text: a rejection carries no content field', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, blocks: [{ type: 'narrative', text: 'Sale USD 999' }] },
    });
    expect(JSON.stringify(result)).not.toContain('Sale USD');
  });

  it('rejects a fact the context did not authorize', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, blocks: [{ type: 'fact', fact_id: 'fact:invented' }] },
    });
    expect(result.ok === false && result.rejection.violations[0])
      .toEqual({ code: 'FACT_NOT_AUTHORIZED', subject: 'fact:invented' });
  });

  it('rejects a stale expected_state_version', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, state_patch: { expected_state_version: 4, set: {} } },
    });
    expect(result.ok === false && result.rejection.violations[0]!.code)
      .toBe('STATE_VERSION_CONFLICT');
  });

  it('rejects a payment stage without the matching preparation committed', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        state_patch: { expected_state_version: 5, set: { stage: 'payment_link_sent' } },
        commit_preparations: [],
      },
    });
    expect(result.ok === false && result.rejection.violations[0]!.code)
      .toBe('STATE_ACTION_INCOHERENT');
  });

  it('rejects committing a preparation that does not belong to this turn', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, commit_preparations: ['prep-ghost'] },
    });
    expect(result.ok === false && result.rejection.violations[0])
      .toEqual({ code: 'PREPARATION_NOT_OPEN', subject: 'prep-ghost' });
  });

  it('offers the authorized alternatives so the agent can repair', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, blocks: [{ type: 'fact', fact_id: 'fact:invented' }] },
    });
    expect(result.ok === false && result.rejection.authorized_alternatives).toEqual({
      fact_ids: ['fact:price:one_time'], preparations: ['prep-1'], missing_information: [],
    });
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.config.mts tests/unit/conversation/integrity-check-v3.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar el control**

Crear `src/features/conversation/domain/integrity-check-v3.ts`:

```ts
import { narrativeViolationsV3 } from '../../../../agent-core/src/domain/response-blocks';
import type { AgentTurnDecisionV3 } from '../../../../agent-core/src/ports/model-provider';

export interface IntegrityViolationV3 {
  readonly code: string;
  readonly subject: string;
  readonly detail?: string;
}

export interface IntegrityRejectionV1 {
  readonly rejection_id: string;
  readonly attempt: 1;
  readonly violations: readonly IntegrityViolationV3[];
  readonly authorized_alternatives: {
    readonly fact_ids: readonly string[];
    readonly preparations: readonly string[];
    readonly missing_information: readonly string[];
  };
}

const PAYMENT_STAGES = new Set(['payment_link_sent']);

/**
 * Acepta, o devuelve un rechazo estructurado. NUNCA modifica el texto: el
 * rechazo no lleva contenido, sólo códigos y alternativas autorizadas.
 */
export function checkAgentTurnIntegrityV3(input: {
  readonly decision: AgentTurnDecisionV3;
  readonly context: {
    readonly state_version: number;
    readonly authorized_fact_ids: readonly string[];
    readonly open_preparations: readonly string[];
    readonly intake_missing: readonly string[];
  };
  readonly rejection_id: string;
}): { readonly ok: true } | { readonly ok: false; readonly rejection: IntegrityRejectionV1 } {
  const violations: IntegrityViolationV3[] = [];
  const facts = new Set(input.context.authorized_fact_ids);
  const open = new Set(input.context.open_preparations);

  for (const block of input.decision.blocks) {
    if (block.type === 'narrative') {
      for (const code of narrativeViolationsV3(block.text)) {
        violations.push({ code, subject: 'narrative' });
      }
    } else if (block.type === 'fact' && !facts.has(block.fact_id)) {
      violations.push({ code: 'FACT_NOT_AUTHORIZED', subject: block.fact_id });
    } else if (block.type === 'artifact' && !open.has(block.preparation_id)) {
      violations.push({ code: 'PREPARATION_NOT_OPEN', subject: block.preparation_id });
    }
  }

  if (input.decision.state_patch.expected_state_version !== input.context.state_version) {
    violations.push({
      code: 'STATE_VERSION_CONFLICT', subject: 'state_patch',
      detail: `expected ${input.decision.state_patch.expected_state_version}, current ${input.context.state_version}`,
    });
  }

  for (const preparation of input.decision.commit_preparations) {
    if (!open.has(preparation)) {
      violations.push({ code: 'PREPARATION_NOT_OPEN', subject: preparation });
    }
  }

  // Un estado que afirma un efecto sin commitear la preparación que lo produce
  // es exactamente la incoherencia que rompía el turno siguiente.
  const stage = input.decision.state_patch.set.stage;
  if (stage !== undefined && PAYMENT_STAGES.has(String(stage))
    && input.decision.commit_preparations.length === 0) {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: 'stage' });
  }
  if (input.decision.commit_preparations.length > 0 && input.context.intake_missing.length > 0) {
    violations.push({ code: 'MISSING_INTAKE', subject: 'commit_preparations' });
  }

  if (violations.length === 0) return { ok: true };
  return {
    ok: false,
    rejection: {
      rejection_id: input.rejection_id,
      attempt: 1,
      violations,
      authorized_alternatives: {
        fact_ids: [...input.context.authorized_fact_ids],
        preparations: [...input.context.open_preparations],
        missing_information: [...input.context.intake_missing],
      },
    },
  };
}
```

- [ ] **Step 4: Correrlos y verificar que pasan**

Run: `npx vitest run --config vitest.config.mts tests/unit/conversation/integrity-check-v3.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/conversation/domain/integrity-check-v3.ts tests/unit/conversation/integrity-check-v3.test.ts
git commit -m "feat(agent-a): control de integridad que rechaza en vez de podar"
```

---

## Task 2.10: Commit atómico y patch diferido al aceptarse el outbound

**Files:**
- Create: `src/features/conversation/application/commit-agent-turn-v3.ts`
- Modify: `src/lib/services/decision.service.ts` (rama `agent_turn_v3`)
- Modify: `src/app/api/agent/outbounds/[outbound_id]/delivery/route.ts`
- Test: `tests/integration/agent-loop-delivery-failure.test.ts`, `tests/integration/agent-loop-exactly-once.test.ts`

**Interfaces:**
- Consumes: `splitStatePatchV3` (2.2), preparaciones (2.8), integridad (2.9).
- Produces: `commitAgentTurnV3(db, input): Promise<{ decision_id: string; outbound_id: string | null }>`,
  que en UNA transacción: valida integridad, aplica el patch inmediato, marca
  `committed_at` en las preparaciones listadas, escribe la decisión, guarda el
  patch diferido en `outbound_deliveries.deferred_state_patch` y encola el outbox.

- [ ] **Step 1: Escribir el test de fallo de entrega**

Crear `tests/integration/agent-loop-delivery-failure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { reportDelivery } from '@/lib/services/delivery.service';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('deferred state patch', () => {
  it('does not advance a visibility-gated counter when delivery fails', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const store = new PostgresConversationStateStoreV1(sql);
    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);

    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: '¿Te sirve que te llamemos?' }],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: {
          expected_state_version: before!.version,
          set: { call_offer_delta: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' },
        },
        response_type: 'call_offer',
      },
      release_manifest: seeded.release_manifest,
    });

    // Nada ligado a visibilidad se movió todavía.
    const afterCommit = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(afterCommit!.call_offer_count).toBe(0);

    await reportDelivery({
      outbound_id: committed.outbound_id!, trace_id: seeded.trace_id,
      status: 'failed', botpress_message_id: null, replayed: false,
      error_code: 'CHANNEL_REJECTED', delivery_attempt: 1,
    });

    const afterFailure = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(afterFailure!.call_offer_count).toBe(0);
    expect(afterFailure!.awaiting_reply).toBe(before!.awaiting_reply);
  });

  it('applies the deferred patch once the channel accepts the outbound', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 0 });
    const store = new PostgresConversationStateStoreV1(sql);
    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);

    const committed = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id, trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: '¿Te sirve que te llamemos?' }],
        commit_preparations: [], used_memory_ids: [],
        state_patch: {
          expected_state_version: before!.version,
          set: { call_offer_delta: 1, call_offer_status: 'offered' },
        },
        response_type: 'call_offer',
      },
      release_manifest: seeded.release_manifest,
    });

    await reportDelivery({
      outbound_id: committed.outbound_id!, trace_id: seeded.trace_id,
      status: 'submitted_to_botpress', botpress_message_id: 'bp-1',
      replayed: false, error_code: null, delivery_attempt: 1,
    });

    const after = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(after!.call_offer_count).toBe(1);

    const proof = await sql<Array<{ deferred_patch_applied_on: string }>>`
      SELECT deferred_patch_applied_on FROM outbound_deliveries
      WHERE outbound_message_id = ${committed.outbound_id}::uuid LIMIT 1
    `;
    // `accepted`, no `delivered`: el sandbox de Telegram no emite acuse.
    expect(proof[0]!.deferred_patch_applied_on).toBe('accepted');
  });
});
```

- [ ] **Step 2: Escribir el test de exactamente-una-vez**

Crear `tests/integration/agent-loop-exactly-once.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { preparePaymentLinkToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('exactly once', () => {
  it('commits one payment link even when the same turn is replayed', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'dip-mkt', payment_plan: 'one_time' },
    );

    const decision = {
      schema_version: 3 as const,
      blocks: [
        { type: 'narrative' as const, text: 'Perfecto, ahí va.' },
        { type: 'artifact' as const, preparation_id: prepared.preparation_id! },
      ],
      commit_preparations: [prepared.preparation_id!],
      used_memory_ids: [],
      state_patch: { expected_state_version: seeded.state_version, set: { stage: 'payment_link_sent' } },
      response_type: 'commercial_reply',
    };

    const first = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id, trace_id: seeded.trace_id, decision,
      release_manifest: seeded.release_manifest,
    });
    const second = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id, trace_id: seeded.trace_id, decision,
      release_manifest: seeded.release_manifest,
    });

    expect(second.decision_id).toBe(first.decision_id);

    const links = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_decisions
      WHERE turn_id = ${seeded.turn_id}::uuid
        AND business_action ->> 'type' = 'send_payment_link'
    `;
    expect(links[0]!.n).toBe(1);

    const committedPreparations = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_turn_preparations
      WHERE id = ${prepared.preparation_id}::uuid AND committed_at IS NOT NULL
    `;
    expect(committedPreparations[0]!.n).toBe(1);
  });

  it('discards a preparation that the final answer did not list', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'dip-mkt', payment_plan: 'one_time' },
    );

    await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id, trace_id: seeded.trace_id,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Mejor lo vemos con calma.' }],
        commit_preparations: [],   // el agente decidió NO ofrecerlo
        used_memory_ids: [],
        state_patch: { expected_state_version: seeded.state_version, set: {} },
        response_type: 'commercial_reply',
      },
      release_manifest: seeded.release_manifest,
    });

    const committed = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_turn_preparations
      WHERE id = ${prepared.preparation_id}::uuid AND committed_at IS NOT NULL
    `;
    expect(committed[0]!.n).toBe(0);
  });
});
```

- [ ] **Step 3: Correr ambos y verificar que fallan**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-loop-delivery-failure.test.ts tests/integration/agent-loop-exactly-once.test.ts`
Expected: FAIL, `commit-agent-turn-v3` inexistente.

- [ ] **Step 4: Implementar el commit atómico**

Crear `src/features/conversation/application/commit-agent-turn-v3.ts` con esta
estructura, dentro de una única `withSerializableTransaction`:

```ts
import { splitStatePatchV3 } from '../../../../agent-core/src/domain/state-patch';
import { checkAgentTurnIntegrityV3 } from '../domain/integrity-check-v3';
import { renderBlocksV3 } from '../../../../agent-core/src/domain/response-blocks';

export async function commitAgentTurnV3(db: any, input: {
  readonly turn_id: string;
  readonly trace_id: string;
  readonly decision: AgentTurnDecisionV3;
  readonly release_manifest: Record<string, unknown>;
}): Promise<{ readonly decision_id: string; readonly outbound_id: string | null }> {
  // 1. Idempotencia del turno: una decisión ya existente se devuelve tal cual.
  const existing = await loadDecisionByTurn(db, input.turn_id);
  if (existing) return { decision_id: existing.id, outbound_id: existing.outbound_message_id };

  // 2. Integridad. Un rechazo NO se poda: se lanza para que el loop repare.
  const context = await loadIntegrityContext(db, input.turn_id);
  const verdict = checkAgentTurnIntegrityV3({
    decision: input.decision, context, rejection_id: input.trace_id,
  });
  if (!verdict.ok) throw new AgentTurnV3RejectedError(verdict.rejection);

  // 3. Renderizar. El texto entregado es función pura de bloques + artefactos.
  const table = await loadArtifactTable(db, input.turn_id, context.authorized_fact_ids);
  const rendered = renderBlocksV3(input.decision.blocks, table);
  if (rendered.missing.length > 0) throw new AgentTurnV3RejectedError({ /* ...UNRESOLVED_REFERENCE */ });

  // 4. Commitear SÓLO las preparaciones listadas. El resto vence sin efecto.
  await db`
    UPDATE agent_turn_preparations SET committed_at = now()
    WHERE id = ANY(${input.decision.commit_preparations}::uuid[]) AND committed_at IS NULL
  `;

  // 5. Partir el patch y aplicar SÓLO la mitad inmediata.
  const { immediate, deferred } = splitStatePatchV3(input.decision.state_patch);
  await applyImmediatePatch(db, input.turn_id, immediate);   // falla con STATE_VERSION_CONFLICT

  // 6. Escribir la decisión con su manifiesto.
  const decisionId = await insertDecision(db, input, rendered.text);

  // 7. Guardar la mitad diferida junto al outbound y encolar el outbox.
  const outboundId = await registerOutbound(db, decisionId, rendered.text);
  await db`
    UPDATE outbound_deliveries SET deferred_state_patch = ${JSON.stringify(deferred)}::jsonb
    WHERE outbound_message_id = ${outboundId}::uuid
  `;
  return { decision_id: decisionId, outbound_id: outboundId };
}
```

Implementar los helpers `loadDecisionByTurn`, `loadIntegrityContext`,
`loadArtifactTable`, `applyImmediatePatch`, `insertDecision` y `registerOutbound`
reusando las consultas equivalentes de `decision.service.ts` (líneas 400-430 para
la carga de la decisión existente, 918-960 para el `INSERT`, 1120-1180 para el
outbox), y `AgentTurnV3RejectedError` con la misma forma que
`AgentTurnV2RejectedError`.

- [ ] **Step 5: Aplicar el patch diferido en el reporte de entrega**

En `src/app/api/agent/outbounds/[outbound_id]/delivery/route.ts`, después de
registrar el reporte y **sólo** cuando `status === 'submitted_to_botpress'`,
dentro de la misma transacción:

```ts
      const pending = await db<Array<{ deferred_state_patch: StatePatchV3 | null }>>`
        SELECT deferred_state_patch FROM outbound_deliveries
        WHERE outbound_message_id = ${outboundId}::uuid
          AND deferred_patch_applied_on IS NULL
        FOR UPDATE
      `;
      const patch = pending[0]?.deferred_state_patch;
      if (patch && Object.keys(patch.set).length > 0) {
        await applyDeferredPatch(db, outboundId, patch);
        await db`
          UPDATE outbound_deliveries SET deferred_patch_applied_on = 'accepted'
          WHERE outbound_message_id = ${outboundId}::uuid
        `;
      }
```

Una entrega `failed` **no** entra en esta rama: el patch queda sin aplicar y el
estado ligado a visibilidad no se mueve.

- [ ] **Step 6: Correr los dos tests y verificar que pasan**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-loop-delivery-failure.test.ts tests/integration/agent-loop-exactly-once.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/features/conversation/application/commit-agent-turn-v3.ts src/app/api/agent/outbounds tests/integration/agent-loop-delivery-failure.test.ts tests/integration/agent-loop-exactly-once.test.ts
git commit -m "feat(agent-a): commit atomico del turno y patch diferido a la aceptacion"
```

---

## Task 2.11: Manifiesto de release por turno

**Files:**
- Modify: `scripts/generate-release-manifest.mjs` (agregar dos campos)
- Modify: `src/features/conversation/application/commit-agent-turn-v3.ts` (persistirlo)
- Modify: `src/app/api/diagnostics/route.ts` (comparar el esperado con el observado)
- Test: `tests/unit/scripts/release-manifest-agent-loop.test.ts`

**Interfaces:**
- Consumes: `createReleaseManifest` existente.
- Produces: `createReleaseManifest` acepta y valida `promptSha256` (64 hex) y
  `toolContractVersion` (string no vacía), y los emite como `prompt_sha256` y
  `tool_contract_version`.

- [ ] **Step 1: Escribir el test**

Crear `tests/unit/scripts/release-manifest-agent-loop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createReleaseManifest, REQUIRED_RELEASE_CONFIG } from '../../../scripts/generate-release-manifest.mjs';

const complete = Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, true]));
const base = {
  requiredConfig: complete,
  environment: 'test',
  gitSha: 'a'.repeat(40),
  botpressArtifactSha: 'b'.repeat(64),
  promptVersion: 'studyx-agent-a-brain-v21',
  provider: 'deepseek-direct',
  model: 'deepseek-v4-flash',
  latestMigration: '20260905000004_agent_turn_preparations',
  catalogSourceSha256: 'c'.repeat(64),
  builtAt: '2026-09-05T00:00:00.000Z',
  promptSha256: 'd'.repeat(64),
  toolContractVersion: 'agent-tools-v3.0.0',
};

describe('release manifest for the agent loop', () => {
  it('carries the effective prompt digest and the tool contract version', () => {
    const manifest = createReleaseManifest(base);
    expect(manifest.prompt_sha256).toBe('d'.repeat(64));
    expect(manifest.tool_contract_version).toBe('agent-tools-v3.0.0');
  });

  it('refuses a prompt digest that is not a sha256', () => {
    expect(() => createReleaseManifest({ ...base, promptSha256: 'nope' }))
      .toThrow('INVALID_RELEASE_MANIFEST_PROMPT_SHA256');
  });

  it('refuses an empty tool contract version', () => {
    expect(() => createReleaseManifest({ ...base, toolContractVersion: '' }))
      .toThrow('INVALID_RELEASE_MANIFEST_TOOL_CONTRACT_VERSION');
  });
});
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run --config vitest.config.mts tests/unit/scripts/release-manifest-agent-loop.test.ts`
Expected: FAIL, `expected undefined to be 'dddd…'`.

- [ ] **Step 3: Agregar los dos campos al generador**

En `scripts/generate-release-manifest.mjs`, dentro del objeto que devuelve
`createReleaseManifest`, después de `catalog_source_sha256`:

```js
    prompt_sha256: requireDigest(input.promptSha256, 'INVALID_RELEASE_MANIFEST_PROMPT_SHA256'),
    tool_contract_version: requireNonEmptyString(
      input.toolContractVersion,
      'INVALID_RELEASE_MANIFEST_TOOL_CONTRACT_VERSION',
    ),
```

Y en `generateReleaseManifest`, calcular el digest del prompt **efectivo**
(el que sale de `buildAgentABrainInstructionsV1`, ya sustituido) con
`createHash('sha256').update(effectivePrompt).digest('hex')`.

- [ ] **Step 4: Correrlo y verificar que pasa**

Run: `npx vitest run --config vitest.config.mts tests/unit/scripts/release-manifest-agent-loop.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Persistirlo por turno**

En `commit-agent-turn-v3.ts`, agregar `release_manifest` a las columnas del
`INSERT INTO agent_decisions`, con `${jsonbParam(db, input.release_manifest)}`.

- [ ] **Step 6: Exponer la comparación en diagnostics**

En `src/app/api/diagnostics/route.ts`, agregar al payload:

```ts
    prompt_parity: {
      expected_sha256: buildManifest().prompt_sha256,
      last_observed_sha256: (await sql<Array<{ sha: string | null }>>`
        SELECT release_manifest ->> 'prompt_sha256' AS sha
        FROM agent_decisions
        WHERE release_manifest IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `)[0]?.sha ?? null,
    },
```

Una divergencia entre ambos es la respuesta a «¿el prompt desplegado es el que
evalué?», sin depender del Control Panel de Botpress.

- [ ] **Step 7: Gate completo de la fase y commit**

```bash
npm run lint && npm run typecheck && npm run test:unit
git add scripts/generate-release-manifest.mjs src/features/conversation/application/commit-agent-turn-v3.ts src/app/api/diagnostics/route.ts tests/unit/scripts/release-manifest-agent-loop.test.ts
git commit -m "feat(agent-a): manifiesto de release por turno y paridad de prompt verificable"
```

---

## Task 2.12: La vuelta de reparación y el fallback técnico completo

Cierra §3.5 y §3.8 de la spec. `integrity_check` **no es una herramienta**: el
rechazo se inyecta como item del orquestador. Una sola devolución; si la segunda
respuesta también falla, sale un fallback técnico **entero**, sin poda.

**Files:**
- Modify: `agent-core/src/loop.ts`
- Test: `tests/unit/agent-core/repair-and-fallback.test.ts`

**Interfaces:**
- Consumes: `runAgentTurnV3` (2.3), `IntegrityRejectionV1` (2.9).
- Produces: `runAgentTurnWithIntegrityV3(deps, input): Promise<{ outcome: 'decided'; decision: AgentTurnDecisionV3; repaired: boolean } | { outcome: 'fallback'; reason: 'AGENT_LOOP_INTEGRITY_FAILED' | 'AGENT_LOOP_BUDGET_EXHAUSTED'; rejection: IntegrityRejectionV1 | null }>`.
  `deps` suma `check(decision): { ok: true } | { ok: false; rejection: IntegrityRejectionV1 }`.

- [ ] **Step 1: Escribir los tests**

Crear `tests/unit/agent-core/repair-and-fallback.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runAgentTurnWithIntegrityV3 } from '../../../agent-core/src/loop';

const good = {
  schema_version: 3 as const,
  blocks: [{ type: 'narrative' as const, text: 'Listo.' }],
  commit_preparations: [], used_memory_ids: [],
  state_patch: { expected_state_version: 1, set: {} },
  response_type: 'commercial_reply',
};
const bad = { ...good, blocks: [{ type: 'narrative' as const, text: 'Sale USD 47.' }] };
const rejection = {
  rejection_id: 'r-1', attempt: 1 as const,
  violations: [{ code: 'NARRATIVE_CONTAINS_AMOUNT', subject: 'narrative' }],
  authorized_alternatives: { fact_ids: ['fact:price:one_time'], preparations: [], missing_information: [] },
};

function deps(decisions: unknown[], checks: Array<{ ok: boolean }>) {
  let d = 0, c = 0;
  return {
    model: { generate: vi.fn(async () => ({ decision: decisions[d++] })) },
    tools: { execute: vi.fn() },
    now: () => 0,
    check: vi.fn(() => (checks[c++]!.ok ? { ok: true } : { ok: false, rejection })),
  };
}

describe('runAgentTurnWithIntegrityV3', () => {
  it('returns the decision untouched when integrity accepts it', async () => {
    const result = await runAgentTurnWithIntegrityV3(
      deps([good], [{ ok: true }]),
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({ outcome: 'decided', decision: good, repaired: false });
  });

  it('gives the rejection back to the agent as an orchestrator item, not a tool result', async () => {
    const d = deps([bad, good], [{ ok: false }, { ok: true }]);
    const result = await runAgentTurnWithIntegrityV3(d, {
      instructions: 'x', conversation: [], toolDefinitions: [],
    });
    expect(result).toEqual({ outcome: 'decided', decision: good, repaired: true });

    const second = d.model.generate.mock.calls[1]![0] as { conversation: Array<Record<string, unknown>> };
    const injected = second.conversation.at(-1)!;
    expect(injected.role).toBe('developer');
    expect(injected).not.toHaveProperty('call_id');
    expect(String(injected.content)).toContain('NARRATIVE_CONTAINS_AMOUNT');
  });

  it('never offers integrity_check as a callable tool', async () => {
    const d = deps([good], [{ ok: true }]);
    await runAgentTurnWithIntegrityV3(d, {
      instructions: 'x', conversation: [],
      toolDefinitions: [{ type: 'function', function: { name: 'search_catalog' } }],
    });
    const offered = d.model.generate.mock.calls[0]![0] as { toolDefinitions: any[] };
    expect(JSON.stringify(offered.toolDefinitions)).not.toContain('integrity_check');
  });

  it('emits a complete technical fallback after ONE failed repair, never a pruned answer', async () => {
    const result = await runAgentTurnWithIntegrityV3(
      deps([bad, bad], [{ ok: false }, { ok: false }]),
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({
      outcome: 'fallback', reason: 'AGENT_LOOP_INTEGRITY_FAILED', rejection,
    });
    // Nada del texto rechazado sobrevive.
    expect(JSON.stringify(result)).not.toContain('USD 47');
  });

  it('only repairs once: a third generation never happens', async () => {
    const d = deps([bad, bad], [{ ok: false }, { ok: false }]);
    await runAgentTurnWithIntegrityV3(d, { instructions: 'x', conversation: [], toolDefinitions: [] });
    expect(d.model.generate).toHaveBeenCalledTimes(2);
  });

  it('falls back with the budget reason when the loop never decided', async () => {
    const result = await runAgentTurnWithIntegrityV3(
      { model: { generate: vi.fn(async () => ({ tool_calls: [] })) },
        tools: { execute: vi.fn() }, now: () => 0, check: vi.fn() },
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({
      outcome: 'fallback', reason: 'AGENT_LOOP_BUDGET_EXHAUSTED', rejection: null,
    });
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/repair-and-fallback.test.ts`
Expected: FAIL, `runAgentTurnWithIntegrityV3 is not a function`.

- [ ] **Step 3: Implementar la reparación y el fallback**

Agregar a `agent-core/src/loop.ts`:

```ts
export type AgentTurnWithIntegrityResultV3 =
  | { readonly outcome: 'decided'; readonly decision: AgentTurnDecisionV3; readonly repaired: boolean }
  | {
      readonly outcome: 'fallback';
      readonly reason: 'AGENT_LOOP_INTEGRITY_FAILED' | 'AGENT_LOOP_BUDGET_EXHAUSTED';
      readonly rejection: unknown | null;
    };

export async function runAgentTurnWithIntegrityV3(
  deps: {
    readonly model: ModelProvider;
    readonly tools: ToolExecutor;
    readonly now: () => number;
    readonly check: (decision: AgentTurnDecisionV3) => { ok: true } | { ok: false; rejection: unknown };
  },
  input: {
    readonly instructions: string;
    readonly conversation: readonly ModelTurnItemV3[];
    readonly toolDefinitions: readonly unknown[];
  },
): Promise<AgentTurnWithIntegrityResultV3> {
  const first = await runAgentTurnV3(deps, input);
  if (first.outcome === 'exhausted') {
    return { outcome: 'fallback', reason: 'AGENT_LOOP_BUDGET_EXHAUSTED', rejection: null };
  }

  const verdict = deps.check(first.decision);
  if (verdict.ok) return { outcome: 'decided', decision: first.decision, repaired: false };

  // El rechazo vuelve como item DEL ORQUESTADOR, no como `role: 'tool'`:
  // integrity_check no es una herramienta que el modelo pueda elegir.
  const repaired = await runAgentTurnV3(deps, {
    ...input,
    conversation: [
      ...input.conversation,
      { role: 'developer', content: JSON.stringify(verdict.rejection) },
    ],
  });
  if (repaired.outcome === 'exhausted') {
    return { outcome: 'fallback', reason: 'AGENT_LOOP_INTEGRITY_FAILED', rejection: verdict.rejection };
  }

  const second = deps.check(repaired.decision);
  if (second.ok) return { outcome: 'decided', decision: repaired.decision, repaired: true };

  // Una sola devolución. Sin poda: el turno emite un fallback técnico ENTERO,
  // sin hechos comerciales, sin acciones y sin transición de estado. Un texto
  // parcialmente verdadero induce una decisión de compra sobre información
  // incompleta y contamina el estado; un fallback honesto no.
  return { outcome: 'fallback', reason: 'AGENT_LOOP_INTEGRITY_FAILED', rejection: verdict.rejection };
}
```

- [ ] **Step 4: Correrlos y verificar que pasan**

Run: `npx vitest run --config vitest.config.mts tests/unit/agent-core/repair-and-fallback.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Cablear el fallback en el commit**

En `src/features/conversation/application/commit-agent-turn-v3.ts`, agregar la
rama de fallback: cuando el loop devuelve `outcome: 'fallback'`, la decisión que
se commitea es

```ts
  {
    schema_version: 4, intent: 'commercial', kind: 'reply',
    response: resolveTechnicalFallbackV1({
      consecutive_technical_fallbacks: state.consecutive_technical_fallbacks,
      human_review_already_requested: state.human_review_requested_at != null,
    }).text,
    response_type: 'clarification',
    business_action: null,          // cero acciones
    memory_candidates: [],          // cero memorias
    missing_information: [],
    next_state: 'waiting_user',
    reason_code: result.reason,     // AGENT_LOOP_INTEGRITY_FAILED | ..._BUDGET_EXHAUSTED
    confidence: 1,
  }
```

y **no** se aplica ningún patch —ni inmediato ni diferido—, ni se commitea
ninguna preparación. Se persiste `release_manifest` y la traza del rechazo.

- [ ] **Step 6: Commit**

```bash
git add agent-core/src/loop.ts src/features/conversation/application/commit-agent-turn-v3.ts tests/unit/agent-core/repair-and-fallback.test.ts
git commit -m "feat(agent-a): una reparacion y fallback tecnico entero sin poda"
```

---

## Task 2.13: Las cuatro preparaciones restantes y la memoria que supersede

**Files:**
- Modify: `src/features/conversation/application/agent-tools-prepare.ts`
- Test: `tests/integration/agent-tools-prepare-rest.test.ts`

**Interfaces:**
- Consumes: la tabla `agent_turn_preparations` (2.8).
- Produces: `prepareContactDetailsToolV1(deps, args: { first_name?, last_name?, email?, phone? })`,
  `prepareCallRequestToolV1(deps, args: { reason: string })`,
  `prepareMemoryToolV1(deps, args: { candidates: { text, type, supersedes: string[] }[] })`,
  `prepareLeadProjectionToolV1(deps)`. Todas devuelven `ToolResultV1` con
  `preparation_id`, misma idempotencia por `canonical_key`.

- [ ] **Step 1: Escribir los tests**

Crear `tests/integration/agent-tools-prepare-rest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import {
  prepareCallRequestToolV1, prepareContactDetailsToolV1, prepareMemoryToolV1,
} from '@/features/conversation/application/agent-tools-prepare';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('remaining prepare tools', () => {
  it('reports which intake fields are still missing so the agent can ask', async () => {
    const seeded = await seedConversationForAgentTurn({});
    const deps = { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id,
                   contact_id: seeded.contact_id };
    const result = await prepareContactDetailsToolV1(deps, { first_name: 'Ana' });
    expect(result.success).toBe(true);
    expect(result.canonical_data!.recorded).toEqual(['nombre']);
    expect(result.canonical_data!.still_missing).toContain('correo');
  });

  it('reserves a call without dispatching it', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const result = await prepareCallRequestToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id,
        contact_id: seeded.contact_id },
      { reason: 'customer_request' },
    );
    expect(result.canonical_data!.status).toBe('reserved');
    const dispatched = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM call_events WHERE event_type = 'provider_accepted'
    `;
    expect(dispatched[0]!.n).toBe(0);
  });

  it('marks the superseded memory so a correction wins on the next turn', async () => {
    const seeded = await seedConversationForAgentTurn({});
    const first = await prepareMemoryToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { candidates: [{ text: 'Quiere marketing', type: 'study_goal', supersedes: [] }] },
    );
    const second = await prepareMemoryToolV1(
      { db: sql, turn_id: seeded.second_turn_id, conversation_id: seeded.conversation_id },
      { candidates: [{ text: 'En realidad quiere finanzas', type: 'study_goal',
                       supersedes: [first.canonical_data!.accepted[0]!.id] }] },
    );
    expect(second.canonical_data!.supersedes).toEqual([first.canonical_data!.accepted[0]!.id]);
  });
});
```

- [ ] **Step 2: Correrlos y verificar que fallan**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-tools-prepare-rest.test.ts`
Expected: FAIL, las tres funciones no existen.

- [ ] **Step 3: Implementar las cuatro, reusando la reserva idempotente**

Extraer de `preparePaymentLinkToolV1` el helper común y aplicarlo a las cuatro:

```ts
async function reserve<T>(
  deps: PrepareDeps, tool: string, canonicalKey: string, data: T,
): Promise<ToolResultV1<T>> {
  const rows = await deps.db<Array<{ id: string; canonical_data: T; inserted: boolean }>>`
    WITH attempted AS (
      INSERT INTO agent_turn_preparations (turn_id, conversation_id, tool, canonical_key, canonical_data)
      VALUES (${deps.turn_id}::uuid, ${deps.conversation_id}::uuid, ${tool}, ${canonicalKey}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (conversation_id, tool, canonical_key) DO NOTHING
      RETURNING id, canonical_data, true AS inserted
    )
    SELECT * FROM attempted
    UNION ALL
    SELECT e.id, e.canonical_data, false AS inserted FROM agent_turn_preparations AS e
    WHERE NOT EXISTS (SELECT 1 FROM attempted)
      AND e.conversation_id = ${deps.conversation_id}::uuid
      AND e.tool = ${tool} AND e.canonical_key = ${canonicalKey}
    LIMIT 1
  `;
  const row = rows[0]!;
  return { tool, success: true, canonical_data: row.canonical_data, error_code: null,
    recoverable: false, idempotency_result: row.inserted ? 'applied' : 'duplicate',
    preparation_id: row.id };
}
```

`prepareContactDetailsToolV1` calcula `recorded` y `still_missing` con
`missingContactIntakeFieldsV1` y reserva con clave
`${Object.keys(args).sort().join(',')}`.
`prepareCallRequestToolV1` reserva con clave `call:${args.reason}` y
`canonical_data = { call_id: randomUUID(), status: 'reserved' }`; **no** llama a
`reserveCallForDecision` — eso pasa en el commit.
`prepareMemoryToolV1` reserva con clave `memory:${sha256 de los textos}` y
`canonical_data = { accepted: [...], rejected: [], supersedes: [...] }`.
`prepareLeadProjectionToolV1` reserva con clave `lead` y
`canonical_data = { queued: false }`.

- [ ] **Step 4: Correrlos y verificar que pasan**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-tools-prepare-rest.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/conversation/application/agent-tools-prepare.ts tests/integration/agent-tools-prepare-rest.test.ts
git commit -m "feat(agent-a): preparaciones de intake, llamada, memoria y lead"
```

---

## Task 2.14: Concurrencia, caída entre preparación y commit, y recuperación

Las tres pruebas de §6 de la spec que ninguna tarea anterior cubre.

**Files:**
- Test: `tests/integration/agent-loop-concurrency.test.ts`
- Test: `tests/integration/agent-loop-prepare-crash.test.ts`
- Test: `tests/integration/agent-loop-fallback-recovery.test.ts`

**Interfaces:**
- Consumes: todo lo anterior. No produce código nuevo salvo el vencimiento de
  reservas: `expireStalePreparationsV1(db, olderThanMs): Promise<number>`.

- [ ] **Step 1: Escribir el test de concurrencia**

Crear `tests/integration/agent-loop-concurrency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('optimistic concurrency', () => {
  it('rejects the second commit built on a stale state version', async () => {
    const seeded = await seedConversationForAgentTurn({});
    const decision = (turnId: string) => ({
      turn_id: turnId, trace_id: seeded.trace_id,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3 as const,
        blocks: [{ type: 'narrative' as const, text: 'Dale.' }],
        commit_preparations: [], used_memory_ids: [],
        state_patch: {
          expected_state_version: seeded.state_version,
          set: { selected_offering_code: 'dip-mkt' },
        },
        response_type: 'commercial_reply',
      },
    });

    await commitAgentTurnV3(sql, decision(seeded.turn_id));
    // El segundo turno trae la MISMA versión esperada, que ya quedó vieja.
    await expect(commitAgentTurnV3(sql, decision(seeded.second_turn_id)))
      .rejects.toThrow('STATE_VERSION_CONFLICT');
  });
});
```

- [ ] **Step 2: Escribir el test de caída entre preparación y commit**

Crear `tests/integration/agent-loop-prepare-crash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { preparePaymentLinkToolV1, expireStalePreparationsV1 } from '@/features/conversation/application/agent-tools-prepare';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('crash between prepare and commit', () => {
  it('leaves no effect and lets the reservation expire', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    const prepared = await preparePaymentLinkToolV1(
      { db: sql, turn_id: seeded.turn_id, conversation_id: seeded.conversation_id },
      { offering_code: 'dip-mkt', payment_plan: 'one_time' },
    );
    // Se simula la caída: no se llama a commitAgentTurnV3.
    await sql`
      UPDATE agent_turn_preparations SET created_at = now() - interval '1 hour'
      WHERE id = ${prepared.preparation_id}::uuid
    `;

    const decisions = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_decisions WHERE turn_id = ${seeded.turn_id}::uuid
    `;
    expect(decisions[0]!.n).toBe(0);

    expect(await expireStalePreparationsV1(sql, 15 * 60 * 1000)).toBe(1);

    const surviving = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM agent_turn_preparations
      WHERE id = ${prepared.preparation_id}::uuid
    `;
    expect(surviving[0]!.n).toBe(0);
  });
});
```

- [ ] **Step 3: Escribir el test de recuperación del fallback**

Crear `tests/integration/agent-loop-fallback-recovery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

describe('technical fallback', () => {
  it('leaves the state untouched and lets the next turn converse normally', async () => {
    const seeded = await seedConversationForAgentTurn({ selected_offering_code: 'dip-mkt' });
    const store = new PostgresConversationStateStoreV1(sql);
    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);

    await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id, trace_id: seeded.trace_id,
      release_manifest: seeded.release_manifest,
      fallback: { reason: 'AGENT_LOOP_INTEGRITY_FAILED', rejection: { rejection_id: 'r-1' } },
    });

    const after = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(after!.version).toBe(before!.version);
    expect(after!.stage).toBe(before!.stage);
    expect(after!.awaiting_reply).toBe(before!.awaiting_reply);

    const committed = await sql<Array<{ reason_code: string; business_action: unknown; response: string }>>`
      SELECT reason_code, business_action, response FROM agent_decisions
      WHERE turn_id = ${seeded.turn_id}::uuid
    `;
    expect(committed[0]!.reason_code).toBe('AGENT_LOOP_INTEGRITY_FAILED');
    expect(committed[0]!.business_action).toBeNull();
    expect(committed[0]!.response.length).toBeGreaterThan(0);

    // El turno siguiente no arrastra nada del fallback.
    const next = await commitAgentTurnV3(sql, {
      turn_id: seeded.second_turn_id, trace_id: seeded.trace_id,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Perdón, retomamos. ¿Qué te interesa?' }],
        commit_preparations: [], used_memory_ids: [],
        state_patch: { expected_state_version: after!.version, set: {} },
        response_type: 'commercial_reply',
      },
    });
    expect(next.outbound_id).toBeTruthy();
  });
});
```

- [ ] **Step 4: Correr los tres y verificar que fallan**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-loop-concurrency.test.ts tests/integration/agent-loop-prepare-crash.test.ts tests/integration/agent-loop-fallback-recovery.test.ts`
Expected: FAIL. Concurrencia falla porque `applyImmediatePatch` todavía no
compara la versión; crash falla porque `expireStalePreparationsV1` no existe;
recovery falla porque `commitAgentTurnV3` no acepta `fallback`.

- [ ] **Step 5: Implementar el chequeo de versión**

En `commit-agent-turn-v3.ts`, `applyImmediatePatch` escribe con la versión en el
`WHERE` y verifica que afectó una fila:

```ts
  const updated = await db<Array<{ id: string }>>`
    UPDATE conversation_sales_context_states_v1
    SET ${db(patchColumns)}, version = version + 1, updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid
      AND conversation_id = ${conversationId}::uuid
      AND version = ${patch.expected_state_version}
    RETURNING id
  `;
  if (updated.length === 0) throw new DecisionPolicyError('STATE_VERSION_CONFLICT');
```

- [ ] **Step 6: Implementar el vencimiento de reservas**

En `agent-tools-prepare.ts`:

```ts
/**
 * Una reserva sin commitear no es un efecto: vence. Lo corre el cron de
 * reconciliación, y su ausencia nunca deja un cobro colgado.
 */
export async function expireStalePreparationsV1(db: any, olderThanMs: number): Promise<number> {
  const deleted = await db<Array<{ id: string }>>`
    DELETE FROM agent_turn_preparations
    WHERE committed_at IS NULL
      AND created_at < now() - make_interval(secs => ${olderThanMs / 1000})
    RETURNING id
  `;
  return deleted.length;
}
```

Registrarlo en `src/app/api/cron/reconcile-orchestration/route.ts` con
`await expireStalePreparationsV1(sql, 15 * 60 * 1000)`.

- [ ] **Step 7: Aceptar la rama `fallback` en el commit**

En `commit-agent-turn-v3.ts`, hacer `decision` y `fallback` mutuamente
excluyentes en el input, y en la rama `fallback` saltear integridad, renderer,
preparaciones y **ambos** patches, escribiendo sólo la decisión de §Task 2.12
Step 5 con su `release_manifest`.

- [ ] **Step 8: Correr los tres y verificar que pasan**

Run: `npx vitest run --config vitest.integration.config.mts tests/integration/agent-loop-concurrency.test.ts tests/integration/agent-loop-prepare-crash.test.ts tests/integration/agent-loop-fallback-recovery.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add src/features/conversation/application src/app/api/cron/reconcile-orchestration/route.ts tests/integration/agent-loop-concurrency.test.ts tests/integration/agent-loop-prepare-crash.test.ts tests/integration/agent-loop-fallback-recovery.test.ts
git commit -m "feat(agent-a): concurrencia optimista, vencimiento de reservas y rama de fallback"
```

---

# Cierre de Fase 2

Al terminar la Tarea 2.11 el sistema tiene el agent loop completo y probado, y
**apagado**: `agent_loop_rollout_v3` no tiene ninguna fila, así que
`resolveAgentLoopModeV3` devuelve `'off'` para todos y la ruta `plannerless_v2`
sigue atendiendo a los clientes exactamente igual que antes.

**Verificación de cierre:**

```bash
npm run lint && npm run typecheck && npm run test:unit
npx vitest run --config vitest.integration.config.mts
npx vitest run --config vitest.workflow.config.mts
```

Los tres verdes. Si `test:workflow` muestra turnos mudos nuevos, son consecuencia
del rechazo de la Tarea 0.2 y son evidencia para Fase 3: **no se afloja el
rechazo para taparlos.**

**Las Fases 3-5 se planifican después**, con las latencias reales medidas en el
smoke (Tarea 1.1) y en los tests de workflow.
