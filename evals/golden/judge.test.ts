import { describe, expect, it, vi } from 'vitest';

import {
  evaluateHardRules,
  inferFailureAttribution,
  inferFailureLayer,
  judgeCaseSemantically,
  type GoldenTurnObservationV1,
} from './judge';
import { GOLDEN_CASES } from './scenarios';

function observation(overrides: Partial<GoldenTurnObservationV1> = {}): GoldenTurnObservationV1 {
  return {
    response: 'Hola, Soy Emma, asesora de Studyx. Qué te gustaría aprender?',
    move: 'greeting', secondaryMoves: [], proposedAction: { type: 'none' },
    backendAction: 'none', backendRejections: [],
    state: { selectedCourse: null, stage: 'exploring', awaitingReply: 'none', plan: null,
      promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] } },
    deliveredLinks: [], authorizedFactIds: [], authorizedFacts: [], usedFactIds: [],
    availableOfferings: [], selectedOfferingFacts: [], modelAttempts: [],
    ...overrides,
  };
}

describe('golden hard judge', () => {
  it('passes the exact identity turn and fails a defensive administrative variant', () => {
    const turn = GOLDEN_CASES[0]!.turns[0]!;
    expect(evaluateHardRules(turn, observation()).failures).toEqual([]);
    const failed = evaluateHardRules(turn, observation({
      response: 'Soy Emma, administrativa de Studyx Academia Internacional.',
    }));
    expect(failed.failures.map((item) => item.code)).toEqual([
      'TEXT_REQUIRED_MISSING', 'TEXT_FORBIDDEN_PRESENT', 'TEXT_FORBIDDEN_PRESENT',
    ]);
  });

  it('uses persisted promotion state and actual action rather than sales copy', () => {
    const turn = GOLDEN_CASES[5]!.turns.find((item) => item.id === 'bonus_2')!;
    const failed = evaluateHardRules(turn, observation({
      response: 'Puedo sumar otro curso.',
      proposedAction: { type: 'none' },
      state: { selectedCourse: 'fotografia_profesional', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: 'offer_available', bonusCount: 1,
          paidCourse: 'fotografia_profesional', bonusCourses: ['diseno_photoshop'] } },
    }));
    expect(failed.failures.map((item) => item.code)).toContain('ACTION_MISMATCH');
    expect(failed.failures.map((item) => item.code)).toContain('PROMOTION_BONUS_COUNT_MISMATCH');
  });

  it('attributes missing syllabus context separately from a model refusal', () => {
    const turn = GOLDEN_CASES[12]!.turns[0]!;
    expect(inferFailureLayer(turn, observation({
      response: 'No tengo el temario.', selectedOfferingFacts: [],
    }), ['SEMANTIC_MUST_FAILED'])).toBe('contexto');
    expect(inferFailureLayer(turn, observation({
      response: 'No tengo el temario.',
      selectedOfferingFacts: [{ id: 'syllabus:photo:v1', kind: 'offering_description', value: 'Módulo 1: cámara.' }],
    }), ['SEMANTIC_MUST_FAILED'])).toBe('brain');
  });

  it('attributes environment failures and gives backend rejections priority with exact code and subject', () => {
    const turn = GOLDEN_CASES[9]!.turns[2]!;
    expect(inferFailureLayer(turn, observation({
      response: '',
      workflow: {
        commitSucceeded: false,
        status: 'retry_pending',
        errorCode: 'VOICE_PROVIDER_INVALID',
        finalBackendDecisionError: 'VOICE_PROVIDER_INVALID',
      },
    }), ['SILENT_TURN'])).toBe('entorno');

    const rejected = observation({
      backendRejections: [{ rejections: [
        { code: 'FACT_VALUE_MISMATCH', subject: 'price_objection_reframe' },
        { code: 'CALL_OFFER_REQUIRED', subject: 'call_offer' },
      ] }],
      workflow: {
        commitSucceeded: true,
        status: 'completed',
        errorCode: null,
        finalBackendDecisionError: null,
      },
    });
    expect(inferFailureAttribution(turn, rejected, ['PROMOTION_STATUS_MISMATCH']))
      .toEqual({
        layer: 'validador',
        validatorRejections: [
          { code: 'FACT_VALUE_MISMATCH', subject: 'price_objection_reframe' },
          { code: 'CALL_OFFER_REQUIRED', subject: 'call_offer' },
        ],
      });

    expect(inferFailureLayer(turn, observation({
      workflow: {
        commitSucceeded: false,
        status: 'retry_pending',
        errorCode: 'AGENT_A_CONTINUATION_REJECTED',
        finalBackendDecisionError: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
      },
    }), ['STATE_STAGE_MISMATCH', 'SILENT_TURN'])).toBe('validador');
  });

  it('checks only authority-defined checkout and closure state', () => {
    const partner = GOLDEN_CASES[7]!.turns.find((candidate) => candidate.id === 'partner')!;
    expect(evaluateHardRules(partner, observation({
      response: 'Te ayudo con lo clave y, si quieren, también podemos verlo en una llamada.',
      move: 'request_call',
      state: { selectedCourse: null, stage: 'qualified', awaitingReply: 'call_or_chat', plan: null,
        promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] } },
    })).failures.map((failure) => failure.code)).not.toEqual(expect.arrayContaining([
      'STATE_STAGE_MISMATCH', 'STATE_AWAITING_REPLY_MISMATCH', 'CHECKOUT_STATE_MISMATCH',
    ]));

    const buy = GOLDEN_CASES[10]!.turns.find((candidate) => candidate.id === 'buy')!;
    expect(evaluateHardRules(buy, observation({
      move: 'request_payment_link',
      response: 'Para inscribirte necesito nombre, apellido, correo y teléfono.',
      state: { selectedCourse: 'fotografia_profesional', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] } },
    })).failures.map((failure) => failure.code)).toContain('CHECKOUT_STATE_MISMATCH');

    const definitive = GOLDEN_CASES[8]!.turns.find((candidate) => candidate.id === 'definitive')!;
    expect(evaluateHardRules(definitive, observation({
      move: 'decline_purchase', response: 'Claro, te dejo la puerta abierta.',
      state: { selectedCourse: null, stage: 'qualified', awaitingReply: 'none', plan: null,
        promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] } },
    })).failures.map((failure) => failure.code)).toContain('CLOSURE_STATE_MISMATCH');
  });

  it('accepts the effective backend call action when the authorized fast path has no model proposal', () => {
    const turn = GOLDEN_CASES[9]!.turns.find((candidate) => candidate.id === 'available')!;
    const result = evaluateHardRules(turn, observation({
      response: 'Perfecto, intento comunicarme ahora.',
      move: null,
      proposedAction: null,
      backendAction: 'request_call_now',
      state: {
        selectedCourse: null, stage: 'handoff', awaitingReply: 'none', plan: null,
        promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] },
      },
    }));
    expect(result.failures.map((failure) => failure.code)).not.toEqual(expect.arrayContaining([
      'MOVE_MISMATCH', 'ACTION_MISMATCH',
    ]));
  });

  it('recognizes every activated course in the real verified-access message by its canonical name', () => {
    const turn = GOLDEN_CASES[11]!.turns[0]!;
    const response = [
      'Tu acceso ya está habilitado. Bienvenido a Studyx.',
      'CURSOS HABILITADOS',
      '📚 CURSO PRINCIPAL: Fotografía Profesional',
      '🎁 CURSO BONIFICADO: Fotografía con Celulares para Tiendas Online',
      '🎁 CURSO BONIFICADO: Marketing Digital',
    ].join('\n');
    const actual = observation({
      response,
      move: null,
      proposedAction: null,
      state: {
        selectedCourse: 'fotografia_profesional', stage: 'payment_link_sent',
        awaitingReply: 'none', plan: 'monthly_12',
        promotion: { status: 'accepted', bonusCount: 2, paidCourse: 'fotografia_profesional',
          bonusCourses: ['fotografia_celulares_tiendas_online', 'marketing_digital'] },
      },
      activeCourses: [
        'fotografia_profesional', 'fotografia_celulares_tiendas_online', 'marketing_digital',
      ],
      activeCourseNames: [
        { code: 'fotografia_profesional', displayName: 'Fotografía Profesional' },
        { code: 'fotografia_celulares_tiendas_online', displayName: 'Fotografía con Celulares para Tiendas Online' },
        { code: 'marketing_digital', displayName: 'Marketing Digital' },
      ],
    });

    expect(evaluateHardRules(turn, actual).failures).toEqual([]);
    expect(evaluateHardRules(turn, {
      ...actual,
      response: response.replace('\n🎁 CURSO BONIFICADO: Marketing Digital', ''),
    }).failures.map((failure) => failure.code)).toContain('ACTIVE_COURSES_NOT_LISTED');
  });

  it('audits the bonus gate configuration and a price objection from an earlier turn', () => {
    const turn = GOLDEN_CASES[5]!.turns.find((candidate) => candidate.id === 'bonus_1')!;
    const eligible = observation({
      response: 'Puedo sumar Fotografía con Celulares para Tiendas Online.',
      move: 'unknown',
      proposedAction: {
        type: 'offer_course_bonus',
        bonus_offering_code: 'fotografia_celulares_tiendas_online',
      },
      state: {
        selectedCourse: 'fotografia_profesional', stage: 'course_selected',
        awaitingReply: 'none', plan: null,
        promotion: { status: 'offer_available', bonusCount: 1,
          paidCourse: 'fotografia_profesional', bonusCourses: ['fotografia_celulares_tiendas_online'] },
      },
      courseBonus: { enabled: true, maxBonusCourses: 3, mayOfferBonus: true, status: 'checkin_available' },
      priceObjectionMemory: {
        present: true, sourceMessageIds: ['message-1'], priorSourceMessageIds: ['message-1'],
      },
    });
    expect(evaluateHardRules(turn, eligible).failures.map((failure) => failure.code))
      .not.toContain('BONUS_PRIOR_PRICE_OBJECTION_MISSING');

    const ineligible = evaluateHardRules(turn, {
      ...eligible,
      courseBonus: { enabled: false, maxBonusCourses: 1, mayOfferBonus: false, status: 'disabled' },
      priceObjectionMemory: { present: true, sourceMessageIds: ['current'], priorSourceMessageIds: [] },
    });
    expect(ineligible.failures.map((failure) => failure.code)).toEqual(expect.arrayContaining([
      'BONUS_CONFIGURATION_DISABLED',
      'BONUS_MAX_COURSES_CONFIG_MISMATCH',
      'BONUS_PRIOR_PRICE_OBJECTION_MISSING',
    ]));
  });

  it('marks only the affected turn as evaluator error when the judge cannot cite a real authority line', async () => {
    const base = GOLDEN_CASES[0]!;
    const scenario = { ...base, turns: [base.turns[0]!] };
    const invalidVerdict = {
      verdict: {
        turn_id: 'greeting', approved: false,
        failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:0',
          authority_line_index: 999,
          evidence_source: 'response', observed_evidence: '',
          explanation: 'No cumple.',
        }],
      },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      output_text: JSON.stringify(invalidVerdict),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const [result] = await judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation()],
    });

    expect(result).toEqual({
      turn_id: 'greeting', approved: null, failures: [],
      evaluation_error: 'GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockRestore();
  });

  it('accepts a semantic failure only with a real line number and its exact authority text', async () => {
    const base = GOLDEN_CASES[0]!;
    const scenario = { ...base, turns: [base.turns[0]!] };
    const authorityReference = 'AGENTS.md:11 | - Identidad: "Soy Emma, asesora de Studyx". Emma es fijo (AGENT_A_ADVISOR_NAME=Emma). Nunca "administrativa".';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'greeting', approved: false,
        failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:0',
          authority_line_index: 1,
          evidence_source: 'response', observed_evidence: '',
          explanation: 'No usa la identidad obligatoria.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({ response: 'Hola.' })],
    })).resolves.toEqual([{
      turn_id: 'greeting', approved: false, evaluation_error: null,
      failures: [{
        code: 'SEMANTIC_MUST_FAILED', requirement_index: 0,
        authority_reference: authorityReference,
        explanation: 'No usa la identidad obligatoria.',
      }],
    }]);
    fetchMock.mockRestore();
  });

  it('rejects a must-not accusation unless it cites concrete evidence present in the selected source', async () => {
    const base = GOLDEN_CASES[0]!;
    const scenario = { ...base, turns: [base.turns[0]!] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'greeting', approved: false,
        failures: [{
          code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:0',
          authority_line_index: 1,
          evidence_source: 'response', observed_evidence: 'no se observa la conducta prohibida',
          explanation: 'No se observa la conducta prohibida.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({ response: 'Hola.' })],
    })).resolves.toEqual([{
      turn_id: 'greeting', approved: null, failures: [],
      evaluation_error: 'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID',
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockRestore();
  });

  it('leaves a silent turn to deterministic hard rules instead of manufacturing semantic evidence', async () => {
    const base = GOLDEN_CASES[9]!;
    const turn = base.turns.find((candidate) => candidate.id === 'request')!;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, turns: [turn] },
      observations: [observation({ response: '' })],
    })).resolves.toEqual([{
      turn_id: 'request', approved: true, failures: [], evaluation_error: null,
    }]);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('recovers from transient judge transport failures without misclassifying the turn', async () => {
    const base = GOLDEN_CASES[0]!;
    const scenario = { ...base, turns: [base.turns[0]!] };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({ verdict: {
          turn_id: 'greeting', approved: true, failures: [],
        } }),
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation()],
    })).resolves.toEqual([{
      turn_id: 'greeting', approved: true, failures: [], evaluation_error: null,
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('gives the semantic judge the effective backend action and recorded preconditions', async () => {
    const base = GOLDEN_CASES[9]!;
    const turn = base.turns.find((candidate) => candidate.id === 'available')!;
    const scenario = { ...base, turns: [turn] };
    let judgeInput: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { input: string };
      judgeInput = JSON.parse(request.input) as Record<string, unknown>;
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'available', approved: true, failures: [],
      } }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({
        move: null, proposedAction: null, backendAction: 'request_call_now',
        courseBonus: { enabled: true, maxBonusCourses: 3, mayOfferBonus: false, status: 'checkin_available' },
        priceObjectionMemory: { present: true, sourceMessageIds: ['p1'], priorSourceMessageIds: ['p1'] },
      })],
    });
    expect(judgeInput).toMatchObject({ actual: {
      backend_action: 'request_call_now',
      preconditions: {
        course_bonus: { enabled: true, maxBonusCourses: 3 },
        price_objection_memory: { priorSourceMessageIds: ['p1'] },
      },
    } });
    fetchMock.mockRestore();
  });

  it('does not let may_offer_call invalidate a requested call that the backend actually authorized', async () => {
    const base = GOLDEN_CASES[9]!;
    const turn = base.turns.find((candidate) => candidate.id === 'available')!;
    const scenario = { ...base, turns: [turn] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'available', approved: false, failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:0',
          authority_line_index: 0, evidence_source: 'preconditions', observed_evidence: '',
          explanation: 'may_offer_call es false.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({
        move: 'request_call', proposedAction: { type: 'request_call_now' },
        backendAction: 'request_call_now', mayOfferCall: false,
        workflow: { commitSucceeded: true, status: 'waiting_user', errorCode: null,
          finalBackendDecisionError: null },
      })],
    })).resolves.toEqual([{
      turn_id: 'available', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('presents the single-course rule atomically so an equipment question is not judged as a menu', async () => {
    const base = GOLDEN_CASES[2]!;
    const turn = base.turns.find((candidate) => candidate.id === 'recommend')!;
    const scenario = { ...base, turns: [turn] };
    let judgeRequest: { instructions?: string; input?: string } = {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      judgeRequest = JSON.parse(String(init?.body)) as { instructions?: string; input?: string };
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'recommend', approved: false, failures: [{
          code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:0',
          authority_line_index: 0, evidence_source: 'response',
          observed_evidence: 'cámara o edición',
          explanation: 'Abre un menú de contenidos.',
        }],
      } }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const verdicts = await judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({
        response: 'Fotografía Profesional encaja con cámara y edición. ¿Te interesa más cámara o edición?',
      })],
    });
    const judgeInput = JSON.parse(judgeRequest.input ?? '{}') as {
      requirements?: Array<{ text: string }>;
    };
    expect(judgeRequest.instructions).toContain(
      'preferencia entre contenidos de ese mismo curso (por ejemplo, cámara o edición) no equivale a abrir un menú',
    );
    expect(judgeInput.requirements?.map((item) => item.text)).toEqual(expect.arrayContaining([
      'No abrir un menú de cursos ni ofrecer varias opciones.',
      'No prometer ingresos ni clientes.',
      'No registrar la recomendación como elección del cliente.',
    ]));
    expect(verdicts).toEqual([{
      turn_id: 'recommend', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('distinguishes a price objection recorded now from one that already existed before the turn', async () => {
    const base = GOLDEN_CASES[13]!;
    const turn = base.turns.find((candidate) => candidate.id === 'price_1')!;
    const scenario = { ...base, turns: [turn] };
    let judgeRequest: { instructions?: string; input?: string } = {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      judgeRequest = JSON.parse(String(init?.body)) as { instructions?: string; input?: string };
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'price_1', approved: false, failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:1',
          authority_line_index: 0, evidence_source: 'preconditions', observed_evidence: '',
          explanation: 'No registró la objeción.',
        }],
      } }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const verdicts = await judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({
        priceObjectionMemory: {
          present: true, sourceMessageIds: ['current-turn'], priorSourceMessageIds: [],
        },
      })],
    });
    const judgeInput = JSON.parse(judgeRequest.input ?? '{}') as {
      actual?: { preconditions?: { price_objection_memory?: unknown } };
    };
    expect(judgeRequest.instructions).toContain(
      'present=true prueba que la objeción del turno actual o de la conversación quedó registrada',
    );
    expect(judgeInput.actual?.preconditions?.price_objection_memory).toEqual({
      present: true, sourceMessageIds: ['current-turn'], priorSourceMessageIds: [],
    });
    expect(verdicts).toEqual([{
      turn_id: 'price_1', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('treats a full name as name plus surname and judges premature plan choice separately', async () => {
    const base = GOLDEN_CASES[10]!;
    const turn = base.turns.find((candidate) => candidate.id === 'data')!;
    const scenario = { ...base, turns: [turn] };
    let judgeRequest: { instructions?: string; input?: string } = {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      judgeRequest = JSON.parse(String(init?.body)) as { instructions?: string; input?: string };
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'data', approved: false, failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:0',
          authority_line_index: 0, evidence_source: 'response', observed_evidence: '',
          explanation: 'No presenta apellido por separado.',
        }],
      } }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const verdicts = await judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({
        response: 'Tengo tus datos: Ana Pérez, ana.perez@example.test y +1 305 555 0182. ¿Están correctos?',
      })],
    });
    const judgeInput = JSON.parse(judgeRequest.input ?? '{}') as {
      requirements?: Array<{ text: string }>;
    };
    expect(judgeRequest.instructions).toContain(
      'Un nombre completo como "Ana Pérez" satisface nombre y apellido',
    );
    expect(judgeInput.requirements?.map((item) => item.text)).toEqual(expect.arrayContaining([
      'Mostrar un resumen que incluya el nombre y apellido recibidos, el correo y el teléfono.',
      'Pedir confirmación del resumen y esperar esa respuesta antes de preguntar el plan.',
      'No listar planes junto al resumen.',
    ]));
    expect(verdicts).toEqual([{
      turn_id: 'data', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('does not confuse commercial discovery with premature contact-data collection', async () => {
    const base = GOLDEN_CASES[7]!;
    const turn = base.turns.find((candidate) => candidate.id === 'context')!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'context', approved: false, failures: [{
          code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:1',
          authority_line_index: 0, evidence_source: 'response',
          observed_evidence: 'Qué vendés y por dónde querés empezar',
          explanation: 'Pide datos antes de tiempo.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, turns: [turn] },
      observations: [observation({
        response: 'Marketing Digital te sirve para ordenar tus redes. Qué vendés y por dónde querés empezar?',
        move: 'select_course',
      })],
    })).resolves.toEqual([{
      turn_id: 'context', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('does not let the contact-data filter hide an income promise', async () => {
    const base = GOLDEN_CASES[7]!;
    const turn = base.turns.find((candidate) => candidate.id === 'context')!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'context', approved: false, failures: [{
          code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:0',
          authority_line_index: 0, evidence_source: 'response',
          observed_evidence: 'te garantiza ingresos',
          explanation: 'Promete ingresos.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, turns: [turn] },
      observations: [observation({ response: 'Marketing Digital te garantiza ingresos.' })],
    })).resolves.toEqual([{
      turn_id: 'context', approved: false, evaluation_error: null,
      failures: [expect.objectContaining({ code: 'SEMANTIC_MUST_NOT_FAILED', requirement_index: 0 })],
    }]);
    fetchMock.mockRestore();
  });

  it('does not invert the rule that a recommendation must remain unselected', async () => {
    const base = GOLDEN_CASES[2]!;
    const turn = base.turns.find((candidate) => candidate.id === 'recommend')!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'recommend', approved: false, failures: [{
          code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:2',
          authority_line_index: 0, evidence_source: 'state',
          observed_evidence: '"selectedCourse":null',
          explanation: 'No se registró la recomendación como elección.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, turns: [turn] },
      observations: [observation({ state: {
        selectedCourse: null, stage: 'exploring', awaitingReply: 'none', plan: null,
        promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] },
      } })],
    })).resolves.toEqual([{
      turn_id: 'recommend', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('uses the deterministic question count for the Info turn', async () => {
    const base = GOLDEN_CASES[1]!;
    const turn = base.turns.find((candidate) => candidate.id === 'info')!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'info', approved: false, failures: [{
          code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:2',
          authority_line_index: 0, evidence_source: 'response',
          observed_evidence: 'Cuéntame qué te gustaría aprender',
          explanation: 'Hace varias preguntas.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, turns: [turn] },
      observations: [observation({
        response: 'Cuéntame qué te gustaría aprender. Qué área te llama más la atención?',
        move: 'browse_catalog',
      })],
    })).resolves.toEqual([{
      turn_id: 'info', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('accepts the real requested-call availability question with move=request_call and no action', async () => {
    const base = GOLDEN_CASES[9]!;
    const turn = base.turns.find((candidate) => candidate.id === 'data')!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'data', approved: false, failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:0',
          authority_line_index: 0, evidence_source: 'response', observed_evidence: '',
          explanation: 'Ofrece ahora o más tarde en lugar de preguntar disponibilidad.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, turns: [turn] },
      observations: [observation({
        response: 'Puedo llamarte ahora si estás disponible, o más tarde si te queda mejor. Cómo preferís?',
        move: 'request_call', proposedAction: { type: 'none' },
      })],
    })).resolves.toEqual([{
      turn_id: 'data', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('reports a cascaded promotion precondition instead of inventing a fourth-bonus violation', async () => {
    const base = GOLDEN_CASES[5]!;
    const turn = base.turns.find((candidate) => candidate.id === 'never_fourth')!;
    const current = observation({
      response: 'Junto con Fotografía Profesional te incluyo Fotografía con Celulares. Te sirve así?',
      state: {
        selectedCourse: 'fotografia_profesional', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: 'offer_available', bonusCount: 1, paidCourse: 'fotografia_profesional',
          bonusCourses: ['fotografia_celulares_tiendas_online'] },
      },
    });
    const previous = observation({
      state: {
        selectedCourse: 'fotografia_profesional', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] },
      },
    });

    expect(evaluateHardRules(turn, current, previous).failures).toEqual([expect.objectContaining({
      code: 'TURN_PRECONDITION_NOT_REACHED',
    })]);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, turns: [turn] },
      observations: [current],
    })).resolves.toEqual([{
      turn_id: 'never_fourth', approved: true, failures: [], evaluation_error: null,
    }]);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('uses the verified access event as evidence for the following acknowledgement', async () => {
    const base = GOLDEN_CASES[11]!;
    const previous = observation({
      response: 'Acceso activo: Fotografía Profesional, Marketing Digital.',
      availableOfferings: [{ code: 'fotografia_profesional', displayName: 'Fotografía Profesional' }],
      activeCourses: ['fotografia_profesional', 'marketing_digital'],
      workflow: { commitSucceeded: true, status: 'post_sale_notification_sent', errorCode: null,
        finalBackendDecisionError: null },
    });
    const acknowledgement = observation({
      response: 'Qué bueno que ya puedas entrar. El acceso a Fotografía Profesional quedó activo.',
      move: 'ask_current_state',
      state: {
        selectedCourse: 'fotografia_profesional', stage: 'payment_link_sent', awaitingReply: 'none',
        plan: 'monthly_12', promotion: { status: 'accepted', bonusCount: 2,
          paidCourse: 'fotografia_profesional', bonusCourses: ['marketing_digital', 'ingles_1'] },
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'verified_access_event', approved: true, failures: [],
      } }) }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'customer_acknowledgement', approved: false, failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:0', authority_line_index: 0,
          evidence_source: 'state', observed_evidence: '',
          explanation: 'El estado no prueba acceso activo.',
        }],
      } }) }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario: base,
      observations: [previous, acknowledgement],
    })).resolves.toEqual([
      { turn_id: 'verified_access_event', approved: true, failures: [], evaluation_error: null },
      { turn_id: 'customer_acknowledgement', approved: true, failures: [], evaluation_error: null },
    ]);
    fetchMock.mockRestore();
  });
});
