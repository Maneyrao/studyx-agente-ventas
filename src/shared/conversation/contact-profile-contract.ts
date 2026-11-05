import { z } from 'zod';

/** Contact meaning belongs to Agent A; these contracts validate structure only. */
export const CONTACT_PROFILE_FIELDS_V1 = ['nombre', 'apellido', 'correo', 'telefono'] as const;
export const CONTACT_PROFILE_OPERATIONS_V1 = ['set', 'correct', 'retract'] as const;
export const CONTACT_PROFILE_PURPOSES_V1 = ['identity', 'call', 'payment'] as const;
export const CONTACT_PROFILE_MODES_V1 = ['collect', 'clarify'] as const;
export const CONTACT_PROFILE_MAX_UPDATES_V1 = 8;
export const CONTACT_PROFILE_MAX_REQUESTS_V1 = 4;
export const CONTACT_PROFILE_MAX_SOURCES_V1 = 32;
export const CONTACT_PROFILE_MAX_PENDING_REQUESTS_V1 = 12;

export const ContactProfileFieldV1Schema = z.enum(CONTACT_PROFILE_FIELDS_V1);
const FieldsSchema = z.array(ContactProfileFieldV1Schema).min(1).max(4)
  .refine((fields) => new Set(fields).size === fields.length, 'DUPLICATE_PROFILE_FIELD');

export const ContactProfileUpdateV1Schema = z.object({
  field: ContactProfileFieldV1Schema,
  value: z.string().min(1).max(512).nullable(),
  operation: z.enum(CONTACT_PROFILE_OPERATIONS_V1),
  source_message_id: z.string().uuid(),
  source_quote: z.string().min(1).max(4_096),
}).strict().refine((update) => update.operation === 'retract'
  ? update.value === null : update.value !== null, 'PROFILE_OPERATION_VALUE_MISMATCH');

export const ContactProfileRequestV1Schema = z.object({
  message_index: z.number().int().min(0),
  fields: FieldsSchema,
  purpose: z.enum(CONTACT_PROFILE_PURPOSES_V1),
  mode: z.enum(CONTACT_PROFILE_MODES_V1),
}).strict();

export const ContactProfileContextV1Schema = z.object({
  version: z.number().int().min(0),
  sources: z.array(z.object({
    id: z.string().uuid(),
    text: z.string().min(1).max(4_096),
    sequence: z.number().int().min(0),
  }).strict()).max(CONTACT_PROFILE_MAX_SOURCES_V1),
  pending_requests: z.array(z.object({
    message_id: z.string().uuid(),
    fields: FieldsSchema,
    purpose: z.enum(CONTACT_PROFILE_PURPOSES_V1),
    mode: z.enum(CONTACT_PROFILE_MODES_V1),
  }).strict()).max(CONTACT_PROFILE_MAX_PENDING_REQUESTS_V1),
  /** Values Agent A proposed in this turn that the profile receipt refused. The
   * reply must not present them as recorded (2026-11-05, gmail,com / 4498). */
  rejected_updates: z.array(z.object({
    field: ContactProfileFieldV1Schema,
    value: z.string().min(1).max(320),
    code: z.string().min(1).max(64),
  }).strict()).max(8).optional(),
}).strict();

export const ContactProfileReceiptV1Schema = z.object({
  version: z.number().int().min(0),
  values: z.object({
    nombre: z.string().nullable(),
    apellido: z.string().nullable(),
    correo: z.string().nullable(),
    telefono: z.string().nullable(),
  }).strict(),
  accepted_fields: z.array(ContactProfileFieldV1Schema).max(4)
    .refine((fields) => new Set(fields).size === fields.length, 'DUPLICATE_PROFILE_FIELD'),
  rejections: z.array(z.object({
    field: ContactProfileFieldV1Schema,
    code: z.string().min(1).max(160),
  }).strict()).max(CONTACT_PROFILE_MAX_UPDATES_V1 + 1),
}).strict();

export type ContactProfileFieldV1 = typeof CONTACT_PROFILE_FIELDS_V1[number];
export type ContactProfileUpdateV1 = z.infer<typeof ContactProfileUpdateV1Schema>;
export type ContactProfileRequestV1 = z.infer<typeof ContactProfileRequestV1Schema>;
export type ContactProfileContextV1 = z.infer<typeof ContactProfileContextV1Schema>;
export type ContactProfileReceiptV1 = z.infer<typeof ContactProfileReceiptV1Schema>;
