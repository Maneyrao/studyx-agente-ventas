import { describe, expect, it } from 'vitest';
import { evaluatePersistenceEvidence } from '../../../scripts/lib/agent-a-persistence-verifier';

const RUN_ID = 'runX';

function buyerCase() {
  return {
    id: 'real_01',
    name: 'Cliente indeciso',
    course: 'Excel Integral',
    customer: {
      first_name: 'Bruno',
      last_name: 'Aguilar',
      email: 'bruno.real_01+{{run_id}}@example.com',
    },
    turns: ['Hola', 'Quiero Excel', 'Soy Bruno Aguilar, bruno.real_01+{{run_id}}@example.com.'],
    ideal_result: {
      registered_contact: true,
      expected_interest: 'Excel Integral',
      min_active_memories: 1,
      sheet_rows: 1,
      plan_code: 'monthly_12' as const,
    },
  };
}

function completeEvidence() {
  return {
    contactId: 'contact-1',
    phone: '+999123456789012',
    contactName: 'Bruno Aguilar',
    contactEmail: `bruno.real_01+${RUN_ID}@example.com`,
    sandboxRegistered: true,
    inboundMessages: 3,
    outboundMessages: 3,
    decisions: 3,
    decisionsWithTrace: 3,
    activeMemoryValues: ['Quiere estudiar Excel Integral'],
    readyMemoryEmbeddings: 1,
    sheetRows: [{
      plan: 'monthly_12',
      courseInterest: 'Excel Integral',
      state: 'pending',
      nombre: 'Bruno',
      apellido: 'Aguilar',
      email: `bruno.real_01+${RUN_ID}@example.com`,
    }],
    promptVersions: ['studyx-agent-a-sales-v11'],
    technicalFallbacks: 0,
    runScope: {
      sandboxExternalUserId: `eval:${RUN_ID}:real_01`,
      externalConversationId: `local-eval-${RUN_ID}-conversation-1`,
      conversationId: 'conversation-db-1',
    },
    turnEvidence: [
      { turnNumber: 1, turnId: 'turn-1', decisionId: 'decision-1', traceId: 'trace-1', outboundMessageId: 'out-1' },
      { turnNumber: 2, turnId: 'turn-2', decisionId: 'decision-2', traceId: 'trace-2', outboundMessageId: 'out-2' },
      { turnNumber: 3, turnId: 'turn-3', decisionId: 'decision-3', traceId: 'trace-3', outboundMessageId: 'out-3' },
    ],
  };
}

describe('Agent A durable conversation evidence', () => {
  it('accepts a distinct sandbox contact with complete turn, memory, identity and projection evidence', () => {
    const result = evaluatePersistenceEvidence(buyerCase(), completeEvidence(), { runId: RUN_ID });

    expect(result.failures).toEqual([]);
    expect(result.checks).toMatchObject({
      contact_registered: true,
      sandbox_registered: true,
      expected_interest_persisted: true,
      contact_identity_persisted: true,
      sheet_identity_projected: true,
      inbound_messages: 3,
      outbound_messages: 3,
      decisions: 3,
      sheet_rows: 1,
    });
  });

  it('reports missing durable side effects rather than passing on transcript alone', () => {
    const result = evaluatePersistenceEvidence(
      {
        ...buyerCase(),
        id: 'real_02',
        turns: ['Hola', 'Quiero Marketing'],
        ideal_result: {
          registered_contact: true,
          expected_interest: 'Marketing Digital',
          min_active_memories: 1,
          sheet_rows: 1,
          plan_code: 'monthly_6' as const,
        },
      },
      {
        contactId: null,
        phone: null,
        contactName: null,
        contactEmail: null,
        sandboxRegistered: false,
        inboundMessages: 0,
        outboundMessages: 0,
        decisions: 0,
        decisionsWithTrace: 0,
        activeMemoryValues: [],
        readyMemoryEmbeddings: 0,
        sheetRows: [],
        promptVersions: [],
        technicalFallbacks: 0,
      },
      { runId: RUN_ID },
    );

    expect(result.failures).toEqual(expect.arrayContaining([
      'contact_not_registered',
      'sandbox_identity_not_registered',
      'expected_inbound_messages_2_got_0',
      'expected_outbound_messages_2_got_0',
      'expected_decisions_2_got_0',
      'expected_interest_not_persisted',
      'expected_active_memories_at_least_1_got_0',
      'expected_sheet_rows_1_got_0',
    ]));
  });

  // Regresión P0 (informe 2026-08-23): el bot decía "registramos tu
  // información" pero contacts.name/email y el outbox quedaban vacíos, y el
  // runner no lo detectaba. Cuando el cliente entregó su identidad en un
  // turno, la evidencia durable debe contenerla.
  it('fails when the customer volunteered identity but contacts.name/email stayed empty', () => {
    const evidence = {
      ...completeEvidence(),
      contactName: null,
      contactEmail: null,
    };
    const result = evaluatePersistenceEvidence(buyerCase(), evidence, { runId: RUN_ID });

    expect(result.failures).toEqual(expect.arrayContaining([
      'contact_name_not_persisted',
      'contact_email_not_persisted',
    ]));
  });

  it('allows a literal memory alias while requiring the canonical sheet label', () => {
    const testCase = {
      ...buyerCase(),
      ideal_result: {
        ...buyerCase().ideal_result,
        expected_interest: 'AutoCAD',
        expected_sheet_interest: 'AutoCAD orientado al Diseño de Interiores',
      },
    };
    const evidence = {
      ...completeEvidence(),
      activeMemoryValues: ['autocad'],
      sheetRows: [{
        ...completeEvidence().sheetRows[0],
        courseInterest: 'AutoCAD orientado al Diseño de Interiores',
      }],
    };

    expect(evaluatePersistenceEvidence(testCase, evidence, { runId: RUN_ID }).failures).toEqual([]);
  });

  it('fails when the sheet row dropped identity or the canonical course interest', () => {
    const evidence = {
      ...completeEvidence(),
      sheetRows: [{
        plan: 'monthly_12',
        courseInterest: '',
        state: 'pending',
        nombre: '',
        apellido: '',
        email: '',
      }],
    };
    const result = evaluatePersistenceEvidence(buyerCase(), evidence, { runId: RUN_ID });

    expect(result.failures).toEqual(expect.arrayContaining([
      'sheet_identity_missing',
      'sheet_course_interest_missing',
    ]));
  });

  it('does not require identity evidence when the customer never volunteered it', () => {
    const testCase = {
      ...buyerCase(),
      turns: ['Hola', 'Quiero Excel'],
      ideal_result: {
        registered_contact: true,
        expected_interest: 'Excel Integral',
        min_active_memories: 1,
        sheet_rows: 0,
      },
    };
    const evidence = {
      ...completeEvidence(),
      contactName: null,
      contactEmail: null,
      inboundMessages: 2,
      outboundMessages: 2,
      decisions: 2,
      decisionsWithTrace: 2,
      sheetRows: [],
      turnEvidence: completeEvidence().turnEvidence.slice(0, 2),
    };
    const result = evaluatePersistenceEvidence(testCase, evidence, { runId: RUN_ID });

    expect(result.failures).toEqual([]);
  });

  it('fails when decisions were persisted without their trace_id', () => {
    const evidence = { ...completeEvidence(), decisionsWithTrace: 1 };
    const result = evaluatePersistenceEvidence(buyerCase(), evidence, { runId: RUN_ID });

    expect(result.failures).toEqual(expect.arrayContaining(['decision_trace_ids_missing']));
  });

  it('fails when a forbidden sensitive value survives in durable memory or Sheets', () => {
    const testCase = {
      ...buyerCase(),
      ideal_result: {
        ...buyerCase().ideal_result,
        forbidden_persistence_values: ['30111222', '4111111111111111'],
      },
    };
    const evidence = {
      ...completeEvidence(),
      activeMemoryValues: ['Quiere Excel Integral', 'DNI 30111222'],
    };

    const result = evaluatePersistenceEvidence(testCase, evidence, { runId: RUN_ID });

    expect(result.failures).toContain('forbidden_persistence_value_found:30111222');
    expect(result.checks.forbidden_persistence_values_found).toEqual(['30111222']);
  });

  it('accepts one legal acknowledgement followed by durable zero-outbound silence', () => {
    const testCase = {
      ...buyerCase(),
      id: 'opt_out_case',
      turns: ['Dame de baja', '¿Seguís ahí?'],
      ideal_result: {
        registered_contact: true,
        sheet_rows: 0,
        expected_response_count_by_turn: [1, 0] as Array<0 | 1>,
      },
    };
    const evidence = {
      ...completeEvidence(),
      inboundMessages: 2,
      outboundMessages: 1,
      decisions: 2,
      decisionsWithTrace: 2,
      activeMemoryValues: [],
      sheetRows: [],
      runScope: {
        sandboxExternalUserId: `eval:${RUN_ID}:opt_out_case`,
        externalConversationId: `local-eval-${RUN_ID}-opt-out`,
        conversationId: 'conversation-db-opt-out',
      },
      turnEvidence: [
        { turnNumber: 1, turnId: 'turn-1', decisionId: 'decision-1', traceId: 'trace-1', outboundMessageId: 'out-1' },
        { turnNumber: 2, turnId: 'turn-2', decisionId: 'decision-2', traceId: 'trace-2', outboundMessageId: null },
      ],
    };

    const result = evaluatePersistenceEvidence(testCase, evidence, { runId: RUN_ID });

    expect(result.failures).toEqual([]);
    expect(result.checks).toMatchObject({
      expected_outbound_messages: 1,
      turn_outbound_counts: [1, 0],
      run_scope_verified: true,
    });
  });

  it('detects misplaced outbounds even when the aggregate total is correct', () => {
    const testCase = {
      ...buyerCase(),
      id: 'turn_cardinality_case',
      turns: ['Dame de baja', '¿Seguís ahí?'],
      ideal_result: {
        registered_contact: true,
        sheet_rows: 0,
        expected_response_count_by_turn: [1, 0] as Array<0 | 1>,
      },
    };
    const evidence = {
      ...completeEvidence(),
      inboundMessages: 2,
      outboundMessages: 1,
      decisions: 2,
      decisionsWithTrace: 2,
      activeMemoryValues: [],
      sheetRows: [],
      runScope: {
        sandboxExternalUserId: `eval:${RUN_ID}:turn_cardinality_case`,
        externalConversationId: `local-eval-${RUN_ID}-cardinality`,
        conversationId: 'conversation-db-cardinality',
      },
      turnEvidence: [
        { turnNumber: 1, turnId: 'turn-1', decisionId: 'decision-1', traceId: 'trace-1', outboundMessageId: null },
        { turnNumber: 2, turnId: 'turn-2', decisionId: 'decision-2', traceId: 'trace-2', outboundMessageId: 'out-2' },
      ],
    };

    const result = evaluatePersistenceEvidence(testCase, evidence, { runId: RUN_ID });

    expect(result.failures).toEqual(expect.arrayContaining([
      'turn_1_expected_outbound_1_got_0',
      'turn_2_expected_outbound_0_got_1',
    ]));
  });

  it('fails evidence that is not scoped to the current run and case', () => {
    const evidence = {
      ...completeEvidence(),
      runScope: {
        sandboxExternalUserId: 'eval:another-run:real_01',
        externalConversationId: 'local-eval-another-run-conversation',
        conversationId: 'conversation-db-1',
      },
    };

    const result = evaluatePersistenceEvidence(buyerCase(), evidence, { runId: RUN_ID });

    expect(result.failures).toContain('persistence_evidence_not_run_scoped');
    expect(result.checks.run_scope_verified).toBe(false);
  });

  it('does not accept a run id that appears only as an attacker-controlled substring', () => {
    const evidence = {
      ...completeEvidence(),
      runScope: {
        sandboxExternalUserId: `eval:${RUN_ID}:real_01`,
        externalConversationId: `local-eval-attacker-${RUN_ID}-conversation`,
        conversationId: 'conversation-db-1',
      },
    };

    const result = evaluatePersistenceEvidence(buyerCase(), evidence, { runId: RUN_ID });

    expect(result.failures).toContain('persistence_evidence_not_run_scoped');
  });

  it('fails when per-turn decision and outbound correlation evidence is absent', () => {
    const evidence = { ...completeEvidence(), turnEvidence: undefined };

    const result = evaluatePersistenceEvidence(buyerCase(), evidence, { runId: RUN_ID });

    expect(result.failures).toContain('turn_scoped_persistence_evidence_missing');
  });
});
