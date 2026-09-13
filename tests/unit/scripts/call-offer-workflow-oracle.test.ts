import { describe, expect, it } from 'vitest';

import { expectedOfferForTurnV1 } from '../../helpers/call-offer-workflow-oracle';

describe('call-offer workflow oracle', () => {
  it('leaves a historical turn unspecified when only a final count exists', () => {
    expect(expectedOfferForTurnV1({}, 1)).toBeNull();
  });

  it('keeps exact positive and negative turn assertions for new suites', () => {
    expect(expectedOfferForTurnV1({ offer_turns: [1, 3] }, 1)).toBe(true);
    expect(expectedOfferForTurnV1({ offer_turns: [1, 3] }, 2)).toBe(false);
  });
});
