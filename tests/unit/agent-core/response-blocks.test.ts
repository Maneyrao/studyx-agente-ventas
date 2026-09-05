import { describe, expect, it } from 'vitest';
import {
  narrativeViolationsV3,
  renderBlocksV3,
  type ArtifactTableV3,
} from '../../../agent-core/src/domain/response-blocks';

const table: ArtifactTableV3 = {
  facts: new Map([['fact:price:one_time', 'USD 1200']]),
  artifacts: new Map([['prep-1', 'Link de pago: https://pay.example/abc']]),
};

describe('renderBlocksV3', () => {
  it('materializes facts and artifacts and preserves narrative verbatim', () => {
    expect(renderBlocksV3([
      { type: 'narrative', text: 'Te cuento cómo viene la cursada.' },
      { type: 'fact', fact_id: 'fact:price:one_time' },
      { type: 'artifact', preparation_id: 'prep-1' },
    ], table)).toEqual({
      text: 'Te cuento cómo viene la cursada.\n\nUSD 1200\n\nLink de pago: https://pay.example/abc',
      missing: [],
    });
  });

  it('never alters the narrative it received', () => {
    const original = '  Dale,   perfecto...  ¿arrancamos?  ';
    const { text } = renderBlocksV3([{ type: 'narrative', text: original }], table);
    expect(text).toBe(original.trim());
    expect(text).toContain('Dale,   perfecto...');
  });

  it('reports an unresolved reference instead of dropping it silently', () => {
    expect(renderBlocksV3([{ type: 'fact', fact_id: 'fact:unknown' }], table))
      .toEqual({ text: '', missing: ['fact:unknown'] });
  });
});

describe('narrativeViolationsV3', () => {
  it('rejects a URL in narrative', () => {
    expect(narrativeViolationsV3('Te paso https://pay.example/abc'))
      .toEqual(['NARRATIVE_CONTAINS_URL']);
  });

  it.each(['Sale USD 1200', 'son 1200 usd', 'cuesta $1.200'])('rejects the amount in %s', (text) => {
    expect(narrativeViolationsV3(text)).toContain('NARRATIVE_CONTAINS_AMOUNT');
  });

  it('rejects a course duration in narrative', () => {
    expect(narrativeViolationsV3('Son 38 clases en total'))
      .toEqual(['NARRATIVE_CONTAINS_DURATION']);
  });

  it('allows ordinary sales prose with no commercial value', () => {
    expect(narrativeViolationsV3('Es muy práctico y podés cursarlo a tu ritmo.')).toEqual([]);
  });

  it('allows a plain question with a number that is not a value claim', () => {
    expect(narrativeViolationsV3('¿Arrancamos por el módulo 1?')).toEqual([]);
  });
});
