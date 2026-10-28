import type postgres from 'postgres';

/** Called inside the worker's fenced transaction; only catalog codes cross this boundary. */
export async function openBonusFulfillmentCase(db: postgres.Sql, paymentId: string, reason: string) {
  await db`SELECT open_bonus_fulfillment_case(${paymentId}::uuid,${reason})`;
}
