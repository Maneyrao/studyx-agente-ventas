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
    expect(splitStatePatchV3({ expected_state_version: 1, set: { call_offer_status: 'accepted' } })
      .immediate.set).toEqual({ call_offer_status: 'accepted' });
  });

  it('carries the expected version into both halves', () => {
    const { immediate, deferred } = splitStatePatchV3({
      expected_state_version: 42, set: { awaiting_reply: 'contact_details' },
    });
    expect(immediate.expected_state_version).toBe(42);
    expect(deferred.expected_state_version).toBe(42);
  });
});
