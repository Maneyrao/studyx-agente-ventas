import { describe, expect, it } from 'vitest';
import { buildPostSaleInstructions, PostSaleClaimSchema } from '../../../botpress-agent/src/utils/post-sale-instructions';

type EventKind = 'payment_received' | 'access_ready' | 'access_delayed';
const welcome = 'Bienvenido a Studyx, espero que disfrutes mucho de estudiar con nosotros!';
const canonicalPrompt = 'Personalidad canónica de la asesora.';
const claim = {
  claimed: true, claim_token: '15357952-de34-498c-a877-7e19a8c9d266', kind: 'access_ready',
  academy_name: 'Studyx', offering_name: 'Curso Prueba', customer_first_name: 'Ana',
  existing_user: false, new_user: true, history: [],
};

describe('post-sale Agent A event instructions', () => {
  it('authorizes the welcome alongside access only for a verified new student', () => {
    const parsed = PostSaleClaimSchema.parse(claim);
    if (!parsed.claimed) throw new Error('Expected a claimed notification');
    const instructions = buildPostSaleInstructions(canonicalPrompt, parsed);

    expect(parsed).toMatchObject({ kind: 'access_ready', new_user: true });
    expect(instructions.startsWith(`${canonicalPrompt}\n\n`)).toBe(true);
    expect(instructions).toContain(welcome);
    expect(instructions).not.toContain('No saludes, no te presentes de nuevo');
  });

  it.each([
    { kind: 'access_ready', newUser: false, existingUser: true },
    { kind: 'access_ready', newUser: false, existingUser: false },
    { kind: 'access_ready', newUser: undefined, existingUser: false },
    { kind: 'payment_received', newUser: true, existingUser: false },
    { kind: 'access_delayed', newUser: true, existingUser: false },
  ] satisfies Array<{ kind: EventKind; newUser: boolean | undefined; existingUser: boolean }>)
  ('does not authorize a new-student welcome for $kind, new_user=$newUser, existing_user=$existingUser', ({ kind, newUser, existingUser }) => {
    const input: Record<string, unknown> = { ...claim, kind, existing_user: existingUser };
    if (newUser === undefined) delete input.new_user;
    else input.new_user = newUser;
    const parsed = PostSaleClaimSchema.parse(input);
    if (!parsed.claimed) throw new Error('Expected a claimed notification');
    const instructions = buildPostSaleInstructions(canonicalPrompt, parsed);

    expect(parsed).toMatchObject({ kind, new_user: newUser ?? false });
    expect(instructions).not.toContain(welcome);
    expect(instructions).toContain('No saludes ni des la bienvenida');
  });
});
