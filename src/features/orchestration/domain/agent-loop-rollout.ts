export const AGENT_LOOP_MODES_V3 = ['off', 'shadow', 'authoritative'] as const;

export type AgentLoopModeV3 = typeof AGENT_LOOP_MODES_V3[number];

export interface RolloutRowV3 {
  readonly contact_id: string | null;
  readonly mode: AgentLoopModeV3;
}

export interface AgentLoopRolloutReaderV3 {
  load(contactId: string): Promise<readonly RolloutRowV3[]>;
}

function isAgentLoopModeV3(value: unknown): value is AgentLoopModeV3 {
  return typeof value === 'string'
    && (AGENT_LOOP_MODES_V3 as readonly string[]).includes(value);
}

/** Contact override, then workspace default, then the safe disabled mode. */
export function resolveAgentLoopModeV3(
  rows: readonly RolloutRowV3[],
  contactId: string,
): AgentLoopModeV3 {
  const contactMode = rows.find((row) => row.contact_id === contactId)?.mode;
  if (isAgentLoopModeV3(contactMode)) return contactMode;

  const workspaceMode = rows.find((row) => row.contact_id === null)?.mode;
  return isAgentLoopModeV3(workspaceMode) ? workspaceMode : 'off';
}
