import postgres from 'postgres';
import { inspectLocalTestDatabaseUrl } from './db';
import {
  workflowDeliveredLinksV1,
  type WorkflowAdapterCaptureV1,
  type WorkflowBlockingEvidenceV1,
  type WorkflowDecisionObservationV1,
  type WorkflowOutboundObservationV1,
} from './agent-a-workflow-measurement';

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
    readonly lifecycleStatus: string | null;
    readonly blockedAt: string | null;
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
  readonly permission: WorkflowBlockingEvidenceV1['permission'];
  readonly decisions: readonly WorkflowDecisionObservationV1[];
  readonly outbound: readonly WorkflowOutboundObservationV1[];
  readonly outboundCount: number;
  readonly deliveryStates: readonly string[];
  readonly recordedLinks: readonly string[];
  /** Captura local correlacionada con submission durable. NO acuse de Telegram. */
  readonly deliveredLinks: readonly string[];
  /** Stable local outbox row used to update one Google Sheets lead row. */
  readonly sheetProjectionKeys: readonly string[];
  readonly deliveryScope: 'local_adapter';
}

const SYNTHETIC_PREFIX = '+999';

export async function readWorkflowDbEvidenceV1(input: {
  readonly databaseUrl: string;
  readonly externalConversationId: string;
  readonly adapterCaptures?: readonly WorkflowAdapterCaptureV1[];
}): Promise<WorkflowDbEvidenceV1> {
  const inspection = inspectLocalTestDatabaseUrl(input.databaseUrl);
  if (!inspection.allowed) throw new Error(inspection.reason);
  const db = postgres(input.databaseUrl, { max: 2 });
  try {
    const rows = await db<Array<{
      contact_id: string;
      conversation_id: string;
      phone: string;
      declared_phone: string | null;
      name: string | null;
      email: string | null;
      lifecycle_status: string | null;
      blocked_at: Date | null;
      channel: string;
    }>>`
      SELECT c.id AS contact_id, conv.id AS conversation_id,
             c.phone, c.declared_phone, c.name, c.email, c.lifecycle_status, c.blocked_at,
             conv.channel
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
        contact: null, permission: null, state: null, decisions: [], outbound: [],
        outboundCount: 0, deliveryStates: [], recordedLinks: [], deliveredLinks: [],
        sheetProjectionKeys: [], deliveryScope: 'local_adapter',
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
      SELECT d.turn_id, d.outbound_message_id, d.created_at,
             d.reason_code, d.response_type, d.response, d.business_action,
             d.prompt_version, d.model_name
      FROM agent_decisions AS d
      JOIN messages AS m ON m.id = d.turn_id
      WHERE m.conversation_id = ${row.conversation_id}::uuid
      ORDER BY d.created_at ASC
    `;

    const outboundRows = await db<Array<{
      id: string; turn_id: string; trace_id: string | null; authorized_outbound_id: string | null;
      content: string; state: string | null; provider_message_id: string | null;
    }>>`
      SELECT m.id, m.in_reply_to AS turn_id,
             COALESCE(part_decision.trace_id, direct_decision.trace_id) AS trace_id,
             COALESCE(part.message_id, direct_decision.outbound_message_id) AS authorized_outbound_id,
             m.content, od.state, od.provider_message_id
      FROM messages AS m
      LEFT JOIN agent_decision_outbound_parts AS part ON part.message_id = m.id
      LEFT JOIN agent_decisions AS part_decision
        ON part_decision.id = part.decision_id AND part_decision.turn_id = m.in_reply_to
      LEFT JOIN agent_decisions AS direct_decision
        ON direct_decision.turn_id = m.in_reply_to AND direct_decision.outbound_message_id = m.id
      LEFT JOIN outbound_deliveries AS od ON od.message_id = m.id AND od.conversation_id = m.conversation_id
      WHERE m.conversation_id = ${row.conversation_id}::uuid AND m.direction = 'outbound'
      ORDER BY m.created_at ASC
    `;

    const permissions = await db<Array<{
      consent_status: string; evidence_event_id: string | null;
      revoked_at: Date | null; revoked_turn_id: string | null;
    }>>`
      SELECT p.consent_status, p.evidence_event_id,
             CASE WHEN e.consent_status = 'revoked' THEN e.recorded_at END AS revoked_at,
             m.id AS revoked_turn_id
      FROM contact_channel_permissions AS p
      LEFT JOIN consent_events AS e ON e.id = p.evidence_event_id
        AND e.contact_id = p.contact_id AND e.channel = p.channel
      LEFT JOIN messages AS m ON m.source_event_id = e.source_event_id AND m.direction = 'inbound'
      WHERE p.contact_id = ${row.contact_id}::uuid AND p.channel = ${row.channel}
      LIMIT 1
    `;

    const outbound = outboundRows.map((message) => ({
      externalConversationId: input.externalConversationId,
      id: message.id, turnId: message.turn_id, traceId: message.trace_id,
      authorizedOutboundId: message.authorized_outbound_id, content: message.content,
      deliveryState: message.state, providerMessageId: message.provider_message_id,
    }));
    const permission = permissions[0];
    const sheetRows = await db<Array<{ projection_key: string }>>`
      SELECT projection.projection_key
      FROM sheet_projection_rows AS projection
      JOIN workspace_contacts AS workspace_contact
        ON projection.projection_key = (
          'lead:' || workspace_contact.workspace_id::text || ':' || workspace_contact.contact_id::text
        )
      WHERE workspace_contact.contact_id = ${row.contact_id}::uuid
      ORDER BY projection.created_at ASC
    `;

    const state = states[0];
    return {
      contact: {
        phone: row.phone,
        declaredPhone: row.declared_phone,
        name: row.name,
        email: row.email,
        lifecycleStatus: row.lifecycle_status,
        blockedAt: row.blocked_at?.toISOString() ?? null,
        phoneIsSynthetic: (row.phone ?? '').startsWith(SYNTHETIC_PREFIX),
      },
      permission: permission ? {
        consentStatus: permission.consent_status,
        evidenceEventId: permission.evidence_event_id,
        revokedAt: permission.revoked_at?.toISOString() ?? null,
        revokedTurnId: permission.revoked_turn_id,
      } : null,
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
        turnId: String(decision.turn_id),
        outboundId: (decision.outbound_message_id as string | null) ?? null,
        createdAt: (decision.created_at as Date).toISOString(),
        reasonCode: (decision.reason_code as string | null) ?? null,
        responseType: (decision.response_type as string | null) ?? null,
        hasResponse: decision.response !== null,
        businessActionType:
          (decision.business_action as { type?: string } | null)?.type ?? null,
        promptVersion: (decision.prompt_version as string | null) ?? null,
        modelName: (decision.model_name as string | null) ?? null,
      })),
      outbound,
      outboundCount: outbound.length,
      deliveryStates: outbound.flatMap((message) => message.deliveryState ? [message.deliveryState] : []),
      recordedLinks: outbound.flatMap((message) => message.content.match(/https?:\/\/\S+/gu) ?? []),
      deliveredLinks: workflowDeliveredLinksV1({ outbound, adapterCaptures: input.adapterCaptures ?? [] }),
      sheetProjectionKeys: sheetRows.map((sheetRow) => sheetRow.projection_key),
      deliveryScope: 'local_adapter',
    };
  } finally {
    await db.end({ timeout: 5 });
  }
}
