export const AGENT_LOOP_MODES_V3 = ['off', 'shadow', 'authoritative'] as const;

export type AgentLoopModeV3 = typeof AGENT_LOOP_MODES_V3[number];

export interface RolloutRowV3 {
  readonly contact_id: string | null;
  /** Untrusted at this boundary so invalid database values can fail closed. */
  readonly mode: unknown;
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
  const contactRow = rows.find((row) => row.contact_id === contactId);
  if (contactRow) {
    return isAgentLoopModeV3(contactRow.mode) ? contactRow.mode : 'off';
  }

  const workspaceRow = rows.find((row) => row.contact_id === null);
  return workspaceRow && isAgentLoopModeV3(workspaceRow.mode) ? workspaceRow.mode : 'off';
}
