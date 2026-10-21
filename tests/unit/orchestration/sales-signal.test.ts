import { describe, expect, it } from 'vitest';
import {
  classifyBatchSalesSignal,
  classifyBatchSalesSignalWithIndex,
  classifyDeterministicSalesSignal,
} from '@/features/orchestration/domain/sales-signal';

describe('classifyDeterministicSalesSignal', () => {
  it('recognizes a direct request to be called', () => {
    expect(classifyDeterministicSalesSignal('Llamame ahora')).toEqual({
      type: 'direct_call_request',
    });
  });

  it('lets a trailing negation override an embedded affirmative', () => {
    expect(classifyDeterministicSalesSignal('Sí, pero no me llames')).toEqual({
      type: 'call_decline',
    });
  });

  it('sends unclear language to the model rather than guessing', () => {
    expect(classifyDeterministicSalesSignal('Quiero información')).toEqual({
      type: 'model_required',
    });
  });

  it('recognizes a plain call decline', () => {
    expect(classifyDeterministicSalesSignal('No me llames')).toEqual({ type: 'call_decline' });
  });

  it.each([
    'No me llamen',
    'No quiero llamadas',
    'Sin llamada',
    'No por teléfono',
    'Prefiero WhatsApp',
    'Solo chat',
    'No puedo atender llamadas',
    'Ahora no puedo atender',
    'No estoy disponible en este momento',
  ])('recognizes a call/channel refusal (%s)', (text) => {
    expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'call_decline' });
  });

  it.each([
    'Llamame',
    'Llámame por favor',
    'Podes llamarme',
    'Me podes llamar?',
    'Noo, por llamada',
    'Llamar',
  ])(
    'recognizes variants of a direct call request (%s)',
    (text) => {
      expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'direct_call_request' });
    }
  );

  it.each([
    'Quiero que me llamen',
    'Quiero que me llames',
    '¿Pueden llamarme?',
    'Me gustaría una llamada',
    'Quisiera que me contacten por teléfono',
    '¿Podrían llamarme un momento?',
    '¿Me llamás?',
    'Quiero una llamada',
    'Que me llame un asesor',
    'Necesito hablar por teléfono',
    'Comuníquense conmigo',
    'Perdón, ¿me volvés a llamar?',
    'Volveme a llamar por favor',
  ])('recognizes an unambiguous direct-call paraphrase (%s)', (text) => {
    expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'direct_call_request' });
  });

  it('lets a call negation win over a request token', () => {
    expect(classifyDeterministicSalesSignal('No quiero que me llamen')).toEqual({
      type: 'call_decline',
    });
    expect(classifyDeterministicSalesSignal('No quiero que me llames')).toEqual({
      type: 'call_decline',
    });
    expect(classifyDeterministicSalesSignal('No me gustaría una llamada')).toEqual({
      type: 'call_decline',
    });
    expect(classifyDeterministicSalesSignal('No me gustaría que me contacten por teléfono')).toEqual({
      type: 'call_decline',
    });
  });

  it.each(['Sí', 'sí', 'Sí dale', 'Sí, dale', 'Sí. Dale', 'Sii', 'Siii', 'Dale', 'Daleee', 'De una', '¡Dale!', 'si.'])(
    'recognizes a short standalone acceptance (%s)',
    (text) => {
      expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'call_acceptance' });
    }
  );

  it.each(['No', 'No, gracias', 'Mejor no', 'No, mejor no'])(
    'recognizes a bounded short call refusal (%s)',
    (text) => {
      expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'call_decline' });
    },
  );

  it('does not treat an affirmative embedded in a longer reply as a short acceptance', () => {
    expect(classifyDeterministicSalesSignal('Sí, contame más')).toEqual({
      type: 'model_required',
    });
  });

  it.each([
    'Sí, intenta nuevamente',
    'Dale, probemos de nuevo',
    'Intenten otra vez',
  ])('recognizes an explicit retry acceptance that still needs durable retry context (%s)', (text) => {
    expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'call_acceptance' });
  });

  it.each(['Dejen de escribirme', 'No me escribas más', 'Quiero darme de baja'])(
    'recognizes a request to stop all contact (%s)',
    (text) => {
      expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'opt_out' });
    }
  );

  it('returns model_required for empty or blank text', () => {
    expect(classifyDeterministicSalesSignal('')).toEqual({ type: 'model_required' });
    expect(classifyDeterministicSalesSignal('   ')).toEqual({ type: 'model_required' });
  });
});
describe('classifyBatchSalesSignal', () => {
  it('finds a direct call request buried under trailing small talk', () => {
    expect(classifyBatchSalesSignal(['llamame', 'gracias'])).toEqual({ type: 'direct_call_request' });
  });

  it('recognizes the exact production burst as a direct call request', () => {
    expect(classifyBatchSalesSignal(['noo, por llamada', 'Me podes llamar?'])).toEqual({
      type: 'direct_call_request',
    });
  });

  it('recognizes the polite production request even when it follows greeting and info messages', () => {
    expect(classifyBatchSalesSignal([
      'Buenas',
      'quiero info',
      'Que me llames, puede ser?',
    ])).toEqual({ type: 'direct_call_request' });
  });

  it('lets the newest decisive message override an earlier request', () => {
    expect(classifyBatchSalesSignal(['llamame', 'pensándolo mejor no me llames'])).toEqual({
      type: 'call_decline',
    });
  });

  it.each(['no', 'no, mejor no', 'ahora no', 'por ahora no', 'prefiero que no'])(
    'lets a trailing short refusal (%s) revoke a prior acceptance and retains its evidence index',
    (refusal) => {
      expect(classifyBatchSalesSignalWithIndex(
        ['sí, dale', refusal],
        { pendingCallReply: true },
      )).toEqual({
        signal: { type: 'call_decline' },
        index: 1,
      });
    },
  );

  it('keeps a contextual short acceptance decisive inside a burst', () => {
    expect(classifyBatchSalesSignal(['dale', 'perfecto'])).toEqual({ type: 'call_acceptance' });
  });

  it('accepts a natural discourse marker before dale', () => {
    expect(classifyDeterministicSalesSignal('Bueno dale')).toEqual({ type: 'call_acceptance' });
  });

  it.each([
    'Ahora puedo atender',
    'Estoy disponible',
    'Sí, ahora puedo',
  ])('classifies an explicit current-availability answer (%s)', (text) => {
    expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'call_acceptance' });
  });

  it('returns model_required when no message is decisive', () => {
    expect(classifyBatchSalesSignal(['hola', 'cuánto sale el curso?'])).toEqual({ type: 'model_required' });
    expect(classifyBatchSalesSignal([])).toEqual({ type: 'model_required' });
  });

  it('matches the single-message classifier on one-message batches', () => {
    expect(classifyBatchSalesSignal(['llamame'])).toEqual(classifyDeterministicSalesSignal('llamame'));
  });
});
