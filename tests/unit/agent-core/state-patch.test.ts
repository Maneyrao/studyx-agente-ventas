import { describe, expect, it } from 'vitest';
import {
  AWAITING_REPLIES_V3,
  CALL_OFFER_STATUSES_V3,
  CALL_PREFERENCES_V3,
  SALES_CONTEXT_STAGES_V3,
  SALES_PAYMENT_PLANS_V3,
  splitStatePatchV3,
} from '../../../agent-core/src/domain/state-patch';

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

  it.each([
    ['exploring', 'immediate'],
    ['qualified', 'immediate'],
    ['course_selected', 'immediate'],
    ['plan_selected', 'immediate'],
    ['payment_link_sent', 'deferred'],
    ['handoff', 'deferred'],
    ['closed', 'immediate'],
  ] as const)('classifies stage %s as %s', (stage, destination) => {
    const split = splitStatePatchV3({ expected_state_version: 1, set: { stage } });
    expect(split[destination].set).toEqual({ stage });
    expect(split[destination === 'immediate' ? 'deferred' : 'immediate'].set).toEqual({});
  });

  it.each([
    ['not_offered', 'immediate'],
    ['offered', 'deferred'],
    ['accepted', 'immediate'],
    ['declined', 'immediate'],
  ] as const)('classifies call offer status %s as %s', (call_offer_status, destination) => {
    const split = splitStatePatchV3({ expected_state_version: 1, set: { call_offer_status } });
    expect(split[destination].set).toEqual({ call_offer_status });
    expect(split[destination === 'immediate' ? 'deferred' : 'immediate'].set).toEqual({});
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

  it.each([0, 1] as const)('keeps call offer delta %i deferred', (call_offer_delta) => {
    const split = splitStatePatchV3({ expected_state_version: 1, set: { call_offer_delta } });
    expect(split.immediate.set).toEqual({});
    expect(split.deferred.set).toEqual({ call_offer_delta });
  });

  it('accepts null for both nullable selection fields', () => {
    const split = splitStatePatchV3({
      expected_state_version: 1,
      set: { selected_offering_code: null, selected_payment_plan: null },
    });
    expect(split.immediate.set).toEqual({
      selected_offering_code: null,
      selected_payment_plan: null,
    });
    expect(split.deferred.set).toEqual({});
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

  it('rejects unknown fields', () => {
    expect(() => splitStatePatchV3({
      expected_state_version: 1,
      set: { typo: true },
    } as unknown as Parameters<typeof splitStatePatchV3>[0])).toThrow('STATE_PATCH_INVALID:typo');
  });

  it('preserves version zero for a conversation without persisted state', () => {
    const split = splitStatePatchV3({
      expected_state_version: 0,
      set: { selected_offering_code: 'dip-mkt', awaiting_reply: 'course_choice' },
    });
    expect(split.immediate.expected_state_version).toBe(0);
    expect(split.deferred.expected_state_version).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])
    ('rejects invalid expected version %s', (expected_state_version) => {
      expect(() => splitStatePatchV3({ expected_state_version, set: {} }))
        .toThrow('STATE_PATCH_INVALID:expected_state_version');
    });

  it('rejects a string expected version from an unvalidated JSON payload', () => {
    expect(() => splitStatePatchV3({
      expected_state_version: '1', set: {},
    } as unknown as Parameters<typeof splitStatePatchV3>[0]))
      .toThrow('STATE_PATCH_INVALID:expected_state_version');
  });

  it.each([
    ['selected_payment_plan', ['monthly_12']],
    ['stage', ['payment_link_sent']],
    ['call_preference', ['chat']],
    ['call_offer_status', ['offered']],
    ['awaiting_reply', ['course_choice']],
    ['stage', {}],
    ['call_offer_status', 1],
    ['call_preference', true],
    ['awaiting_reply', null],
  ] as const)('rejects non-scalar JSON for %s', (field, value) => {
    expect(() => splitStatePatchV3({
      expected_state_version: 1,
      set: { [field]: value },
    } as unknown as Parameters<typeof splitStatePatchV3>[0]))
      .toThrow(`STATE_PATCH_INVALID:${field}`);
  });

  it('exports every closed domain as the source accepted by runtime validation', () => {
    expect(SALES_CONTEXT_STAGES_V3).toEqual([
      'exploring', 'qualified', 'course_selected', 'plan_selected',
      'payment_link_sent', 'handoff', 'closed',
    ]);
    expect(SALES_PAYMENT_PLANS_V3).toEqual(['monthly_12', 'monthly_6', 'one_time']);
    expect(CALL_PREFERENCES_V3).toEqual(['unknown', 'call', 'chat', 'declined']);
    expect(CALL_OFFER_STATUSES_V3).toEqual(['not_offered', 'offered', 'accepted', 'declined']);
    expect(AWAITING_REPLIES_V3).toEqual([
      'none', 'area_choice', 'course_choice', 'call_or_chat',
      'payment_plan', 'payment_confirmation', 'contact_details',
    ]);
  });

  it('carries the expected version into both halves', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 42, set: { awaiting_reply: 'contact_details' },
    });
    expect(immediate.expected_state_version).toBe(42);
    expect(deferred.expected_state_version).toBe(42);
  });
});
