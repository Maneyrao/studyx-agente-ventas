import { createHash, randomUUID } from 'node:crypto';
import type { ToolResultV1 } from '../../../../agent-core/src/ports/tool-executor';
import {
  missingContactIntakeFieldsV1,
  type ContactIntakeV1,
} from '@/features/conversation/domain/conversation-planner';
import { createConfigPaymentLinkResolver } from '@/features/payments/adapters/config-payment-link.resolver';
import {
  PAYMENT_PLAN_PRESENTATIONS,
  isStripePaymentLinkUrl,
  isPaymentPlanCode,
  type PaymentPlanCode,
} from '@/features/payments/domain/payment-link';
import { jsonbParam } from '@/lib/db/json';
import type { DbClient } from '@/lib/db/types';
import { commercialIntakeFromContactRowV1 } from '@/lib/heuristics/contact-identity';

interface PrepareDeps {
  readonly db: DbClient;
  readonly turn_id: string;
  readonly conversation_id: string;
}

interface ContactPrepareDeps extends PrepareDeps {
  readonly contact_id: string;
}

type PreparationToolV1 =
  | 'prepare_payment_link'
  | 'prepare_contact_details'
  | 'prepare_call_request'
  | 'prepare_memory'
  | 'prepare_lead_projection';

interface AuthorizedContactRow {
  readonly workspace_id: string;
  readonly phone: string;
  readonly declared_phone: string | null;
  readonly name: string | null;
  readonly email: string | null;
}

interface MemoryCandidateInputV1 {
  readonly text: string;
  readonly type: string;
  readonly supersedes: readonly string[];
}

interface PreparedMemoryV1 {
  readonly accepted: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly type: string;
  }>;
  readonly rejected: readonly [];
  readonly supersedes: readonly string[];
}

interface PaymentLinkResolverLike {
  resolve(planCode: PaymentPlanCode): string | null;
}

function failed(tool: string, errorCode: string, recoverable: boolean): ToolResultV1<never> {
  return {
    tool,
    success: false,
    canonical_data: null,
    error_code: errorCode,
    recoverable,
    idempotency_result: 'not_applicable',
    preparation_id: null,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

async function loadAuthorizedContact(
  deps: PrepareDeps,
  expectedContactId?: string,
): Promise<AuthorizedContactRow | null> {
  const rows = await deps.db<AuthorizedContactRow[]>`
    SELECT DISTINCT
      state.workspace_id,
      contact.phone,
      contact.declared_phone,
      contact.name,
      contact.email
    FROM conversation_sales_context_states_v1 AS state
    JOIN workspaces AS workspace
      ON workspace.id = state.workspace_id
     AND workspace.status = 'active'
    JOIN workspace_contacts AS workspace_contact
      ON workspace_contact.workspace_id = state.workspace_id
     AND workspace_contact.contact_id = state.contact_id
     AND workspace_contact.lifecycle_status = 'active'
    JOIN conversations AS conversation
      ON conversation.id = state.conversation_id
     AND conversation.contact_id = state.contact_id
    JOIN contacts AS contact
      ON contact.id = conversation.contact_id
     AND contact.deleted_at IS NULL
    JOIN messages AS turn
      ON turn.id = ${deps.turn_id}::uuid
     AND turn.conversation_id = conversation.id
     AND turn.contact_id = conversation.contact_id
     AND turn.direction = 'inbound'
    WHERE state.conversation_id = ${deps.conversation_id}::uuid
      AND (
        ${expectedContactId ?? null}::uuid IS NULL
        OR state.contact_id = ${expectedContactId ?? null}::uuid
      )
  `;
  return rows.length === 1 ? rows[0]! : null;
}

async function reserveAuthorized<T>(
  deps: PrepareDeps,
  tool: PreparationToolV1,
  canonicalKey: string,
  canonicalData: T,
  authority: {
    readonly expectedContactId?: string;
    readonly requiredOfferingCode?: string;
  } = {},
): Promise<ToolResultV1<T>> {
  const proposedId = randomUUID();
  try {
    const rows = await deps.db<Array<{ id: string; canonical_data: T }>>`
      WITH candidate_context AS (
        SELECT DISTINCT state.workspace_id
        FROM conversation_sales_context_states_v1 AS state
        JOIN workspaces AS workspace
          ON workspace.id = state.workspace_id
         AND workspace.status = 'active'
        JOIN workspace_contacts AS workspace_contact
          ON workspace_contact.workspace_id = state.workspace_id
         AND workspace_contact.contact_id = state.contact_id
         AND workspace_contact.lifecycle_status = 'active'
        JOIN conversations AS conversation
          ON conversation.id = state.conversation_id
         AND conversation.contact_id = state.contact_id
        JOIN contacts AS contact
          ON contact.id = conversation.contact_id
         AND contact.deleted_at IS NULL
        JOIN messages AS turn
          ON turn.id = ${deps.turn_id}::uuid
         AND turn.conversation_id = conversation.id
         AND turn.contact_id = conversation.contact_id
         AND turn.direction = 'inbound'
        WHERE state.conversation_id = ${deps.conversation_id}::uuid
          AND (
            ${authority.expectedContactId ?? null}::uuid IS NULL
            OR state.contact_id = ${authority.expectedContactId ?? null}::uuid
          )
      ), canonical_context AS (
        SELECT candidate.workspace_id
        FROM candidate_context AS candidate
        WHERE (SELECT count(*) FROM candidate_context) = 1
          AND (
            ${authority.requiredOfferingCode ?? null}::text IS NULL
            OR EXISTS (
              SELECT 1 FROM offerings AS offering
              WHERE offering.workspace_id = candidate.workspace_id
                AND offering.code = ${authority.requiredOfferingCode ?? null}
                AND offering.status = 'active'
            )
          )
      )
      INSERT INTO agent_turn_preparations (
        id, turn_id, conversation_id, tool, canonical_key, canonical_data
      )
      SELECT
        ${proposedId}::uuid,
        ${deps.turn_id}::uuid,
        ${deps.conversation_id}::uuid,
        ${tool},
        ${canonicalKey},
        ${jsonbParam(deps.db, canonicalData)}
      FROM canonical_context
      ON CONFLICT (conversation_id, tool, canonical_key)
      DO UPDATE SET canonical_key = EXCLUDED.canonical_key
      WHERE agent_turn_preparations.turn_id = EXCLUDED.turn_id
      RETURNING id, canonical_data
    `;
    const row = rows[0];
    if (!row) return failed(tool, 'PREPARATION_CONTEXT_INVALID', false);
    return {
      tool,
      success: true,
      canonical_data: row.canonical_data,
      error_code: null,
      recoverable: false,
      idempotency_result: row.id === proposedId ? 'applied' : 'duplicate',
      preparation_id: row.id,
    };
  } catch {
    return failed(tool, 'PREPARATION_STORE_UNAVAILABLE', true);
  }
}

export async function prepareContactDetailsToolV1(
  deps: ContactPrepareDeps,
  args: {
    readonly first_name?: string;
    readonly last_name?: string;
    readonly email?: string;
    readonly phone?: string;
  },
): Promise<ToolResultV1<{
  readonly recorded: readonly ('nombre' | 'apellido' | 'correo' | 'telefono')[];
  readonly still_missing: readonly ('nombre' | 'apellido' | 'correo' | 'telefono')[];
}>> {
  const tool = 'prepare_contact_details';
  const supplied = [
    ['first_name', 'nombre'],
    ['last_name', 'apellido'],
    ['email', 'correo'],
    ['phone', 'telefono'],
  ] as const;
  const recorded = supplied
    .filter(([field]) => Object.prototype.hasOwnProperty.call(args, field))
    .map(([, field]) => field);
  if (
    recorded.length === 0
    || supplied.some(([field]) => (
      Object.prototype.hasOwnProperty.call(args, field)
      && (typeof args[field] !== 'string' || args[field]!.trim().length === 0 || args[field]!.length > 320)
    ))
  ) {
    return failed(tool, 'INVALID_CONTACT_DETAILS', false);
  }

  let durable: ContactIntakeV1;
  try {
    const contact = await loadAuthorizedContact(deps, deps.contact_id);
    if (!contact) return failed(tool, 'PREPARATION_CONTEXT_INVALID', false);
    durable = commercialIntakeFromContactRowV1(contact);
  } catch {
    return failed(tool, 'PREPARATION_STORE_UNAVAILABLE', true);
  }
  const proposed: ContactIntakeV1 = {
    nombre: args.first_name?.trim() ?? durable.nombre,
    apellido: args.last_name?.trim() ?? durable.apellido,
    correo: args.email?.trim() ?? durable.correo,
    telefono: args.phone?.trim() ?? durable.telefono,
  };
  const canonicalArgs = supplied.flatMap(([field]) => (
    Object.prototype.hasOwnProperty.call(args, field) ? [[field, args[field]!.trim()]] : []
  ));
  return reserveAuthorized(
    deps,
    tool,
    `contact:${sha256(JSON.stringify(canonicalArgs))}`,
    { recorded, still_missing: missingContactIntakeFieldsV1(proposed) },
    { expectedContactId: deps.contact_id },
  );
}

export async function prepareCallRequestToolV1(
  deps: ContactPrepareDeps,
  args: { readonly reason: string },
): Promise<ToolResultV1<{ readonly call_id: string; readonly status: 'reserved' }>> {
  const tool = 'prepare_call_request';
  if (typeof args.reason !== 'string' || args.reason.trim().length === 0 || args.reason.length > 256) {
    return failed(tool, 'INVALID_CALL_REASON', false);
  }
  const reason = args.reason.trim();
  return reserveAuthorized(
    deps,
    tool,
    `call:${reason}`,
    { call_id: randomUUID(), status: 'reserved' as const },
    { expectedContactId: deps.contact_id },
  );
}

export async function prepareMemoryToolV1(
  deps: PrepareDeps,
  args: { readonly candidates: readonly MemoryCandidateInputV1[] },
): Promise<ToolResultV1<PreparedMemoryV1>> {
  const tool = 'prepare_memory';
  if (
    !Array.isArray(args.candidates)
    || args.candidates.length === 0
    || args.candidates.length > 10
    || args.candidates.some((candidate) => (
      typeof candidate.text !== 'string'
      || candidate.text.trim().length === 0
      || candidate.text.length > 2_048
      || typeof candidate.type !== 'string'
      || candidate.type.trim().length === 0
      || candidate.type.length > 128
      || !Array.isArray(candidate.supersedes)
      || candidate.supersedes.some((id: unknown) => typeof id !== 'string' || !isUuid(id))
    ))
  ) {
    return failed(tool, 'INVALID_MEMORY_CANDIDATES', false);
  }
  const candidates = args.candidates.map((candidate) => ({
    text: candidate.text.trim(),
    type: candidate.type.trim(),
    supersedes: [...candidate.supersedes],
  }));
  return reserveAuthorized(
    deps,
    tool,
    `memory:${sha256(JSON.stringify(candidates.map((candidate) => candidate.text)))}`,
    {
      accepted: candidates.map((candidate) => ({
        id: randomUUID(),
        text: candidate.text,
        type: candidate.type,
      })),
      rejected: [],
      supersedes: candidates.flatMap((candidate) => candidate.supersedes),
    },
  );
}

export async function prepareLeadProjectionToolV1(
  deps: PrepareDeps,
): Promise<ToolResultV1<{ readonly queued: false }>> {
  return reserveAuthorized(
    deps,
    'prepare_lead_projection',
    'lead',
    { queued: false as const },
  );
}

/**
 * Preparations are inert reservations. The reconciler expires abandoned rows
 * through the workspace-scoped SECURITY DEFINER boundary; the application role
 * never receives table-wide DELETE.
 */
export async function expireStalePreparationsV1(
  db: DbClient,
  olderThanMs: number,
): Promise<number> {
  if (!Number.isSafeInteger(olderThanMs) || olderThanMs <= 0) {
    throw new Error('INVALID_PREPARATION_EXPIRATION_AGE');
  }
  const [row] = await db<Array<{ expired: number }>>`
    SELECT COALESCE(sum(
      public.expire_agent_turn_preparations_v1(workspace.id, ${olderThanMs}::bigint)
    ), 0)::int AS expired
    FROM workspaces AS workspace
  `;
  return Number(row?.expired ?? 0);
}

export async function preparePaymentLinkToolV1(
  deps: PrepareDeps,
  args: { readonly offering_code: string; readonly payment_plan: string },
  overrides?: { readonly resolver?: PaymentLinkResolverLike },
): Promise<ToolResultV1<{
  label: string;
  url: string;
  offering_code: string;
  payment_plan: PaymentPlanCode;
}>> {
  const tool = 'prepare_payment_link';
  if (!isPaymentPlanCode(args.payment_plan)) {
    return failed(tool, 'INVALID_PAYMENT_PLAN', false);
  }
  if (
    typeof args.offering_code !== 'string'
    ||
    args.offering_code.length < 1
    || args.offering_code.length > 128
    || !/^[a-z0-9_-]+$/iu.test(args.offering_code)
  ) {
    return failed(tool, 'INVALID_OFFERING_CODE', false);
  }

  let context: { workspace_count: number; offering_exists: boolean } | undefined;
  try {
    [context] = await deps.db<Array<{
      workspace_count: number;
      offering_exists: boolean;
    }>>`
      WITH candidate_context AS (
        SELECT DISTINCT state.workspace_id
        FROM conversation_sales_context_states_v1 AS state
        JOIN workspaces AS workspace
          ON workspace.id = state.workspace_id
         AND workspace.status = 'active'
        JOIN workspace_contacts AS workspace_contact
          ON workspace_contact.workspace_id = state.workspace_id
         AND workspace_contact.contact_id = state.contact_id
         AND workspace_contact.lifecycle_status = 'active'
        JOIN conversations AS conversation
          ON conversation.id = state.conversation_id
         AND conversation.contact_id = state.contact_id
        JOIN messages AS turn
          ON turn.id = ${deps.turn_id}::uuid
         AND turn.conversation_id = conversation.id
         AND turn.contact_id = conversation.contact_id
         AND turn.direction = 'inbound'
        WHERE state.conversation_id = ${deps.conversation_id}::uuid
      )
      SELECT
        count(*)::int AS workspace_count,
        EXISTS (
          SELECT 1
          FROM candidate_context AS candidate
          JOIN offerings AS offering
            ON offering.workspace_id = candidate.workspace_id
           AND offering.code = ${args.offering_code}
           AND offering.status = 'active'
        ) AS offering_exists
      FROM candidate_context
    `;
  } catch {
    return failed(tool, 'PREPARATION_STORE_UNAVAILABLE', true);
  }
  if (context?.workspace_count !== 1) {
    return failed(tool, 'PREPARATION_CONTEXT_INVALID', false);
  }
  if (!context.offering_exists) {
    return failed(tool, 'OFFERING_NOT_FOUND', false);
  }

  const resolver = overrides?.resolver ?? createConfigPaymentLinkResolver();
  const url = resolver.resolve(args.payment_plan);
  if (!url) return failed(tool, 'LINK_CONFIG_MISSING', true);
  if (!isStripePaymentLinkUrl(url)) {
    return failed(tool, 'INVALID_PAYMENT_LINK', false);
  }

  const canonicalKey = `${args.offering_code}:${args.payment_plan}`;
  const canonicalData = {
    label: PAYMENT_PLAN_PRESENTATIONS[args.payment_plan].label,
    url,
    offering_code: args.offering_code,
    payment_plan: args.payment_plan,
  };
  return reserveAuthorized(deps, tool, canonicalKey, canonicalData, {
    requiredOfferingCode: args.offering_code,
  });
}
