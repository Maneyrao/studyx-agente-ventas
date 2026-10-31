"""Render existing offline evidence only; never calls network or model APIs."""
import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/reports/evidence/2026-10-31-four-priority-replay'
data = json.loads((OUT / 'replay.json').read_text())
rows = data['rows']
primary = [r for r in rows if r['source_kind'] == 'final_report']

def unique(values):
    return list(dict.fromkeys(values))

def outcomes(row):
    return unique(c['outcome'] for c in row['candidates']) or [row['outcome']]

def rejections(row):
    found = []
    for c in row['candidates']:
        for rejection in c['rejections']:
            reasons = rejection.get('rejections')
            if reasons:
                found.extend(f"{r.get('code')}:{r.get('subject')}" for r in reasons)
            else:
                found.append(str(rejection.get('detail') or rejection.get('code') or rejection))
    found.extend(str(r.get('code') or r.get('detail')) for r in row.get('post_sale', {}).get('rejections', []))
    return unique(found)

def staged(row):
    values = []
    for c in row['candidates']:
        value = c.get('current_precommit_text') or c.get('preparation_text') or c.get('plannerless_text') or c.get('normalized')
        if value:
            stage = ('precommit condicionado' if c.get('current_precommit_text') else
                     'preparación condicionada; todavía rechazado' if c.get('preparation_text') else
                     'resolver; todavía no autorizado' if c.get('plannerless_text') else 'parser; todavía no autorizado')
            values.append(f'{stage}: {value}')
    post = row.get('post_sale')
    if post:
        value = post.get('assembled_fallback') or post.get('assembled')
        if value:
            values.append(f'ensamblador postventa aislado; no acredita entrega: {value}')
    return unique(values)

def transformations(row):
    result = []
    for c in row['candidates']:
        for t in c['transformations']:
            result.append(f"{t['id']} [{t['authority']}; contradicción={t['contradiction']}; {t.get('condition', 'etapa ejecutada')}]")
    for t in row.get('post_sale', {}).get('transformations', []):
        result.append(f"{t['id']} [{t['authority']}; contradicción={t['contradiction']}; ensamblador aislado]")
    return unique(result)

def historical(row):
    result = []
    for c in row['candidates']:
        rel = c.get('historical_relationship', {})
        if rel.get('floor_events'):
            result.append(f"floor histórico confirmado; trace={c['trace_id']}")
        if rel.get('literal_slice_matching_final'):
            result.append('salida histórica coincide con recorte literal del borrador, normalizado por código anterior')
        if rel.get('this_attempt_register_changed'):
            result.append('el normalizador anterior convertiría voseo→tú; esa conversión ya no está en 06ec3e5')
    return unique(result)

columns = ['fuente', 'version_rotulo', 'duplicado_de', 'caso', 'turno', 'intento', 'borrador_original',
           'salida_historica', 'texto_hoy_hasta_etapa_comprobada', 'entregado_hoy', 'estado',
           'transformaciones_y_autoridad', 'rechazos_actuales', 'evidencia_historica', 'contextos_candidatos', 'traces']
table = []
for row in rows:
    table.append({
        'fuente': row['source_kind'], 'version_rotulo': row['version'],
        'duplicado_de': row.get('source_duplicate_of_version') or '',
        'caso': row['case_id'], 'turno': row['turn_id'], 'intento': row['attempt'],
        'borrador_original': row['original'] or '(sin borrador: error del proveedor)',
        'salida_historica': row['historical_delivered'],
        'texto_hoy_hasta_etapa_comprobada': '\n---\n'.join(staged(row)) or '(sin texto autorizado comprobable)',
        'entregado_hoy': 'NO DETERMINABLE: sin commit, efectos ni entrega; puede requerir nueva reparación',
        'estado': '; '.join(outcomes(row)),
        'transformaciones_y_autoridad': '; '.join(transformations(row)) or 'sin cambio de palabras observado en la etapa probada; no acredita comportamiento completo',
        'rechazos_actuales': '; '.join(rejections(row)) or '(ninguno en las etapas ejercitadas)',
        'evidencia_historica': '; '.join(historical(row)),
        'contextos_candidatos': row['candidate_count'],
        'traces': '; '.join(unique(c['trace_id'] for c in row['candidates'])),
    })
with (OUT / 'por-borrador.csv').open('w', newline='') as handle:
    writer = csv.DictWriter(handle, fieldnames=columns)
    writer.writeheader()
    writer.writerows(table)

def esc(value):
    return str(value).replace('|', '\\|').replace('\r', '').replace('\n', '<br>')

lines = [
    f"# Replay offline por borrador — {data['product_sha']}", '',
    '427 apariciones fuente. Las 59 del parcial rotulado v6 duplican exactamente v7; no son nuevas generaciones ni aumentan el impacto.', '',
    '**No es una aceptación del modelo ni un replay completo de entrega.** Se ejecutaron parser/resolver reales; preparación y truth guard usan proyecciones grabadas, sin estado durable completo. Postventa prueba el ensamblador con narrativa reconstruida. Una reparación nueva queda desconocida. Ninguna acción ni envío se ejecutó.', '',
    'P = docs/authority/prompt-agente-a-studyx-v2.md; B = docs/authority/spec-backend-bonificacion.md. “Rechazado” no significa contradicción: rechazar un hecho inventado o efecto no autorizado cumple la autoridad.', '',
    '| Fuente / caso / turno / intento | Borrador original | Texto hasta etapa comprobada (condicionado) | Rechazos | Transformación / autoridad | Entrega hoy |',
    '|---|---|---|---|---|---|',
]
for row in table:
    label = f"v{row['version_rotulo']} {row['fuente']} / {row['caso']} / {row['turno']} / {row['intento']}"
    lines.append('| ' + ' | '.join(esc(v) for v in [label, row['borrador_original'], row['texto_hoy_hasta_etapa_comprobada'],
        row['rechazos_actuales'], row['transformaciones_y_autoridad'], row['entregado_hoy']]) + ' |')
lines.extend(['', '## Turnos sin borrador guardado', '', '| Versión | Caso / turno | Salida histórica | Cobertura actual |', '|---|---|---|---|'])
for turn in data['recorded_technical_paths']:
    if not turn['has_model_attempts']:
        lines.append('| ' + ' | '.join(esc(v) for v in [turn['version'],f"{turn['case_id']} / {turn['turn_id']}",
            turn['historical_delivered'] or '(sin salida)',
            'fast-path puro reconstruido; efecto/entrega no ejecutados' if turn['candidates'] else 'sin evidencia ejecutable']) + ' |')
(OUT / 'por-borrador.md').write_text('\n'.join(lines) + '\n')

floor_rows = [r for r in primary if any(c.get('historical_relationship', {}).get('floor_events') for c in r['candidates'])]
floor_traces = unique(c['trace_id'] for r in floor_rows for c in r['candidates'])
post_rows = [r for r in primary if r.get('post_sale')]
summary = {
    'product_sha': data['product_sha'], 'model_calls': 0, 'tokens': 0, 'deployments': 0,
    'source_appearances': len(rows), 'source_text_appearances': sum(bool(r['original']) for r in rows),
    'primary_report_attempts': len(primary), 'primary_drafts': sum(bool(r['original']) for r in primary),
    'primary_provider_errors_without_draft': sum(not r['original'] for r in primary),
    'primary_drafts_with_full_runtime': sum(bool(r['original']) and bool(r['candidates']) for r in primary),
    'primary_post_sale_reconstructions': len(post_rows),
    'partial_v6_duplicate_appearances_of_v7': data['cross_version_deduplication']['v6_partial_attempts_exactly_matching_v7'],
    'primary_row_outcomes': dict(Counter(' | '.join(outcomes(r)) for r in primary)),
    'historical_floor_unique_traces': floor_traces,
    'historical_floor_primary_turn_appearances': len(set((r['version'],r['case_id'],r['turn_id']) for r in floor_rows)),
    'post_sale_whitelist_rejected_distinct_primary_drafts': len(set(r['original'] for r in post_rows if r['post_sale']['outcome'] == 'post_sale_rejected')),
    'call_fast_path_primary_turn_appearances': sum(not t['has_model_attempts'] and bool(t['candidates']) for t in data['recorded_technical_paths']),
    'technical_fixed_fallback_primary_turn_appearances': sum(t['observed_current_technical_fallback_exact'] for t in data['recorded_technical_paths']),
    'primary_old_voseo_rewriter_affected_drafts': sum(any(c.get('historical_relationship', {}).get('this_attempt_register_changed') for c in r['candidates']) for r in primary),
}
(OUT / 'resumen.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, ensure_ascii=False, indent=2))
