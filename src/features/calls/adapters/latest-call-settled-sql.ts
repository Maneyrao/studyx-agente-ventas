import type { DbClient } from '@/lib/db/types';
import { TERMINAL_CALL_STATUSES } from '../domain/call-state';

/**
 * SQL boolean: the conversation's latest call session (the one a handoff
 * created, in the same transaction) is terminal. `alias` names the sales
 * state row in the enclosing query. A stale `provider_accepted` is not
 * terminal and keeps the handoff protected.
 */
export function latestCallSettledSqlV1(db: DbClient, alias: 'state' | 's' = 'state') {
  const terminal = TERMINAL_CALL_STATUSES as unknown as string[];
  return alias === 's'
    ? db`COALESCE((SELECT latest.status = ANY(${terminal}::text[]) FROM call_sessions latest
        WHERE latest.conversation_id = s.conversation_id AND latest.contact_id = s.contact_id
        ORDER BY latest.requested_at DESC, latest.id DESC LIMIT 1), false)`
    : db`COALESCE((SELECT latest.status = ANY(${terminal}::text[]) FROM call_sessions latest
        WHERE latest.conversation_id = state.conversation_id AND latest.contact_id = state.contact_id
        ORDER BY latest.requested_at DESC, latest.id DESC LIMIT 1), false)`;
}
