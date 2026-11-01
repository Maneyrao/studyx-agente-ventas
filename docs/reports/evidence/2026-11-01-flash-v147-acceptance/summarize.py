#!/usr/bin/env python3
"""Read-only summary of frozen 961c991/v147 evaluation artifacts; no network/models.
Default: both focused runs. For the first completed run use --stems focused-961c991-flash-060714-r1b-20261101.
Codex contextual delivery audit JSON: {"records":[{"run":STEM,"case":ID,"turn":ID,"delivered_sha256":HASH,
"status":"PASS|FAIL|INDETERMINATE","reason":"literal review of delivered text and prior effects"}]}.
"""
import argparse,csv,hashlib,importlib.util,json,statistics,subprocess
from collections import Counter,defaultdict
from pathlib import Path
HELPER=Path(__file__).resolve().with_name('summarize-rule10.py')
spec=importlib.util.spec_from_file_location('saved_summary_helpers',HELPER);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
FROZEN=Path('/Users/tmaneyro22/Documents/AGENTE IA/tmp/acceptance-961c991-official')
STEMS=['focused-961c991-flash-060714-r1b-20261101','focused-961c991-flash-060714-r2-20261101']
GIFT='No ofrecer, insinuar ni condicionar una nueva bonificación sin offer_course_bonus autorizado y materializado; formularla como pregunta o hipótesis no sustituye la acción. No confundir recordar un curso ya entregado con prometer uno nuevo.'
THINK='No decline_purchase, no stage closed, no guardar un plan no elegido, no decir “queda anotado” y no bonificar.'
sha=lambda text:hashlib.sha256(text.encode()).hexdigest()
read=lambda p:json.loads(p.read_text())
def technical(s):return h.norm(str(s or '').replace('¿','').replace('¡',''))
def verdict(raw):
 try:return json.loads(raw)['verdict']
 except (ValueError,KeyError):return json.loads(raw.rstrip()[:-1])['verdict']
def observed_head(root):
 try:return subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True,stderr=subprocess.DEVNULL).strip()
 except (subprocess.CalledProcessError,FileNotFoundError):return None
def status(approved):return 'PASS' if approved is True else 'FAIL' if approved is False else 'INDETERMINATE'
def output_status(values):
 return 'FAIL' if 'FAIL' in values else 'PASS' if values and all(v=='PASS' for v in values) else 'INDETERMINATE'
def load_run(root,stem,manual):
 requested=Path(stem);prefix=requested.resolve() if requested.is_absolute() or requested.parent!=Path('.') else root/'evals/golden/results'/stem
 stem=prefix.name;paths={k:Path(str(prefix)+suffix) for k,suffix in {'result':'.json','provider':'-provider.json','durable':'-durable-evidence.json','observations':'-observations.partial.json'}.items()}
 missing=[str(p) for p in paths.values() if not p.exists()]
 if missing:raise ValueError('WAITING_FOR_FINAL_ARTIFACTS: '+', '.join(missing))
 result,provider,durable,observed=[read(paths[k]) for k in paths]
 customer_index={(c['scenario']['id'],t['id']):t.get('customer') for c in observed['cases'] for t in c['scenario']['turns']}
 if provider.get('status')!='completed':raise ValueError('PROVIDER_NOT_COMPLETED')
 hashes={str(p):sha(p.read_text()) for p in paths.values()}
 records=provider['report']['records'];agents=[r for r in records if r['role']=='agent'];judges=[r for r in records if r['role']=='judge']
 traces=defaultdict(list);raws=[]
 for event in durable['records']:
  traces[event.get('correlation_id')].append(event)
  if event.get('payload',{}).get('observation',{}).get('kind')=='model_raw':raws.append(event)
 rows=[];cases=[];agent_cursor=judge_cursor=0;issues=[];prior_effects=[]
 for case in result['cases']:
  prior_effects=[]
  inv=case.get('negotiation_evaluation');case_status=inv.get('status') if inv else status(case.get('approved'))
  if inv and case.get('approved') is True and case_status!='PASS':issues.append('CASE_APPROVED_CONTRADICTS_INVARIANT_STATUS:'+case['case_id'])
  if inv and status(case.get('approved'))=='FAIL':case_status='FAIL'
  for turn in case['turns']:
   attempts=turn.get('model_attempts',[]);matched=agents[agent_cursor:agent_cursor+len(attempts)];events_raw=raws[agent_cursor:agent_cursor+len(attempts)]
   trace=None;drafts=[];request_details=[]
   if len(matched)!=len(attempts) or len(events_raw)!=len(attempts):issues.append('ATTEMPT_COUNT_MISMATCH:'+case['case_id']+'/'+turn['turn_id'])
   for i,(attempt,record) in enumerate(zip(attempts,matched)):
    p=h.proposal(record.get('response_content'));rawtext=h.text(p)
    if technical(rawtext)!=technical(attempt.get('response')) or (p.get('move') or {}).get('move')!=attempt.get('move') or p.get('proposed_action')!=attempt.get('proposedAction'):issues.append('ATTEMPT_IDENTITY_MISMATCH:'+record['call_id'])
    if i<len(events_raw):
     event=events_raw[i];ob=event['payload']['observation']
     if ob.get('data',{}).get('raw_content')!=record.get('response_content'):issues.append('DURABLE_ORDER_MISMATCH:'+record['call_id'])
     trace=event.get('correlation_id')
    context={};instructions=(record.get('provider_response') or {}).get('instructions','')
    if '<authorized_context>' in instructions:context=json.loads(instructions.split('<authorized_context>')[1].split('</authorized_context>')[0])
    request_details.append({'call_id':record.get('call_id'),'latency_ms':record.get('latency_ms'),'status':record.get('status'),'error':record.get('error_code'),'ladder':context.get('capabilities',{}).get('course_bonus',{}).get('ladder'),'rejection':context.get('turn_rejection')})
    drafts.append({'attempt':i+1,'response':rawtext if p else record.get('response_content'),'action':p.get('proposed_action'),'move':p.get('move'),'received_rejection':attempt.get('turnRejection')})
   agent_cursor+=len(attempts)
   ev=traces.get(trace,[]);commits=[e for e in ev if e['action']=='agent.decision.committed'];committed=commits[-1]['payload'] if commits else {}
   rejection_events=[e for e in ev if e.get('payload',{}).get('observation',{}).get('kind')=='proposal_rejected']
   rejections=[turn.get('backend_rejections'),turn.get('validator_rejections'),[r['rejection'] for r in request_details],[e['payload']['observation'].get('data') for e in rejection_events]];subjects=h.labels(rejections)
   ladder_count=sum(bool({'ladder_step_pending','direct_bonus:ladder_step_pending'}.intersection(h.labels(e['payload']['observation'].get('data')))) for e in rejection_events)
   old_verdict=None;judge_attempts=[]
   while judge_cursor<len(judges):
    record=judges[judge_cursor];schema=((record.get('provider_response') or {}).get('text') or {}).get('format',{}).get('schema',{})
    echo=schema.get('properties',{}).get('verdict',{}).get('properties',{}).get('turn_id',{}).get('enum',[])
    parsed=None
    try:parsed=verdict(record.get('response_content') or '')
    except (ValueError,KeyError,TypeError):pass
    request_turn=echo[0] if echo else (parsed or {}).get('turn_id')
    if request_turn is None and record.get('error_code'):
     # Failed HTTP requests have no response echo. Bind only when the next known
     # schema/verdict ID is this turn; never absorb it into a completed earlier turn.
     next_id=None
     for later in judges[judge_cursor+1:]:
      later_schema=((later.get('provider_response') or {}).get('text') or {}).get('format',{}).get('schema',{})
      later_echo=later_schema.get('properties',{}).get('verdict',{}).get('properties',{}).get('turn_id',{}).get('enum',[])
      if later_echo:next_id=later_echo[0];break
      try:next_id=verdict(later.get('response_content') or '')['turn_id'];break
      except (ValueError,KeyError,TypeError):pass
     if next_id==turn['turn_id']:request_turn=next_id
    if request_turn!=turn['turn_id']:break
    judge_attempts.append({'call_id':record.get('call_id'),'status':record.get('status'),'error':record.get('error_code'),'latency_ms':record.get('latency_ms'),'raw_verdict':record.get('response_content')})
    if parsed is not None:old_verdict=parsed
    judge_cursor+=1
   if not judge_attempts:issues.append('JUDGE_EVIDENCE_MISSING:'+case['case_id']+'/'+turn['turn_id'])
   requirements=turn.get('must_not',[]);criterion=GIFT if GIFT in requirements else THINK if THINK in requirements else None
   semantic_gift='INDETERMINATE';gift_failures=[]
   if criterion and old_verdict and turn.get('execution_status')!='evaluation_error':
    criterion_id='must_not:'+str(requirements.index(criterion))
    gift_failures=[f for f in old_verdict.get('failures',[]) if f.get('requirement_id')==criterion_id]
    semantic_gift='FAIL' if gift_failures else 'PASS' if old_verdict.get('approved') is True else 'INDETERMINATE'
   delivered=turn.get('response_real','');review=manual.get((stem,case['case_id'],turn['turn_id']))
   manual_status=review.get('status','INDETERMINATE') if review and review.get('delivered_sha256')==sha(delivered) else 'INDETERMINATE'
   if review and review.get('delivered_sha256')!=sha(delivered):issues.append('STALE_MANUAL_AUDIT:'+turn['turn_id'])
   comparison=h.text_comparison(drafts[0]['response'] if drafts else None,drafts[-1]['response'] if drafts else None,delivered)
   row={'run':stem,'case':case['case_id'],'turn':turn['turn_id'],'customer':customer_index.get((case['case_id'],turn['turn_id']),turn.get('customer')),'customer_source':'saved observations scenario','approved':turn.get('approved'),'turn_status':status(turn.get('approved')),'case_status':case_status,'turn_invariant_status':turn.get('invariant_status'),'layer':turn.get('failure_layer'),'drafts':drafts,'delivered':delivered,'delivered_sha256':sha(delivered),'rejection_subjects':subjects,'rejections':rejections,'ladder_rejection_count':ladder_count,'trace_id':trace,'request_details':request_details,'latency_ms':[r.get('latency_ms') for r in matched],'authorized_saved':committed.get('authorized_saved_text'),'committed_effect':committed.get('business_action'),'prior_bonus_effects':list(prior_effects),'current_proposal':turn.get('proposed_action'),'promotion_after':turn.get('state',{}).get('promotion'),'semantic_bonus_criterion':criterion,'semantic_bonus_status':semantic_gift,'semantic_bonus_failures':gift_failures,'semantic_verdict':old_verdict,'judge_attempts':judge_attempts,'codex_bonus_status':manual_status,'codex_review':review,'delivery_audit_method':'Codex review of delivered text against recorded effects','bonus_delivery_audit_status':output_status([semantic_gift,manual_status]),'failures':turn.get('failures'),**comparison}
   rows.append(row)
   if committed.get('business_action')=='offer_course_bonus':prior_effects.append({'turn':turn['turn_id'],'trace_id':trace,'action':committed['business_action'],'proposal':turn.get('proposed_action'),'promotion':turn.get('state',{}).get('promotion')})
  cases.append({'case':case['case_id'],'approved':case.get('approved'),'status':case_status,'invariant_status':inv.get('status') if inv else None,'checks':inv.get('checks',[]) if inv else [],'turn_counts':dict(Counter(status(t.get('approved')) for t in case['turns'])),'all_turns_approved':all(t.get('approved') is True for t in case['turns'])})
 if agent_cursor!=len(agents) or agent_cursor!=len(raws):issues.append(f'UNASSIGNED_AGENT_RECORDS:{agent_cursor}/{len(agents)}/{len(raws)}')
 if judge_cursor!=len(judges):issues.append(f'UNASSIGNED_JUDGE_RECORDS:{judge_cursor}/{len(judges)}')
 if len(rows)!=18:issues.append('EXPECTED_18_CUSTOMER_TURNS:'+str(len(rows)))
 if not result.get('base_sha','').startswith('961c991'):issues.append('EXECUTION_SHA_MISMATCH')
 if result.get('brain_version')!='studyx-agent-a-brain-v147':issues.append('BRAIN_VERSION_MISMATCH')
 for p,hash in hashes.items():
  if sha(Path(p).read_text())!=hash:raise ValueError('INPUT_MUTATED:'+p)
 summary={'run':stem,'execution_sha':result.get('base_sha'),'brain_version':result.get('brain_version'),'prompt_version':result.get('prompt_version'),'harness_sha256':provider.get('harness_sha256'),'requested_models':sorted({r.get('requested_model') for r in records if r.get('requested_model')}),'returned_models':sorted({r.get('returned_model') for r in records if r.get('returned_model')}),'date':result.get('generated_at'),'cases':cases,'turn_counts':dict(Counter(r['turn_status'] for r in rows)),'requests':h.consumption(records),'requests_by_role':{role:h.consumption([r for r in records if r['role']==role]) for role in sorted({r['role'] for r in records})},'ladder_rejected_turns':sum(r['ladder_rejection_count']>0 for r in rows),'ladder_rejection_count':sum(r['ladder_rejection_count'] for r in rows),'bonus_delivery_audit_counts':dict(Counter(r['bonus_delivery_audit_status'] for r in rows)),'codex_delivery_audit_counts':dict(Counter(r['codex_bonus_status'] for r in rows)),'semantic_delivery_audit_counts':dict(Counter(r['semantic_bonus_status'] for r in rows)),'unsupported_bonus_deliveries_observed':sum(r['codex_bonus_status']=='FAIL' for r in rows),'provider_incidents':[{'call_id':r.get('call_id'),'role':r.get('role'),'status':r.get('status'),'error':r.get('error_code'),'latency_ms':r.get('latency_ms')} for r in records if r.get('error_code') or r.get('status') is None or r.get('status',0)>=400],'correlation_issues':issues,'input_hashes':hashes,'case_gate_pass':len(cases)==3 and all(c['status']=='PASS' and c['approved'] is True for c in cases),'zero_unexecuted_bonus_delivery_accredited':bool(rows) and all(r['bonus_delivery_audit_status']=='PASS' for r in rows),'postgeneration_status_counts':dict(Counter(r['postgeneration_text_status'] for r in rows))}
 return rows,summary

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=FROZEN);p.add_argument('--stems',nargs='+',default=STEMS);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--delivery-audit','--manual-audit',dest='manual_audit',type=Path);p.add_argument('--report-branch-sha',default='91b12d1');args=p.parse_args()
 output=args.output_dir.resolve();root=args.root.resolve()
 if output==root or output.is_relative_to(root):raise ValueError('REPORT_MUST_BE_OUTSIDE_FROZEN_SOURCE')
 manual_records=read(args.manual_audit).get('records',[]) if args.manual_audit else []
 manual={(r['run'],r['case'],r['turn']):r for r in manual_records};all_rows=[];runs=[]
 for stem in args.stems:
  rows,run=load_run(root,stem,manual);all_rows.extend(rows);runs.append(run)
 output.mkdir(parents=True,exist_ok=True)
 for name,value in [('turns.json',all_rows),('summary.json',{'runs':runs,'reporting_branch_sha':args.report_branch_sha,'observed_summary_root_head':observed_head(root),'model_calls_by_summary':0,'summary_script_dependencies':{HELPER.name:sha(HELPER.read_text()),Path(__file__).name:sha(Path(__file__).read_text())},'bootstrap_attempt':{'stem':'focused-961c991-flash-060714-r1-20261101','classification':'INFRA_BOOTSTRAP_FAILURE_BEFORE_PROVIDER','reported_model_requests':0,'reported_cost_usd':0,'provider_artifact_absent':not (root/'evals/golden/results/focused-961c991-flash-060714-r1-20261101-provider.json').exists() and not (root/'evals/golden/results/focused-961c991-flash-060714-r1-20261101-provider.partial.json').exists(),'note':'Turbopack rejected node_modules symlink outside root; root reported zero provider requests. Separate from the two actual model runs.'},'offpeak_flash_usd_per_million':h.RATES,'pricing_basis':'Archived Flash offpeak tariffs requested for Nov1; estimate, not invoice; no live pricing request.','ready_for_full16':len(runs)==2 and all(r['case_gate_pass'] and r['zero_unexecuted_bonus_delivery_accredited'] and not r['correlation_issues'] for r in runs),'note':'Case/invariant status controls the gate even if every turn passed. Codex contextual delivery review must match final text hash and consider prior executed bonus effects; recap does not require a fresh gift action.'})]:
  (output/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 columns=['run','case','turn','turn_status','case_status','turn_invariant_status','layer','drafts','delivered','rejection_subjects','ladder_rejection_count','latency_ms','committed_effect','prior_bonus_effects','semantic_bonus_status','codex_bonus_status','bonus_delivery_audit_status','postgeneration_text_status','trace_id']
 with (output/'per-turn.csv').open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=columns,lineterminator='\n');w.writeheader();w.writerows({k:h.dump(r[k]) if isinstance(r[k],(dict,list)) else r[k] for k in columns} for r in all_rows)
 esc=lambda v:str(v).replace('|','\\|').replace('\n','<br>')
 lines=['# Frozen 961c991 / v147 evaluation','',f'Report branch: {args.report_branch_sha}. Executed code: 961c991. Summary makes zero model/API calls.','', '| Run | Case | Case status | Invariant status | Turn counts |', '|---|---|---|---|---|']
 for run in runs:
  for c in run['cases']:lines.append('| '+' | '.join(esc(v) for v in [run['run'],c['case'],c['status'],c['invariant_status'],h.dump(c['turn_counts'])])+' |')
 lines+=['','| Run | Calls | Agent/judge | Input/output/cache tokens | Estimated USD | Ladder rejects | Cruce conservador juez+Codex |','|---|---|---|---|---|---|---|']
 for run in runs:
  usage=run['requests'];t=usage['tokens_known'];roles=run['requests_by_role'];lines.append('| '+' | '.join(esc(v) for v in [run['run'],usage['attempts'],'/'.join(str(roles.get(role,{}).get('attempts',0)) for role in ['agent','judge']),'/'.join(str(t.get(k)) for k in ['input','output','cached']),usage['estimated_usd'] if usage['estimated_usd'] is not None else 'known '+str(usage['known_usage_estimated_usd'])+' + '+str(usage['unknown_cost_attempts'])+' unknown attempt(s)',run['ladder_rejection_count'],h.dump(run['bonus_delivery_audit_counts'])])+' |')
 lines+=['','## Per turn','','| Run/case/turn | Status / case | Drafts | Delivered | Rejections | Agent latency ms | Bonus audit |','|---|---|---|---|---|---|---|']
 for r in all_rows:lines.append('| '+' | '.join(esc(v) for v in [r['run']+'/'+r['case']+'/'+r['turn'],r['turn_status']+' / '+r['case_status'],'\n---\n'.join('Attempt '+str(a['attempt'])+': '+str(a['response']) for a in r['drafts']),r['delivered'],h.dump(r['rejection_subjects']),h.dump(r['latency_ms']),r['bonus_delivery_audit_status']])+' |')
 (output/'summary.md').write_text('\n'.join(lines)+'\n');print(json.dumps({'output_dir':str(output),'runs':[{'run':r['run'],'cases':[(c['case'],c['status']) for c in r['cases']],'issues':r['correlation_issues'],'audit':r['bonus_delivery_audit_counts']} for r in runs]},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
