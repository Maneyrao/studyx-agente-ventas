import { narrativeViolationsV3 } from '../../../../agent-core/src/domain/response-blocks';
import type { AgentTurnDecisionV3 } from '../../../../agent-core/src/ports/model-provider';

export interface IntegrityViolationV3 {
  readonly code: string;
  readonly subject: string;
  readonly detail?: string;
}

export interface IntegrityRejectionV1 {
  readonly rejection_id: string;
  readonly attempt: 1;
  readonly violations: readonly IntegrityViolationV3[];
  readonly authorized_alternatives: {
    readonly fact_ids: readonly string[];
    readonly preparations: readonly string[];
    readonly missing_information: readonly string[];
  };
}

export type IntegrityResultV3 =
  | { readonly ok: true }
  | { readonly ok: false; readonly rejection: IntegrityRejectionV1 };

/** Accepts the whole decision or returns it for repair. It never edits blocks. */
export function checkAgentTurnIntegrityV3(input: {
  readonly decision: AgentTurnDecisionV3;
  readonly context: {
    readonly state_version: number;
    readonly authorized_fact_ids: readonly string[];
    readonly open_preparations: readonly string[];
    readonly preparation_tools: Readonly<Record<string, string>>;
    readonly intake_missing: readonly string[];
  };
  readonly rejection_id: string;
}): IntegrityResultV3 {
  const violations: IntegrityViolationV3[] = [];
  const authorizedFacts = new Set(input.context.authorized_fact_ids);
  const openPreparations = new Set(input.context.open_preparations);
  const committedPreparations = new Set(input.decision.commit_preparations);
  const artifactPreparations = new Set<string>();

  for (const block of input.decision.blocks) {
    if (block.type === 'narrative') {
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

  const stage = input.decision.state_patch.set.stage;
  const committedArtifact = [...artifactPreparations].some((preparationId) => (
    committedPreparations.has(preparationId)
    && input.context.preparation_tools[preparationId] === 'prepare_payment_link'
  ));
  if (stage === 'payment_link_sent' && !committedArtifact) {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: 'stage' });
  }
  const commitsPayment = [...committedPreparations].some((preparationId) => (
    input.context.preparation_tools[preparationId] === 'prepare_payment_link'
  ));
  if (commitsPayment && (!committedArtifact || stage !== 'payment_link_sent')) {
    violations.push({ code: 'STATE_ACTION_INCOHERENT', subject: 'commit_preparations' });
  }
  if (commitsPayment && input.context.intake_missing.length > 0) {
    violations.push({ code: 'MISSING_INTAKE', subject: 'commit_preparations' });
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
        preparations: [...input.context.open_preparations],
        missing_information: [...input.context.intake_missing],
      },
    },
  };
}
