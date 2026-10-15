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
});
