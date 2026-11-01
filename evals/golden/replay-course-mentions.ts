/** Read-only recorded-text shadow validation. No model generation, database, or delivery. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCourseMentionsV1, type CourseMentionV1 } from '../../src/shared/conversation/course-mentions';

type GuardInput=Parameters<typeof validateCourseMentionsV1>[0];
// Artifact JSON is preserved losslessly; authority fields are explicitly narrowed below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Recorded=Record<string,any>;
const base='docs/reports/evidence/2026-11-01-flash-v147-acceptance';
const searchIndex='docs/reports/evidence/2026-10-31-offline-replay/offline-replay-index.json';
const extra='fotografia_celulares_tiendas_online';
const extraName='Fotografía con Celulares para Tiendas Online';
const paid='fotografia_profesional';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const inputs=new Map<string,string>();
const read=(file:string):Recorded=>{const contents=readFileSync(file,'utf8');inputs.set(file,hash(contents));return JSON.parse(contents);};
const norm=(text:string)=>text.replaceAll('¿','').replaceAll('¡','').split(/\s+/u).join(' ').trim();
const rows:Recorded[]=[];
const runs=new Map<string,Recorded>();
function loadRun(stem:string):Recorded {
  const cached=runs.get(stem);if(cached)return cached;
  const dirs=readdirSync(`${base}/raw`).filter(dir=>readdirSync(`${base}/raw/${dir}`).includes(`${stem}-provider.json`));
  assert.equal(dirs.length,1,`Ambiguous run:${stem}`);
  const prefix=`${base}/raw/${dirs[0]}/${stem}`;
  const value={prefix,provider:read(`${prefix}-provider.json`),report:read(`${prefix}.json`),durable:read(`${prefix}-durable-evidence.json`)};
  assert.equal(value.provider.status,'completed');runs.set(stem,value);return value;
}
function historical(record:Recorded):Recorded {
  const run=loadRun(record.run);const callId=record.evidence.provider_call_ids.at(-1);
  const calls=run.provider.report.records.filter((r:Recorded)=>r.role==='agent'&&r.call_id===callId);
  assert.equal(calls.length,1);const provider=calls[0];const raw=JSON.parse(provider.response_content);
  assert.equal(Object.hasOwn(raw,'course_mentions'),false,'Do not fabricate metadata in v147 outputs');
  const context=JSON.parse(provider.provider_response.instructions.split('<authorized_context>')[1].split('</authorized_context>')[0]);
  const resultCase=run.report.cases.find((c:Recorded)=>c.case_id===record.case);
  const turn=resultCase.turns.find((t:Recorded)=>t.turn_id===record.turn);
  assert.equal(record.delivered,turn.response_real);assert.equal(hash(record.delivered),record.delivered_sha256);
  const draft=[...raw.response.messages,...(raw.response.call_offer?[raw.response.call_offer]:[])].join('\n');
  assert.equal(norm(draft),norm(record.delivered),'Only original draft / authorized technical normalization');
  const events=run.durable.records.filter((e:Recorded)=>e.correlation_id===record.evidence.trace_id);
  const commits=events.filter((e:Recorded)=>e.action==='agent.decision.committed');assert.equal(commits.length,1);
  assert.equal(commits[0].payload.business_action,turn.backend_action);
  const delivered=context.capabilities.course_bonus?.delivered_bonus_offerings?.map((c:Recorded)=>c.code)??[];
  const selected=turn.state.selectedCourse;
  if(record.turn!=='change')assert.equal(context.commercial_state.selected_offering_code,selected);
  let action:GuardInput['authorized_bonus_action'];
  if(raw.proposed_action.type==='offer_course_bonus'){
    assert.equal(turn.backend_action,'offer_course_bonus');
    assert.equal(context.capabilities.course_bonus.enabled,true);
    assert.equal(context.capabilities.course_bonus.may_offer_bonus,true);
    assert.equal(context.capabilities.course_bonus.ladder.eligible,true);
    action={paid_offering_code:raw.proposed_action.interest_offering_code,bonus_offering_code:raw.proposed_action.bonus_offering_code};
  }
  const input:GuardInput={messages:[record.delivered],catalog:context.catalog.available_offerings.map((c:Recorded)=>({code:c.code,display_name:c.display_name})),paid_offering_code:selected,delivered_bonus_offering_codes:delivered,ladder:context.capabilities.course_bonus?.ladder,...(action?{authorized_bonus_action:action}:{})};
  return {input,raw,record,run,provenance:{kind:'historical_recorded_final',execution_sha:run.report.base_sha,brain_version:run.report.brain_version,
    audit_file:`${base}/delivery-audit.json`,provider_file:`${run.prefix}-provider.json`,report_file:`${run.prefix}.json`,durable_file:`${run.prefix}-durable-evidence.json`,
    run:record.run,case:record.case,turn:record.turn,call_id:callId,trace_id:record.evidence.trace_id,commit_event_id:commits[0].id,
    delivered_sha256:record.delivered_sha256,raw_model_content:provider.response_content,raw_model_content_sha256:hash(provider.response_content),raw_draft:draft,raw_draft_sha256:hash(draft),raw_model_course_mentions_present:false,raw_model_course_mentions:null,
    original_proposed_action:raw.proposed_action,recorded_backend_action:turn.backend_action,recorded_package:turn.state.promotion,
    recorded_rejection_subjects:record.evidence.rejection_subjects,recorded_repair_count:record.evidence.prior_repair_count}};
}
function add(id:string,source:Recorded,input:GuardInput,annotation:readonly CourseMentionV1[]|null,expectation:{pass:boolean;code?:string;subjects?:readonly string[]},note:string){
  const effective={...input,...(annotation===null?{}:{course_mentions:annotation})};
  const result=validateCourseMentionsV1(effective);
  assert.equal(result.violations.length===0,expectation.pass,id);
  if(expectation.code)assert(result.violations.some(v=>v.code===expectation.code),`${id}: code`);
  for(const subject of expectation.subjects??[])assert(result.violations.some(v=>v.subject===subject),`${id}:${subject}`);
  if(source.provenance.kind==='historical_recorded_final')assert(result.named_offering_codes.includes(extra),`${id}: literal extra must be recognized`);
  rows.push({id,provenance:source.provenance,text:effective.messages.join('\n'),text_sha256:hash(effective.messages.join('\n')),
    role_annotation:annotation===null?{kind:'original_missing_field',value:null}:{kind:'explicit_reviewer_sidecar_not_original_model_metadata',author:'Codex explicit replay annotation; not historical model output',value:annotation},
    authoritative_input:effective,helper_result:result,expected:expectation,assertions_passed:true,note});
}
const annotation=(role:CourseMentionV1['role']):CourseMentionV1[]=>[{offering_code:paid,role:'paid'},{offering_code:extra,role}];
export function replayCourseMentionsV1(){
  rows.length=0;inputs.clear();runs.clear();
  const audit=read(`${base}/delivery-audit.json`);const bad=(audit.records as Recorded[]).filter(r=>r.status==='FAIL');assert.equal(bad.length,5);
  for(const record of bad){
    const source=historical(record);assert.equal(source.raw.proposed_action.type,'none');assert.equal(source.input.authorized_bonus_action,undefined);assert.deepEqual(source.input.delivered_bonus_offering_codes,[]);assert.equal(source.input.ladder.eligible,false);
    const id=`${record.run}/${record.case}/${record.turn}`;
    add(`${id}/original-missing`,source,source.input,null,{pass:false,code:'COURSE_ROLE_UNDECLARED',subjects:[`course_mentions:undeclared:${extra}`]},'Original model output contains no course_mentions. Legacy omission is not inferred as a bonus role.');
    add(`${id}/explicit-bonus-sidecar`,source,source.input,annotation('bonus'),{pass:false,code:'FACT_VALUE_MISMATCH',subjects:['forbidden_promise','direct_bonus:ladder_step_pending']},'Reviewer explicitly labels the observed included benefit as bonus in a sidecar; model metadata remains absent. No matching new effect or prior delivered bonus exists.');
  }
  const r1=(audit.records as Recorded[]).filter(r=>r.run.includes('-r1b-')&&r.case.startsWith('14_'));
  const offer=historical(r1.find(r=>r.turn==='call_step')!);
  assert(offer.input.authorized_bonus_action);assert.deepEqual(offer.input.delivered_bonus_offering_codes,[]);
  add('historical/authorized-new-offer',offer,offer.input,annotation('bonus'),{pass:true},'Matching action/capability facts authorize this prospective first bonus; current outbound need not already be delivered.');
  const recap=historical(r1.find(r=>r.turn==='bonus_1')!);assert.equal(recap.input.authorized_bonus_action,undefined);assert(recap.input.delivered_bonus_offering_codes.includes(extra));
  const priorTrace=recap.record.evidence.prior_bonus_effects[0].trace_id;
  const delivery=recap.run.durable.records.filter((e:Recorded)=>e.correlation_id===priorTrace&&e.action==='outbound.delivery.reported'&&e.payload.status==='delivered');assert(delivery.length>0);
  recap.provenance.prior_delivery_event_ids=delivery.map((e:Recorded)=>e.id);
  add('historical/confirmed-delivered-recap',recap,recap.input,annotation('bonus'),{pass:true},'Earlier offer has an actual delivered outbound and the current projection lists the bonus as delivered. A fresh gift action is not needed for a truthful recap.');
  const controlled=(name:string,source:Recorded)=>({provenance:{kind:'controlled_fixture_not_model_output',name,derived_authority:source.provenance,original_model_text_not_claimed:true,controlled_changes:name==='pending reservation snapshot'?['Replace delivered authority with empty list to simulate reservation-only, despite the source having real delivered proof.']:name==='cancelled old package plus explicit fabricated carryover claim'?['Replace original reply with fabricated carryover wording; clear old delivery and ladder authority for the new validated paid selection. Old cancelled package is not current authority.']:name==='explicit separate paid purchase'?['Synthetic separate-paid-purchase wording, explicit paid_complement label, no bonus action or delivered authority.']:name==='paid mislabel of an extra course'?['Explicitly mislabel the extra as paid while keeping recorded primary paid selection.']:['Relabel an actual bonus effect as paid_complement without changing its recorded effect.']}});
  const paidComplement={...recap.input,messages:[`Además de Fotografía Profesional, podés comprar ${extraName} como curso pago separado. No está incluido en el precio del primero.`],delivered_bonus_offering_codes:[],authorized_bonus_action:undefined};
  add('controlled/paid-complement-positive',controlled('explicit separate paid purchase',recap),paidComplement,annotation('paid_complement'),{pass:true},'Controlled contrast, not a historical model success. Metadata says separate paid purchase; no new or historical bonus authority is invented.');
  add('controlled/pending-reservation-is-not-delivery',controlled('pending reservation snapshot',recap),{...recap.input,delivered_bonus_offering_codes:[],authorized_bonus_action:undefined},annotation('bonus'),{pass:false,code:'FACT_VALUE_MISMATCH',subjects:['forbidden_promise']},'Known reserved course is intentionally excluded from delivered authority. Reservation alone cannot authorize a later recap.');
  const changed=historical(r1.find(r=>r.turn==='change')!);assert.equal(changed.record.evidence.promotion_after.status,'cancelled');assert.equal(changed.input.paid_offering_code,'marketing_digital');
  add('controlled/cancelled-package-is-not-current',controlled('cancelled old package plus explicit fabricated carryover claim',changed),{...changed.input,messages:[`Marketing Digital incluye ${extraName}.`],delivered_bonus_offering_codes:[],authorized_bonus_action:undefined,ladder:undefined},[{offering_code:'marketing_digital',role:'paid'},{offering_code:extra,role:'bonus'}],{pass:false,code:'FACT_VALUE_MISMATCH',subjects:['forbidden_promise']},'Cancelled old package is not delivered authority for the new paid selection. Mutant text is explicitly controlled, not the real course-change reply.');
  const firstBad=historical(bad[0]);
  add('controlled/extra-cannot-declare-itself-paid',controlled('paid mislabel of an extra course',firstBad),firstBad.input,annotation('paid'),{pass:false,code:'COURSE_ROLE_UNDECLARED',subjects:[`course_mentions:paid_mismatch:${extra}`]},'A role declaration cannot change the actual selected paid offering.');
  add('controlled/bonus-effect-cannot-be-relabelled-paid-complement',controlled('metadata/effect contradiction',offer),offer.input,annotation('paid_complement'),{pass:false,code:'FACT_VALUE_MISMATCH',subjects:['forbidden_promise']},'The actual authorized bonus action and its declaration must agree.');
  const index=read(searchIndex);
  const attempts=[...index.attempts,...index.supplementary_observation_attempts.flatMap((s:Recorded)=>s.observation_attempts.map((a:Recorded)=>({...s,attempt:a})))];
  const discoveryTerms=['por separado','curso pago','adicional','otro pago','comprar','separada','separado'];
  const candidates=attempts.filter((a:Recorded)=>{
    const text=a.attempt.response??'';return recap.input.catalog.filter((c:{display_name:string})=>text.includes(c.display_name)).length>=2&&discoveryTerms.some(term=>text.toLocaleLowerCase().includes(term));
  }).map((a:Recorded)=>({version:a.version,case:a.case_id,turn:a.turn_id,text:a.attempt.response,text_sha256:hash(a.attempt.response)}));
  assert.equal(attempts.length,427);assert.equal(candidates.length,3);
  const search={source:searchIndex,attempt_occurrences:attempts.length,versions:Object.keys(index.counts_by_version),candidate_discovery_terms:discoveryTerms,candidates,
    review:'Candidate discovery only, not a role classifier. Codex read all three candidates: each explicitly says sin costo adicional, so none documents a separate paid complement. No unambiguous real paid-complement positive was identified in this bounded canonical-name search; a controlled positive is supplied instead.'};
  for(const [file,before] of inputs)assert.equal(hash(readFileSync(file)),before,`Historical input mutated:${file}`);
  assert.equal(rows.length,17);assert(rows.every(row=>row.assertions_passed));
  const evaluatorFiles=['evals/golden/replay-course-mentions.ts','src/shared/conversation/course-mentions.ts','src/shared/conversation/bonus-ladder-rejection.ts','src/shared/conversation/bonus-ladder.ts'];
  return {schema_version:1,evaluation_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),evaluation_worktree_dirty:execFileSync('git',['status','--porcelain','--',...evaluatorFiles],{encoding:'utf8'}).trim().length>0,
    evaluator_source_sha256:Object.fromEntries(evaluatorFiles.map(file=>[file,hash(readFileSync(file))])),execution_sha:offer.provenance.execution_sha,
    model_calls:0,database_calls:0,deliveries:0,originals_modified:false,input_sha256:Object.fromEntries(inputs),summary:{rows:rows.length,assertions_passed:rows.length,original_undeclared_rejected:5,explicit_bonus_sidecars_rejected:5,legitimate_historical_positives:2,controlled_positives:1,controlled_negative_mutants:4},
    disclosure:'Offline shadow evaluation of recorded text and documented facts using the current pure helper. Role sidecars are explicit review annotations, never fabricated historical model fields. Does not measure v148 model behavior or change original acceptance scores.',paid_complement_search:search,rows};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  globalThis.fetch=async()=>{throw Error('OFFLINE_REPLAY_NETWORK_FORBIDDEN');};
  const output=path.resolve(process.argv[2]??'docs/reports/evidence/2026-11-01-course-mentions');
  assert(!output.startsWith(path.resolve(base)+path.sep),'Do not write into archived inputs');
  const report=replayCourseMentionsV1();mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'offline-replay.json'),JSON.stringify(report,null,2)+'\n');
  const esc=(s:string)=>s.replaceAll('|','\\|').replaceAll('\n','<br>');
  const lines=['# Course mentions offline replay','',report.disclosure,'',`Execution SHA: ${report.execution_sha}. Evaluation SHA: ${report.evaluation_sha}. Dirty evaluator: ${report.evaluation_worktree_dirty}. Source and input hashes are in JSON.`, '',`Assertions: ${report.summary.assertions_passed}/${report.summary.rows}. Model calls0, database calls0, deliveries0.`, '', '| Row | Provenance | Role input | Expected | Actual violations |','|---|---|---|---|---|'];
  for(const row of report.rows)lines.push(`| ${esc(row.id)} | ${row.provenance.kind} | ${row.role_annotation.kind} | ${row.expected.pass?'ALLOW':'REJECT'} | ${esc(JSON.stringify(row.helper_result.violations))} |`);
  lines.push('', '## Paid-complement contrast','',report.paid_complement_search.review,'', 'No historical metadata was backfilled. Pending/cancelled cases and role mislabels are controlled mutants, not new claims about production or the old model.');
  writeFileSync(path.join(output,'offline-replay.md'),lines.join('\n')+'\n');console.log(JSON.stringify(report.summary));
}
