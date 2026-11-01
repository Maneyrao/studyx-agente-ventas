import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { replayNegotiationArchiveV1, portableNegotiationFailureV1 } from './replay-negotiation-invariants';
import { GOLDEN_CASES } from './scenarios';
describe('recorded negotiation invariant replay',()=>{
  it('never calls a model, preserves original failures and never passes unknown coverage',()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('MODELS_FORBIDDEN');});
    try{
      const root=path.resolve('docs/reports/evidence/2026-11-01-backend-negotiation-ladder/raw');
      const r1=replayNegotiationArchiveV1(path.join(root,'r1'),'evaluation-test');
      const r2=replayNegotiationArchiveV1(path.join(root,'r2'),'evaluation-test');
      expect(fetch).not.toHaveBeenCalled();
      expect(r1.execution_sha).toContain('10d7b3e');expect(r1.evaluation_sha).toBe('evaluation-test');
      expect(r1.cases.every(c=>c.approved!==true)).toBe(true);
      expect(r1.unchanged_cases.find(c=>c.case_id.startsWith('07_'))?.approved).toBe(true);
      expect(r2.unchanged_cases.find(c=>c.case_id.startsWith('07_'))?.approved).toBe(true);
      expect(r1.unchanged_cases.find(c=>c.case_id.startsWith('04_'))?.passed_turns).toBe(2);
      expect(r2.unchanged_cases.find(c=>c.case_id.startsWith('04_'))?.passed_turns).toBe(1);
      expect(r1.gate.ready_for_full_suite).toBe(false);expect(r2.gate.ready_for_full_suite).toBe(false);
      expect(r1.cases[0].historical_failure_classification.some((f:{classification:string})=>f.classification==='RETIRED_POSITIONAL')).toBe(true);
      const c=r2.cases.find(c=>c.case_id.startsWith('14_'))!;
      expect(c.status).toBe('FAIL');
      const mapped=c.original_semantic_evidence.find((v:{turn_id:string})=>v.turn_id==='bonus_1');
      expect(mapped.mappings.some((m:{portable:boolean;status:string})=>m.portable&&m.status==='FAIL')).toBe(true);
      expect(mapped.original_verdict.approved).toBe(false);
      expect(mapped.mappings[0].exact_original_citation).toContain('prompt-agente-a-studyx-v2.md:123');
      expect(r1.cases[0].original_semantic_evidence.some((v:{mappings?:unknown[]})=>v.mappings?.length)).toBe(true);
    }finally{fetch.mockRestore();}
  });
  it('does not port a changed criterion or invent semantic PASS',()=>{
    const turn=GOLDEN_CASES[13]!.turns.find(t=>t.id==='bonus_1')!;
    const verdict=portableNegotiationFailureV1({caseId:'14_course_change_cancels_promotion',turn:{...turn,must:['changed criterion']},failure:{requirement_id:'must:0'},observation:{proposedAction:{type:'none'},response:'different'} as never});
    expect(verdict.portable).toBe(false);expect(verdict.status).toBe('INDETERMINATE');
  });
});
