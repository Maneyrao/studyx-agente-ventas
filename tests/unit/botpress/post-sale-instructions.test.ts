import { describe, expect, it } from 'vitest';
import * as postSaleInstructions from '../../../botpress-agent/src/utils/post-sale-instructions';

const { buildPostSaleInstructions, PostSaleClaimSchema } = postSaleInstructions;

type EventKind = 'payment_received' | 'access_ready' | 'access_delayed';
const canonicalPrompt = 'Personalidad canónica de la asesora.';
const claim = {
  claimed: true, claim_token: '15357952-de34-498c-a877-7e19a8c9d266', kind: 'access_ready',
  academy_name: 'Studyx', offering_name: 'Curso Prueba', customer_first_name: 'Ana',
  existing_user: false, new_user: true, history: [],
};

describe('post-sale Agent A event instructions', () => {
  it('does not export backend-authored customer prose', () => {
    expect('fallbackPostSaleNarrative' in postSaleInstructions).toBe(false);
  });

  it('authorizes the welcome alongside access only for a verified new student', () => {
    const parsed = PostSaleClaimSchema.parse(claim);
    if (!parsed.claimed) throw new Error('Expected a claimed notification');
    const instructions = buildPostSaleInstructions(canonicalPrompt, parsed);

    expect(parsed).toMatchObject({ kind: 'access_ready', new_user: true });
    expect(instructions.startsWith(`${canonicalPrompt}\n\n`)).toBe(true);
    expect(instructions).toContain('dale una bienvenida cálida y natural a StudyX');
    expect(instructions).toContain('Tú, Agente A, redactas el mensaje final');
  });

  it.each([
    { kind: 'access_ready', newUser: false, existingUser: true, expected: 'Ya era alumno' },
    { kind: 'access_ready', newUser: false, existingUser: false, expected: 'sin afirmar si es su primera inscripción' },
    { kind: 'access_ready', newUser: undefined, existingUser: false, expected: 'sin afirmar si es su primera inscripción' },
    { kind: 'payment_received', newUser: true, existingUser: false, expected: 'el acceso todavía no está confirmado' },
    { kind: 'access_delayed', newUser: true, existingUser: false, expected: 'el acceso todavía no está confirmado' },
  ] satisfies Array<{ kind: EventKind; newUser: boolean | undefined; existingUser: boolean; expected: string }>)
  ('uses the verified relationship for $kind, new_user=$newUser, existing_user=$existingUser', ({ kind, newUser, existingUser, expected }) => {
    const input: Record<string, unknown> = { ...claim, kind, existing_user: existingUser };
    if (newUser === undefined) delete input.new_user;
    else input.new_user = newUser;
    const parsed = PostSaleClaimSchema.parse(input);
    if (!parsed.claimed) throw new Error('Expected a claimed notification');
    const instructions = buildPostSaleInstructions(canonicalPrompt, parsed);

    expect(parsed).toMatchObject({ kind, new_user: newUser ?? false });
    expect(instructions).not.toContain('dale una bienvenida cálida y natural a StudyX');
    expect(instructions).toContain(expected);
    expect(instructions).toContain('sin lenguaje de trámite');
    expect(instructions).toContain('Evita fórmulas como «se gestionará»');
  });
});
