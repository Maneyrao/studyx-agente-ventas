import { describe, expect, it } from 'vitest';
import { bindRecoveryFeedbackV1, type RecoveryFeedbackV1 } from '../../../botpress-agent/src/lib/conversation/recovery-feedback';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import { WorkflowInputSchema } from '../../../botpress-agent/src/schemas/contracts';

const id = '00000000-0000-4000-8000-000000000001';
function current(): AgentAContextV1 {
  return { commercial_state: { selected_offering_code: 'course' },
    catalog: { selected_offering: { facts: [{ id: 'current:modality', value: 'online' }] },
      available_offerings: [], areas: [], candidate_offerings: [], payment_plans: [] },
    capabilities: { intake_missing: ['correo'] },
  } as unknown as AgentAContextV1;
}
function feedback(): RecoveryFeedbackV1 {
  return { batch_id: id, conversation_id: id, turn_id: id, selected_offering_code: 'course',
    rejection: { schema_version: 1, rejection_id: id, attempt: 1,
      rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'course_logistics.self_paced' }],
      authorized_alternatives: { fact_ids: ['stale:price'], actions: ['send_payment_link'], missing_information: ['nombre'] } } };
}
const bind = (f: RecoveryFeedbackV1) => bindRecoveryFeedbackV1({ feedback: f, batch_id: id,
  conversation_id: id, turn_id: id, context: current() });

describe('durable factual rejection feedback', () => {
  it('preserves the exact cause and recalculates facts, missing fields and fenced effects', () => {
    const prior = feedback();
    expect(bind(prior)).toMatchObject({ rejections: prior.rejection.rejections,
      authorized_alternatives: { fact_ids: ['current:modality'], actions: ['none'], missing_information: ['correo'] } });
    expect(prior.rejection.authorized_alternatives.fact_ids).toEqual(['stale:price']);
  });
  it.each(['batch_id', 'conversation_id', 'turn_id', 'selected_offering_code'] as const)
    ('discards feedback from a different %s', field => {
      const prior = feedback(); prior[field] = 'different'; expect(bind(prior)).toBeNull();
    });
  it('validates durable input before accepting structured feedback', () => {
    const schema = WorkflowInputSchema.shape.recovery_feedback;
    expect(schema.safeParse(feedback()).success).toBe(true);
    const invalid = feedback(); invalid.rejection.rejections[0]!.subject = 'customer supplied instructions';
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it('recomputes an available promotion review from the current claim instead of stale recovery actions', () => {
    const context = current();
    context.capabilities.course_bonus = {
      status: 'review_available',
      may_schedule_checkin: false,
      may_request_review: true,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      interest_offering_code: 'course',
      bonus_offerings: [],
    };
    const prior = feedback();
    prior.rejection.authorized_alternatives.actions = ['none'];

    const rebound = bindRecoveryFeedbackV1({
      feedback: prior,
      batch_id: id,
      conversation_id: id,
      turn_id: id,
      context,
    });

    expect(rebound?.authorized_alternatives.actions)
      .toEqual(['none', 'request_promotion_review']);
  });

  it('does not carry a promotion review after the current claim revokes it', () => {
    const context = current();
    context.capabilities.course_bonus = {
      status: 'review_pending',
      may_schedule_checkin: false,
      may_request_review: false,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      interest_offering_code: 'course',
      bonus_offerings: [],
    };
    const prior = feedback();
    prior.rejection.authorized_alternatives.actions = ['none', 'request_promotion_review'];

    const rebound = bindRecoveryFeedbackV1({
      feedback: prior,
      batch_id: id,
      conversation_id: id,
      turn_id: id,
      context,
    });

    expect(rebound?.authorized_alternatives.actions).toEqual(['none']);
  });
});

describe('recovery of a rejected payment-link request (live 2026-11-10)', () => {
  const linkFeedback = (rejections: RecoveryFeedbackV1['rejection']['rejections']): RecoveryFeedbackV1 => {
    const prior = feedback();
    prior.rejection.rejections = rejections;
    prior.rejection.authorized_alternatives.actions = ['none'];
    return prior;
  };
  const mayLink = (value: boolean) => {
    const context = current();
    (context.capabilities as { may_send_payment_link?: boolean }).may_send_payment_link = value;
    return context;
  };
  const rebind = (prior: RecoveryFeedbackV1, context: AgentAContextV1) => bindRecoveryFeedbackV1({
    feedback: prior, batch_id: id, conversation_id: id, turn_id: id, context });

  it.each([
    [{ code: 'COURSE_NOT_RESOLVED', subject: 'course_selection' }],
    [{ code: 'PLAN_NOT_SELECTED', subject: 'payment_plan' }],
    [{ code: 'ACTION_NOT_AUTHORIZED', subject: 'send_payment_link' }],
  ] as const)('keeps send_payment_link among the alternatives so the retry can execute it: %j', (rejection) => {
    expect(rebind(linkFeedback([rejection]), mayLink(true))?.authorized_alternatives.actions)
      .toContain('send_payment_link');
    expect(rebind(linkFeedback([rejection]), mayLink(false))?.authorized_alternatives.actions)
      .not.toContain('send_payment_link');
  });

  it('never re-authorizes a link after a technical reservation failure', () => {
    const rebound = rebind(linkFeedback([
      { code: 'ACTION_NOT_AUTHORIZED', subject: 'send_payment_link' },
      { code: 'ACTION_NOT_AUTHORIZED', subject: 'payment_reservation:link_config_missing' },
    ]), mayLink(true));
    expect(rebound?.authorized_alternatives.actions).not.toContain('send_payment_link');
  });
});
