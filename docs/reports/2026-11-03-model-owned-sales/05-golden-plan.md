# Plan golden — venta interpretada por el modelo (primera corrida natural)

Estado: preparado, NO ejecutado. Las pruebas sin proveedor de este bloque verifican la maquinaria determinista (permisos, hechos, efectos, reparación, persistencia, proyección de contexto, nunca-silencio) con propuestas fijas como ENTRADA; no prueban comportamiento del modelo. Eso lo prueban sólo las corridas golden contra DeepSeek real (AGENTS.md «Terminado»).

## Selección focalizada crítica

`27,28,25,17,10,11`

| Caso | Qué mide |
|---|---|
| 27 Marketing 03/11 (reconstruida) | Conversación en vivo del dueño: descubrimiento, precio informativo, objeción de valor con promo afín, retomar, compra |
| 28 Material de Gabi | «es caro», «lo voy a pensar», título oficial, licencia, testimonio real, bonificado por «Combínalo con» |
| 25 «realtor» | «sí, ese curso» enfoca el único curso nombrado (Aires Acondicionados en el catálogo de eval) |
| 17 Promoción 1→2→3 | Tope de 3, uno por turno, cuarto prohibido, sin llamada forzada |
| 10 Llamada pedida | Permisos de llamada (consentimiento, máx. 2) |
| 11 Compra → link | Checkout: plan + link de pago |

## Comando exacto (no ejecutar hasta que el dueño lo apruebe)

Requisitos: árbol limpio con todo commiteado (sólo se tolera `evals/golden/` modificado), clave en `.eval/.env.local` (`DEEPSEEK_API_KEY=...`, archivo ignorado), puertos libres 55435 (Postgres descartable) y 3217 (backend), sin tocar `.env.local` de producción. El lanzador vacía las credenciales de los `.env*` y usa sólo datos sintéticos locales.

```bash
cd "<worktree agent-a-model-owned-sales>"
SHA7=$(git rev-parse --short=7 HEAD)
STUDYX_GOLDEN_PROVIDER=deepseek \
STUDYX_GOLDEN_PROVIDER_MODEL=deepseek-v4-flash \
STUDYX_GOLDEN_JUDGE_MODEL=deepseek-v4-flash \
STUDYX_GOLDEN_CASE_IDS="27,28,25,17,10,11" \
STUDYX_GOLDEN_RESULT_STEM="natural-${SHA7}" \
node evals/golden/run-local.mjs
```

- Modelo del agente: `deepseek-v4-flash` (oficial; `deepseek-v4-pro` también admitido). Juez: `deepseek-v4-flash` (constante).
- Resultados: `evals/golden/results/natural-<sha>.{json,md}` y auxiliares; el nombre no se puede reutilizar (`GOLDEN_ACCEPTANCE_ALREADY_STARTED`).
- La corrida parcial no acredita los 48 turnos formales; se informa como parcial.
- Los 16 casos formales (`01`–`16`) no forman parte de esta selección: los casos 04, 05, 06, 14 y 16 todavía codifican las Reglas B/C y el texto fijo «El precio es el único inconveniente? Puedo revisar una promoción.» (retirados). Hay que decidir con el dueño si se reescriben antes de una corrida formal.

## Observación base del dueño sobre 12d564b (conversación «Marketing 03/11»)

Transcripción exacta pendiente del dueño; el caso 27 reconstruye el lado del cliente.

Fallos observados (se miden como regresión en el caso 27):
1. Llamada ofrecida prematuramente (`no_call_offer` en todos los turnos salvo petición).
2. Sondeo de precio sobre una pregunta informativa («el precio es el único inconveniente») — turno `informative_price`.
3. Repetición literal de una respuesta anterior al retomar — turno `resume` (`not_repeat_previous_reply` + reparación `REPEATED_AGENT_REPLY` del runtime).
4. Cierre mecánico «?!» fuera de la oferta final/promo.
5. Pérdida del objetivo «trabajar con marcas» en precio/objeción/cierre (semántico).

Aciertos observados (deben conservarse):
1. Identificó Marketing Digital (`selected_course_equals: marketing_digital`).
2. Descubrimiento inicial antes de vender.
3. Publicidad en Redes Sociales como bonificado por afinidad.
4. La promoción se mantuvo al retomar.

Además se mide, sólo como chequeo semántico/duro de la corrida (no como validador de runtime): nunca dos turnos seguidos pidiendo inscripción o plan (`no_consecutive_enrollment_ask`), y la petición de inscripción sólo ante señal de compra (`no_enrollment_ask` antes de ella).

## Hallazgo para decidir

El conjunto autorizado de bonificados es fila de la tabla + puentes universales + curso nombrado por el cliente (AGENTS.md:161). Los «Combínalo con» del manual llegan al modelo en la ficha como argumento, pero no amplían el conjunto: p. ej. para Marketing Digital, Community Manager e Introducción al E-commerce están en el «Combínalo con» y no en la tabla, por lo que el backend rechazaría ofrecerlos. Si el dueño quiere que cuenten como permitidos, es un cambio de código (fuera de este bloque).
