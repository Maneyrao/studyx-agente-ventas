import { describe, expect, it } from 'vitest';
import { repairCourseMentionRolesV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-claim-repair';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import marketingBudget from '../fixtures/marketing-budget-natural-59cab80.json';

const ctx = (over: { selected?: unknown; delivered?: unknown[] } = {}) => ({
  capabilities: { course_bonus: { delivered_bonus_offerings: over.delivered ?? [] } },
  catalog: {
    selected_offering: over.selected ?? null,
    available_offerings: [
      { code: 'marketing_digital', display_name: 'Marketing Digital' },
      { code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' },
    ],
  },
}) as unknown as AgentAContextV1;
const draft = marketingBudget.drafts[0]!;
const proposal = (mentions: unknown[], action: unknown = { type: 'none' }) => ({
  schema_version: 1, response: { messages: draft.messages, call_offer: null },
  proposed_action: action, course_mentions: mentions,
}) as unknown as AgentATurnProposalV1;

describe('COURSE_ROLE_UNDECLARED metadata repair (natural-59cab80 17/marketing_budget)', () => {
  it('downgrades the paid declaration and declares the named course, prose untouched', () => {
    const repaired = repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions), context: ctx() });
    expect(repaired?.course_mentions).toEqual([{ offering_code: 'marketing_digital', role: 'alternative' }]);
    expect(repaired?.response.messages).toEqual(draft.messages);
  });
  it('declares an undeclared named course as alternative', () => {
    expect(repairCourseMentionRolesV1({ proposal: proposal([]), context: ctx() })?.course_mentions)
      .toEqual([{ offering_code: 'marketing_digital', role: 'alternative' }]);
  });
  it('does nothing with a persisted selection, a delivered package or a bonus action', () => {
    expect(repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions), context: ctx({ selected: { code: 'x' } }) })).toBeNull();
    expect(repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions), context: ctx({ delivered: [{ code: 'x' }] }) })).toBeNull();
    expect(repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions, { type: 'offer_course_bonus' }), context: ctx() })).toBeNull();
  });
  it('is a no-op when the metadata is already right', () => {
    expect(repairCourseMentionRolesV1({ proposal: proposal([{ offering_code: 'marketing_digital', role: 'alternative' }]), context: ctx() })).toBeNull();
  });
});
