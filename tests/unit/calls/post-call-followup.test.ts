import { describe, expect, it } from 'vitest';
import { decidePostCallFollowup } from '@/features/calls/domain/post-call-followup';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import type { PostCallFollowupStore } from '@/features/calls/ports/post-call-followup-store';
import { verifyAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import type { PostCallNarrativeContext } from '@/features/calls/ports/post-call-followup-composer';

const narrativeContext: PostCallNarrativeContext = {
  academy_name: 'StudyX',
  customer: { contact_intake: { nombre: 'Lucas', apellido: 'Pérez', correo: 'lucas@example.test', telefono: '+5491123456789' } },
  selected_course: { code: 'python', name: 'Python' }, selected_payment_plan: null, history: [],
  call_context: { course_interest: 'Python', conversation_summary: null }, analysis: null, failure_code: null,
};
const composeFollowup = async () => 'Lucas, podemos reintentar o seguir por aquí con Python.';

const base = { analysisStatus: 'completed' as const, paymentVerified: false };

describe('post-call followup verdicts (spec 007)', () => {
  it('returns a structured brief instead of making backend copy the conversational authority', () => {
    const verdict = decidePostCallFollowup({ status: 'no_answer', result: null, ...base });

    expect(verdict).toEqual({
      action: 'send',
      reason: 'CALL_NO_ANSWER',
      brief: {
        schema_version: 1,
        scenario: 'no_answer',
        objective: 'recover_call_or_continue_chat',
        payment_state: 'not_applicable',
        allowed_next_steps: ['retry_call', 'continue_chat'],
      },
    });
    expect(verdict).not.toHaveProperty('content');
  });

  it('never emits a message for a cancelled call', () => {
    expect(decidePostCallFollowup({ status: 'cancelled', result: null, ...base })).toEqual({
      action: 'skip',
      reason: 'CALL_CANCELLED',
    });
  });

  it('offers a retry, never an auto-redial, for no_answer/timed_out/failed', () => {
    for (const status of ['no_answer', 'timed_out', 'failed'] as const) {
      const verdict = decidePostCallFollowup({ status, result: null, ...base });
      expect(verdict.action).toBe('send');
    }
  });

  it('authorizes retry or chat after no answer with a factual brief', () => {
    const verdict = decidePostCallFollowup({ status: 'no_answer', result: null, ...base });
    expect(verdict.action).toBe('send');
    if (verdict.action !== 'send') return;
    expect(verdict.brief).toMatchObject({ scenario: 'no_answer', allowed_next_steps: ['retry_call', 'continue_chat'] });
  });

  it.each(['failed'] as const)(
    'authorizes later retry or chat after a failed call with no asserted cause for %s',
    (status) => {
      const verdict = decidePostCallFollowup({ status, result: null, ...base });
      expect(verdict.action).toBe('send');
      if (verdict.action !== 'send') return;
      expect(verdict.brief.scenario).toBe('temporarily_unavailable');
      expect(verdict.brief.allowed_next_steps).toEqual(['retry_call_later', 'continue_chat']);
    },
  );

  it('represents an ambiguous timeout as interruption with recovery choices', () => {
    const verdict = decidePostCallFollowup({ status: 'timed_out', result: null, ...base });
    expect(verdict).toMatchObject({
      action: 'send',
      brief: { scenario: 'call_interrupted' },
      reason: 'CALL_TIMED_OUT',
    });
    if (verdict.action !== 'send') return;
    expect(verdict.brief.allowed_next_steps).toEqual(['retry_call', 'continue_chat']);
  });

  it('recovers an abrupt user hangup when analysis did not arrive', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed',
      result: null,
      analysisStatus: 'pending',
      paymentVerified: false,
      endReason: 'user_hangup',
    });
    expect(verdict).toMatchObject({
      action: 'send',
      brief: {
        scenario: 'call_interrupted',
        allowed_next_steps: ['retry_call', 'continue_chat'],
      },
      reason: 'CALL_ENDED_BY_CONTACT_WITHOUT_ANALYSIS',
    });
  });

  it('does not act on a call that has not reached a terminal state', () => {
    for (const status of ['requested', 'dispatching', 'provider_accepted', 'dispatch_ambiguous', 'in_progress'] as const) {
      expect(decidePostCallFollowup({ status, result: null, ...base })).toEqual({
        action: 'skip',
        reason: 'CALL_NOT_TERMINAL',
      });
    }
  });

  it('authorizes continuity when analysis is unavailable without asserting an outcome', () => {
    const pending = decidePostCallFollowup({
      status: 'completed', result: null, analysisStatus: 'pending', paymentVerified: false,
    });
    const failed = decidePostCallFollowup({
      status: 'completed', result: null, analysisStatus: 'failed', paymentVerified: false,
    });
    expect(pending).toMatchObject({ action: 'send', brief: { scenario: 'analysis_unavailable' }, reason: 'ANALYSIS_UNAVAILABLE' });
    expect(failed).toMatchObject({ action: 'send', brief: { scenario: 'analysis_unavailable' }, reason: 'ANALYSIS_UNAVAILABLE' });
  });

  it('gates venta_confirmada on verified payment: no proof, no sale claim', () => {
    const unverified = decidePostCallFollowup({
      status: 'completed', result: 'venta_confirmada', analysisStatus: 'completed', paymentVerified: false,
    });
    const verified = decidePostCallFollowup({
      status: 'completed', result: 'venta_confirmada', analysisStatus: 'completed', paymentVerified: true,
    });
    expect(unverified.reason).toBe('SALE_CLAIMED_PAYMENT_UNVERIFIED');
    expect(verified.reason).toBe('SALE_CONFIRMED_PAYMENT_VERIFIED');
    expect(unverified.action).toBe('send');
    expect(verified.action).toBe('send');
    if (unverified.action === 'send' && verified.action === 'send') {
      expect(unverified.brief.payment_state).toBe('reported_or_pending');
      expect(verified.brief.payment_state).toBe('verified');
    }
  });

  it('authorizes payment continuation for a reported link without asserting verified payment', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'link_enviado_sin_pago', ...base,
    });
    expect(verdict.action).toBe('send');
    if (verdict.action !== 'send') return;
    expect(verdict.brief.payment_state).toBe('reported_or_pending');
    expect(verdict.brief.allowed_next_steps).toEqual(['complete_payment', 'await_human_verification']);
  });

  it('routes no_contactar to revocation, not a message', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'no_contactar', ...base,
    });
    expect(verdict).toEqual({ action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
  });

  it('keeps human handoff unavailable and authorizes only continued chat', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'derivado_humano', ...base,
    });
    expect(verdict.action).toBe('send');
    expect(verdict.reason).toBe('HUMAN_HANDOFF_REQUESTED_DISABLED');
    if (verdict.action === 'send') expect(verdict.brief.allowed_next_steps).toEqual(['continue_chat']);
  });

  it('covers every neutral no-claim result without throwing', () => {
    for (const result of ['ya_es_alumno', 'no_calificado', 'no_es_buen_momento'] as const) {
      const verdict = decidePostCallFollowup({ status: 'completed', result, ...base });
      expect(verdict.action).toBe('send');
      expect(verdict.reason).toBe(`NEUTRAL_${result.toUpperCase()}`);
    }
  });

  it('offers a retry for voicemail without claiming a sale or payment', () => {
    expect(decidePostCallFollowup({ status: 'completed', result: 'buzon_de_voz', ...base }))
      .toMatchObject({ action: 'send', brief: { scenario: 'voicemail' }, reason: 'VOICEMAIL_OUTCOME' });
  });

  it('offers retry or chat when the person ended the call without claiming a sale or payment', () => {
    expect(decidePostCallFollowup({ status: 'completed', result: 'corto_la_llamada', ...base })).toMatchObject({
      action: 'send',
      brief: {
        scenario: 'call_interrupted',
        allowed_next_steps: ['retry_call', 'continue_chat'],
      },
      reason: 'CALL_ENDED_BY_CONTACT',
    });
  });

  it('is a pure function of its inputs: same call, same verdict, every time', () => {
    const input = { status: 'completed' as const, result: 'seguimiento_agendado' as const, ...base };
    const first = decidePostCallFollowup(input);
    const second = decidePostCallFollowup(input);
    expect(first).toEqual(second);
  });
});

describe('post-call followup delivery boundary', () => {
  function storeFor(call: {
    status?: 'completed' | 'failed' | 'no_answer' | 'timed_out' | 'cancelled';
    result?: 'seguimiento_agendado' | 'no_contactar' | null;
    channel?: 'telegram' | 'whatsapp';
    endReason?: 'user_hangup' | 'agent_hangup' | null;
  }): PostCallFollowupStore & {
    completed: string[];
    followups: Array<Parameters<PostCallFollowupStore['markFollowupCompleted']>[0]['followup']>;
  } {
    const completed: string[] = [];
    const followups: Array<Parameters<PostCallFollowupStore['markFollowupCompleted']>[0]['followup']> = [];
    let narrative: string | null = null;
    return {
      completed,
      followups,
      async loadNarrativeContext() { return narrativeContext; },
      async readFollowupNarrative() { return narrative; },
      async commitFollowupNarrative(_call, text) { narrative ??= text; return narrative; },
      async listPendingFollowups() {
        return [{
          call_id: '00000000-0000-4000-8000-000000000001',
          contact_id: '00000000-0000-4000-8000-000000000002',
          conversation_id: '00000000-0000-4000-8000-000000000003',
          workspace_id: '00000000-0000-4000-8000-000000000004',
          channel: call.channel ?? 'telegram',
          provider: 'telegram_sandbox' as const,
          status: call.status ?? 'completed',
          result: 'result' in call ? call.result ?? null : 'seguimiento_agendado',
          analysis_status: 'completed' as const,
          prompt_version: 'agent-b-v1',
          disconnection_reason: call.endReason ?? null,
          provider_disconnection_reason: call.endReason ?? null,
        }];
      },
      async hasVerifiedPayment() { return false; },
      async isContactBlocked() { return false; },
      async revokeContact() {},
      async markFollowupCompleted(input) {
        completed.push(input.call_id);
        followups.push(input.followup);
      },
    };
  }

  it('delivers the Agent A authored narrative with factual call and durable customer context', async () => {
    const store = storeFor({ status: 'failed', result: null });
    let deliveredText: string | undefined;
    let authoredInput: unknown;
    const result = await runPostCallFollowup({ trace_id: 'trace-agent-a' }, {
      store,
      composeFollowup: async (input: unknown) => {
        authoredInput = input;
        return 'Lucas, la llamada no llegó a iniciarse. Podemos seguir con Python por aquí.';
      },
      sendOutbound: async (input) => {
        deliveredText = input.text;
        return { outcome: 'sent', channel: 'telegram', providerMessageId: '1', deliveryId: '1', reason: null };
      },
    });
    expect(result.sent).toBe(1);
    expect(deliveredText).toBe('Lucas, la llamada no llegó a iniciarse. Podemos seguir con Python por aquí.');
    expect(authoredInput).toMatchObject({
      brief: { scenario: 'temporarily_unavailable', payment_state: 'not_applicable' },
      call: { status: 'failed', result: null, analysis_status: 'completed' },
      context: { customer: { contact_intake: { nombre: 'Lucas' } }, selected_course: { code: 'python' } },
    });
  });

  it('reuses the committed narrative after a send/marker crash without invoking an unavailable model', async () => {
    const store = storeFor({});
    let text = '';
    store.readFollowupNarrative = async () => 'Lucas, retomamos desde el acuerdo que ya hicimos.';
    store.loadNarrativeContext = async () => { throw new Error('CONTEXT_MUST_NOT_BE_RELOADED'); };
    store.commitFollowupNarrative = async () => { throw new Error('NARRATIVE_MUST_NOT_BE_REGENERATED'); };
    const result = await runPostCallFollowup({ trace_id: 'trace-replay' }, {
      store,
      composeFollowup: async () => { throw new Error('MODEL_UNAVAILABLE'); },
      sendOutbound: async (input) => {
        text = input.text;
        return { outcome: 'sent', channel: 'telegram', providerMessageId: '1', deliveryId: '1', reason: null };
      },
    });
    expect(result.sent).toBe(1);
    expect(text).toBe('Lucas, retomamos desde el acuerdo que ya hicimos.');
    expect(store.completed).toHaveLength(1);
  });

  it('keeps the call pending without sending template copy when the model is unavailable', async () => {
    const store = storeFor({});
    let attempts = 0;
    const result = await runPostCallFollowup({ trace_id: 'trace-missing-model' }, {
      store,
      composeFollowup: async () => { throw new Error('AGENT_A_FOLLOWUP_CONFIG_UNAVAILABLE'); },
      sendOutbound: async () => { attempts += 1; throw new Error('NO_FALLBACK_ALLOWED'); },
    });
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(attempts).toBe(0);
    expect(store.completed).toEqual([]);
  });

  it('delivers the first committed narrative when concurrent composition produced a different draft', async () => {
    const store = storeFor({});
    store.commitFollowupNarrative = async () => 'La redacción de Agent A que ganó la reserva.';
    let sentText: string | undefined;
    await runPostCallFollowup({ trace_id: 'trace-concurrent' }, {
      store,
      composeFollowup: async () => 'Una segunda redacción que debe descartarse.',
      sendOutbound: async (input) => {
        sentText = input.text;
        return { outcome: 'sent', channel: 'telegram', providerMessageId: '1', deliveryId: '1', reason: null };
      },
    });
    expect(sentText).toBe('La redacción de Agent A que ganó la reserva.');
  });

  it('revalidates DNC after composition and never sends the newly authored draft', async () => {
    const store = storeFor({});
    let consentChecks = 0;
    let attempts = 0;
    store.revalidateFollowup = async () => ({ do_not_contact: ++consentChecks === 2 });
    const result = await runPostCallFollowup({ trace_id: 'trace-late-dnc' }, {
      store,
      composeFollowup,
      sendOutbound: async () => { attempts += 1; throw new Error('DNC_SEND'); },
    });
    expect(result.revoked).toBe(1);
    expect(attempts).toBe(0);
  });

  it.each([false, true])('authorizes the same canonical offering fact for a fresh or cached Agent A narrative (cached=%s)', async (cached) => {
    const store = storeFor({ status: 'failed', result: null });
    const text = 'El curso de Python está disponible. Podemos seguir por aquí.';
    if (cached) store.readFollowupNarrative = async () => text;
    let accepted = false;
    const result = await runPostCallFollowup({ trace_id: 'trace-course-fact' }, {
      store,
      composeFollowup: async () => text,
      sendOutbound: async (input) => {
        accepted = verifyAuthorizedEgress({ content: input.text, manifest: input.authorizedEgress }).ok;
        return { outcome: accepted ? 'sent' : 'rejected_by_policy', channel: 'telegram', providerMessageId: '1', deliveryId: '1', reason: null };
      },
    });
    expect(result.sent).toBe(1);
    expect(accepted).toBe(true);
  });

  it('reuses the committed course evidence for a cached narrative when live context cannot be reloaded', async () => {
    const store = storeFor({ status: 'failed', result: null });
    const text = 'El curso de Python está disponible. Podemos seguir por aquí.';
    store.readFollowupNarrative = async () => text;
    store.readFollowupNarrativeCourse = async () => ({ code: 'python', name: 'Python' });
    store.loadNarrativeContext = async () => { throw new Error('LIVE_CONTEXT_UNAVAILABLE'); };
    const result = await runPostCallFollowup({ trace_id: 'trace-cached-facts' }, {
      store,
      composeFollowup: async () => { throw new Error('NO_REGENERATION_ALLOWED'); },
      sendOutbound: async (input) => {
        expect(input.text).toBe(text);
        expect(verifyAuthorizedEgress({ content: input.text, manifest: input.authorizedEgress }).ok).toBe(true);
        return { outcome: 'sent', channel: 'telegram', providerMessageId: '1', deliveryId: '1', reason: null };
      },
    });
    expect(result.sent).toBe(1);
  });

  it('stops before a new row once processing time expires and leaves remaining candidates pending', async () => {
    const store = storeFor({ status: 'failed', result: null });
    const initial = (await store.listPendingFollowups({ limit: 50, grace_seconds: 0 }))[0];
    const candidates = Array.from({ length: 5 }, (_, index) => ({ ...initial, call_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
    store.listPendingFollowups = async () => candidates;
    store.readFollowupNarrative = async () => null;
    let clockMs = 0;
    const sends: string[] = [];
    const result = await runPostCallFollowup({ trace_id: 'trace-deadline', max_processing_ms: 1000 }, {
      store, now: () => clockMs,
      composeFollowup,
      sendOutbound: async (input) => {
        sends.push(input.idempotencyKey);
        clockMs += 600;
        return { outcome: 'sent', channel: 'telegram', providerMessageId: '1', deliveryId: '1', reason: null };
      },
    });
    expect(result).toMatchObject({ examined: 2, sent: 2, failed: 0, deferred: 3 });
    expect(result.findings.map((finding) => finding.call_id)).toEqual(candidates.slice(0, 2).map((call) => call.call_id));
    expect(store.completed).toEqual(candidates.slice(0, 2).map((call) => call.call_id));
    expect(sends).toHaveLength(2);
  });

  it('can process all fifty normal recovery candidates within the time budget', async () => {
    const store = storeFor({ status: 'failed', result: null });
    const initial = (await store.listPendingFollowups({ limit: 50, grace_seconds: 0 }))[0];
    const candidates = Array.from({ length: 50 }, (_, index) => ({ ...initial, call_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
    store.listPendingFollowups = async () => candidates;
    store.readFollowupNarrative = async () => null;
    const result = await runPostCallFollowup({ trace_id: 'trace-fifty', max_processing_ms: 120_000 }, {
      store, now: () => 0, composeFollowup,
      sendOutbound: async () => ({ outcome: 'sent', channel: 'telegram', providerMessageId: '1', deliveryId: '1', reason: null }),
    });
    expect(result).toMatchObject({ examined: 50, sent: 50, failed: 0, deferred: 0 });
    expect(store.completed).toHaveLength(50);
    expect(result.findings).toHaveLength(50);
  });

  it('uses one stable key and marks completion only after provider acceptance', async () => {
    const store = storeFor({});
    const blockedChecks: Array<{ contactId: string; channel: string }> = [];
    store.isContactBlocked = async (contactId, channel) => {
      blockedChecks.push({ contactId, channel });
      return false;
    };
    const attempts: Array<{
      idempotencyKey: string;
      conversationId: string | undefined;
      preferredChannel: string | undefined;
    }> = [];
    const result = await runPostCallFollowup(
      { trace_id: '00000000-0000-4000-8000-000000000005' },
      {
        store,
        composeFollowup,
        sendOutbound: async (input) => {
          attempts.push({
            idempotencyKey: input.idempotencyKey,
            conversationId: input.conversationId,
            preferredChannel: input.preferredChannel,
          });
          return { outcome: 'sent', channel: 'whatsapp', providerMessageId: 'wamid.1', deliveryId: 'delivery-1', reason: null };
        },
      },
    );

    expect(result.findings).toEqual([{
      call_id: '00000000-0000-4000-8000-000000000001',
      action: 'send',
      reason: 'FOLLOWUP_SCHEDULED',
    }]);
    expect(attempts).toEqual([{
      idempotencyKey: 'post-call:00000000-0000-4000-8000-000000000001',
      conversationId: '00000000-0000-4000-8000-000000000003',
      preferredChannel: 'telegram',
    }]);
    expect(store.completed).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(store.followups).toEqual([expect.objectContaining({
      schema_version: 1,
      scenario: 'followup_scheduled',
    })]);
    expect(blockedChecks).toEqual([{
      contactId: '00000000-0000-4000-8000-000000000002',
      channel: 'telegram',
    }]);
  });

  it('leaves retryable delivery without a completion marker', async () => {
    const store = storeFor({});
    const result = await runPostCallFollowup(
      { trace_id: '00000000-0000-4000-8000-000000000005' },
      {
        store,
        composeFollowup,
        sendOutbound: async () => ({ outcome: 'retryable', channel: 'whatsapp', providerMessageId: null, deliveryId: 'delivery-1', reason: 'TIMEOUT' }),
      },
    );

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(store.completed).toEqual([]);
  });

  it('scopes an event-driven sweep to the call that emitted the lifecycle event', async () => {
    const store = storeFor({});
    let listedCallId: string | undefined;
    const list = store.listPendingFollowups.bind(store);
    store.listPendingFollowups = async (input) => {
      listedCallId = input.call_id;
      return list(input);
    };

    await runPostCallFollowup(
      {
        trace_id: '00000000-0000-4000-8000-000000000005',
        call_id: '00000000-0000-4000-8000-000000000001',
      },
      {
        store,
        composeFollowup,
        sendOutbound: async () => ({
          outcome: 'sent',
          channel: 'telegram',
          providerMessageId: 'telegram:1',
          deliveryId: 'delivery-1',
          reason: null,
        }),
      },
    );

    expect(listedCallId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it.each(['telegram', 'whatsapp'] as const)(
    'sends the same abrupt-cut recovery through the originating %s channel',
    async (channel) => {
      const store = storeFor({ result: null, channel, endReason: 'user_hangup' });
      let outbound: Parameters<NonNullable<Parameters<typeof runPostCallFollowup>[1]['sendOutbound']>>[0] | null = null;
      await runPostCallFollowup(
        { trace_id: '00000000-0000-4000-8000-000000000005' },
        {
          store,
          composeFollowup,
          sendOutbound: async (input) => {
            outbound = input;
            return {
              outcome: 'sent', channel, providerMessageId: `${channel}:1`,
              deliveryId: 'delivery-1', reason: null,
            };
          },
        },
      );

      expect(outbound).toMatchObject({
        preferredChannel: channel,
        idempotencyKey: 'post-call:00000000-0000-4000-8000-000000000001',
      });
      expect((outbound as { text: string } | null)?.text).toMatch(/reintent|seguir por aqu[ií]/iu);
    },
  );

  it.each([
    ['telegram', 'no_answer', 'CALL_NO_ANSWER'],
    ['whatsapp', 'no_answer', 'CALL_NO_ANSWER'],
    ['telegram', 'timed_out', 'CALL_TIMED_OUT'],
    ['whatsapp', 'timed_out', 'CALL_TIMED_OUT'],
    ['telegram', 'failed', 'CALL_FAILED'],
    ['whatsapp', 'failed', 'CALL_FAILED'],
  ] as const)(
    'keeps %s recovery channel-agnostic for %s',
    async (channel, status, expectedReason) => {
      const store = storeFor({ status, result: null, channel });
      let selectedChannel: string | undefined;
      const result = await runPostCallFollowup(
        { trace_id: '00000000-0000-4000-8000-000000000005' },
        {
          store,
          composeFollowup,
          sendOutbound: async (input) => {
            selectedChannel = input.preferredChannel;
            return {
              outcome: 'sent', channel, providerMessageId: `${channel}:terminal`,
              deliveryId: 'delivery-terminal', reason: null,
            };
          },
        },
      );
      expect(selectedChannel).toBe(channel);
      expect(result.findings).toEqual([
        expect.objectContaining({ action: 'send', reason: expectedReason }),
      ]);
    },
  );
});
