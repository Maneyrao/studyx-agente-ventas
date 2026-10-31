import { z } from 'zod';
import { AgentAProposedActionSchema, AgentATurnProposalV1Schema } from './agent-a-brain-schema';

/**
 * Plannerless wire contract. The model owns meaning and customer-facing copy;
 * the backend receives the complete proposal and independently authorizes its
 * facts, state transition and side effect inside the commit transaction.
 */
export const AgentATurnCommitV2Schema = z.object({
  schema_version: z.literal(2),
  proposal: AgentATurnProposalV1Schema,
  conversation_only: z.boolean().optional(),
  /** Original model request retained as evidence under the effect fence. */
  requested_action: AgentAProposedActionSchema.optional(),
  operational_continuity: z.literal('call_consent_revoked').optional(),
}).strict().refine(value => value.requested_action === undefined || value.conversation_only === true, {
  path: ['requested_action'], message: 'REQUESTED_ACTION_REQUIRES_CONVERSATION_ONLY',
});

export type ParsedAgentATurnCommitV2 = z.infer<typeof AgentATurnCommitV2Schema>;
