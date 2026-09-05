import { narrativeViolationsV3 } from '../../../../agent-core/src/domain/response-blocks';
import type { AgentTurnDecisionV3 } from '../../../../agent-core/src/ports/model-provider';
import type {
  IntegrityRejectionV1,
  IntegrityViolationV3,
} from '../../../../agent-core/src/domain/integrity-rejection';
import { confirmsACall, solicitsACall } from './operational-promise-guard';

export type { IntegrityRejectionV1, IntegrityViolationV3 };

export type IntegrityResultV3 =
  | { readonly ok: true }
  | { readonly ok: false; readonly rejection: IntegrityRejectionV1 };

export const PREPARATION_TOOLS_V3 = [
  'prepare_payment_link',
  'prepare_call_request',
  'prepare_contact_details',
  'prepare_memory',
  'prepare_lead_projection',
] as const;

export type PreparationToolV3 = typeof PREPARATION_TOOLS_V3[number];

function isPreparationToolV3(value: unknown): value is PreparationToolV3 {
  return typeof value === 'string'
    && (PREPARATION_TOOLS_V3 as readonly string[]).includes(value);
}

/** Accepts the whole decision or returns it for repair. It never edits blocks. */
export function checkAgentTurnIntegrityV3(input: {
  readonly decision: AgentTurnDecisionV3;
  readonly context: {
    readonly state_version: number;
    readonly authorized_fact_ids: readonly string[];
    readonly open_preparations: readonly string[];
    readonly preparation_tools: Readonly<Record<string, PreparationToolV3 | undefined>>;
    readonly intake_missing: readonly string[];
    readonly call_policy: {
      readonly offer_allowed: boolean;
      readonly offer_required: boolean;
      readonly request_allowed: boolean;
    };
  };
  readonly rejection_id: string;
}): IntegrityResultV3 {
  const violations: IntegrityViolationV3[] = [];
  const authorizedFacts = new Set(input.context.authorized_fact_ids);
  const openPreparations = new Set(input.context.open_preparations);
  const committedPreparations = new Set(input.decision.commit_preparations);
  const artifactPreparations = new Set<string>();
  let narrativeOffersCall = false;
  let narrativeConfirmsCall = false;

  for (const block of input.decision.blocks) {
    if (block.type === 'narrative') {
      narrativeOffersCall ||= solicitsACall(block.text);
      narrativeConfirmsCall ||= confirmsACall(block.text);
      for (const code of narrativeViolationsV3(block.text)) {
        violations.push({ code, subject: 'narrative' });
      }
    } else if (block.type === 'fact' && !authorizedFacts.has(block.fact_id)) {
      violations.push({ code: 'FACT_NOT_AUTHORIZED', subject: block.fact_id });
    } else if (block.type === 'artifact') {
      artifactPreparations.add(block.preparation_id);
      if (!openPreparations.has(block.preparation_id)) {
        violations.push({ code: 'PREPARATION_NOT_OPEN', subject: block.preparation_id });
      } else if (!committedPreparations.has(block.preparation_id)) {
        violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: block.preparation_id });
      }
    }
  }

  if (input.decision.state_patch.expected_state_version !== input.context.state_version) {
    violations.push({
      code: 'STATE_VERSION_CONFLICT',
      subject: 'state_patch',
      detail: `expected ${input.decision.state_patch.expected_state_version}, current ${input.context.state_version}`,
    });
  }

  for (const preparationId of committedPreparations) {
    if (!openPreparations.has(preparationId)) {
      violations.push({ code: 'PREPARATION_NOT_OPEN', subject: preparationId });
    }
  }

  const authorizedPreparations: string[] = [];
  for (const preparationId of openPreparations) {
    if (!isPreparationToolV3(input.context.preparation_tools[preparationId])) {
      violations.push({ code: 'PREPARATION_TYPE_UNKNOWN', subject: preparationId });
    } else {
      authorizedPreparations.push(preparationId);
    }
  }

  const stage = input.decision.state_patch.set.stage;
  const paymentCommits = [...committedPreparations].filter((preparationId) => (
    input.context.preparation_tools[preparationId] === 'prepare_payment_link'
  ));
  const paymentArtifacts = [...artifactPreparations].filter((preparationId) => (
    input.context.preparation_tools[preparationId] === 'prepare_payment_link'
  ));
  const missingPaymentArtifacts = paymentCommits.filter((preparationId) => (
    !artifactPreparations.has(preparationId)
  ));
  for (const preparationId of missingPaymentArtifacts) {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: preparationId });
  }
  const hasCoherentPayment = paymentCommits.length > 0
    && paymentArtifacts.length === paymentCommits.length
    && missingPaymentArtifacts.length === 0;
  if (stage === 'payment_link_sent' && !hasCoherentPayment) {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: 'stage' });
  }
  const commitsPayment = paymentCommits.length > 0;
  if (commitsPayment && missingPaymentArtifacts.length === 0 && stage !== 'payment_link_sent') {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: 'commit_preparations' });
  }
  if (commitsPayment && input.context.intake_missing.length > 0) {
    violations.push({ code: 'MISSING_INTAKE', subject: 'commit_preparations' });
  }

  const patch = input.decision.state_patch.set;
  const callOfferSignals = [
    input.decision.response_type === 'call_offer',
    patch.call_offer_delta === 1,
    patch.call_offer_status === 'offered',
    patch.awaiting_reply === 'call_or_chat',
  ];
  const offersCall = callOfferSignals.every(Boolean);
  if ((callOfferSignals.some(Boolean) && !offersCall) || narrativeOffersCall !== offersCall) {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: 'call_offer' });
  }
  if ((offersCall || narrativeOffersCall) && !input.context.call_policy.offer_allowed) {
    violations.push({ code: 'CALL_OFFER_NOT_AUTHORIZED', subject: 'response_type' });
  }
  if (input.context.call_policy.offer_required && !(offersCall && narrativeOffersCall)) {
    violations.push({ code: 'CALL_OFFER_REQUIRED', subject: 'response_type' });
  }
  const callRequestCommits = [...committedPreparations].filter((preparationId) => (
    input.context.preparation_tools[preparationId] === 'prepare_call_request'
  ));
  const confirmsCall = input.decision.response_type === 'call_confirmation';
  const commitsCallRequest = callRequestCommits.length > 0;
  if ((confirmsCall || commitsCallRequest || narrativeConfirmsCall)
    && !(confirmsCall && commitsCallRequest && narrativeConfirmsCall)) {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: 'call_confirmation' });
  }
  if ((confirmsCall || commitsCallRequest || narrativeConfirmsCall)
    && !input.context.call_policy.request_allowed) {
    for (const preparationId of callRequestCommits) {
      violations.push({ code: 'CALL_REQUEST_NOT_AUTHORIZED', subject: preparationId });
    }
    if (callRequestCommits.length === 0) {
      violations.push({ code: 'CALL_REQUEST_NOT_AUTHORIZED', subject: 'response_type' });
    }
  }

  if (violations.length === 0) return { ok: true };
  return {
    ok: false,
    rejection: {
      rejection_id: input.rejection_id,
      attempt: 1,
      violations,
      authorized_alternatives: {
        fact_ids: [...input.context.authorized_fact_ids],
        preparations: authorizedPreparations,
        missing_information: [...input.context.intake_missing],
      },
    },
  };
}
