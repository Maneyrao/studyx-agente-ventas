import { describe, it, expect, vi } from 'vitest';
import { assemblePostSaleMessage, claimNotification, type Deps, validateNotificationSource } from '@/features/fulfillment/post-sale/service';
vi.mock('@/lib/db/orchestrator', () => ({ sql: {} }));
describe('post-sale verified access message', () => {
  const access = { kind: 'access_ready' as const, student_was_created: true, login_email: 'student@example.com', login_url: null };
  it('uses the verified username and initial password in a list', () => {
    expect(assemblePostSaleMessage(access, { intro: 'Ya tienes acceso a tu curso 🙂', suggestion: 'Si quieres, puedes cambiar tu contraseña al ingresar.' }))
      .toBe('Ya tienes acceso a tu curso 🙂\n\n- Usuario: student@example.com\n- Contraseña: Escuela.123\n\nSi quieres, puedes cambiar tu contraseña al ingresar.\n\nGracias por unirte a nuestra comunidad StudyX. Nos alegra mucho acompañarte en este nuevo paso 💛');
  });
  it('retains the password of an existing user', () => {
    const message = assemblePostSaleMessage({ ...access, student_was_created: false }, { intro: 'Ya tienes acceso.', suggestion: '' });
    expect(message).not.toContain('Escuela.123');
    expect(message).toContain('Gracias por seguir siendo parte de nuestra comunidad StudyX');
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
    const db = vi.fn().mockResolvedValueOnce([source]).mockResolvedValueOnce([{ id: source.id }]).mockResolvedValueOnce([]);
    const claim = await claimNotification(source.id, 'botpress-test', {
      db: db as unknown as Deps['db'],
      config: { enabled: true, environment: 'test', paidAfter: new Date('2026-10-09T00:00:00Z') },
    });
    expect(claim).toMatchObject({ claimed: true, kind: 'access_ready', new_user: newUser, existing_user: existingUser });
  });
});
