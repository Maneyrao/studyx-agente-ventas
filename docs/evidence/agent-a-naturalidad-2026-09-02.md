# Agente A — naturalidad comercial (2026-09-02)

Rama `codex/agent-a-chanl-evals`, base `7f12651`. Suite
`studyx-agent-a-conversational-baseline`, 20 casos, transporte local, modo
`--repair` (context scoping + reparación + V5), proveedor DeepSeek.

## Antes (corridas de referencia)

| corrida | funcional | superficie | p95 | >6 líneas | repetidos |
|---|---|---|---|---|---|
| final-candidate-1 | 20/20 | 6/20 | 4327 ms | 14 | 4 |
| final-variance-1 | 20/20 | 7/20 | 4235 ms | 14 | 3 |
| final-variance-2 | 20/20 | 12/20 | 4191 ms | 11 | 1 |

Calidad conversacional independiente: **7/20** sobre `final-variance-2`. Nunca
se había medido: el runner llamaba a la rúbrica con la lista de notas vacía y
no existía forma de cargarlas, así que `conversation_quality_passed` era 0 en
todas las corridas históricas.

## Después (validación final, `final3-1/2/3`)

| corrida | funcional | superficie | p50 | p95 | silencios | promesas falsas | reparación | gates |
|---|---|---|---|---|---|---|---|---|
| final3-1 | 20/20 | 18/20 | 3531 ms | 4220 ms | 0 | 0 | 1.1% / 100% | ✅ |
| final3-2 | 20/20 | 20/20 | 3535 ms | 4490 ms | 0 | 0 | 1.1% / 100% | ✅ |
| final3-3 | 20/20 | 18/20 | 3655 ms | 4451 ms | 0 | 0 | 1.1% / 100% | ✅ |

`>6 líneas`: 0 en las tres. Paridad del ledger de llamadas: correcta en las tres.

Calidad conversacional independiente: **6/20** (`final3-2`), **10/20** (`rc-1`,
mismo código salvo el último commit). Requerido: 18/20.

## Causas corregidas

1. Un párrafo por hecho canónico y otro por la oferta de llamada. 32 de 41
   fallas de superficie eran eso. → presupuesto de tres párrafos, enumeración
   en línea, oferta pegada al próximo paso.
2. Supresión de redundancia por coincidencia literal: una descripción
   parafraseada se volvía a pegar textual. → comparación por contenido.
3. Compositor sin historia: mismo objetivo + mismos hechos ⇒ mismo texto.
   → `<last_agent_reply>` y regla de continuidad, en el compositor del ADK y en
   el cerebro que mide la matriz.
4. La poda resolvía hacia el mensaje anterior sin reparar nunca. → V8 rechaza
   el borrador repetido y la poda deja de ser resolución válida.
5. `confirm_current_state` no materializaba ningún hecho: el estado sabía el
   plan y el turno no podía nombrarlo. → se piden curso y opciones de pago.
6. El turno del link no autorizaba nombrar el plan que él mismo enviaba, y su
   reparación fallaba siempre. → se materializan las opciones de pago.
7. `{{nombre}}` sin completar llegaba al chat. → se quitó el slot del prompt.

## Abierto

- **Calidad conversacional 6–10/20 contra 18 requerido.** El residuo se
  concentra en `listening_context` y `turn_continuity`: el agente no sigue lo
  que la persona ya dio o ya preguntó.
- **Afirmaciones de estado falsas que el detector no atrapa**: "quedó
  registrado tu apellido y teléfono", "ya tengo todos tus datos registrados",
  "con eso ya tengo todo para dejarlo registrado" — todas con el intake
  incompleto. V5 tiene un solo patrón para esta clase (`registr|guard|anot|tom`
  + `datos`) y estas variantes no lo matchean.
- **"Registré tus datos." se entregó dos veces** con el intake incompleto y con
  `agent_a_state_assertions: true` reportado en el claim del mismo turno. El
  hash del mensaje coincide con `committed_response_hash`, y dos tests nuevos
  prueban que el camino del commit la borra. No se pudo reconciliar desde los
  artefactos: falta una corrida que registre el flag tal como lo lee el commit.
- **Timeouts de DeepSeek** (`BRAIN_DEEPSEEK_TIMEOUT`, ~11 s) tiraron una corrida
  de 20 a 17. Causa externa, sin silencios ni promesas falsas.
