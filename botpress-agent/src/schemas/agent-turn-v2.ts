import { z } from '@botpress/runtime';
import { AgentATurnProposalV1Schema } from './agent-a-brain';

/** Mirror of the backend-owned plannerless commit contract. */
export const AgentATurnCommitV2Schema = z.object({
  schema_version: z.literal(2),
  proposal: AgentATurnProposalV1Schema,
}).strict();

export type AgentATurnCommitV2 = z.infer<typeof AgentATurnCommitV2Schema>;
