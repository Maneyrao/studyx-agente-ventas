import { describe, expect, it } from 'vitest';
import { projectSalesProfileMemoriesV1 } from '@/shared/conversation/sales-profile';

const row = (candidates: Array<Record<string, unknown>>, evidence: string[]) => ({ memory_candidates: candidates, evidence });

describe('sales profile memory projection', () => {
  it('keeps the latest memory per (type, key) with its literal source quote', () => {
    const profile = projectSalesProfileMemoriesV1([
      row([{ type: 'study_goal', key: 'work_goal', value: 'trabajar con marcas grandes', source_quote: 'con marcas grandes' }],
        ['Ahora quiero trabajar con marcas grandes']),
      row([{ type: 'study_goal', key: 'work_goal', value: 'trabajar con marcas', source_quote: 'trabajar con marcas' },
        { type: 'study_context', key: 'experience', value: 'hace uñas a amigas', source_quote: 'hago a mis amigas' }],
        ['Quiero trabajar con marcas. Hago a mis amigas']),
    ]);
    expect(profile.objective).toEqual([{ key: 'work_goal', value: 'trabajar con marcas grandes', source_quote: 'con marcas grandes' }]);
    expect(profile.experience).toEqual([{ key: 'experience', value: 'hace uñas a amigas', source_quote: 'hago a mis amigas' }]);
  });

  it('drops a memory whose quote is not literal customer text (never from agent phrases)', () => {
    const profile = projectSalesProfileMemoriesV1([
      row([{ type: 'study_goal', key: 'goal', value: 'ser influencer', source_quote: 'quiero ser influencer' }],
        ['Hola, me interesa un curso']),
      row([{ type: 'objection', key: 'price_objection', value: 'precio', source_quote: '' }], ['esta caro']),
    ]);
    expect(profile.objective).toEqual([]);
    expect(profile.objections).toEqual([]);
  });

  it('routes types to buckets and ignores types outside the DB constraint', () => {
    const profile = projectSalesProfileMemoriesV1([row([
      { type: 'objection', key: 'price_objection', value: 'precio', source_quote: 'está caro' },
      { type: 'constraint', key: 'time', value: 'poco tiempo', source_quote: 'no tengo tiempo' },
      { type: 'study_goal', key: 'course_interest', value: 'tal vez maquillaje', source_quote: 'quizás maquillaje' },
      { type: 'contact_preference', key: 'channel', value: 'chat', source_quote: 'prefiero seguir por acá' },
      { type: 'fact', key: 'x', value: 'y', source_quote: 'z' },
    ], ['Está caro. No tengo tiempo. Quizás maquillaje. Prefiero seguir por acá. z'])]);
    expect(profile.objections).toHaveLength(1);
    expect(profile.constraints).toHaveLength(1);
    expect(profile.tentative_interest).toHaveLength(1);
    expect(profile.objective).toEqual([]);
    expect(profile.contact_preference[0]).toMatchObject({ source_quote: 'prefiero seguir por acá' });
  });
});
