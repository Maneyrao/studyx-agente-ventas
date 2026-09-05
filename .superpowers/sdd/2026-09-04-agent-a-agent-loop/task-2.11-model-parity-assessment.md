# Evaluación acotada — autoridad del modelo de Agent Loop V3

Fecha: 2026-09-05

Snapshot committed revisado: `1b452523a6605d440921a9781e356cb61078c16f`

Alcance: únicamente el P2 de `task-2.11-2.12-final-review.md` sobre la divergencia posible entre `configuration.agentABrainDeepSeekModel` en Botpress y `DEEPSEEK_MODEL` al generar el release manifest. Los cambios sin commit de Task 2.13/2.14 presentes en la worktree compartida se excluyeron.

## Veredicto

**El P2 es válido y debe cerrarse en Fase 2.** El rollout V3 apagado evita que hoy cause una decisión o efecto de V3 en producción, por lo que no es un incidente activo ni un P1 operativo. Sin embargo, `off` no convierte en verdadera una identidad de release potencialmente falsa. Antes de entrar en shadow local de Fase 3, el modelo que puede ejecutar el request debe tener una única autoridad verificable.

La spec exige este cierre en Fase 2 por tres razones concretas:

1. §3.9 exige que cada turno persista `provider` y `model` dentro del manifiesto y que esa evidencia permita saber qué prompt/modelo corrió. Task 2.11 pertenece expresamente a “Fase 2 — Núcleo, herramientas y commit”; no es una observación diferida a producción.
2. §1.5 y Fase 1 validaron una combinación concreta: `deepseek-v4-flash` + `/responses` + el contrato de tools. Cambiar sólo una de las dos configuraciones permite ejecutar una combinación que no pasó ese smoke y conservar un manifiesto que afirma otra.
3. Fase 2 debe terminar con el loop construido y probado pero apagado. El apagado es el mecanismo de contención mientras se construye; no sustituye los contratos necesarios para habilitar `shadow` o `authoritative`.

La consecuencia práctica es acotada: este finding no bloquea la ruta actual `plannerless_v2` mientras V3 siga en `off`, pero sí es un gate previo a cualquier fila `shadow` o `authoritative`.

## Evidencia del doble origen

- Botpress declara `agentABrainDeepSeekModel` como cualquier string no vacío, con default `deepseek-v4-flash` (`botpress-agent/agent.config.ts:29`). Por lo tanto, `deepseek-reasoner` u otro identificador pasa el esquema.
- El workflow pasa ese valor a la primera generación y a ambas rutas de reparación (`botpress-agent/src/workflows/processInboundTurn.ts:646-648`, `:701-703`, `:789-791`). `generateDeepSeekAgentATurnProposalV1` lo recorta y lo escribe en `body.model` (`botpress-agent/src/lib/conversation/agent-a-brain.ts:142` y request posterior).
- El manifest toma el modelo de otro proceso y otra clave: `environment.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'` (`scripts/generate-release-manifest.mjs:175`). `createReleaseManifest` y `parseReleaseManifestV1` sólo exigen un string no vacío; no lo comparan con Botpress.
- `prompt_sha256` no cubre el modelo. `modelPromptSha256V3` canoniza instrucciones, conversación, tools y `force_final`, pero no una identidad de provider/model (`agent-core/src/loop.ts:190-214`). La corrección ya integrada del SHA por turno, por sí sola, no detecta este caso.
- Diagnostics compara paridad de hashes de prompt, no de modelo (`src/app/api/diagnostics/route.ts:35-108`). Un prompt puede dar `match` aunque el request haya usado otro modelo.
- Los tests vigentes usan el mismo valor feliz en ambos lados: `release-manifest-agent-loop.test.ts` fija `DEEPSEEK_MODEL='deepseek-v4-flash'`, y los stubs Botpress fijan `agentABrainDeepSeekModel='deepseek-v4-flash'`. No existe un caso cruzado con valores distintos.

Un probe puro, sin red, generó un manifest con `DEEPSEEK_MODEL=deepseek-reasoner` mientras la autoridad Botpress permanecía en su default. El resultado fue:

```json
{
  "botpress_default": "deepseek-v4-flash",
  "manifest_model": "deepseek-reasoner",
  "mismatch": true
}
```

La variante inversa también es admitida por el código: Botpress puede configurarse como `deepseek-reasoner` mientras el manifest conserva `deepseek-v4-flash`.

## Qué demuestra que V3 esté apagado

Hoy no hay composición productiva de `runAgentTurnWithIntegrityV3`: fuera de tests, `rg` sólo encuentra su definición. En `processInboundTurn`, `agent_loop_v3_mode` se normaliza por el kill switch y se registra, pero todavía no selecciona un provider V3. Por eso no existe un turno V3 real al que atribuirle este mismatch.

Esta ausencia reduce la urgencia operativa y explica la prioridad P2. También fija el momento de corrección: ahora, antes de que el primer caller productivo haga que la divergencia deje de ser hipotética. Esperar a Fase 3 permitiría que el primer shadow ya mida una combinación distinta de la validada.

## Cambio mínimo recomendado

La spec ya fija `deepseek-v4-flash` como la combinación validada. El cambio más pequeño y verificable es convertir ese identificador en una constante versionada única para V3 y hacer que las dos entradas actuales sólo puedan confirmar esa autoridad:

1. Extraer `deepseek-v4-flash` a un módulo pequeño y sin dependencias dentro de `botpress-agent/src/`, usado por `agent.config.ts`, el Brain y el futuro adapter V3.
2. Cambiar `agentABrainDeepSeekModel` de `z.string().min(1)` a un literal de esa constante, o retirar el campo de la selección V3. Esto preserva el valor desplegado actual y hace que cambiar de modelo requiera un cambio de release y repetir el smoke de Fase 1.
3. Hacer que `generate-release-manifest.mjs` lea esa constante versionada del mismo modo en que ya lee `AGENT_A_BRAIN_PROMPT_VERSION`, y rechace `DEEPSEEK_MODEL` si no coincide. El manifest persiste la constante validada; la variable deja de ser una segunda autoridad silenciosa y pasa a ser un preflight explícito.
4. Mantener `commit-agent-turn-v3.ts` fuera de este cambio. La corrección cabe en configuración/generación y sus tests, por lo que no se solapa con el commit de efectos de Task 2.13.

No recomiendo resolverlo eligiendo silenciosamente uno de los valores en runtime: escondería un release mal configurado y podría ejecutar un modelo que no pasó el smoke. Tampoco hace falta agregar una nueva máquina de estados ni ampliar diagnostics para cerrar este contrato; el build/config parse debe fallar antes del primer request V3.

Si se decide conservar selección dinámica de modelos en el futuro, ya no alcanza este fix literal: el resultado del provider tendrá que transportar la identidad efectiva y compararse con el manifest antes del commit. Eso es una capacidad posterior, no necesaria para el contrato actual que especifica un solo modelo.

## Caso adversarial mínimo

Agregar un test de contrato local, sin fetch real, con tres ramas:

```text
1. Botpress agentABrainDeepSeekModel=deepseek-reasoner,
   release DEEPSEEK_MODEL=deepseek-v4-flash
   => configuración Botpress rechazada antes de generate().

2. Botpress usa deepseek-v4-flash,
   release DEEPSEEK_MODEL=deepseek-reasoner
   => generateReleaseManifest rechaza RELEASE_MANIFEST_MODEL_MISMATCH.

3. Ambos declaran deepseek-v4-flash
   => el body capturado por fetch mock y manifest.model son exactamente iguales.
```

Las dos ramas negativas deben afirmar cero llamadas al provider/`fetch` y cero intentos de commit. La positiva debe capturar `body.model`, no limitarse a comparar defaults o fixtures. Así el test falla si cualquiera de las dos autoridades vuelve a aceptar un override independiente.

Archivos sugeridos, sin tocar el alcance de Task 2.13:

- nuevo módulo de identidad de modelo en `botpress-agent/src/`;
- `botpress-agent/agent.config.ts`;
- `botpress-agent/src/lib/conversation/agent-a-brain.ts` o el futuro adapter V3;
- `scripts/generate-release-manifest.mjs`;
- tests de configuración/manifest y un contrato cruzado con fetch mock.

## Verificación gratuita

```text
npx vitest run --config vitest.config.mts \
  tests/unit/agent-core/release-manifest.test.ts \
  tests/unit/scripts/release-manifest-agent-loop.test.ts \
  tests/unit/botpress/agent-a-brain.test.ts
# PASS: 3 archivos, 60/60 tests

probe puro generateReleaseManifest con modelos divergentes
# PASS del adversarial: mismatch=true; ninguna llamada de red

npx tsc --noEmit                         # PASS sobre archive de HEAD
(cd agent-core && npx tsc --noEmit)     # PASS sobre archive de HEAD
```

El primer `tsc` lanzado directamente en la worktree compartida encontró un `randomUUID` todavía no importado en una modificación sin commit de `agent-loop-prepare-crash.test.ts`. Se repitió sobre un archive limpio del HEAD committed y pasó; esa edición concurrente pertenece al follow-up de Task 2.13/2.14 y no afecta este ruling.

No se usaron APIs, DB local o remota ni despliegue.
