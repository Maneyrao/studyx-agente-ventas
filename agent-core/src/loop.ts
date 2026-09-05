import type {
  AgentTurnDecisionV3,
  ModelProvider,
  ModelTurnItemV3,
  ToolDefinitionV3,
} from './ports/model-provider';
import type { ToolExecutor } from './ports/tool-executor';

export const MAX_TOOL_ROUNDS = 2;
export const MAX_TOOL_CALLS_PER_ROUND = 4;
export const AGENT_LOOP_DEADLINE_MS = 6_500;
export const ROUND_SOFT_DEADLINE_MS = 2_600;

export type AgentLoopResultV3 =
  | { readonly outcome: 'decided'; readonly decision: AgentTurnDecisionV3; readonly rounds: number }
  | { readonly outcome: 'exhausted'; readonly reason: 'MAX_ROUNDS' | 'DEADLINE' };

export async function runAgentTurnV3(
  deps: {
    readonly model: ModelProvider;
    readonly tools: ToolExecutor;
    readonly now: () => number;
  },
  input: {
    readonly instructions: string;
    readonly conversation: readonly ModelTurnItemV3[];
    readonly toolDefinitions: readonly ToolDefinitionV3[];
  },
): Promise<AgentLoopResultV3> {
  const startedAt = deps.now();
  const conversation: ModelTurnItemV3[] = [...input.conversation];
  const spent = () => deps.now() - startedAt;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    if (round > 0 && spent() >= AGENT_LOOP_DEADLINE_MS) {
      return { outcome: 'exhausted', reason: 'DEADLINE' };
    }

    // La última vuelta y la que sigue a una primera ronda lenta exigen respuesta
    // final. No se ofrecen herramientas cuando ya no queda presupuesto para otra ronda.
    const forceFinal = round === MAX_TOOL_ROUNDS
      || (round > 0 && spent() >= ROUND_SOFT_DEADLINE_MS);
    const output = await deps.model.generate({
      instructions: input.instructions,
      conversation,
      toolDefinitions: forceFinal ? [] : input.toolDefinitions,
      force_final: forceFinal,
    });

    if (output.decision) {
      return { outcome: 'decided', decision: output.decision, rounds: round };
    }
    if (spent() >= AGENT_LOOP_DEADLINE_MS) {
      return { outcome: 'exhausted', reason: 'DEADLINE' };
    }

    const calls = (output.tool_calls ?? []).slice(0, MAX_TOOL_CALLS_PER_ROUND);
    if (calls.length === 0 || forceFinal) {
      return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
    }

    const results = await Promise.all(calls.map((call) => deps.tools.execute(call)));
    calls.forEach((call, index) => {
      // El resultado vuelve al agente TAL CUAL, éxito o fallo. El orquestador no
      // decide qué hacer con un error: eso es del agente.
      conversation.push({
        role: 'tool',
        call_id: call.call_id,
        content: JSON.stringify(results[index]),
      });
    });
  }
  return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
}
