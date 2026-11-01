#!/usr/bin/env python3
"""Read-only index of saved golden model attempts and runtime evidence.

Only writes the requested JSON index. It never calls providers or modifies the repo.
"""
from __future__ import annotations
import argparse, hashlib, json, re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

DEFAULT_REPO = Path(__file__).resolve().parents[2]
OUT_NAME = 'offline-replay-index.json'

def canonical(value: Any) -> Any:
    if isinstance(value, dict): return {k: canonical(value[k]) for k in sorted(value)}
    if isinstance(value, list): return [canonical(v) for v in value]
    return value

def stable_json(value: Any) -> str:
    return json.dumps(canonical(value), ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def digest(value: Any) -> str:
    return hashlib.sha256(stable_json(value).encode()).hexdigest()

def rec(value: Any) -> dict:
    return value if isinstance(value, dict) else {}

def output_text(payload: Any) -> str | None:
    root = rec(payload)
    if isinstance(root.get('output_text'), str): return root['output_text']
    fragments = []
    for output in root.get('output', []) if isinstance(root.get('output'), list) else []:
        for item in rec(output).get('content', []) if isinstance(rec(output).get('content'), list) else []:
            if isinstance(rec(item).get('text'), str): fragments.append(rec(item)['text'])
    return ''.join(fragments) if fragments else None

def parse_proposal(text: str | None) -> dict | None:
    if not text: return None
    candidate = re.sub(r'\s*```$', '', re.sub(r'^```(?:json)?\s*', '', text.strip()))
    try:
        obj = json.loads(candidate)
        return obj if isinstance(obj, dict) else None
    except Exception: return None

def authorized_context(request: Any) -> dict | None:
    instructions = rec(request).get('instructions')
    if not isinstance(instructions, str): return None
    match = re.search(r'<authorized_context>\s*([\s\S]*?)\s*</authorized_context>', instructions)
    if not match: return None
    try:
        obj = json.loads(match.group(1)); return obj if isinstance(obj, dict) else None
    except Exception: return None

def extract_attempts(evidence: dict) -> list[dict]:
    result = []
    exchanges = evidence.get('httpExchanges', [])
    for exchange in [rec(x) for x in exchanges if rec(x).get('boundary') == 'deepseek']:
        proposal = parse_proposal(output_text(exchange.get('responseBody')))
        move = rec(proposal.get('move')) if proposal else {}
        context = authorized_context(exchange.get('requestBody'))
        response = rec(proposal.get('response')) if proposal else {}
        messages = response.get('messages')
        texts = [x for x in messages if isinstance(x, str) and x.strip()] if isinstance(messages, list) else []
        if isinstance(response.get('call_offer'), str) and response['call_offer'].strip(): texts.append(response['call_offer'])
        result.append({
            'attempt': len(result) + 1,
            'response': '\n'.join(texts) if texts else None,
            'move': move.get('move') if isinstance(move.get('move'), str) else None,
            'proposedAction': rec(proposal.get('proposed_action')) if proposal and isinstance(proposal.get('proposed_action'), dict) else None,
            'turnRejection': context.get('turn_rejection') if context else None,
            'providerStatus': exchange.get('status'),
            'providerError': exchange.get('error'),
        })
    return result

def candidate_fingerprint(attempt: dict) -> str:
    return digest({k: v for k, v in attempt.items() if k != 'attempt'})

def output_set(evidence: dict) -> list[str]:
    values = []
    for key in ('authorizedMessages',):
        v = evidence.get(key)
        if isinstance(v, list): values.extend(x for x in v if isinstance(x, str))
    for cap in evidence.get('adapterCaptures', []) if isinstance(evidence.get('adapterCaptures'), list) else []:
        c = rec(cap).get('content')
        if isinstance(c, str): values.append(c)
    return list(dict.fromkeys(values))

def nested_price_source_ids(value: Any, path: str = '') -> dict[str, list[str]]:
    found = {}
    if isinstance(value, dict):
        for key, child in value.items():
            norm = re.sub(r'[^a-z0-9]', '', key.lower())
            if ('priceobjection' in norm or 'price_objection' in key.lower()) and isinstance(child, dict):
                for sk, sv in child.items():
                    if 'sourcemessageids' in re.sub(r'[^a-z0-9]', '', sk.lower()) and isinstance(sv, list):
                        found[path + '/' + key + '/' + sk] = sorted(str(x) for x in sv)
            found.update(nested_price_source_ids(child, path + '/' + key))
    elif isinstance(value, list):
        for i, child in enumerate(value): found.update(nested_price_source_ids(child, f'{path}[{i}]'))
    return found

def summarize_runtime(path: Path, raw: dict, evidence: dict, attempts: list[dict]) -> dict:
    deepseek = [rec(x) for x in evidence.get('httpExchanges', []) if rec(x).get('boundary') == 'deepseek']
    requests = []
    for ex in deepseek:
        req = rec(ex.get('requestBody')); ctx = authorized_context(req)
        inp = req.get('input')
        requests.append({
            'model': req.get('model'),
            'instructions_sha256': hashlib.sha256(req.get('instructions', '').encode()).hexdigest() if isinstance(req.get('instructions'), str) else None,
            'input_sha256': hashlib.sha256(inp.encode()).hexdigest() if isinstance(inp, str) else digest(inp),
            'instructions_chars': len(req.get('instructions', '')) if isinstance(req.get('instructions'), str) else None,
            'input_chars': len(inp) if isinstance(inp, str) else None,
            'authorized_context_sha256': digest(ctx) if ctx is not None else None,
            'authorized_context_top_keys': sorted(ctx) if ctx else [],
            'turn_rejection': ctx.get('turn_rejection') if ctx else None,
            'price_objection_source_ids': nested_price_source_ids(ctx) if ctx else {},
        })
    return {
        'file': str(path), 'conversation_id': raw.get('conversation_id'),
        'case_slug': case_slug(raw.get('conversation_id', '')),
        'customer': raw.get('customer'),
        'occurred_at': evidence.get('occurredAt') or raw.get('generated_at'),
        'turn_id': evidence.get('turnId'), 'trace_id': evidence.get('traceId'),
        'external_message_id': evidence.get('externalMessageId'),
        'report_run_tiecheck_only': None,
        'attempts': attempts, 'attempt_array_sha256': digest(attempts),
        'provider_requests': requests,
        'delivered_outputs': output_set(evidence),
        'runtime_price_objection_source_ids': nested_price_source_ids(evidence),
        'delivery_status': evidence.get('deliveryStatus'),
    }

def case_slug(conversation_id: str) -> str | None:
    m = re.match(r'^golden-(.+?)-[0-9a-f]{8}-[0-9a-f-]{27,}$', conversation_id)
    return m.group(1) if m else None

def load_json(path: Path) -> Any:
    with path.open(encoding='utf-8') as f: return json.load(f)

def report_paths(results: Path) -> list[Path]:
    return [results / 'baseline-028f272-v3.json'] + [results / f'baseline-v{v}.json' for v in range(4, 9)]

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', type=Path, default=DEFAULT_REPO)
    ap.add_argument('--output', type=Path, default=Path(__file__).with_name(OUT_NAME))
    args = ap.parse_args()
    repo = args.repo.resolve(); results = repo / 'evals/golden/results'
    runtime_files = sorted((results / 'runtime').glob('*.json'))
    runtimes = []
    for path in runtime_files:
        try:
            raw = load_json(path); evidence = rec(raw.get('evidence'))
            attempts = extract_attempts(evidence)
            runtimes.append(summarize_runtime(path, raw, evidence, attempts))
        except Exception as exc:
            runtimes.append({'file': str(path), 'parse_error': str(exc), 'attempts': []})
    by_case_customer = defaultdict(list)
    by_case = defaultdict(list)
    for run in runtimes:
        if run.get('case_slug'):
            by_case_customer[(run['case_slug'], run.get('customer'))].append(run)
            by_case[run['case_slug']].append(run)

    entries = []
    version_counts = {}
    post_sale_turns = []
    supplementary_observations = []
    observation_audit = {}
    for v, report_path in zip(range(3, 9), report_paths(results)):
        report = load_json(report_path); turn_count = attempt_count = no_response = 0
        for case in report.get('cases', []):
            case_id = case.get('case_id')
            for turn in case.get('turns', []):
                turn_count += 1
                report_attempts = turn.get('model_attempts', []) if isinstance(turn.get('model_attempts'), list) else []
                base = by_case_customer[(case_id, turn.get('customer'))]
                exact_full = [r for r in base if canonical(r.get('attempts', [])) == canonical(report_attempts)]
                full_ids = {r['file'] for r in exact_full}
                if turn.get('turn_id') == 'verified_access_event':
                    post_sale_turns.append({
                        'version': v, 'report': str(report_path), 'case_id': case_id,
                        'turn_id': turn.get('turn_id'), 'customer': turn.get('customer'),
                        'saved_model_attempts': report_attempts,
                        'drafts': [a.get('response') for a in report_attempts if isinstance(a.get('response'), str)],
                        'draft_status': 'recorded' if report_attempts else 'no_model_attempt_saved',
                        'response_real': turn.get('response_real'),
                        'setup_evidence': case.get('setup_evidence'),
                        'backend_rejections': turn.get('backend_rejections', []),
                    })
                for attempt in report_attempts:
                    attempt_count += 1
                    if not (isinstance(attempt.get('response'), str) and attempt['response'].strip()): no_response += 1
                    index = attempt.get('attempt')
                    idx = index - 1 if isinstance(index, int) else -1
                    individually_exact = []
                    for r in runtimes:
                        ats = r.get('attempts', [])
                        if idx >= 0 and idx < len(ats) and candidate_fingerprint(ats[idx]) == candidate_fingerprint(attempt):
                            individually_exact.append(r)
                    if not individually_exact:
                        individually_exact = [r for r in runtimes if any(candidate_fingerprint(a) == candidate_fingerprint(attempt) for a in r.get('attempts', []))]
                    candidate_details = []
                    report_delivered = turn.get('response_real')
                    pre = rec(turn.get('preconditions')); price = rec(pre.get('price_objection_memory'))
                    expected_ids = sorted(str(x) for x in price.get('sourceMessageIds', []) if isinstance(price.get('sourceMessageIds'), list))
                    for run in exact_full:
                        runtime_attempt = run['attempts'][idx] if 0 <= idx < len(run.get('attempts', [])) else None
                        outputs = run.get('delivered_outputs', [])
                        context_sources = run.get('runtime_price_objection_source_ids', {})
                        request = run.get('provider_requests', [])[idx] if idx < len(run.get('provider_requests', [])) else {}
                        delivered_equal = report_delivered in outputs if isinstance(report_delivered, str) else None
                        rejection_equal = canonical(rec(runtime_attempt).get('turnRejection')) == canonical(attempt.get('turnRejection')) if runtime_attempt else None
                        price_state = 'exact' if expected_ids and expected_ids in list(context_sources.values()) else ('both_empty' if not expected_ids and not context_sources else 'not_proven')
                        candidate_details.append({
                            'file': run['file'], 'occurred_at': run.get('occurred_at'),
                            'turn_id': run.get('turn_id'), 'trace_id': run.get('trace_id'),
                            'external_message_id': run.get('external_message_id'),
                            'attempt_array_sha256': run.get('attempt_array_sha256'),
                            'attempt_index': index,
                            'attempt_fingerprint_sha256': candidate_fingerprint(runtime_attempt) if runtime_attempt else None,
                            'attempt_turn_rejection': rec(runtime_attempt).get('turnRejection') if runtime_attempt else None,
                            'attempt_turn_rejection_equal': rejection_equal,
                            'runtime_request_context_sha256': request.get('authorized_context_sha256'),
                            'runtime_price_objection_source_ids': context_sources,
                            'report_price_objection_source_ids': expected_ids,
                            'price_source_id_resolution': price_state,
                            'report_response_real_matches_authorized_or_adapter_output': delivered_equal,
                            'runtime_delivered_outputs': outputs,
                        })
                    signatures = {digest({
                        'delivered_match': c['report_response_real_matches_authorized_or_adapter_output'],
                        'rejection_equal': c['attempt_turn_rejection_equal'],
                        'price_source_state': c['price_source_id_resolution'],
                        'request_context': c['runtime_request_context_sha256'],
                    }) for c in candidate_details}
                    if not exact_full and individually_exact:
                        disposition = 'individual_attempt_match_no_exact_full_array'
                    elif not exact_full:
                        disposition = 'no_runtime_attempt_fingerprint_match'
                    elif len(candidate_details) == 1:
                        disposition = 'unique_full_array_candidate'
                    elif len(signatures) == 1:
                        disposition = 'multiple_candidates_equivalent_on_available_context_checks'
                    else:
                        disposition = 'multiple_candidates_diverse_preserve_all'
                    entry = {
                        'report': str(report_path), 'version': v, 'base_sha': report.get('base_sha'),
                        'case_id': case_id, 'turn_id': turn.get('turn_id'), 'customer': turn.get('customer'),
                        'attempt': attempt, 'attempt_fingerprint_sha256': candidate_fingerprint(attempt),
                        'turn_response_real': report_delivered,
                        'report_turn_record': turn,
                        'backend_rejections': turn.get('backend_rejections', []),
                        'validator_rejections': turn.get('validator_rejections', []),
                        'preconditions': pre,
                        'full_attempt_array_sha256': digest(report_attempts),
                        'exact_full_array_candidate_count': len(exact_full),
                        'exact_full_array_candidates': candidate_details,
                        'individual_attempt_candidate_count': len(individually_exact),
                        'individual_attempt_candidates': [r['file'] for r in individually_exact],
                        'resolution': disposition,
                    }
                    entries.append(entry)
        version_counts[str(v)] = {'turns': turn_count, 'attempts': attempt_count, 'attempts_without_nonempty_response': no_response,
                                  'exact_full_array_attempt_occurrences': sum(e['version'] == v and e['exact_full_array_candidate_count'] > 0 for e in entries),
                                  'no_full_array_match_attempt_occurrences': sum(e['version'] == v and e['exact_full_array_candidate_count'] == 0 for e in entries),
                                  'no_individual_fingerprint_candidate_occurrences': sum(e['version'] == v and e['individual_attempt_candidate_count'] == 0 for e in entries)}
    # Audit the original observation partials separately from the final reports.
    # v3 explicitly points to the v2 observation partial in its metadata.
    observation_sources = {}
    for v in range(3, 9):
        report_path = report_paths(results)[v - 3]
        report = load_json(report_path)
        if v == 3:
            source_name = report.get('source_observations')
            obs_path = results / source_name if isinstance(source_name, str) else None
        else:
            obs_path = results / f'baseline-v{v}-observations.partial.json'
        if not obs_path or not obs_path.exists():
            observation_sources[str(v)] = None
            observation_audit[str(v)] = {'source_file': str(obs_path) if obs_path else None,
                                         'status': 'missing', 'observations': 0, 'attempts': 0,
                                         'exact_attempts_represented_in_report': 0,
                                         'supplementary_attempts': 0, 'report_attempts_without_observation_match': None}
            continue
        observation_sources[str(v)] = str(obs_path)
        source = load_json(obs_path)
        report_counts = defaultdict(Counter)
        report_attempt_records = defaultdict(list)
        for c in report.get('cases', []):
            for t in c.get('turns', []):
                key = (c.get('case_id'), t.get('turn_id'), t.get('customer'))
                for a in t.get('model_attempts', []):
                    report_counts[key][digest(a)] += 1
                    report_attempt_records[key].append(a)
        observed = matched = extra = same_nonresponse = other_field_mismatch = 0
        source_turn_rows = 0
        report_only = 0
        for c in source.get('cases', []):
            scenario = rec(c.get('scenario'))
            case_id = scenario.get('id') or scenario.get('case_id')
            scenario_turns = scenario.get('turns', [])
            observation_rows = c.get('observations', [])
            source_turn_rows += len(observation_rows)
            for i, observation in enumerate(observation_rows):
                scenario_turn = rec(scenario_turns[i]) if i < len(scenario_turns) else {}
                turn_id = scenario_turn.get('id')
                customer = scenario_turn.get('customer')
                key = (case_id, turn_id, customer)
                obs_attempts = observation.get('modelAttempts', []) if isinstance(observation.get('modelAttempts'), list) else []
                observed += len(obs_attempts)
                unmatched = []
                for a in obs_attempts:
                    fp = digest(a)
                    if report_counts[key][fp]:
                        report_counts[key][fp] -= 1
                        matched += 1
                    else:
                        extra += 1
                        unmatched.append(a)
                if unmatched:
                    base = by_case_customer[(case_id, customer)]
                    exact_array = [r for r in base if canonical(r.get('attempts', [])) == canonical(obs_attempts)]
                    individual_candidates = []
                    for a in unmatched:
                        nonresponse = digest({k: val for k, val in a.items() if k != 'response'})
                        nonresponse_matches = [ra for ra in report_attempt_records[key]
                                              if digest({k: val for k, val in ra.items() if k != 'response'}) == nonresponse]
                        if nonresponse_matches: same_nonresponse += 1
                        else: other_field_mismatch += 1
                        same_case_attempts = [r for r in base if any(digest(ra) == digest(a) for ra in r.get('attempts', []))]
                        global_attempts = [] if same_case_attempts else [r for r in runtimes if any(digest(ra) == digest(a) for ra in r.get('attempts', []))]
                        individual_candidates.append({
                            'attempt': a,
                            'same_nonresponse_fields_report_attempts': nonresponse_matches,
                            'fingerprint_difference': 'response_only' if nonresponse_matches else 'other_fields_and_or_response',
                            'runtime_candidates': [r['file'] for r in (same_case_attempts or global_attempts)],
                            'match_scope': 'case_customer' if same_case_attempts else 'global_individual_fingerprint' if global_attempts else 'no_runtime_fingerprint_match',
                        })
                    supplementary_observations.append({
                        'version': v, 'source_file': str(obs_path), 'report_file': str(report_path),
                        'case_id': case_id, 'turn_id': turn_id, 'customer': customer,
                        'observation_response_delivered': observation.get('response'),
                        'observation_attempts': unmatched,
                        'full_observation_attempt_array_sha256': digest(obs_attempts),
                        'report_exact_match_count': len(obs_attempts) - len(unmatched),
                        'supplementary_attempt_count': len(unmatched),
                        'exact_full_array_runtime_candidates': [r['file'] for r in exact_array],
                        'attempt_runtime_candidates': individual_candidates,
                        'candidate_resolution': ('unique_exact_observation_array' if len(exact_array) == 1 else
                                                 'multiple_exact_observation_arrays_preserve_all' if len(exact_array) > 1 else
                                                 'individual_fingerprints_only_or_none'),
                    })
        report_only = sum(sum(counter.values()) for counter in report_counts.values())
        observation_audit[str(v)] = {
            'source_file': str(obs_path), 'status': 'read',
            'reported_completed_cases': source.get('completed_cases'),
            'total_cases': source.get('total_cases'), 'observation_turn_rows': source_turn_rows,
            'observation_attempts': observed,
            'exact_attempts_represented_in_report': matched,
            'supplementary_attempts': extra,
            'supplementary_with_only_response_field_different_from_a_report_attempt': same_nonresponse,
            'supplementary_with_other_field_differences_or_no_report_attempt_counterpart': other_field_mismatch,
            'report_attempts_without_observation_match': report_only,
        }
    # Cross-version full-fingerprint deduplication. v6 partial declares the
    # same base SHA as v7, so its source appearances are not automatically new.
    report_matches = defaultdict(list)
    for e in entries:
        match_key = (e['case_id'], e['turn_id'], e['customer'], digest(e['attempt']))
        report_matches[match_key].append({'version': e['version'], 'report_file': e['report'],
                                          'base_sha': e['base_sha'], 'attempt_index': e['attempt'].get('attempt')})
    for row in supplementary_observations:
        matched_rows = []
        novel = 0
        for attempt in row['observation_attempts']:
            key = (row['case_id'], row['turn_id'], row['customer'], digest(attempt))
            matches = report_matches.get(key, [])
            if not matches: novel += 1
            matched_rows.extend({'attempt_fingerprint_sha256': digest(attempt), **m} for m in matches)
        row['cross_version_report_matches'] = matched_rows
        row['novel_full_fingerprint_count_across_reports'] = novel
        row['is_novel_full_fingerprint_vs_reports'] = novel > 0
    cross_version_exact_by_version = {}
    for v in range(3, 9):
        cross_version_exact_by_version[str(v)] = sum(
            1 for row in supplementary_observations if row['version'] == 6
            for attempt in row['observation_attempts']
            if any(m['version'] == v for m in report_matches.get(
                (row['case_id'], row['turn_id'], row['customer'], digest(attempt)), [])))
    novel_after_dedup = sum(row['novel_full_fingerprint_count_across_reports']
                            for row in supplementary_observations if row['version'] == 6)
    observation_audit['6']['cross_version_exact_matches_by_report_version'] = cross_version_exact_by_version
    observation_audit['6']['novel_full_fingerprint_after_cross_version_deduplication'] = novel_after_dedup
    unique_source_fingerprints = set()
    for e in entries:
        unique_source_fingerprints.add((e['case_id'], e['turn_id'], e['customer'], digest(e['attempt'])))
    for row in supplementary_observations:
        for attempt in row['observation_attempts']:
            unique_source_fingerprints.add((row['case_id'], row['turn_id'], row['customer'], digest(attempt)))
    supplementary_total = sum(row['supplementary_attempt_count'] for row in supplementary_observations)
    out = {
        'schema_version': 1,
        'generated_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
        'read_only_inputs': {'repo': str(repo), 'reports': [str(p) for p in report_paths(results)], 'runtime_directory': str(results / 'runtime'), 'runtime_file_count': len(runtime_files)},
        'matching_method': 'same report-extractor fields (runner-support.ts extractModelAttemptsV1), exact case slug + customer for full arrays; recursively sorted canonical JSON; individual attempt fallback; duplicates preserved and resolved only using saved response_real vs authorizedMessages/adapterCaptures, price objection source IDs when captured, turnRejection, and request context hash. No timestamp-only matching.',
        'counts_by_version': version_counts,
        'observation_partial_audit': observation_audit,
        'observation_sources': observation_sources,
        'cross_version_deduplication': {
            'v6_partial_base_sha': load_json(results / 'baseline-v6-observations.partial.json').get('base_sha'),
            'v7_report_base_sha': load_json(results / 'baseline-v7.json').get('base_sha'),
            'v6_partial_is_same_generation_as_v7_report': load_json(results / 'baseline-v6-observations.partial.json').get('base_sha') == load_json(results / 'baseline-v7.json').get('base_sha'),
            'v6_partial_attempts_exactly_matching_report_by_version': cross_version_exact_by_version,
            'v6_partial_attempts_exactly_matching_v7': cross_version_exact_by_version.get('7', 0),
            'v6_post_sale_verified_access_event_exact_match_in_v7': any(
                row['version'] == 6 and row['turn_id'] == 'verified_access_event' and
                any(m['version'] == 7 for m in row.get('cross_version_report_matches', []))
                for row in supplementary_observations),
            'v6_partial_novel_full_fingerprints_after_cross_version_deduplication': novel_after_dedup,
            'interpretation': 'Preserve source appearances for provenance, but do not count v6 partial exact duplicates of baseline-v7 as novel drafts or independent frequency observations.',
        },
        'total_attempt_occurrences': len(entries),
        'total_source_occurrences_including_supplementary_observations': len(entries) + supplementary_total,
        'unique_case_turn_customer_full_attempt_fingerprint_groups': len(unique_source_fingerprints),
        'total_unique_full_array_occurrences': sum(e['exact_full_array_candidate_count'] > 0 for e in entries),
        'total_attempt_occurrences_without_full_array_candidate': sum(e['exact_full_array_candidate_count'] == 0 for e in entries),
        'post_sale_artifact': {
            'source_code': str(repo / 'evals/golden/live-runner.test.ts'),
            'provider_call_lines': '437-470', 'draft_and_delivery_lines': '470-526', 'helper_start_line': 329,
            'report_extraction': 'The `verified_access_event` model_attempt.response in each baseline report is [narrative.intro, narrative.suggestion] joined by newline; setup_evidence.access_message is backend-completed delivered text.',
            'runtime_capture_limitation': 'The post-sale provider fetch is a direct fetch inside prepareFulfilledBonusPackage and is not inserted into processInboundTurn evidence.httpExchanges. Five versions (v3,v4,v6,v7,v8) preserve a model-attempt draft in their baseline JSON. v5 preserves no model_attempt for either turn in this case. Observation partial files exist for v4,v5,v6,v8, but their existence does not imply a saved draft for v5.',
            'six_turn_drafts': post_sale_turns,
        },
        'attempts': entries,
        'supplementary_observation_attempts': supplementary_observations,
        'rows': list(_group_turn_rows(entries).values()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(args.output.resolve()), 'runtime_files': len(runtime_files), 'attempt_occurrences': len(entries), 'versions': version_counts, 'post_sale_drafts': len(post_sale_turns)}, ensure_ascii=False, indent=2))

def _group_turn_rows(entries: list[dict]) -> dict:
    grouped = {}
    for i, e in enumerate(entries):
        key = (e['version'], e['case_id'], e['turn_id'], e['customer'], e['report'], digest(e['preconditions']))
        if key not in grouped:
            grouped[key] = {'version': e['version'], 'case_id': e['case_id'], 'turn_id': e['turn_id'],
                            'customer': e['customer'], 'report_file': e['report'], 'report_turn': e['turn_response_real'],
                            'report_turn_record': e['report_turn_record'],
                            '_attempts': [], '_indices': []}
        grouped[key]['_attempts'].append(e)
        grouped[key]['_indices'].append(i)
    result = {}
    for key, g in grouped.items():
        result[key] = {**{k: v for k, v in g.items() if not k.startswith('_')},
                       'attempts': [e['attempt'] for e in g['_attempts']],
                       'runtime_candidates': list(dict.fromkeys(c['file'] for e in g['_attempts'] for c in e['exact_full_array_candidates'])),
                       'individual_attempt_candidates': list(dict.fromkeys(p for e in g['_attempts'] for p in e['individual_attempt_candidates'])),
                       'match_kind': ('exact_full_array_candidates' if all(e['exact_full_array_candidate_count'] for e in g['_attempts']) else
                                      'individual_attempt_match' if any(e['individual_attempt_candidate_count'] for e in g['_attempts']) else
                                      'no_runtime_attempt_fingerprint_match'),
                       'candidate_resolution': list(dict.fromkeys(e['resolution'] for e in g['_attempts'])),
                       'attempt_row_ids': g['_indices']}
    # Entries without model attempts must still appear as rows for complete turn coverage.
    return result

if __name__ == '__main__': main()
