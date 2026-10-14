import { z } from '@botpress/runtime';
import { AgentAProposedActionSchema, AgentATurnProposalV1Schema } from './agent-a-brain';

/** Mirror of the backend-owned plannerless commit contract. */
export const AgentATurnCommitV2Schema = z.object({
  schema_version: z.literal(2),
  proposal: AgentATurnProposalV1Schema,
  // Persist Agent A's semantic state while fencing all effect materialization.
  conversation_only: z.boolean().optional(),
  // Original model tool request survives when this reply cannot execute it.
  requested_action: AgentAProposedActionSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.requested_action !== undefined && value.conversation_only !== true) {
    ctx.addIssue({ code: 'custom', path: ['requested_action'], message: 'REQUESTED_ACTION_REQUIRES_CONVERSATION_ONLY' });
  }
});

export type AgentATurnCommitV2 = z.infer<typeof AgentATurnCommitV2Schema>;
