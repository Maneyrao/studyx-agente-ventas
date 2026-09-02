import { createHash } from 'node:crypto';

export const CONVERSATION_QUALITY_DIMENSIONS_V1 = [
  'listening_context',
  'natural_tone',
  'commercial_progression',
  'appropriate_initiative',
  'concision',
] as const;

export type ConversationQualityDimensionV1 =
  typeof CONVERSATION_QUALITY_DIMENSIONS_V1[number];

export type ConversationQualityDimensionGradeV1 = {
  score: number;
  evidence: string;
};

export type IndependentConversationGradeV1 = {
  schema_version: 'agent-a-conversation-quality-v1';
  case_id: string;
  transcript_sha256: string;
  grader: {
    kind: 'human' | 'independent_model';
    id: string;
    model?: string;
  };
  target_model: string;
  dimensions: Record<ConversationQualityDimensionV1, ConversationQualityDimensionGradeV1>;
};

export class ConversationQualityGradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationQualityGradeError';
  }
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_PATTERN = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/gu;

function redactTranscriptText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[EMAIL_REDACTED]')
    .replace(PHONE_PATTERN, '[PHONE_REDACTED]');
}

export function buildConversationQualityReviewPacketV1(input: {
  caseId: string;
  transcript: readonly { readonly role: string; readonly text: string }[];
}) {
  const transcript = input.transcript.map(({ role, text }) => ({
    role,
    text: redactTranscriptText(text),
  }));
  return {
    schema_version: 'agent-a-conversation-quality-review-v1' as const,
    case_id: input.caseId,
    transcript_sha256: createHash('sha256').update(JSON.stringify(transcript)).digest('hex'),
    transcript,
    dimensions: CONVERSATION_QUALITY_DIMENSIONS_V1,
  };
}

export function hashConversationTranscriptV1(
  transcript: readonly { readonly role: string; readonly text: string }[],
): string {
  return buildConversationQualityReviewPacketV1({ caseId: 'hash-only', transcript })
    .transcript_sha256;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function validateIndependentConversationGradeV1(input: {
  grade: IndependentConversationGradeV1;
  expectedCaseId: string;
  expectedTranscriptSha256: string;
}): void {
  const { grade } = input;
  if (grade.schema_version !== 'agent-a-conversation-quality-v1') {
    throw new ConversationQualityGradeError('QUALITY_GRADE: schema_version inválida');
  }
  if (grade.case_id !== input.expectedCaseId) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: case_id no corresponde');
  }
  if (
    !SHA256_PATTERN.test(input.expectedTranscriptSha256)
    || grade.transcript_sha256 !== input.expectedTranscriptSha256
  ) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: transcript_sha256 no corresponde');
  }
  if (!grade.grader.id.trim()) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: falta identidad del evaluador');
  }
  if (
    grade.grader.kind === 'independent_model'
    && (!grade.grader.model?.trim() || grade.grader.model === grade.target_model)
  ) {
    throw new ConversationQualityGradeError(
      'QUALITY_GRADE: el evaluador debe ser independiente del modelo objetivo',
    );
  }

  const actualDimensions = Object.keys(grade.dimensions).sort();
  const expectedDimensions = [...CONVERSATION_QUALITY_DIMENSIONS_V1].sort();
  if (
    actualDimensions.length !== expectedDimensions.length
    || actualDimensions.some((dimension, index) => dimension !== expectedDimensions[index])
  ) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: dimensiones incompletas o desconocidas');
  }
  for (const dimension of CONVERSATION_QUALITY_DIMENSIONS_V1) {
    const dimensionGrade = grade.dimensions[dimension];
    if (
      !dimensionGrade
      || !Number.isInteger(dimensionGrade.score)
      || dimensionGrade.score < 1
      || dimensionGrade.score > 5
      || !dimensionGrade.evidence.trim()
      || dimensionGrade.evidence.length > 240
    ) {
      throw new ConversationQualityGradeError(`QUALITY_GRADE: dimensión inválida ${dimension}`);
    }
  }
}

export type ConversationQualityVerdictV1 = {
  passed: boolean;
  average_score: number;
  dimension_scores: Record<ConversationQualityDimensionV1, number>;
  failures: string[];
};

export function evaluateIndependentConversationQualityV1(input: {
  grade: IndependentConversationGradeV1;
  expectedCaseId: string;
  expectedTranscriptSha256: string;
  hardGatePassed: boolean;
}): ConversationQualityVerdictV1 {
  validateIndependentConversationGradeV1(input);
  const dimensionScores = Object.fromEntries(CONVERSATION_QUALITY_DIMENSIONS_V1.map(
    (dimension) => [dimension, input.grade.dimensions[dimension].score],
  )) as Record<ConversationQualityDimensionV1, number>;
  const averageScore = CONVERSATION_QUALITY_DIMENSIONS_V1.reduce(
    (total, dimension) => total + dimensionScores[dimension],
    0,
  ) / CONVERSATION_QUALITY_DIMENSIONS_V1.length;
  const failures: string[] = [];
  if (!input.hardGatePassed) failures.push('hard_gate_failed');
  for (const dimension of CONVERSATION_QUALITY_DIMENSIONS_V1) {
    if (dimensionScores[dimension] < 3) failures.push(`dimension_below_3:${dimension}`);
  }
  if (averageScore < 4) failures.push('average_below_4');
  return {
    passed: failures.length === 0,
    average_score: averageScore,
    dimension_scores: dimensionScores,
    failures,
  };
}

export type ConversationQualityCalibrationSampleV1 = {
  case_id: string;
  dimension: ConversationQualityDimensionV1;
  independent_score: number;
  owner_score: number;
};

export function compareConversationQualityCalibrationV1(
  samples: readonly ConversationQualityCalibrationSampleV1[],
): { samples: number; disagreements_over_one: number; calibrated: boolean } {
  const disagreements = samples.filter(
    (sample) => Math.abs(sample.independent_score - sample.owner_score) > 1,
  ).length;
  return {
    samples: samples.length,
    disagreements_over_one: disagreements,
    calibrated: samples.length >= 5 && disagreements === 0,
  };
}

/**
 * Rúbrica conversacional V2.
 *
 * V1 medía tono, escucha, avance, iniciativa y concisión. Las tres corridas de
 * la matriz mostraron que eso no alcanza: los fallos reales eran repetición
 * literal de un turno anterior, mensajes que desbordaban el largo que el propio
 * prompt pedía, y respuestas que no retomaban lo que el cliente ya había
 * elegido. Ninguna de las tres tenía dimensión donde caer, así que una corrida
 * podía salir aprobada con el defecto adentro.
 *
 * V2 agrega esas tres y conserva `appropriate_initiative`, que es lo que vigila
 * que el agente no empuje la llamada de más.
 */
export const CONVERSATION_QUALITY_DIMENSIONS_V2 = [
  'listening_context',
  'natural_tone',
  'commercial_progression',
  'appropriate_initiative',
  'concision',
  'no_repetition',
  'prompt_compliance',
  'turn_continuity',
] as const;

export type ConversationQualityDimensionV2 =
  typeof CONVERSATION_QUALITY_DIMENSIONS_V2[number];

export type IndependentConversationGradeV2 = {
  schema_version: 'agent-a-conversation-quality-v2';
  case_id: string;
  transcript_sha256: string;
  grader: {
    kind: 'human' | 'independent_model';
    id: string;
    model?: string;
  };
  target_model: string;
  dimensions: Record<ConversationQualityDimensionV2, ConversationQualityDimensionGradeV1>;
};

export function validateIndependentConversationGradeV2(input: {
  grade: IndependentConversationGradeV2;
  expectedCaseId: string;
  expectedTranscriptSha256: string;
}): void {
  const { grade } = input;
  if (grade.schema_version !== 'agent-a-conversation-quality-v2') {
    throw new ConversationQualityGradeError('QUALITY_GRADE: schema_version inválida');
  }
  if (grade.case_id !== input.expectedCaseId) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: case_id no corresponde');
  }
  if (
    !SHA256_PATTERN.test(input.expectedTranscriptSha256)
    || grade.transcript_sha256 !== input.expectedTranscriptSha256
  ) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: transcript_sha256 no corresponde');
  }
  if (!grade.grader.id.trim()) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: falta identidad del evaluador');
  }
  if (
    grade.grader.kind === 'independent_model'
    && (!grade.grader.model?.trim() || grade.grader.model === grade.target_model)
  ) {
    throw new ConversationQualityGradeError(
      'QUALITY_GRADE: el evaluador debe ser independiente del modelo objetivo',
    );
  }

  const actualDimensions = Object.keys(grade.dimensions).sort();
  const expectedDimensions = [...CONVERSATION_QUALITY_DIMENSIONS_V2].sort();
  if (
    actualDimensions.length !== expectedDimensions.length
    || actualDimensions.some((dimension, index) => dimension !== expectedDimensions[index])
  ) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: dimensiones incompletas o desconocidas');
  }
  for (const dimension of CONVERSATION_QUALITY_DIMENSIONS_V2) {
    const dimensionGrade = grade.dimensions[dimension];
    if (
      !dimensionGrade
      || !Number.isInteger(dimensionGrade.score)
      || dimensionGrade.score < 1
      || dimensionGrade.score > 5
      || !dimensionGrade.evidence.trim()
      || dimensionGrade.evidence.length > 240
    ) {
      throw new ConversationQualityGradeError(`QUALITY_GRADE: dimensión inválida ${dimension}`);
    }
  }
}

export type ConversationQualityVerdictV2 = {
  passed: boolean;
  average_score: number;
  dimension_scores: Record<ConversationQualityDimensionV2, number>;
  failures: string[];
};

export function evaluateIndependentConversationQualityV2(input: {
  grade: IndependentConversationGradeV2;
  expectedCaseId: string;
  expectedTranscriptSha256: string;
  hardGatePassed: boolean;
}): ConversationQualityVerdictV2 {
  validateIndependentConversationGradeV2(input);
  const dimensionScores = Object.fromEntries(CONVERSATION_QUALITY_DIMENSIONS_V2.map(
    (dimension) => [dimension, input.grade.dimensions[dimension].score],
  )) as Record<ConversationQualityDimensionV2, number>;
  const averageScore = CONVERSATION_QUALITY_DIMENSIONS_V2.reduce(
    (total, dimension) => total + dimensionScores[dimension],
    0,
  ) / CONVERSATION_QUALITY_DIMENSIONS_V2.length;
  const failures: string[] = [];
  if (!input.hardGatePassed) failures.push('hard_gate_failed');
  for (const dimension of CONVERSATION_QUALITY_DIMENSIONS_V2) {
    if (dimensionScores[dimension] < 3) failures.push(`dimension_below_3:${dimension}`);
  }
  if (averageScore < 4) failures.push('average_below_4');
  return {
    passed: failures.length === 0,
    average_score: averageScore,
    dimension_scores: dimensionScores,
    failures,
  };
}

/**
 * El paquete de revisión V2 lleva las ocho dimensiones. El hash del transcripto
 * es el mismo que V1: ata la nota al texto exacto que se leyó, así que una nota
 * no puede migrar a otra corrida.
 */
export function buildConversationQualityReviewPacketV2(input: {
  caseId: string;
  transcript: readonly { readonly role: string; readonly text: string }[];
}) {
  const packet = buildConversationQualityReviewPacketV1(input);
  return {
    ...packet,
    schema_version: 'agent-a-conversation-quality-review-v2' as const,
    dimensions: CONVERSATION_QUALITY_DIMENSIONS_V2,
  };
}

/**
 * Lee el archivo de notas del evaluador independiente. Acepta la lista pelada o
 * envuelta en `{ grades: [...] }`, que es como queda más legible al lado del
 * paquete de revisión.
 *
 * Sólo valida la forma del sobre y que no venga dos veces el mismo caso: el
 * contenido de cada nota lo verifica la rúbrica contra el transcripto real, que
 * es lo único que puede atarla a la corrida que se está midiendo.
 */
export function parseIndependentConversationGradesV2(
  raw: string,
): IndependentConversationGradeV2[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConversationQualityGradeError('QUALITY_GRADE: el archivo de notas no es JSON válido');
  }
  const candidate = Array.isArray(parsed)
    ? parsed
    : (parsed as { grades?: unknown } | null)?.grades;
  if (!Array.isArray(candidate)) {
    throw new ConversationQualityGradeError('QUALITY_GRADE: se esperaba una lista de notas');
  }
  const grades = candidate as IndependentConversationGradeV2[];
  const seen = new Set<string>();
  for (const grade of grades) {
    const caseId = grade?.case_id;
    if (typeof caseId !== 'string' || caseId.trim().length === 0) {
      throw new ConversationQualityGradeError('QUALITY_GRADE: falta case_id en una nota');
    }
    if (seen.has(caseId)) {
      throw new ConversationQualityGradeError(`QUALITY_GRADE: nota duplicada para ${caseId}`);
    }
    seen.add(caseId);
  }
  return grades;
}
