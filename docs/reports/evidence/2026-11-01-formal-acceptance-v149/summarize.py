#!/usr/bin/env python3
"""Read-only full16/48 formal acceptance report; no network, models or re-judging.
--delivery-audit contains hash-bound contextual bonus reviews, separate from golden scores.
"""
import argparse,csv,hashlib,importlib.util,json,statistics,subprocess
from collections import Counter,defaultdict
from pathlib import Path
HELPER=Path(__file__).resolve().with_name('summarize-rule10.py')
spec=importlib.util.spec_from_file_location('saved_summary_helpers',HELPER);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
EXPECTED_SHA='f1f0f9c5d3676d324642238e43279c0c0fada2b7'
STEMS=['acceptance-f1f0f9c-flash-full16-20261101']
CRITICAL=['07','10','11','12','15']
SETUP_CUSTOMER='Hola, soy Ana y estoy probando mi acceso.'
GIFT='No ofrecer, insinuar ni condicionar una nueva bonificación sin offer_course_bonus autorizado y materializado; formularla como pregunta o hipótesis no sustituye la acción. No confundir recordar un curso ya entregado con prometer uno nuevo.'
THINK='No decline_purchase, no stage closed, no guardar un plan no elegido, no decir “queda anotado” y no bonificar.'
sha=lambda value:hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()
read=lambda p:json.loads(p.read_text())
def technical(s):return h.norm(str(s or '').replace('¿','').replace('¡',''))
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def status(value):return 'PASS' if value is True else 'FAIL' if value is False else 'INDETERMINATE'
def output_status(values):return 'FAIL' if 'FAIL' in values else 'PASS' if values and all(v=='PASS' for v in values) else 'INDETERMINATE'
def verdict(raw):
 try:return json.loads(raw)['verdict']
 except (ValueError,KeyError,TypeError):return json.loads(str(raw).rstrip()[:-1])['verdict']
def observed_head(root):
 try:return subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True,stderr=subprocess.DEVNULL).strip()
 except (subprocess.CalledProcessError,FileNotFoundError):return None

def record_context(record):
 instructions=(record.get('provider_response') or {}).get('instructions','') or ''
 if '<authorized_context>' not in instructions:return {}
 try:return json.loads(instructions.split('<authorized_context>')[1].split('</authorized_context>')[0])
 except (ValueError,IndexError,TypeError):return {}
def context_customers(record):return [m.get('text') for m in record_context(record).get('turn',{}).get('batch_messages',[]) if isinstance(m,dict)]
def model_text(record):
 p=h.proposal(record.get('response_content'))
 return '\n'.join(str(p.get(key) or '') for key in ['intro','suggestion'] if p.get(key)) if record.get('role')=='post_sale' else h.text(p)
def model_identity(record):
 p=h.proposal(record.get('response_content'))
 return technical(model_text(record)),(p.get('move') or {}).get('move'),canonical(p.get('proposed_action'))
def attempt_identity(attempt):return technical(attempt.get('response')),attempt.get('move'),canonical(attempt.get('proposedAction'))
def raw_observation(event):return event.get('payload',{}).get('observation',{})
def judge_turn_id(record):
 schema=((record.get('provider_response') or {}).get('text') or {}).get('format',{}).get('schema',{})
 echo=schema.get('properties',{}).get('verdict',{}).get('properties',{}).get('turn_id',{}).get('enum',[])
 if echo:return echo[0]
 try:return verdict(record.get('response_content')).get('turn_id')
 except (ValueError,KeyError,TypeError):return None

def formal_gate(rows,cases,issues):
 coverage=len(rows)==48 and len(cases)==16 and len({(r['case'],r['turn']) for r in rows})==48
 critical={}
 for code in CRITICAL:
  found=[c for c in cases if c['case'].split('_')[0]==code]
  critical[code]=len(found)==1 and found[0]['approved'] is True and found[0]['all_turns_approved']
 approved=sum(r['approved'] is True for r in rows)
 audited=[r['codex_bonus_status'] for r in rows]
 zero=False if 'FAIL' in audited else True if coverage and all(v=='PASS' for v in audited) else None
 pass_gate=coverage and approved>=41 and all(critical.values()) and zero is True and not issues
 return {'required_turns':48,'observed_turns':len(rows),'required_cases':16,'observed_cases':len(cases),
   'coverage_complete':coverage,'minimum_approved_turns':41,'approved_turns':approved,'approved_turn_threshold_met':approved>=41,
   'critical_cases':critical,'critical_cases_complete':all(critical.values()),'zero_unsupported_bonus_observed':zero,
   'zero_bonus_method':'All 48 final texts independently reviewed against current/prior actual effects with matching final-text hashes; joint judge cross-check is reported separately.',
   'case_06_14_individual_gate':False,'source_correlation_clean':not issues,'passed':pass_gate,
   'status':'PASS' if pass_gate else 'FAIL' if not coverage or approved<41 or not all(critical.values()) or zero is False or issues else 'INDETERMINATE'}

def load_run(root,stem,manual):
 requested=Path(stem);prefix=requested.resolve() if requested.is_absolute() or requested.parent!=Path('.') else root/'evals/golden/results'/stem
 stem=prefix.name;paths={k:Path(str(prefix)+s) for k,s in {'result':'.json','provider':'-provider.json','durable':'-durable-evidence.json','observations':'-observations.partial.json'}.items()}
 missing=[str(p) for p in paths.values() if not p.exists()]
 if missing:raise ValueError('WAITING_FOR_FINAL_ARTIFACTS: '+', '.join(missing))
 result,provider,durable,observed=[read(paths[k]) for k in paths]
 if provider.get('status')!='completed':raise ValueError('PROVIDER_NOT_COMPLETED')
 hashes={str(p):sha(p.read_bytes()) for p in paths.values()};records=provider['report']['records'];issues=[];notes=[]
 observed_index={}
 for case in observed['cases']:
  for index,observation in enumerate(case.get('observations',[])):
   turns=case['scenario']['turns']
   if index>=len(turns):issues.append('OBSERVATION_WITHOUT_SCENARIO_TURN:'+case['scenario']['id']);continue
   observed_index[(case['scenario']['id'],turns[index]['id'])]=(observation,turns[index].get('customer'))
 raw_events=[e for e in durable['records'] if raw_observation(e).get('kind')=='model_raw']
 raw_by_content=defaultdict(list)
 for e in raw_events:raw_by_content[canonical(raw_observation(e).get('data',{}).get('raw_content'))].append(e)
 used_calls=set();used_raw=set();used_commits=set();used_narratives=set();traces=defaultdict(list)
 for event in durable['records']:traces[event.get('correlation_id')].append(event)
 model_records=[r for r in records if r.get('role') in ['agent','post_sale']];judges=[r for r in records if r.get('role')=='judge'];judge_cursor=0
 rows=[];cases=[]
 for case in result['cases']:
  prior_effects=[];inv=case.get('negotiation_evaluation');case_status=status(case.get('approved'))
  if inv and case.get('approved') is True and inv.get('status')!='PASS':issues.append('CASE_APPROVED_CONTRADICTS_INVARIANT_STATUS:'+case['case_id'])
  for turn in case['turns']:
   key=(case['case_id'],turn['turn_id']);observation,observed_customer=observed_index.get(key,({},None));customer=observed_customer if observed_customer is not None else turn.get('customer')
   attempts=turn.get('model_attempts',[]);kind='post_sale' if observation.get('workflow',{}).get('status')=='post_sale_notification_sent' else 'agent'
   matched=[];drafts=[];details=[];turn_raw=[];association=[]
   for attempt in attempts:
    candidates=[r for r in model_records if r.get('call_id') not in used_calls and r.get('role')==kind and model_identity(r)==attempt_identity(attempt)]
    exact_customer=[r for r in candidates if technical(customer) in [technical(c) for c in context_customers(r)]]
    if exact_customer:candidates=exact_customer
    if not candidates:
     issues.append('MODEL_ATTEMPT_WITHOUT_PROVIDER:'+case['case_id']+'/'+turn['turn_id']+'/'+str(attempt.get('attempt')))
     drafts.append({'attempt':attempt.get('attempt'),'kind':kind,'response':attempt.get('response'),'provider_call_id':None,'provenance':'saved observation only; provider correlation missing'});continue
    record=candidates[0];used_calls.add(record.get('call_id'));matched.append(record)
    association.append({'call_id':record.get('call_id'),'method':'exact attempt identity and customer' if exact_customer else 'exact attempt identity in provider order','identical_candidates':len(candidates)})
    p=h.proposal(record.get('response_content'));context=record_context(record)
    details.append({'call_id':record.get('call_id'),'role':kind,'latency_ms':record.get('latency_ms'),'status':record.get('status'),'error':record.get('error_code'),'ladder':context.get('capabilities',{}).get('course_bonus',{}).get('ladder'),'rejection':context.get('turn_rejection')})
    drafts.append({'attempt':attempt.get('attempt'),'kind':kind,'provider_call_id':record.get('call_id'),'response':model_text(record) if p else record.get('response_content'),'raw_content':record.get('response_content'),'action':p.get('proposed_action'),'move':p.get('move'),'course_mentions':p.get('course_mentions'),'narrative':p if kind=='post_sale' else None,'received_rejection':attempt.get('turnRejection')})
    if kind=='agent':
     available=[e for e in raw_by_content[canonical(record.get('response_content'))] if e.get('id') not in used_raw]
     inbound_ids={m.get('id') for m in context.get('turn',{}).get('batch_messages',[])}
     by_subject=[e for e in available if raw_observation(e).get('subject_id') in inbound_ids]
     if by_subject:available=by_subject
     if available:
      event=available[0];used_raw.add(event.get('id'));turn_raw.append(event)
     elif record.get('response_content') is not None:issues.append('AGENT_DURABLE_RAW_MISSING:'+record.get('call_id','unknown'))
   unique_traces={e.get('correlation_id') for e in turn_raw if e.get('correlation_id')}
   trace=next(iter(unique_traces)) if len(unique_traces)==1 else None
   if len(unique_traces)>1:issues.append('MULTIPLE_TURN_TRACES:'+case['case_id']+'/'+turn['turn_id'])
   delivered=turn.get('response_real','');ev=list(traces.get(trace,[])) if trace else []
   commits=[e for e in ev if e['action']=='agent.decision.committed']
   if not commits and kind!='post_sale':
    candidates=[e for e in durable['records'] if e['action']=='agent.decision.committed' and e.get('id') not in used_commits and technical(e.get('payload',{}).get('authorized_saved_text'))==technical(delivered) and delivered]
    if len(candidates)==1:
     commits=candidates;trace=commits[0].get('correlation_id');ev=list(traces.get(trace,[]));association.append({'method':'unique committed authorized text','event_id':commits[0].get('id')})
   committed=commits[-1]['payload'] if commits else {}
   for event in commits:used_commits.add(event.get('id'))
   post_sale_events=[]
   if kind=='post_sale':
    candidates=[e for e in durable['records'] if e['action']=='post_sale.narrative.authorized' and e.get('id') not in used_narratives and e.get('payload',{}).get('authorized_text')==delivered]
    if len(candidates)==1:
     event=candidates[0];used_narratives.add(event.get('id'));post_sale_events=[e for e in durable['records'] if e.get('entity_id')==event.get('entity_id') and e['action'].startswith('post_sale.narrative.')]
     committed={'authorized_saved_text':event['payload']['authorized_text']};association.append({'method':'exact authorized post-sale access text','event_id':event.get('id'),'notification_id':event.get('entity_id')})
   rejection_events=[e for e in ev if raw_observation(e).get('kind') in {'proposal_rejected','backend_rejection','backend_turn_rejection'}]
   rejections=[turn.get('backend_rejections'),turn.get('validator_rejections'),[r['rejection'] for r in details],[raw_observation(e).get('data') for e in rejection_events],[e.get('payload') for e in post_sale_events if e['action']=='post_sale.narrative.rejected']]
   subjects=h.labels(rejections);ladder_count=sum(raw_observation(e).get('kind')=='backend_rejection' and bool({'ladder_step_pending','direct_bonus:ladder_step_pending'}.intersection(h.labels(raw_observation(e).get('data')))) for e in rejection_events)
   old_verdict=None;judge_attempts=[]
   while judge_cursor<len(judges):
    record=judges[judge_cursor];request_turn=judge_turn_id(record)
    if request_turn is None and record.get('error_code'):
     request_turn=next((judge_turn_id(r) for r in judges[judge_cursor+1:] if judge_turn_id(r)),None)
    if request_turn!=turn['turn_id']:break
    parsed=None
    try:parsed=verdict(record.get('response_content'))
    except (ValueError,KeyError,TypeError):pass
    judge_attempts.append({'call_id':record.get('call_id'),'role':'judge','status':record.get('status'),'error':record.get('error_code'),'latency_ms':record.get('latency_ms'),'raw_verdict':record.get('response_content')});used_calls.add(record.get('call_id'))
    if parsed is not None:old_verdict=parsed
    judge_cursor+=1
   if not judge_attempts and delivered.strip() and turn.get('execution_status')=='executed':issues.append('JUDGE_EVIDENCE_MISSING:'+case['case_id']+'/'+turn['turn_id'])
   requirements=turn.get('must_not',[]);criterion=GIFT if GIFT in requirements else THINK if THINK in requirements else None
   semantic_gift='INDETERMINATE';gift_failures=[]
   if criterion and old_verdict and turn.get('execution_status')!='evaluation_error':
    criterion_id='must_not:'+str(requirements.index(criterion));gift_failures=[f for f in old_verdict.get('failures',[]) if f.get('requirement_id')==criterion_id]
    semantic_gift='FAIL' if gift_failures else 'PASS' if old_verdict.get('approved') is True else 'INDETERMINATE'
   review=manual.get((stem,case['case_id'],turn['turn_id']));manual_status=review.get('status','INDETERMINATE') if review and review.get('delivered_sha256')==sha(delivered) else 'INDETERMINATE'
   if review and review.get('delivered_sha256')!=sha(delivered):issues.append('STALE_MANUAL_AUDIT:'+case['case_id']+'/'+turn['turn_id'])
   generation_kind=kind if attempts else 'no_agent_model_draft_recorded'
   comparison=h.text_comparison(drafts[0].get('response') if drafts else None,drafts[-1].get('response') if drafts else None,delivered)
   if kind=='post_sale' and drafts:
    parts=[v for k,v in (drafts[-1].get('narrative') or {}).items() if k in ['intro','suggestion'] and v]
    preserved=bool(parts) and all(technical(v) in technical(delivered) for v in parts)
    comparison['postgeneration_text_status']='POST_SALE_NARRATIVE_PLUS_AUTHORIZED_ACCESS_FACTS' if preserved else 'POST_SALE_NARRATIVE_REPLACED_OR_REQUIRES_REVIEW'
    comparison['post_sale_narrative_parts_preserved']=preserved
   if not attempts:comparison['postgeneration_text_status']='NO_AGENT_MODEL_DRAFT_RECORDED'
   row={'run':stem,'case':case['case_id'],'turn':turn['turn_id'],'customer':customer,'customer_source':'saved observations scenario' if observed_customer is not None else 'saved result','approved':turn.get('approved'),'turn_status':status(turn.get('approved')),'execution_status':turn.get('execution_status'),'case_status':case_status,'turn_invariant_status':turn.get('invariant_status'),'layer':turn.get('failure_layer'),'generation_kind':generation_kind,'drafts':drafts,'draft_note':'Sin borrador del agente registrado.' if not attempts else 'Narrativa postventa; el backend ensambla datos autorizados de acceso.' if kind=='post_sale' else None,'delivered':delivered,'delivered_sha256':sha(delivered),'rejection_subjects':subjects,'rejections':rejections,'ladder_rejection_count':ladder_count,'trace_id':trace,'trace_provenance':'matching durable model_raw/commit' if trace else 'unknown/not an Agent A trace; no UUID inferred','request_details':details,'provider_correlation':association,'latency_ms':[r.get('latency_ms') for r in matched],'authorized_saved':committed.get('authorized_saved_text'),'committed_effect':turn.get('backend_action'),'committed_effect_source':'saved final result backend_action','durable_committed_effect':committed.get('business_action'),'durable_event_ids':[e.get('id') for e in turn_raw+commits+post_sale_events],'durable_backend_shas':list({e.get('payload',{}).get('backend_sha') for e in turn_raw+commits+post_sale_events}),'prior_bonus_effects':list(prior_effects),'current_proposal_audit_only':turn.get('proposed_action'),'promotion_after':turn.get('state',{}).get('promotion'),'semantic_bonus_criterion':criterion,'semantic_bonus_status':semantic_gift,'semantic_bonus_failures':gift_failures,'semantic_verdict':old_verdict,'judge_attempts':judge_attempts,'codex_bonus_status':manual_status,'codex_review':review,'delivery_audit_method':'Contextual review of final delivered text against prior/current effects; distinct from golden approval','bonus_delivery_audit_status':output_status([semantic_gift,manual_status]),'failures':turn.get('failures'),**comparison}
   rows.append(row)
   if turn.get('backend_action')=='offer_course_bonus':prior_effects.append({'turn':turn['turn_id'],'trace_id':trace,'action':turn.get('backend_action'),'proposal_audit_only':turn.get('proposed_action'),'promotion':turn.get('state',{}).get('promotion')})
  cases.append({'case':case['case_id'],'approved':case.get('approved'),'status':case_status,'invariant_status':inv.get('status') if inv else None,'checks':inv.get('checks',[]) if inv else [],'turn_counts':dict(Counter(status(t.get('approved')) for t in case['turns'])),'all_turns_approved':bool(case['turns']) and all(t.get('approved') is True for t in case['turns'])})
 setup_records=[];unassigned=[]
 for record in records:
  if record.get('call_id') in used_calls:continue
  if record.get('role')=='agent' and SETUP_CUSTOMER in context_customers(record) and any(c['case_id'].startswith('12_') and c.get('setup_evidence') for c in result['cases']):
   setup_records.append({'call_id':record.get('call_id'),'role':'agent','scope':'case12 controlled fulfilled-package setup, outside the 48 customer turns','customer':SETUP_CUSTOMER,'raw_content':record.get('response_content'),'latency_ms':record.get('latency_ms'),'status':record.get('status'),'tokens':record.get('tokens')});used_calls.add(record.get('call_id'))
   for event in raw_by_content[canonical(record.get('response_content'))]:used_raw.add(event.get('id'))
  else:unassigned.append({'call_id':record.get('call_id'),'role':record.get('role'),'status':record.get('status'),'error':record.get('error_code')})
 if unassigned:issues.append('UNASSIGNED_PROVIDER_RECORDS:'+canonical(unassigned))
 unused_raw=[e.get('id') for e in raw_events if e.get('id') not in used_raw]
 if unused_raw:issues.append('UNASSIGNED_AGENT_DURABLE_RAWS:'+canonical(unused_raw))
 if result.get('base_sha')!=EXPECTED_SHA or provider.get('evaluated_sha')!=EXPECTED_SHA or durable.get('evaluated_sha')!=EXPECTED_SHA:issues.append('EXECUTION_SHA_MISMATCH')
 if result.get('brain_version')!='studyx-agent-a-brain-v149':issues.append('BRAIN_VERSION_MISMATCH')
 for p,hash in hashes.items():
  if sha(Path(p).read_bytes())!=hash:raise ValueError('INPUT_MUTATED:'+p)
 summary={'run':stem,'execution_sha':result.get('base_sha'),'brain_version':result.get('brain_version'),'prompt_version':result.get('prompt_version'),'harness_sha256':provider.get('harness_sha256'),'requested_models':sorted({r.get('requested_model') for r in records if r.get('requested_model')}),'returned_models':sorted({r.get('returned_model') for r in records if r.get('returned_model')}),'date':result.get('generated_at'),'cases':cases,'turn_counts':dict(Counter(r['turn_status'] for r in rows)),'requests':h.consumption(records),'requests_by_role':{role:h.consumption([r for r in records if r.get('role')==role]) for role in sorted({r.get('role') or 'unknown' for r in records})},'provider_accounting':{'total_requests':len(records),'assigned_turn_model_requests':sum(len(r['request_details']) for r in rows),'assigned_judge_requests':sum(len(r['judge_attempts']) for r in rows),'setup_requests':setup_records,'unassigned_requests':unassigned,'all_requests_accounted':sum(len(r['request_details'])+len(r['judge_attempts']) for r in rows)+len(setup_records)+len(unassigned)==len(records),'all_requests_attributed_to_known_scope':not unassigned},'generation_kind_counts':dict(Counter(r['generation_kind'] for r in rows)),'ladder_rejected_turns':sum(r['ladder_rejection_count']>0 for r in rows),'ladder_rejection_count':sum(r['ladder_rejection_count'] for r in rows),'bonus_delivery_audit_counts':dict(Counter(r['bonus_delivery_audit_status'] for r in rows)),'codex_delivery_audit_counts':dict(Counter(r['codex_bonus_status'] for r in rows)),'semantic_delivery_audit_counts':dict(Counter(r['semantic_bonus_status'] for r in rows)),'unsupported_bonus_deliveries_observed':sum(r['codex_bonus_status']=='FAIL' for r in rows),'provider_incidents':[{'call_id':r.get('call_id'),'role':r.get('role'),'status':r.get('status'),'error':r.get('error_code'),'latency_ms':r.get('latency_ms')} for r in records if r.get('error_code') or r.get('status') is None or r.get('status',0)>=400],'correlation_issues':issues,'input_hashes':hashes,'postgeneration_status_counts':dict(Counter(r['postgeneration_text_status'] for r in rows)),'formal_acceptance':formal_gate(rows,cases,issues),'notes':notes}
 return rows,summary

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--stems',nargs='+',default=STEMS);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--delivery-audit','--manual-audit',dest='manual_audit',type=Path);p.add_argument('--report-branch-sha',default=EXPECTED_SHA);args=p.parse_args()
 output=args.output_dir.resolve();root=args.root.resolve()
 if output==root or output.is_relative_to(root):raise ValueError('REPORT_MUST_BE_OUTSIDE_EVALUATED_SOURCE')
 manual_records=read(args.manual_audit).get('records',[]) if args.manual_audit else [];manual={(r['run'],r['case'],r['turn']):r for r in manual_records};all_rows=[];runs=[]
 for stem in args.stems:
  rows,run=load_run(root,stem,manual);all_rows.extend(rows);runs.append(run)
 output.mkdir(parents=True,exist_ok=True)
 for name,value in [('turns.json',all_rows),('summary.json',{'runs':runs,'reporting_branch_sha':args.report_branch_sha,'observed_summary_root_head':observed_head(root),'model_calls_by_summary':0,'summary_script_dependencies':{HELPER.name:sha(HELPER.read_bytes()),Path(__file__).name:sha(Path(__file__).read_bytes())},'offpeak_flash_usd_per_million':h.RATES,'pricing_basis':'Archived Flash Sunday-offpeak rates; estimate, not invoice; balance is not used as cost.','formal_acceptance_criteria':{'required_turns':48,'minimum_approved_turns':41,'critical_cases':CRITICAL,'zero_unsupported_bonus_required':True,'case_06_14_individual_gate':False},'note':'Original golden scores are retained. Hash-bound contextual bonus reviews do not approve other commercial requirements. Joint judge/contextual status is only a separate conservative reference. Setup/post-sale API requests remain in total usage; no Agent A trace or draft is fabricated.'})]:
  (output/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 columns=['run','case','turn','turn_status','case_status','turn_invariant_status','layer','generation_kind','drafts','draft_note','delivered','rejection_subjects','ladder_rejection_count','latency_ms','committed_effect','prior_bonus_effects','semantic_bonus_status','codex_bonus_status','bonus_delivery_audit_status','postgeneration_text_status','trace_id']
 with (output/'per-turn.csv').open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=columns,lineterminator='\n');w.writeheader();w.writerows({k:h.dump(r[k]) if isinstance(r[k],(dict,list)) else r[k] for k in columns} for r in all_rows)
 esc=lambda v:str(v).replace('|','\\|').replace('\n','<br>')
 lines=['# Formal Flash full16/48 — f1f0f9c / brain v149','',f'Report branch: {args.report_branch_sha}. Zero model/API calls by this summary.','', '| Run | Case | Original case status | Invariant status | Original turn counts |', '|---|---|---|---|---|']
 for run in runs:
  for c in run['cases']:lines.append('| '+' | '.join(esc(v) for v in [run['run'],c['case'],c['status'],c['invariant_status'],h.dump(c['turn_counts'])])+' |')
 lines+=['','## Formal gate','','Required: ≥41/48 plus all turns of 07/10/11/12/15 and zero unsupported bonus deliveries. Individual 06/14 cases do not block; their turn scores still contribute to 48.','']
 for run in runs:lines+=['```json',json.dumps(run['formal_acceptance'],ensure_ascii=False,indent=2),'```']
 lines+=['','| Run | Total model requests | Agent/judge/post_sale | Input/output/cached tokens | Estimated USD | Ladder events / affected turns | Contextual reviews | Conservative judge+contextual cross-check |','|---|---|---|---|---|---|---|---|']
 for run in runs:
  usage=run['requests'];t=usage['tokens_known'];roles=run['requests_by_role'];lines.append('| '+' | '.join(esc(v) for v in [run['run'],usage['attempts'],'/'.join(str(roles.get(role,{}).get('attempts',0)) for role in ['agent','judge','post_sale']),'/'.join(str(t.get(k)) for k in ['input','output','cached']),usage['estimated_usd'] if usage['estimated_usd'] is not None else 'known '+str(usage['known_usage_estimated_usd'])+' + '+str(usage['unknown_cost_attempts'])+' unknown attempt(s)',str(run['ladder_rejection_count'])+' / '+str(run['ladder_rejected_turns']),h.dump(run['codex_delivery_audit_counts']),h.dump(run['bonus_delivery_audit_counts'])])+' |')
 lines+=['','## All customer turns','','| Run/case/turn | Original turn / case | Layer | Generation kind | Draft(s) | Delivered | Rejections | Model latency ms | Contextual bonus audit | Judge+contextual cross-check |','|---|---|---|---|---|---|---|---|---|---|']
 for r in all_rows:lines.append('| '+' | '.join(esc(v) for v in [r['run']+'/'+r['case']+'/'+r['turn'],r['turn_status']+' / '+r['case_status'],r['layer'],r['generation_kind'],'\n---\n'.join('Attempt '+str(a['attempt'])+' ['+a['kind']+']: '+str(a.get('response')) for a in r['drafts']) if r['drafts'] else r['draft_note'],r['delivered'],h.dump(r['rejection_subjects']),h.dump(r['latency_ms']),r['codex_bonus_status'],r['bonus_delivery_audit_status']])+' |')
 lines+=['','Post-sale rows show intro/suggestion narrative and backend-assembled authorized access facts, not a fabricated Agent A draft. No-model rows explicitly have no model draft recorded. Setup calls are accounted separately in summary.json; all requests remain in costs. A null durable backend_sha is preserved; execution SHA comes from runner/result metadata.']
 (output/'summary.md').write_text('\n'.join(lines)+'\n');print(json.dumps({'output_dir':str(output),'runs':[{'run':r['run'],'turns':r['turn_counts'],'issues':r['correlation_issues'],'generation_kinds':r['generation_kind_counts'],'provider_accounting':{k:v for k,v in r['provider_accounting'].items() if k!='setup_requests'},'formal_gate':r['formal_acceptance']} for r in runs]},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
