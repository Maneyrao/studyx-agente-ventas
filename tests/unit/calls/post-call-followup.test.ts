import { describe, expect, it } from 'vitest';
import { decidePostCallFollowup, renderPostCallFollowup } from '@/features/calls/domain/post-call-followup';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import type { PostCallFollowupStore } from '@/features/calls/ports/post-call-followup-store';

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

  it('asks what happened after no answer and offers retry or chat', () => {
    const verdict = decidePostCallFollowup({ status: 'no_answer', result: null, ...base });
    expect(verdict.action).toBe('send');
    if (verdict.action !== 'send') return;
    const content = renderPostCallFollowup(verdict.brief);
    expect(content).toMatch(/ocurri[oó] algo/i);
    expect(content).toMatch(/reintent/iu);
    expect(content).toMatch(/chat|por aqu[ií]|por ac[aá]/i);
  });

  it.each(['timed_out', 'failed'] as const)(
    'explains temporary operator unavailability and keeps chat available for %s',
    (status) => {
      const verdict = decidePostCallFollowup({ status, result: null, ...base });
      expect(verdict.action).toBe('send');
      if (verdict.action !== 'send') return;
      const content = renderPostCallFollowup(verdict.brief);
      expect(verdict.brief.scenario).toBe('temporarily_unavailable');
      expect(content).toMatch(/no pudimos completar/iu);
      expect(content).toMatch(/reintent.*m[aá]s tarde/i);
      expect(content).toMatch(/chat|por aqu[ií]|por ac[aá]/i);
    },
  );

  it('does not act on a call that has not reached a terminal state', () => {
    for (const status of ['requested', 'dispatching', 'provider_accepted', 'dispatch_ambiguous', 'in_progress'] as const) {
      expect(decidePostCallFollowup({ status, result: null, ...base })).toEqual({
        action: 'skip',
        reason: 'CALL_NOT_TERMINAL',
      });
    }
  });

  it('sends a neutral continuity message when analysis is unavailable, never claims a result', () => {
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
      expect(renderPostCallFollowup(unverified.brief)).not.toMatch(/pago qued[oó] verificado/iu);
      expect(verified.brief.payment_state).toBe('verified');
      expect(renderPostCallFollowup(verified.brief)).toMatch(/pago qued[oó] verificado/iu);
    }
  });

  it('reminds that Agent A sent the payment link in chat, never claims it was sent inside the call', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'link_enviado_sin_pago', ...base,
    });
    expect(verdict.action).toBe('send');
    if (verdict.action !== 'send') return;
    const content = renderPostCallFollowup(verdict.brief);
    expect(verdict.brief.payment_state).toBe('reported_or_pending');
    expect(content).toContain('en este chat');
    expect(content).not.toContain('en la llamada');
  });

  it('routes no_contactar to revocation, not a message', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'no_contactar', ...base,
    });
    expect(verdict).toEqual({ action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
  });

  it('keeps human handoff disabled: derivado_humano gets a neutral close, no transfer promise', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'derivado_humano', ...base,
    });
    expect(verdict.action).toBe('send');
    expect(verdict.reason).toBe('HUMAN_HANDOFF_REQUESTED_DISABLED');
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
    status?: 'completed' | 'failed' | 'cancelled';
    result?: 'seguimiento_agendado' | 'no_contactar' | null;
  }): PostCallFollowupStore & {
    completed: string[];
    followups: Array<Parameters<PostCallFollowupStore['markFollowupCompleted']>[0]['followup']>;
  } {
    const completed: string[] = [];
    const followups: Array<Parameters<PostCallFollowupStore['markFollowupCompleted']>[0]['followup']> = [];
    return {
      completed,
      followups,
      async listPendingFollowups() {
        return [{
          call_id: '00000000-0000-4000-8000-000000000001',
          contact_id: '00000000-0000-4000-8000-000000000002',
          conversation_id: '00000000-0000-4000-8000-000000000003',
          workspace_id: '00000000-0000-4000-8000-000000000004',
          channel: 'telegram' as const,
          provider: 'telegram_sandbox' as const,
          status: call.status ?? 'completed',
          result: call.result ?? 'seguimiento_agendado',
          analysis_status: 'completed' as const,
          prompt_version: 'agent-b-v1',
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
});
