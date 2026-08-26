import { describe, expect, it } from 'vitest';

import { verifyAuthorizedEgressPortable } from '../../../botpress-agent/src/utils/authorized-egress';
import { buildAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';

describe('portable authorized egress verifier', () => {
  it('accepts the hand-checked SHA-256 capability for the exact content', async () => {
    await expect(verifyAuthorizedEgressPortable({
      content: 'Contenido autorizado',
      manifest: {
        schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [],
        protected_facts: [],
      },
    })).resolves.toEqual({ ok: true });
  });

  it('rejects reusing a valid manifest after the content changes', async () => {
    await expect(verifyAuthorizedEgressPortable({
      content: 'Contenido alterado',
      manifest: {
        schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [],
        protected_facts: [],
      },
    })).resolves.toEqual({ ok: false, reason: 'HASH_MISMATCH' });
  });

  it('rejects a malformed or extended manifest before hashing it', async () => {
    await expect(verifyAuthorizedEgressPortable({
      content: 'Contenido autorizado',
      manifest: {
        schema_version: 1,
        content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
        authorized_urls: [],
        protected_facts: [],
        authorize_everything: true,
      },
    })).resolves.toEqual({ ok: false, reason: 'INVALID_MANIFEST' });
  });

  it('rejects an exact URL in the content when the hash authorizes no URL capability', async () => {
    const unauthorizedUrl = 'https://attacker.example/phish';
    await expect(verifyAuthorizedEgressPortable({
      content: `Pagá acá: ${unauthorizedUrl}`,
      manifest: {
        schema_version: 1,
        content_hash: '02f4b7150b0623b3f814cfd7585249b57a180bdc4e12e0275bf3e292a525239a',
        authorized_urls: [],
        protected_facts: [],
      },
    })).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_URL',
      unauthorized_urls: [unauthorizedUrl],
    });
  });

  it('allows only the byte-exact authorized URL, including its query and fragment', async () => {
    const authorizedUrl = 'https://buy.stripe.com/pay?plan=one#checkout';
    await expect(verifyAuthorizedEgressPortable({
      content: `Pagá acá: ${authorizedUrl}`,
      manifest: {
        schema_version: 1,
        content_hash: 'bb07afed6757844ab00b96ae9bbafebe8bcb44b189ab1525e5b1d0326d4338ab',
        authorized_urls: [authorizedUrl],
        protected_facts: [],
      },
    })).resolves.toEqual({ ok: true });
  });

  it.each([
    'evil.example/pay',
    'attacker.com/pago?plan=one#checkout',
    'xn--e1afmkfd.xn--p1ai/pay',
    'пример.рф/оплата',
  ])('rejects a hash-valid bare hostname before physical send: %s', async (candidate) => {
    const content = `Pagá acá: ${candidate}`;
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    await expect(verifyAuthorizedEgressPortable({ content, manifest })).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHORIZED_URL',
      unauthorized_urls: [candidate],
    });
  });

  it.each([
    'Cuesta trescientos sesenta dólares.',
    'La cursada dura doce meses.',
    'Son veinte clases.',
    'La modalidad es remota.',
    'La cursada es asincrónica y a tu ritmo.',
  ])('rejects a hash-valid unstructured protected claim before physical send: %s', async (content) => {
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    await expect(verifyAuthorizedEgressPortable({ content, manifest })).resolves.toMatchObject({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
    });
  });

  it.each([
    'Sí, ofrecemos Programación en Python.',
    'La salida laboral está garantizada.',
    'Hay una beca para vos.',
    'Si no te gusta, te devolvemos la plata.',
  ])('rejects a hash-valid unsupported offering or promise before physical send: %s', async (content) => {
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [],
    });

    await expect(verifyAuthorizedEgressPortable({ content, manifest })).resolves.toMatchObject({
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
    });
  });

  it('accepts the backend-authorized deterministic course-discovery copy', async () => {
    const content = [
      'Te cuento sobre Marketing Digital.',
      'El curso de Marketing Digital tiene 16 clases.',
      'La modalidad de Marketing Digital es online.',
      'Si querés, podemos coordinar una llamada ahora con nuestra asesora virtual; si preferís, seguimos por chat.',
      '¿Cómo querés avanzar?',
    ].join(' ');
    const manifest = buildAuthorizedEgress({
      content,
      authorized_urls: [],
      protected_facts: [
        { kind: 'duration', value: '16 clases' },
        { kind: 'modality', value: 'online' },
      ],
    });

    await expect(verifyAuthorizedEgressPortable({ content, manifest })).resolves.toEqual({ ok: true });
  });
});
