import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';

afterEach(() => vi.unstubAllEnvs());
(process.env.TEST_DATABASE_URL ? describe : describe.skip)('stored phone bonus permission across lead resets', () => {
  it('keeps the normalized phone allowed after replacing the contact, without trusting a declared phone', async () => {
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
    vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'false');
    vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS', '');
    vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S', phone);
    const slug = `phone-${randomUUID()}`;
    const [workspace] = await sql`INSERT INTO workspaces(slug,display_name) VALUES (${slug},'Phone test') RETURNING id`;
    async function contact(storedPhone: string, declaredPhone: string | null = null) {
      const [c] = await sql`INSERT INTO contacts(phone,declared_phone,channel_origin,status)
        VALUES (${storedPhone},${declaredPhone},'whatsapp','prospecto') RETURNING id`;
      await sql`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel) VALUES (${workspace.id},${c.id},'whatsapp')`;
      const [v] = await sql`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
      return { id: c.id as string, conversation: v.id as string };
    }
    const capability = (c: { id: string; conversation: string }, workspaceSlug = slug) => readCourseBonusCapabilityV1({
      workspace_slug: workspaceSlug, contact_id: c.id, conversation_id: c.conversation,
      channel: 'text', selected_offering_code: null,
    }, { db: sql });
    const old = await contact(phone);
    expect(await capability(old)).toMatchObject({ enabled: true, max_bonus_courses: 3 });
    await sql`UPDATE contacts SET phone=${'+1666'+String(Date.now()).slice(-7)},deleted_at=now() WHERE id=${old.id}`;
    const fresh = await contact(phone);
    expect(fresh.id).not.toBe(old.id);
    expect(await capability(fresh)).toMatchObject({ enabled: true, max_bonus_courses: 3 });
    expect(await capability(fresh, 'another-workspace')).toMatchObject({ enabled: false });
    const other = await contact('+1777'+String(Date.now()).slice(-7), phone);
    expect(await capability(other)).toMatchObject({ enabled: false });
  });
});
