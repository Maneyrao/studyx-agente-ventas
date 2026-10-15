import { Workflow, z } from '@botpress/runtime'
import { randomUUID } from 'node:crypto'
import { persistDeliveryReportDurably } from '../lib/delivery/durable-delivery-report'
import { requestStudyxJson, StudyxHttpError } from '../utils/http'

/**
 * Exercises the production report-recovery helper on the real Cloud scheduler.
 * Every send and acknowledgement below is a local fixture: this workflow has
 * no channel client, model, customer identifiers or backend mutations.
 * It proves durable suspension/replay, not physical WhatsApp delivery.
 */
export const transportRecoveryCanary = new Workflow({
  name: 'transportRecoveryCanary',
  description: 'Isolated scheduler probe for durable delivery acknowledgement recovery; no external sends.',
  input: z.object({ scenario: z.literal('ack-committed-response-lost') }) as any,
  output: z.object({
    scenario: z.literal('ack-committed-response-lost'),
    first_send_count: z.literal(1),
    continuation_count: z.literal(1),
    report_attempts: z.literal(3),
    pending_suspensions: z.literal(2),
    first_receipt_id: z.literal('fixture-part-0'),
    second_receipt_id: z.literal('fixture-part-1'),
    external_sends: z.literal(0),
    model_calls: z.literal(0),
    backend_probe_before_ms: z.number(),
    backend_probe_after_ms: z.number(),
  }) as any,
  state: z.object({
    firstSendCount: z.number().int().default(0),
    continuationCount: z.number().int().default(0),
    reportAttempts: z.number().int().default(0),
    pendingSuspensions: z.number().int().default(0),
    fixtureAcknowledged: z.boolean().default(false),
  }) as any,
  timeout: '5m',
  async handler({ input, state, step, workflow }) {
    const traceId = await step('probe-correlation', async () => randomUUID())
    const probeBackend = async () => {
      const startedAt = Date.now()
      const response = await requestStudyxJson({
        path: '/api/agent/inbound/receipts',
        traceId,
        idempotencyKey: `inbound-receipts:transport-canary:transport-canary-${traceId}`,
        body: {
          trace_id: traceId,
          integration_id: 'transport-canary',
          external_conversation_id: `transport-canary-${traceId}`,
          channel: 'emulator',
          sandbox_provider: null,
          external_message_ids: ['transport-canary-no-message'],
        },
        additionalRetries: 0,
        responseSchema: z.object({ trace_id: z.string().uuid(), persisted_message_ids: z.array(z.string()) }),
      })
      if (response.trace_id !== traceId || response.persisted_message_ids.length !== 0) {
        throw new Error('CANARY_BACKEND_RECEIPT_MISMATCH')
      }
      return Date.now() - startedAt
    }
    const beforeMs = await step('probe-backend-before', probeBackend, { maxAttempts: 1 })
    const firstReceipt = await step('fixture-submit-part-0', async () => {
      state.firstSendCount += 1
      return { id: 'fixture-part-0' as const }
    }, { maxAttempts: 1 })

    await persistDeliveryReportDurably({
      name: 'fixture-report-part-0',
      step,
      workflow,
      report: async () => {
        state.reportAttempts += 1
        // Simulate a committed acknowledgement whose HTTP response was lost.
        // Re-reporting converges on this same receipt; it never submits again.
        state.fixtureAcknowledged = true
        if (state.reportAttempts <= 2) {
          throw new StudyxHttpError('STUDYX_TIMEOUT', true, null, 1)
        }
        return { status: 'duplicate', receipt_id: firstReceipt.id }
      },
      onPending: ({ attempt }) => {
        // Called again during durable replay; preserve the count of distinct
        // failed report operations rather than counting handler executions.
        state.pendingSuspensions = Math.max(state.pendingSuspensions, attempt)
      },
    })

    const secondReceipt = await step('fixture-submit-part-1', async () => {
      if (!state.fixtureAcknowledged) throw new Error('CANARY_ACK_NOT_PERSISTED')
      state.continuationCount += 1
      return { id: 'fixture-part-1' as const }
    }, { maxAttempts: 1 })

    if (state.firstSendCount !== 1 || state.continuationCount !== 1
      || state.reportAttempts !== 3 || state.pendingSuspensions !== 2) {
      throw new Error('CANARY_DURABLE_REPLAY_INVARIANT_FAILED')
    }
    const afterMs = await step('probe-backend-after', probeBackend, { maxAttempts: 1 })
    return {
      scenario: input.scenario,
      first_send_count: 1 as const,
      continuation_count: 1 as const,
      report_attempts: 3 as const,
      pending_suspensions: 2 as const,
      first_receipt_id: firstReceipt.id,
      second_receipt_id: secondReceipt.id,
      external_sends: 0 as const,
      model_calls: 0 as const,
      backend_probe_before_ms: beforeMs,
      backend_probe_after_ms: afterMs,
    }
  },
})
