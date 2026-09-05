import { randomUUID } from 'node:crypto';
import type { ToolResultV1 } from '../../../../agent-core/src/ports/tool-executor';
import { createConfigPaymentLinkResolver } from '@/features/payments/adapters/config-payment-link.resolver';
import {
  PAYMENT_PLAN_PRESENTATIONS,
  isStripePaymentLinkUrl,
  isPaymentPlanCode,
  type PaymentPlanCode,
} from '@/features/payments/domain/payment-link';
import { jsonbParam } from '@/lib/db/json';
import type { DbClient } from '@/lib/db/types';

interface PrepareDeps {
  readonly db: DbClient;
  readonly turn_id: string;
  readonly conversation_id: string;
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
  const proposedId = randomUUID();

  try {
    const rows = await deps.db<Array<{
      id: string;
      canonical_data: typeof canonicalData;
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
      ), canonical_context AS (
        SELECT candidate.workspace_id
        FROM candidate_context AS candidate
        JOIN offerings AS offering
          ON offering.workspace_id = candidate.workspace_id
         AND offering.code = ${args.offering_code}
         AND offering.status = 'active'
        WHERE (SELECT count(*) FROM candidate_context) = 1
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
