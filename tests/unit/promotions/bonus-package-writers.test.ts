import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Package invariance (owner decision 2026-11-04): in a turn without a valid
 * offer_course_bonus (or the literal swap) the promotion package keeps its
 * cycle, offer_version, bonus count and courses. Static inventory of every
 * writer of the package tables: only the direct bonus service may append a
 * bonus or bump offer_version, and it is reachable only from the accepted
 * offer_course_bonus action of a committed turn.
 */
const SRC = 'src';
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.ts$/u.test(name) ? [path] : [];
  });
}
const files = sources(SRC);
const read = (path: string) => readFileSync(path, 'utf8');
const DIRECT_SERVICE = 'src/features/promotions/application/direct-course-bonus-service.ts';

describe('promotion package writers', () => {
  it('only the direct bonus service appends a direct bonus or bumps offer_version', () => {
    const appenders = files.filter(path => read(path).includes('append_direct_course_bonus('));
    expect(appenders).toEqual([DIRECT_SERVICE]);
    const bumpers = files.filter(path => /SET[^;`]*\boffer_version\s*=/u.test(read(path)));
    expect(bumpers).toEqual([]);
  });

  it.each([
    'src/features/payments/application/reserve-payment-link.ts',
    'src/features/calls/adapters/postgres-retell-orchestration-store.ts',
    'src/features/promotions/application/commercial-followup-service.ts',
  ])('%s never appends a direct-mode bonus nor touches offer_version', path => {
    const text = read(path);
    expect(text).not.toContain('append_direct_course_bonus');
    expect(text).not.toMatch(/SET[^;`]*\boffer_version\s*=/u);
    expect(text).not.toMatch(/INSERT INTO promotion_offers[^;]*package_mode\s*,?[^;]*'direct'/u);
    expect(text).not.toMatch(/package_mode\s*=\s*'direct'[^;]*INSERT INTO promotion_offer_bonus_offerings/u);
  });

  it('reserve-payment-link only seals the package: it attaches the payment and adds no bonus to the offer', () => {
    const text = read('src/features/payments/application/reserve-payment-link.ts');
    expect(text).toMatch(/UPDATE promotion_offers SET status = 'attached'/u);
    expect(text).not.toMatch(/INSERT INTO promotion_offer_bonus_offerings/u);
  });

  it('offerDirectCourseBonusV1 is called only from the committed offer_course_bonus action and validates the motive unless it is a swap', () => {
    const callers = files.filter(path => path !== DIRECT_SERVICE && read(path).includes('offerDirectCourseBonusV1('));
    expect(callers).toEqual(['src/lib/services/decision.service.ts']);
    const decision = read(callers[0]!);
    expect(decision).toMatch(/committedBusinessAction\?\.type === 'offer_course_bonus'[\s\S]{0,2500}offerDirectCourseBonusV1\(/u);
    const service = read(DIRECT_SERVICE);
    expect(service).toContain('validateBonusMotiveV1(');
    expect(service).toMatch(/if \(!chosen\) \{[\s\S]{0,900}validateBonusMotiveV1\(/u);
  });

  it('no module authorizes a bonus from persisted objection memory any more', () => {
    for (const path of ['src/features/promotions/application/read-course-bonus-ladder.ts',
      'src/features/conversation/domain/agent-turn-policy-v2.ts', DIRECT_SERVICE]) {
      const text = read(path);
      expect(text).not.toContain('price_objection_count');
      expect(text).not.toContain('price_evidence');
      expect(text).not.toContain('readNegotiationFactsV1');
    }
  });
});
