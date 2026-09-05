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

const DEADLINE_REACHED = Symbol('AGENT_LOOP_DEADLINE_REACHED');

function waitForAbort(signal: AbortSignal): Promise<typeof DEADLINE_REACHED> {
  if (signal.aborted) return Promise.resolve(DEADLINE_REACHED);
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(DEADLINE_REACHED), { once: true });
  });
}

async function beforeDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof DEADLINE_REACHED> {
  return Promise.race([operation, waitForAbort(signal)]);
}

function failedToolResult(tool: string) {
  return {
    tool,
    success: false,
    canonical_data: null,
    error_code: 'TOOL_EXECUTION_FAILED',
    recoverable: true,
    idempotency_result: 'not_applicable' as const,
    preparation_id: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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
  const deadlineMs = startedAt + AGENT_LOOP_DEADLINE_MS;
  const conversation: ModelTurnItemV3[] = [...input.conversation];
  const spent = () => deps.now() - startedAt;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), AGENT_LOOP_DEADLINE_MS);

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      if (spent() >= AGENT_LOOP_DEADLINE_MS) {
        return { outcome: 'exhausted', reason: 'DEADLINE' };
      }

      // La última vuelta y la que sigue a una primera ronda lenta exigen respuesta
      // final. No se ofrecen herramientas cuando ya no queda presupuesto para otra ronda.
      const forceFinal = round === MAX_TOOL_ROUNDS
        || (round > 0 && spent() >= ROUND_SOFT_DEADLINE_MS);
      const output = await beforeDeadline(deps.model.generate({
        instructions: input.instructions,
        conversation,
        toolDefinitions: forceFinal ? [] : input.toolDefinitions,
        force_final: forceFinal,
        deadline_ms: deadlineMs,
        signal: controller.signal,
      }), controller.signal);

      if (output === DEADLINE_REACHED || spent() >= AGENT_LOOP_DEADLINE_MS) {
        return { outcome: 'exhausted', reason: 'DEADLINE' };
      }

      if (!isRecord(output)) {
        return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
      }
      const hasDecision = Object.prototype.hasOwnProperty.call(output, 'decision');
      const hasToolCalls = Object.prototype.hasOwnProperty.call(output, 'tool_calls');
      if (hasDecision === hasToolCalls) {
        return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
      }
      if (hasDecision) {
        return isRecord(output.decision)
          ? {
              outcome: 'decided',
              decision: output.decision as unknown as AgentTurnDecisionV3,
              rounds: round,
            }
          : { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
      }
      if (!Array.isArray(output.tool_calls)) {
        return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
      }

      const calls = output.tool_calls.slice(0, MAX_TOOL_CALLS_PER_ROUND);
      if (calls.length === 0 || forceFinal) {
        return { outcome: 'exhausted', reason: 'MAX_ROUNDS' };
      }

      const results = await beforeDeadline(Promise.all(calls.map(async (call) => {
        try {
          return await deps.tools.execute(call, {
            deadline_ms: deadlineMs,
            signal: controller.signal,
          });
        } catch {
          return failedToolResult(call.name);
        }
      })), controller.signal);
      if (results === DEADLINE_REACHED || spent() >= AGENT_LOOP_DEADLINE_MS) {
        return { outcome: 'exhausted', reason: 'DEADLINE' };
      }
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
  } finally {
    clearTimeout(deadlineTimer);
    controller.abort();
  }
}
