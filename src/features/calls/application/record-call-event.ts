import { CallEventSchema, type CallEvent } from '@/lib/contracts/call-event';
import type { CallStore } from '../ports/call-store';

export async function recordCallEvent(
  rawEvent: CallEvent,
  dependencies: { store: CallStore },
) {
  const event = CallEventSchema.parse(rawEvent);
  const persistence = await dependencies.store.appendEvent(event);
  const projection = await dependencies.store.recomputeProjection(event.call_id);
  return { persistence, projection };
}
