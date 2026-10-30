# Agent A golden baseline — corrida bloqueada

- Base: `028f272fc3a6f6dc4806d19b251564169b55e6d6`
- Estado: **BLOQUEADA ANTES DE EJECUTAR**
- Producción/Vertice usados: **no**
- Causa: `DEEPSEEK_API_KEY_MISSING`

No había una clave de DeepSeek de evaluación en el entorno ni en
`.eval/.env.local`. Vercel Preview confirmó que la variable existe como
`Sensitive`, pero no permite extraer su valor. El runner se detuvo antes de
iniciar PostgreSQL, crear contactos o llamar al modelo.

La especificación, el juez y los extractores pasaron 10/10 pruebas; ESLint y
TypeScript también pasaron. Las dos pruebas en vivo sólo se habilitan desde el
lanzador aislado y no se ejecutaron sin la clave.

Por eso no se publica una tabla inventada de aprobados/fallidos. Al ejecutar
`node evals/golden/run-local.mjs` con una clave local válida, la suite genera
automáticamente `baseline-028f272.json` y `baseline-028f272.md` con la tabla por
caso y turno, citas de autoridad, respuesta real, move, acción, rechazos del
backend e hipótesis de capa.
