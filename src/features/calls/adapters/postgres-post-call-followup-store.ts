import type postgres from 'postgres';
import type { CallResult } from '@/lib/contracts/call-event';
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

  async listPendingFollowups(input: {
    limit: number;
    grace_seconds: number;
  }): Promise<TerminalCallForFollowup[]> {
    const rows = await this.db<Array<{
      id: string;
      contact_id: string;
      conversation_id: string;
      workspace_id: string;
      status: CallStatus;
      provider: 'telegram_sandbox' | 'retell';
      result: CallResult | null;
      analysis_status: 'pending' | 'completed' | 'failed';
      prompt_version: string;
      do_not_contact: boolean;
    }>>`
      SELECT cs.id, cs.contact_id, cs.conversation_id, cs.status, cs.result, cs.provider,
             cs.workspace_id, cs.analysis_status, cs.prompt_version,
             EXISTS (
               SELECT 1 FROM call_events AS analysis_event
               WHERE analysis_event.call_id = cs.id
                 AND analysis_event.event_type = 'analyzed'
                 AND analysis_event.payload -> 'analysis' ->> 'pidio_no_contactar' = 'true'
             ) AS do_not_contact
      FROM call_sessions AS cs
      JOIN workspaces AS workspace
        ON workspace.id = cs.workspace_id
       AND workspace.status = 'active'
      JOIN workspace_contacts AS wc
        ON wc.workspace_id = cs.workspace_id
       AND wc.contact_id = cs.contact_id
       AND wc.lifecycle_status = 'active'
      WHERE cs.status = ANY(${TERMINAL_STATUSES})
        AND cs.updated_at < now() - make_interval(secs => ${input.grace_seconds})
        AND (
          cs.provider <> 'retell'
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
              AND dnc_event.payload -> 'analysis' ->> 'pidio_no_contactar' = 'true'
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM channel_events AS ce
          WHERE ce.event_kind = 'system_call_result'
            AND ce.external_event_id = 'system:call_result:' || cs.id::text
        )
      ORDER BY cs.updated_at ASC
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      call_id: row.id,
      contact_id: row.contact_id,
      conversation_id: row.conversation_id,
      workspace_id: row.workspace_id,
      provider: row.provider,
      status: row.status,
      result: row.result,
      analysis_status: row.analysis_status,
      prompt_version: row.prompt_version,
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

  async isContactBlocked(contactId: string): Promise<boolean> {
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
        ON ccp.contact_id = c.id AND ccp.channel = 'whatsapp'
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
      // Reuse the exact same event: the call-result turn already carries the
      // evidence that produced this verdict (the call analysis said
      // no_contactar). No separate opt-out message text is needed or implied.
      const events = await tx<Array<{ id: string }>>`
        SELECT id FROM channel_events
        WHERE event_kind = 'system_call_result'
          AND external_event_id = ${'system:call_result:' + input.call_id}
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
    });
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
