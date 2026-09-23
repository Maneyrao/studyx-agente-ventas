import { Action } from '@botpress/runtime'
import { InboundEnvelopeSchema, IngestResponseSchema } from '../schemas/contracts'
import { ingestCanonicalTurnV1 } from '../lib/inbound/ingest-canonical-turn'

// ADK 2.0.5 currently resolves two internal ZUI copies at this primitive
// boundary. Runtime validation still uses these schemas; the `any` parameters
// only prevent TypeScript from treating the duplicate package identities as
// incompatible.
export const ingestTurn = new Action<any, any>({
  name: 'ingestTurn',
  title: 'Ingest StudyX turn',
  description: 'Persists one external inbound event and returns the canonical StudyX context.',
  input: InboundEnvelopeSchema as any,
  output: IngestResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    return ingestCanonicalTurnV1(input)
  },
})
