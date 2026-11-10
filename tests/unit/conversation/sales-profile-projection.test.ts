import { describe, expect, it } from 'vitest';
import { projectSalesProfileMemoriesV1 } from '@/shared/conversation/sales-profile';
import { SalesProfileMemoriesV1Schema } from '../../../botpress-agent/src/schemas/agent-a-brain';

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

  // 2026-11-05 owner test (6bcc8efa): «no lo sé aún» + «es formarme» were two
  // WhatsApp messages; the model quoted both and the objective was dropped.
  it('keeps a quote that spans consecutive customer messages of the same reply', () => {
    const profile = projectSalesProfileMemoriesV1([
      row([{ type: 'study_goal', key: 'objective', value: 'formarse, aún sin definir el uso', source_quote: 'no lo sé aún\nes formarme' }],
        ['no lo sé aún', 'es formarme', 'son confiables?']),
    ]);
    expect(profile.objective).toEqual([{ key: 'objective', value: 'formarse, aún sin definir el uso', source_quote: 'no lo sé aún\nes formarme' }]);
    // Joining never manufactures text across non-adjacent messages.
    expect(projectSalesProfileMemoriesV1([row([{ type: 'study_goal', key: 'objective', value: 'x',
      source_quote: 'no lo sé aún son confiables?' }], ['no lo sé aún', 'es formarme', 'son confiables?'])]).objective).toEqual([]);
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

  it('M1: a bad legacy key is dropped and never makes the claim unparseable', () => {
    const profile = projectSalesProfileMemoriesV1([
      row([{ type: 'objection', key: 'Price Objection!', value: 'caro', source_quote: 'es caro' },
        { type: 'objection', key: 'a'.repeat(65), value: 'caro', source_quote: 'es caro' },
        { type: 'objection', key: 'price_objection', value: 'caro', source_quote: 'es caro' }], ['es caro']),
    ]);
    expect(profile.objections.map((item) => item.key)).toEqual(['price_objection']);
    expect(SalesProfileMemoriesV1Schema.safeParse(profile).success).toBe(true);
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
