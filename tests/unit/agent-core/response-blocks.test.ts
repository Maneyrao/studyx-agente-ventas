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
    expect(text).toBe(original);
    expect(text).toContain('Dale,   perfecto...');
  });

  it('does not prune an empty resolved block', () => {
    expect(renderBlocksV3([
      { type: 'narrative', text: 'Antes' },
      { type: 'fact', fact_id: 'fact:empty' },
      { type: 'narrative', text: 'Después' },
    ], {
      facts: new Map([['fact:empty', '']]),
      artifacts: new Map(),
    })).toEqual({ text: 'Antes\n\n\n\nDespués', missing: [] });
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

  it.each([
    'Sale USD 1200',
    'son 1200 usd',
    'cuesta $1.200',
    'Pagás 12 cuotas de 30',
    'Pagás doce cuotas de treinta',
    'El valor es 360',
    'El valor es trescientos sesenta',
    'El precio: 360',
    'El precio es de trescientos sesenta',
    'La cuota es 60',
    'El importe: mil doscientos',
    'Cuesta mil doscientos',
    'Cuesta trescientos sesenta dólares.',
    'Sale U$S 360',
    'Un pago de 360',
    'La inversión es de trescientos sesenta',
    'Se abona en 12 pagos de 30',
    'El precio ronda los 360',
    'El total es 360',
  ])('rejects the amount in %s', (text) => {
    expect(narrativeViolationsV3(text)).toEqual(['NARRATIVE_CONTAINS_AMOUNT']);
  });

  it.each([
    'Son 38 clases en total',
    '38 clases',
    'Dura 90 minutos',
    'Dura 10 días',
    'Son treinta y ocho clases',
    'El curso se completa en 10 días',
    'La capacitación dura aproximadamente 10 días',
    'La carga horaria es de 10 horas',
    'La cursada es de 10 días',
    'La duración del curso es de 10 días',
    'El programa se extiende durante 10 semanas',
    'Cursás durante 10 meses',
    'La carrera se cursa durante 3 años',
    'Cursada de 10 meses',
  ])('rejects the course duration in %s', (text) => {
    expect(narrativeViolationsV3(text)).toEqual(['NARRATIVE_CONTAINS_DURATION']);
  });

  it.each([
    'Entrás en pay.example/abc',
    'Escribime en studyx.com',
    'Abrí 192.168.1.10/pago',
    'Abrí localhost:3000/pago',
    'Abrí localhost:3000',
    'Conectá a 192.168.1.10',
  ])('rejects the bare URL in %s', (text) => {
    expect(narrativeViolationsV3(text)).toEqual(['NARRATIVE_CONTAINS_URL']);
  });

  it('allows ordinary sales prose with no commercial value', () => {
    expect(narrativeViolationsV3('Es muy práctico y podés cursarlo a tu ritmo.')).toEqual([]);
  });

  it('reports every violation once and in stable order', () => {
    expect(narrativeViolationsV3('Pagá USD 360 en studyx.com durante 10 días de cursada.'))
      .toEqual([
        'NARRATIVE_CONTAINS_URL',
        'NARRATIVE_CONTAINS_AMOUNT',
        'NARRATIVE_CONTAINS_DURATION',
      ]);
  });

  it('allows a plain question with a number that is not a value claim', () => {
    expect(narrativeViolationsV3('¿Arrancamos por el módulo 1?')).toEqual([]);
  });

  it.each([
    'Somos 360 alumnos y empezamos en 2026.',
    '¿Tenés 2 minutos para que te cuente?',
    'Tenemos 2 minutos para conversar.',
    'Hay 10 minutos de espera.',
    'Son 3 días desde que escribiste.',
    'El curso empieza en 3 días.',
    'Tenés 10 días para decidir.',
    'El curso tiene 2 minutos para comenzar.',
    'Escribime a ana@example.com.',
    'Trabajamos con Node.js.',
    'El material usa config.json.',
    'El archivo se llama manual.pdf.',
    'El valor es una experiencia transformadora.',
    'El precio: un beneficio para tu carrera.',
    'La llamada dura 10 minutos.',
    'La espera dura 10 minutos.',
    'Registrarte cuesta dos minutos.',
    'Vale mil veces la pena.',
    'El valor es dos beneficios en uno.',
    'Descargá brochure.zip.',
  ])('does not flag the ordinary prose in %s', (text) => {
    expect(narrativeViolationsV3(text)).toEqual([]);
  });
});
