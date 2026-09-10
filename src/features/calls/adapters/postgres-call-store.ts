import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { CallEventSchema, type CallAnalysis, type CallEvent } from '@/lib/contracts/call-event';
import { hashCallContext, parseCallContext } from '../domain/call-context';
import { mergeCallAnalyses, projectCallState, type CallProjection } from '../domain/call-state';
import type { CallStore, DispatchClaim } from '../ports/call-store';
import {
  RetellCallCorrelationError,
  type RetellCorrelationMetadata,
  type RetellToolCallCorrelationStore,
} from '../ports/retell-call-correlation-store';
import { splitFullName } from '@/lib/heuristics/contact-identity';
import { agentBLeadProjectionSourceOrder, enqueueLeadProjection, leadProjectionKey } from '@/lib/services/projection.service';
import { loadSheetsProjectionConfig } from '@/lib/config';

type CallRow = {
  id: string;
  contact_id: string;
  conversation_id: string;
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

type RetellCorrelationRow = {
  id: string;
  contact_id: string;
  conversation_id: string;
  provider_call_id: string | null;
  status: string;
  workspace_id: string | null;
};

type RetellToolCorrelationRow = RetellCorrelationRow & {
  workspace_authorized: boolean;
};

function eventPayloadHash(event: CallEvent): string {
  // Retell can retry the same tool request with a fresh delivery timestamp.
  // The timestamp is transport metadata, not semantic analysis evidence.
  const identity = event.event_type === 'analyzed'
    && event.provider === 'retell'
    && event.event_id.startsWith('retell:tool:call_analyzed:')
    ? { ...event, occurred_at: undefined }
    : event;
  return createHash('sha256').update(JSON.stringify(identity), 'utf8').digest('hex');
}

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

async function bindLegacyWorkspace(
  tx: postgres.TransactionSql,
  row: RetellCorrelationRow,
): Promise<string | null> {
  if (row.workspace_id) return row.workspace_id;
  const candidates = await tx<Array<{ workspace_id: string }>>`
    WITH candidates AS (
      SELECT state.workspace_id
      FROM conversation_sales_context_states_v1 AS state
      JOIN workspaces AS workspace
        ON workspace.id = state.workspace_id AND workspace.status = 'active'
      JOIN workspace_contacts AS membership
        ON membership.workspace_id = state.workspace_id
       AND membership.contact_id = ${row.contact_id}::uuid
       AND membership.lifecycle_status = 'active'
      WHERE state.conversation_id = ${row.conversation_id}::uuid
        AND state.contact_id = ${row.contact_id}::uuid
      UNION
      SELECT state.workspace_id
      FROM sales_context_states AS state
      JOIN workspaces AS workspace
        ON workspace.id = state.workspace_id AND workspace.status = 'active'
      JOIN workspace_contacts AS membership
        ON membership.workspace_id = state.workspace_id
       AND membership.contact_id = ${row.contact_id}::uuid
       AND membership.lifecycle_status = 'active'
      WHERE state.conversation_id = ${row.conversation_id}::uuid
        AND state.contact_id = ${row.contact_id}::uuid
    )
    SELECT (array_agg(workspace_id ORDER BY workspace_id))[1] AS workspace_id
    FROM candidates
    HAVING count(DISTINCT workspace_id) = 1
  `;
  const workspaceId = candidates[0]?.workspace_id ?? null;
  if (workspaceId) {
    await tx`
      UPDATE call_sessions
      SET workspace_id = ${workspaceId}::uuid
      WHERE id = ${row.id}::uuid AND workspace_id IS NULL
    `;
    row.workspace_id = workspaceId;
  }
  return workspaceId;
}

export class PostgresCallStore implements CallStore, RetellToolCallCorrelationStore {
  constructor(private readonly db: postgres.Sql) {}

  async claimDispatch(callId: string, workerId: string): Promise<DispatchClaim> {
    return this.db.begin(async (tx) => {
      const rows = await tx<Array<CallRow>>`
        SELECT cs.id, cs.contact_id, cs.conversation_id, c.phone AS phone_e164,
               cs.status, cs.provider_call_id,
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
          contactId: row.contact_id,
          conversationId: row.conversation_id,
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
      WHERE id = ${callId}::uuid AND status IN ('dispatching', 'dispatch_ambiguous')
        AND (provider_call_id IS NULL OR provider_call_id = ${providerCallId})
      RETURNING id
    `;
    if (updated.length > 0) return;
    const existing = await this.db<Array<{ provider_call_id: string | null; status: string }>>`
      SELECT provider_call_id, status FROM call_sessions WHERE id = ${callId}::uuid
    `;
    if (
      existing[0]?.provider_call_id === providerCallId
      && ['provider_accepted', 'in_progress', 'completed', 'no_answer', 'timed_out'].includes(existing[0].status)
    ) return;
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

  async resolveRetellCall(input: {
    providerCallId: string;
    metadata: RetellCorrelationMetadata | null;
  }): Promise<{ callId: string }> {
    return this.db.begin(async (tx) => {
      const rows = input.metadata
        ? await tx<Array<RetellCorrelationRow>>`
            SELECT id, contact_id, conversation_id, provider_call_id, status, workspace_id
            FROM call_sessions
            WHERE provider = 'retell'
              AND (provider_call_id = ${input.providerCallId} OR id = ${input.metadata.internalCallId}::uuid)
            ORDER BY id
            FOR UPDATE
          `
        : await tx<Array<RetellCorrelationRow>>`
            SELECT id, contact_id, conversation_id, provider_call_id, status, workspace_id
            FROM call_sessions
            WHERE provider = 'retell' AND provider_call_id = ${input.providerCallId}
            FOR UPDATE
          `;

      const byProvider = rows.find((row) => row.provider_call_id === input.providerCallId);
      const byMetadata = input.metadata
        ? rows.find((row) => row.id === input.metadata!.internalCallId)
        : undefined;

      if (input.metadata && !byMetadata) {
        throw new RetellCallCorrelationError(byProvider
          ? 'CALL_CORRELATION_MISMATCH'
          : 'CALL_CORRELATION_NOT_FOUND');
      }
      if (byProvider && byMetadata && byProvider.id !== byMetadata.id) {
        throw new RetellCallCorrelationError('CALL_CORRELATION_MISMATCH');
      }

      const row = byProvider ?? byMetadata;
      if (!row) throw new RetellCallCorrelationError('CALL_CORRELATION_NOT_FOUND');
      if (
        input.metadata
        && (row.contact_id !== input.metadata.contactId || row.conversation_id !== input.metadata.conversationId)
      ) {
        throw new RetellCallCorrelationError('CALL_CORRELATION_MISMATCH');
      }
      if (row.provider_call_id && row.provider_call_id !== input.providerCallId) {
        throw new RetellCallCorrelationError('CALL_PROVIDER_ID_CONFLICT');
      }

      await bindLegacyWorkspace(tx, row);

      if (row.provider_call_id === null) {
        if (row.status !== 'dispatching' && row.status !== 'dispatch_ambiguous') {
          throw new RetellCallCorrelationError('CALL_CORRELATION_STATE_INVALID');
        }
        await tx`
          UPDATE call_sessions
          SET provider_call_id = ${input.providerCallId}, status = 'provider_accepted',
              provider_accepted_at = COALESCE(provider_accepted_at, now()),
              dispatch_lease_owner = NULL, dispatch_lease_until = NULL, error_code = NULL
          WHERE id = ${row.id}::uuid
        `;
      }

      return { callId: row.id };
    });
  }

  async resolveRetellToolCall(input: {
    providerCallId: string;
    metadata: RetellCorrelationMetadata;
    workspaceSlug: string;
  }): Promise<{ callId: string }> {
    return this.db.begin(async (tx) => {
      const rows = await tx<RetellToolCorrelationRow[]>`
        SELECT
          cs.id,
          cs.contact_id,
          cs.conversation_id,
          cs.provider_call_id,
          cs.status,
          cs.workspace_id,
          EXISTS (
            SELECT 1
            FROM conversation_sales_context_states_v1 AS state
            JOIN workspaces AS workspace
              ON workspace.id = state.workspace_id
             AND workspace.status = 'active'
             AND workspace.slug = ${input.workspaceSlug}
            JOIN workspace_contacts AS membership
              ON membership.workspace_id = workspace.id
             AND membership.contact_id = cs.contact_id
             AND membership.lifecycle_status = 'active'
            JOIN contacts AS contact
              ON contact.id = cs.contact_id
             AND contact.deleted_at IS NULL
            WHERE (cs.workspace_id IS NULL OR state.workspace_id = cs.workspace_id)
              AND state.conversation_id = cs.conversation_id
              AND state.contact_id = cs.contact_id
          ) AS workspace_authorized
        FROM call_sessions AS cs
        WHERE cs.provider = 'retell'
          AND (cs.provider_call_id = ${input.providerCallId} OR cs.id = ${input.metadata.internalCallId}::uuid)
        ORDER BY cs.id
        FOR UPDATE OF cs
      `;

      const byProvider = rows.find((row) => row.provider_call_id === input.providerCallId);
      const byMetadata = rows.find((row) => row.id === input.metadata.internalCallId);
      if (!byMetadata) {
        throw new RetellCallCorrelationError(byProvider
          ? 'CALL_CORRELATION_MISMATCH'
          : 'CALL_CORRELATION_NOT_FOUND');
      }
      if (byProvider && byProvider.id !== byMetadata.id) {
        throw new RetellCallCorrelationError('CALL_CORRELATION_MISMATCH');
      }

      const row = byProvider ?? byMetadata;
      if (
        row.contact_id !== input.metadata.contactId
        || row.conversation_id !== input.metadata.conversationId
      ) {
        throw new RetellCallCorrelationError('CALL_CORRELATION_MISMATCH');
      }
      if (row.provider_call_id && row.provider_call_id !== input.providerCallId) {
        throw new RetellCallCorrelationError('CALL_PROVIDER_ID_CONFLICT');
      }

      await bindLegacyWorkspace(tx, row);
      const authorized = row.workspace_id === null ? [] : await tx<Array<{ allowed: boolean }>>`
        SELECT TRUE AS allowed
        FROM call_sessions AS cs
        JOIN workspaces AS workspace
          ON workspace.id = cs.workspace_id
         AND workspace.status = 'active'
         AND workspace.slug = ${input.workspaceSlug}
        JOIN workspace_contacts AS membership
          ON membership.workspace_id = cs.workspace_id
         AND membership.contact_id = cs.contact_id
         AND membership.lifecycle_status = 'active'
        JOIN contacts AS contact
          ON contact.id = cs.contact_id
         AND contact.deleted_at IS NULL
        WHERE cs.id = ${row.id}::uuid
      `;
      if (!authorized[0]?.allowed || row.workspace_id === null) {
        throw new RetellCallCorrelationError('CALL_CORRELATION_MISMATCH');
      }

      if (row.provider_call_id === null) {
        if (row.status !== 'dispatching' && row.status !== 'dispatch_ambiguous') {
          throw new RetellCallCorrelationError('CALL_CORRELATION_STATE_INVALID');
        }
        await tx`
          UPDATE call_sessions
          SET provider_call_id = ${input.providerCallId}, status = 'provider_accepted',
              provider_accepted_at = COALESCE(provider_accepted_at, now()),
              dispatch_lease_owner = NULL, dispatch_lease_until = NULL, error_code = NULL
          WHERE id = ${row.id}::uuid
        `;
      }

      return { callId: row.id };
    });
  }

  async appendEvent(rawEvent: CallEvent): Promise<'recorded' | 'duplicate'> {
    const event = CallEventSchema.parse(rawEvent);
    const payloadHash = eventPayloadHash(event);
    return this.db.begin(async (tx) => {
      const locked = await tx<Array<{ id: string }>>`
        SELECT id FROM call_sessions WHERE id = ${event.call_id}::uuid FOR UPDATE
      `;
      if (!locked[0]) throw new Error('CALL_NOT_FOUND');
      const inserted = await tx<Array<{ id: string }>>`
        INSERT INTO call_events (
          call_id, provider, event_id, event_type, sequence, occurred_at, payload, payload_hash
        ) VALUES (
          ${event.call_id}::uuid, ${event.provider}, ${event.event_id}, ${event.event_type},
          ${event.sequence}, ${event.occurred_at}::timestamptz, ${tx.json(event.payload)}, decode(${payloadHash}, 'hex')
        )
        ON CONFLICT (provider, event_id) DO NOTHING
        RETURNING id
      `;
      const persistence: 'recorded' | 'duplicate' = inserted.length > 0 ? 'recorded' : 'duplicate';
      if (inserted.length === 0) {
        const existing = await tx<Array<{ call_id: string; payload_hash_hex: string }>>`
          SELECT event.call_id, encode(event.payload_hash, 'hex') AS payload_hash_hex
          FROM call_events AS event
          WHERE event.provider = ${event.provider} AND event.event_id = ${event.event_id}
        `;
        if (existing[0]?.call_id !== event.call_id || existing[0]?.payload_hash_hex !== eventPayloadHash(event)) {
          throw new Error('CALL_EVENT_REPLAY_CONFLICT');
        }
      }
      if (event.payload.event_type === 'analyzed') {
        const rows = await tx<Array<{
          event_id: string; event_type: CallEvent['event_type']; sequence: number;
          occurred_at: Date | string; provider: CallEvent['provider']; payload: unknown;
        }>>`
          SELECT event_id, event_type, sequence, occurred_at, provider, payload
          FROM call_events
          WHERE call_id = ${event.call_id}::uuid AND event_type = 'analyzed'
          ORDER BY event_id
        `;
        const events = rows.map((row) => CallEventSchema.parse({
          schema_version: 1,
          event_id: row.event_id,
          call_id: event.call_id,
          event_type: row.event_type,
          sequence: row.sequence,
          occurred_at: iso(row.occurred_at),
          provider: row.provider,
          payload: row.payload,
        }));
        await this.convergeRetellAnalysis(tx, event.call_id, mergeCallAnalyses(events));
      }
      // Keep the durable event and the call_sessions snapshot in one commit.
      // The public recordCallEvent API may perform a redundant recompute after
      // this transaction; it is then an idempotent read/repair, never the first
      // visible projection of an already-persisted webhook.
      await this.recomputeProjectionOnTransaction(tx, event.call_id);
      return persistence;
    });
  }

  /**
   * Retell analysis is a bounded fact envelope, not a second contact system.
   * Only the call's canonical workspace membership can authorize the email
   * update; the stable four-column projection is then refreshed from that
   * same membership. Replays intentionally run this idempotent convergence
   * again so a delivery interrupted after the event insert can heal.
   */
  private async convergeRetellAnalysis(db: SqlExecutor, callId: string, analysis: CallAnalysis): Promise<void> {
    const email = analysis.email_capturado;
    if (!email) return;
    const rows = await db<Array<{
      contact_id: string;
      workspace_id: string;
      source_order: string | number | null;
      name: string | null;
      email: string | null;
      course_name: string | null;
      course_code: string | null;
    }>>`
      SELECT
        cs.contact_id,
        canonical_workspace.id AS workspace_id,
        source.conversation_seq AS source_order,
        contact.name,
        contact.email,
        offering.display_name AS course_name,
        NULLIF(btrim(cs.context_snapshot ->> 'curso_interes'), '') AS course_code
      FROM call_sessions AS cs
      JOIN messages AS source
        ON source.id = cs.source_turn_id
       AND source.conversation_id = cs.conversation_id
       AND source.contact_id = cs.contact_id
       AND source.direction = 'inbound'
      JOIN contacts AS contact
        ON contact.id = cs.contact_id
       AND contact.deleted_at IS NULL
      JOIN workspaces AS canonical_workspace
        ON canonical_workspace.id = cs.workspace_id
       AND canonical_workspace.status = 'active'
      JOIN workspace_contacts AS canonical_membership
        ON canonical_membership.workspace_id = cs.workspace_id
       AND canonical_membership.contact_id = cs.contact_id
       AND canonical_membership.lifecycle_status = 'active'
      LEFT JOIN offerings AS offering
        ON offering.workspace_id = canonical_workspace.id
       AND offering.code = NULLIF(btrim(cs.context_snapshot ->> 'curso_interes'), '')
       AND offering.status = 'active'
      WHERE cs.id = ${callId}::uuid
        AND cs.provider = 'retell'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return;

    const identity = row.name ? splitFullName(row.name) : null;
    if (!identity?.nombre.trim() || !identity.apellido.trim()) return;
    const course = row.course_name ?? analysis.curso_ofrecido ?? row.course_code;
    if (!course?.trim() || row.source_order === null) return;

    const sheetsFromEnvironment = loadSheetsProjectionConfig();
    const existingProjection = await db<Array<{ spreadsheet_id: string; tab_name: string }>>`
      SELECT spreadsheet_id, tab_name
      FROM sheet_projection_rows
      WHERE projection_key = ${leadProjectionKey(row.workspace_id, row.contact_id)}
      LIMIT 1
    `;
    const sheets = sheetsFromEnvironment
      ? { spreadsheetId: sheetsFromEnvironment.spreadsheetId, tabName: sheetsFromEnvironment.tabName }
      : existingProjection[0]
        ? { spreadsheetId: existingProjection[0].spreadsheet_id, tabName: existingProjection[0].tab_name }
        : null;
    if (!sheets) return;

    const sourceOrder = Number(row.source_order);
    if (!Number.isSafeInteger(sourceOrder) || sourceOrder < 0) return;
    const projection = await enqueueLeadProjection({
      workspaceId: row.workspace_id,
      contactId: row.contact_id,
      spreadsheetId: sheets.spreadsheetId,
      tabName: sheets.tabName,
      sourceOrder: agentBLeadProjectionSourceOrder(sourceOrder),
      sourceKey: `retell-call:${callId}`,
      nombre: identity.nombre,
      apellido: identity.apellido,
      email,
      cursoInteres: course,
      ultimaSenal: 'retell_post_call_analysis_email_captured',
      traceId: callId,
    }, { sql: db });
    // A late event cannot win the outbox ordering fence and then mutate the
    // canonical contact independently of that projection decision.
    if (!projection?.changed) return;
    if (row.email !== email) {
      await db`
        UPDATE contacts
        SET email = ${email}
        WHERE id = ${row.contact_id}::uuid
          AND deleted_at IS NULL
      `;
    }
  }

  async recomputeProjection(callId: string): Promise<CallProjection> {
    return this.db.begin(async (tx) => this.recomputeProjectionOnTransaction(tx, callId));
  }

  private async recomputeProjectionOnTransaction(
    tx: postgres.TransactionSql,
    callId: string,
  ): Promise<CallProjection> {
      const sessions = await tx<Array<{ status: string; provider: CallEvent['provider']; provider_call_id: string | null }>>`
        SELECT status, provider, provider_call_id FROM call_sessions WHERE id = ${callId}::uuid FOR UPDATE
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
      // Legacy fixtures/calls can already be terminal before their lifecycle
      // events are replayed. Analysis convergence must never regress that
      // durable terminal status to provider_accepted/requested.
      const terminalStatuses = new Set(['completed', 'failed', 'no_answer', 'timed_out', 'cancelled']);
      const projectedStatus = terminalStatuses.has(sessions[0].status)
        ? sessions[0].status as CallProjection['status']
        : projection.status;
      let canonicalResult = projection.result;
      if (canonicalResult === 'venta_confirmada') {
        const payment = await tx<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM payments
            WHERE workspace_id = (SELECT workspace_id FROM call_sessions WHERE id = ${callId}::uuid)
              AND contact_id = (SELECT contact_id FROM call_sessions WHERE id = ${callId}::uuid)
              AND status = 'paid'
              AND (
                ${sessions[0].provider} <> 'retell'
                OR idempotency_key LIKE ${`retell:payment:${callId}:%`}
              )
          ) AS exists
        `;
        if (!payment[0]?.exists) canonicalResult = null;
      }
      await tx`
        UPDATE call_sessions
        SET status = ${projectedStatus}, analysis_status = ${projection.analysisStatus},
            result = ${canonicalResult},
            started_at = CASE WHEN ${projectedStatus} IN ('in_progress', 'completed') THEN COALESCE(started_at, now()) ELSE started_at END,
            completed_at = CASE WHEN ${projectedStatus} IN ('completed', 'failed', 'no_answer', 'timed_out', 'cancelled') THEN COALESCE(completed_at, now()) ELSE completed_at END
        WHERE id = ${callId}::uuid
      `;
      return { ...projection, status: projectedStatus, result: canonicalResult };
  }
}
