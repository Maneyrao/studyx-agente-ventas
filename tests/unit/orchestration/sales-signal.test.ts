import { describe, expect, it } from 'vitest';
import { classifyBatchSalesSignal, classifyDeterministicSalesSignal } from '@/features/orchestration/domain/sales-signal';

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

  it.each(['Llamame', 'Llámame por favor', 'Podes llamarme'])(
    'recognizes variants of a direct call request (%s)',
    (text) => {
      expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'direct_call_request' });
    }
  );

  it.each(['Sí', 'sí', 'Dale', 'De una', '¡Dale!', 'si.'])(
    'recognizes a short standalone acceptance (%s)',
    (text) => {
      expect(classifyDeterministicSalesSignal(text)).toEqual({ type: 'call_acceptance' });
    }
  );

  it('does not treat an affirmative embedded in a longer reply as a short acceptance', () => {
    expect(classifyDeterministicSalesSignal('Sí, contame más')).toEqual({
      type: 'model_required',
    });
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

  it('lets the newest decisive message override an earlier request', () => {
    expect(classifyBatchSalesSignal(['llamame', 'pensándolo mejor no me llames'])).toEqual({
      type: 'call_decline',
    });
  });

  it('keeps a contextual short acceptance decisive inside a burst', () => {
    expect(classifyBatchSalesSignal(['dale', 'perfecto'])).toEqual({ type: 'call_acceptance' });
  });

  it('returns model_required when no message is decisive', () => {
    expect(classifyBatchSalesSignal(['hola', 'cuánto sale el curso?'])).toEqual({ type: 'model_required' });
    expect(classifyBatchSalesSignal([])).toEqual({ type: 'model_required' });
  });

  it('matches the single-message classifier on one-message batches', () => {
    expect(classifyBatchSalesSignal(['llamame'])).toEqual(classifyDeterministicSalesSignal('llamame'));
  });
});
