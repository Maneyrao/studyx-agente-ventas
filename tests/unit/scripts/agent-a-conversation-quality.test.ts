import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compareConversationQualityCalibrationV1,
  buildConversationQualityReviewPacketV1,
  evaluateIndependentConversationQualityV1,
  validateIndependentConversationGradeV1,
  CONVERSATION_QUALITY_DIMENSIONS_V2,
  parseIndependentConversationGradesV2,
  evaluateIndependentConversationQualityV2,
  validateIndependentConversationGradeV2,
  type ConversationQualityDimensionV1,
  type ConversationQualityDimensionV2,
  type IndependentConversationGradeV1,
  type IndependentConversationGradeV2,
} from '../../../scripts/lib/agent-a-conversation-quality';

const DIMENSIONS: ConversationQualityDimensionV1[] = [
  'listening_context',
  'natural_tone',
  'commercial_progression',
  'appropriate_initiative',
  'concision',
];

const transcriptSha = createHash('sha256').update('transcript-visible-1').digest('hex');

function grade(
  scoreByDimension: Partial<Record<ConversationQualityDimensionV1, number>> = {},
): IndependentConversationGradeV1 {
  return {
    schema_version: 'agent-a-conversation-quality-v1',
    case_id: 'visible-calibration-1',
    transcript_sha256: transcriptSha,
    grader: {
      kind: 'independent_model',
      id: 'reviewer-a',
      model: 'independent-review-model',
    },
    target_model: 'deepseek-chat',
    dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, {
      score: scoreByDimension[dimension] ?? 4,
      evidence: `Evidencia concreta para ${dimension}.`,
    }])) as IndependentConversationGradeV1['dimensions'],
  };
}

function gradeV2(
  scoreByDimension: Partial<Record<ConversationQualityDimensionV2, number>> = {},
): IndependentConversationGradeV2 {
  return {
    schema_version: 'agent-a-conversation-quality-v2',
    case_id: 'visible-calibration-1',
    transcript_sha256: transcriptSha,
    grader: { kind: 'independent_model', id: 'reviewer-a', model: 'independent-review-model' },
    target_model: 'deepseek-chat',
    dimensions: Object.fromEntries(CONVERSATION_QUALITY_DIMENSIONS_V2.map((dimension) => [dimension, {
      score: scoreByDimension[dimension] ?? 4,
      evidence: `Evidencia concreta para ${dimension}.`,
    }])) as IndependentConversationGradeV2['dimensions'],
  };
}

describe('independent Agent A conversation quality', () => {
  it('passes only with average >=4, every dimension >=3 and a green hard gate', () => {
    const verdict = evaluateIndependentConversationQualityV1({
      grade: grade(),
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
      hardGatePassed: true,
    });

    expect(verdict).toMatchObject({ passed: true, average_score: 4, failures: [] });
  });

  it('fails when one dimension is below 3, the average is below 4, or safety failed', () => {
    const weakDimension = evaluateIndependentConversationQualityV1({
      grade: grade({ listening_context: 2, natural_tone: 5 }),
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
      hardGatePassed: true,
    });
    expect(weakDimension.failures).toContain('dimension_below_3:listening_context');

    const weakAverage = evaluateIndependentConversationQualityV1({
      grade: grade({ listening_context: 3, natural_tone: 3, commercial_progression: 3, appropriate_initiative: 3, concision: 3 }),
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
      hardGatePassed: true,
    });
    expect(weakAverage.failures).toContain('average_below_4');

    const unsafe = evaluateIndependentConversationQualityV1({
      grade: grade(),
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
      hardGatePassed: false,
    });
    expect(unsafe.failures).toContain('hard_gate_failed');
  });

  it('binds the grade to the exact case/transcript and forbids target-model self grading', () => {
    expect(() => validateIndependentConversationGradeV1({
      grade: grade(),
      expectedCaseId: 'another-case',
      expectedTranscriptSha256: transcriptSha,
    })).toThrow(/case_id/);
    expect(() => validateIndependentConversationGradeV1({
      grade: grade(),
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: 'b'.repeat(64),
    })).toThrow(/transcript_sha256/);

    const selfGrade = grade();
    selfGrade.grader.model = 'deepseek-chat';
    expect(() => validateIndependentConversationGradeV1({
      grade: selfGrade,
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
    })).toThrow(/independiente/);
  });

  it('rejects incomplete dimensions, invalid scores and evidence-free grades', () => {
    const incomplete = grade();
    delete (incomplete.dimensions as Partial<typeof incomplete.dimensions>).concision;
    expect(() => validateIndependentConversationGradeV1({
      grade: incomplete,
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
    })).toThrow(/dimensiones/);

    const invalid = grade();
    invalid.dimensions.natural_tone.score = 6;
    invalid.dimensions.concision.evidence = '  ';
    expect(() => validateIndependentConversationGradeV1({
      grade: invalid,
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
    })).toThrow();
  });

  it('calibrates five visible examples and flags disagreements above one point', () => {
    const aligned = DIMENSIONS.map((dimension, index) => ({
      case_id: `visible-${index + 1}`,
      dimension,
      independent_score: 4,
      owner_score: index === 0 ? 3 : 4,
    }));
    expect(compareConversationQualityCalibrationV1(aligned)).toMatchObject({
      samples: 5,
      disagreements_over_one: 0,
      calibrated: true,
    });

    expect(compareConversationQualityCalibrationV1([
      ...aligned,
      { case_id: 'visible-6', dimension: 'natural_tone', independent_score: 5, owner_score: 2 },
    ])).toMatchObject({ disagreements_over_one: 1, calibrated: false });
  });

  it('exports a redacted review packet without customer email or phone', () => {
    const packet = buildConversationQualityReviewPacketV1({
      caseId: 'visible-pii',
      transcript: [
        { role: 'user', text: 'Soy Ana, ana@example.com, +54 9 11 4444-5555.' },
        { role: 'assistant', text: 'Gracias, seguimos con el curso.' },
      ],
    });

    expect(JSON.stringify(packet)).not.toContain('ana@example.com');
    expect(JSON.stringify(packet)).not.toContain('4444-5555');
    expect(packet.transcript_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});

/**
 * Las tres corridas cerraron 20/20 funcional con la calidad conversacional en
 * cero: no había ni una sola nota independiente, así que el gate nunca se
 * evaluó. Y la rúbrica que existía no medía tres de las cosas que sí fallaban
 * —repetición literal, respeto del prompt y continuidad entre turnos—, de modo
 * que aun con notas cargadas habría certificado el problema.
 */
describe('rúbrica conversacional independiente: dimensiones exigidas', () => {
  it('mide repetición, respeto del prompt y continuidad además del tono', () => {
    expect(CONVERSATION_QUALITY_DIMENSIONS_V2).toEqual(expect.arrayContaining([
      'natural_tone',
      'listening_context',
      'commercial_progression',
      'concision',
      'no_repetition',
      'prompt_compliance',
      'turn_continuity',
    ]));
  });

  it('rechaza una nota a la que le falta alguna de las dimensiones nuevas', () => {
    const complete = gradeV2();
    const incomplete = { ...complete.dimensions };
    delete (incomplete as Partial<typeof incomplete>).no_repetition;
    expect(() => validateIndependentConversationGradeV2({
      grade: { ...complete, dimensions: incomplete as typeof complete.dimensions },
      expectedCaseId: complete.case_id,
      expectedTranscriptSha256: transcriptSha,
    })).toThrow(/dimensiones incompletas/iu);
  });

  it('reprueba una conversación que repite un turno aunque el resto esté bien', () => {
    const verdict = evaluateIndependentConversationQualityV2({
      grade: gradeV2({ no_repetition: 2 }),
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
      hardGatePassed: true,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures).toContain('dimension_below_3:no_repetition');
  });

  it('sigue prohibiendo que el modelo evaluado se ponga la nota', () => {
    expect(() => validateIndependentConversationGradeV2({
      grade: { ...gradeV2(), grader: { kind: 'independent_model', id: 'self', model: 'deepseek-chat' } },
      expectedCaseId: 'visible-calibration-1',
      expectedTranscriptSha256: transcriptSha,
    })).toThrow(/independiente del modelo objetivo/iu);
  });
});

/**
 * Las notas se cargan desde un archivo aparte: el evaluador independiente lee
 * el paquete redactado y devuelve un JSON. Sin esta puerta el runner nunca
 * recibía notas y `conversation_quality_passed` quedaba en cero corrida tras
 * corrida, que es exactamente lo que muestran los tres reportes.
 */
describe('carga de notas independientes', () => {
  it('acepta un archivo con la lista de notas y rechaza lo que no lo sea', () => {
    const grades = [gradeV2()];
    expect(parseIndependentConversationGradesV2(JSON.stringify({ grades })))
      .toEqual(grades);
    expect(parseIndependentConversationGradesV2(JSON.stringify(grades)))
      .toEqual(grades);
    expect(() => parseIndependentConversationGradesV2('{"grades":{}}'))
      .toThrow(/QUALITY_GRADE/u);
    expect(() => parseIndependentConversationGradesV2('no es json'))
      .toThrow(/QUALITY_GRADE/u);
  });

  it('no deja pasar dos notas para el mismo caso', () => {
    expect(() => parseIndependentConversationGradesV2(
      JSON.stringify({ grades: [gradeV2(), gradeV2()] }),
    )).toThrow(/duplicad/iu);
  });
});
