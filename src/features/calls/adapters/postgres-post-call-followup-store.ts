import type postgres from 'postgres';
import type { CallResult } from '@/lib/contracts/call-event';
import type { CallStatus } from '../domain/call-state';
import type { PostCallFollowupStore, TerminalCallForFollowup } from '../ports/post-call-followup-store';

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
      status: CallStatus;
      result: CallResult | null;
      analysis_status: 'pending' | 'completed' | 'failed';
      prompt_version: string;
    }>>`
      SELECT cs.id, cs.contact_id, cs.conversation_id, cs.status, cs.result,
             cs.analysis_status, cs.prompt_version
      FROM call_sessions AS cs
      WHERE cs.status = ANY(${TERMINAL_STATUSES})
        AND cs.updated_at < now() - make_interval(secs => ${input.grace_seconds})
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
      status: row.status,
      result: row.result,
      analysis_status: row.analysis_status,
      prompt_version: row.prompt_version,
    }));
  }

  async hasVerifiedPayment(contactId: string): Promise<boolean> {
    const rows = await this.db<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM payments WHERE contact_id = ${contactId}::uuid AND status = 'paid'
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
}
