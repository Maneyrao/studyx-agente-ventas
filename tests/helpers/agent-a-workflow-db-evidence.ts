import postgres from 'postgres';

/**
 * Evidencia de persistencia del laboratorio de workflow.
 *
 * "Registré tus datos" es texto: no demuestra que haya algo registrado. Hasta
 * acá el arnés afirmaba que el turno se entregaba y que el commit devolvía OK,
 * que son dos cosas distintas de que el estado durable haya quedado bien.
 *
 * Esto lee la base aislada después de la conversación y devuelve lo que la
 * venta necesita que sea cierto: curso, plan, intake, ledger de llamadas,
 * aviso de pago, links materializados y entregas. Ninguna consulta escribe.
 *
 * La conexión se abre contra el mismo cluster desechable del backend. Si
 * apunta a otra cosa, el guard de aislamiento del evaluador ya habría abortado
 * antes de que existiera una conversación que mirar.
 */
export interface WorkflowDbEvidenceV1 {
  readonly contact: {
    readonly phone: string | null;
    readonly declaredPhone: string | null;
    readonly name: string | null;
    readonly email: string | null;
    /** `true` cuando el teléfono del canal es sintético (`+999…`). */
    readonly phoneIsSynthetic: boolean;
  } | null;
  readonly state: {
    readonly selectedOfferingCode: string | null;
    readonly selectedPaymentPlan: string | null;
    readonly stage: string;
    readonly callPreference: string;
    readonly callOfferStatus: string;
    readonly callOfferCount: number;
    readonly awaitingReply: string;
    readonly paymentReportedAt: string | null;
    readonly humanReviewRequestedAt: string | null;
  } | null;
  readonly decisions: readonly {
    readonly reasonCode: string | null;
    readonly responseType: string | null;
    readonly hasResponse: boolean;
    readonly businessActionType: string | null;
    readonly promptVersion: string | null;
    readonly modelName: string | null;
  }[];
  readonly outboundCount: number;
  readonly deliveryStates: readonly string[];
  /** URLs canónicas que efectivamente salieron en un mensaje entregado. */
  readonly deliveredLinks: readonly string[];
}

const SYNTHETIC_PREFIX = '+999';

export async function readWorkflowDbEvidenceV1(input: {
  readonly databaseUrl: string;
  readonly externalConversationId: string;
}): Promise<WorkflowDbEvidenceV1> {
  const db = postgres(input.databaseUrl, { max: 2 });
  try {
    const rows = await db<Array<{
      contact_id: string;
      conversation_id: string;
      phone: string;
      declared_phone: string | null;
      name: string | null;
      email: string | null;
    }>>`
      SELECT c.id AS contact_id, conv.id AS conversation_id,
             c.phone, c.declared_phone, c.name, c.email
      FROM channel_threads AS ct
      JOIN contacts AS c ON c.id = ct.contact_id
      JOIN conversations AS conv ON conv.channel_thread_id = ct.id
      WHERE ct.external_conversation_id = ${input.externalConversationId}
      ORDER BY conv.created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return {
        contact: null, state: null, decisions: [],
        outboundCount: 0, deliveryStates: [], deliveredLinks: [],
      };
    }

    const states = await db<Array<Record<string, unknown>>>`
      SELECT selected_offering_code, selected_payment_plan, stage, call_preference,
             call_offer_status, call_offer_count, awaiting_reply,
             payment_reported_at, human_review_requested_at
      FROM conversation_sales_context_states_v1
      WHERE conversation_id = ${row.conversation_id}::uuid
      LIMIT 1
    `;

    // `agent_decisions.turn_id` referencia `messages`: el turno es su mensaje
    // entrante representativo. No existe una tabla `turns`.
    const decisions = await db<Array<Record<string, unknown>>>`
      SELECT d.reason_code, d.response_type, d.response, d.business_action,
             d.prompt_version, d.model_name
      FROM agent_decisions AS d
      JOIN messages AS m ON m.id = d.turn_id
      WHERE m.conversation_id = ${row.conversation_id}::uuid
      ORDER BY d.created_at ASC
    `;

    const outbound = await db<Array<{ content: string }>>`
      SELECT content FROM messages
      WHERE conversation_id = ${row.conversation_id}::uuid AND direction = 'outbound'
      ORDER BY created_at ASC
    `;

    const deliveries = await db<Array<{ state: string }>>`
      SELECT state FROM outbound_deliveries
      WHERE conversation_id = ${row.conversation_id}::uuid
      ORDER BY created_at ASC
    `;

    const deliveredLinks = outbound
      .flatMap((message) => message.content.match(/https?:\/\/\S+/gu) ?? []);

    const state = states[0];
    return {
      contact: {
        phone: row.phone,
        declaredPhone: row.declared_phone,
        name: row.name,
        email: row.email,
        phoneIsSynthetic: (row.phone ?? '').startsWith(SYNTHETIC_PREFIX),
      },
      state: state
        ? {
            selectedOfferingCode: (state.selected_offering_code as string | null) ?? null,
            selectedPaymentPlan: (state.selected_payment_plan as string | null) ?? null,
            stage: String(state.stage ?? ''),
            callPreference: String(state.call_preference ?? ''),
            callOfferStatus: String(state.call_offer_status ?? ''),
            callOfferCount: Number(state.call_offer_count ?? 0),
            awaitingReply: String(state.awaiting_reply ?? ''),
            paymentReportedAt: (state.payment_reported_at as string | null) ?? null,
            humanReviewRequestedAt: (state.human_review_requested_at as string | null) ?? null,
          }
        : null,
      decisions: decisions.map((decision) => ({
        reasonCode: (decision.reason_code as string | null) ?? null,
        responseType: (decision.response_type as string | null) ?? null,
        hasResponse: decision.response !== null,
        businessActionType:
          (decision.business_action as { type?: string } | null)?.type ?? null,
        promptVersion: (decision.prompt_version as string | null) ?? null,
        modelName: (decision.model_name as string | null) ?? null,
      })),
      outboundCount: outbound.length,
      deliveryStates: deliveries.map((delivery) => delivery.state),
      deliveredLinks,
    };
  } finally {
    await db.end({ timeout: 5 });
  }
}
