import { describe, expect, it } from 'vitest';
import { splitStatePatchV3 } from '../../../agent-core/src/domain/state-patch';

describe('splitStatePatchV3', () => {
  it('keeps customer-declared facts in the immediate half', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 7,
      set: { selected_offering_code: 'diplomado-marketing', payment_reported: true },
    });
    expect(immediate.set).toEqual({
      selected_offering_code: 'diplomado-marketing', payment_reported: true,
    });
    expect(deferred.set).toEqual({});
  });

  it('defers everything that depends on the customer seeing the message', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 7,
      set: { call_offer_delta: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' },
    });
    expect(immediate.set).toEqual({});
    expect(deferred.set).toEqual({
      call_offer_delta: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat',
    });
  });

  it('classifies stage by its target value, not by the field name', () => {
    expect(splitStatePatchV3({ expected_state_version: 1, set: { stage: 'course_selected' } })
      .immediate.set).toEqual({ stage: 'course_selected' });
    expect(splitStatePatchV3({ expected_state_version: 1, set: { stage: 'payment_link_sent' } })
      .deferred.set).toEqual({ stage: 'payment_link_sent' });
  });

  it('treats an accepted or declined call offer as customer-declared', () => {
    for (const call_offer_status of ['accepted', 'declined', 'not_offered'] as const) {
      expect(splitStatePatchV3({ expected_state_version: 1, set: { call_offer_status } })
        .immediate.set).toEqual({ call_offer_status });
    }
  });

  it('classifies every customer-declared field as immediate', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 3,
      set: {
        selected_offering_code: 'dip-mkt',
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        call_preference: 'chat',
        payment_reported: false,
      },
    });
    expect(immediate.set).toEqual({
      selected_offering_code: 'dip-mkt',
      selected_payment_plan: 'monthly_12',
      stage: 'plan_selected',
      call_preference: 'chat',
      payment_reported: false,
    });
    expect(deferred.set).toEqual({});
  });

  it.each(['course_selected', 'closed'] as const)
    ('keeps the customer-owned stage %s immediate', (stage) => {
      expect(splitStatePatchV3({ expected_state_version: 1, set: { stage } }).immediate.set)
        .toEqual({ stage });
    });

  it('defers handoff as an outbound-dependent stage', () => {
    expect(splitStatePatchV3({ expected_state_version: 1, set: { stage: 'handoff' } }).deferred.set)
      .toEqual({ stage: 'handoff' });
  });

  it.each([
    ['stage', 'payment_link_send'],
    ['call_preference', 'telephone'],
    ['call_offer_status', 'offerred'],
    ['awaiting_reply', 'name'],
    ['selected_payment_plan', 'cash'],
  ] as const)('rejects an unknown %s value instead of classifying it as immediate', (field, value) => {
    const invalid = {
      expected_state_version: 1,
      set: { [field]: value },
    } as unknown as Parameters<typeof splitStatePatchV3>[0];
    expect(() => splitStatePatchV3(invalid)).toThrow(`STATE_PATCH_INVALID:${field}`);
  });

  it('rejects unknown fields and invalid expected versions', () => {
    expect(() => splitStatePatchV3({
      expected_state_version: 1,
      set: { typo: true },
    } as unknown as Parameters<typeof splitStatePatchV3>[0])).toThrow('STATE_PATCH_INVALID:typo');
    expect(() => splitStatePatchV3({ expected_state_version: 0, set: {} }))
      .toThrow('STATE_PATCH_INVALID:expected_state_version');
  });

  it('carries the expected version into both halves', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 42, set: { awaiting_reply: 'contact_details' },
    });
    expect(immediate.expected_state_version).toBe(42);
    expect(deferred.expected_state_version).toBe(42);
  });
});
