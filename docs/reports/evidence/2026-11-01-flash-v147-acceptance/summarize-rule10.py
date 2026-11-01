#!/usr/bin/env python3
"""Offline golden report. Usage: summarize-rule10.py STEM1 STEM2 OUTPUTDIR.
STEM is an absolute artifact prefix or a prefix under cwd/evals/golden/results.
No model judging, network calls, scenario edits or semantic text classification.
"""
import argparse
import csv
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

RATES = {'cache_hit': .003, 'cache_miss': .15, 'output': .6}
RATE_REFERENCE = '2026-11-01-negotiation-model-comparison/resumen.json (archived Flash offpeak rates)'

def read(path):
    return json.loads(path.read_text())

def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def norm(value):
    return ' '.join(str(value or '').split())

def authorized_text(value):
    return norm(str(value or '').replace('¿', '').replace('¡', ''))

def text_comparison(first, last, delivered):
    if last is None or delivered is None:
        return {'last_draft_exact_equal':None, 'last_draft_authorized_technical_equal':None, 'postgeneration_text_status':'UNKNOWN'}
    exact = last == delivered
    whitespace = norm(last) == norm(delivered)
    technical = authorized_text(last) == authorized_text(delivered)
    return {'last_draft_exact_equal':exact, 'last_draft_authorized_technical_equal':technical,
            'first_last_draft_exact_equal': first == last if first is not None else None,
            'postgeneration_text_status': 'PRESERVED_EXACT' if exact else 'PRESERVED_WHITESPACE_ONLY' if whitespace else 'PRESERVED_AUTHORIZED_PUNCTUATION_AND_WHITESPACE' if technical else 'DIFFERENCE_REQUIRES_REVIEW'}

def proposal(raw):
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}

def text(p):
    response = p.get('response') or {}
    messages = list(response.get('messages') or [])
    if response.get('call_offer'):
        messages.append(response['call_offer'])
    return '\n'.join(messages)

def identity(p):
    return (norm(text(p)), (p.get('move') or {}).get('move'), dump(p.get('proposed_action')))

def attempt_identity(a):
    return (norm(a.get('response')), a.get('move'), dump(a.get('proposedAction')))

def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)

def labels(value):
    result = []
    for node in walk(value):
        for key in ('code', 'subject', 'reason_code', 'reasonCode'):
            if isinstance(node.get(key), str):
                result.append(node[key])
        result.extend(x for x in node.get('rejection_codes', []) if isinstance(x, str))
        result.extend(x for x in node.get('rejection_subjects', []) if isinstance(x, str))
    return list(dict.fromkeys(result))

def consumption(records):
    costs, unknown = [], 0
    totals = Counter()
    for r in records:
        t = r.get('tokens') or {}
        for k in ('input', 'output', 'total', 'cached'):
            if isinstance(t.get(k), (int, float)):
                totals[k] += t[k]
        if r.get('requested_model') == 'deepseek-v4-flash' and all(isinstance(t.get(k), (int, float)) for k in ('input','output','cached')) and 0 <= t['cached'] <= t['input'] and t['output'] >= 0:
            costs.append(((t['input']-t['cached'])*RATES['cache_miss'] + t['cached']*RATES['cache_hit'] + t['output']*RATES['output'])/1e6)
        else:
            unknown += 1
    latency = [r['latency_ms'] for r in records if isinstance(r.get('latency_ms'), (int,float))]
    return {'attempts':len(records), 'logical_calls':len({r.get('call_id') for r in records}),
            'tokens_known':dict(totals), 'unknown_cost_attempts':unknown,
            'estimated_usd':None if unknown else sum(costs), 'known_usage_estimated_usd':sum(costs),
            'latency_ms_median':statistics.median(latency) if latency else None,
            'latency_ms_max':max(latency) if latency else None}

def indicator(value, keys):
    # Only explicit machine fields count. Absent instrumentation is unknown.
    hits = [{k:n[k]} for n in walk(value) for k in keys if k in n]
    return dump(hits) if hits else 'NO EXPLICIT STRUCTURAL INDICATOR; UNKNOWN'

def load(stem):
    stem = Path(stem)
    if not stem.with_suffix('.json').exists():
        stem = Path.cwd() / 'evals/golden/results' / stem
    paths = {k:Path(str(stem)+s) for k,s in {'result':'.json','provider':'-provider.json','observations':'-observations.partial.json','durable':'-durable-evidence.json'}.items()}
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        raise ValueError('Missing final evidence files: '+', '.join(missing))
    result, provider, observed, durable = [read(paths[k]) for k in paths]
    if provider.get('status') != 'completed':
        raise ValueError('Provider artifact is not completed: '+str(paths['provider']))
    records = provider['report']['records']
    traces = defaultdict(list)
    for r in durable['records']:
        if r.get('correlation_id'):
            traces[r['correlation_id']].append(r)
    trace_index = defaultdict(set)
    for trace_id, events in traces.items():
        for event in events:
            obs = event.get('payload',{}).get('observation',{})
            if obs.get('kind') == 'model_raw':
                trace_index[identity(proposal(obs.get('data',{}).get('raw_content')))].add(trace_id)
    observations = {(c['scenario']['id'], t['id']):o for c in observed['cases'] for t,o in zip(c['scenario']['turns'],c['observations'])}
    used_provider, rows = set(), []
    for case in result['cases']:
        for turn in case['turns']:
            attempts = turn.get('model_attempts', [])
            obs = observations.get((case['case_id'],turn['turn_id']),{})
            candidates = set.intersection(*(trace_index[attempt_identity(a)] for a in attempts)) if attempts else set()
            trace_id = next(iter(candidates)) if len(candidates)==1 else None
            events = traces.get(trace_id, [])
            raws = [e['payload']['observation']['data'].get('raw_content') for e in events if e.get('payload',{}).get('observation',{}).get('kind')=='model_raw']
            matched = []
            for raw in raws:
                hits = [(i,r) for i,r in enumerate(records) if i not in used_provider and r.get('role')=='agent' and r.get('response_content')==raw]
                if len(hits)==1:
                    i,r=hits[0]; used_provider.add(i); matched.append(r)
            rejections = [turn.get('backend_rejections',[]),turn.get('validator_rejections',[]),
                          [a.get('turnRejection') for a in attempts],
                          [e.get('payload',{}).get('observation',{}).get('data') for e in events if e.get('payload',{}).get('observation',{}).get('kind') in ('proposal_rejected','proposal_resolution')]]
            codes = labels(rejections)
            ladder_codes = {'ladder_step_pending','direct_bonus:ladder_step_pending'}
            ladder_events = [e for e in events if e.get('payload',{}).get('observation',{}).get('kind') == 'proposal_rejected' and ladder_codes.intersection(labels(e['payload']['observation'].get('data')))]
            ladder_reject_count = len(ladder_events) or int(bool(ladder_codes.intersection(codes)))
            drafts = [text(proposal(raw)) for raw in raws]
            final_draft = drafts[-1] if drafts else None
            comparison = text_comparison(drafts[0] if drafts else None, final_draft, turn.get('response_real'))
            saved = [e['payload'].get('authorized_saved_text') for e in events if e.get('action')=='agent.decision.committed']
            sent = [e['payload']['observation'].get('data') for e in events if e.get('payload',{}).get('observation',{}).get('kind')=='provider_send_attempt']
            attempts_text = '\n---\n'.join(f'Attempt {i+1}: '+text(proposal(raw)) for i,raw in enumerate(raws)) if raws else '\n---\n'.join(f"Attempt {a.get('attempt')}: {a.get('response')}" for a in attempts)
            approved = turn.get('approved')
            structural = [turn,obs,events]
            rows.append({'run':stem.name,'case':case['case_id'],'turn':turn['turn_id'],
                'status':'APROBADO' if approved is True else 'FALLIDO' if approved is False else 'SIN JUICIO',
                'layer':turn.get('failure_layer') or ('none_reported' if approved is True else 'unknown'),
                'drafts':attempts_text, 'delivered':turn.get('response_real'),
                'authorized_saved':dump(saved),'provider_sent':dump(sent),
                'rejection_subjects':dump(codes),'rejection_details':dump(rejections),
                'ladder_rejected':bool(ladder_codes.intersection(codes)), 'ladder_rejection_count':ladder_reject_count,
                'ladder_rejection_count_basis':'proposal_rejected events' if ladder_events else 'at least one from rejection subjects' if ladder_reject_count else 'none recorded',
                'extra_model_attempts':max(0,len(attempts)-1), 'repair_evidence':indicator(events, ('repair_attempted','repaired','proposal_generation_calls')), 'trace_id':trace_id,
                'correlation': 'exact attempt response/move/action; unique trace; exact raw provider content' if trace_id else 'UNKNOWN/AMBIGUOUS',
                'agent_call_ids':dump([r.get('call_id') for r in matched]),
                'agent_latency_ms':dump([r.get('latency_ms') for r in matched]),
                'agent_latency_sum_ms':sum(r.get('latency_ms',0) for r in matched) if matched else None,
                'model_proposed_action':dump(turn.get('proposed_action')),'backend_action':dump(turn.get('backend_action')),
                'draft_delivery_equal_ignoring_whitespace':norm(final_draft)==norm(turn.get('response_real')) if drafts else None,
                **comparison,
                'promise_without_action':indicator(structural, ('bonus_promise_without_action','promised_bonus_without_action','bonus_effect_without_action')),
                'template_or_truncation':indicator(structural, ('template_applied','text_truncated','truncation_applied','literal_conversation_variant_applied','fallback_applied')),
                'failures':dump(turn.get('failures',[]))})
    return rows, {'stem':str(stem),'sha':result.get('base_sha'),'brain':result.get('brain_version'),
        'prompt':result.get('prompt_version'),'cases':{c['case_id']:c.get('approved') for c in result['cases']},
        'case_summary':{c['case_id']:{'reported_approved':c.get('approved'), 'all_turns_approved':all(t.get('approved') is True for t in c['turns']), 'turns':len(c['turns']), 'passed_turns':sum(t.get('approved') is True for t in c['turns']), 'ladder_rejected_turns':sum(r['ladder_rejected'] for r in rows if r['case']==c['case_id']), 'ladder_rejection_count':sum(r['ladder_rejection_count'] for r in rows if r['case']==c['case_id'])} for c in result['cases']},
        'turn_status':dict(Counter(r['status'] for r in rows)), 'reported_absolute_acceptance':result.get('absolute_acceptance'),
        'reported_evaluation_scope':result.get('evaluation_scope'),
        'consumption':consumption(records), 'consumption_by_role':{role:consumption([r for r in records if r.get('role')==role]) for role in sorted({r['role'] for r in records})},
        'ladder_rejected_turns':sum(r['ladder_rejected'] for r in rows), 'ladder_rejection_count':sum(r['ladder_rejection_count'] for r in rows),
        'postgeneration_text_status':dict(Counter(r['postgeneration_text_status'] for r in rows)),
        'correlated_turns':sum(r['trace_id'] is not None for r in rows),'turns':len(rows),
        'agent_provider_records_matched':len(used_provider),'agent_provider_records_unmatched':sum(r.get('role')=='agent' for r in records)-len(used_provider),
        'input_paths':{k:str(v) for k,v in paths.items()}}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stem1');parser.add_argument('stem2');parser.add_argument('outputdir')
    args=parser.parse_args()
    all_rows, runs=[],[]
    for stem in (args.stem1,args.stem2):
        rows,run=load(stem);all_rows.extend(rows);runs.append(run)
    output=Path(args.outputdir);output.mkdir(parents=True,exist_ok=True)
    with (output/'por-turno.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(all_rows[0]));writer.writeheader();writer.writerows(all_rows)
    cols=['run','case','turn','status','layer','drafts','delivered','rejection_subjects','agent_latency_ms','postgeneration_text_status','promise_without_action','template_or_truncation']
    def esc(v):return str(v).replace('&','&amp;').replace('<','&lt;').replace('|','\\|').replace('\n','<br>')
    lines=['# Evidencia por turno','', 'Estados y capas copiados de la aceptación; no se recalifica. Costos estimados con tarifas archivadas Flash offpeak. Ausencia de indicador estructural no demuestra ausencia de promesas, plantillas o recortes. Comparar borrador y entrega no atribuye por sí solo la causa.','', '| '+' | '.join(cols)+' |','|'+'|'.join(['---']*len(cols))+'|']
    lines.extend('| '+' | '.join(esc(r[c]) for c in cols)+' |' for r in all_rows)
    (output/'por-turno.md').write_text('\n'.join(lines)+'\n')
    summary={'runs':runs,'usd_per_million_flash_offpeak':RATES,'rate_reference':RATE_REFERENCE,
             'cost_note':'Estimate, not invoice. Missing tokens or non-Flash model => unknown total cost; includes judge by role.',
             'semantic_limits':'No regex or new semantic criteria. Promise/template/truncation flags rely only on explicit machine fields; otherwise unknown.',
             'balance_before_path':'/Users/tmaneyro22/Documents/AGENTE IA/tmp/rule10-balance-before.json'}
    (output/'resumen.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    summary_lines = ['# Resumen offline', '', 'Tarifas Flash offpeak archivadas; costo estimado, no factura. No se recalifican criterios.', '', '| Corrida | SHA | Aprobados | Llamadas | Tokens input/output/cache | Costo USD |', '|---|---|---|---|---|---|']
    for run in runs:
        c=run['consumption']; t=c['tokens_known']
        summary_lines.append('| '+ ' | '.join([Path(run['stem']).name, str(run['sha']), str(run['turn_status'].get('APROBADO',0))+'/'+str(run['turns']), str(c['logical_calls']), '/'.join(str(t.get(k,'unknown')) for k in ('input','output','cached')), str(c['estimated_usd'])])+' |')
    summary_lines += ['', '| Corrida | Caso | Todos aprobados | Turnos aprobados | Rechazos ladder |', '|---|---|---|---|---|']
    for run in runs:
        for case, stats in run['case_summary'].items():
            summary_lines.append('| '+' | '.join([Path(run['stem']).name,case,str(stats['all_turns_approved']),str(stats['passed_turns'])+'/'+str(stats['turns']),str(stats['ladder_rejection_count'])])+' |')
    summary_lines += ['', summary['semantic_limits'], '', 'Se conserva la comparación exacta y la comparación que ignora sólo espacios. Otra comparación permite además eliminar únicamente ¿/¡ según autoridad:15. Se compara el último borrador con la entrega para separar reparación de cambio posterior. Una coincidencia técnica certifica preservación textual dentro de esas dos operaciones; no valida semántica. Los cambios detectados no se atribuyen a plantilla o recorte sin indicador estructural. Consulta por-turno.csv para texto autorizado, texto enviado, acciones, reparaciones y trazas.']
    (output/'resumen.md').write_text('\n'.join(summary_lines)+'\n')
    print(json.dumps({'outputdir':str(output),'runs':[{'stem':r['stem'],'statuses':r['turn_status'],'correlated':r['correlated_turns'],'consumption':r['consumption']} for r in runs]},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
