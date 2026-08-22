import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IngestContext } from '@/lib/services/ingestion.service';
import type { ClaimedTurn } from '@/features/orchestration/application/claim-batch';
import type {
  BusinessCatalogView,
  BusinessContextView,
} from '@/features/orchestration/domain/business-context';
import {
  DecisionValidationError,
  MEMORY_CANDIDATE_TYPES as DOMAIN_MEMORY_CANDIDATE_TYPES,
  parseDecisionV2,
} from '@/features/orchestration/domain/decision';
import { MemoryCandidateSchema } from '../../botpress-agent/src/schemas/contracts';

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

const DECISION_ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/agent/turns/[turn_id]/decision/route.ts'),
  'utf8'
);

function decisionWithMemory(type: string) {
  return {
    schema_version: 2,
    intent: 'commercial',
    kind: 'reply',
    response: 'Te cuento sobre el curso.',
    response_type: 'commercial_reply',
    confidence: 0.9,
    reason_code: 'COURSE_INTEREST',
    business_action: null,
    memory_candidates: [{
      type,
      key: 'course_of_interest',
      value: 'barista',
      source_quote: 'Me interesa Barista',
      confidence: 0.9,
    }],
    missing_information: [],
    next_state: 'completed',
  };
}

/** The block of a named schema, so a key is checked inside the right object. */
function schemaBlock(name: string): string {
  const start = CONTRACTS.indexOf(`export const ${name} = `);
  expect(start, `${name} must exist in the ADK contracts`).toBeGreaterThan(-1);
  const next = CONTRACTS.indexOf('\nexport const ', start + 1);
  return CONTRACTS.slice(start, next === -1 ? undefined : next);
}

function enumValues(block: string): string[] {
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
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
      accepted_call_offer: null,
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

  it('declares the backend fast-path route and PII-free hot-path diagnostics', () => {
    const sample: Pick<ClaimedTurn, 'deterministic_route' | 'diagnostics'> = {
      deterministic_route: null,
      diagnostics: {
        timings: {
          claim_total_ms: 0,
          core_db_ms: 0,
          shared_embedding_ms: 0,
          memory_search_ms: 0,
          knowledge_search_ms: 0,
          business_snapshot_ms: 0,
        },
        counters: {
          embedding_calls: 0,
          memory_search_calls: 0,
          knowledge_search_calls: 0,
          business_snapshot_calls: 0,
          catalog_calls: 0,
        },
      },
    };

    const claimedBlock = schemaBlock('ClaimedTurnSchema');
    for (const key of Object.keys(sample)) {
      expect(claimedBlock, `ClaimedTurnSchema must declare ${key}`).toContain(`${key}:`);
    }
    for (const route of [
      'greeting',
      'call_direct_request',
      'call_accepted_offer',
      'call_acceptance_clarification',
    ]) {
      expect(claimedBlock, `deterministic_route must allow ${route}`).toContain(`'${route}'`);
    }
    for (const key of Object.keys(sample.diagnostics.timings)) {
      expect(claimedBlock, `diagnostics.timings must declare ${key}`).toContain(`${key}:`);
    }
    for (const key of Object.keys(sample.diagnostics.counters)) {
      expect(claimedBlock, `diagnostics.counters must declare ${key}`).toContain(`${key}:`);
    }
  });

  it('declares one timestamped business snapshot and its fail-closed price flag', () => {
    const sample: Pick<
      BusinessContextView,
      'as_of' | 'prices_assertable' | 'offerings_truncated'
    > = {
      as_of: '2026-08-21T00:00:00.000Z',
      prices_assertable: false,
      offerings_truncated: 0,
    };
    const block = schemaBlock('BusinessContextSchema');
    for (const key of Object.keys(sample)) {
      expect(block, `BusinessContextSchema must declare ${key}`).toContain(`${key}:`);
    }
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
  it('accepts the literal Barista study goal through the domain parser', () => {
    expect(parseDecisionV2(decisionWithMemory('study_goal')).memory_candidates).toEqual([{
      type: 'study_goal',
      key: 'course_of_interest',
      value: 'barista',
      source_quote: 'Me interesa Barista',
      confidence: 0.9,
    }]);
  });

  it.each(['interest', 'profile', 'location', 'user_fact', 'free_form'])(
    'rejects the free-form Agent A type %s in the backend domain',
    (type) => {
      expect(() => parseDecisionV2(decisionWithMemory(type))).toThrowError(
        new DecisionValidationError('INVALID_MEMORY_CANDIDATES')
      );
    }
  );

  it('keeps Botpress and the API route on the same closed memory type enum', () => {
    expect(DECISION_ROUTE).toContain('type: z.enum(MEMORY_CANDIDATE_TYPES)');
    const memoryCandidate = schemaBlock('MemoryCandidateSchema');
    expect(memoryCandidate).toContain('z.enum(MEMORY_CANDIDATE_TYPES)');
    expect(enumValues(schemaBlock('MEMORY_CANDIDATE_TYPES'))).toEqual(DOMAIN_MEMORY_CANDIDATE_TYPES);
  });

  it.each(['interest', 'profile', 'location', 'user_fact', 'free_form', 'legacy_memory'])(
    'makes Botpress reject the legacy or extra memory type %s',
    (type) => {
      expect(MemoryCandidateSchema.safeParse({
        type,
        key: 'course_of_interest',
        value: 'barista',
        source_quote: 'Me interesa Barista',
        confidence: 0.9,
      }).success).toBe(false);
    }
  );

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

  it('keeps send_payment_link in sync between Botpress and the API route (spec §4)', () => {
    // The ADK side: the producer schema must be able to emit the action at
    // all, and it must never carry a link or a price — those are backend
    // configuration, resolved only after the plan is revalidated.
    const paymentAction = schemaBlock('SendPaymentLinkActionSchema');
    expect(paymentAction).toContain('send_payment_link');
    expect(paymentAction).toContain("z.enum(['monthly_12', 'monthly_6', 'one_time'])");
    expect(paymentAction).toContain('.strict()');
    expect(paymentAction).not.toMatch(/\burl\b|\bprice\b|\blink\b/i);

    const decisionActions = schemaBlock('DecisionBusinessActionSchema');
    expect(decisionActions).toContain('SendPaymentLinkActionSchema');

    // The backend side: the same action, with the same three plan codes,
    // must be an accepted shape of the v4 business_action union — otherwise
    // every real `send_payment_link` decision would be rejected as a 400
    // before ever reaching `assertDecisionBusinessActionPermitted`'s deeper
    // (plan-matches-batch, offering-exists) rules.
    expect(DECISION_ROUTE).toContain("type: z.literal('send_payment_link')");
    expect(DECISION_ROUTE).toContain("plan_code: z.enum(['monthly_12', 'monthly_6', 'one_time'])");
    expect(DECISION_ROUTE).toContain('offering_sku: z.string().trim().min(1).max(128).nullable()');
  });
});
