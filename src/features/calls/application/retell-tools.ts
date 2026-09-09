import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { CallStore } from '../ports/call-store';
import {
  RetellCallCorrelationError,
  type RetellToolCallCorrelationStore,
} from '../ports/retell-call-correlation-store';
import type { BusinessContextStore } from '@/features/orchestration/ports/business-context-store';
import {
  buildBusinessContextView,
  buildCatalogIndexView,
  DEFAULT_BUSINESS_CONTEXT_LIMITS,
} from '@/features/orchestration/domain/business-context';
import { sanitizeRetrievedText } from '@/features/orchestration/domain/retrieved-context';
import { verifyRetellSignature } from '../adapters/retell-lifecycle';
import { recordCallEvent } from './record-call-event';

export type RetellP0ToolName =
  | 'consultar_curso'
  | 'consultar_oferta'
  | 'guardar_datos_contacto'
  | 'registrar_resultado';

export type RetellOrchestrationToolName =
  | 'enviar_link_pago'
  | 'verificar_pago'
  | 'enviar_material'
  | 'derivar_a_asesor_humano'
  | 'agendar_seguimiento';

export type RetellToolName = RetellP0ToolName | RetellOrchestrationToolName;

export interface RetellOrchestrationStore {
  createPaymentLink(input: {
    readonly callId: string;
    readonly contactId: string;
    readonly workspaceSlug: string;
    readonly courses: readonly string[];
    readonly plan: 'contado' | 'cuotas';
    readonly email: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
  }): Promise<{ readonly sent: boolean; readonly reference: string | null; readonly reason?: string }>;
  verifyPayment(input: {
    readonly callId: string;
    readonly contactId: string;
    readonly workspaceSlug: string;
    readonly reference?: string;
  }): Promise<{ readonly state: string }>;
  sendMaterial(input: {
    readonly callId: string;
    readonly contactId: string;
    readonly workspaceSlug: string;
    readonly type: 'temario' | 'testimonios' | 'acceso_campus' | 'comprobante';
    readonly course?: string;
  }): Promise<{ readonly sent: boolean; readonly reference: string | null; readonly reason?: string }>;
  requestHumanHandoff(input: {
    readonly callId: string;
    readonly contactId: string;
    readonly workspaceSlug: string;
    readonly reason: 'pedido_explicito' | 'reclamo' | 'alumno_existente' | 'caso_fuera_de_alcance' | 'cierre_complejo';
    readonly detail: string;
    readonly urgency: 'alta' | 'normal';
  }): Promise<{ readonly requestId: string; readonly available: boolean | null }>;
  scheduleFollowup(input: {
    readonly callId: string;
    readonly contactId: string;
    readonly workspaceSlug: string;
    readonly whenText: string;
    readonly channel: 'llamada' | 'whatsapp';
    readonly reason: string;
  }): Promise<{ readonly requestId: string; readonly scheduledAt: string | null; readonly needsResolution: boolean }>;
}

export interface RetellContactToolStore {
  saveCorrelatedContact(input: {
    readonly callId: string;
    readonly workspaceSlug: string;
    readonly nombre?: string;
    readonly email?: string;
    readonly telefonoAlternativo?: string;
    readonly sheets: { readonly spreadsheetId: string; readonly tabName: string } | null;
  }): Promise<{ readonly updated: boolean; readonly projected: boolean }>;
}

export interface RetellToolDependencies {
  readonly apiKey: string;
  readonly toolsSecret: string;
  readonly workspaceSlug: string;
  readonly calls: CallStore & RetellToolCallCorrelationStore;
  readonly business: Pick<BusinessContextStore, 'loadCompleteIndex' | 'loadByCode' | 'loadBusinessContext'>;
  readonly contacts: RetellContactToolStore;
  readonly sheets: { readonly spreadsheetId: string; readonly tabName: string } | null;
  readonly orchestration?: RetellOrchestrationStore;
  readonly now?: () => Date;
}

export const RETELL_TOOL_MAX_BODY_BYTES = 32 * 1_024;

const ToolMetadataSchema = z.object({
  internal_call_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
}).strict();

const ToolCallSchema = z.object({
  call_id: z.string().trim().min(1).max(512),
  metadata: ToolMetadataSchema,
}).passthrough();

const SafeNameSchema = z.string().trim().min(1).max(128)
  .regex(/^[\p{L}][\p{L}'’ -]*$/u);
const SafeEmailSchema = z.string().trim().max(254).email();
const SafePhoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/u);
const CourseTextSchema = z.string().trim().min(1).max(128);

const ToolArgsSchemas = {
  consultar_curso: z.object({
    curso: CourseTextSchema,
    academia: CourseTextSchema.optional(),
  }).strict(),
  consultar_oferta: z.object({
    cursos: z.array(CourseTextSchema).min(1).max(4),
    pais: z.string().trim().min(1).max(64).optional(),
  }).strict(),
  guardar_datos_contacto: z.object({
    nombre: SafeNameSchema.optional(),
    telefono_alternativo: SafePhoneSchema.optional(),
    email: SafeEmailSchema.optional(),
  }).strict().refine(
    (value) => value.nombre !== undefined
      || value.telefono_alternativo !== undefined
      || value.email !== undefined,
  ),
  registrar_resultado: z.object({
    resultado: z.enum([
      'venta_confirmada',
      'link_enviado_sin_pago',
      'seguimiento_agendado',
      'no_interesado',
      'derivado_humano',
      'no_es_buen_momento',
      'no_contactar',
      'ya_es_alumno',
      'no_calificado',
    ]),
    resumen: z.string().trim().min(1).max(2_048),
    objeciones: z.array(z.enum([
      'precio',
      'tiempo',
      'confianza',
      'capacidad_propia',
      'consultar_con_tercero',
      'comparando_opciones',
      'conectividad_o_dispositivo',
      'timing',
      'otra',
    ])).max(8).optional(),
    proximo_paso: z.string().trim().min(1).max(512).optional(),
    nivel_interes: z.enum(['alto', 'medio', 'bajo', 'nulo']).optional(),
    curso: CourseTextSchema.optional(),
  }).strict(),
  enviar_link_pago: z.object({
    cursos: z.array(CourseTextSchema).min(1).max(8),
    plan: z.enum(['contado', 'cuotas']),
    email: SafeEmailSchema,
    canal: z.enum(['whatsapp', 'sms', 'email']).optional(),
  }).strict(),
  verificar_pago: z.object({
    referencia_pago: z.string().trim().max(255).optional().transform((value) => value || undefined),
  }).strict(),
  enviar_material: z.object({
    tipo: z.enum(['temario', 'testimonios', 'acceso_campus', 'comprobante']),
    curso: CourseTextSchema.optional(),
  }).strict(),
  derivar_a_asesor_humano: z.object({
    motivo: z.enum(['pedido_explicito', 'reclamo', 'alumno_existente', 'caso_fuera_de_alcance', 'cierre_complejo']),
    detalle: z.string().trim().min(1).max(2_048),
    urgencia: z.enum(['alta', 'normal']).optional(),
  }).strict(),
  agendar_seguimiento: z.object({
    cuando: z.string().trim().min(1).max(512),
    canal: z.enum(['llamada', 'whatsapp']),
    motivo: z.string().trim().min(1).max(2_048),
  }).strict(),
} as const;

type ParsedEnvelope<Name extends RetellToolName> = {
  readonly name: Name;
  readonly call: z.infer<typeof ToolCallSchema>;
  readonly args: z.infer<(typeof ToolArgsSchemas)[Name]>;
};

function resultError(code: string, status = 200): Response {
  return Response.json({ ok: false, error: { code } }, { status });
}

function constantTimeSecretMatches(actual: string | null, expected: string): boolean {
  if (!actual || expected.length === 0) return false;
  const actualHash = createHash('sha256').update(actual, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/u.test(declaredLength)) {
    const size = Number(declaredLength);
    if (!Number.isSafeInteger(size) || size > RETELL_TOOL_MAX_BODY_BYTES) return null;
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > RETELL_TOOL_MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Best effort: the bounded request is already rejected.
        }
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseEnvelope<Name extends RetellToolName>(
  value: unknown,
  expectedName: Name,
): ParsedEnvelope<Name> | null {
  const schema = z.object({
    name: z.literal(expectedName),
    call: ToolCallSchema,
    args: ToolArgsSchemas[expectedName],
  }).strict();
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data as ParsedEnvelope<Name> : null;
}

function inputIsUnsafe(value: string): boolean {
  return sanitizeRetrievedText(value, value.length).injection_suspected;
}

const SafeCatalogLabelPattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’().,/:+\-\u2010-\u2015]*$/u;
const SafeCatalogCodePattern = /^[a-z0-9][a-z0-9_-]{0,127}$/u;

function normalizedCatalogIdentity(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function safeCatalogLabel(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length > 128
    || value !== value.trim()
  ) return false;
  const sanitized = sanitizeRetrievedText(value, 128);
  return !sanitized.injection_suspected
    && !sanitized.truncated
    && sanitized.text === value
    && SafeCatalogLabelPattern.test(sanitized.text);
}

function safeCatalogCode(value: unknown): value is string {
  if (typeof value !== 'string' || !SafeCatalogCodePattern.test(value)) return false;
  const semantic = sanitizeRetrievedText(value.replace(/[_-]+/gu, ' '), 128);
  return !semantic.injection_suspected && !semantic.truncated;
}

function rawCatalogIdentitiesAreSafe(raw: {
  readonly offerings: ReadonlyArray<{
    readonly code: unknown;
    readonly display_name: unknown;
    readonly metadata?: Record<string, unknown> | null;
  }>;
}): boolean {
  return raw.offerings.every((offering) => {
    const academy = offering.metadata?.academy;
    const aliases = offering.metadata?.aliases;
    return safeCatalogCode(offering.code)
      && safeCatalogLabel(offering.display_name)
      && (academy === undefined || academy === null || safeCatalogLabel(academy))
      && (aliases === undefined || (
        Array.isArray(aliases)
        && aliases.length <= 12
        && aliases.every(safeCatalogLabel)
      ));
  });
}

function resolveCourse(
  requestedCourse: string,
  requestedAcademy: string | undefined,
  offerings: ReadonlyArray<{
    code: string;
    display_name: string;
    academy: string | null;
    aliases?: readonly string[];
  }>,
): string | null {
  if (inputIsUnsafe(requestedCourse) || (requestedAcademy && inputIsUnsafe(requestedAcademy))) {
    return null;
  }
  const courseIdentity = normalizedCatalogIdentity(requestedCourse);
  const academyIdentity = requestedAcademy
    ? normalizedCatalogIdentity(requestedAcademy)
    : null;
  const matches = offerings.filter((offering) => {
    if (
      !safeCatalogCode(offering.code)
      || !safeCatalogLabel(offering.display_name)
      || (offering.academy !== null && !safeCatalogLabel(offering.academy))
      || (offering.aliases?.some((alias) => !safeCatalogLabel(alias)) ?? false)
    ) return false;
    if (
      academyIdentity !== null
      && (offering.academy === null
        || normalizedCatalogIdentity(offering.academy) !== academyIdentity)
    ) return false;
    const canonicalIdentities = [offering.code, offering.display_name, ...(offering.aliases ?? [])]
      .map(normalizedCatalogIdentity);
    return canonicalIdentities.includes(courseIdentity);
  });
  return matches.length === 1 ? matches[0].code : null;
}

async function consultCourse(
  args: z.infer<typeof ToolArgsSchemas.consultar_curso>,
  dependencies: RetellToolDependencies,
): Promise<Response> {
  const rawIndex = await dependencies.business.loadCompleteIndex(dependencies.workspaceSlug);
  if (!rawIndex || !rawCatalogIdentitiesAreSafe(rawIndex)) return resultError('COURSE_UNAVAILABLE');
  const index = buildCatalogIndexView(rawIndex);
  if (
    index.injection_suspected_count > 0
    || index.offerings_total !== index.offerings.length
  ) return resultError('COURSE_UNAVAILABLE');
  const code = resolveCourse(args.curso, args.academia, index.offerings);
  if (!code) return resultError('COURSE_UNAVAILABLE');

  const rawDetail = await dependencies.business.loadByCode(dependencies.workspaceSlug, code);
  if (!rawDetail || !rawCatalogIdentitiesAreSafe(rawDetail)) return resultError('COURSE_UNAVAILABLE');
  const detail = buildBusinessContextView(rawDetail, {
    ...DEFAULT_BUSINESS_CONTEXT_LIMITS,
    maxOfferings: 1,
  });
  const course = detail.offerings.find((candidate) => candidate.code === code);
  if (!course || detail.offerings_truncated > 0 || detail.injection_suspected_count > 0) {
    return resultError('COURSE_UNAVAILABLE');
  }
  return Response.json({
    ok: true,
    curso: {
      codigo: course.code,
      nombre: course.display_name,
      academia: course.academy,
      descripcion: course.description,
      modalidad: course.modality,
      clases: course.classes,
      modulos: course.modules,
      certificacion: course.certification,
      incluye: course.includes,
    },
  });
}

async function consultOffer(
  args: z.infer<typeof ToolArgsSchemas.consultar_oferta>,
  dependencies: RetellToolDependencies,
): Promise<Response> {
  if (args.cursos.length !== 1 || args.pais !== undefined) return resultError('OFFER_UNAVAILABLE');
  const raw = await dependencies.business.loadBusinessContext(dependencies.workspaceSlug);
  if (!raw || !rawCatalogIdentitiesAreSafe(raw)) return resultError('OFFER_UNAVAILABLE');
  const snapshot = buildBusinessContextView(raw);
  if (
    snapshot.offerings_truncated > 0
    || snapshot.injection_suspected_count > 0
    || snapshot.workspace.payment_options.length === 0
  ) return resultError('OFFER_UNAVAILABLE');
  const code = resolveCourse(args.cursos[0], undefined, snapshot.offerings);
  const course = snapshot.offerings.find((candidate) => candidate.code === code);
  if (!course?.price_assertable || !course.price) return resultError('OFFER_UNAVAILABLE');
  const coherent = snapshot.workspace.payment_options.every((option) => (
    option.total.amount === course.price!.amount
    && option.total.currency === course.price!.currency
  ));
  if (!coherent) return resultError('OFFER_UNAVAILABLE');
  return Response.json({
    ok: true,
    oferta: {
      moneda: course.price.currency,
      precio_lista: course.price.amount,
      precio_final: course.price.amount,
      cuotas_texto: snapshot.workspace.payment_options.map((option) => option.label).join('; '),
    },
  });
}

async function recordResult(
  envelope: ParsedEnvelope<'registrar_resultado'>,
  callId: string,
  dependencies: RetellToolDependencies,
): Promise<Response> {
  const { args } = envelope;
  const notes = [
    args.resumen,
    args.proximo_paso ? `Próximo paso: ${args.proximo_paso}` : null,
    args.curso ? `Curso: ${args.curso}` : null,
  ].filter((value): value is string => value !== null).join('\n');
  await recordCallEvent({
    schema_version: 1,
    event_id: `retell:call_analyzed:${envelope.call.call_id}`,
    call_id: callId,
    event_type: 'analyzed',
    sequence: 3,
    occurred_at: (dependencies.now?.() ?? new Date()).toISOString(),
    provider: 'retell',
    payload: {
      event_type: 'analyzed',
      analysis: {
        result: args.resultado,
        nivel_interes: args.nivel_interes === 'nulo' ? null : (args.nivel_interes ?? null),
        objecion: args.objeciones?.join(', ') ?? null,
        notas: notes,
      },
    },
  }, { store: dependencies.calls });
  return Response.json({ ok: true, recorded: true });
}

function orchestrationError(dependencies: RetellToolDependencies): Response {
  void dependencies;
  return resultError('TOOL_UNAVAILABLE');
}

async function runOrchestrationTool(
  envelope: ParsedEnvelope<RetellOrchestrationToolName>,
  callId: string,
  dependencies: RetellToolDependencies,
): Promise<Response> {
  const store = dependencies.orchestration;
  if (!store) return orchestrationError(dependencies);
  const common = {
    callId,
    contactId: envelope.call.metadata.contact_id,
    workspaceSlug: dependencies.workspaceSlug,
  };
  if (envelope.name === 'enviar_link_pago') {
    const args = envelope.args as z.infer<typeof ToolArgsSchemas.enviar_link_pago>;
    const result = await store.createPaymentLink({
      ...common,
      courses: args.cursos,
      plan: args.plan,
      email: args.email,
      channel: args.canal ?? 'whatsapp',
    });
    return result.sent
      ? Response.json({ ok: true, pago: { enviado: true, referencia: result.reference } })
      : resultError(result.reason ?? 'PAYMENT_UNAVAILABLE');
  }
  if (envelope.name === 'verificar_pago') {
    const args = envelope.args as z.infer<typeof ToolArgsSchemas.verificar_pago>;
    const result = await store.verifyPayment({
      ...common,
      ...(args.referencia_pago === undefined ? {} : { reference: args.referencia_pago }),
    });
    return Response.json({ ok: true, pago: { estado: result.state } });
  }
  if (envelope.name === 'enviar_material') {
    const args = envelope.args as z.infer<typeof ToolArgsSchemas.enviar_material>;
    const result = await store.sendMaterial({
      ...common,
      type: args.tipo,
      ...(args.curso === undefined ? {} : { course: args.curso }),
    });
    return result.sent
      ? Response.json({ ok: true, material: { enviado: true, referencia: result.reference } })
      : resultError(result.reason ?? 'MATERIAL_UNAVAILABLE');
  }
  if (envelope.name === 'derivar_a_asesor_humano') {
    const args = envelope.args as z.infer<typeof ToolArgsSchemas.derivar_a_asesor_humano>;
    const result = await store.requestHumanHandoff({
      ...common,
      reason: args.motivo,
      detail: args.detalle,
      urgency: args.urgencia ?? 'normal',
    });
    return Response.json({
      ok: true,
      derivacion: { creada: true, referencia: result.requestId, disponible: result.available },
    });
  }
  const args = envelope.args as z.infer<typeof ToolArgsSchemas.agendar_seguimiento>;
  const result = await store.scheduleFollowup({
    ...common,
    whenText: args.cuando,
    channel: args.canal,
    reason: args.motivo,
  });
  return Response.json({
    ok: true,
    seguimiento: {
      agendado: result.scheduledAt !== null && !result.needsResolution,
      referencia: result.requestId,
      cuando: args.cuando,
      canal: args.canal,
      motivo: args.motivo,
      needs_resolution: result.needsResolution,
      ...(result.scheduledAt === null ? {} : { programado_para: result.scheduledAt }),
    },
  });
}

export async function handleRetellToolRequest(
  request: Request,
  expectedName: RetellToolName,
  dependencies: RetellToolDependencies,
): Promise<Response> {
  if (!constantTimeSecretMatches(
    request.headers.get('x-studyx-tools-secret'),
    dependencies.toolsSecret,
  )) return resultError('UNAUTHORIZED', 401);

  const nowMs = (dependencies.now?.() ?? new Date()).getTime();
  const signature = request.headers.get('x-retell-signature');
  const signatureMatch = signature
    ? /^v=(\d+),d=([0-9a-f]{64})$/u.exec(signature)
    : null;
  const signatureTimestamp = signatureMatch ? Number(signatureMatch[1]) : Number.NaN;
  if (
    dependencies.apiKey.length === 0
    || !signatureMatch
    || !Number.isSafeInteger(signatureTimestamp)
    || Math.abs(nowMs - signatureTimestamp) > 300_000
  ) return resultError('UNAUTHORIZED', 401);

  const body = await readBoundedBody(request);
  if (!body) return resultError('PAYLOAD_TOO_LARGE', 413);
  if (!verifyRetellSignature({
    rawBody: body,
    signature,
    apiKey: dependencies.apiKey,
    nowMs,
  })) return resultError('UNAUTHORIZED', 401);

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch {
    return resultError('INVALID_TOOL_REQUEST');
  }
  const envelope = parseEnvelope(raw, expectedName);
  if (!envelope) return resultError('INVALID_TOOL_REQUEST');

  let callId: string;
  try {
    const correlation = await dependencies.calls.resolveRetellToolCall({
      providerCallId: envelope.call.call_id,
      metadata: {
        internalCallId: envelope.call.metadata.internal_call_id,
        contactId: envelope.call.metadata.contact_id,
        conversationId: envelope.call.metadata.conversation_id,
      },
      workspaceSlug: dependencies.workspaceSlug,
    });
    callId = correlation.callId;
  } catch (error) {
    if (error instanceof RetellCallCorrelationError) return resultError(error.code);
    return resultError('TOOL_UNAVAILABLE');
  }

  try {
    if (expectedName === 'consultar_curso') {
      return await consultCourse(
        envelope.args as z.infer<typeof ToolArgsSchemas.consultar_curso>,
        dependencies,
      );
    }
    if (expectedName === 'consultar_oferta') {
      return await consultOffer(
        envelope.args as z.infer<typeof ToolArgsSchemas.consultar_oferta>,
        dependencies,
      );
    }
    if (expectedName === 'guardar_datos_contacto') {
      const args = envelope.args as z.infer<typeof ToolArgsSchemas.guardar_datos_contacto>;
      const saved = await dependencies.contacts.saveCorrelatedContact({
        callId,
        workspaceSlug: dependencies.workspaceSlug,
        ...(args.nombre === undefined ? {} : { nombre: args.nombre }),
        ...(args.email === undefined ? {} : { email: args.email }),
        ...(args.telefono_alternativo === undefined
          ? {}
          : { telefonoAlternativo: args.telefono_alternativo }),
        sheets: dependencies.sheets,
      });
      return Response.json({ ok: true, saved: saved.updated, projected: saved.projected });
    }
    if ((['enviar_link_pago', 'verificar_pago', 'enviar_material', 'derivar_a_asesor_humano', 'agendar_seguimiento'] as const)
      .includes(expectedName as RetellOrchestrationToolName)) {
      return await runOrchestrationTool(
        envelope as ParsedEnvelope<RetellOrchestrationToolName>,
        callId,
        dependencies,
      );
    }
    return await recordResult(
      envelope as ParsedEnvelope<'registrar_resultado'>,
      callId,
      dependencies,
    );
  } catch {
    return resultError('TOOL_UNAVAILABLE');
  }
}
