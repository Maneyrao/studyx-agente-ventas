import { describe, expect, it } from 'vitest';
import {
  isCatalogRequestNeutral,
  resolveCatalogRequest,
  type CatalogResolutionSnapshot,
  type CatalogSnapshotOffering,
} from '@/features/orchestration/domain/catalog-resolution';

function offering(
  code: string,
  displayName: string,
  academy: string | null,
  aliases: readonly string[] = [],
): CatalogSnapshotOffering {
  return { code, display_name: displayName, academy, aliases };
}

function snapshot(
  offerings: readonly CatalogSnapshotOffering[],
  offeringsTruncated = 0,
): CatalogResolutionSnapshot {
  return { offerings, offerings_truncated: offeringsTruncated };
}

const MARKETING = offering(
  'marketing_digital',
  'Marketing Digital',
  'Academia de Marketing',
);
const COMMUNITY = offering(
  'community_manager',
  'Community Manager',
  'Academia de Marketing',
  ['Gestión de comunidades'],
);
const CELLPHONES = offering(
  'reparacion_celulares',
  'Reparación de Celulares',
  'Academia de Oficios',
);

describe('resolveCatalogRequest', () => {
  it('keeps an administrative identity confirmation neutral to the remembered course', () => {
    const text = 'Repetime con qué datos quedé anotada, quiero confirmar que están bien.';

    expect(resolveCatalogRequest(text, snapshot([offering('excel', 'Excel Integral', null)]))).toEqual({
      kind: 'no_catalog_intent',
    });
    expect(isCatalogRequestNeutral(text)).toBe(true);
  });

  it('does not treat design software prerequisites as a new course request', () => {
    const text = '¿Se puede hacer sin haber usado nunca un programa de diseño?';
    expect(resolveCatalogRequest(text, snapshot([
      offering('autocad', 'AutoCAD orientado al Diseño de Interiores', 'Tecnología'),
    ]))).toEqual({ kind: 'no_catalog_intent' });
    expect(isCatalogRequestNeutral(text)).toBe(true);
  });

  it('resolves a descriptive "el de" reply against two previously presented course names', () => {
    expect(resolveCatalogRequest(
      'El de sacar fotos de productos con el celu.',
      snapshot([
        offering(
          'foto_celular',
          'Fotografía con Celulares para Tiendas Online',
          'Marketing',
          ['fotos de productos con el celu'],
        ),
        offering('foto_profesional', 'Fotografía Profesional', 'Emprendedores'),
      ]),
    )).toEqual({
      kind: 'exact',
      offeringCode: 'foto_celular',
      displayName: 'Fotografía con Celulares para Tiendas Online',
      academy: 'Marketing',
      match: 'canonical',
    });
  });

  it('returns the canonical SKU and name for an exact course mention', () => {
    expect(resolveCatalogRequest('Quiero Marketing Digital', snapshot([MARKETING]))).toEqual({
      kind: 'exact',
      offeringCode: 'marketing_digital',
      displayName: 'Marketing Digital',
      academy: 'Academia de Marketing',
      match: 'canonical',
    });
  });

  it('normalizes Spanish accents, case, whitespace, and punctuation', () => {
    expect(
      resolveCatalogRequest(
        '  ¿REPARACION...   DE CELULARES?! ',
        snapshot([CELLPHONES]),
      ),
    ).toMatchObject({
      kind: 'exact',
      offeringCode: 'reparacion_celulares',
      displayName: 'Reparación de Celulares',
      match: 'canonical',
    });
  });

  it('resolves only aliases supplied structurally by the snapshot', () => {
    expect(
      resolveCatalogRequest(
        '¿Tienen GESTION, de comunidades?',
        snapshot([MARKETING, COMMUNITY]),
      ),
    ).toMatchObject({
      kind: 'exact',
      offeringCode: 'community_manager',
      displayName: 'Community Manager',
      match: 'canonical',
    });
  });

  it('resolves a canonical SKU without exposing another match dialect', () => {
    const coded = offering('mkt_101', 'Marketing para Negocios', 'Academia de Marketing');

    expect(resolveCatalogRequest('Quiero mkt_101', snapshot([coded]))).toEqual({
      kind: 'exact',
      offeringCode: 'mkt_101',
      displayName: 'Marketing para Negocios',
      academy: 'Academia de Marketing',
      match: 'canonical',
    });
  });

  it('accepts a typo only when one canonical course is sufficiently close', () => {
    expect(
      resolveCatalogRequest(
        '¿Tienen el curso de reparacion de celulare?',
        snapshot([CELLPHONES, MARKETING]),
      ),
    ).toMatchObject({
      kind: 'exact',
      offeringCode: 'reparacion_celulares',
      displayName: 'Reparación de Celulares',
      match: 'unique_typo',
    });
  });

  it('does not run typo matching without explicit catalog intent', () => {
    const oratory = offering('oratoria', 'Oratoria', 'Academia de Comunicación');

    expect(resolveCatalogRequest('El oratorio está cerrado', snapshot([oratory]))).toEqual({
      kind: 'no_catalog_intent',
    });
  });

  it('does not choose arbitrarily when a typo is close to multiple courses', () => {
    const result = resolveCatalogRequest(
      'Busco el curso de diseño interiore',
      snapshot([
        offering('diseno_interior', 'Diseño Interior', 'Academia de Diseño'),
        offering('diseno_interiores', 'Diseño Interiores', 'Academia de Diseño'),
      ]),
    );

    expect(result).toEqual({
      kind: 'ambiguous',
      requestedText: 'Busco el curso de diseño interiore',
      candidateCodes: ['diseno_interior', 'diseno_interiores'],
      clarification: 'choose_offering',
    });
  });

  it('returns not_found only when a non-empty snapshot is complete', () => {
    const result = resolveCatalogRequest(
      '¿Tienen un curso de Astronomía?',
      snapshot([MARKETING, COMMUNITY, CELLPHONES]),
    );

    expect(result).toEqual({
      kind: 'not_found',
      requestedText: '¿Tienen un curso de Astronomía?',
      requestedArea: null,
      alternativeCodes: ['community_manager', 'marketing_digital', 'reparacion_celulares'],
    });
  });

  it('treats a bare explicit unknown-course selection as catalog intent', () => {
    expect(resolveCatalogRequest('Quiero Python', snapshot([MARKETING, COMMUNITY]))).toEqual({
      kind: 'not_found',
      requestedText: 'Quiero Python',
      requestedArea: null,
      alternativeCodes: ['community_manager', 'marketing_digital'],
    });
  });

  it('returns unavailable instead of asserting absence from a truncated snapshot', () => {
    expect(
      resolveCatalogRequest(
        '¿Tienen un curso de Astronomía?',
        snapshot([MARKETING, COMMUNITY], 4),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'snapshot_truncated' });
  });

  it('returns unavailable when the snapshot is missing', () => {
    expect(resolveCatalogRequest('¿Tienen cursos de ventas?', null)).toEqual({
      kind: 'unavailable',
      reason: 'snapshot_missing',
    });
  });

  it('does not require a snapshot for a neutral message', () => {
    expect(resolveCatalogRequest('Hola', null)).toEqual({ kind: 'no_catalog_intent' });
  });

  it('returns unavailable for catalog intent when the snapshot is invalid', () => {
    expect(resolveCatalogRequest('¿Tienen cursos de ventas?', snapshot([]))).toEqual({
      kind: 'unavailable',
      reason: 'snapshot_invalid',
    });
  });

  it('does not expose an invalid snapshot error for a neutral message', () => {
    expect(resolveCatalogRequest('Hola', snapshot([]))).toEqual({ kind: 'no_catalog_intent' });
  });

  it('returns no_catalog_intent when the user did not mention or ask for a course', () => {
    expect(resolveCatalogRequest('Hola, muchas gracias.', snapshot([MARKETING]))).toEqual({
      kind: 'no_catalog_intent',
    });
  });

  it('does not treat a generic availability question as catalog intent', () => {
    expect(
      resolveCatalogRequest('¿Tienen horarios los sábados?', snapshot([MARKETING])),
    ).toEqual({ kind: 'no_catalog_intent' });
  });

  it('does not treat a generic fact follow-up about the selected program as a new catalog search', () => {
    expect(
      resolveCatalogRequest('¿Cuántas clases tiene el programa completo?', snapshot([MARKETING])),
    ).toEqual({ kind: 'no_catalog_intent' });
  });

  it('does not treat a demonstrative payment-plan choice as a new course selection', () => {
    expect(
      resolveCatalogRequest(
        'Buenísimo. Lo quiero pagar en 6 cuotas de 60 dólares, ya elegí esa opción.',
        snapshot([MARKETING]),
      ),
    ).toEqual({ kind: 'no_catalog_intent' });
  });

  it('does not treat a generic payment option as a course selection', () => {
    expect(
      resolveCatalogRequest(
        'Mejor voy con la opción más liviana por mes. Confirmo 12 pagos de 30 dólares.',
        snapshot([MARKETING]),
      ),
    ).toEqual({ kind: 'no_catalog_intent' });
  });

  it.each([
    'Perfecto, quiero las 12 cuotas de 30 dólares.',
    'Elijo los 12 pagos de 30 dólares.',
    'Bueno, prefiero sacármelo de encima. Pago único de 360 dólares.',
    'No me mandes el link todavía, quiero pensarlo.',
    'Quiero the cheapest plan.',
  ])('keeps payment and link-control language out of course selection: %s', (message) => {
    expect(resolveCatalogRequest(message, snapshot([MARKETING]))).toEqual({
      kind: 'no_catalog_intent',
    });
    expect(isCatalogRequestNeutral(message)).toBe(true);
  });

  it('returns at most three safe alternatives and prefers an explicitly named academy', () => {
    const sameAcademy = [
      offering('autocad', 'AutoCAD', 'Academia de Tecnología'),
      offering('excel', 'Excel Integral', 'Academia de Tecnología'),
      offering('redes', 'Redes Informáticas', 'Academia de Tecnología'),
      offering('soporte_pc', 'Soporte de PC', 'Academia de Tecnología'),
    ];
    const result = resolveCatalogRequest(
      'Busco un curso de Astronomía en la Academia de Tecnología',
      snapshot([MARKETING, ...sameAcademy]),
    );

    expect(result).toEqual({
      kind: 'not_found',
      requestedText: 'Busco un curso de Astronomía en la Academia de Tecnología',
      requestedArea: 'Academia de Tecnología',
      alternativeCodes: ['autocad', 'excel', 'redes'],
    });
  });

  it('returns ambiguous when two courses are mentioned without a selection', () => {
    expect(
      resolveCatalogRequest(
        '¿Marketing Digital o Community Manager?',
        snapshot([MARKETING, COMMUNITY]),
      ),
    ).toEqual({
      kind: 'ambiguous',
      requestedText: '¿Marketing Digital o Community Manager?',
      candidateCodes: ['community_manager', 'marketing_digital'],
      clarification: 'choose_offering',
    });
  });

  it('honors an unequivocal selection from the latest message in a batch', () => {
    expect(
      resolveCatalogRequest(
        ['¿Marketing Digital o Community Manager?', 'Prefiero Community Manager.'],
        snapshot([MARKETING, COMMUNITY]),
      ),
    ).toMatchObject({
      kind: 'exact',
      offeringCode: 'community_manager',
      displayName: 'Community Manager',
      match: 'canonical',
    });
  });

  it('does not select a canonically named course that the customer negated', () => {
    expect(resolveCatalogRequest('No quiero Marketing Digital', snapshot([MARKETING]))).toEqual({
      kind: 'no_catalog_intent',
    });
  });

  it('lets a latest batch correction cancel an earlier exact selection', () => {
    expect(
      resolveCatalogRequest(
        ['Quiero Marketing Digital', 'No mejor no'],
        snapshot([MARKETING]),
      ),
    ).toEqual({ kind: 'no_catalog_intent' });
  });

  it('marks a generic course switch as a history boundary instead of a neutral follow-up', () => {
    const message = 'Cambiemos de curso.';

    expect(resolveCatalogRequest(message, snapshot([MARKETING]))).toEqual({
      kind: 'no_catalog_intent',
    });
    expect(isCatalogRequestNeutral(message)).toBe(false);
  });

  it('keeps a colliding structural alias ambiguous', () => {
    const first = offering('fotografia_movil', 'Fotografía Móvil', 'Academia Creativa', [
      'Fotos con celular',
    ]);
    const second = offering('foto_smartphone', 'Fotografía con Smartphone', 'Academia Creativa', [
      'Fotos con celular',
    ]);

    expect(resolveCatalogRequest('Curso de fotos con celular', snapshot([first, second]))).toEqual({
      kind: 'ambiguous',
      requestedText: 'Curso de fotos con celular',
      candidateCodes: ['foto_smartphone', 'fotografia_movil'],
      clarification: 'choose_offering',
    });
  });

  it('asks to choose an area when the same canonical name exists in multiple academies', () => {
    const north = offering('ingles_norte', 'Inglés Inicial', 'Academia Norte');
    const south = offering('ingles_sur', 'Inglés Inicial', 'Academia Sur');

    expect(resolveCatalogRequest('Quiero Inglés Inicial', snapshot([south, north]))).toEqual({
      kind: 'ambiguous',
      requestedText: 'Quiero Inglés Inicial',
      candidateCodes: ['ingles_norte', 'ingles_sur'],
      clarification: 'choose_area',
    });
  });

  it('uses an explicitly named academy to resolve one homonymous course', () => {
    const north = offering('ingles_norte', 'Inglés Inicial', 'Academia Norte');
    const south = offering('ingles_sur', 'Inglés Inicial', 'Academia Sur');

    expect(
      resolveCatalogRequest(
        'Quiero Inglés Inicial en Academia Norte',
        snapshot([south, north]),
      ),
    ).toEqual({
      kind: 'exact',
      offeringCode: 'ingles_norte',
      displayName: 'Inglés Inicial',
      academy: 'Academia Norte',
      match: 'canonical',
    });
  });

  it('rejects snapshot codes that collide after normalization', () => {
    expect(
      resolveCatalogRequest(
        'Quiero un curso',
        snapshot([
          offering('x-1', 'Ventas Inicial', 'Ventas'),
          offering('x_1', 'Ventas Avanzadas', 'Ventas'),
        ]),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'snapshot_invalid' });
  });

  it('rejects aliases that normalize to an empty value', () => {
    expect(
      resolveCatalogRequest(
        'Quiero un curso',
        snapshot([offering('ventas', 'Ventas', 'Ventas', ['   '])]),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'snapshot_invalid' });
  });

  it('rejects an alias that impersonates another offering canonical identity', () => {
    expect(
      resolveCatalogRequest(
        'Quiero un curso',
        snapshot([
          offering('ventas', 'Ventas', 'Negocios', ['Community Manager']),
          offering('community', 'Community Manager', 'Marketing'),
        ]),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'snapshot_invalid' });
  });

  it('does not claim that a typo is unique when the snapshot is truncated', () => {
    expect(
      resolveCatalogRequest(
        'Quiero reparacion de celulare',
        snapshot([CELLPHONES, MARKETING], 1),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'snapshot_truncated' });
  });

  it('does not claim an exact course identity from a truncated snapshot', () => {
    expect(
      resolveCatalogRequest(
        'Quiero Marketing Digital',
        snapshot([MARKETING, COMMUNITY], 1),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'snapshot_truncated' });
  });
});
