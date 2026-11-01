/** Reproduce evaluation of archived 10d7 executions without network or model calls. */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_CASES, type GoldenCaseV1, type GoldenTurnV1 } from './scenarios';
import type { GoldenTurnObservationV1 } from './judge';
import { evaluateHardRules, turnHasRequiredPriorPromotion } from './judge';
import { negotiationEvidenceV1 } from './negotiation-evidence';
import { evaluateNegotiationInvariantsV1, type InvariantStatusV1 } from './negotiation-invariants';

// Historical artifacts are preserved losslessly; only the fields consumed by the typed invariant engine are narrowed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const read=(p:string):Json=>JSON.parse(readFileSync(p,'utf8'));
const digest=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const evaluatorFiles=['negotiation-invariants.ts','negotiation-invariants.test.ts','negotiation-evidence.ts','replay-negotiation-invariants.ts','replay-negotiation-invariants.test.ts','judge.ts','judge.test.ts','scenarios.ts','live-runner.test.ts','runner-support.ts','comparison.ts','comparison.test.ts','NEGOTIATION-INVARIANTS.md'];
const normalized=(s:string)=>s.replaceAll('¿','').replaceAll('¡','').split(/\s+/u).join(' ').trim();
function decode(raw:string):Json {
  try{return JSON.parse(raw);}catch(error){if(raw.trimEnd().endsWith('}')){try{return JSON.parse(raw.trimEnd().slice(0,-1));}catch{ /* Preserve original failure. */ }}throw error;}
}
/** Explicit reviewed semantic mapping. Literal criterion, source and evidence must all match. */
export function portableNegotiationFailureV1(input:{caseId:string;turn:GoldenTurnV1;failure:Json;observation:GoldenTurnObservationV1}) {
  const f=input.failure;
  const requirement=input.turn.must[0];
  const expected='Con los escalones previos completos, ofrecer un solo complemento afín mediante offer_course_bonus.';
  const explanation='Con los escalones previos completos y objeción de precio persistente, debía ofrecer un complemento afín mediante proposed_action=offer_course_bonus con un código; en su lugar proposed_action es none y solo se insinúa un curso extra sin nombrarlo ni usar la acción requerida.';
  const delivered='Perfecto, seguimos por chat. Ya sabemos que Fotografía Profesional es lo que querés y que el precio es el único freno, así que te propongo algo: si sumo un curso extra a tu inscripción, sin cambiar los USD 360, te ayudaría a avanzar?';
  const exactReferences=JSON.stringify(input.turn.authority)===JSON.stringify([{file:'docs/authority/prompt-agente-a-studyx-v2.md',start:104,end:124,contains:'Bonificación'},{file:'docs/authority/spec-backend-bonificacion.md',start:55,end:69,contains:'Si pasa: agregar'}]);
  const portable=exactReferences&&input.caseId==='14_course_change_cancels_promotion'&&input.turn.id==='bonus_1'
    &&requirement===expected&&f.code==='SEMANTIC_MUST_FAILED'&&f.requirement_id==='must:0'
    &&f.authority_line_index===14&&f.evidence_source==='proposed_action'&&f.observed_evidence==='"type":"none"'
    &&f.explanation===explanation&&input.observation.proposedAction?.type==='none'&&input.observation.response===delivered;
  return {portable,invariant:portable?'bonus_claim_action_consistency':null,status:portable?'FAIL':'INDETERMINATE',
    original_requirement_id:f.requirement_id,original_requirement_literal:requirement,
    original_authority_references:input.turn.authority,new_authority:'docs/authority/prompt-agente-a-studyx-v2.md:123; docs/authority/spec-backend-bonificacion.md:71',
    original_evidence_source:f.evidence_source,original_observed_evidence:f.observed_evidence,original_explanation:f.explanation,
    exact_delivered_text:input.observation.response,
    basis:portable?'Reviewed narrow mapping: proposing an implied new extra without offer_course_bonus is the same action-consistency defect. The timing-dependent clause is not reused.':'No reviewed same-criterion/same-evidence mapping; do not turn this historical verdict into PASS.'};
}
function authorityCitationsAtExecution(turn:GoldenTurnV1,sha:string) {
  const result:string[]=[];
  for(const ref of turn.authority){
    const lines=execFileSync('git',['show',`${sha}:${ref.file}`],{encoding:'utf8'}).split('\n');
    for(let n=ref.start;n<=ref.end;n++)if(lines[n-1]?.trim())result.push(`${ref.file}:${n} | ${lines[n-1]}`);
  }
  return [...new Set(result)];
}
export function replayNegotiationArchiveV1(directory:string,evaluationSha:string) {
  const files=readdirSync(directory);const reportName=files.find(f=>f.endsWith('.json')&&!f.includes('-provider')&&!f.includes('-observations')&&!f.includes('-durable')&&!f.includes('-run-state'));
  if(!reportName)throw Error('ORIGINAL_REPORT_MISSING');
  const stem=reportName.slice(0,-5);
  const names=[reportName,`${stem}-provider.json`,`${stem}-observations.partial.json`,`${stem}-durable-evidence.json`];
  const inputHashes=Object.fromEntries(names.map(n=>[n,digest(path.join(directory,n))]));
  const [report,provider,saved,durable]=names.map(n=>read(path.join(directory,n)));
  if(provider.status!=='completed')throw Error('ORIGINAL_PROVIDER_NOT_COMPLETED');
  const rawEvents=(durable.records as Json[]).filter(e=>e.payload?.observation?.kind==='model_raw');
  const verdicts=(provider.report.records as Json[]).filter(r=>r.role==='judge').map(r=>({call_id:r.call_id,verdict:decode(r.response_content).verdict}));
  const agentRecords=(provider.report.records as Json[]).filter(r=>r.role==='agent');
  let cursor=0,agentCursor=0;const cases:Json[]=[];
  for(const item of saved.cases as {scenario:GoldenCaseV1;observations:GoldenTurnObservationV1[]}[]){
    const originalSemantic:Json[]=[];const observations=item.observations.map(o=>({...o}));
    for(const [i,t] of item.scenario.turns.entries()){
      const o=observations[i]!;
      const start=agentCursor;
      const matches=agentRecords.slice(start,start+o.modelAttempts.length);
      if(matches.length!==o.modelAttempts.length)throw Error(`AGENT_ATTEMPT_COUNT_MISMATCH:${item.scenario.id}/${t.id}`);
      for(const [attemptIndex,r] of matches.entries()){
        const p=decode(r.response_content);const a=o.modelAttempts[attemptIndex]!;
        const msgs=[...(p.response?.messages??[]),...(p.response?.call_offer?[p.response.call_offer]:[])];
        if(normalized(a.response??'')!==normalized(msgs.join('\n'))||a.move!==p.move?.move||JSON.stringify(a.proposedAction)!==JSON.stringify(p.proposed_action)||a.providerStatus!==r.status)throw Error(`AGENT_ATTEMPT_IDENTITY_MISMATCH:${item.scenario.id}/${t.id}/${attemptIndex}`);
        const event=rawEvents[start+attemptIndex];
        if(!event||event.payload.observation.data.raw_content!==r.response_content)throw Error(`DURABLE_RAW_ORDER_MISMATCH:${item.scenario.id}/${t.id}/${attemptIndex}`);
      }
      agentCursor+=matches.length;
      const first=matches.at(-1);
      if(first){
        const instructions=first.provider_response?.instructions??'';
        const context=JSON.parse(instructions.split('<authorized_context>')[1].split('</authorized_context>')[0]);
        const event=rawEvents[agentCursor-1]!;
        o.negotiationFacts={currentTurnId:event.payload.observation.subject_id,
          priorPriceSourceIds:context.commercial_state?.negotiation?.price_objections.latest_source_turn_ids,
          ladder:context.capabilities?.course_bonus?.ladder};
      }
      // The historical skip controls only the old semantic call, never factual extraction.
      if(!turnHasRequiredPriorPromotion(t,observations[i-1]??null)){
        originalSemantic.push({turn_id:t.id,status:'NOT_EXERCISED',original_skip:'priorPromotion precondition'});continue;
      }
      const source=verdicts[cursor++];if(!source||source.verdict.turn_id!==t.id)throw Error(`AMBIGUOUS_JUDGE_MAPPING:${item.scenario.id}/${t.id}`);
      const citations=authorityCitationsAtExecution(t,report.base_sha);
      originalSemantic.push({turn_id:t.id,original_call_id:source.call_id,original_verdict:source.verdict,
        mappings:(source.verdict.failures as Json[]).map(f=>({...portableNegotiationFailureV1({caseId:item.scenario.id,turn:t,failure:f,observation:o}),exact_original_citation:citations[f.authority_line_index],original_requirement_literal:f.requirement_id?.startsWith('must_not:')?t.mustNot[Number(f.requirement_id.slice(9))]:t.must[Number(f.requirement_id?.slice(5))]})),
        status:'INDETERMINATE',
        portability_note:'Historical success is not proof of all new conversation invariants. Unmapped failures remain visible, never PASS.'});
    }
    if(item.scenario.id.startsWith('06_')||item.scenario.id.startsWith('14_')){
      const portableFail=originalSemantic.some(v=>v.mappings?.some((m:Json)=>m.portable&&m.status==='FAIL'));
      const semanticStatus:InvariantStatusV1=portableFail?'FAIL':'INDETERMINATE';
      const objective=item.scenario.turns.map((t,i)=>({turn_id:t.id,...evaluateHardRules(t,observations[i]!,observations[i-1]??null,'negotiation_invariants')}));
      const factStatus:InvariantStatusV1=objective.some(v=>v.failures.length)?'FAIL':objective.some(v=>v.evaluatorErrors.length)?'INDETERMINATE':'PASS';
      const evaluation=evaluateNegotiationInvariantsV1(item.scenario.id,item.scenario.turns.map((t,i)=>negotiationEvidenceV1({...t,negotiationProbe:GOLDEN_CASES.find(c=>c.id===item.scenario.id)?.turns.find(current=>current.id===t.id&&current.customer===t.customer)?.negotiationProbe},observations[i]!)),semanticStatus,factStatus);
      const originalCase=report.cases.find((c:Json)=>c.case_id===item.scenario.id);
      const historicalFailures=(originalCase?.turns??[]).flatMap((t:Json)=>t.failures.map((f:Json)=>{
        const positionalInstallmentText=f.code==='TEXT_REQUIRED_MISSING'&&item.scenario.turns.find(source=>source.id===t.turn_id)?.hard?.some(rule=>rule.type==='contains'&&rule.value==='USD 30');
        return {turn_id:t.turn_id,...f,
          ...(positionalInstallmentText?{reevaluation_status:'INDETERMINATE',replacement_criterion:'installment_reframe',replacement_note:'The old exact-turn USD30 text check was removed; the authorized 12xUSD30/USD360 facts remain a conversation-semantic criterion, not an objectively re-evaluated text contains check.'}:{}),
          classification:positionalInstallmentText?'POSITIONAL_TEXT_REPLACED_BY_TRAJECTORY_SEMANTICS':['MOVE_MISMATCH','ACTION_MISMATCH','PROMOTION_STATUS_MISMATCH','PROMOTION_BONUS_COUNT_MISMATCH','PROMOTION_PAID_COURSE_MISMATCH'].includes(f.code)&&t.turn_id!=='change'||f.code==='PROMOTION_LIMIT_EXCEEDED'&&item.scenario.turns.find(source=>source.id===t.turn_id)?.hard?.some(rule=>rule.type==='promotion_bonus_count_at_most'&&rule.value===0)||f.code==='BONUS_AFFINITY_MISMATCH'&&!t.backend_action?'RETIRED_POSITIONAL':f.code==='TURN_PRECONDITION_NOT_REACHED'?'ORIGINAL_NOT_EXERCISED':f.code.startsWith('SEMANTIC_')?'SEMANTIC_REQUIRES_PORTABILITY_MAPPING':'FACT_RETAINED_FOR_OBJECTIVE_REEVALUATION'};}));
      const semanticInvariantCoverage=['personalized_value','installment_reframe','price_isolation_conditional_close','commercial_order_and_appropriate_call','bonus_affinity','useful_close','bonus_claim_action_consistency'].map(id=>({id,status:id==='bonus_claim_action_consistency'&&portableFail?'FAIL':'INDETERMINATE',reason:id==='bonus_claim_action_consistency'&&portableFail?'Exact reviewed original verdict/evidence mapping.':'No positive same-criterion/same-evidence semantic mapping; cannot certify without new semantic review.'}));
      cases.push({case_id:item.scenario.id,original_approved:report.cases.find((c:Json)=>c.case_id===item.scenario.id)?.approved,
        ...evaluation,objective_fact_results:objective,historical_failure_classification:historicalFailures,semantic_invariant_coverage:semanticInvariantCoverage,original_semantic_evidence:originalSemantic});
    }
  }
  if(agentCursor!==agentRecords.length||agentCursor!==rawEvents.length)throw Error(`UNASSIGNED_AGENT_OR_DURABLE_RECORDS:${agentCursor}/${agentRecords.length}/${rawEvents.length}`);
  if(cursor!==verdicts.length)throw Error(`UNASSIGNED_JUDGE_RECORDS:${verdicts.length-cursor}`);
  for(const n of names)if(digest(path.join(directory,n))!==inputHashes[n])throw Error('ORIGINAL_MUTATED');
  const unchangedCases=report.cases.filter((c:Json)=>!['06','14'].includes(c.case_id.slice(0,2))).map((c:Json)=>({case_id:c.case_id,evaluation_mode:'ORIGINAL_UNCHANGED',approved:c.approved,status:c.approved===true?'PASS':c.approved===false?'FAIL':'INDETERMINATE',passed_turns:c.turns.filter((t:Json)=>t.approved===true).length,total_turns:c.turns.length,original_turns:c.turns}));
  const gateCases=['06','07','14'].map(code=>{const c=[...cases,...unchangedCases].find(c=>c.case_id.startsWith(code+'_'));return {code,status:c?.status??'INDETERMINATE',approved:c?.approved??null};});
  const gateStatus=gateCases.some(c=>c.status==='FAIL')?'FAIL':gateCases.every(c=>c.status==='PASS')?'PASS':'INDETERMINATE';
  return {execution_sha:report.base_sha,execution_brain_version:report.brain_version,execution_prompt_version:report.prompt_version,new_repair_prompt_measured:false,evaluation_sha:evaluationSha,evaluation_mode:'negotiation_invariants',model_calls:0,
    evaluation_worktree_dirty:execFileSync('git',['status','--porcelain','--',...evaluatorFiles.map(n=>`evals/golden/${n}`)],{encoding:'utf8'}).trim().length>0,
    evaluation_source_sha256:Object.fromEntries(evaluatorFiles.map(n=>[n,digest(path.join(path.dirname(fileURLToPath(import.meta.url)),n))])),
    correlation_basis:'Exhaustive ordered agent request cursor; each recorded attempt identity verified; matching ordered durable raw event; final attempt context including historically skipped turns.',
    original_directory:directory,original_hashes:inputHashes,cases,unchanged_cases:unchangedCases,gate:{required_codes:['06','07','14'],cases:gateCases,status:gateStatus,ready_for_full_suite:gateStatus==='PASS'},
    measurement_note:'Offline evaluation of v146 execution10d7; does not measure the new v147 repair prompt.',
    disclosure:'New deterministic evaluation plus explicitly mapped original semantic evidence. NOT a new model acceptance; INDETERMINATE/NOT_EXERCISED cannot pass a gate.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const archive=path.resolve(process.argv[2]??'docs/reports/evidence/2026-11-01-backend-negotiation-ladder/raw');
  const output=path.resolve(process.argv[3]??'evals/golden/results/negotiation-invariants-offline');
  if(output===archive||output.startsWith(archive+path.sep))throw Error('OUTPUT_MUST_NOT_OVERWRITE_ARCHIVE');
  const evaluationSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  mkdirSync(output,{recursive:true});
  const results=['r1','r2'].map(run=>({run,...replayNegotiationArchiveV1(path.join(archive,run),evaluationSha)}));
  const combinedGate={required_codes:['06','07','14'],runs:results.map(r=>({run:r.run,...r.gate})),ready_for_full_suite:results.every(r=>r.gate.ready_for_full_suite)};
  writeFileSync(path.join(output,'replay.json'),JSON.stringify({results,combined_gate:combinedGate},null,2)+'\n');
  const lines=['# Offline negotiation invariant replay','',`Evaluation SHA: ${evaluationSha}. Source hashes and dirty-worktree flag are in replay.json. No model calls; original scores remain in archived inputs.`, '', '| Run | Case | Execution SHA | Status | Approved |', '|---|---|---|---|---|'];
  for(const r of results)for(const c of r.cases)lines.push(`| ${r.run} | ${c.case_id} | ${r.execution_sha} | ${c.status} | ${c.approved} |`);
  lines.push('', '## Gate 06/07/14, ambas corridas', '', `Full-suite prerequisite passed: ${combinedGate.ready_for_full_suite}. Original case07 stays unchanged;03/04 scores are preserved and not rejudged. This is not a measurement of the new v147 repair prompt.`, '', 'INDETERMINATE and NOT_EXERCISED cannot pass acceptance. Historical semantic failures without a reviewed same-criterion/evidence mapping remain explicitly preserved as nonportable, never silently approved.');
  writeFileSync(path.join(output,'replay.md'),lines.join('\n')+'\n');
  console.log(JSON.stringify(results.map(r=>({run:r.run,execution_sha:r.execution_sha,evaluation_sha:r.evaluation_sha,cases:r.cases.map(c=>({id:c.case_id,status:c.status,approved:c.approved,checks:c.checks}))})),null,2));
}
