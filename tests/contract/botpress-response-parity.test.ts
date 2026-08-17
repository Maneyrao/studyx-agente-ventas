import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IngestContext } from '@/lib/services/ingestion.service';
import type { ClaimedTurn } from '@/features/orchestration/application/claim-batch';
import type { BusinessCatalogView } from '@/features/orchestration/domain/business-context';

/**
 * The Botpress response schemas must describe what Next.js actually returns.
 *
 * This is not hypothetical. Fase 3 removed `context` from the ingest response
 * and added `batch`; the ADK `IngestResponseSchema` kept requiring `context`,
 * so every real ingest would have failed validation with
 * `INVALID_STUDYX_RESPONSE` — a silent, total outage of the happy path that no
 * existing test could see, because the two sides are never in one process.
 *
 * `@botpress/runtime` bundles @opentelemetry and cannot be require()d outside
 * the ADK bundler, so the schema objects themselves are unreachable from here.
 * Parity is enforced from both ends instead:
 *
 *   - the TypeScript side, by declaring a value of the real response type
 *     (a removed or renamed field stops compiling), and
 *   - the ADK side, by asserting the schema source declares each of those keys.
 *
 * Neither half alone would have caught the `context` regression. Together they
 * do: drop `batch` from `IngestContext` and the first half fails; drop it from
 * the ADK schema and the second does.
 */

const CONTRACTS = readFileSync(
  join(process.cwd(), 'botpress-agent/src/schemas/contracts.ts'),
  'utf8'
);

/** The block of a named schema, so a key is checked inside the right object. */
function schemaBlock(name: string): string {
  const start = CONTRACTS.indexOf(`export const ${name} = `);
  expect(start, `${name} must exist in the ADK contracts`).toBeGreaterThan(-1);
  const next = CONTRACTS.indexOf('\nexport const ', start + 1);
  return CONTRACTS.slice(start, next === -1 ? undefined : next);
}

describe('ingest response parity', () => {
  it('the Next.js response still carries every field the ADK schema requires', () => {
    // Compile-time half: this must remain assignable to the real type.
    const sample: Pick<
      IngestContext,
      'status' | 'replayed' | 'trace_id' | 'turn_id' | 'conversation_id' | 'batch' | 'policy' | 'contact' | 'existing_result'
    > = {
      status: 'accepted',
      replayed: false,
      trace_id: 't',
      turn_id: 'u',
      conversation_id: 'c',
      batch: {
        id: 'b',
        state: 'waiting',
        joined_existing: false,
        due_at: 'now',
        hard_deadline_at: 'later',
        conversation_seq: 1,
        message_count: 1,
      },
      policy: { may_respond: true, allowed_response_types: [], reason: null },
      contact: {
        id: 'x',
        status: 'prospecto',
        name: null,
        blocked: false,
        consent_status: 'allowed',
        opted_in_at: 'now',
        summary: null,
        summary_updated_at: null,
        summary_version: 0,
      },
      existing_result: null,
    };

    // Runtime half: the ADK schema must declare the same top-level keys.
    const block = schemaBlock('IngestResponseSchema');
    for (const key of Object.keys(sample)) {
      expect(block, `IngestResponseSchema must declare ${key}`).toContain(`${key}:`);
    }
    expect(block).toContain('batch: BatchWindowSchema');
    // `context` was removed in fase 3; declaring it again would reject every
    // real response.
    expect(block).not.toMatch(/\n\s{2}context:/);
  });
});

describe('claim response parity', () => {
  it('the ADK schema declares every context slot the claim actually returns', () => {
    const contextSample: ClaimedTurn['context'] = {
      batch_messages: [],
      recent_turns: [],
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      long_term_memory_available: true,
      knowledge_base: [],
      knowledge_base_available: true,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    };

    const block = schemaBlock('ClaimedTurnSchema');
    for (const key of Object.keys(contextSample)) {
      expect(block, `ClaimedTurnSchema must declare ${key}`).toContain(`${key}:`);
    }
    // The gap this phase closed: Next.js has been returning knowledge_base all
    // along and the ADK contract did not declare it, so the agent could not use it.
    expect(block).toContain('knowledge_base: z.array(KnowledgeItemSchema)');
    expect(block).toContain('selected_memories: z.array(SelectedMemorySchema)');
    expect(block).toContain('claim_token');
  });

  it('declares every non-claimed outcome the route can answer with', () => {
    const block = schemaBlock('UnclaimedTurnSchema');
    for (const outcome of ['waiting', 'absorbed', 'completed', 'abandoned', 'not_found']) {
      expect(block, `UnclaimedTurnSchema must declare ${outcome}`).toContain(`'${outcome}'`);
    }
  });

  it('declares sales_context, the bounded call context handed to Agent A on every claim', () => {
    const salesContextSample: ClaimedTurn['sales_context'] = {
      mode: 'advising',
      course_of_interest: null,
      open_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    };

    const claimedBlock = schemaBlock('ClaimedTurnSchema');
    expect(claimedBlock, 'ClaimedTurnSchema must declare sales_context').toContain('sales_context:');

    const salesContextBlock = schemaBlock('SalesContextSchema');
    for (const key of Object.keys(salesContextSample)) {
      expect(salesContextBlock, `SalesContextSchema must declare ${key}`).toContain(`${key}:`);
    }

    // Every mode and allowed action the application layer can produce must be
    // representable — a narrower ADK enum would reject a real claimed turn.
    for (const mode of [
      'advising',
      'awaiting_call_consent',
      'call_pending',
      'in_call',
      'post_call',
    ]) {
      expect(salesContextBlock, `SalesContextSchema mode must allow ${mode}`).toContain(`'${mode}'`);
    }
    for (const action of ['offer_call', 'request_call_now']) {
      expect(salesContextBlock, `SalesContextSchema allowed_actions must allow ${action}`).toContain(
        `'${action}'`
      );
    }

    // Never a phone, credential, transcript or unbounded call analysis.
    expect(salesContextBlock).not.toMatch(/phone|credential|transcript|analysis/i);
  });
});

describe('catalog response parity', () => {
  it('the ADK schema declares the fields that decide whether a price may be quoted', () => {
    const sample: Pick<BusinessCatalogView, 'items' | 'count' | 'as_of' | 'prices_assertable'> = {
      items: [],
      count: 0,
      as_of: 'now',
      prices_assertable: false,
    };

    const block = schemaBlock('CatalogResponseSchema');
    for (const key of Object.keys(sample)) {
      expect(block, `CatalogResponseSchema must declare ${key}`).toContain(`${key}:`);
    }
  });
});

describe('decision schema parity', () => {
  it('the agent produces v3/v4 and cannot emit a human handoff', () => {
    const block = schemaBlock('DecisionSchema');
    expect(block).toContain('schema_version: z.union([z.literal(3), z.literal(4)])');
    expect(block).toContain('retrieval_used');

    // El protocolo de llamada v4 queda gateado por versión y por acción:
    // call_offer sin side effect, call_confirmation ⇔ request_call_now.
    expect(block).toContain('CALL_PROTOCOL_REQUIRES_V4');
    expect(block).toContain('INVALID_CALL_OFFER');
    expect(block).toContain('INVALID_CALL_REQUEST');

    const callAction = schemaBlock('RequestCallNowActionSchema');
    expect(callAction).toContain('request_call_now');
    expect(callAction).toContain("z.enum(['direct_request', 'accepted_offer'])");
    expect(callAction).toContain('.strict()');
    expect(callAction).not.toMatch(/phone|contact_id|call_id:|provider_call_id|consent/i);

    // `escalate_to_human` must be unreachable from the producer side. The
    // backend refuses it too, but an agent that cannot express it never spends
    // a turn discovering that.
    const actions = schemaBlock('BusinessActionSchema');
    expect(actions).toContain('mark_hot_lead');
    expect(actions).toContain('log_objection');
    expect(actions).not.toContain('escalate_to_human');
    expect(actions).not.toContain('send_pricing_info');
    expect(actions).not.toContain('schedule_followup');
  });
});
