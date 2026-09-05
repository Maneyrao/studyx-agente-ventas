import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db/orchestrator';
import { processInboundMessage } from '@/lib/services/ingestion.service';

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
  /**
   * Mismo escenario que `proposalWithCallOfferAndFalsePrice` pero para la
   * autoridad `conversation_pipeline_v1` (Tarea 0.2, ronda 2): un `move`
   * `select_course` que dispara `should_offer_call` en el planner
   * determinista, para usar junto con `compositionWithCallOfferAndFalsePrice`.
   * `plan_hash` NO va acá — depende del estado leído en el momento del commit,
   * así que el test lo deriva llamando a `authoritativelyPlanConversationTurnV1`
   * con este mismo `move`.
   */
  readonly moveSelectCourseWithCallOffer: Record<string, unknown>;
  /**
   * Composición canónica cuya `narrative.explanation` afirma un precio falso
   * ("USD 47") que ningún hecho canónico respalda. El compositor determinista
   * no lo rechaza —sólo exige cita para valores que SÍ coinciden con un hecho
   * real (`COMPOSER_UNCITED_CANONICAL_FACT`)— así que sobrevive hasta
   * `enforceCommercialTruthV1`, que lo veta por `PRICE_NOT_CANONICAL` mientras
   * dispara la aparición de la llamada por separado (`plan.should_offer_call`,
   * en su propio párrafo).
   */
  readonly compositionWithCallOfferAndFalsePrice: Record<string, unknown>;
}

/**
 * Siembra un workspace, un contacto, una conversación y dos turnos entrantes en
 * el cluster DESECHABLE. Nunca toca producción: `tests/setup/integration.ts` ya
 * pisó `DATABASE_URL` con `TEST_DATABASE_URL`.
 *
 * DEVIACIONES respecto del SQL del brief (Ruling F1 — se documentan también en
 * el reporte de la Tarea 0.2):
 *
 * 1. Los dos turnos entrantes y su primer lote se siembran con
 *    `processInboundMessage` (el mismo camino de producción), no con INSERT
 *    crudos. `loadTurnPolicy` en decision.service.ts hace INNER JOIN contra
 *    `channel_events`/`channel_threads` vía `messages.source_event_id`; el
 *    brief no sembraba esas filas y ese INNER JOIN habría devuelto cero filas
 *    (`DecisionTurnNotFoundError`), no el bug bajo prueba.
 * 2. `contacts` no tiene `first_name`/`last_name`/`phone_e164`, y `status`
 *    nunca vale `'activo'` (CHECK admite `prospecto|cliente|inactivo`, y
 *    `channel_origin` es NOT NULL). `intake_complete` en cambio escribe
 *    `contacts.name`/`contacts.email`, que es lo que
 *    `loadContactIntakeV1`/`commercialIntakeFromContactRowV1` leen de verdad
 *    (ver `src/lib/repositories/contact-intake.repository.ts`).
 * 3. `inbound_batches.state` no tiene el valor `'open'` del brief — los
 *    válidos son `waiting|claimed|completed|abandoned`, y
 *    `inbound_batches_claim_shape_check` exige que `claim_token` sólo esté
 *    seteado cuando `state = 'claimed'`. El primer lote se reclama con un
 *    UPDATE directo (no con `claim_inbound_batch`, que exige esperar a
 *    `due_at`) para obtener un `claim_token` real y válido sin dormir el
 *    test. Reclamar el primer lote también libera el índice de "un lote
 *    'waiting' por conversación", así el segundo `processInboundMessage`
 *    abre un lote nuevo y separado (`second_batch_id`).
 * 4. `selected_offering_code` por defecto es `'diplomado-marketing'` en el
 *    brief, un código que no existe en el catálogo sembrado
 *    (`supabase/seed/studyx-temarios.sql`). Se usa `'entrenamiento_funcional'`
 *    (USD 360 real) para que "USD 47" en `proposalWithCallOfferAndFalsePrice`
 *    sea verificablemente un precio no canónico. No se usó `'barista'`
 *    (también USD 360): `tests/integration/studyx-manual-catalog.test.ts`
 *    aplica `supabase/seed/studyx-manual.sql` sobre el cluster COMPARTIDO de
 *    la suite y esa sincronización desactiva `barista` de forma permanente
 *    para el resto de la corrida (`PostgresSalesContextStore.transition`
 *    exige `status = 'active'`). `entrenamiento_funcional` está en ambos
 *    catálogos — el base y los 40 cursos del manual sync — y sigue activo
 *    después de esa sincronización.
 * 5. La segunda oración de `proposalWithCallOfferAndFalsePrice.response.messages`
 *    se reescribió para que dispare `solicitsACall` de verdad: el guard exige
 *    `CALL_SUBJECT` (p. ej. "llamemos") Y `SOLICITATION` ("te gustaría", "te
 *    parece", etc.). "¿Te sirve que te llamemos para verlo?" no matchea
 *    `SOLICITATION`; "¿Te gustaría que te llamemos para contarte más?" sí.
 * 6. `commitAgentDecision`/`CommitDecisionInput` (decision.service.ts) no
 *    declara `batch_id` ni `claim_token` — el fencing por lote vive en la capa
 *    de orquestación (`commit-claimed-decision.ts`), no en esta función. Se
 *    devuelven igual en `SeededAgentTurn` porque las Tareas 2.4/2.5/2.6/2.8/
 *    2.10/2.12/2.14 los necesitan contra esa otra capa; el test de la Tarea
 *    0.2 no se los pasa a `commitAgentDecision`.
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

  const phoneE164 = `+54911${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
  const externalConversationId = `agent-turn-fixture-${traceId}`;
  const integrationId = 'vitest-agent-turn-fixture';

  const envelope = (text: string, suffix: string) => ({
    schema_version: 1 as const,
    source: 'botpress' as const,
    channel: 'emulator' as const,
    integration_id: integrationId,
    external_message_id: `agent-turn-fixture-${traceId}-${suffix}`,
    external_conversation_id: externalConversationId,
    external_user_id: `agent-turn-fixture-user-${traceId}`,
    phone_e164: phoneE164,
    trace_id: randomUUID(),
    message: {
      type: 'text' as const,
      text,
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
  });

  const first = await processInboundMessage(envelope('Hola, quiero info', '1'));

  // Reclama el primer lote directo por SQL: `claim_inbound_batch` sólo
  // permite reclamar una vez vencido `due_at` (la ventana de batching), y el
  // fixture no puede dormir esa ventana en cada test. El UPDATE deja la fila
  // en una forma igual de válida bajo `inbound_batches_claim_shape_check`.
  const [claimed] = await sql<Array<{ claim_token: string }>>`
    UPDATE inbound_batches
    SET state = 'claimed',
        claim_token = gen_random_uuid(),
        claimed_by = 'agent-turn-fixture',
        claimed_at = now(),
        lease_until = now() + interval '120 seconds',
        claim_attempt_count = claim_attempt_count + 1,
        version = version + 1,
        updated_at = now()
    WHERE id = ${first.batch.id}::uuid
    RETURNING claim_token
  `;
  if (!claimed) throw new Error('AGENT_TURN_FIXTURE_CLAIM_FAILED');

  // El primer lote ya no está 'waiting', así que este segundo inbound abre un
  // lote propio en vez de unirse al primero.
  const second = await processInboundMessage(envelope('Dale, seguimos', '2'));

  await sql`
    INSERT INTO workspace_contacts (workspace_id, contact_id)
    VALUES (${workspace.id}::uuid, ${first.contact.id}::uuid)
    ON CONFLICT DO NOTHING
  `;

  if (options.intake_complete) {
    await sql`
      UPDATE contacts
      SET name = 'Ana Pérez', email = ${`ana.${traceId}@example.test`}
      WHERE id = ${first.contact.id}::uuid
    `;
  }

  await sql`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id, selected_offering_code,
      selected_payment_plan, stage, call_preference, call_offer_status,
      call_offer_count, awaiting_reply
    ) VALUES (
      ${workspace.id}::uuid, ${first.conversation_id}::uuid, ${first.contact.id}::uuid,
      ${options.selected_offering_code ?? null}, NULL, 'exploring', 'unknown',
      'not_offered', ${options.call_offer_count ?? 0}, 'none'
    )
    ON CONFLICT (workspace_id, conversation_id) DO NOTHING
  `;
  const [state] = await sql<Array<{ version: number }>>`
    SELECT version FROM conversation_sales_context_states_v1
    WHERE workspace_id = ${workspace.id}::uuid AND conversation_id = ${first.conversation_id}::uuid
  `;
  if (!state) throw new Error('AGENT_TURN_FIXTURE_STATE_MISSING');

  return {
    workspace_id: workspace.id,
    contact_id: first.contact.id,
    conversation_id: first.conversation_id,
    turn_id: first.turn_id,
    second_turn_id: second.turn_id,
    batch_id: first.batch.id,
    second_batch_id: second.batch.id,
    claim_token: claimed.claim_token,
    trace_id: traceId,
    state_version: Number(state.version),
    release_manifest: {
      git_sha: 'a'.repeat(40),
      botpress_artifact_sha: 'b'.repeat(64),
      prompt_version: 'studyx-agent-a-brain-v21',
      model: 'deepseek-v4-flash',
      prompt_sha256: 'd'.repeat(64),
      tool_contract_version: 'agent-tools-v3.0.0',
    },
    model: { provider: 'deepseek-direct', model: 'deepseek-v4-flash', prompt_version: 'studyx-agent-a-brain-v21' },
    placeholderDecision: {
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'El backend preparará la respuesta autorizada.',
      response_type: 'commercial_reply',
      confidence: 1,
      reason_code: 'CONVERSATION_PIPELINE_V1_PENDING_BACKEND',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: null,
    },
    // Ofrece llamada Y afirma un precio que el catálogo no respalda
    // ('entrenamiento_funcional' vale USD 360, no USD 47): el guard veta la
    // segunda oración y deja viva la primera. Ese veto PARCIAL es el que hoy
    // persiste una transición sobre texto no entregado.
    proposalWithCallOfferAndFalsePrice: {
      schema_version: 1,
      move: {
        schema_version: 1,
        move: 'select_course',
        secondary_moves: [],
        vetoes: [],
        confidence: 1,
        course_reference: options.selected_offering_code ?? 'entrenamiento_funcional',
      },
      response: {
        messages: [
          'El diplomado sale USD 47.',
          '¿Te gustaría que te llamemos para contarte más?',
        ],
        call_offer: null,
      },
      used_fact_ids: [],
      used_memory_ids: [],
      memory_candidates: [],
      proposed_action: { type: 'none' },
      repair_of: null,
    },
    moveSelectCourseWithCallOffer: {
      schema_version: 1,
      move: 'select_course',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
      course_reference: options.selected_offering_code ?? 'entrenamiento_funcional',
    },
    // 'entrenamiento_funcional' vale USD 360, no USD 47 — el mismo precio
    // falso que usa el escenario del proposal, para que ambas autoridades
    // ejerciten exactamente la misma verdad canónica.
    compositionWithCallOfferAndFalsePrice: {
      schema_version: 1,
      narrative: {
        opening: 'Genial, ese es un gran curso.',
        explanation: 'El curso sale USD 47.',
        next_question: null,
      },
      call_offer: null,
      used_fact_ids: [],
    },
  };
}
