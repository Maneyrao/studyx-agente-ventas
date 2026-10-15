import { StudyxHttpError } from '../../utils/http'

export type DeliveryReportStep = {
  <T>(name: string, run: () => Promise<T>, options?: { maxAttempts?: number }): Promise<T>
  sleep(name: string, ms: number): Promise<void>
}

export type PendingDeliveryReport = {
  code: string
  retryable: boolean
  attempt: number
  delayMs: number
}

/** Persist a known submission, never repeat the provider operation that created it. */
export async function persistDeliveryReportDurably<T>(input: {
  name: string
  step: DeliveryReportStep
  workflow: { setTimeout(options: { in: string }): Promise<void> }
  report: () => Promise<T>
  onPending: (failure: PendingDeliveryReport) => void
  onRecovered?: () => void
}): Promise<{ recovered: boolean; output: T }> {
  for (let attempt = 0; ; attempt += 1) {
    // Use versioned steps: old releases cached thrown report errors as plain
    // Error, which loses retryability. New failures are successful typed receipts.
    const receipt = await input.step(`${input.name}-durable-v1-${attempt}`, async () => {
      try {
        const output = await input.report()
        return { recorded: true as const, output }
      } catch (error) {
        // ADK suspension is a control signal, not a failed HTTP request.
        if (!(error instanceof Error)) throw error
        return { recorded: false as const,
          code: error instanceof StudyxHttpError ? error.code : 'DELIVERY_REPORT_UNCONFIRMED',
          retryable: error instanceof StudyxHttpError && error.retryable }
      }
    }, { maxAttempts: 1 })
    if (receipt.recorded) {
      input.onRecovered?.()
      return { recovered: attempt > 0, output: receipt.output }
    }

    // A broken credential/schema requires an operator, but a later repair
    // must still wake the same work. Keep it pending at a slower retry rate.
    const delayMs = receipt.retryable
      ? Math.min(300_000, 15_000 * 2 ** Math.min(attempt, 5)) : 300_000
    input.onPending({ code: receipt.code, retryable: receipt.retryable, attempt: attempt + 1, delayMs })
    // Unlike a terminal paused_error return, sleep schedules a real continuation
    // event and leaves this workflow listening. Renew the lifetime on every wait.
    await input.step(`${input.name}-keepalive-v1-${attempt}`, async () => {
      await input.workflow.setTimeout({ in: '30m' })
    }, { maxAttempts: 1 })
    await input.step.sleep(`${input.name}-durable-wait-v1-${attempt}`, delayMs)
  }
}
