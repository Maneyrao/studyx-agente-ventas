import { z } from '@botpress/runtime'

/**
 * Espejo de `src/features/conversation/domain/turn-rejection.ts`.
 *
 * La deriva de espejos ya causó un fallo en producción local (`contact_details`
 * quedó en el dominio y no en los contratos, y el estado persistía sin poder
 * leerse). Por eso este contrato entra al test de paridad desde el primer
 * commit y no después.
 */
export const TurnRejectionCodeSchema = z.enum([
  'FACT_NOT_AUTHORIZED',
  'FACT_VALUE_MISMATCH',
  'ACTION_NOT_AUTHORIZED',
  'MISSING_INTAKE',
  'CALL_BUDGET_EXHAUSTED',
  'UNSUPPORTED_OPERATIONAL_CLAIM',
  'PLAN_NOT_SELECTED',
  'COURSE_NOT_RESOLVED',
])

/** Identificador o código. Nunca una frase para el cliente (A4). */
const StructuredSubjectSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9_:.\-]+$/iu, 'TURN_REJECTION_SUBJECT_NOT_STRUCTURED')

export const TurnRejectionV1Schema = z
  .object({
    schema_version: z.literal(1),
    rejection_id: z.string().uuid(),
    attempt: z.literal(1),
    rejections: z
      .array(
        z
          .object({ code: TurnRejectionCodeSchema, subject: StructuredSubjectSchema })
          .strict(),
      )
      .min(1),
    authorized_alternatives: z
      .object({
        fact_ids: z.array(z.string().trim().min(1)).default([]),
        actions: z.array(z.string().trim().min(1)).default([]),
        missing_information: z.array(z.string().trim().min(1)).default([]),
      })
      .strict(),
  })
  .strict()

export type TurnRejectionV1 = z.infer<typeof TurnRejectionV1Schema>
