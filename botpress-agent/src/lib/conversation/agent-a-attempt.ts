export type AgentAAttemptFailureStageV1 =
  | 'provider_transport'
  | 'provider_rejected'
  | 'schema'
  | 'policy'
  | 'unknown'

export interface AgentAAttemptFailureV1 {
  readonly stage: AgentAAttemptFailureStageV1
  readonly code: string
  readonly retryable: boolean
}

function stableFailureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.trim().length > 0) return code.slice(0, 256)
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 256)
  }
  return 'UNKNOWN_ERROR'
}

export function classifyAgentAAttemptFailure(error: unknown): AgentAAttemptFailureV1 {
  const code = stableFailureCode(error)
  if (
    code === 'BRAIN_DEEPSEEK_TIMEOUT'
    || code === 'BRAIN_DEEPSEEK_NETWORK_ERROR'
    || /^BRAIN_DEEPSEEK_HTTP_5\d\d$/u.test(code)
  ) {
    return { stage: 'provider_transport', code, retryable: true }
  }
  if (/^BRAIN_DEEPSEEK_HTTP_\d{3}$/u.test(code)) {
    return { stage: 'provider_rejected', code, retryable: false }
  }
  if (code === 'BRAIN_INVALID_SCHEMA' || code.startsWith('PROPOSAL_SCHEMA_INVALID')) {
    return { stage: 'schema', code, retryable: false }
  }
  if (code.startsWith('PLANNERLESS_PROPOSAL_REJECTED:')) {
    return { stage: 'policy', code, retryable: false }
  }
  return { stage: 'unknown', code, retryable: false }
}

export async function runAgentADeepSeekAttemptV1<T>(input: {
  readonly generate: () => Promise<T>
  readonly onRetry: (failure: AgentAAttemptFailureV1) => void
}): Promise<{ value: T; attempts: 1 | 2 }> {
  try {
    return { value: await input.generate(), attempts: 1 }
  } catch (firstError) {
    const failure = classifyAgentAAttemptFailure(firstError)
    if (!failure.retryable) throw firstError
    input.onRetry(failure)
    return { value: await input.generate(), attempts: 2 }
  }
}
