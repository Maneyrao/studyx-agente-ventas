import type { DbClient } from './types';

/**
 * Build a `jsonb` bind parameter.
 *
 * postgres.js resolves a parameter's type from the cast written right after its
 * slot, and when that type is `json`/`jsonb` it applies its own JSON encoding to
 * whatever value it was handed. Interpolating an already-serialized payload
 * therefore stores a JSON *string*:
 *
 * ```
 * jsonb_typeof(${JSON.stringify([])}::jsonb) -> 'string'   ✗ double encoded
 * jsonb_typeof(${jsonbParam(db, [])})        -> 'array'    ✓
 * ```
 *
 * `agent_decisions.memory_candidates` carries `CHECK (jsonb_typeof = 'array')`,
 * so the double encoding fails the whole decision commit; the other jsonb
 * columns accept the string and silently lose query-ability, which breaks
 * trace-ability (invariant 7).
 *
 * `null` and `undefined` map to SQL NULL rather than the JSON `null` document,
 * which is what every nullable jsonb column in this schema means.
 *
 * `tests/unit/db/jsonb-parameters.test.ts` fails the build if the raw
 * `JSON.stringify(...)::jsonb` pattern comes back.
 */
export function jsonbParam(db: DbClient, value: unknown) {
  if (value === null || value === undefined) return null;
  return db.json(value as Parameters<DbClient['json']>[0]);
}
