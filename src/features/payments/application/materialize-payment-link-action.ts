import {
  PAYMENT_PLAN_PRESENTATIONS,
  PaymentLinkBlock,
  type PaymentPlanCode,
  SendPaymentLinkAction,
  isPaymentPlanCode,
  stripUnauthorizedUrls,
} from '../domain/payment-link';
import { PolicyBatchMessage, derivePaymentChoiceFromBatch } from '../domain/payment-choice-policy';
import { PaymentLinkResolver } from '../adapters/config-payment-link.resolver';

export type { SendPaymentLinkAction };

/**
 * Every refusal reason the spec requires the action to fail closed on:
 * blocked contact, revoked consent, no/ambiguous explicit choice, a
 * plan_code that does not match that choice, a missing/unknown offering,
 * or incomplete link configuration. None of these ever produce a link.
 */
export type PaymentLinkRefusalReason =
  | 'CONTACT_BLOCKED'
  | 'CONSENT_REVOKED'
  | 'INVALID_PLAN_CODE'
  | 'AMBIGUOUS_OR_ABSENT_CHOICE'
  | 'PLAN_MISMATCH'
  | 'OFFERING_REQUIRED'
  | 'OFFERING_MISMATCH'
  | 'OFFERING_NOT_FOUND'
  | 'LINK_CONFIG_MISSING';

export interface MaterializePaymentLinkContact {
  readonly blocked: boolean;
  readonly consent_status: 'allowed' | 'revoked' | 'unknown';
}

export interface MaterializePaymentLinkBusinessSnapshot {
  readonly offerings: readonly { readonly code: string }[];
}

export interface MaterializePaymentLinkInput {
  readonly action: SendPaymentLinkAction;
  /** Exact offering selected by the backend claim; never supplied by the model. */
  readonly authorizedOfferingCode: string | null;
  /** Backend-derived plan from a prior explicitly deferred selection. */
  readonly deferredPlanCode?: PaymentPlanCode | null;
  /** The CURRENT batch only — never recent_turns, summary or memory. */
  readonly batchMessages: readonly PolicyBatchMessage[];
  /** The canonical business snapshot passed in as data; never queried here. */
  readonly businessSnapshot: MaterializePaymentLinkBusinessSnapshot;
  readonly contact: MaterializePaymentLinkContact;
  /** The model's own reply text, sanitized of any free URL before use. */
  readonly modelResponseText: string | null;
  readonly resolver: PaymentLinkResolver;
}

export type MaterializePaymentLinkResult =
  | {
      readonly ok: true;
      readonly block: PaymentLinkBlock;
      readonly response_text: string;
      /**
       * Every URL the model wrote into its own response text that was not
       * the canonical resolved link, in encounter order. Empty on the common
       * path. A non-empty list is an injection/jailbreak signal — the action
       * still succeeds (spec §4's refusal list does not include this case),
       * but the caller (Task 4's commit path) MUST audit-log it; this field
       * is what makes that possible instead of the strip happening silently.
       */
      readonly stripped_urls: readonly string[];
    }
  | { readonly ok: false; readonly reason: PaymentLinkRefusalReason };

/**
 * The single seam that turns a typed `send_payment_link` action into the
 * fixed {label, url} block appended to the customer's message. Every check
 * here is a revalidation against data the backend already trusts — this
 * function never queries the database and never touches the network; the
 * business snapshot and the resolver are handed in by the caller.
 */
export function materializePaymentLinkAction(
  input: MaterializePaymentLinkInput
): MaterializePaymentLinkResult {
  const {
    action,
    authorizedOfferingCode,
    deferredPlanCode,
    batchMessages,
    businessSnapshot,
    contact,
    modelResponseText,
    resolver,
  } = input;

  if (contact.blocked) {
    return { ok: false, reason: 'CONTACT_BLOCKED' };
  }
  if (contact.consent_status !== 'allowed') {
    return { ok: false, reason: 'CONSENT_REVOKED' };
  }
  if (!isPaymentPlanCode(action.plan_code)) {
    return { ok: false, reason: 'INVALID_PLAN_CODE' };
  }

  const directPlan = derivePaymentChoiceFromBatch(batchMessages);
  const resumesDeferredPlan = directPlan === null && batchMessages.some((message) => {
    const normalized = message.content
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    return /\bahora\s+si\b.{0,48}\b(?:manda|mandame|mandamelo|envia|enviame|pasame|comparti|compartime)(?:lo|la|me)?\b/u
      .test(normalized);
  });
  const allowedPlan = directPlan ?? (resumesDeferredPlan ? deferredPlanCode ?? null : null);
  if (allowedPlan === null) {
    return { ok: false, reason: 'AMBIGUOUS_OR_ABSENT_CHOICE' };
  }
  // The model can never authorize its own plan: it must match the
  // deterministic derivation from the current batch, never a different plan
  // it (or a stale memory) preferred.
  if (allowedPlan !== action.plan_code) {
    return { ok: false, reason: 'PLAN_MISMATCH' };
  }

  if (action.offering_sku === null) {
    return { ok: false, reason: 'OFFERING_REQUIRED' };
  }
  if (authorizedOfferingCode === null || action.offering_sku !== authorizedOfferingCode) {
    return { ok: false, reason: 'OFFERING_MISMATCH' };
  }
  const offeringExists = businessSnapshot.offerings.some(
    (offering) => offering.code === action.offering_sku
  );
  if (!offeringExists) {
    return { ok: false, reason: 'OFFERING_NOT_FOUND' };
  }

  const url = resolver.resolve(action.plan_code);
  if (url === null) {
    return { ok: false, reason: 'LINK_CONFIG_MISSING' };
  }

  const presentation = PAYMENT_PLAN_PRESENTATIONS[action.plan_code];
  const block: PaymentLinkBlock = { label: presentation.label, url };
  const { text: response_text, stripped_urls } = stripUnauthorizedUrls(modelResponseText ?? '', url);

  return { ok: true, block, response_text, stripped_urls };
}
