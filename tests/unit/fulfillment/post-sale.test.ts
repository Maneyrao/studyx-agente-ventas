import { describe, it, expect, vi } from 'vitest';
import { assemblePostSaleMessage, validateNotificationSource } from '@/features/fulfillment/post-sale/service';
vi.mock('@/lib/db/orchestrator', () => ({ sql: {} }));
describe('post-sale verified access message', () => {
  const access = { kind: 'access_ready' as const, student_was_created: true, login_email: 'student@example.com', login_url: null };
  it('uses the verified username and initial password in a list', () => {
    expect(assemblePostSaleMessage(access, { intro: 'Ya tienes acceso a tu curso 🙂', suggestion: 'Si quieres, puedes cambiar tu contraseña al ingresar.' }))
      .toBe('Ya tienes acceso a tu curso 🙂\n\n- Usuario: student@example.com\n- Contraseña: Studyx.123\n\nSi quieres, puedes cambiar tu contraseña al ingresar.');
  });
  it('retains the password of an existing user', () => {
    expect(assemblePostSaleMessage({ ...access, student_was_created: false }, { intro: 'Ya tienes acceso.', suggestion: '' })).not.toContain('Studyx.123');
  });
  it('does not expose credentials on payment confirmation or delay', () => {
    for (const kind of ['payment_received', 'access_delayed'] as const) {
      expect(assemblePostSaleMessage({ ...access, kind }, { intro: 'Recibimos tu pago, estamos preparando tu acceso.', suggestion: '' })).not.toContain('Contraseña');
    }
  });
  it('rejects invented credentials, URLs and required password changes', () => {
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
});
