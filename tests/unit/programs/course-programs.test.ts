import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COURSE_PROGRAM_ASSETS_V1, courseProgramAssetV1, courseProgramImageUrlV1, courseProgramUrlV1 } from '@/shared/catalog/course-programs';
import { COURSE_MATERIAL_ROWS_V1 } from '@/shared/catalog/course-material.generated';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { AgentATurnProposalV1Schema } from '@/features/conversation/adapters/agent-a-brain-schema';
import { AgentATurnProposalV1Schema as BotpressProposalSchema, AgentAContextV1Schema } from '../../../botpress-agent/src/schemas/agent-a-brain';
import { DecisionBusinessActionSchema } from '../../../botpress-agent/src/schemas/contracts';
import { sendableProgramCodesV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { stageCoursePrograms } from '../../../scripts/stage-course-programs.mjs';
import { OFFERING_CODES } from '../../../scripts/generate-studyx-programs-seed.mjs';

const ENV = { STUDYX_PUBLIC_ASSET_BASE_URL: 'https://assets.example.com/' };

describe('course material registry', () => {
  it('registers the 57 manual courses: image + ficha for each, the official programme PDF where it exists', () => {
    const csv = readFileSync('docs/authority/material-gabi-2026-11-03/indice_para_el_agente.csv', 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(Boolean).slice(1);
    const fichas = JSON.parse(readFileSync('supabase/seed/data/fichas-gabi-2026-11-03.json', 'utf8')) as { courses: Array<{ manual_name: string; offering_code: string }> };
    const programs = JSON.parse(readFileSync('supabase/seed/data/programas-studyx-pdf.json', 'utf8')) as { programs: Array<{ slug: string; sha256: string }> };
    expect(COURSE_PROGRAM_ASSETS_V1.size).toBe(57);
    expect(csv.filter(line => !line.includes('Beneficios')).length).toBe(57);
    expect(new Set(fichas.courses.map(course => course.offering_code))).toEqual(new Set(COURSE_PROGRAM_ASSETS_V1.keys()));
    for (const program of programs.programs) {
      const code = (OFFERING_CODES as Record<string, string>)[program.slug]!;
      expect(code, program.slug).toBeTruthy();
      expect(courseProgramAssetV1(code)).toMatchObject({ has_program_pdf: true, document: { kind: 'program', sha256: program.sha256, path: `programas/${program.slug}.pdf` } });
    }
    const withoutProgram = [...COURSE_PROGRAM_ASSETS_V1.values()].filter(asset => !asset.has_program_pdf);
    expect(withoutProgram.length).toBe(57 - programs.programs.length);
    for (const asset of withoutProgram) expect(asset.document).toMatchObject({ kind: 'ficha', path: `material/fichas/${asset.offering_code}.pdf` });
    for (const asset of COURSE_PROGRAM_ASSETS_V1.values()) {
      expect(asset.image.path).toBe(`material/imagenes/${asset.offering_code}.png`);
      expect(asset.image.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(asset.version).toMatch(/^[0-9a-f]{12}$/u);
      expect(asset.filename).not.toMatch(/[\\/]/u);
    }
    expect(courseProgramAssetV1('real_estate')).toMatchObject({ mime: 'application/pdf', filename: 'Programa Real Estate - Studyx.pdf' });
    expect(courseProgramAssetV1('barista')).toMatchObject({ has_program_pdf: true });
    expect(courseProgramAssetV1('ingles_4')).toMatchObject({ has_program_pdf: false, filename: 'Ficha Inglés IV - Studyx.pdf' });
  });
  it('the ficha PDFs in git match their registered sha256', () => {
    for (const row of COURSE_MATERIAL_ROWS_V1) {
      const bytes = readFileSync(`docs/authority/material-gabi-2026-11-03/fichas_pdf/${row[4]}`);
      expect(createHash('sha256').update(bytes).digest('hex'), row[0]).toBe(row[5]);
    }
  });
  it('builds the public URLs only from env + registry paths, https only; no env means unavailable', () => {
    expect(courseProgramUrlV1('real_estate', ENV)).toBe('https://assets.example.com/programas/real-estate.pdf');
    expect(courseProgramUrlV1('ingles_4', ENV)).toBe('https://assets.example.com/material/fichas/ingles_4.pdf');
    expect(courseProgramImageUrlV1('real_estate', ENV)).toBe('https://assets.example.com/material/imagenes/real_estate.png');
    for (const build of [courseProgramUrlV1, courseProgramImageUrlV1]) {
      expect(build('real_estate', {})).toBeNull();
      expect(build('real_estate', { STUDYX_PUBLIC_ASSET_BASE_URL: 'http://assets.example.com' })).toBeNull();
      expect(build('real_estate', { STUDYX_PUBLIC_ASSET_BASE_URL: 'not a url' })).toBeNull();
      expect(build('curso_inventado', ENV)).toBeNull();
      expect(build('../../etc/passwd', ENV)).toBeNull();
    }
  });
});

describe('send_course_program contract', () => {
  const base = { schema_version: 1, move: { schema_version: 1, move: 'request_course_program', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: ['Te comparto el programa de Real Estate.'] }, proposed_action: { type: 'send_course_program', offering_code: 'real_estate' },
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null };
  it('parses at every boundary and has no URL field', () => {
    for (const schema of [AgentATurnProposalV1Schema, BotpressProposalSchema]) {
      expect(schema.parse(base).proposed_action).toEqual(base.proposed_action);
      expect(schema.safeParse({ ...base, proposed_action: { ...base.proposed_action, url: 'https://evil.example/x.pdf' } }).success).toBe(false);
      expect(schema.safeParse({ ...base, proposed_action: { type: 'send_course_program' } }).success).toBe(false);
    }
    expect(DecisionBusinessActionSchema.parse(base.proposed_action)).toEqual(base.proposed_action);
    expect(DecisionBusinessActionSchema.safeParse({ ...base.proposed_action, file_url: 'https://x' }).success).toBe(false);
  });
});

const offerings = [{ code: 'real_estate', display_name: 'Real Estate', aliases: [] }, { code: 'barista', display_name: 'Barista', aliases: [] }];
function authorize(programs: { available_offering_codes: string[]; sent_offering_codes: string[] } | undefined, over: { code?: string; move?: string } = {}) {
  return authorizeAgentTurnV2({
    proposal: { ...base2, move: { ...base2.move, move: (over.move ?? 'request_course_program') as never },
      proposed_action: { type: 'send_course_program', offering_code: over.code ?? 'real_estate' } } as never,
    state: createDefaultConversationStateV1({ workspace_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', contact_id: '33333333-3333-4333-8333-333333333333' }),
    offerings, facts: [], current_customer_messages: ['me pasas el programa?'], action_rejections: 'structured',
    ...(programs ? { course_programs: programs } : {}),
    call_policy: { may_offer_call: false, may_request_call_now: false },
  });
}
const base2 = { schema_version: 1, move: { schema_version: 1, move: 'request_course_program', secondary_moves: [], vetoes: [], confidence: 1 },
  response: { messages: ['Te comparto el programa.'] }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null };

describe('send_course_program authorization', () => {
  const available = { available_offering_codes: ['real_estate'], sent_offering_codes: [] };
  it('accepts an available, active, unsent programme requested by the customer', () => {
    expect(authorize(available)).toMatchObject({ ok: true, action: { type: 'send_course_program', offering_code: 'real_estate' } });
  });
  it.each([
    ['capability missing (env/channel)', undefined, {}],
    ['not registered / unavailable offering', available, { code: 'barista' }],
    ['unknown offering', available, { code: 'curso_inventado' }],
    ['the current message is a price objection, not course information', available, { move: 'price_objection' }],
    ['the current message is a payment question', available, { move: 'ask_payment_options' }],
  ] as const)('prunes the action without silencing the reply: %s', (_name, programs, over) => {
    const result = authorize(programs as never, over);
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, response: 'Te comparto el programa.' });
  });
  it('class/temario explanations (ask_course_information) send the material in the same turn; a price or payment turn does not', () => {
    expect(authorize(available, { move: 'ask_course_information' })).toMatchObject({ ok: true, action: { type: 'send_course_program' } });
    expect(authorize(available, { move: 'request_course_program' })).toMatchObject({ ok: true, action: { type: 'send_course_program' } });
  });
  it('choosing a course while it is explained (select_course) also sends the material (replay 9397adf t04)', () => {
    expect(authorize(available, { move: 'select_course' })).toMatchObject({ ok: true, action: { type: 'send_course_program' } });
  });
  it('already sent: the action is dropped (not an error) and the text stays', () => {
    expect(authorize({ available_offering_codes: ['real_estate'], sent_offering_codes: ['real_estate'] }))
      .toMatchObject({ ok: true, action: { type: 'none' } });
  });
});

describe('context and prompt', () => {
  it('lists only programmes not already sent', () => {
    const context = { capabilities: { course_programs: { available_offering_codes: ['real_estate', 'barista'], sent_offering_codes: ['barista'] } } };
    expect(sendableProgramCodesV1(context as never)).toEqual(['real_estate']);
    expect(sendableProgramCodesV1({ capabilities: {} } as never)).toEqual([]);
  });
  it('the context schemas carry the capability and the prompt states the contract', () => {
    const programs = { available_offering_codes: ['real_estate'], sent_offering_codes: ['barista'] };
    expect(AgentAContextV1Schema.shape.capabilities.shape.course_programs.parse(programs)).toEqual(programs);
    expect(AgentAContextV1Schema.shape.capabilities.shape.course_programs.safeParse({ ...programs, file_url: 'x' }).success).toBe(false);
  });
});

describe('stage-course-programs', () => {
  it('copies verifying sha256 and fails on a mismatch or a missing file', () => {
    const data = JSON.parse(readFileSync('supabase/seed/data/programas-studyx-pdf.json', 'utf8')) as { programs: Array<{ slug: string }> };
    const source = mkdtempSync(join(tmpdir(), 'programs-src-'));
    const target = mkdtempSync(join(tmpdir(), 'programs-out-'));
    expect(() => stageCoursePrograms(target, source)).toThrow(/STAGING_FAILED:MISSING/u);
    for (const program of data.programs) writeFileSync(join(source, `${program.slug}.pdf`), 'not the real pdf');
    expect(() => stageCoursePrograms(target, source)).toThrow(/SHA256_MISMATCH:real-estate/u);
    expect(existsSync(join(target, 'public', 'programas', 'real-estate.pdf'))).toBe(false);
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
    mkdirSync(source, { recursive: true });
  });
});

describe('programme-stated module count', () => {
  it('counts the modules the official Real Estate programme lists (focused-29-41-r3 40/real_estate_pdf: "11 módulos")', async () => {
    const { programModuleCountV1 } = await import('@/shared/catalog/course-programs');
    const data = JSON.parse(readFileSync('supabase/seed/data/programas-studyx-pdf.json', 'utf8')) as { programs: Array<{ slug: string; pages: Array<{ text: string }> }> };
    const texts = data.programs.find(program => program.slug === 'real-estate')!.pages.map(page => page.text);
    expect(programModuleCountV1(texts)).toBe(11);
    expect(programModuleCountV1([texts[0]!])).toBe(3);          // callers pass the whole programme, never one page
    expect(programModuleCountV1(['Módulo 1 - a', 'Módulo 3 - c'])).toBeNull();
    expect(programModuleCountV1([])).toBeNull();
  });
});

describe('stage-course-material', () => {
  it('fails on a missing image directory and on a hash mismatch, and stages nothing partial as success', async () => {
    const { stageCourseMaterial } = await import('../../../scripts/stage-course-programs.mjs');
    const images = mkdtempSync(join(tmpdir(), 'images-src-'));
    const target = mkdtempSync(join(tmpdir(), 'images-out-'));
    expect(() => stageCourseMaterial(target, images)).toThrow(/STAGING_FAILED:.*MISSING_IMAGE:/u);
    for (const row of COURSE_MATERIAL_ROWS_V1) writeFileSync(join(images, row[2]), 'not the real image');
    expect(() => stageCourseMaterial(target, images)).toThrow(/SHA256_MISMATCH_IMAGE:vino_cata_maridaje/u);
  });
});
