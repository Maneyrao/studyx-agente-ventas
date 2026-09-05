import type {
  AgentTurnDecisionV3,
  ModelProvider,
  ModelTurnItemV3,
  ToolDefinitionV3,
} from './ports/model-provider';
import type { ToolExecutor } from './ports/tool-executor';
import type { IntegrityRejectionV1 } from './domain/integrity-rejection';
import { sha256TextHexV1 } from './domain/sha256';

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
    /** Internal shared deadline used when one logical turn needs a repair pass. */
    readonly absolute_deadline_ms?: number;
  },
): Promise<AgentLoopResultV3> {
  const startedAt = deps.now();
  const ownDeadlineMs = startedAt + AGENT_LOOP_DEADLINE_MS;
  const deadlineMs = Math.min(input.absolute_deadline_ms ?? ownDeadlineMs, ownDeadlineMs);
  const conversation: ModelTurnItemV3[] = [...input.conversation];
  const spent = () => deps.now() - startedAt;
  const deadlineReached = () => deps.now() >= deadlineMs;
  const controller = new AbortController();
  const remainingMs = Math.max(0, deadlineMs - startedAt);
  const deadlineTimer = setTimeout(() => controller.abort(), remainingMs);

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      if (deadlineReached()) {
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

      if (output === DEADLINE_REACHED || deadlineReached()) {
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
      if (results === DEADLINE_REACHED || deadlineReached()) {
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

export type AgentTurnWithIntegrityResultV3 =
  | {
      readonly outcome: 'decided';
      readonly decision: AgentTurnDecisionV3;
      readonly repaired: boolean;
      /** Hash of the exact instruction envelope used for the accepted generation. */
      readonly prompt_sha256: string;
    }
  | {
      readonly outcome: 'fallback';
      readonly reason: 'AGENT_LOOP_INTEGRITY_FAILED';
      readonly rejection: IntegrityRejectionV1;
      readonly trace: AgentTurnIntegrityTraceV3;
      /** Hash of the last instruction envelope attempted for this turn. */
      readonly prompt_sha256: string;
    }
  | {
      readonly outcome: 'fallback';
      readonly reason: 'AGENT_LOOP_BUDGET_EXHAUSTED';
      readonly rejection: null;
      readonly trace: AgentTurnIntegrityTraceV3;
      /** Hash of the last instruction envelope attempted for this turn. */
      readonly prompt_sha256: string;
    };

export interface AgentTurnIntegrityTraceV3 {
  readonly attempt_hashes: {
    readonly first: string;
    readonly second: string | null;
  };
  readonly rejections: readonly IntegrityRejectionV1[];
  readonly tools_requested: readonly {
    readonly attempt: 1 | 2;
    readonly name: string;
    readonly call_id: string;
  }[];
  readonly tools_executed: readonly {
    readonly attempt: 1;
    readonly name: string;
    readonly call_id: string;
  }[];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function traceHash(value: unknown): string {
  return sha256TextHexV1(canonicalJson(value));
}

export function modelPromptSha256V3(input: Pick<
  Parameters<ModelProvider['generate']>[0],
  'instructions' | 'conversation' | 'toolDefinitions' | 'force_final'
>): string {
  return traceHash({
    instructions: input.instructions,
    conversation: input.conversation,
    tool_definitions: input.toolDefinitions,
    force_final: input.force_final,
  });
}

/**
 * Runs one logical turn with at most one integrity repair. Both generations
 * share the same hard deadline, and integrity feedback is an orchestrator
 * message rather than a model-callable tool.
 */
export async function runAgentTurnWithIntegrityV3(
  deps: {
    readonly model: ModelProvider;
    readonly tools: ToolExecutor;
    readonly now: () => number;
    readonly check: (
      decision: AgentTurnDecisionV3,
    ) => { readonly ok: true } | { readonly ok: false; readonly rejection: IntegrityRejectionV1 };
  },
  input: {
    readonly instructions: string;
    readonly conversation: readonly ModelTurnItemV3[];
    readonly toolDefinitions: readonly ToolDefinitionV3[];
  },
): Promise<AgentTurnWithIntegrityResultV3> {
  const absoluteDeadlineMs = deps.now() + AGENT_LOOP_DEADLINE_MS;
  const toolDefinitions = input.toolDefinitions.filter(
    (definition) => definition.name !== 'integrity_check',
  );
  const firstOutputs: unknown[] = [];
  const toolsRequested: Array<{
    attempt: 1 | 2;
    name: string;
    call_id: string;
  }> = [];
  const toolsExecuted: Array<{
    attempt: 1;
    name: string;
    call_id: string;
  }> = [];
  let firstConversation: readonly ModelTurnItemV3[] = input.conversation;
  let firstProviderFailed = false;
  let lastPromptSha256 = modelPromptSha256V3({
    instructions: input.instructions,
    conversation: input.conversation,
    toolDefinitions,
    force_final: false,
  });
  let first: AgentLoopResultV3;
  try {
    first = await runAgentTurnV3({
      ...deps,
      model: {
        generate: async (request) => {
          firstConversation = request.conversation;
          lastPromptSha256 = modelPromptSha256V3(request);
          try {
            const output = await deps.model.generate(request);
            firstOutputs.push(output);
            if ('tool_calls' in output && Array.isArray(output.tool_calls)) {
              for (const call of output.tool_calls) {
                toolsRequested.push({ attempt: 1, name: call.name, call_id: call.call_id });
              }
            }
            return output;
          } catch (error) {
            firstProviderFailed = true;
            throw error;
          }
        },
      },
      tools: {
        execute: async (call, context) => {
          toolsExecuted.push({ attempt: 1, name: call.name, call_id: call.call_id });
          return deps.tools.execute(call, context);
        },
      },
    }, {
      ...input,
      toolDefinitions,
      absolute_deadline_ms: absoluteDeadlineMs,
    });
  } catch (error) {
    if (!firstProviderFailed) throw error;
    return {
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      rejection: null,
      prompt_sha256: lastPromptSha256,
      trace: {
        attempt_hashes: { first: traceHash(firstOutputs), second: null },
        rejections: [],
        tools_requested: toolsRequested,
        tools_executed: toolsExecuted,
      },
    };
  }
  if (first.outcome === 'exhausted') {
    return {
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      rejection: null,
      prompt_sha256: lastPromptSha256,
      trace: {
        attempt_hashes: { first: traceHash(firstOutputs), second: null },
        rejections: [],
        tools_requested: toolsRequested,
        tools_executed: toolsExecuted,
      },
    };
  }

  const firstVerdict = deps.check(first.decision);
  if (firstVerdict.ok) {
    return {
      outcome: 'decided',
      decision: first.decision,
      repaired: false,
      prompt_sha256: lastPromptSha256,
    };
  }

  const repairConversation: readonly ModelTurnItemV3[] = [
    ...firstConversation,
    { role: 'assistant', content: JSON.stringify(first.decision) },
    { role: 'developer', content: JSON.stringify(firstVerdict.rejection) },
  ];
  const remainingMs = Math.max(0, absoluteDeadlineMs - deps.now());
  let repairOutput: unknown = null;
  const repairRequest = {
    instructions: input.instructions,
    conversation: repairConversation,
    toolDefinitions: [] as readonly ToolDefinitionV3[],
    force_final: true,
    deadline_ms: absoluteDeadlineMs,
  };
  const repairPromptSha256 = modelPromptSha256V3(repairRequest);
  let repairProviderFailed = false;
  if (remainingMs > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    try {
      try {
        repairOutput = await beforeDeadline(deps.model.generate({
          ...repairRequest,
          signal: controller.signal,
        }), controller.signal);
      } catch {
        repairProviderFailed = true;
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  if (isRecord(repairOutput) && Array.isArray(repairOutput.tool_calls)) {
    for (const call of repairOutput.tool_calls) {
      if (isRecord(call) && typeof call.name === 'string' && typeof call.call_id === 'string') {
        toolsRequested.push({ attempt: 2, name: call.name, call_id: call.call_id });
      }
    }
  }
  const repairDecision = isRecord(repairOutput)
    && Object.prototype.hasOwnProperty.call(repairOutput, 'decision')
    && !Object.prototype.hasOwnProperty.call(repairOutput, 'tool_calls')
    && isRecord(repairOutput.decision)
      ? repairOutput.decision as unknown as AgentTurnDecisionV3
      : null;
  const secondHash = repairOutput === null || repairOutput === DEADLINE_REACHED
    ? null
    : traceHash(repairDecision ?? repairOutput);

  if (repairProviderFailed || !repairDecision || deps.now() >= absoluteDeadlineMs) {
    return {
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection: firstVerdict.rejection,
      prompt_sha256: repairPromptSha256,
      trace: {
        attempt_hashes: { first: traceHash(first.decision), second: secondHash },
        rejections: [firstVerdict.rejection],
        tools_requested: toolsRequested,
        tools_executed: toolsExecuted,
      },
    };
  }

  const repairedVerdict = deps.check(repairDecision);
  if (repairedVerdict.ok) {
    return {
      outcome: 'decided',
      decision: repairDecision,
      repaired: true,
      prompt_sha256: repairPromptSha256,
    };
  }

  return {
    outcome: 'fallback',
    reason: 'AGENT_LOOP_INTEGRITY_FAILED',
    rejection: firstVerdict.rejection,
    prompt_sha256: repairPromptSha256,
    trace: {
      attempt_hashes: {
        first: traceHash(first.decision),
        second: traceHash(repairDecision),
      },
      rejections: [firstVerdict.rejection, repairedVerdict.rejection],
      tools_requested: toolsRequested,
      tools_executed: toolsExecuted,
    },
  };
}
