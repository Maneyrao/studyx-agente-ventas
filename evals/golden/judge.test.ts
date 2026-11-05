import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  evaluateHardRules,
  inferFailureAttribution,
  inferFailureLayer,
  judgeCaseSemantically,
  type GoldenTurnObservationV1,
} from './judge';
import { GOLDEN_CASES, type GoldenTurnV1 } from './scenarios';

const extraClosingBraceFixture = JSON.parse(readFileSync(new URL(
  './fixtures/judge-trailing-closing-brace-06-bonus-2.json', import.meta.url,
), 'utf8')) as {
  previous_observation: GoldenTurnObservationV1;
  observation: GoldenTurnObservationV1;
  responses: Array<{ call_id: string; output_text: string; expected_envelope: {
    verdict: { approved: false; failures: Array<{ explanation: string }> };
  } }>;
};

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

describe('judge failure kind follows the referenced requirement', () => {
  const evidenceRoot='../../docs/reports/evidence/2026-11-01-formal-acceptance-v149/raw/';
  const stem='acceptance-f1f0f9c-flash-full16-20261101';
  const provider=JSON.parse(readFileSync(new URL(`${evidenceRoot}${stem}-provider.json`,import.meta.url),'utf8')) as {
    report:{records:Array<{call_id:string;response_content:string}>};
  };
  const recorded=JSON.parse(readFileSync(new URL(`${evidenceRoot}${stem}-observations.partial.json`,import.meta.url),'utf8')) as {
    cases:Array<{scenario:{id:string};observations:GoldenTurnObservationV1[]}>;
  };
  const base=GOLDEN_CASES.find(scenario=>scenario.id==='13_real_syllabus')!;
  const scenario={...base,turns:base.turns.filter(turn=>turn.id==='duration_followup')};
  const current=recorded.cases.find(item=>item.scenario.id===base.id)!.observations[1]!;
  const calls=['call-0099','call-0100','call-0101','call-0102'];
  const outputs=calls.map(call_id=>({call_id,raw:provider.report.records.find(call=>call.call_id===call_id)!.response_content}));

  const evaluate=async(raw:string,actual=current)=>{
    const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({output_text:raw})));
    try{
      const result=await judgeCaseSemantically({apiKey:'offline-recorded-only',model:'test',scenario,observations:[actual]});
      return {verdict:result[0],requestCount:mock.mock.calls.length};
    }finally{mock.mockRestore();}
  };

  it.each(outputs)('resolves the recorded must_not/code mismatch from $call_id without retry or indeterminate',async({raw})=>{
    const result=await evaluate(raw);
    expect(result.verdict).toMatchObject({turn_id:'duration_followup',approved:false,evaluation_error:null,
      failures:[{code:'SEMANTIC_MUST_FAILED',requirement_index:0},{code:'SEMANTIC_MUST_NOT_FAILED',requirement_index:0}]});
    expect(result.requestCount).toBe(1);
  });

  const decoded=()=>JSON.parse(outputs[0]!.raw) as {verdict:{turn_id:string;approved:boolean;failures:Array<{
    code:string;requirement_id:string;authority_line_index:number;evidence_source:string;observed_evidence:string;explanation:string;
  }>}};

  it('uses must semantics when a must ID is paired with the opposite code and legitimately absent evidence',async()=>{
    const envelope=decoded();
    envelope.verdict.failures=[{...envelope.verdict.failures[0]!,code:'SEMANTIC_MUST_NOT_FAILED',observed_evidence:''}];
    const result=await evaluate(JSON.stringify(envelope));
    expect(result.verdict).toMatchObject({approved:false,evaluation_error:null,
      failures:[{code:'SEMANTIC_MUST_FAILED',requirement_index:0}]});
    expect(result.requestCount).toBe(1);
  });

  it.each(['must_not:999','must_not:00','unknown:0'])('keeps an unknown or noncanonical requirement ID invalid: %s',async requirement_id=>{
    const envelope=decoded();
    envelope.verdict.failures=[{...envelope.verdict.failures[1]!,requirement_id}];
    const result=await evaluate(JSON.stringify(envelope));
    expect(result.verdict).toMatchObject({approved:null,evaluation_error:'GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID',failures:[]});
  });

  it('still requires positive evidence for must_not after normalizing a misleading must code',async()=>{
    const envelope=decoded();
    envelope.verdict.failures=[{...envelope.verdict.failures[1]!,observed_evidence:''}];
    const result=await evaluate(JSON.stringify(envelope));
    expect(result.verdict).toMatchObject({approved:null,evaluation_error:'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID',failures:[]});
  });

  it('still rejects a fabricated quotation after normalizing the failure kind',async()=>{
    const envelope=decoded();
    envelope.verdict.failures=[{...envelope.verdict.failures[1]!,observed_evidence:'Este texto nunca fue entregado.'}];
    const result=await evaluate(JSON.stringify(envelope));
    expect(result.verdict).toMatchObject({approved:null,evaluation_error:'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID',failures:[]});
  });
});

describe('golden judge recorded JSON boundary', () => {
  const base = GOLDEN_CASES[5]!;
  const scenario = { ...base, evaluationMode:undefined, turns: base.turns.filter((turn) => ['bonus_1', 'bonus_2'].includes(turn.id)) };
  const observations = [extraClosingBraceFixture.previous_observation, extraClosingBraceFixture.observation];
  const mockRecordedResponse = (output: string) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      text: { format: { schema: { properties: { verdict: { properties: { turn_id: { enum: string[] } } } } } } };
    };
    const content = request.text.format.schema.properties.verdict.properties.turn_id.enum[0] === 'bonus_1'
      ? JSON.stringify({ verdict: { turn_id: 'bonus_1', approved: true, failures: [] } }) : output;
    return new Response(JSON.stringify({ output_text: content }), { status: 200 });
  });

  it.each(extraClosingBraceFixture.responses)('recovers only the redundant final brace from recorded response $call_id without changing its failed verdict', async (fixture) => {
    expect(() => JSON.parse(fixture.output_text)).toThrow();
    const fetchMock = mockRecordedResponse(fixture.output_text);
    try {
      const verdicts = await judgeCaseSemantically({ apiKey: 'fixture-only', model: 'deepseek-test', scenario, observations });
      expect(verdicts[1]).toEqual({
        turn_id: 'bonus_2', approved: false, evaluation_error: null,
        failures: [expect.objectContaining({
          code: 'SEMANTIC_MUST_FAILED', requirement_index: 0,
          authority_reference: expect.stringContaining('docs/authority/prompt-agente-a-studyx-v2.md:'),
          explanation: fixture.expected_envelope.verdict.failures[0]!.explanation,
        })],
        format_recovery: { kind: 'trailing_closing_brace_removed', raw_response: fixture.output_text },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { fetchMock.mockRestore(); }
  });

  const validEnvelope = JSON.stringify(extraClosingBraceFixture.responses[0]!.expected_envelope);
  it('keeps the same semantic failure for the strict valid counterpart without a recovery diagnostic', async () => {
    const fetchMock = mockRecordedResponse(validEnvelope);
    try {
      const verdicts = await judgeCaseSemantically({ apiKey: 'fixture-only', model: 'deepseek-test', scenario, observations });
      expect(verdicts[1]).toEqual({
        turn_id: 'bonus_2', approved: false, evaluation_error: null,
        failures: [expect.objectContaining({
          code: 'SEMANTIC_MUST_FAILED', requirement_index: 0,
          explanation: extraClosingBraceFixture.responses[0]!.expected_envelope.verdict.failures[0]!.explanation,
        })],
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { fetchMock.mockRestore(); }
  });

  it.each([
    ['two excess braces', `${validEnvelope}}}`],
    ['truncated object', validEnvelope.slice(0, -1)],
    ['concatenated objects', `${validEnvelope}${validEnvelope}`],
    ['additional text', `${validEnvelope} explanation`],
    ['code fence', `\`\`\`json\n${validEnvelope}\n\`\`\``],
  ])('rejects %s without fabricating a verdict', async (_label, output) => {
    const fetchMock = mockRecordedResponse(output);
    try {
      const verdicts = await judgeCaseSemantically({ apiKey: 'fixture-only', model: 'deepseek-test', scenario, observations });
      expect(verdicts[1]).toEqual({ turn_id: 'bonus_2', approved: null, failures: [], evaluation_error: expect.any(String) });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally { fetchMock.mockRestore(); }
  });

  it('still rejects recovered JSON with incoherent approval', async () => {
    const envelope = structuredClone(extraClosingBraceFixture.responses[0]!.expected_envelope);
    const output = JSON.stringify({ verdict: { ...envelope.verdict, turn_id: 'bonus_2', approved: true } }) + '}';
    const fetchMock = mockRecordedResponse(output);
    try {
      const verdicts = await judgeCaseSemantically({ apiKey: 'fixture-only', model: 'deepseek-test', scenario, observations });
      expect(verdicts[1]).toEqual({ turn_id: 'bonus_2', approved: null, failures: [], evaluation_error: 'GOLDEN_JUDGE_VERDICT_INCOHERENT' });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally { fetchMock.mockRestore(); }
  });

  it.each([
    ['authority_line_index', 999, 'GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID'],
    ['requirement_id', 'must:999', 'GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID'],
    ['evidence_source', 'invented_source', 'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID'],
  ])('retains %s validation after syntax recovery', async (field, value, error) => {
    const envelope = extraClosingBraceFixture.responses[0]!.expected_envelope;
    const output = JSON.stringify({ verdict: { ...envelope.verdict, turn_id: 'bonus_2', failures: [{
      ...envelope.verdict.failures[0], [field]: value,
    }] } }) + '}';
    const fetchMock = mockRecordedResponse(output);
    try {
      const verdicts = await judgeCaseSemantically({ apiKey: 'fixture-only', model: 'deepseek-test', scenario, observations });
      expect(verdicts[1]).toEqual({ turn_id: 'bonus_2', approved: null, failures: [], evaluation_error: error });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally { fetchMock.mockRestore(); }
  });

  it('retains observed-evidence validation for a recovered must_not failure', async () => {
    const envelope = extraClosingBraceFixture.responses[0]!.expected_envelope;
    const output = JSON.stringify({ verdict: { ...envelope.verdict, turn_id: 'bonus_2', failures: [{
      ...envelope.verdict.failures[0], code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:0',
      observed_evidence: 'This phrase is absent from the actual response.',
    }] } }) + '}';
    const fetchMock = mockRecordedResponse(output);
    try {
      const verdicts = await judgeCaseSemantically({ apiKey: 'fixture-only', model: 'deepseek-test', scenario, observations });
      expect(verdicts[1]).toEqual({ turn_id: 'bonus_2', approved: null, failures: [], evaluation_error: 'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID' });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally { fetchMock.mockRestore(); }
  });
});

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
    const turn = GOLDEN_CASES[5]!.turns.find((item) => item.id === 'isolate')!;
    const failed = evaluateHardRules(turn, observation({
      response: 'Puedo sumar otro curso.',
      proposedAction: { type: 'offer_course_bonus', bonus_offering_code: 'camaras_seguridad' },
      backendAction: 'offer_course_bonus',
      state: { selectedCourse: 'fotografia_profesional', stage: 'course_selected', awaitingReply: 'none', plan: null,
        promotion: { status: 'offer_available', bonusCount: 4,
          paidCourse: 'fotografia_profesional', bonusCourses: ['diseno_photoshop'] } },
    }));
    expect(failed.failures.map((item) => item.code)).toContain('BONUS_AFFINITY_MISMATCH');
    expect(failed.failures.map((item) => item.code)).toContain('PROMOTION_BONUS_COUNT_MISMATCH');
  });

  it('14/installments: an offered bonus must be named in the delivered copy (H1)', () => {
    const turn = GOLDEN_CASES.find((item) => item.id.startsWith('14_'))!.turns.find((item) => item.id === 'installments')!;
    const base = {
      proposedAction: { type: 'offer_course_bonus', bonus_offering_code: 'instagram_emprendedores' }, backendAction: 'offer_course_bonus',
      availableOfferings: [{ code: 'instagram_emprendedores', displayName: 'Instagram para Emprendedores' }],
    };
    const unnamed = evaluateHardRules(turn, observation({ ...base, response: 'Te sumo otro curso, el de Inglés. Avanzamos?' }));
    expect(unnamed.failures.map((item) => item.code)).toContain('BONUS_NOT_NAMED');
    const named = evaluateHardRules(turn, observation({ ...base, response: 'Te sumo instagram para emprendedores. Avanzamos?' }));
    expect(named.failures.map((item) => item.code)).not.toContain('BONUS_NOT_NAMED');
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
    const turn = GOLDEN_CASES[5]!.turns.find((candidate) => candidate.id === 'installments')!;
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
      priceObjectionMemory: { present: false, sourceMessageIds: [], priorSourceMessageIds: [] },
    });
    // Model-owned sales (AGENTS.md:154): an objection quoted in the current turn is price evidence too.
    expect(evaluateHardRules(turn, { ...eligible, priceObjectionMemory: { present: true, sourceMessageIds: ['current'], priorSourceMessageIds: [] } })
      .failures.map((failure) => failure.code)).not.toContain('BONUS_PRIOR_PRICE_OBJECTION_MISSING');
    expect(ineligible.failures.map((failure) => failure.code)).toEqual(expect.arrayContaining([
      'BONUS_CONFIGURATION_DISABLED',
      'BONUS_MAX_COURSES_CONFIG_MISMATCH',
      'BONUS_PRIOR_PRICE_OBJECTION_MISSING',
    ]));
  });

  it('marks only the affected turn as evaluator error when the judge cannot cite a real authority line', async () => {
    const base = GOLDEN_CASES[0]!;
    const scenario = { ...base, evaluationMode:undefined, turns: [base.turns[0]!] };
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
    const scenario = { ...base, evaluationMode:undefined, turns: [base.turns[0]!] };
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
    const scenario = { ...base, evaluationMode:undefined, turns: [base.turns[0]!] };
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
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, evaluationMode:undefined, turns: [turn] },
      observations: [observation({ response: '' })],
    })).resolves.toEqual([{
      turn_id: 'request', approved: true, failures: [], evaluation_error: null,
    }]);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('recovers from transient judge transport failures without misclassifying the turn', async () => {
    const base = GOLDEN_CASES[0]!;
    const scenario = { ...base, evaluationMode:undefined, turns: [base.turns[0]!] };
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
    const scenario = { ...base, evaluationMode:undefined, turns: [turn] };
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
    const scenario = { ...base, evaluationMode:undefined, turns: [turn] };
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

  it('does not attribute a canonical backend-appended payment URL to Agent A', async () => {
    const base = GOLDEN_CASES[10]!;
    const turn = base.turns.find((candidate) => candidate.id === 'plan_and_link')!;
    const scenario = { ...base, evaluationMode:undefined, turns: [turn] };
    const canonicalLink = 'https://buy.stripe.com/test_studyx_golden_12m';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ verdict: {
        turn_id: 'plan_and_link', approved: false, failures: [{
          code: 'SEMANTIC_MUST_NOT_FAILED', requirement_id: 'must_not:0',
          authority_line_index: 0, evidence_source: 'response', observed_evidence: canonicalLink,
          explanation: 'La respuesta contiene una URL.',
        }],
      } }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(judgeCaseSemantically({
      apiKey: 'test', model: 'deepseek-test', scenario,
      observations: [observation({
        response: `Perfecto, acá tienes el enlace para completar la inscripción.\n\n${canonicalLink}`,
        move: 'select_payment_plan',
        proposedAction: {
          type: 'send_payment_link',
          offering_code: 'fotografia_profesional',
          payment_plan: 'monthly_12',
        },
        backendAction: 'send_payment_link',
        deliveredLinks: [canonicalLink],
      })],
    })).resolves.toEqual([{
      turn_id: 'plan_and_link', approved: true, failures: [], evaluation_error: null,
    }]);
    fetchMock.mockRestore();
  });

  it('presents the single-course rule atomically so an equipment question is not judged as a menu', async () => {
    const base = GOLDEN_CASES[2]!;
    const turn = base.turns.find((candidate) => candidate.id === 'recommend')!;
    const scenario = { ...base, evaluationMode:undefined, turns: [turn] };
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
    const scenario = { ...base, evaluationMode:undefined, turns: [turn] };
    let judgeRequest: { instructions?: string; input?: string } = {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      judgeRequest = JSON.parse(String(init?.body)) as { instructions?: string; input?: string };
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'price_1', approved: false, failures: [{
          code: 'SEMANTIC_MUST_FAILED', requirement_id: 'must:0',
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
    const scenario = { ...base, evaluationMode:undefined, turns: [turn] };
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
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, evaluationMode:undefined, turns: [turn] },
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
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, evaluationMode:undefined, turns: [turn] },
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
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, evaluationMode:undefined, turns: [turn] },
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
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, evaluationMode:undefined, turns: [turn] },
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
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, evaluationMode:undefined, turns: [turn] },
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
      apiKey: 'test', model: 'deepseek-test', scenario: { ...base, evaluationMode:undefined, turns: [turn] },
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


describe('negotiation invariant judge mode',()=>{
  it('keeps the other fourteen cases in legacy mode',()=>{
    expect(GOLDEN_CASES.filter(c=>c.evaluationMode).map(c=>c.id.slice(0,2))).toEqual(['06','14']);
  });
  it('does not enforce incidental move/action turn labels in invariant mode',()=>{
    const t=GOLDEN_CASES[5]!.turns.find(t=>t.id==='bonus_1')!;
    expect(evaluateHardRules(t,observation(),null,'negotiation_invariants').failures).toEqual([]);
    expect(evaluateHardRules(t,observation()).failures.length).toBeGreaterThan(0);
  });
  it('checks enabled/max-course facts dynamically for a bonus on any turn',()=>{
    const t=GOLDEN_CASES[5]!.turns[0]!;
    const o=observation({proposedAction:{type:'offer_course_bonus'},backendAction:'offer_course_bonus',courseBonus:{enabled:false,maxBonusCourses:2,mayOfferBonus:false,status:'unavailable'},priceObjectionMemory:{present:true,sourceMessageIds:['prior'],priorSourceMessageIds:['prior']}});
    const hard=evaluateHardRules(t,o,null,'negotiation_invariants');
    expect(hard.failures.map(f=>f.code)).toEqual(expect.arrayContaining(['BONUS_CONFIGURATION_DISABLED','BONUS_MAX_COURSES_CONFIG_MISMATCH']));
  });
  it('retains current objection memory and unrelated hard facts in invariant mode',()=>{
    const t=GOLDEN_CASES[5]!.turns.find(t=>t.id==='value')!;
    const failures=evaluateHardRules(t,observation({priceObjectionMemory:{present:false,sourceMessageIds:[],priorSourceMessageIds:[]}}),null,'negotiation_invariants').failures;
    expect(failures.map(f=>f.code)).toContain('CURRENT_PRICE_OBJECTION_NOT_RECORDED');
  });
  it('discards a false bonus obligation when structural Rule A evidence says the first objection is not eligible',async()=>{
    const base=GOLDEN_CASES[5]!;
    const sourceTurn=base.turns.find(turn=>turn.id==='value')!;
    const scenario={...base,turns:[sourceTurn]};
    const actual=observation({
      response:'Te entiendo. Son 41 clases y podés pagarlo en 12 cuotas de USD 30. El precio es el único inconveniente? Puedo revisar una promoción.',
      backendAction:null,
      ruleOutcomes:{rule_a:'not_applicable',rule_b:'rewrite'},
      ruleBonusBeforeTurn:{paid_offering_code:'fotografia_profesional',bonus_offering_code:'diseno_photoshop',position:1},
      courseBonus:{enabled:true,maxBonusCourses:3,mayOfferBonus:false,status:'checkin_available'},
      priceObjectionMemory:{present:true,sourceMessageIds:['current'],priorSourceMessageIds:[]},
      negotiationFacts:{currentTurnId:'current',priorPriceSourceIds:[],currentPriceObjectionQuoted:true,
        currentPriceObjectionPersisted:true,priceOnlyBarrierConfirmed:false,
        ladder:{eligible:false,observed_price_objection_count:0,required_price_objection_count:2,
          call_invitation_status:'not_offered',call_offer_count:0,may_offer_call:true,
          missing_steps:['recorded_price_objections'],price_only_barrier_confirmed:false}},
      workflow:{commitSucceeded:true,status:'waiting_user',errorCode:null,finalBackendDecisionError:null},
    });
    const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const payload=JSON.parse(JSON.parse(String(init?.body)).input);
      return new Response(JSON.stringify({output_text:JSON.stringify({verdict:{turn_id:payload.turn_id,approved:false,failures:[
        {code:'SEMANTIC_MUST_FAILED',requirement_id:'must:1',authority_line_index:0,evidence_source:'preconditions',observed_evidence:'\"eligible\":false',explanation:'Se debió bonificar.'},
        {code:'SEMANTIC_MUST_FAILED',requirement_id:'must:2',authority_line_index:0,evidence_source:'response',observed_evidence:'',explanation:'Faltó presentar el curso.'},
      ]}})}),{status:200});
    });
    try{
      const [verdict]=await judgeCaseSemantically({apiKey:'offline',model:'test',scenario,observations:[actual]});
      expect(verdict).toEqual({turn_id:'value',approved:true,failures:[],evaluation_error:null});
    }finally{mock.mockRestore();}
  });
  it('sends delivered chronological history and generation facts without skipping changed preconditions',async()=>{
    const base=GOLDEN_CASES[5]!;
    const scenario={...base,turns:[base.turns[0]!,base.turns.at(-1)!]};
    const payloads:Array<Record<string,unknown>>=[];
    const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const body=JSON.parse(String(init?.body));const payload=JSON.parse(body.input);payloads.push(payload);
      return new Response(JSON.stringify({output_text:JSON.stringify({verdict:{turn_id:payload.turn_id,approved:true,failures:[]}})}),{status:200});
    });
    try{
      const facts={currentTurnId:'t',priorPriceSourceIds:['a','b','c'],ladder:{eligible:true,observed_price_objection_count:3,required_price_objection_count:3 as const,call_invitation_status:'offered',call_offer_count:1,may_offer_call:true,missing_steps:[]}};
      await judgeCaseSemantically({apiKey:'offline-mock',model:'test',scenario,observations:[observation({negotiationFacts:facts}),observation({negotiationFacts:facts})]});
      expect(mock).toHaveBeenCalledTimes(2);
      expect(payloads[1]!.delivered_history).toHaveLength(2);
      expect(payloads[1]!.negotiation_ledger).toEqual(expect.arrayContaining([expect.objectContaining({ladder:facts.ladder})]));
      expect(JSON.stringify(payloads[1]!.requirements)).not.toContain('Mantener el paquete acumulado de tres');
      expect(JSON.stringify(payloads[1]!.requirements)).toContain('aislamiento');
      expect(JSON.stringify(payloads[1]!.requirements)).toContain('insinuar');
      expect(JSON.stringify(payloads[1]!.requirements)).toContain('de regalo');
      expect(JSON.stringify(payloads[1]!.requirements)).toContain('evitar responder por chat');
      expect(JSON.stringify(payloads[1]!.requirements)).toContain('repetir sólo');
    }finally{mock.mockRestore();}
  });
});


describe('negotiation historical evidence boundary',()=>{
  it.each([false,true])('validates historical quotes and carries each turn facts independently (fake=%s)',async(fake)=>{
    const base=GOLDEN_CASES[13]!;const scenario={...base,turns:[base.turns[0]!,base.turns.at(-1)!]};
    const payloads:Array<Record<string,unknown>>=[];
    const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
      const body=JSON.parse(String(init?.body));const input=JSON.parse(body.input);payloads.push(input);
      const first=input.turn_id===scenario.turns[0]!.id;
      return new Response(JSON.stringify({output_text:JSON.stringify({verdict:{turn_id:input.turn_id,approved:first,failures:first?[]:[{
        code:'SEMANTIC_MUST_NOT_FAILED',requirement_id:'must_not:0',authority_line_index:0,evidence_source:'delivered_history',observed_evidence:fake?'cita histórica inventada':'Antes ofrecí un extra sin acción',explanation:'Una oferta implícita sin efecto quedó en el historial entregado.'
      }]}})}),{status:200});
    });
    try{
      const facts=[{id:'photo:fact',kind:'duration',value:'Dato anterior fotografía'}];
      const verdicts=await judgeCaseSemantically({apiKey:'offline-mock',model:'test',scenario,observations:[observation({response:'Antes ofrecí un extra sin acción',authorizedFacts:facts,usedFactIds:['photo:fact']}),observation({response:'Ahora Marketing Digital',authorizedFacts:[{id:'marketing:fact',kind:'duration',value:'Otro dato'}]})]});
      const history=payloads[1]!.delivered_history as Array<{authorizedFacts:unknown;usedFactIds:unknown}>;
      expect(history[0]!.authorizedFacts).toEqual(facts);expect(history[0]!.usedFactIds).toEqual(['photo:fact']);
      if(fake)expect(verdicts[1]).toMatchObject({approved:null,evaluation_error:'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID'});
      else expect(verdicts[1]).toMatchObject({approved:false,failures:[expect.objectContaining({code:'SEMANTIC_MUST_NOT_FAILED'})]});
    }finally{mock.mockRestore();}
  });
});

describe('semantic judge delivered-outcome boundary', () => {
  const scenario = {
    ...GOLDEN_CASES[13]!, evaluationMode: undefined,
    turns: [{ ...GOLDEN_CASES[13]!.turns[0]!, id: 'delivered', priorPromotion: undefined,
      must: ['Responder mediante un turno autorizado y entregado.'],
      mustNot: ['No ofrecer una bonificación sin acción autorizada ni presentarla como excepción personal.'],
      authority: [{ file: 'docs/authority/prompt-agente-a-studyx-v2.md' as const,
        start: 129, end: 129, contains: 'Sin desesperación' }],
    }],
  };

  it('excludes repaired rejections and rejected model declarations from normative evidence', async () => {
    let payload: Record<string, unknown> = {};
    let sources: readonly string[] = [];
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)); payload = JSON.parse(request.input);
      sources = request.text.format.schema.properties.verdict.properties.failures.items.properties.evidence_source.enum;
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'delivered', approved: true, failures: [],
      } }) }));
    });
    try {
      const result = await judgeCaseSemantically({ apiKey: 'offline', model: 'test',
        scenario: { ...scenario, evaluationMode: 'negotiation_invariants' },
        observations: [observation({ response: 'Podemos verlo juntos en una llamada corta. Te sirve?',
          move: 'REJECTED_ONLY_MOVE', proposedAction: { type: 'offer_course_bonus', bonus_offering_code: 'REJECTED_ONLY_COURSE' },
          backendAction: 'none', backendRejections: [{ code: 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID', subject: 'REJECTED_ONLY_REJECTION' }],
          workflow: { commitSucceeded: true, status: 'waiting_user', errorCode: null, finalBackendDecisionError: null },
          negotiationFacts: { ladder: { eligible: false, observed_price_objection_count: 3,
            required_price_objection_count: 3, call_invitation_status: 'not_offered',
            call_offer_count: 0, may_offer_call: true, missing_steps: ['call_invitation'] } },
          modelAttempts: [{ attempt: 1, response: 'REJECTED_ONLY_TEXT', move: 'request_call', proposedAction: null,
            turnRejection: null, providerStatus: 200, providerError: null }],
        })] });
      expect(result[0]).toMatchObject({ approved: true, evaluation_error: null });
      expect(JSON.stringify(payload)).not.toContain('REJECTED_ONLY');
      expect(payload).toMatchObject({ actual: { response: 'Podemos verlo juntos en una llamada corta. Te sirve?',
        backend_action: 'none', delivery_result: { commitSucceeded: true, finalBackendDecisionError: null },
        preconditions: { negotiation_ladder_before_turn: { call_invitation_status: 'not_offered', call_offer_count: 0 } } },
      delivered_history: [expect.objectContaining({ response: 'Podemos verlo juntos en una llamada corta. Te sirve?',
        ladder: expect.objectContaining({ call_invitation_status: 'not_offered', call_offer_count: 0 }) })] });
      expect(sources).not.toContain('backend_rejections');
      expect(sources).not.toContain('proposed_action');
      expect(sources).not.toContain('move');
    } finally { mock.mockRestore(); }
  });

  it('retains a final unresolved commit failure as outcome evidence', async () => {
    let payload: Record<string, unknown> = {};
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      payload = JSON.parse(JSON.parse(String(init?.body)).input);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'delivered', approved: false, failures: [{ code: 'SEMANTIC_MUST_FAILED',
          requirement_id: 'must:0', authority_line_index: 0, evidence_source: 'delivery_result',
          observed_evidence: 'FINAL_COMMIT_FORBIDDEN', explanation: 'El commit final no fue autorizado.' }],
      } }) }));
    });
    try {
      const verdict = await judgeCaseSemantically({ apiKey: 'offline', model: 'test', scenario,
        observations: [observation({ response: 'Quiero ayudarte a continuar.',
          backendRejections: [{ subject: 'REJECTED_ONLY_HISTORY' }],
          workflow: { commitSucceeded: false, status: 'retry_pending', errorCode: 'DECISION_REJECTED',
            finalBackendDecisionError: 'FINAL_COMMIT_FORBIDDEN' },
        })] });
      expect(verdict[0]).toMatchObject({ approved: false, evaluation_error: null,
        failures: [expect.objectContaining({ code: 'SEMANTIC_MUST_FAILED' })] });
      expect(payload).toMatchObject({ actual: { delivery_result: {
        commitSucceeded: false, finalBackendDecisionError: 'FINAL_COMMIT_FORBIDDEN' } } });
      expect(JSON.stringify(payload)).not.toContain('REJECTED_ONLY_HISTORY');
    } finally { mock.mockRestore(); }
  });

  it('does not accept a failure sourced only from a rejected attempt', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
      turn_id: 'delivered', approved: false, failures: [{ code: 'SEMANTIC_MUST_NOT_FAILED',
        requirement_id: 'must_not:0', authority_line_index: 0, evidence_source: 'backend_rejections',
        observed_evidence: 'forbidden_promise', explanation: 'El primer intento falló.' }],
    } }) })));
    try {
      const result = await judgeCaseSemantically({ apiKey: 'offline', model: 'test', scenario,
        observations: [observation({ response: 'Seguimos con el curso principal.',
          backendRejections: [{ subject: 'forbidden_promise' }],
          workflow: { commitSucceeded: true, status: 'waiting_user', errorCode: null, finalBackendDecisionError: null },
        })] });
      expect(result[0]).toMatchObject({ approved: null, evaluation_error: 'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID' });
    } finally { mock.mockRestore(); }
  });

  it('rejects a must failure that quotes a rejected draft as if it were delivered', async () => {
    const rejectedDraft = 'No ofrezco la llamada pendiente.';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
      turn_id: 'delivered', approved: false, failures: [{ code: 'SEMANTIC_MUST_FAILED',
        requirement_id: 'must:0', authority_line_index: 0, evidence_source: 'response',
        observed_evidence: rejectedDraft, explanation: 'El borrador rechazado no ofreció llamada.' }],
    } }) })));
    try {
      const result = await judgeCaseSemantically({ apiKey: 'offline', model: 'test', scenario,
        observations: [observation({ response: 'Podemos verlo juntos por teléfono. Te sirve?',
          modelAttempts: [{ attempt: 1, response: rejectedDraft, move: 'request_call', proposedAction: null,
            turnRejection: null, providerStatus: 200, providerError: null }],
          workflow: { commitSucceeded: true, status: 'waiting_user', errorCode: null, finalBackendDecisionError: null },
        })] });
      expect(result[0]).toMatchObject({ approved: null, evaluation_error: 'GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID' });
    } finally { mock.mockRestore(); }
  });

  it.each([false, true])('scopes bonus wording to the referent while preserving unsupported gift failures (gift=%s)', async (gift) => {
    const response = gift ? 'Te incluyo Inglés 1 gratis. Te dejo el enlace para inscribirte.'
      : 'Te dejo el enlace para completar tu inscripción.';
    let payload: Record<string, unknown> = {};
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      payload = JSON.parse(JSON.parse(String(init?.body)).input);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: {
        turn_id: 'delivered', approved: !gift, failures: gift ? [{ code: 'SEMANTIC_MUST_NOT_FAILED',
          requirement_id: 'must_not:0', authority_line_index: 0, evidence_source: 'response',
          observed_evidence: 'Te incluyo Inglés 1 gratis', explanation: 'Incluye un curso sin acción ni paquete autorizado.' }] : [],
      } }) }));
    });
    try {
      const result = await judgeCaseSemantically({ apiKey: 'offline', model: 'test', scenario,
        observations: [observation({ response, backendAction: gift ? 'none' : 'send_payment_link',
          workflow: { commitSucceeded: true, status: 'waiting_user', errorCode: null, finalBackendDecisionError: null },
        })] });
      expect(result[0]).toMatchObject({ approved: !gift, evaluation_error: null });
      expect(payload).toMatchObject({ authority_scope: { bonus_tone: {
        authority_line: 129, applies_to: 'bonus_or_personal_exception', ordinary_link_delivery_is_bonus: false,
      } } });
      if (gift) expect(result[0]?.failures).toHaveLength(1);
    } finally { mock.mockRestore(); }
  });
});

describe('cases 29-41 hard rules (current-message bonus motive, package, programme documents)', () => {
  const turnWith = (customer: string, hard: GoldenTurnV1['hard'], over: Partial<GoldenTurnV1['expected']> = {}): GoldenTurnV1 => ({
    id: 't', customer, must: [], mustNot: [], authority: [],
    expected: { move: ['greeting', 'price_objection', 'ask_course_information'], action: ['none', 'offer_course_bonus', 'send_course_program'], state: {}, ...over }, hard });
  const codes = (turn: GoldenTurnV1, current: GoldenTurnObservationV1, previous: GoldenTurnObservationV1 | null = null) =>
    evaluateHardRules(turn, current, previous).failures.map(failure => failure.code);
  const offering = (quote: string, kind = 'price_objection', move = 'price_objection') => observation({
    move, backendAction: 'offer_course_bonus', response: 'Te sumo Community Manager.',
    proposedAction: { type: 'offer_course_bonus', bonus_offering_code: 'community_manager', interest_offering_code: 'marketing_digital', motive: { kind, quote } } });

  it('bonus_motive_current_message: the quote must be literal in this message and agree with the move', () => {
    const turn = turnWith('igual sigue siendo caro', [{ type: 'bonus_motive_current_message' }]);
    expect(codes(turn, offering('sigue siendo caro'))).toEqual([]);
    expect(codes(turn, offering('es caro, no me alcanza'))).toContain('BONUS_MOTIVE_NOT_IN_CURRENT_MESSAGE');
    expect(codes(turn, offering('sigue siendo caro', 'price_objection', 'ask_course_information'))).toContain('BONUS_MOTIVE_MOVE_INCOHERENT');
    expect(codes(turn, observation({ move: 'price_objection' }))).toEqual([]);
  });
  it('package_unchanged and no_new_bonus compare with the previous turn (cycle, version, courses)', () => {
    const promotion = (over: object) => ({ status: 'offer_available', bonusCount: 1, paidCourse: 'marketing_digital', bonusCourses: ['community_manager'], cycleId: 'c1', offerVersion: 1, ...over });
    const before = observation({ state: { ...observation().state, promotion: promotion({}) } });
    const turn = turnWith('x', [{ type: 'package_unchanged' }, { type: 'no_new_bonus' }]);
    expect(codes(turn, before, before)).toEqual([]);
    const bumped = observation({ state: { ...observation().state, promotion: promotion({ bonusCount: 2, bonusCourses: ['community_manager', 'oratoria'], offerVersion: 2 }) } });
    expect(codes(turn, bumped, before)).toEqual(expect.arrayContaining(['PACKAGE_CHANGED', 'NEW_BONUS_UNEXPECTED']));
  });
  it('program documents, links, plans and prefab CTAs', () => {
    expect(codes(turnWith('x', [{ type: 'program_document_sent', value: 'marketing_digital' }]), observation())).toContain('PROGRAM_DOCUMENT_MISSING');
    expect(codes(turnWith('x', [{ type: 'program_document_sent', value: 'marketing_digital' }]), observation({ programDocuments: ['marketing_digital'] }))).toEqual([]);
    expect(codes(turnWith('x', [{ type: 'no_program_document' }]), observation({ programDocuments: ['marketing_digital'] }))).toContain('PROGRAM_DOCUMENT_UNEXPECTED');
    expect(codes(turnWith('x', [{ type: 'no_link_delivered' }]), observation({ deliveredLinks: ['https://pay.example/1'] }))).toContain('LINK_UNEXPECTED');
    const link = (plan: string) => observation({ proposedAction: { type: 'send_payment_link', payment_plan: plan } });
    const linkTurn = turnWith('x', [{ type: 'link_plan_in', values: ['monthly_12'] }], { action: ['send_payment_link'] });
    expect(codes(linkTurn, link('monthly_12'))).toEqual([]);
    expect(codes(linkTurn, link('one_time'))).toContain('LINK_PLAN_MISMATCH');
    expect(codes(turnWith('x', [{ type: 'no_prefab_cta' }]), observation({ response: 'Con cuál plan te gustaría avanzar?' }))).toContain('PREFAB_CTA_PRESENT');
  });
});
