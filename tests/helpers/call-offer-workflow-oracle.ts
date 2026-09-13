export interface TurnOfferOracleV1 {
  readonly offer_turns?: readonly number[];
}

/**
 * Historical suites assert the durable final count, not a per-turn schedule.
 * Absence of `offer_turns` therefore means "unspecified", never "must not
 * offer". New conversational suites opt into the exact per-turn contract.
 */
export function expectedOfferForTurnV1(
  oracle: TurnOfferOracleV1,
  turn: number,
): boolean | null {
  return oracle.offer_turns === undefined
    ? null
    : oracle.offer_turns.includes(turn);
}
