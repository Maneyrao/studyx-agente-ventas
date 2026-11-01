import { describe, it, expect, vi } from 'vitest';
import { assemblePostSaleMessage, claimNotification, dispatchNotifications, type Deps, validateNotificationSource } from '@/features/fulfillment/post-sale/service';
import { postSaleAccessTestConfig } from '../../helpers/post-sale-config';
vi.mock('@/lib/db/orchestrator', () => ({ sql: {} }));
describe('post-sale verified access message', () => {
  // Owner's 2026-11-01 exception: only access is predetermined; pending
  // payment/access notices still validate facts in Agent A's own prose.
  const pending = { kind: 'payment_received' as const, student_was_created: null,
    login_email: null, login_url: null, known_offering_names: ['Community Manager'] };
  it('preserves the agent payment notice', () => {
    expect(assemblePostSaleMessage(pending, { intro: 'Recibimos tu pago. Estoy preparando tu acceso.', suggestion: '' }))
      .toBe('Recibimos tu pago. Estoy preparando tu acceso.');
  });
  it.each(['Tu contraseña es Inventada99', 'Entra en https://inventado.test',
    'Ya podés ingresar al campus.', 'Community Manager ya está habilitado.'])(
    'rejects invented facts before fulfillment: %s', intro => {
      expect(() => assemblePostSaleMessage(pending, { intro, suggestion: '' })).toThrow();
    });
  it('ignores any legacy model narrative when delivering authorized access', () => {
    const source = { ...pending, kind: 'access_ready' as const, enrollment_status: 'active',
      student_was_created: true, login_email: 'student@example.test', offering_name: 'Curso Prueba' };
    const text = assemblePostSaleMessage(source, { intro: 'Curso inventado gratis', suggestion: 'Texto ajeno' }, postSaleAccessTestConfig);
    expect(text).toContain('Tu acceso ya está habilitado. Bienvenido a Studyx.');
    expect(text).not.toContain('inventado');
    expect(text).not.toContain('Texto ajeno');
  });
  it('requires a confirmed enrollment for the originally registered email', () => {
    const source = { kind: 'access_ready' as const, enrollment_status: 'active', login_email: 'Student@Example.com', registration_email: 'student@example.com' };
    expect(validateNotificationSource(source)).toBe(true);
    expect(validateNotificationSource({ ...source, login_email: 'other@example.com' })).toBe(false);
    expect(validateNotificationSource({ ...source, enrollment_status: 'processing' })).toBe(false);
  });
  it('does not authorize access-ready while a promoted payment lacks the exact verified bonus set', () => {
    const source = {
      kind: 'access_ready' as const,
      enrollment_status: 'active',
      login_email: 'student@example.com',
      registration_email: 'student@example.com',
      bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
      verified_bonus_enrollments: [{ offering_code: 'ingles_2', enrollment_status: 'active', position: 1 }],
    };
    expect(validateNotificationSource(source)).toBe(true);
    expect(validateNotificationSource({ ...source, verified_bonus_enrollments: [] })).toBe(false);
    expect(validateNotificationSource({ ...source,
      verified_bonus_enrollments: [{ offering_code: 'otro', enrollment_status: 'active', position: 1 }] })).toBe(false);
    expect(validateNotificationSource({ ...source,
      verified_bonus_enrollments: [{ offering_code: 'ingles_2', enrollment_status: 'processing', position: 1 }] })).toBe(false);
  });
  it.each([
    { created: true, newUser: true, existingUser: false },
    { created: false, newUser: false, existingUser: true },
    { created: null, newUser: false, existingUser: false },
  ])('reports verified creation separately from an unknown student ($created)', async ({ created, newUser, existingUser }) => {
    const source = {
      id: '8ebdc504-59cc-4b32-9b18-4bfb2b96f88a', payment_id: '7b3c35f7-ec49-46ce-a621-2ef7fbeb2d04',
      kind: 'access_ready', status: 'dispatched', claim_token: null, dispatch_attempts: 1,
      lease_until: new Date('2026-10-14T12:01:00Z'), workspace_id: 'workspace-test', contact_id: 'contact-test',
      conversation_id: 'conversation-test', botpress_conversation_id: 'botpress-test', academy_name: 'Studyx',
      offering_name: 'Curso Prueba', registration_email: 'student@example.com', registration_name: 'Ana Prueba',
      enrollment_status: 'active', student_was_created: created, login_email: 'student@example.com', login_url: null,
    };
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(' ').replace(/\s+/gu, ' ').trim();
      if (query.startsWith('SELECT n.*')) return [source];
      if (query.includes("SET status = 'processing'")) return [{ id: source.id }];
      return [];
    });
    const claim = await claimNotification(source.id, 'botpress-test', {
      db: db as unknown as Deps['db'],
      config: { accessTemplate: postSaleAccessTestConfig, enabled: true, environment: 'test', paidAfter: new Date('2026-10-09T00:00:00Z') },
    });
    expect(claim).toMatchObject({ claimed: true, kind: 'access_ready', new_user: newUser, existing_user: existingUser });
  });

  it('reclaims an expired processing lease before any outbound send began', async () => {
    const priorToken = process.env.BOTPRESS_MANAGED_EGRESS_TOKEN;
    const priorBotId = process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID;
    process.env.BOTPRESS_MANAGED_EGRESS_TOKEN = 'synthetic-token';
    process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID = 'synthetic-bot';
    let status = 'processing';
    const source = {
      id: '8ebdc504-59cc-4b32-9b18-4bfb2b96f88a', payment_id: '7b3c35f7-ec49-46ce-a621-2ef7fbeb2d04',
      kind: 'access_ready', status, claim_token: '5c24f6cc-94f5-4f6a-8d54-b01323e33d29', dispatch_attempts: 1,
      lease_until: new Date('2026-10-14T12:01:00Z'), workspace_id: 'workspace-test', contact_id: 'contact-test',
      conversation_id: 'conversation-test', botpress_conversation_id: 'botpress-test', academy_name: 'Studyx',
      offering_name: 'Curso Prueba', registration_email: 'student@example.com', registration_name: 'Ana Prueba',
      enrollment_status: 'active', student_was_created: true, login_email: 'student@example.com', login_url: null,
    };
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(' ').replace(/\s+/gu, ' ').trim();
      if (query.startsWith('SELECT n.*')) return [{ ...source, status }];
      if (query.includes("SET status = 'pending'") && query.includes("status = 'processing'")) {
        status = 'pending';
        return [];
      }
      if (query.includes("SET status = 'ambiguous'") && query.includes("status = 'processing'")) {
        status = 'ambiguous';
        return [];
      }
      if (query.includes("SET status = 'dispatched'") && status === 'pending') {
        status = 'dispatched';
        return [{ id: source.id }];
      }
      return [];
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ event: { id: 'event-retry' } }), { status: 201 })) as unknown as typeof fetch;
    try {
      await expect(dispatchNotifications(source.payment_id, {
        db: db as unknown as Deps['db'], fetchImpl,
        config: { accessTemplate: postSaleAccessTestConfig, enabled: true, environment: 'test', paidAfter: new Date('2026-10-09T00:00:00Z') },
      })).resolves.toEqual({ dispatched: 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(status).toBe('dispatched');
    } finally {
      if (priorToken === undefined) delete process.env.BOTPRESS_MANAGED_EGRESS_TOKEN;
      else process.env.BOTPRESS_MANAGED_EGRESS_TOKEN = priorToken;
      if (priorBotId === undefined) delete process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID;
      else process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID = priorBotId;
    }
  });
  it('validates configuration before cancelling any pending payment notice', async () => {
    const db = vi.fn();
    const old = process.env.POST_SALE_CAMPUS_URL;
    delete process.env.POST_SALE_CAMPUS_URL;
    try {
      await expect(claimNotification('unused', 'unused', { db: db as unknown as Deps['db'],
        config: { enabled: true, environment: 'test', paidAfter: new Date() } }))
        .rejects.toThrow('POST_SALE_ACCESS_TEMPLATE_CONFIG_INVALID');
      expect(db).not.toHaveBeenCalled();
    } finally {
      if (old !== undefined) process.env.POST_SALE_CAMPUS_URL = old;
    }
  });

});
