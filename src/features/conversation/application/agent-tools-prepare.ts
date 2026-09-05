import { randomUUID } from 'node:crypto';
import type { ToolResultV1 } from '../../../../agent-core/src/ports/tool-executor';
import { createConfigPaymentLinkResolver } from '@/features/payments/adapters/config-payment-link.resolver';
import {
  PAYMENT_PLAN_PRESENTATIONS,
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
    args.offering_code.length < 1
    || args.offering_code.length > 128
    || !/^[a-z0-9_-]+$/iu.test(args.offering_code)
  ) {
    return failed(tool, 'INVALID_OFFERING_CODE', false);
  }

  const resolver = overrides?.resolver ?? createConfigPaymentLinkResolver();
  const url = resolver.resolve(args.payment_plan);
  if (!url) return failed(tool, 'LINK_CONFIG_MISSING', true);

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
      INSERT INTO agent_turn_preparations (
        id, turn_id, conversation_id, tool, canonical_key, canonical_data
      )
      VALUES (
        ${proposedId}::uuid,
        ${deps.turn_id}::uuid,
        ${deps.conversation_id}::uuid,
        ${tool},
        ${canonicalKey},
        ${jsonbParam(deps.db, canonicalData)}
      )
      ON CONFLICT (conversation_id, tool, canonical_key)
      DO UPDATE SET canonical_key = EXCLUDED.canonical_key
      RETURNING id, canonical_data
    `;
    const row = rows[0];
    if (!row) return failed(tool, 'PREPARATION_STORE_UNAVAILABLE', true);
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
