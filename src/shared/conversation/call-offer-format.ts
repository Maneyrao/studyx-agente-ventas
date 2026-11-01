/**
 * Technical delivery adaptation authorized on 2026-11-01: keep the dedicated
 * call_offer and remove only a whole, byte-identical copy from messages.
 * Raw proposals and their profile indices remain untouched for validation/audit.
 * An invitation-only reply remains visible through call_offer (authority :236).
 */
export function messagesWithoutExactCallOfferV1(response: {
  readonly messages: readonly string[];
  readonly call_offer?: string | null;
}): readonly string[] {
  return typeof response.call_offer==='string' && response.call_offer.length>0
    ? response.messages.filter(message=>message!==response.call_offer)
    : response.messages;
}
