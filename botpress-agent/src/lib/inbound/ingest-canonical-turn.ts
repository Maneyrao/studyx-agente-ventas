import { configuration } from '@botpress/runtime'
import { InboundEnvelopeSchema, IngestResponseSchema, type IngestResponse } from '../../schemas/contracts'
import { requestStudyxJson } from '../../utils/http'

export async function ingestCanonicalTurnV1(input: unknown): Promise<IngestResponse> {
  const envelope = InboundEnvelopeSchema.parse(input)
  const { identity_owner: _ignored, ...transport } = envelope
  const validated = configuration.agentAPlannerlessV2Enabled === true
    ? { ...transport, identity_owner: 'agent_a_v1' as const } : transport
  return requestStudyxJson({
    path: '/api/agent/ingest',
    body: validated,
    idempotencyKey: `inbound:${validated.source}:${validated.integration_id}:${validated.external_message_id}`,
    traceId: validated.trace_id,
    responseSchema: IngestResponseSchema,
  })
}
