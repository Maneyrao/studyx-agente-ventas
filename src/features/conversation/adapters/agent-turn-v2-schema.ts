import { z } from 'zod';
import { AgentATurnProposalV1Schema } from './agent-a-brain-schema';

/**
 * Plannerless wire contract. The model owns meaning and customer-facing copy;
 * the backend receives the complete proposal and independently authorizes its
 * facts, state transition and side effect inside the commit transaction.
 */
export const AgentATurnCommitV2Schema = z.object({
  schema_version: z.literal(2),
  proposal: AgentATurnProposalV1Schema,
}).strict();

export type ParsedAgentATurnCommitV2 = z.infer<typeof AgentATurnCommitV2Schema>;
