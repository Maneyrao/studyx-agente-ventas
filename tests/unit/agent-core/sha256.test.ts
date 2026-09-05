import { describe, expect, it } from 'vitest';
import { sha256TextHexV1 } from '../../../agent-core/src/domain/sha256';

describe('portable SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['llamada útil ☎', 'b609145de721b37d81cd60c23d9044ff8d937aa309f4929f036d8fe33af73524'],
  ])('matches the SHA-256 vector for %j', (input, expected) => {
    expect(sha256TextHexV1(input)).toBe(expected);
  });
});
