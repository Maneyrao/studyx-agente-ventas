import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '@/lib/idempotency/canonical-json';

describe('canonical JSON hashing', () => {
  it('is stable across object key order', () => {
    const left = { trace: { b: 2, a: 1 }, items: [{ z: true, a: null }] };
    const right = { items: [{ a: null, z: true }], trace: { a: 1, b: 2 } };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(sha256Hex(left)).toBe(sha256Hex(right));
  });

  it('changes when semantic content changes', () => {
    expect(sha256Hex({ content: 'hola' })).not.toBe(sha256Hex({ content: 'chau' }));
  });
});

