export interface InboundEventFixture {
  phone: string;
  content: string;
  channel: 'whatsapp' | 'voice';
  channel_account_id: string;
  external_message_id: string;
  external_conversation_id: string;
}

let fixtureSequence = 0;

export function buildInboundEvent(
  overrides: Partial<InboundEventFixture> = {}
): InboundEventFixture {
  fixtureSequence += 1;
  const suffix = String(fixtureSequence).padStart(4, '0');

  return {
    phone: '+5491112345678',
    content: 'Quiero información sobre el curso de Python',
    channel: 'whatsapp',
    channel_account_id: 'studyx-test-account',
    external_message_id: `wamid.test-${suffix}`,
    external_conversation_id: `wa-conversation-${suffix}`,
    ...overrides,
  };
}

export function duplicateDeliveries(event: InboundEventFixture, count = 10) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Delivery count must be positive.');
  return Array.from({ length: count }, () => structuredClone(event));
}
