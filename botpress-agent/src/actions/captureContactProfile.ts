import { Action, z } from '@botpress/runtime'
import { ContactProfileUpdateV1Schema } from '../schemas/agent-a-brain'
import { requestStudyxJson } from '../utils/http'

const Fields = z.enum(['nombre', 'apellido', 'correo', 'telefono'])
const InputSchema = z.object({
  trace_id: z.string().uuid(), turn_id: z.string().uuid(), batch_id: z.string().uuid(),
  claim_token: z.string().uuid(), expected_version: z.number().int().min(0),
  confirmed_phone: z.string().min(8).max(40).nullable().optional(),
  updates: z.array(ContactProfileUpdateV1Schema).max(8),
}).strict()
export const ContactProfileReceiptSchema = z.object({
  version: z.number().int().min(0),
  values: z.object({ nombre: z.string().nullable(), apellido: z.string().nullable(),
    correo: z.string().nullable(), telefono: z.string().nullable() }).strict(),
  accepted_fields: z.array(Fields).max(4),
  rejections: z.array(z.object({ field: Fields, code: z.string().min(1).max(160) }).strict()).max(9),
}).strict()

export const captureContactProfile = new Action<any, any>({
  name: 'captureContactProfile', title: 'Persist Agent A contact observations',
  description: 'Validate evidence and save independent profile fields before replying or executing an effect.',
  input: InputSchema as any, output: ContactProfileReceiptSchema as any, cached: false,
  async handler({ input }: { input: unknown }) {
    const validated = InputSchema.parse(input)
    return requestStudyxJson({
      path: `/api/agent/turns/${encodeURIComponent(validated.turn_id)}/profile`,
      body: validated, traceId: validated.trace_id,
      idempotencyKey: `profile:${validated.turn_id}:${validated.expected_version}`,
      responseSchema: ContactProfileReceiptSchema,
    })
  },
})
