import type postgres from 'postgres';
import type { RetellContactToolStore } from '../application/retell-tools';
import { splitFullName } from '@/lib/heuristics/contact-identity';
import {
  agentBLeadProjectionSourceOrder,
  enqueueLeadProjection,
} from '@/lib/services/projection.service';
import { applyStructuredVoiceContactProfileV1, contactProfileValuesV1, isAgentOwnedContactProfileV1,
  loadContactProfileV1, type StoredContactProfileV1 } from '@/lib/repositories/contact-profile.repository';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import type { ContactProfileReceiptV1 } from '@/shared/conversation/contact-profile-contract';

interface CorrelatedContactRow {
  readonly contact_id: string;
  readonly workspace_id: string;
  readonly call_source_order: string | number;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string;
  readonly declared_phone: string | null;
  readonly contact_profile_v1: StoredContactProfileV1 | null;
  readonly selected_payment_plan: string | null;
  readonly frozen_offering_code: string | null;
  readonly selected_offering_name: string | null;
}

function mergedName(input: {
  readonly nombre?: string;
  readonly apellido?: string;
}, existing: string | null): string | null {
  const existingParts = existing ? splitFullName(existing) : null;
  let nombre = existingParts?.nombre.trim() ?? '';
  let apellido = existingParts?.apellido.trim() ?? '';
  if (input.nombre !== undefined) {
    const supplied = splitFullName(input.nombre.trim().replace(/\s+/gu, ' '));
    nombre = supplied.nombre.trim();
    if (supplied.apellido.trim()) apellido = supplied.apellido.trim();
  }
  if (input.apellido !== undefined) {
    apellido = input.apellido.trim().replace(/\s+/gu, ' ');
  }
  if (!nombre) return existing;
  return apellido ? `${nombre} ${apellido}` : nombre;
}

export class PostgresRetellContactToolStore implements RetellContactToolStore {
  constructor(private readonly db: postgres.Sql) {}

  async saveCorrelatedContact(input: {
    readonly callId: string;
    readonly workspaceSlug: string;
    readonly nombre?: string;
    readonly apellido?: string;
    readonly email?: string;
    readonly telefonoAlternativo?: string;
    readonly sheets: { readonly spreadsheetId: string; readonly tabName: string } | null;
  }): Promise<{ updated: boolean; projected: boolean; rejections?: ContactProfileReceiptV1['rejections'] }> {
    const observedAt = new Date().toISOString();
    return this.db.begin(async (tx) => {
      const rows = await tx<CorrelatedContactRow[]>`
        SELECT
          cs.contact_id,
          state.workspace_id,
          source.conversation_seq AS call_source_order,
          contact.name,
          contact.email,
          contact.phone,
          contact.declared_phone,
          contact.contact_profile_v1,
          state.selected_payment_plan,
          COALESCE(
            NULLIF(btrim(state.selected_offering_code), ''),
            NULLIF(btrim(cs.context_snapshot ->> 'curso_interes'), '')
          ) AS frozen_offering_code,
          offering.display_name AS selected_offering_name
        FROM call_sessions AS cs
        JOIN messages AS source
          ON source.id = cs.source_turn_id
         AND source.conversation_id = cs.conversation_id
         AND source.contact_id = cs.contact_id
         AND source.direction = 'inbound'
        JOIN contacts AS contact
          ON contact.id = cs.contact_id
         AND contact.deleted_at IS NULL
        JOIN conversation_sales_context_states_v1 AS state
          ON state.conversation_id = cs.conversation_id
         AND state.contact_id = cs.contact_id
        JOIN workspaces AS workspace
          ON workspace.id = state.workspace_id
         AND workspace.status = 'active'
         AND workspace.slug = ${input.workspaceSlug}
        JOIN workspace_contacts AS membership
          ON membership.workspace_id = state.workspace_id
         AND membership.contact_id = cs.contact_id
         AND membership.lifecycle_status = 'active'
        LEFT JOIN offerings AS offering
          ON offering.workspace_id = state.workspace_id
         AND offering.code = COALESCE(
           NULLIF(btrim(state.selected_offering_code), ''),
           NULLIF(btrim(cs.context_snapshot ->> 'curso_interes'), '')
         )
         AND offering.status = 'active'
        WHERE cs.id = ${input.callId}::uuid
          AND cs.provider = 'retell'
          AND source.conversation_seq IS NOT NULL
        FOR UPDATE OF contact
      `;
      if (rows.length !== 1) throw new Error('CALL_TOOL_CONTEXT_INVALID');
      const row = rows[0];
      let canonical: ContactProfileReceiptV1['values'] | null = null;
      let rejections: ContactProfileReceiptV1['rejections'] | undefined;
      let ownedUpdated = false;
      if (isAgentOwnedContactProfileV1(row.contact_profile_v1)) {
        const values = {
          ...(input.nombre === undefined ? {} : { nombre: input.nombre }),
          ...(input.apellido === undefined ? {} : { apellido: input.apellido }),
          ...(input.email === undefined ? {} : { correo: input.email }),
          ...(input.telefonoAlternativo === undefined ? {} : { telefono: input.telefonoAlternativo }),
        };
        const result = await applyStructuredVoiceContactProfileV1(tx, { contactId: row.contact_id, callId: input.callId,
          source: { kind: 'retell_tool', event_key: `retell-tool-profile:${sha256Hex({ call_id: input.callId, values })}`,
            occurred_at: observedAt }, values });
        ownedUpdated = !result.replayed && result.receipt.accepted_fields.length > 0;
        rejections = result.receipt.rejections;
        canonical = contactProfileValuesV1((await loadContactProfileV1(row.contact_id, tx))!);
      }
      const nextName = canonical ? canonical.nombre ? [canonical.nombre, canonical.apellido].filter(Boolean).join(' ') : null
        : input.nombre === undefined && input.apellido === undefined
        ? row.name
        : mergedName({
            ...(input.nombre === undefined ? {} : { nombre: input.nombre }),
            ...(input.apellido === undefined ? {} : { apellido: input.apellido }),
          }, row.name);
      const nextEmail = canonical ? canonical.correo : input.email ?? row.email;
      const nextDeclaredPhone = canonical ? canonical.telefono : input.telefonoAlternativo ?? row.declared_phone;
      const updated = canonical ? ownedUpdated : nextName !== row.name
        || nextEmail !== row.email
        || nextDeclaredPhone !== row.declared_phone;
      if (updated && !canonical) {
        await tx`
          UPDATE contacts
          SET name = ${nextName}, email = ${nextEmail}, declared_phone = ${nextDeclaredPhone}
          WHERE id = ${row.contact_id}::uuid AND deleted_at IS NULL
            AND (contact_profile_v1 IS NULL OR contact_profile_v1->>'owner' IS DISTINCT FROM 'agent_a_v1')
        `;
      }

      const identity = canonical ? { nombre: canonical.nombre ?? '', apellido: canonical.apellido ?? '' }
        : nextName ? splitFullName(nextName) : null;
      const complete = Boolean(
        identity?.nombre.trim()
        && identity.apellido.trim()
        && nextEmail?.trim()
        && row.frozen_offering_code?.trim()
        && row.selected_offering_name?.trim(),
      );
      if (!complete || !input.sheets || rejections?.length) return { updated, projected: false, ...(rejections ? { rejections } : {}) };

      const callSourceOrder = Number(row.call_source_order);
      const projection = await enqueueLeadProjection({
        workspaceId: row.workspace_id,
        contactId: row.contact_id,
        spreadsheetId: input.sheets.spreadsheetId,
        tabName: input.sheets.tabName,
        sourceOrder: agentBLeadProjectionSourceOrder(callSourceOrder),
        sourceKey: `retell-call:${input.callId}`,
        nombre: identity!.nombre,
        apellido: identity!.apellido,
        email: nextEmail!,
        telefono: nextDeclaredPhone ?? row.phone,
        cursoInteres: row.selected_offering_name!,
        plan: row.selected_payment_plan ?? undefined,
        ultimaSenal: 'retell_contact_identity_captured',
        traceId: input.callId,
      }, { sql: tx });
      return { updated, projected: projection?.changed ?? false, ...(rejections ? { rejections } : {}) };
    });
  }
}
