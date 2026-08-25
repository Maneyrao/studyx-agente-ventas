import type { Decision } from '../../schemas/contracts'

/**
 * Provider-agnostic input for generating a Decision directly from an LLM,
 * bypassing Botpress AI Spend. `instructions` is the fully composed prompt —
 * callers own prompt composition; a provider only executes it.
 */
export type GenerateDecisionInput = {
  instructions: string
  apiKey: string
  model: string
  signal: AbortSignal
  timeoutMs?: number
}

export type GeneratedDecision = {
  decision: Decision
  provider: 'google-ai-direct' | 'groq-direct'
  model: string
  latencyMs: number
}

/**
 * Common port every direct-LLM decision provider implements. Keeping this
 * as a standalone type (rather than only the concrete function signature)
 * lets the workflow depend on the port instead of a specific provider, so a
 * second provider can be swapped in without touching call sites.
 */
export type DecisionGenerator = (
  input: GenerateDecisionInput,
) => Promise<GeneratedDecision>
