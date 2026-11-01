# Offline acceptance summary

Keep `summarize-acceptance-961c991.py` and its dependency `summarize-rule10.py`
in the same folder; the import is relative to the script, with no absolute helper path.
No model, pricing or other API requests are made. The only subprocess reads git HEAD.

Current working command:

```bash
python3 "/Users/tmaneyro22/Documents/AGENTE IA/tmp/summarize-acceptance-961c991.py" \
  --delivery-audit "/Users/tmaneyro22/Documents/AGENTE IA/tmp/acceptance-961c991-delivery-audit-combined.json" \
  --output-dir "/Users/tmaneyro22/Documents/AGENTE IA/tmp/acceptance-961c991-summary-combined"
```

Defaults select the actual r1b/r2 runs from the frozen961c991 worktree.
The aborted original r1 bootstrap is separately recorded with zero requests/cost.
For archived reproduction, override `--stems` with the two absolute archived artifact
prefixes (not `.json` files); `--root` is optional provenance/fallback discovery.
The data output must be outside `--root`, preserving frozen source. Manual audit
is actually labeled `Codex review of delivered text against recorded effects`,
not a human review; each record binds exact delivered text/hash and prior effects.

Outputs: summary.json/md, turns.json and per-turn.csv. Case and invariant states
control the gate even if individual turns pass. Original scores are never changed.
The Codex audit counts31PASS/5FAIL, with no undecidable delivered-gift classification.
The joint semantic criterion counts can remain indeterminate when a failed judge
verdict did not supply an independent positive gift verdict; these are distinguished
from the completed Codex reading and cannot open the gate.

Costs use Flash offpeak USD/million tokens: cached0.003, miss0.15, output0.6.
Root independently verified the official Sunday schedule. Known cost0.112621566;
one judge network request has missing usage, so total estimated cost is unknown
without separate billing/balance evidence. Agent latency is separated from judge
latency and its27.076s network failure. Model request alias deepseek-v4-flash returned
deepseek-flash; this does not imply a changed provider/model quality.

## Lectura de las auditorías

`delivery-audit.json` contiene la auditoría contextual final: 31 PASS / 5 FAIL.
`semantic_bonus_status` corresponde al criterio concreto del juez; `codex_bonus_status` a esa lectura contextual; `bonus_delivery_audit_status` es un cruce conservador entre ambos y puede ser indeterminado cuando el veredicto general no acredita por separado ese criterio. Sus conteos (13/3/2 en R1 y 7/8/3 en R2) no son el conteo de la auditoría contextual final. Se conservan ambas fuentes sin alterar los scores originales.
