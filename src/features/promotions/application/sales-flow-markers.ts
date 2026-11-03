import type { DbClient } from '@/lib/db/types';
import { auditLog } from '@/lib/audit/logger';
import {
  RETENTION_MARKER_V1, agentAskedPriceOnlyV1, confirmsPriceProbeV1, deniesPriceProbeV1,
} from '@/shared/conversation/deterministic-sales-rules';

/**
 * Owner promo flow (2026-11-03): "price question asked / answered yes or no",
 * "retention used" and a gift requested before the question are persisted per
 * conversation as idempotent audit markers (`audit_log`, keyed per
 * conversation), never inferred from the 20-turn history window.
 */
export type PriceProbeStatusV1 = 'not_asked' | 'asked' | 'yes' | 'no';
export interface SalesFlowFlagsV1 {
  readonly price_probe: PriceProbeStatusV1;
  readonly retention_used: boolean;
  /** Course the customer asked to get as a gift before the price question was answered "yes". */
  readonly pending_gift_code: string | null;
}

const ACTIONS = ['sales.price_probe.asked', 'sales.price_probe.answered', 'sales.retention.used', 'sales.gift_request'] as const;

export async function readSalesFlowFlagsV1(db: DbClient, conversationId: string): Promise<SalesFlowFlagsV1> {
  const rows = await db<Array<{ action: string; payload: { answer?: string; code?: string } | null }>>`
    SELECT action, payload FROM audit_log
    WHERE entity_type='conversation' AND entity_id=${conversationId}::uuid AND action IN ${db(ACTIONS)}
    ORDER BY occurred_at, id`;
  const answer = rows.find(row => row.action === 'sales.price_probe.answered')?.payload?.answer;
  const asked = rows.some(row => row.action === 'sales.price_probe.asked');
  const gift = [...rows].reverse().find(row => row.action === 'sales.gift_request')?.payload?.code ?? null;
  return {
    price_probe: answer === 'yes' ? 'yes' : answer === 'no' ? 'no' : asked ? 'asked' : 'not_asked',
    retention_used: rows.some(row => row.action === 'sales.retention.used'),
    pending_gift_code: answer === 'yes' ? null : gift,
  };
}

/** Called once per committed agent turn, inside the commit transaction. */
export async function recordSalesFlowMarkersV1(db: DbClient, input: {
  readonly conversation_id: string;
  readonly turn_id: string;
  readonly outbound_texts: readonly string[];
  readonly gift_request_code?: string | null;
  readonly correlation_id?: string;
}): Promise<void> {
  const flags = await readSalesFlowFlagsV1(db, input.conversation_id);
  const inbound = (await db<Array<{ content: string }>>`
    SELECT fragment.content FROM messages current JOIN messages fragment
      ON fragment.conversation_id=current.conversation_id AND fragment.direction='inbound'
      AND (fragment.id=current.id OR (fragment.batch_id=current.batch_id AND current.batch_id IS NOT NULL))
    WHERE current.id=${input.turn_id}::uuid ORDER BY fragment.conversation_seq`).map(row => row.content);
  const previousAgent = (await db<Array<{ content: string }>>`
    SELECT prior.content FROM messages prior JOIN messages current ON current.id=${input.turn_id}::uuid
    WHERE prior.conversation_id=current.conversation_id AND prior.direction='outbound'
      AND prior.created_at < current.created_at
    ORDER BY prior.created_at DESC LIMIT 3`).map(row => row.content);
  const mark = (action: (typeof ACTIONS)[number], key: string, payload: Record<string, unknown> = {}) => auditLog({
    action, entity_type: 'conversation', entity_id: input.conversation_id,
    payload: { ...payload, source_turn_id: input.turn_id },
    event_key: `sales-flow:${key}:${input.conversation_id}`,
    // Deterministic per turn: a commit replay (new trace) must hit the same key and data.
    causation_id: input.turn_id,
  }, db);
  if (flags.price_probe === 'asked') {
    if (confirmsPriceProbeV1(inbound, previousAgent)) await mark('sales.price_probe.answered', 'price-probe-answer', { answer: 'yes' });
    else if (deniesPriceProbeV1(inbound, previousAgent)) await mark('sales.price_probe.answered', 'price-probe-answer', { answer: 'no' });
  }
  if (flags.price_probe === 'not_asked' && agentAskedPriceOnlyV1(input.outbound_texts)) {
    await mark('sales.price_probe.asked', 'price-probe-asked');
  }
  const normalized = input.outbound_texts.join(' ').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (!flags.retention_used && RETENTION_MARKER_V1.test(normalized)) await mark('sales.retention.used', 'retention');
  if (input.gift_request_code) {
    await mark('sales.gift_request', `gift-request:${input.turn_id}`, { code: input.gift_request_code });
  }
}
