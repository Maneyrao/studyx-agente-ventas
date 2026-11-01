import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const results = join(here, 'results')
const v3 = JSON.parse(readFileSync(join(results, 'baseline-028f272-v3.json'), 'utf8'))
const v4 = JSON.parse(readFileSync(join(results, 'baseline-v4.json'), 'utf8'))

const flatten = (baseline) => new Map(baseline.cases.flatMap((scenario) =>
  scenario.turns.map((turn) => [`${scenario.case_id}/${turn.turn_id}`, turn])))
const v3Turns = flatten(v3)

const status = (turn) => {
  if (turn.execution_status === 'evaluator_error'
    || turn.failures?.some((failure) => failure.code === 'GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID')) {
    return 'ERROR EVALUADOR'
  }
  return turn.approved ? 'APROBADO' : 'FALLIDO'
}
const escapeCell = (value) => String(value ?? '')
  .replaceAll('|', '\\|')
  .replaceAll('\n', ' ')
  .replace(/\s+/gu, ' ')
  .trim()
const excerpt = (value, limit = 150) => {
  const compact = escapeCell(value)
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`
}
const rejectionCodes = (turn) => [...new Set([
  ...(turn.backend_rejections ?? []).flatMap((receipt) =>
    (receipt.rejections ?? []).map((rejection) => rejection.code)),
  ...(turn.validator_rejections ?? []).map((rejection) => rejection.code),
])]

const rows = []
const remaining = new Map()
let improved = 0
let regressed = 0
let unchanged = 0
for (const scenario of v4.cases) {
  for (const turn of scenario.turns) {
    const key = `${scenario.case_id}/${turn.turn_id}`
    const before = v3Turns.get(key)
    if (!before) throw new Error(`Missing v3 turn: ${key}`)
    const beforeStatus = status(before)
    const afterStatus = status(turn)
    const change = beforeStatus === 'FALLIDO' && afterStatus === 'APROBADO'
      ? 'MEJORA'
      : beforeStatus === 'APROBADO' && afterStatus === 'FALLIDO'
        ? 'REGRESIÓN'
        : 'SIN CAMBIO'
    if (change === 'MEJORA') improved += 1
    else if (change === 'REGRESIÓN') regressed += 1
    else unchanged += 1
    const codes = rejectionCodes(turn)
    for (const code of codes) {
      const turns = remaining.get(code) ?? []
      turns.push(key)
      remaining.set(code, turns)
    }
    rows.push([
      key,
      beforeStatus,
      afterStatus,
      change,
      turn.failure_layer ?? '—',
      `${turn.move ?? 'none'} / ${turn.proposed_action?.type ?? 'none'}`,
      codes.join(', ') || '—',
      excerpt(turn.response_real),
    ])
  }
}

const countTurns = (baseline, approved) => baseline.cases
  .flatMap((scenario) => scenario.turns)
  .filter((turn) => turn.approved === approved).length
const lines = [
  '# Comparación golden v3 → v4',
  '',
  `- v3: ${v3.base_sha} · ${v3.prompt_version} · ${v3.brain_version}`,
  `- v4: ${v4.base_sha} · ${v4.prompt_version} · ${v4.brain_version}`,
  `- Casos v3: ${v3.case_summary.approved} aprobados / ${v3.case_summary.failed} fallidos / ${v3.case_summary.evaluator_errors} errores del evaluador.`,
  `- Casos v4: ${v4.case_summary.approved} aprobados / ${v4.case_summary.failed} fallidos / ${v4.case_summary.evaluator_errors} errores del evaluador.`,
  `- Turnos v3: ${countTurns(v3, true)} aprobados / ${countTurns(v3, false)} fallidos.`,
  `- Turnos v4: ${countTurns(v4, true)} aprobados / ${countTurns(v4, false)} fallidos.`,
  `- Cambios por turno: ${improved} mejoras / ${regressed} regresiones / ${unchanged} sin cambio.`,
  '',
  '## Tabla por turno',
  '',
  '| Caso/turno | v3 | v4 | Cambio | Capa v4 | Move / acción v4 | Rechazos v4 | Respuesta real v4 (abreviada) |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  '',
  '## Rechazos restantes en v4',
  '',
  ...(remaining.size === 0
    ? ['No quedaron rechazos del backend ni del validador.']
    : [
        '| Código | Cantidad | Turnos |',
        '|---|---:|---|',
        ...[...remaining.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([code, turns]) => `| ${escapeCell(code)} | ${turns.length} | ${turns.map(escapeCell).join(', ')} |`),
      ]),
]

writeFileSync(join(results, 'baseline-v3-v4-comparison.md'), `${lines.join('\n')}\n`)
