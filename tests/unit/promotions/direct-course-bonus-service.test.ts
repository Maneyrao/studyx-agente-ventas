import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@/lib/db/types';
import { offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';

afterEach(() => vi.unstubAllEnvs());
describe('direct bonus rollout authorization', () => {
  it.each([
    ['review', 'true', '2'], ['direct', 'false', '2'], ['direct', 'true', '0'],
    ['direct', 'true', '4'], ['direct', 'true', undefined],
  ])('fails closed for mode=%s enabled=%s limit=%s', async (mode, enabled, limit) => {
    vi.stubEnv('COURSE_BONUS_FLOW_MODE', mode);
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', enabled);
    vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS', '');
    vi.stubEnv('COURSE_BONUS_MAX_COURSES', limit);
    const db = vi.fn();
    expect(await offerDirectCourseBonusV1(db as unknown as DbClient, {
      workspace_id: '', contact_id: '', conversation_id: '', paid_offering_code: '',
      promotion_code: '', promotion_cycle_id: '', expected_offer_version: 0,
      source_turn_id: '', bonus_offering_codes: ['gift'],
      outbound: { id: '', content: 'Bonus', provider: 'test', integration_id: 'test',
        channel: 'whatsapp', destination: 'test', idempotency_key: '' },
    })).toEqual({ ok: false, reason: 'bonus_disabled' });
    expect(db).not.toHaveBeenCalled();
  });
});
