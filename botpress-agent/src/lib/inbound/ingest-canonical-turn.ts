import { InboundEnvelopeSchema, IngestResponseSchema, type IngestResponse } from '../../schemas/contracts'
import { requestStudyxJson } from '../../utils/http'

export async function ingestCanonicalTurnV1(input: unknown): Promise<IngestResponse> {
  const validated = InboundEnvelopeSchema.parse(input)
  return requestStudyxJson({
    path: '/api/agent/ingest',
    body: validated,
    idempotencyKey: `inbound:${validated.source}:${validated.integration_id}:${validated.external_message_id}`,
    traceId: validated.trace_id,
    responseSchema: IngestResponseSchema,
  })
}
