import { describe, expect, it } from 'vitest';
import { assertsUnsupportedPrerequisitesV1, withoutUnsupportedPrerequisiteClausesV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';

/** Live 2026-11-02 19:23: three drafts answering "y el programa?" were all
 * rejected only for an unsupported "desde cero" clause → technical contingency. */
describe('salvage of an unsupported prerequisite clause', () => {
  it.each([
    ['Inglés 1 son 12 clases online, pensadas para que construyas la base desde cero y puedas aplicar lo que aprendés en la práctica, con material teórico incluido.',
      'Inglés 1 son 12 clases online, con material teórico incluido.'],
    ['Inglés 1 son 12 clases online, pensadas para que vayas construyendo la base desde cero y puedas aplicarla en la práctica, con material teórico de apoyo. Al terminar te queda el certificado de Studyx.',
      'Inglés 1 son 12 clases online, con material teórico de apoyo. Al terminar te queda el certificado de Studyx.'],
  ])('keeps the factual answer and drops only the claim', (draft, expected) => {
    expect(assertsUnsupportedPrerequisitesV1(draft)).toBe(true);
    const salvaged = withoutUnsupportedPrerequisiteClausesV1(draft);
    expect(salvaged).toBe(expected);
    expect(assertsUnsupportedPrerequisitesV1(salvaged)).toBe(false);
  });
  it('drops a sentence that is only the claim', () => {
    expect(withoutUnsupportedPrerequisiteClausesV1('Podés empezar desde cero. Son 12 clases online.')).toBe('Son 12 clases online.');
  });
  it('leaves supported text untouched', () => {
    const text = 'Son 12 clases online. Cómo preferís pagarlo?';
    expect(withoutUnsupportedPrerequisiteClausesV1(text)).toBe(text);
  });
});
