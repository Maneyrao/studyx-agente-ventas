/** Offline replay of recorded v149 drafts through the shared server course-focus/role boundary. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveConversationCourseFocusV1 } from '../../src/features/orchestration/domain/course-focus';
import { validateCourseMentionsV1 } from '../../src/shared/conversation/course-mentions';
import type { CatalogIndexView } from '../../src/features/orchestration/domain/business-context';

// Original provider JSON stays intact; this type is limited to archived data inspection.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Recorded=Record<string,any>;
const base='docs/reports/evidence/2026-11-01-formal-acceptance-v149';
const providerFile=`${base}/raw/acceptance-f1f0f9c-flash-full16-20261101-provider.json`;
const diagnosticsFile=`${base}/diagnostics.json`;
const digest=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const cases=[
  {case:'05_real_budget_limit',turn:'interest',course:'marketing_digital',calls:['call-0010','call-0011','call-0012']},
  {case:'05_real_budget_limit',turn:'budget',course:'marketing_digital',calls:['call-0013','call-0014','call-0015']},
  {case:'13_real_syllabus',turn:'syllabus',course:'fotografia_profesional',calls:['call-0043','call-0044','call-0045']},
  {case:'13_real_syllabus',turn:'duration_followup',course:'fotografia_profesional',calls:['call-0046','call-0047','call-0048']},
] as const;

export function replayPaidRoleAlignmentV1(){
  const inputs=[providerFile,diagnosticsFile];
  const before=Object.fromEntries(inputs.map(file=>[file,digest(readFileSync(file))]));
  const provider=JSON.parse(readFileSync(providerFile,'utf8'));
  const diagnostics=JSON.parse(readFileSync(diagnosticsFile,'utf8'));
  const rows:Recorded[]=[];const negatives:Recorded[]=[];
  for(const scenario of cases){
    const historical=diagnostics.difference_review_rows.find((row:Recorded)=>row.case===scenario.case&&row.turn===scenario.turn);
    assert(historical);
    assert.deepEqual(historical.evidence.generation_snapshots.map((s:Recorded)=>s.call_id),scenario.calls);
    for(const callId of scenario.calls){
      const record=provider.report.records.find((r:Recorded)=>r.call_id===callId);assert(record);
      const context=JSON.parse(record.provider_response.instructions.split('<authorized_context>')[1].split('</authorized_context>')[0]);
      const raw=JSON.parse(record.response_content);
      assert.equal(raw.proposed_action.type,'none');
      assert.equal(context.commercial_state.selected_offering_code,scenario.course);
      const catalog:CatalogIndexView={as_of:'historical-captured-identity-index',offerings_total:context.catalog.available_offerings.length,
        injection_suspected_count:0,offerings:context.catalog.available_offerings.map((course:Recorded)=>({
          code:course.code,display_name:course.display_name,academy:null,aliases:[],
        }))};
      const focus=deriveConversationCourseFocusV1({
        currentMessageTexts:context.turn.batch_messages.map((m:Recorded)=>m.text),
        recentTurns:context.turn.recent_turns,catalogIndex:catalog,
      });
      assert.equal(focus.offering_code,scenario.course,`${scenario.case}/${scenario.turn}/${callId}: trusted focus`);
      const input={messages:raw.response.messages,call_offer:raw.response.call_offer,
        catalog:catalog.offerings,course_mentions:raw.course_mentions,paid_offering_code:null,
        delivered_bonus_offering_codes:[],ladder:context.capabilities.course_bonus?.ladder};
      const baseline=validateCourseMentionsV1(input);
      assert(baseline.violations.some(v=>v.subject===`course_mentions:paid_mismatch:${scenario.course}`));
      const result=validateCourseMentionsV1({...input,paid_mention_offering_code:focus.offering_code});
      assert.deepEqual(result.violations,[],`${scenario.case}/${scenario.turn}/${callId}: role boundary`);
      rows.push({case:scenario.case,turn:scenario.turn,call_id:callId,source_execution_sha:'f1f0f9c5d3676d324642238e43279c0c0fada2b7',
        original_model_content:record.response_content,original_model_sha256:digest(record.response_content),
        draft:raw.response,messages_received:context.turn.batch_messages,
        generation_selected_offering_code:context.commercial_state.selected_offering_code,
        persisted_paid_anchor_for_replay:null,server_derived_paid_mention_offering_code:focus.offering_code,
        original_proposed_action:raw.proposed_action,baseline_violations:baseline.violations,replayed_violations:result.violations,
        scope:'Course-focus and role boundary only; no purchase, effect, persistence or delivery performed. Other fact/style checks are not marked passed by this replay.',
        history_provenance:'Already session-bounded history captured in the original model context; timestamps and catalog aliases are not fabricated.',
      });
      if(callId!==scenario.calls[0])continue;
      const extra=catalog.offerings.find(course=>course.code==='excel_integral');assert(extra);
      const wrongPaid=validateCourseMentionsV1({...input,paid_mention_offering_code:focus.offering_code,
        course_mentions:[{offering_code:extra.code,role:'paid'}]});
      assert(wrongPaid.violations.some(v=>v.subject===`course_mentions:paid_mismatch:${extra.code}`));
      const unsupportedBonus=validateCourseMentionsV1({...input,paid_mention_offering_code:focus.offering_code,
        messages:[`El curso incluye ${extra.display_name}.`],
        course_mentions:[{offering_code:extra.code,role:'bonus'}]});
      assert(unsupportedBonus.violations.some(v=>v.subject==='forbidden_promise'));
      negatives.push({case:scenario.case,turn:scenario.turn,kind:'controlled_wrong_paid',violations:wrongPaid.violations},
        {case:scenario.case,turn:scenario.turn,kind:'controlled_bonus_without_effect',violations:unsupportedBonus.violations});
    }
  }
  for(const file of inputs)assert.equal(digest(readFileSync(file)),before[file],`Input changed:${file}`);
  assert.equal(rows.length,12);assert.equal(negatives.length,8);
  return {schema_version:1,evaluation_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    evaluation_worktree_dirty:execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().length>0,
    model_calls:0,persistence_calls:0,deliveries:0,originals_modified:false,input_sha256:before,
    summary:{recorded_turns:4,recorded_attempts:12,baseline_paid_mismatch:12,replayed_paid_mismatch:0,controlled_negative_rejections:8},
    disclosure:'Recorded original proposals, not newly generated responses. No authority, golden score or original attempt is altered. Production session boundaries are separately covered by projector/integration tests.',rows,controlled_negatives:negatives};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  globalThis.fetch=async()=>{throw Error('OFFLINE_REPLAY_NETWORK_FORBIDDEN');};
  const output=path.resolve(process.argv[2]??'docs/reports/evidence/2026-11-01-paid-role-alignment');
  assert(!output.startsWith(path.resolve(base)+path.sep),'Archived inputs are immutable');
  const report=replayPaidRoleAlignmentV1();mkdirSync(output,{recursive:true});
  writeFileSync(path.join(output,'offline-replay.json'),JSON.stringify(report,null,2)+'\n');
  const esc=(text:unknown)=>String(text).replaceAll('|','\\|').replaceAll('\n','<br>');
  const lines=['# Replay de paid_mismatch','',report.disclosure,'',`SHA evaluación: ${report.evaluation_sha}. Modelo/DB/entrega: 0.`,
    '', '| Caso/turno | Intento | Selección recibida | Foco reconstruido | Antes | Ahora | Borrador original |', '|---|---|---|---|---|---|---|'];
  for(const row of report.rows)lines.push('| '+[`${row.case}/${row.turn}`,row.call_id,row.generation_selected_offering_code,
    row.server_derived_paid_mention_offering_code,'paid_mismatch','PASS sólo rol',row.draft.messages.join('\n')].map(esc).join(' | ')+' |');
  writeFileSync(path.join(output,'offline-replay.md'),lines.join('\n')+'\n');console.log(JSON.stringify(report.summary));
}
