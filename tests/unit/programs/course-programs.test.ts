import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COURSE_PROGRAM_ASSETS_V1, courseProgramAssetV1, courseProgramUrlV1 } from '@/shared/catalog/course-programs';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { AgentATurnProposalV1Schema } from '@/features/conversation/adapters/agent-a-brain-schema';
import { AgentATurnProposalV1Schema as BotpressProposalSchema, AgentAContextV1Schema } from '../../../botpress-agent/src/schemas/agent-a-brain';
import { DecisionBusinessActionSchema } from '../../../botpress-agent/src/schemas/contracts';
import { sendableProgramCodesV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { stageCoursePrograms } from '../../../scripts/stage-course-programs.mjs';
import { OFFERING_CODES } from '../../../scripts/generate-studyx-programs-seed.mjs';

const ENV = { STUDYX_PUBLIC_ASSET_BASE_URL: 'https://assets.example.com/' };

describe('course program registry', () => {
  it('equals the official programme PDFs plus the offering-code mapping', () => {
    const data = JSON.parse(readFileSync('supabase/seed/data/programas-studyx-pdf.json', 'utf8')) as { programs: Array<{ slug: string; sha256: string }> };
    const expected = data.programs.filter(program => (OFFERING_CODES as Record<string, string>)[program.slug])
      .map(program => [(OFFERING_CODES as Record<string, string>)[program.slug]!, program.slug, program.sha256]);
    const actual = [...COURSE_PROGRAM_ASSETS_V1.values()].map(asset => [asset.offering_code, asset.slug, asset.sha256]);
    expect(actual.sort()).toEqual(expected.sort());
    expect(courseProgramAssetV1('real_estate')).toMatchObject({ slug: 'real-estate', mime: 'application/pdf',
      filename: 'Programa Real Estate - Studyx.pdf', version: 'f7631135a630' });
    for (const asset of COURSE_PROGRAM_ASSETS_V1.values()) expect(asset.filename).not.toMatch(/[\\/]/u);
  });
  it('builds the public URL only from env + registry slug, https only; no env means unavailable', () => {
    expect(courseProgramUrlV1('real_estate', ENV)).toBe('https://assets.example.com/programas/real-estate.pdf');
    expect(courseProgramUrlV1('real_estate', {})).toBeNull();
    expect(courseProgramUrlV1('real_estate', { STUDYX_PUBLIC_ASSET_BASE_URL: 'http://assets.example.com' })).toBeNull();
    expect(courseProgramUrlV1('real_estate', { STUDYX_PUBLIC_ASSET_BASE_URL: 'not a url' })).toBeNull();
    expect(courseProgramUrlV1('curso_inventado', ENV)).toBeNull();
    expect(courseProgramUrlV1('../../etc/passwd', ENV)).toBeNull();
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
    ['the current message is not a programme request', available, { move: 'ask_course_information' }],
  ] as const)('prunes the action without silencing the reply: %s', (_name, programs, over) => {
    const result = authorize(programs as never, over);
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, response: 'Te comparto el programa.' });
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
