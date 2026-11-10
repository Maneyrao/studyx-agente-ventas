export type AgentAAttemptFailureStageV1 =
  | 'provider_transport'
  | 'provider_rejected'
  | 'schema'
  | 'policy'
  | 'backend_rejected'
  | 'backend_transport'
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
  // These originate after generation, at the persistence/action boundary.
  if (code === 'DECISION_REJECTED' || code === 'PROFILE_UPDATE_REJECTED') {
    return { stage: 'backend_rejected', code, retryable: false }
  }
  if (code.startsWith('STUDYX_')) {
    return { stage: 'backend_transport', code, retryable: false }
  }
  if (
    code === 'BRAIN_DEEPSEEK_TIMEOUT'
    || code === 'BRAIN_DEEPSEEK_NETWORK_ERROR'
    || /^BRAIN_DEEPSEEK_HTTP_5\d\d$/u.test(code)
    || code === 'BRAIN_TIMEOUT'
    || code === 'BRAIN_NETWORK_ERROR'
    || /^BRAIN_HTTP_5\d\d$/u.test(code)
  ) {
    return { stage: 'provider_transport', code, retryable: true }
  }
  if (
    code === 'BRAIN_DEEPSEEK_RATE_LIMITED'
    || /^BRAIN_DEEPSEEK_HTTP_\d{3}$/u.test(code)
    || code === 'BRAIN_RATE_LIMITED'
    || /^BRAIN_HTTP_\d{3}$/u.test(code)
  ) {
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

/** Pause before the single provider retry (CLAUDE.md: retry with backoff). A
 * fast 5xx usually clears within seconds; a timeout already waited its deadline. */
export const AGENT_A_PROVIDER_RETRY_BACKOFF_MS = 2_500

export async function runAgentADeepSeekAttemptV1<T>(input: {
  readonly generate: () => Promise<T>
  readonly onRetry: (failure: AgentAAttemptFailureV1) => void
  readonly wait?: (ms: number) => Promise<void>
}): Promise<{ value: T; attempts: 1 | 2 }> {
  try {
    return { value: await input.generate(), attempts: 1 }
  } catch (firstError) {
    const failure = classifyAgentAAttemptFailure(firstError)
    if (!failure.retryable) throw firstError
    input.onRetry(failure)
    if (failure.code !== 'BRAIN_DEEPSEEK_TIMEOUT' && failure.code !== 'BRAIN_TIMEOUT') {
      await (input.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(
        AGENT_A_PROVIDER_RETRY_BACKOFF_MS)
    }
    return { value: await input.generate(), attempts: 2 }
  }
}

/** Only an actual model-provider boundary failure can justify its outage notice. */
export function isAgentAProviderFailure(failure: AgentAAttemptFailureV1): boolean {
  return failure.stage === 'provider_transport' || failure.stage === 'provider_rejected'
}
