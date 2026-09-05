import type { ResponseBlockV3 } from '../domain/response-blocks';
import type { StatePatchV3 } from '../domain/state-patch';
import type { ToolCallV3 } from './tool-executor';

export interface AgentTurnDecisionV3 {
  readonly schema_version: 3;
  readonly blocks: readonly ResponseBlockV3[];
  /** Preparaciones a commitear. Explícito: no se infiere de los bloques. */
  readonly commit_preparations: readonly string[];
  readonly used_memory_ids: readonly string[];
  readonly state_patch: StatePatchV3;
  readonly response_type: string;
}

/** Forma plana requerida por DeepSeek `/responses`; nunca el wrapper de Chat Completions. */
export interface ToolDefinitionV3 {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly function?: never;
}

export type ModelTurnItemV3 =
  | { readonly role: 'user' | 'assistant' | 'developer'; readonly content: string }
  | { readonly role: 'tool'; readonly call_id: string; readonly content: string };

export type ModelOutputV3 =
  | {
      readonly tool_calls: readonly ToolCallV3[];
      readonly decision?: never;
    }
  | {
      readonly decision: AgentTurnDecisionV3;
      readonly tool_calls?: never;
    };

export interface ModelProvider {
  generate(input: {
    readonly instructions: string;
    readonly conversation: readonly ModelTurnItemV3[];
    readonly toolDefinitions: readonly ToolDefinitionV3[];
    readonly force_final: boolean;
    /** Instante absoluto, según el reloj del turno, en que vence el cerebro. */
    readonly deadline_ms: number;
    readonly signal: AbortSignal;
  }): Promise<ModelOutputV3>;
}
