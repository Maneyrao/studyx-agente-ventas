# Agent A authority golden baseline

Esta suite fija el comportamiento esperado exclusivamente desde `AGENTS.md` y
`docs/authority/`, sin modificar prompt, brain, políticas, validadores ni
backend.

## Qué ejecuta

- Las 16 conversaciones de `scenarios.ts` atraviesan
  `processInboundTurn`, el workflow real del repositorio.
- El backend y PostgreSQL corren en loopback sobre `127.0.0.1`; los teléfonos
  son sintéticos (`+999`).
- El modelo y el juez usan DeepSeek real. No hay respuestas del modelo escritas
  a mano.
- Cada turno conserva propuesta original, reparaciones, respuesta entregada,
  move, acción propuesta, acción materializada, rechazos y estado persistido.
- El juez estructural controla acciones/estado/hechos. El juez semántico recibe
  los requisitos del turno y los rangos exactos de autoridad.
- El caso de pago prepara en la base desechable un pago `paid`, dos cursos
  bonificados y un alta completa mediante el worker real con la frontera de la
  Central sustituida por una respuesta local controlada. Nunca toma un “pagué”
  del cliente como prueba.

## Corrida aislada

La clave se pasa sólo en memoria o desde el archivo ignorado
`.eval/.env.local`:

```bash
DEEPSEEK_API_KEY=... node evals/golden/run-local.mjs
```

El lanzador se niega a correr si:

- `028f272fc3a6f6dc4806d19b251564169b55e6d6` no es ancestro o hay cambios
  desde esa base fuera de `evals/golden/`;
- los puertos desechables ya están ocupados;
- falta la clave de evaluación;
- la base o el backend no son locales.

Además, vacía cualquier variable encontrada en los `.env*` del repositorio y
vuelve a incorporar únicamente una allowlist local. Así ninguna credencial de
WhatsApp, Stripe, Retell, Google Sheets, Central, producción o Vertice entra en
la campaña.

Los resultados auditables se escriben en:

- `evals/golden/results/baseline-028f272.json`
- `evals/golden/results/baseline-028f272.md`

Los reportes HTTP detallados del workflow quedan en
`evals/golden/results/runtime/` y están ignorados por Git.
