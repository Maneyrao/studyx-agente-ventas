import { describe, expect, it } from 'vitest';

/**
 * The canonical payment link action (spec §3–§4 of
 * docs/contracts/agent-a-operational-mvp.md): exactly three owner-approved
 * Stripe plans, resolved only from environment, offered only after an
 * explicit plan choice in the CURRENT batch, and never authored by the
 * model. These tests cover the three layers end to end:
 *   - payment-choice-policy: deterministic, batch-only plan derivation.
 *   - config-payment-link.resolver: env-only resolution, fail closed.
 *   - materialize-payment-link-action: the single application seam that
 *     revalidates everything before a link may ever reach the customer.
 */
import {
  PAYMENT_PLAN_PRESENTATIONS,
  isPaymentPlanCode,
  isStripePaymentLinkUrl,
  stripUnauthorizedUrls,
} from '../../../src/features/payments/domain/payment-link';
import { derivePaymentChoiceFromBatch } from '../../../src/features/payments/domain/payment-choice-policy';
import { createConfigPaymentLinkResolver } from '../../../src/features/payments/adapters/config-payment-link.resolver';
import {
  materializePaymentLinkAction,
  type SendPaymentLinkAction,
} from '../../../src/features/payments/application/materialize-payment-link-action';

const LINK_12M = 'https://buy.stripe.com/studyx-12m';
const LINK_6M = 'https://buy.stripe.com/studyx-6m';
const LINK_CONTADO = 'https://buy.stripe.com/studyx-contado';

const FULL_ENV = {
  PAYMENT_LINK_12M: LINK_12M,
  PAYMENT_LINK_6M: LINK_6M,
  PAYMENT_LINK_CONTADO: LINK_CONTADO,
};

function msg(content: string) {
  return { content };
}

function allowedContact() {
  return { blocked: false, consent_status: 'allowed' as const };
}

function action(overrides: Partial<SendPaymentLinkAction> = {}): SendPaymentLinkAction {
  return { type: 'send_payment_link', plan_code: 'monthly_12', offering_sku: null, ...overrides };
}

describe('PAYMENT_PLAN_PRESENTATIONS', () => {
  it('presents exactly the three owner-approved plans from the contract', () => {
    expect(PAYMENT_PLAN_PRESENTATIONS.monthly_12).toMatchObject({
      installments: 12,
      installment_amount: '30.00',
      total_amount: '360.00',
      currency: 'USD',
    });
    expect(PAYMENT_PLAN_PRESENTATIONS.monthly_6).toMatchObject({
      installments: 6,
      installment_amount: '60.00',
      total_amount: '360.00',
      currency: 'USD',
    });
    expect(PAYMENT_PLAN_PRESENTATIONS.one_time).toMatchObject({
      installments: 1,
      installment_amount: '360.00',
      total_amount: '360.00',
      currency: 'USD',
    });
  });
});

describe('isPaymentPlanCode / isStripePaymentLinkUrl', () => {
  it('accepts only the three canonical codes', () => {
    expect(isPaymentPlanCode('monthly_12')).toBe(true);
    expect(isPaymentPlanCode('monthly_6')).toBe(true);
    expect(isPaymentPlanCode('one_time')).toBe(true);
    expect(isPaymentPlanCode('weekly')).toBe(false);
    expect(isPaymentPlanCode(null)).toBe(false);
  });

  it('accepts only https buy.stripe.com URLs', () => {
    expect(isStripePaymentLinkUrl('https://buy.stripe.com/abc')).toBe(true);
    expect(isStripePaymentLinkUrl('http://buy.stripe.com/abc')).toBe(false);
    expect(isStripePaymentLinkUrl('https://evil.example.com/abc')).toBe(false);
    expect(isStripePaymentLinkUrl('not a url')).toBe(false);
    expect(isStripePaymentLinkUrl(undefined)).toBe(false);
  });
});

describe('derivePaymentChoiceFromBatch', () => {
  it('derives monthly_12 from "12 meses" or "12 cuotas", case/accent-insensitive', () => {
    expect(derivePaymentChoiceFromBatch([msg('Quiero los 12 MESES')])).toBe('monthly_12');
    expect(derivePaymentChoiceFromBatch([msg('me sirven 12 cuótas')])).toBe('monthly_12');
  });

  it('derives monthly_6 from "6 meses" or "6 cuotas"', () => {
    expect(derivePaymentChoiceFromBatch([msg('las 6 meses porfa')])).toBe('monthly_6');
    expect(derivePaymentChoiceFromBatch([msg('6 CUOTAS esta bien')])).toBe('monthly_6');
  });

  it('derives one_time from "contado" or "pago único"', () => {
    expect(derivePaymentChoiceFromBatch([msg('prefiero contado')])).toBe('one_time');
    expect(derivePaymentChoiceFromBatch([msg('quiero el Pago Único')])).toBe('one_time');
  });

  it('returns null for an absent or generic request', () => {
    expect(derivePaymentChoiceFromBatch([msg('hola, quiero info del curso')])).toBeNull();
    expect(derivePaymentChoiceFromBatch([msg('pasame el link porfa')])).toBeNull();
    expect(derivePaymentChoiceFromBatch([])).toBeNull();
  });

  it('returns null when the batch matches two or more plans (ambiguous)', () => {
    expect(
      derivePaymentChoiceFromBatch([msg('me sirven las 12 meses o las 6 cuotas, cual me recomendás?')]),
    ).toBeNull();
  });

  it('never derives from anything outside the messages passed in (no memory, no prior turn)', () => {
    // The function only ever sees what the caller passes as "current batch" —
    // simulating a prior-turn choice by simply not including it here.
    expect(derivePaymentChoiceFromBatch([msg('dale, mandamelo')])).toBeNull();
  });
});

describe('createConfigPaymentLinkResolver', () => {
  it('resolves each of the three plans to its exact configured URL', () => {
    const resolver = createConfigPaymentLinkResolver(FULL_ENV);
    expect(resolver.resolve('monthly_12')).toBe(LINK_12M);
    expect(resolver.resolve('monthly_6')).toBe(LINK_6M);
    expect(resolver.resolve('one_time')).toBe(LINK_CONTADO);
  });

  it('fails closed to null when a URL is absent (partial config)', () => {
    const resolver = createConfigPaymentLinkResolver({ PAYMENT_LINK_12M: LINK_12M });
    expect(resolver.resolve('monthly_12')).toBe(LINK_12M);
    expect(resolver.resolve('monthly_6')).toBeNull();
    expect(resolver.resolve('one_time')).toBeNull();
  });

  it('fails closed to null when a configured value is not a valid Stripe buy-link', () => {
    const resolver = createConfigPaymentLinkResolver({
      ...FULL_ENV,
      PAYMENT_LINK_12M: 'https://not-stripe.example.com/12m',
    });
    expect(resolver.resolve('monthly_12')).toBeNull();
  });

  it('reads only the three documented env vars, nothing else', () => {
    const resolver = createConfigPaymentLinkResolver({});
    expect(resolver.resolve('monthly_12')).toBeNull();
    expect(resolver.resolve('monthly_6')).toBeNull();
    expect(resolver.resolve('one_time')).toBeNull();
  });
});

describe('stripUnauthorizedUrls', () => {
  it('keeps the canonical URL untouched and reports nothing stripped', () => {
    const text = `Perfecto, acá tenés el link: ${LINK_12M}`;
    const result = stripUnauthorizedUrls(text, LINK_12M);
    expect(result.text).toContain(LINK_12M);
    expect(result.stripped_urls).toEqual([]);
  });

  it('removes any URL that is not the canonical one and surfaces it in stripped_urls', () => {
    const rogue = 'https://evil.example.com/pay-here';
    const text = `Pagá acá: ${rogue}`;
    const sanitized = stripUnauthorizedUrls(text, LINK_12M);
    expect(sanitized.text).not.toContain(rogue);
    expect(sanitized.stripped_urls).toEqual([rogue]);
  });

  it('removes every URL when there is no canonical URL to allow, surfacing all of them', () => {
    const text = `Mirá esto: ${LINK_12M} y también ${LINK_6M}`;
    const sanitized = stripUnauthorizedUrls(text, null);
    expect(sanitized.text).not.toContain(LINK_12M);
    expect(sanitized.text).not.toContain(LINK_6M);
    expect(sanitized.stripped_urls).toEqual([LINK_12M, LINK_6M]);
  });
});

describe('materializePaymentLinkAction', () => {
  const resolver = createConfigPaymentLinkResolver(FULL_ENV);
  const businessSnapshot = { offerings: [{ code: 'studyx_course' }] };

  it('resolves the exact URL for each of the three plans on an explicit matching choice', () => {
    const cases: Array<[SendPaymentLinkAction['plan_code'], string, string]> = [
      ['monthly_12', '12 meses', LINK_12M],
      ['monthly_6', '6 cuotas', LINK_6M],
      ['one_time', 'contado', LINK_CONTADO],
    ];
    for (const [plan_code, phrase, expectedUrl] of cases) {
      const result = materializePaymentLinkAction({
        action: action({ plan_code }),
        batchMessages: [msg(`quiero pagar ${phrase}`)],
        businessSnapshot,
        contact: allowedContact(),
        modelResponseText: 'Genial, confirmamos tu plan.',
        resolver,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.block.url).toBe(expectedUrl);
        expect(result.block.label).toBe(PAYMENT_PLAN_PRESENTATIONS[plan_code].label);
        expect(result.stripped_urls).toEqual([]);
      }
    }
  });

  it('refuses on an ambiguous or absent choice — no action, must clarify', () => {
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_12' }),
      batchMessages: [msg('pasame el link porfa')],
      businessSnapshot,
      contact: allowedContact(),
      modelResponseText: null,
      resolver,
    });
    expect(result).toEqual({ ok: false, reason: 'AMBIGUOUS_OR_ABSENT_CHOICE' });
  });

  it('fails closed when the resolved URL is missing (partial config)', () => {
    const partialResolver = createConfigPaymentLinkResolver({ PAYMENT_LINK_12M: LINK_12M });
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_6' }),
      batchMessages: [msg('quiero las 6 meses')],
      businessSnapshot,
      contact: allowedContact(),
      modelResponseText: null,
      resolver: partialResolver,
    });
    expect(result).toEqual({ ok: false, reason: 'LINK_CONFIG_MISSING' });
  });

  it('refuses an invalid plan_code', () => {
    const result = materializePaymentLinkAction({
      action: { type: 'send_payment_link', plan_code: 'weekly' as SendPaymentLinkAction['plan_code'], offering_sku: null },
      batchMessages: [msg('12 meses')],
      businessSnapshot,
      contact: allowedContact(),
      modelResponseText: null,
      resolver,
    });
    expect(result).toEqual({ ok: false, reason: 'INVALID_PLAN_CODE' });
  });

  it('forbids cross-plan fallback: batch chose monthly_6 but action names monthly_12', () => {
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_12' }),
      batchMessages: [msg('quiero las 6 cuotas')],
      businessSnapshot,
      contact: allowedContact(),
      modelResponseText: null,
      resolver,
    });
    expect(result).toEqual({ ok: false, reason: 'PLAN_MISMATCH' });
  });

  it('refuses when offering_sku does not exist in the business snapshot', () => {
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_12', offering_sku: 'nonexistent-sku' }),
      batchMessages: [msg('12 meses')],
      businessSnapshot,
      contact: allowedContact(),
      modelResponseText: null,
      resolver,
    });
    expect(result).toEqual({ ok: false, reason: 'OFFERING_NOT_FOUND' });
  });

  it('succeeds with a null offering_sku (no offering-specific check required)', () => {
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_12', offering_sku: null }),
      batchMessages: [msg('12 meses')],
      businessSnapshot,
      contact: allowedContact(),
      modelResponseText: null,
      resolver,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stripped_urls).toEqual([]);
    }
  });

  it('strips a free URL the model wrote into its own response text, keeping only the canonical link, and surfaces it as an audit signal', () => {
    const rogue = 'https://not-approved.example.com/pay';
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_12' }),
      batchMessages: [msg('12 meses')],
      businessSnapshot,
      contact: allowedContact(),
      modelResponseText: `Pagá acá: ${rogue}`,
      resolver,
    });
    // The action still succeeds — spec §4's refusal list does not include a
    // rogue URL in the model's own prose — but the strip must never be
    // silent: it is an injection/jailbreak signal Task 4 needs to audit-log.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response_text).not.toContain(rogue);
      expect(result.stripped_urls).toEqual([rogue]);
    }
  });

  it('refuses when the contact is blocked', () => {
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_12' }),
      batchMessages: [msg('12 meses')],
      businessSnapshot,
      contact: { blocked: true, consent_status: 'allowed' },
      modelResponseText: null,
      resolver,
    });
    expect(result).toEqual({ ok: false, reason: 'CONTACT_BLOCKED' });
  });

  it('refuses when consent is revoked', () => {
    const result = materializePaymentLinkAction({
      action: action({ plan_code: 'monthly_12' }),
      batchMessages: [msg('12 meses')],
      businessSnapshot,
      contact: { blocked: false, consent_status: 'revoked' },
      modelResponseText: null,
      resolver,
    });
    expect(result).toEqual({ ok: false, reason: 'CONSENT_REVOKED' });
  });
});
