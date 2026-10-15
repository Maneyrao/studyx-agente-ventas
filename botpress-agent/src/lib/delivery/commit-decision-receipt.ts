import type { CommitDecisionResponse } from '../../schemas/contracts'
import { StudyxHttpError } from '../../utils/http'

type CommitReceiptStep = <T>(name: string, run: () => Promise<T>, options?: { maxAttempts?: number }) => Promise<T>

export function backendDecisionRejectionReason(error: unknown): string | null {
  if (!(error instanceof StudyxHttpError)
    || error.code !== 'DECISION_REJECTED'
    || error.status !== 422
    || error.payload === null
    || typeof error.payload !== 'object'
    || !('reason' in error.payload)
    || typeof error.payload.reason !== 'string') return null
  return error.payload.reason.slice(0, 512)
}

export function backendDecisionRejectionSubjects(error: unknown): readonly string[] {
  if (!(error instanceof StudyxHttpError)
    || error.code !== 'DECISION_REJECTED'
    || error.status !== 422
    || error.payload === null
    || typeof error.payload !== 'object'
    || !('subjects' in error.payload)
    || !Array.isArray(error.payload.subjects)) return []
  return error.payload.subjects.filter((subject): subject is string => (
    typeof subject === 'string'
    && subject.length <= 160
    && /^[a-z0-9_:.-]+$/iu.test(subject)
  ))
}

/** Preserve a domain rejection through ADK JSON persistence without caching an exception. */
export async function commitDecisionWithRejectionReceiptV1(input: {
  name: string
  step: CommitReceiptStep
  commit: () => Promise<CommitDecisionResponse>
}): Promise<CommitDecisionResponse> {
  const receipt = await input.step(input.name, async () => {
    try { return await input.commit() }
    catch (error) {
      if (!(error instanceof Error)) throw error
      const reason = backendDecisionRejectionReason(error)
      if (reason === null) throw error
      return { studyx_decision_rejection_v1: {
        reason, subjects: [...backendDecisionRejectionSubjects(error)].slice(0, 32),
      } }
    }
  }, { maxAttempts: 1 })
  // Successful steps from earlier releases remain raw responses. Old failed
  // steps have already lost their payload; this decoder does not invent it.
  if ('studyx_decision_rejection_v1' in receipt) {
    throw new StudyxHttpError('DECISION_REJECTED', false, 422, 1, {
      error: 'DECISION_REJECTED', ...receipt.studyx_decision_rejection_v1,
    })
  }
  return receipt
}
