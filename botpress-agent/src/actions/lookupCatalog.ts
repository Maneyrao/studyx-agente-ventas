import { Action, z } from '@botpress/runtime'
import { CatalogResponseSchema } from '../schemas/contracts'
import { requestStudyxJson } from '../utils/http'

/**
 * Read the product catalog through Next.js. Botpress never touches PostgreSQL,
 * and there is no write counterpart to this call anywhere in the agent: the
 * model can read a price, never propose or change one.
 *
 * Results, description length and total characters are all capped server-side,
 * so a growing catalog cannot silently push the structured facts out of the
 * prompt. A failure here degrades the turn — `prices_assertable: false` — and
 * never stops the conversation.
 */
export const lookupCatalog = new Action<any, any>({
  name: 'lookupCatalog',
  title: 'Look up StudyX catalog',
  description: 'Reads the current, structured product catalog. Read-only.',
  input: z.object({ trace_id: z.string().uuid() }) as any,
  output: CatalogResponseSchema as any,
  cached: false,
  async handler({ input }: { input: { trace_id: string } }) {
    return requestStudyxJson({
      path: '/api/agent/tools/catalog',
      method: 'GET',
      idempotencyKey: 'catalog:list',
      traceId: input.trace_id,
      responseSchema: CatalogResponseSchema,
      // Degradable read: one extra round trip at most on a transient failure
      // (network, timeout, 429, 5xx). A 422 CATALOG_INVALID_DATA is permanent
      // and is never retried. This is the ONLY retry layer for the catalog —
      // the workflow step runs with maxAttempts: 1.
      additionalRetries: 1,
    })
  },
})
