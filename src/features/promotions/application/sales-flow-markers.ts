import type { DbClient } from '@/lib/db/types';
import {
  RETENTION_MARKER_V1, agentAskedPriceOnlyV1, confirmsPriceProbeV1, deniesPriceProbeV1,
} from '@/shared/conversation/deterministic-sales-rules';

/**
 * Owner promo flow (2026-11-03): "price question asked / answered yes or no"
 * and "retention used", read from the conversation's complete durable message
 * history (`messages`), not from the 20-turn prompt window.
 *
 * Hotfix 2026-11-03: the first version read `audit_log`, which is revoked for
 * the production orchestrator role ("permission denied for table audit_log"):
 * every commit transaction aborted and the bot went silent. `messages` is the
 * canonical, readable source.
 */
export type PriceProbeStatusV1 = 'not_asked' | 'asked' | 'yes' | 'no';
export interface SalesFlowFlagsV1 {
  readonly price_probe: PriceProbeStatusV1;
  readonly retention_used: boolean;
  /** Not persisted yet (needs a readable table): always null. */
  readonly pending_gift_code: string | null;
}

const normalized = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export async function readSalesFlowFlagsV1(db: DbClient, conversationId: string): Promise<SalesFlowFlagsV1> {
  const rows = await db<Array<{ direction: 'inbound' | 'outbound'; content: string }>>`
    SELECT direction, content FROM messages WHERE conversation_id=${conversationId}::uuid
    ORDER BY created_at, id`;
  let price_probe: PriceProbeStatusV1 = 'not_asked';
  let probe: string | null = null;
  const answer: string[] = [];
  for (const row of rows) {
    if (row.direction === 'outbound') {
      if (probe !== null && answer.length > 0) break;
      if (probe === null && agentAskedPriceOnlyV1([row.content])) { probe = row.content; price_probe = 'asked'; }
    } else if (probe !== null) answer.push(row.content);
  }
  if (probe !== null && answer.length > 0) {
    price_probe = confirmsPriceProbeV1(answer, [probe]) ? 'yes' : deniesPriceProbeV1(answer, [probe]) ? 'no' : 'asked';
  }
  return {
    price_probe,
    retention_used: rows.some(row => row.direction === 'outbound' && RETENTION_MARKER_V1.test(normalized(row.content))),
    pending_gift_code: null,
  };
}
