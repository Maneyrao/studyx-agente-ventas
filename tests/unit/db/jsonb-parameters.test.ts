import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the postgres.js double-encoding trap documented in
 * `src/lib/db/json.ts`.
 *
 * `${JSON.stringify(value)}::jsonb` looks correct but stores a JSON *string*,
 * because postgres.js infers the parameter type from the trailing cast and then
 * JSON-encodes whatever it was handed. It fails loudly on
 * `agent_decisions.memory_candidates` (CHECK jsonb_typeof = 'array') and fails
 * silently everywhere else. Only an integration test against a real database
 * catches it, so this static check keeps the pattern out of the unit gate too.
 */

const SOURCE_ROOT = fileURLToPath(new URL('../../../src', import.meta.url));

/**
 * Any template slot immediately followed by a jsonb cast — `${…}::jsonb`.
 *
 * Matching the cast rather than `JSON.stringify(` is deliberate. A pattern
 * anchored on the serializer is trivially evaded: rename to a local
 * (`const p = JSON.stringify(x); …${p}::jsonb`), uppercase the type, qualify it
 * as `pg_catalog.jsonb`, or simply exceed the lookahead window. The cast is the
 * part that actually triggers postgres.js's type inference, and after this fix
 * `src/` has no legitimate use for one: `jsonbParam` tags the parameter with the
 * jsonb OID itself, so the cast is always either redundant or a live bug.
 */
const CASTED_JSONB_BIND_PARAMETER = /\}\s*::\s*(?:pg_catalog\s*\.\s*)?jsonb\b/i;

// The helper's own doc comment spells the anti-pattern out on purpose.
const DOCUMENTS_THE_PATTERN = join('lib', 'db', 'json.ts');

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return typescriptFiles(path);
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

describe('jsonb bind parameters', () => {
  it('never casts a bind parameter to jsonb', () => {
    const offenders = typescriptFiles(SOURCE_ROOT)
      .filter((path) => !path.endsWith(DOCUMENTS_THE_PATTERN))
      .filter((path) => CASTED_JSONB_BIND_PARAMETER.test(readFileSync(path, 'utf8')));

    expect(
      offenders.map((path) => path.slice(SOURCE_ROOT.length + 1)),
      'Use jsonbParam(db, value) from src/lib/db/json.ts instead of casting a bind parameter to jsonb'
    ).toEqual([]);
  });

  it('recognises the evasions a serializer-anchored pattern would miss', () => {
    const evasions = [
      'sql`INSERT INTO t (p) VALUES (${JSON.stringify(x)}::jsonb)`',
      'sql`INSERT INTO t (p) VALUES (${JSON.stringify(x)\n}::jsonb)`',
      'sql`INSERT INTO t (p) VALUES (${payload}::JSONB)`',
      'sql`INSERT INTO t (p) VALUES (${payload}::pg_catalog.jsonb)`',
      'const p = JSON.stringify(x);\nsql`INSERT INTO t (p) VALUES (${p} :: jsonb)`',
    ];
    for (const source of evasions) {
      expect(CASTED_JSONB_BIND_PARAMETER.test(source), source).toBe(true);
    }
  });

  it('leaves other casts alone', () => {
    const allowed = [
      'sql`SELECT ${id}::uuid`',
      'sql`SELECT ${vector}::extensions.vector`',
      'sql`SELECT ${names}::text[]`',
      "sql`SELECT jsonb_typeof('[]'::jsonb)`", // a literal, not a bind slot
    ];
    for (const source of allowed) {
      expect(CASTED_JSONB_BIND_PARAMETER.test(source), source).toBe(false);
    }
  });

  it('maps null and undefined to SQL NULL rather than a JSON null document', async () => {
    const { jsonbParam } = await import('@/lib/db/json');
    const db = { json: (value: unknown) => ({ wrapped: value }) } as never;

    expect(jsonbParam(db, null)).toBeNull();
    expect(jsonbParam(db, undefined)).toBeNull();
    expect(jsonbParam(db, [])).toEqual({ wrapped: [] });
    expect(jsonbParam(db, { a: 1 })).toEqual({ wrapped: { a: 1 } });
  });
});
