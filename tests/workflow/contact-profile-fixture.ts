import type { AgentAContextV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import type { ContactProfileFieldV1, ContactProfileUpdateV1 } from '../../src/shared/conversation/contact-profile-contract';

export interface ContactFixtureValueV1 {
  field: ContactProfileFieldV1;
  value: string;
  quote?: string;
}

/** Explicit fixture meanings, never a dialogue extractor or a model substitute. */
export function contactFixtureUpdatesV1(context: AgentAContextV1,
  meanings: readonly ContactFixtureValueV1[]): ContactProfileUpdateV1[] {
  const sources = [...(context.customer.contact_profile?.sources ?? [])].reverse();
  return meanings.flatMap(({ field, value, quote = value }) => {
    if (context.customer.contact_intake?.[field] === value) return [];
    const source = sources.find(message => message.text.includes(quote));
    return source ? [{ field, value, operation: 'set' as const,
      source_message_id: source.id, source_quote: quote }] : [];
  });
}
