/**
 * Persisted commercial memories the model recorded in earlier turns of THIS
 * conversation (agent_decisions.memory_candidates), latest per (type, key).
 * The vector top-5 in `customer.memories` can drop the customer's goal; this
 * projection cannot. It is data for the model, never a permission, and never
 * derived from agent phrases or audit_log.
 */
export const SALES_PROFILE_MEMORY_TYPES = [
  'study_goal', 'study_context', 'preference', 'constraint', 'objection', 'timeline', 'contact_preference',
] as const;
export type SalesProfileMemoryTypeV1 = typeof SALES_PROFILE_MEMORY_TYPES[number];

export interface SalesProfileItemV1 {
  readonly key: string;
  readonly value: string;
  readonly source_quote: string;
}

export interface SalesProfileMemoriesV1 {
  readonly objective: readonly SalesProfileItemV1[];
  readonly experience: readonly SalesProfileItemV1[];
  readonly tentative_interest: readonly SalesProfileItemV1[];
  readonly objections: readonly SalesProfileItemV1[];
  readonly constraints: readonly SalesProfileItemV1[];
  readonly preferences: readonly SalesProfileItemV1[];
  readonly timeline: readonly SalesProfileItemV1[];
  readonly contact_preference: readonly SalesProfileItemV1[];
}

export interface SalesProfileDecisionRowV1 {
  readonly memory_candidates: ReadonlyArray<{ type?: unknown; key?: unknown; value?: unknown; source_quote?: unknown }>;
  /** Inbound customer texts of the turn/batch that decision answered. */
  readonly evidence: readonly string[];
}

const MAX_PER_BUCKET = 4;
const MAX_QUOTE_SPAN = 4;
const SALES_PROFILE_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
const norm = (text: string) => text.toLowerCase().replace(/\s+/gu, ' ').trim();

/** `rows` come newest first. A memory counts only when its quote is literal customer text. */
export function projectSalesProfileMemoriesV1(rows: readonly SalesProfileDecisionRowV1[]): SalesProfileMemoriesV1 {
  const seen = new Set<string>();
  const buckets: Record<keyof SalesProfileMemoriesV1, SalesProfileItemV1[]> = {
    objective: [], experience: [], tentative_interest: [], objections: [], constraints: [],
    preferences: [], timeline: [], contact_preference: [],
  };
  for (const row of rows) {
    const messages = row.evidence.map(norm);
    // A quote may span consecutive messages of the reply (WhatsApp splits one
    // thought: «no lo sé aún» / «es formarme»); never non-adjacent ones.
    // Bounded: windows of at most MAX_QUOTE_SPAN messages.
    const evidence = messages.flatMap((_, start) => Array.from(
      { length: Math.min(MAX_QUOTE_SPAN, messages.length - start) },
      (__, length) => messages.slice(start, start + length + 1).join(' ')));
    for (const candidate of row.memory_candidates) {
      const { type, key, value, source_quote: quote } = candidate;
      if (typeof type !== 'string' || typeof key !== 'string' || typeof value !== 'string' || typeof quote !== 'string') continue;
      if (!(SALES_PROFILE_MEMORY_TYPES as readonly string[]).includes(type)) continue;
      // The Botpress claim schema only parses keys like this one: a bad legacy key must drop that
      // memory, never make the whole claim unparseable.
      if (!SALES_PROFILE_KEY.test(key)) continue;
      const trimmedQuote = quote.trim();
      if (!trimmedQuote || !value.trim() || !evidence.some((text) => text.includes(norm(trimmedQuote)))) continue;
      const identity = `${type}:${key}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const item = { key, value: value.trim().slice(0, 512), source_quote: trimmedQuote.slice(0, 400) };
      const tentative = /interest|interes/u.test(key);
      const bucket: keyof SalesProfileMemoriesV1 | null = tentative && (type === 'study_goal' || type === 'study_context')
        ? 'tentative_interest'
        : type === 'study_goal' ? 'objective'
          : type === 'study_context' ? 'experience'
            : type === 'objection' ? 'objections'
              : type === 'constraint' ? 'constraints'
                : type === 'preference' ? 'preferences'
                  : type === 'timeline' ? 'timeline'
                    : type === 'contact_preference' ? 'contact_preference' : null;
      if (bucket && buckets[bucket].length < MAX_PER_BUCKET) buckets[bucket].push(item);
    }
  }
  return buckets;
}
