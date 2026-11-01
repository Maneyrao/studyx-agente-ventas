"""Compare saved offline evidence; no network, database, generation or delivery."""
import csv
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
OLD = OUT.parent / '2026-10-31-offline-replay'
before = json.loads((OLD / 'replay.json').read_text())
after = json.loads((OUT / 'replay.json').read_text())

def key(row):
    return row['version'], row['case_id'], row['turn_id']

def unique(values):
    return list(dict.fromkeys(values))

primary = [r for r in after['rows'] if r['source_kind'] == 'final_report']
floor = {key(r) for r in before['rows'] if r['source_kind'] == 'final_report'
         and any(c.get('historical_relationship', {}).get('floor_events') for c in r['candidates'])}
post = {key(r) for r in primary if r.get('post_sale')}
call = {key(t) for t in before['recorded_technical_paths'] if not t['has_model_attempts'] and t['candidates']}
contingency = {key(t) for t in before['recorded_technical_paths'] if t['observed_current_technical_fallback_exact']}
assert [len(s) for s in [floor, post, call, contingency]] == [7, 5, 4, 3]
assert len(floor | post | call | contingency) == 19
with (OUT / 'por-borrador.csv').open() as handle:
    details = list(csv.DictReader(handle))

columns = ['prioridad', 'version', 'caso', 'turno', 'borradores_originales', 'entrega_historica',
           'etapa_actual_y_texto', 'rechazos', 'resultado_verificable', 'limite']
table = []
for priority, keys in enumerate([floor, post, call, contingency], 1):
    for version, case_id, turn_id in sorted(keys):
        turn_key = version, case_id, turn_id
        rows = [r for r in primary if key(r) == turn_key]
        detail = [r for r in details if r['fuente'] == 'final_report'
                  and (int(r['version_rotulo']), r['caso'], r['turno']) == turn_key]
        technical = next(t for t in after['recorded_technical_paths'] if key(t) == turn_key)
        original = '\n---\n'.join(f"Intento {r['attempt']}: {r['original'] or '(error de proveedor, sin borrador)'}" for r in rows)
        texts = unique(r['texto_hoy_hasta_etapa_comprobada'] for r in detail)
        rejections = unique(r['rechazos_actuales'] for r in detail)
        result = 'Sin candidatos recortados en el helper actual; revalidación de las respuestas completas.'
        limit = 'Cada intento histórico se reproduce por separado. No se generó una reparación nueva ni se ejecutó commit/entrega.'
        if priority == 2:
            p = rows[0]['post_sale']
            assert p['outcome'] == 'post_sale_snapshot' and not p['rejections']
            assert p['narrative']['intro'] in p['assembled']
            if p['narrative'].get('suggestion'):
                assert p['narrative']['suggestion'] in p['assembled']
            result = 'PASA ensamblador: conserva intro/sugerencia completas; sin rechazo de la opcionalidad.'
            limit = 'Narrativa reconstruida del reporte y fuente sintética documentada. No acredita fulfillment, autorización durable ni envío.'
        elif priority == 3:
            original = '(No hubo modelo: el camino histórico usó confirmación fija.)'
            receipts = unique(c['current_call_fast_path']['response'] for c in technical['candidates']
                              if c.get('current_call_fast_path'))
            assert receipts == ['Recibí tu solicitud de llamada.']
            texts = ['Sólo contingencia operativa del helper: ' + receipts[0]]
            rejections = ['No ejecutados: sin propuesta generada ni commit.']
            result = 'PASA helper: el recibo mínimo no afirma despacho ni conexión. El flujo normal ahora solicita redacción al agente.'
            limit = 'La confirmación normal requiere generación nueva, no ejecutada. Consentimiento/efecto/entrega se cubren con tests locales, no con este replay puro.'
        elif priority == 4:
            fallbacks = unique(c['response'] for c in technical['candidates'][0]['current_fallback_candidates']
                               if c['response_type'] == 'technical_fallback')
            assert fallbacks == ['Qué dato o qué curso revisamos?']
            texts.append('Contingencia operativa actual: ' + fallbacks[0])
            result = 'PASA helper: conserva respuesta no vacía y retira la defensa interna de la contingencia histórica.'
            limit += ' La contingencia se ejecuta como helper; no se atribuye como entrega actual.'
        table.append(dict(zip(columns, [priority, version, case_id, turn_id, original,
            technical['historical_delivered'], '\n---\n'.join(texts), '; '.join(rejections), result, limit])))

with (OUT / 'casos-afectados.csv').open('w', newline='') as handle:
    writer = csv.DictWriter(handle, fieldnames=columns, lineterminator='\n')
    writer.writeheader()
    writer.writerows(table)

def esc(value):
    return str(value).replace('|', '\\|').replace('\r', '').replace('\n', '<br>')

lines = [
    '# Prioridades 1–4: 19 turnos afectados', '',
    f"Código reproducido: `{after['product_sha']}`. Cero llamadas a modelos, tokens nuevos, efectos, envíos o despliegues.", '',
    'Siete turnos con recorte histórico, cinco postventas, cuatro confirmaciones sin borrador y tres contingencias. '
    'Se excluyen los 59 duplicados del parcial rotulado v6. Los borradores son generaciones guardadas de evaluaciones, no chats de clientes de producción.', '',
    '“PASA” califica solamente el invariante o helper indicado. El texto hasta precommit es condicionado por el contexto grabado; '
    'no significa mensaje entregado. No se reutiliza una reparación histórica como si respondiera a un rechazo nuevo.', '',
    '| Prioridad / versión / caso / turno | Borradores originales | Entrega histórica | Texto actual hasta etapa comprobada | Rechazos | Resultado y alcance |',
    '|---|---|---|---|---|---|',
]
for r in table:
    label = f"{r['prioridad']} / v{r['version']} / {r['caso']} / {r['turno']}"
    lines.append('| ' + ' | '.join(esc(v) for v in [label, r['borradores_originales'], r['entrega_historica'],
        r['etapa_actual_y_texto'], r['rechazos'], r['resultado_verificable'] + ' ' + r['limite']]) + ' |')
(OUT / 'casos-afectados.md').write_text('\n'.join(lines) + '\n')
summary_path = OUT / 'resumen.json'
summary = json.loads(summary_path.read_text())
summary['historical_affected_turns_by_priority'] = {
    '1_complete_response_recovery': len(floor), '2_post_sale_whitelist': len(post),
    '3_call_confirmation': len(call), '4_internal_defense_contingency': len(contingency),
}
summary['count_definitions'] = {
    'post_sale_whitelist_rejected_distinct_primary_drafts':
        'Current isolated assembler rejections of reconstructed primary post-sale drafts (0). Historical whitelist affected 5 distinct drafts/turns.',
    'technical_fixed_fallback_primary_turn_appearances':
        'Historical delivered text exactly matching the current technical-fallback helper (0). Historical internal-defense contingency affected 3 turns; current helper changed wording.',
    'historical_affected_turns_by_priority':
        'Historical turn appearances, excluding partial-v6 duplicates. Coverage is conditional or helper-only as specified per row, not a current production impact count.',
}
summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'product_sha': after['product_sha'], 'affected_turns': len(table),
                  'by_priority': [len(floor), len(post), len(call), len(contingency)]}))
