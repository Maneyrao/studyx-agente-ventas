import { describe, expect, it } from 'vitest';
import {
  buildAuthorizedEgress,
  verifyAuthorizedEgress,
} from '@/features/orchestration/domain/egress-guard';
import {
  materializeCanonicalCatalogFacts,
  materializeCanonicalOfferingFacts,
} from '@/features/orchestration/domain/canonical-offering-egress';

describe('authorized egress manifest', () => {
  it('keeps its content hash stable when authorization lists arrive in a different order', () => {
    const left = buildAuthorizedEgress({
      content: 'Modalidad online. Precio: USD 360. https://buy.stripe.com/canonical',
      authorized_urls: [
        'https://studyx.example/courses',
        'https://buy.stripe.com/canonical',
      ],
      protected_facts: [
        { kind: 'price', value: 'USD 360' },
        { kind: 'modality', value: 'online' },
      ],
    });
    const right = buildAuthorizedEgress({
      content: 'Modalidad online. Precio: USD 360. https://buy.stripe.com/canonical',
      authorized_urls: [
        'https://buy.stripe.com/canonical',
        'https://studyx.example/courses',
      ],
      protected_facts: [
        { kind: 'modality', value: 'online' },
        { kind: 'price', value: 'USD 360' },
      ],
    });

    expect(left).toEqual(right);
    expect(left.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes its content hash when the exact outbound content changes', () => {
    const first = buildAuthorizedEgress({
      content: 'Hola',
      authorized_urls: [],
      protected_facts: [],
    });
    const second = buildAuthorizedEgress({
      content: 'Hola!',
      authorized_urls: [],
      protected_facts: [],
    });

    expect(first.content_hash).not.toBe(second.content_hash);
  });

  it('rejects replaying a valid manifest with different outbound content', () => {
    const manifest = buildAuthorizedEgress({
      content: 'Contenido autorizado',
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content: 'Contenido cambiado', manifest })).toEqual({
      ok: false,
      reason: 'HASH_MISMATCH',
    });
  });

  it.each([
    ['a look-alike hostname', 'https://buy.stripe.com.evil.example/pay?plan=one#checkout'],
    ['a different fragment', 'https://buy.stripe.com/pay?plan=one#other'],
  ])('rejects %s instead of normalizing it to an authorized URL', (_case, candidate) => {
    const manifest = buildAuthorizedEgress({
      content: `Pagá acá: ${candidate}`,
      authorized_urls: ['https://buy.stripe.com/pay?plan=one#checkout'],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content: `Pagá acá: ${candidate}`, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_URL',
      unauthorized_urls: [candidate],
    });
  });

  it('allows the exact authorized URL when WhatsApp punctuation surrounds it', () => {
    const content = 'Podés pagar acá 👉 (https://buy.stripe.com/pay?plan=one#checkout).';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: ['https://buy.stripe.com/pay?plan=one#checkout'],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it('rejects the whole send when any of multiple URLs is unauthorized', () => {
    const content = [
      'Curso: https://studyx.example/course,',
      'pago alternativo: https://paypa1.example/phish.',
    ].join(' ');
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: ['https://studyx.example/course'],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_URL',
      unauthorized_urls: ['https://paypa1.example/phish'],
    });
  });

  it.each([
    'ftp://files.attacker.example/catalog',
    'www.attacker.example/catalog',
  ])('fails closed on a non-HTTP URL-like egress: %s', (candidate) => {
    const content = `Descarga: ${candidate}`;
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_URL',
      unauthorized_urls: [candidate],
    });
  });

  it.each([
    'evil.example/pay',
    'attacker.com/pago?plan=one#checkout',
    'xn--e1afmkfd.xn--p1ai/pay',
    'пример.рф/оплата',
  ])('fails closed on a bare autolinkable hostname: %s', (candidate) => {
    const content = `Pagá acá: ${candidate}`;
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_URL',
      unauthorized_urls: [candidate],
    });
  });

  it('does not treat an email address as a separately authorizable bare URL', () => {
    const content = 'Escribinos a soporte@studyx.com para que te ayudemos.';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it('allows content with zero URLs when the manifest authorizes none', () => {
    const content = 'Perfecto, te cuento las opciones.';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it('does not confuse the required "asesora virtual" identity with course modality', () => {
    const content = '¿Querés que nuestra asesora virtual te llame ahora?';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it('allows a numeric price only when that exact commercial fact is authorized', () => {
    const content = 'El precio total es USD 360.';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [{ kind: 'price', value: 'USD 360' }],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it('rejects a different numeric price even when another price was authorized', () => {
    const content = 'El precio total es USD 390.';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [{ kind: 'price', value: 'USD 360' }],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
      unauthorized_facts: [{ kind: 'price', value: 'usd 390' }],
    });
  });

  it('rejects a numeric amount introduced as a price even without a currency token', () => {
    const content = 'El precio es 390.';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [{ kind: 'price', value: 'USD 360' }],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
      unauthorized_facts: [{ kind: 'price', value: 'precio es 390' }],
    });
  });

  it.each([
    ['price', 'No cuesta USD 360.', 'USD 360', 'no cuesta usd 360'],
    ['duration', 'No dura 6 meses.', '6 meses', 'no dura 6 meses'],
    ['modality', 'No es online.', 'online', 'no es online'],
  ] as const)(
    'does not let an authorized %s fragment authorize a bounded negation of that fact',
    (kind, content, authorizedValue, observedValue) => {
      const manifest = buildAuthorizedEgress({
        content,
        authorized_urls: [],
        protected_facts: [{ kind, value: authorizedValue }],
      });

      expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
        ok: false,
        reason: 'UNAUTHORIZED_PROTECTED_FACT',
        unauthorized_facts: [{ kind, value: observedValue }],
      });
    }
  );

  it.each([
    ['duration', 'La cursada dura 8 meses.', '8 meses'],
    ['modality', 'La modalidad es presencial.', 'presencial'],
    ['certification', 'Incluye certificado.', 'incluye certificado'],
  ] as const)('rejects an unauthorized %s fact', (kind, content, value) => {
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
      unauthorized_facts: [{ kind, value }],
    });
  });

  it.each([
    ['Sí, ofrecemos Programación en Python.', 'offering', 'sí, ofrecemos programación en python'],
    ['La salida laboral está garantizada.', 'promise', 'la salida laboral está garantizada'],
    ['Hay una beca para vos.', 'promise', 'hay una beca para vos'],
    ['Si no te gusta, te devolvemos la plata.', 'promise', 'te devolvemos la plata'],
  ] as const)('blocks an unsupported availability/promise claim: %s', (content, kind, value) => {
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
      unauthorized_facts: [{ kind, value }],
    });
  });

  it.each([
    'StudyX tiene Programación en Python.',
    'StudyX brinda Programación en Python.',
    'Podés estudiar Programación en Python con nosotros.',
    'El curso Programación en Python está disponible.',
    'Sí, hay un curso de Programación en Python.',
    'Damos Programación en Python.',
    'Podemos inscribirte en Programación en Python.',
    'Te recomiendo nuestro curso Programación en Python.',
  ])('blocks an unsupported course-availability paraphrase: %s', (content) => {
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });
    expect(verifyAuthorizedEgress({ content, manifest })).toMatchObject({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
    });
  });

  it('authorizes a deterministic catalog list only when every named offering exists', () => {
    const offerings = [
      { code: 'marketing', display_name: 'Marketing Digital' },
      { code: 'community', display_name: 'Community Manager' },
    ];
    const valid = 'En Marketing tenemos Marketing Digital, Community Manager. ¿Cuál querés revisar?';
    const mixed = 'Tenemos Marketing Digital y Programación en Python.';

    expect(materializeCanonicalCatalogFacts({ content: valid, offerings })).toEqual([{
      kind: 'offering',
      value: 'tenemos marketing digital, community manager',
    }]);
    expect(materializeCanonicalCatalogFacts({ content: mixed, offerings })).toEqual([]);
  });

  it.each([
    'Vas a conseguir trabajo seguro.',
    'Te aseguramos empleo.',
    '100% de empleabilidad.',
    'Resultados asegurados.',
    'Te reembolsamos.',
    'Devolución garantizada.',
    'Tenés 20% de descuento.',
    'La beca te sale más barato.',
    'Salís trabajando seguro.',
  ])('blocks a promise/discount paraphrase not backed by typed policy: %s', (content) => {
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });
    expect(verifyAuthorizedEgress({ content, manifest })).toMatchObject({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
    });
  });

  it.each([
    ['price', 'Cuesta trescientos sesenta dólares.', 'cuesta trescientos sesenta dólares'],
    ['duration', 'La cursada dura doce meses.', 'doce meses'],
    ['duration', 'Son veinte clases.', 'veinte clases'],
    ['modality', 'La modalidad es remota.', 'remota'],
    ['modality', 'La cursada es asincrónica y a tu ritmo.', 'asincrónica'],
  ] as const)(
    'blocks a free-form %s synonym/number-word instead of treating it as unprotected',
    (kind, content, value) => {
      const manifest = buildAuthorizedEgress({
        content,
        authorized_urls: [],
        protected_facts: [],
      });

      const verification = verifyAuthorizedEgress({ content, manifest });
      expect(verification).toMatchObject({
        ok: false,
        reason: 'UNAUTHORIZED_PROTECTED_FACT',
      });
      if (verification.ok || verification.reason !== 'UNAUTHORIZED_PROTECTED_FACT') {
        throw new Error('EXPECTED_UNAUTHORIZED_PROTECTED_FACT');
      }
      expect(verification.unauthorized_facts).toContainEqual({ kind, value });
    },
  );

  it('allows explicit duration, modality and certification facts', () => {
    const content = 'La cursada dura 6 meses, es online e incluye certificado.';
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [
        { kind: 'duration', value: '6 meses' },
        { kind: 'modality', value: 'online' },
        { kind: 'certification', value: 'incluye certificado' },
      ],
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it('keeps an authorized unknown certification statement distinct from a positive claim', () => {
    const unknownContent = 'La certificación no está especificada.';
    const unknownManifest = buildAuthorizedEgress({
      content: unknownContent,
      authorized_urls: [],
      protected_facts: [{
        kind: 'certification',
        value: 'la certificación no está especificada',
      }],
    });
    expect(verifyAuthorizedEgress({ content: unknownContent, manifest: unknownManifest }))
      .toEqual({ ok: true });

    const positiveContent = 'Incluye certificado.';
    const positiveManifest = buildAuthorizedEgress({
      content: positiveContent,
      authorized_urls: [],
      protected_facts: [{
        kind: 'certification',
        value: 'la certificación no está especificada',
      }],
    });
    expect(verifyAuthorizedEgress({ content: positiveContent, manifest: positiveManifest }))
      .toEqual({
        ok: false,
        reason: 'UNAUTHORIZED_PROTECTED_FACT',
        unauthorized_facts: [{ kind: 'certification', value: 'incluye certificado' }],
      });
  });

  it('materializes a closed unknown-certification statement when the catalog value is null', () => {
    const content = 'La certificación no está especificada en la información disponible.';
    const protectedFacts = materializeCanonicalOfferingFacts({
      content,
      offering: {
        price_type: 'fixed',
        price_amount: '360.00',
        currency: 'USD',
        delivery: { classes: 16, modality: 'online', certification: null },
      },
    });
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: protectedFacts,
    });

    expect(protectedFacts).toEqual([{
      kind: 'certification',
      value: 'la certificación no está especificada',
    }]);
    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it.each([
    'El certificado es oficial y homologado.',
    'El certificado tiene validez internacional.',
    'El certificado no es válido.',
  ])('does not extend certificate existence into an unsupported claim: %s', (content) => {
    expect(materializeCanonicalOfferingFacts({
      content,
      offering: {
        price_type: 'fixed',
        price_amount: '360.00',
        currency: 'USD',
        delivery: { certification: true },
      },
    })).toEqual([]);
  });

  it.each([
    'Cuesta menos de USD 360.',
    'Cuesta desde USD 360.',
    'Son USD 360 por mes.',
    'Hay un descuento de USD 360.',
    'Incluye 16 clases adicionales.',
  ])('does not authorize a canonical fragment inside a different commercial claim: %s', (content) => {
    expect(materializeCanonicalOfferingFacts({
      content,
      offering: {
        price_type: 'fixed',
        price_amount: '360.00',
        currency: 'USD',
        delivery: { classes: 16 },
      },
    })).toEqual([]);
  });

  it.each([
    ['El precio del curso es USD 360.', { kind: 'price', value: 'usd 360' }],
    ['El curso tiene 16 clases.', { kind: 'duration', value: '16 clases' }],
    ['La modalidad es online.', { kind: 'modality', value: 'online' }],
    ['Incluye certificado.', { kind: 'certification', value: 'incluye certificado' }],
  ] as const)('still materializes the closed canonical assertion: %s', (content, expected) => {
    expect(materializeCanonicalOfferingFacts({
      content,
      offering: {
        price_type: 'fixed',
        price_amount: '360.00',
        currency: 'USD',
        delivery: { classes: 16, modality: 'online', certification: true },
      },
    })).toContainEqual(expected);
  });

  it('authorizes the exact deterministic course-discovery response without treating class count as an offering claim', () => {
    const content = [
      'Te cuento sobre Redes Informáticas.',
      'El curso de Redes Informáticas tiene 16 clases.',
      'La modalidad de Redes Informáticas es online.',
      'Si querés, podemos coordinar una llamada ahora con nuestra asesora virtual; si preferís, seguimos por chat.',
      '¿Cómo querés avanzar?',
    ].join(' ');
    const offerings = [{ code: 'redes_informaticas', display_name: 'Redes Informáticas' }];
    const protectedFacts = [
      ...materializeCanonicalCatalogFacts({ content, offerings }),
      ...materializeCanonicalOfferingFacts({
        content,
        offering: {
          price_type: 'fixed',
          price_amount: '360.00',
          currency: 'USD',
          delivery: { classes: 16, modality: 'online' },
        },
      }),
    ];
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: protectedFacts,
    });

    expect(verifyAuthorizedEgress({ content, manifest })).toEqual({ ok: true });
  });

  it.each([
    ['a null value', null],
    ['an unknown schema version', {
      schema_version: 2,
      content_hash: '0'.repeat(64),
      authorized_urls: [],
      protected_facts: [],
    }],
  ])('fails closed for %s instead of trusting a malformed manifest', (_case, manifest) => {
    expect(verifyAuthorizedEgress({ content: 'Hola', manifest: manifest as never })).toEqual({
      ok: false,
      reason: 'INVALID_MANIFEST',
    });
  });

  it('rejects a manifest whose content hash was corrupted', () => {
    const manifest = buildAuthorizedEgress({
      content: 'Hola',
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({
      content: 'Hola',
      manifest: { ...manifest, content_hash: '0'.repeat(64) },
    })).toEqual({ ok: false, reason: 'HASH_MISMATCH' });
  });

  it('binds the authorization fields into the hash so they cannot be changed in place', () => {
    const manifest = buildAuthorizedEgress({
      content: 'Sin links',
      authorized_urls: [],
      protected_facts: [],
    });

    expect(verifyAuthorizedEgress({
      content: 'Sin links',
      manifest: {
        ...manifest,
        authorized_urls: ['https://attacker.example/newly-authorized'],
      },
    })).toEqual({ ok: false, reason: 'HASH_MISMATCH' });
  });
});
