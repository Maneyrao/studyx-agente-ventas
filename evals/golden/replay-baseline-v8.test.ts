import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { evaluateHardRules, type GoldenTurnObservationV1 } from './judge';
import { GOLDEN_CASES } from './scenarios';

interface SavedTurn {
  readonly turn_id: string;
  readonly approved: boolean;
  readonly response_real: string;
  readonly move: string | null;
  readonly proposed_action: Record<string, unknown> | null;
  readonly backend_action: string | null;
  readonly backend_rejections: readonly {
    readonly rejections?: readonly { readonly code: string; readonly subject?: string }[];
  }[];
  readonly state: {
    readonly stage: string | null;
    readonly awaitingReply: string | null;
    readonly plan: string | null;
    readonly promotion: {
      readonly status: string | null;
      readonly bonusCount: number;
      readonly paidCourse: string | null;
      readonly bonusCourses: readonly string[];
    };
  };
}

interface SavedCase {
  readonly case_id: string;
  readonly approved: boolean;
  readonly turns: readonly SavedTurn[];
}

interface SavedBaseline {
  readonly environment: string;
  readonly production_or_vertice_used: boolean;
  readonly prompt_version: string;
  readonly brain_version: string;
  readonly cases: readonly SavedCase[];
}

interface SavedObservationCase {
  readonly scenario_id: string;
  readonly observations: readonly Omit<GoldenTurnObservationV1,'modelAttempts'>[];
}

interface SavedCriticalObservations {
  readonly base_sha: string;
  readonly cases: readonly SavedObservationCase[];
}

const resultsPath = path.resolve(process.cwd(), 'evals/golden/results/baseline-v8.json');
const observationsPath = path.resolve(
  process.cwd(),
  'evals/golden/fixtures/baseline-v8-critical-observations.json',
);
let baseline: SavedBaseline;
let critical: SavedCriticalObservations;
let fetchSpy: ReturnType<typeof vi.spyOn>;

function savedCase(caseId: string): SavedCase {
  const item=baseline.cases.find(candidate=>candidate.case_id===caseId);
  if(!item) throw new Error(`BASELINE_V8_CASE_MISSING:${caseId}`);
  return item;
}

function turn(item: SavedCase, turnId: string): SavedTurn {
  const saved=item.turns.find(candidate=>candidate.turn_id===turnId);
  if(!saved) throw new Error(`BASELINE_V8_TURN_MISSING:${item.case_id}/${turnId}`);
  return saved;
}

describe('offline replay of recorded baseline-v8 observations',()=>{
  beforeAll(async()=>{
    fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{
      throw new Error('NETWORK_FORBIDDEN_DURING_BASELINE_V8_REPLAY');
    });
    baseline=JSON.parse(await readFile(resultsPath,'utf8')) as SavedBaseline;
    critical=JSON.parse(await readFile(observationsPath,'utf8')) as SavedCriticalObservations;
  });
  afterAll(()=>fetchSpy.mockRestore());

  it('replays the complete accepted-call flow',()=>{
    const item=savedCase('10_requested_call');
    expect(item.approved).toBe(true);
    expect(item.turns.map(saved=>({
      id:saved.turn_id,
      approved:saved.approved,
      move:saved.move,
      action:saved.proposed_action?.type ?? saved.backend_action,
      awaiting:saved.state.awaitingReply,
    }))).toEqual([
      {id:'request',approved:true,move:'request_call',action:'none',awaiting:'contact_details'},
      {id:'data',approved:true,move:'request_call',action:'none',awaiting:'call_or_chat'},
      {id:'available',approved:true,move:null,action:'request_call_now',awaiting:'none'},
    ]);
  });

  it('replays checkout through contact confirmation, plan choice and same-turn link delivery',()=>{
    const item=savedCase('11_purchase_to_payment_link');
    expect(item.approved).toBe(true);
    expect(item.turns.map(saved=>({
      id:saved.turn_id,
      approved:saved.approved,
      move:saved.move,
      action:saved.proposed_action?.type ?? saved.backend_action,
      awaiting:saved.state.awaitingReply,
      plan:saved.state.plan,
    }))).toEqual([
      {id:'buy',approved:true,move:'select_course',action:'none',awaiting:'contact_details',plan:null},
      {id:'data',approved:true,move:'provide_contact_details',action:'none',awaiting:'payment_confirmation',plan:null},
      {id:'confirm',approved:true,move:'ask_payment_options',action:'none',awaiting:'payment_plan',plan:null},
      {id:'plan_and_link',approved:true,move:'select_payment_plan',action:'send_payment_link',awaiting:'none',plan:'monthly_12'},
    ]);
  });

  it('replays verified payment and access with every activated bonus course preserved',()=>{
    const item=savedCase('12_verified_payment_bonus_fulfillment');
    expect(item.approved).toBe(true);
    const access=turn(item,'verified_access_event');
    expect(access.approved).toBe(true);
    expect(access.state.promotion).toEqual({
      status:'accepted',
      bonusCount:2,
      paidCourse:'fotografia_profesional',
      bonusCourses:['fotografia_celulares_tiendas_online','marketing_digital'],
    });
    expect(access.response_real).toMatch(/Fotograf[ií]a Profesional/iu);
    expect(access.response_real).toMatch(/Fotograf[ií]a con Celulares para Tiendas Online/iu);
    expect(access.response_real).toMatch(/Marketing Digital/iu);
  });

  it('replays the grounded syllabus and preserves the recorded duration-followup limitation',()=>{
    const item=savedCase('13_real_syllabus');
    const syllabus=turn(item,'syllabus');
    expect(syllabus.approved).toBe(true);
    expect(syllabus.response_real).toMatch(/temario de Fotograf[ií]a Profesional/iu);
    expect(syllabus.response_real).toMatch(/ISO|obturador|diafragma/iu);

    const followup=turn(item,'duration_followup');
    expect(followup.approved).toBe(false);
    expect(followup.backend_rejections.flatMap(rejection=>rejection.rejections ?? []))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({code:'FACT_VALUE_MISMATCH',subject:'course_logistics'}),
      ]));
  });

  it('uses only the frozen local baseline and never production, Vertice or network',()=>{
    expect(baseline.environment).toBe('isolated_local');
    expect(baseline.production_or_vertice_used).toBe(false);
    expect(baseline.prompt_version).toBe('studyx-agent-a-canonical-v101');
    expect(baseline.brain_version).toBe('studyx-agent-a-brain-v140');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('replays every critical observation through the current deterministic judge',()=>{
    const replayed: { caseId:string; turnId:string; failures:number; evaluatorErrors:number }[]=[];
    for(const saved of critical.cases) {
      const scenario=GOLDEN_CASES.find(candidate=>candidate.id===saved.scenario_id);
      if(!scenario) throw new Error(`CURRENT_SCENARIO_MISSING:${saved.scenario_id}`);
      expect(saved.observations).toHaveLength(scenario.turns.length);
      for(const [index,goldenTurn] of scenario.turns.entries()) {
        const observation:GoldenTurnObservationV1={
          ...saved.observations[index]!,
          modelAttempts:[],
        };
        const previous=index===0 ? null : {
          ...saved.observations[index-1]!,
          modelAttempts:[],
        };
        const judged=evaluateHardRules(goldenTurn,observation,previous);
        replayed.push({
          caseId:saved.scenario_id,
          turnId:goldenTurn.id,
          failures:judged.failures.length,
          evaluatorErrors:judged.evaluatorErrors.length,
        });
      }
    }

    expect(replayed).toHaveLength(11);
    expect(replayed.filter(result=>result.evaluatorErrors>0)).toEqual([]);
    expect(replayed.filter(result=>result.failures>0)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
