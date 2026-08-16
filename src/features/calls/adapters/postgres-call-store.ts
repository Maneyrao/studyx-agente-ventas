import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { CallEventSchema, type CallEvent } from '@/lib/contracts/call-event';
import { hashCallContext, parseCallContext } from '../domain/call-context';
import { projectCallState, type CallProjection } from '../domain/call-state';
import type { CallStore, DispatchClaim } from '../ports/call-store';

type CallRow = {
  id: string;
  phone_e164: string;
  status: string;
  provider_call_id: string | null;
  request_idempotency_key: string;
  context_snapshot: unknown;
  context_hash_hex: string;
  dispatch_lease_until: Date | string | null;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresCallStore implements CallStore {
  constructor(private readonly db: postgres.Sql) {}

  async claimDispatch(callId: string, workerId: string): Promise<DispatchClaim> {
    return this.db.begin(async (tx) => {
      const rows = await tx<Array<CallRow>>`
        SELECT cs.id, c.phone AS phone_e164, cs.status, cs.provider_call_id,
               cs.request_idempotency_key, cs.context_snapshot,
               encode(cs.context_hash, 'hex') AS context_hash_hex,
               cs.dispatch_lease_until
        FROM call_sessions AS cs
        JOIN contacts AS c ON c.id = cs.contact_id
        WHERE cs.id = ${callId}::uuid
        FOR UPDATE OF cs
      `;
      const row = rows[0];
      if (!row) throw new Error('CALL_NOT_FOUND');
      if (row.status === 'provider_accepted') {
        if (!row.provider_call_id) throw new Error('CALL_PROVIDER_ID_MISSING');
        return { outcome: 'provider_accepted' as const, providerCallId: row.provider_call_id };
      }
      if (row.status === 'dispatch_ambiguous') return { outcome: 'dispatch_ambiguous' as const, providerCallId: null };
      if (row.status === 'failed') return { outcome: 'failed' as const, providerCallId: null };
      if (row.status === 'dispatching' && row.dispatch_lease_until && new Date(row.dispatch_lease_until).getTime() > Date.now()) {
        return { outcome: 'busy' as const, providerCallId: null };
      }
      if (row.status !== 'requested' && row.status !== 'dispatching') {
        return { outcome: 'busy' as const, providerCallId: null };
      }

      const context = parseCallContext(row.context_snapshot);
      if (hashCallContext(context) !== row.context_hash_hex) throw new Error('CALL_CONTEXT_HASH_MISMATCH');
      await tx`
        UPDATE call_sessions
        SET status = 'dispatching', dispatch_lease_owner = ${workerId},
            dispatch_lease_until = now() + interval '60 seconds', error_code = NULL
        WHERE id = ${callId}::uuid
      `;
      return {
        outcome: 'claimed' as const,
        call: {
          id: row.id,
          phoneE164: row.phone_e164,
          status: 'dispatching' as const,
          providerCallId: null,
          requestIdempotencyKey: row.request_idempotency_key,
          context,
        },
      };
    });
  }

  async attachProviderCall(callId: string, providerCallId: string, acceptedAt: string): Promise<void> {
    const updated = await this.db<Array<{ id: string }>>`
      UPDATE call_sessions
      SET status = 'provider_accepted', provider_call_id = ${providerCallId},
          provider_accepted_at = ${acceptedAt}::timestamptz,
          dispatch_lease_owner = NULL, dispatch_lease_until = NULL, error_code = NULL
      WHERE id = ${callId}::uuid AND status = 'dispatching'
      RETURNING id
    `;
    if (updated.length > 0) return;
    const existing = await this.db<Array<{ provider_call_id: string | null; status: string }>>`
      SELECT provider_call_id, status FROM call_sessions WHERE id = ${callId}::uuid
    `;
    if (existing[0]?.status === 'provider_accepted' && existing[0].provider_call_id === providerCallId) return;
    throw new Error('CALL_DISPATCH_FENCE_LOST');
  }

  async markDispatchAmbiguous(callId: string, errorCode: string): Promise<void> {
    await this.db`
      UPDATE call_sessions
      SET status = 'dispatch_ambiguous', error_code = ${errorCode},
          dispatch_lease_owner = NULL, dispatch_lease_until = NULL
      WHERE id = ${callId}::uuid AND status = 'dispatching'
    `;
  }

  async markDispatchFailed(callId: string, errorCode: string): Promise<void> {
    await this.db`
      UPDATE call_sessions
      SET status = 'failed', error_code = ${errorCode}, completed_at = now(),
          dispatch_lease_owner = NULL, dispatch_lease_until = NULL
      WHERE id = ${callId}::uuid AND status = 'dispatching'
    `;
  }

  async appendEvent(rawEvent: CallEvent): Promise<'recorded' | 'duplicate'> {
    const event = CallEventSchema.parse(rawEvent);
    const payloadHash = createHash('sha256').update(JSON.stringify(event), 'utf8').digest('hex');
    const inserted = await this.db<Array<{ id: string }>>`
      INSERT INTO call_events (
        call_id, provider, event_id, event_type, sequence, occurred_at, payload, payload_hash
      ) VALUES (
        ${event.call_id}::uuid, ${event.provider}, ${event.event_id}, ${event.event_type},
        ${event.sequence}, ${event.occurred_at}::timestamptz, ${this.db.json(event.payload)}, decode(${payloadHash}, 'hex')
      )
      ON CONFLICT (provider, event_id) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) return 'recorded';
    const existing = await this.db<Array<{ call_id: string; payload_hash_hex: string }>>`
      SELECT call_id, encode(payload_hash, 'hex') AS payload_hash_hex
      FROM call_events WHERE provider = ${event.provider} AND event_id = ${event.event_id}
    `;
    if (existing[0]?.call_id !== event.call_id || existing[0]?.payload_hash_hex !== payloadHash) {
      throw new Error('CALL_EVENT_REPLAY_CONFLICT');
    }
    return 'duplicate';
  }

  async recomputeProjection(callId: string): Promise<CallProjection> {
    return this.db.begin(async (tx) => {
      const sessions = await tx<Array<{ status: string; provider_call_id: string | null }>>`
        SELECT status, provider_call_id FROM call_sessions WHERE id = ${callId}::uuid FOR UPDATE
      `;
      if (!sessions[0]) throw new Error('CALL_NOT_FOUND');
      const rows = await tx<Array<{
        event_id: string; event_type: CallEvent['event_type']; sequence: number;
        occurred_at: Date | string; provider: CallEvent['provider']; payload: unknown;
      }>>`
        SELECT event_id, event_type, sequence, occurred_at, provider, payload
        FROM call_events WHERE call_id = ${callId}::uuid
        ORDER BY occurred_at, sequence, id
      `;
      const events = rows.map((row) => CallEventSchema.parse({
        schema_version: 1,
        event_id: row.event_id,
        call_id: callId,
        event_type: row.event_type,
        sequence: row.sequence,
        occurred_at: iso(row.occurred_at),
        provider: row.provider,
        payload: row.payload,
      }));
      const projection = projectCallState({
        providerAccepted: sessions[0].provider_call_id !== null,
        cancelledAt: sessions[0].status === 'cancelled' ? new Date().toISOString() : null,
        events,
      });
      await tx`
        UPDATE call_sessions
        SET status = ${projection.status}, analysis_status = ${projection.analysisStatus},
            result = ${projection.result},
            started_at = CASE WHEN ${projection.status} IN ('in_progress', 'completed') THEN COALESCE(started_at, now()) ELSE started_at END,
            completed_at = CASE WHEN ${projection.status} IN ('completed', 'failed', 'no_answer', 'timed_out', 'cancelled') THEN COALESCE(completed_at, now()) ELSE completed_at END
        WHERE id = ${callId}::uuid
      `;
      return projection;
    });
  }
}
