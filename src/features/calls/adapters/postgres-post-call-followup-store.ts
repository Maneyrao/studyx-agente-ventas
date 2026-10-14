import type postgres from 'postgres';
import type { DbClient } from '@/lib/db/types';
import { STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION } from '@/shared/prompts/studyx-agent-a-canonical.generated';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import type { PostCallNarrativeContext } from '../ports/post-call-followup-composer';
import type { CallEndReason, CallResult } from '@/lib/contracts/call-event';
import type { CallStatus } from '../domain/call-state';
import type { PostCallFollowupStore, TerminalCallForFollowup } from '../ports/post-call-followup-store';
import { synthesizeCallResultTurn } from '../application/synthesize-call-result-turn';
import { withSerializableTransactionOn } from '@/lib/db/transaction';

const TERMINAL_STATUSES: readonly CallStatus[] = [
  'completed',
  'failed',
  'no_answer',
  'timed_out',
  'cancelled',
];

export class PostgresPostCallFollowupStore implements PostCallFollowupStore {
  constructor(private readonly db: postgres.Sql) {}

  async loadNarrativeContext(call: TerminalCallForFollowup): Promise<PostCallNarrativeContext> {
    if (!call.workspace_id) throw new Error('WORKSPACE_UNRESOLVED');
    const rows = await this.db<Array<{
      academy_name: string; course_interest: string | null; conversation_summary: string | null;
      selected_offering_code: string | null; course_name: string | null;
      selected_payment_plan: string | null; failure_code: string | null;
      analysis: PostCallNarrativeContext['analysis'];
    }>>`
      SELECT
        workspace.display_name AS academy_name,
        cs.context_snapshot ->> 'curso_interes' AS course_interest,
        cs.context_snapshot ->> 'resumen_whatsapp' AS conversation_summary,
        state.selected_offering_code, offering.display_name AS course_name,
        state.selected_payment_plan,
        CASE WHEN cs.error_code ~ '^[A-Z][A-Z0-9_]{0,127}$' THEN cs.error_code ELSE NULL END AS failure_code,
        CASE WHEN analysis.payload IS NOT NULL THEN jsonb_build_object(
          'summary', analysis.payload -> 'analysis' ->> 'call_summary',
          'pending_commitment', analysis.payload -> 'analysis' ->> 'compromiso_pendiente',
          'principal_objection', analysis.payload -> 'analysis' ->> 'objecion_principal',
          'interest_level', analysis.payload -> 'analysis' ->> 'nivel_interes'
        ) ELSE NULL END AS analysis
      FROM call_sessions AS cs
      JOIN workspaces AS workspace ON workspace.id = cs.workspace_id AND workspace.status = 'active'
      JOIN workspace_contacts AS wc ON wc.workspace_id = cs.workspace_id
        AND wc.contact_id = cs.contact_id AND wc.lifecycle_status = 'active'
      LEFT JOIN conversation_sales_context_states_v1 AS state
        ON state.workspace_id = cs.workspace_id AND state.conversation_id = cs.conversation_id
        AND state.contact_id = cs.contact_id
      LEFT JOIN offerings AS offering
        ON offering.workspace_id = cs.workspace_id AND offering.code = state.selected_offering_code
        AND offering.status = 'active'
      LEFT JOIN LATERAL (
        SELECT payload FROM call_events WHERE call_id = cs.id AND event_type = 'analyzed'
        ORDER BY sequence DESC, occurred_at DESC, id DESC LIMIT 1
      ) AS analysis ON TRUE
      WHERE cs.id = ${call.call_id}::uuid AND cs.workspace_id = ${call.workspace_id}::uuid
        AND cs.contact_id = ${call.contact_id}::uuid AND cs.conversation_id = ${call.conversation_id}::uuid
    `;
    const row = rows[0];
    if (!row) throw new Error('FOLLOWUP_CONTEXT_UNRESOLVED');
    const history = await this.db<Array<{ direction: 'inbound' | 'outbound'; text: string }>>`
      SELECT direction, left(content, 2000) AS text FROM messages
      WHERE conversation_id = ${call.conversation_id}::uuid AND contact_id = ${call.contact_id}::uuid
        AND content <> '[system:call_result]'
      ORDER BY conversation_seq DESC NULLS LAST, created_at DESC, id DESC LIMIT 12
    `;
    return {
      academy_name: row.academy_name,
      customer: { contact_intake: await loadContactIntakeV1(call.contact_id, this.db) },
      selected_course: row.selected_offering_code && row.course_name
        ? { code: row.selected_offering_code, name: row.course_name } : null,
      selected_payment_plan: row.selected_payment_plan,
      history: history.reverse(),
      call_context: { course_interest: row.course_interest, conversation_summary: row.conversation_summary },
      analysis: row.analysis,
      failure_code: row.failure_code,
    };
  }

  private async readNarrativeOn(db: DbClient, call: TerminalCallForFollowup): Promise<string | null> {
    const rows = await db<Array<{ text: string | null }>>`
      SELECT COALESCE(
        (
          SELECT message.content FROM outbound_deliveries AS delivery
          JOIN messages AS message ON message.id = delivery.message_id
          WHERE delivery.idempotency_key = ${`post-call:${call.call_id}`}
            AND message.contact_id = cs.contact_id AND message.conversation_id = cs.conversation_id
          ORDER BY message.created_at, message.id LIMIT 1
        ),
        CASE WHEN source.metadata -> 'post_call_followup_narrative_v1' ->> 'call_id' = cs.id::text
          THEN source.metadata -> 'post_call_followup_narrative_v1' ->> 'text' END
      ) AS text
      FROM call_sessions AS cs
      JOIN messages AS source ON source.id = cs.source_turn_id
        AND source.contact_id = cs.contact_id AND source.conversation_id = cs.conversation_id
      WHERE cs.id = ${call.call_id}::uuid AND cs.contact_id = ${call.contact_id}::uuid
        AND cs.conversation_id = ${call.conversation_id}::uuid
        AND cs.workspace_id = ${call.workspace_id}::uuid
    `;
    return rows[0]?.text ?? null;
  }

  async readFollowupNarrative(call: TerminalCallForFollowup): Promise<string | null> {
    return this.readNarrativeOn(this.db, call);
  }

  async readFollowupNarrativeCourse(call: TerminalCallForFollowup): Promise<PostCallNarrativeContext['selected_course']> {
    const rows = await this.db<Array<{ code: string | null; name: string | null }>>`
      SELECT
        source.metadata -> 'post_call_followup_narrative_v1' -> 'selected_course' ->> 'code' AS code,
        source.metadata -> 'post_call_followup_narrative_v1' -> 'selected_course' ->> 'name' AS name
      FROM call_sessions AS cs JOIN messages AS source ON source.id = cs.source_turn_id
      WHERE cs.id = ${call.call_id}::uuid AND cs.contact_id = ${call.contact_id}::uuid
        AND cs.conversation_id = ${call.conversation_id}::uuid AND cs.workspace_id = ${call.workspace_id}::uuid
        AND source.metadata -> 'post_call_followup_narrative_v1' ->> 'call_id' = cs.id::text
    `;
    const row = rows[0];
    return row?.code?.trim() && row.name?.trim() ? { code: row.code, name: row.name } : null;
  }

  async commitFollowupNarrative(call: TerminalCallForFollowup, text: string, selectedCourse?: PostCallNarrativeContext['selected_course']): Promise<string> {
    return this.db.begin(async (tx) => {
      const locked = await tx<Array<{ source_turn_id: string }>>`
        SELECT source_turn_id FROM call_sessions
        WHERE id = ${call.call_id}::uuid AND contact_id = ${call.contact_id}::uuid
          AND conversation_id = ${call.conversation_id}::uuid AND workspace_id = ${call.workspace_id}::uuid
        FOR UPDATE
      `;
      if (!locked[0]) throw new Error('FOLLOWUP_CONTEXT_UNRESOLVED');
      const previous = await this.readNarrativeOn(tx, call);
      if (previous !== null) return previous;
      // source_turn_id is unique per call. This is an authored draft, not a
      // completion marker or an extra visible message. Network IO stays outside
      // this short transaction; the normal managed delivery lease owns sending.
      await tx`
        UPDATE messages SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb), '{post_call_followup_narrative_v1}',
          ${tx.json({ schema_version: 1, call_id: call.call_id, text, selected_course: selectedCourse ?? null, author: 'agent_a', canonical_prompt_version: STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION })}, TRUE
        )
        WHERE id = ${locked[0].source_turn_id}::uuid
      `;
      return text;
    });
  }

  async expireStaleAcceptedCalls(input: { timeout_seconds: number }): Promise<number> {
    const rows = await this.db<Array<{ id: string }>>`
      UPDATE call_sessions AS stale
      SET
        status = 'timed_out',
        completed_at = COALESCE(stale.completed_at, now()),
        error_code = COALESCE(stale.error_code, 'CALL_START_TIMEOUT')
      WHERE stale.status = 'provider_accepted'
        AND stale.provider_accepted_at IS NOT NULL
        AND stale.provider_accepted_at
          <= now() - make_interval(secs => ${input.timeout_seconds})
        AND NOT EXISTS (
          SELECT 1
          FROM call_events AS lifecycle
          WHERE lifecycle.call_id = stale.id
            AND lifecycle.event_type IN ('started', 'ended', 'analyzed')
        )
      RETURNING stale.id
    `;
    return rows.length;
  }

  async revalidateFollowup(input: {
    call_id: string;
    trace_id: string;
  }): Promise<{ do_not_contact: boolean }> {
    return this.db.begin(async (tx) => {
      const rows = await tx<Array<{
        contact_id: string;
        conversation_id: string;
        do_not_contact: boolean;
      }>>`
        SELECT
          cs.contact_id,
          cs.conversation_id,
          (
            cs.result = 'no_contactar'
            OR EXISTS (
              SELECT 1 FROM call_events AS analysis_event
              WHERE analysis_event.call_id = cs.id
                AND analysis_event.event_type = 'analyzed'
                AND (
                  analysis_event.payload -> 'analysis' ->> 'pidio_no_contactar' = 'true'
                  OR analysis_event.payload -> 'analysis' ->> 'result' = 'no_contactar'
                  OR analysis_event.payload -> 'analysis' ->> 'resultado' = 'no_contactar'
                )
            )
            OR EXISTS (SELECT 1 FROM consent_events WHERE event_key = 'call:' || cs.id::text || ':no_contactar')
          ) AS do_not_contact
        FROM call_sessions AS cs
        WHERE cs.id = ${input.call_id}::uuid
        FOR UPDATE
      `;
      const call = rows[0];
      if (!call) throw new Error('CALL_NOT_FOUND');
      if (!call.do_not_contact) return { do_not_contact: false };

      await this.ensureDncPermission(tx, {
        call_id: input.call_id,
        contact_id: call.contact_id,
      });
      // The call lock is held while the canonical revocation and the
      // idempotent system-call-result marker are committed. The transaction
      // ends before the caller can reach sendOutbound.
      await synthesizeCallResultTurn({
        call_id: input.call_id,
        contact_id: call.contact_id,
        conversation_id: call.conversation_id,
        trace_id: input.trace_id,
      }, tx);
      return { do_not_contact: true };
    });
  }

  async listPendingFollowups(input: {
    limit: number;
    grace_seconds: number;
    call_id?: string;
  }): Promise<TerminalCallForFollowup[]> {
    const rows = await this.db<Array<{
      id: string;
      contact_id: string;
      conversation_id: string;
      workspace_id: string | null;
      channel: 'telegram' | 'whatsapp';
      status: CallStatus;
      provider: 'telegram_sandbox' | 'retell';
      result: CallResult | null;
      analysis_status: 'pending' | 'completed' | 'failed';
      prompt_version: string;
      disconnection_reason: CallEndReason | null;
      provider_disconnection_reason: string | null;
      do_not_contact: boolean;
    }>>`
      SELECT cs.id, cs.contact_id, cs.conversation_id, cs.status, cs.result, cs.provider,
             cs.workspace_id, cs.analysis_status, cs.prompt_version, conversation.channel,
             ended.payload->>'disconnection_reason' AS disconnection_reason,
             ended.payload->>'provider_disconnection_reason' AS provider_disconnection_reason,
             EXISTS (
               SELECT 1 FROM call_events AS analysis_event
               WHERE analysis_event.call_id = cs.id
               AND analysis_event.event_type = 'analyzed'
               AND (
                 analysis_event.payload -> 'analysis' ->> 'pidio_no_contactar' = 'true'
                 OR analysis_event.payload -> 'analysis' ->> 'result' = 'no_contactar'
                 OR analysis_event.payload -> 'analysis' ->> 'resultado' = 'no_contactar'
               )
             )
             OR cs.result = 'no_contactar'
             OR EXISTS (SELECT 1 FROM consent_events WHERE event_key = 'call:' || cs.id::text || ':no_contactar') AS do_not_contact
      FROM call_sessions AS cs
      JOIN conversations AS conversation
        ON conversation.id = cs.conversation_id
       AND conversation.contact_id = cs.contact_id
      LEFT JOIN LATERAL (
        SELECT event.payload
        FROM call_events AS event
        WHERE event.call_id = cs.id AND event.event_type = 'ended'
        ORDER BY event.sequence DESC, event.occurred_at DESC, event.id DESC
        LIMIT 1
      ) AS ended ON TRUE
      LEFT JOIN workspaces AS workspace
        ON workspace.id = cs.workspace_id
       AND workspace.status = 'active'
      LEFT JOIN workspace_contacts AS wc
        ON wc.workspace_id = cs.workspace_id
       AND wc.contact_id = cs.contact_id
       AND wc.lifecycle_status = 'active'
      WHERE cs.status = ANY(${TERMINAL_STATUSES})
        AND (${input.call_id ?? null}::uuid IS NULL OR cs.id = ${input.call_id ?? null}::uuid)
        -- Recomputing analysis legitimately touches updated_at; grace is
        -- measured from terminal completion so an append+projection commit
        -- cannot hide an already-completed call from the next sweep.
        AND COALESCE(cs.completed_at, cs.updated_at)
          < now() - make_interval(secs => ${input.grace_seconds})
        AND (
          EXISTS (
            SELECT 1 FROM call_events AS dnc_event
            WHERE dnc_event.call_id = cs.id
              AND dnc_event.event_type = 'analyzed'
              AND (
                dnc_event.payload -> 'analysis' ->> 'pidio_no_contactar' = 'true'
                OR dnc_event.payload -> 'analysis' ->> 'result' = 'no_contactar'
                OR dnc_event.payload -> 'analysis' ->> 'resultado' = 'no_contactar'
              )
            )
          OR cs.result = 'no_contactar'
          OR EXISTS (SELECT 1 FROM consent_events WHERE event_key = 'call:' || cs.id::text || ':no_contactar')
          OR (cs.workspace_id IS NOT NULL AND workspace.id IS NOT NULL AND wc.contact_id IS NOT NULL)
        )
        AND (
          cs.provider <> 'retell'
          OR cs.status IN ('timed_out', 'no_answer', 'failed')
          OR (
            cs.status = 'completed'
            AND EXISTS (
              SELECT 1 FROM call_events AS ended_event
              WHERE ended_event.call_id = cs.id
                AND ended_event.provider = 'retell'
                AND ended_event.event_type = 'ended'
            )
          )
          OR EXISTS (
            SELECT 1 FROM call_events AS webhook_event
            WHERE webhook_event.call_id = cs.id
              AND webhook_event.provider = 'retell'
              AND webhook_event.event_id = 'retell:webhook:call_analyzed:' || cs.provider_call_id
          )
          OR EXISTS (
            SELECT 1 FROM call_events AS dnc_event
            WHERE dnc_event.call_id = cs.id
              AND dnc_event.event_type = 'analyzed'
              AND (
                dnc_event.payload -> 'analysis' ->> 'pidio_no_contactar' = 'true'
                OR dnc_event.payload -> 'analysis' ->> 'result' = 'no_contactar'
                OR dnc_event.payload -> 'analysis' ->> 'resultado' = 'no_contactar'
              )
            )
          OR cs.result = 'no_contactar'
          OR EXISTS (SELECT 1 FROM consent_events WHERE event_key = 'call:' || cs.id::text || ':no_contactar')
        )
        AND NOT EXISTS (
          SELECT 1 FROM channel_events AS ce
          WHERE ce.event_kind = 'system_call_result'
            AND ce.external_event_id = 'system:call_result:' || cs.id::text
        )
      ORDER BY COALESCE(cs.completed_at, cs.updated_at) ASC
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      call_id: row.id,
      contact_id: row.contact_id,
      conversation_id: row.conversation_id,
      workspace_id: row.workspace_id,
      channel: row.channel,
      provider: row.provider,
      status: row.status,
      result: row.result,
      analysis_status: row.analysis_status,
      prompt_version: row.prompt_version,
      disconnection_reason: row.disconnection_reason,
      provider_disconnection_reason: row.provider_disconnection_reason,
      do_not_contact: row.do_not_contact,
    }));
  }

  async hasVerifiedPayment(contactId: string, workspaceId: string, callId: string, provider: 'telegram_sandbox' | 'retell'): Promise<boolean> {
    const rows = await this.db<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM payments
        WHERE contact_id = ${contactId}::uuid
          AND workspace_id = ${workspaceId}::uuid
          AND status = 'paid'
          AND (${provider} <> 'retell' OR idempotency_key LIKE ${`retell:payment:${callId}:%`})
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  }

  async isContactBlocked(contactId: string, channel: 'telegram' | 'whatsapp'): Promise<boolean> {
    const rows = await this.db<Array<{ blocked: boolean }>>`
      SELECT (
        c.status = 'inactivo'
        OR c.lifecycle_status = 'blocked'
        OR c.lifecycle_status = 'deleted'
        OR c.deleted_at IS NOT NULL
        OR ccp.consent_status = 'revoked'
      ) AS blocked
      FROM contacts AS c
      LEFT JOIN contact_channel_permissions AS ccp
        ON ccp.contact_id = c.id AND ccp.channel = ${channel}
      WHERE c.id = ${contactId}::uuid
    `;
    return rows[0]?.blocked ?? true;
  }

  async revokeContact(input: {
    contact_id: string;
    call_id: string;
    trace_id: string;
  }): Promise<void> {
    await this.db.begin(async (tx) => {
      await this.ensureDncPermission(tx, input);
    });
  }

  private async ensureDncPermission(
    tx: postgres.TransactionSql,
    input: { call_id: string; contact_id: string },
  ): Promise<void> {
    // The event key is the durable identity. The first convergence may happen
    // during appendEvent, before a system_call_result marker exists, so a
    // replay must reuse its original NULL source_event_id rather than bind the
    // same key to a different marker later.
    const existing = await tx<Array<{ id: string }>>`
      SELECT id FROM consent_events
      WHERE event_key = ${`call:${input.call_id}:no_contactar`}
      LIMIT 1
    `;
    if (existing[0]) return;

    const events = await tx<Array<{ id: string }>>`
      SELECT id FROM channel_events
      WHERE event_kind = 'system_call_result'
        AND external_event_id = ${'system:call_result:' + input.call_id}
      LIMIT 1
    `;
    const eventId = events[0]?.id ?? null;
    await tx`
      SELECT * FROM record_contact_permission_event(
        ${`call:${input.call_id}:no_contactar`},
        ${input.contact_id}::uuid,
        'whatsapp',
        'revoked',
        'call_analysis_no_contactar',
        ${eventId}::uuid,
        ${tx.json({ call_id: input.call_id })},
        now()
      )
    `;
  }

  async markFollowupCompleted(input: {
    call_id: string;
    contact_id: string;
    conversation_id: string;
    trace_id: string;
  }): Promise<void> {
    await withSerializableTransactionOn(this.db, (db) => synthesizeCallResultTurn(input, db));
  }
}
