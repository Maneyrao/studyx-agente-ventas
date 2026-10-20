import { describe, it, expect, vi } from 'vitest';
import { assemblePostSaleMessage, claimNotification, dispatchNotifications, type Deps, validateNotificationSource } from '@/features/fulfillment/post-sale/service';
vi.mock('@/lib/db/orchestrator', () => ({ sql: {} }));
describe('post-sale verified access message', () => {
  const access = { kind: 'access_ready' as const, student_was_created: true, login_email: 'student@example.com', login_url: null,
    registration_name: 'Ana Prueba', offering_name: 'Curso Prueba' };
  it('uses the verified username and initial password in a list', () => {
    expect(assemblePostSaleMessage(access, { intro: 'Ya tienes acceso. Bienvenido a Studyx 🙂', suggestion: 'Si quieres, puedes cambiar tu contraseña al ingresar.' }))
      .toBe('Ya tienes acceso. Bienvenido a Studyx 🙂\n\n- Usuario: student@example.com\n- Contraseña: Escuela.123\n\nSi quieres, puedes cambiar tu contraseña al ingresar.');
  });
  it('retains the password of an existing user without appending backend-authored prose', () => {
    const message = assemblePostSaleMessage({ ...access, student_was_created: false }, { intro: 'Ya tienes acceso. Qué bueno seguir acompañándote en Studyx.', suggestion: '' });
    expect(message).not.toContain('Escuela.123');
    expect(message).toBe('Ya tienes acceso. Qué bueno seguir acompañándote en Studyx.\n\n- Usuario: student@example.com\n- Contraseña: la que ya utilizas');
  });
  it('does not expose credentials on payment confirmation or delay', () => {
    for (const kind of ['payment_received', 'access_delayed'] as const) {
      expect(assemblePostSaleMessage({ ...access, kind }, { intro: 'Recibimos tu pago, estamos preparando tu acceso.', suggestion: '' })).not.toContain('Contraseña');
    }
  });
  it('rejects invented credentials, URLs and required password changes', () => {
    expect(() => assemblePostSaleMessage(access, { intro: 'Tu clave es Escuela.123', suggestion: '' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Tu clave es Studyx.123', suggestion: '' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Usuario: another@example.com', suggestion: '' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Listo.', suggestion: 'Debes cambiar tu contraseña.' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Entra en https://fake.example', suggestion: '' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Tu contraseña es ClaveInventada99', suggestion: '' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Tu clave temporal es SecretaNueva', suggestion: '' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Listo.', suggestion: 'Si quieres, entra con contraseña: ClaveInventada99' })).toThrow();
    expect(() => assemblePostSaleMessage(access, { intro: 'Listo.', suggestion: 'Si quieres, usa SecretaNueva como contraseña.' })).toThrow();
  });
  it('treats repeated identity details and brand casing as non-blocking style issues', () => {
    expect(assemblePostSaleMessage(access, { intro: 'Ana, ya tienes acceso a Curso Prueba en StudyX.', suggestion: '' }))
      .toContain('Ana, ya tienes acceso a Curso Prueba en Studyx.');
  });
  it('requires a confirmed enrollment for the originally registered email', () => {
    const source = { kind: 'access_ready' as const, enrollment_status: 'active', login_email: 'Student@Example.com', registration_email: 'student@example.com' };
    expect(validateNotificationSource(source)).toBe(true);
    expect(validateNotificationSource({ ...source, login_email: 'other@example.com' })).toBe(false);
    expect(validateNotificationSource({ ...source, enrollment_status: 'processing' })).toBe(false);
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
      config: { enabled: true, environment: 'test', paidAfter: new Date('2026-10-09T00:00:00Z') },
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
        config: { enabled: true, environment: 'test', paidAfter: new Date('2026-10-09T00:00:00Z') },
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
});
