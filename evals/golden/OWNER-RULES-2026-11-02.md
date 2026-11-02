# Reglas A/B: golden suplementario y replay del dueño

## Alcance y autoridad

El plan del dueño agrega dos conversaciones, citadas contra el prompt de Gabi y las excepciones
expresas de `AGENTS.md` del 2/11. No se modifican los documentos de autoridad.

- `17_owner_marketing_ecommerce_ladder`: presupuesto/marketing, invitación temprana de llamada,
  Ecommerce con duración autorizada en el mismo turno, bonificación por precio como único freno,
  tres cursos de la tabla y rechazo de un cuarto.
- `18_explicit_promotion_request`: un pedido de promoción sin objeción no habilita un regalo;
  precio como único freno dispara A en la segunda respuesta mientras B exige `call_offer` en el
  mismo turno; negación y pregunta no escalan, una nueva objeción clara sí.
- `19_owner_conversation_replay_20261102`: los 11 mensajes reales del informe de diagnóstico
  se vuelven a enviar como entradas de cliente a un contacto sintético. Las respuestas se generan
  de nuevo con DeepSeek; nunca se reproducen respuestas históricas como si fueran nuevas.

`owner-conversation-2026-11-02.ts` conserva la ruta y SHA-256 del informe de origen, el SHA/backend,
brain y prompt históricos, y sólo las entradas del cliente. Los mensajes de cada ráfaga se unen
con saltos de línea; se conserva el orden, pero no se simula la temporización ni concurrencia
de las ráfagas originales. No se usan teléfonos ni identificadores reales.

## El criterio formal sigue intacto

`GOLDEN_CASES` conserva exactamente las 16 conversaciones y 48 turnos originales.
`absoluteGoldenAcceptanceV1` sigue exigiendo al menos 41 aprobados, los críticos 07/10/11/12/15
aprobados y ninguna evaluación de negociación desconocida. `comparison.ts` no se modifica.

Los casos 17/18 y el replay 19 son campañas suplementarias de selección explícita. Su resultado
no puede reemplazar la aceptación formal ni aumentar su numerador. La corrida predeterminada
sigue ejecutando sólo los 16 casos formales.

Las verificaciones de negociación se versionan por la evidencia capturada:

- `required_price_objection_count=3`: se conservan las verificaciones históricas de tres fuentes
  previas y llamada para replays archivados.
- `required_price_objection_count=2`: se aplican exclusivamente las excepciones A/B del dueño.
  La objeción actual cuenta sólo con cita literal en la propuesta comprometida y memoria persistida;
  una marca `eligible=true` o una pista léxica no constituyen evidencia suficiente. El precio como
  único freno confirmado no exige llamada previa. Siguen vigentes hechos, precio, afinidad,
  recapitulación, cierre, máximo tres, un curso por turno, cancelación al cambiar curso y no silencio.

La observación del turno usa la propuesta de la solicitud al backend que obtuvo un recibo
`committed`/`duplicate`, no el último borrador del modelo. Esto distingue correctamente un respaldo
fijo autorizado de un borrador que no presentó la oferta. `model_attempts` conserva todos los
borradores y reparaciones originales. Una propuesta rechazada no cuenta como efecto ejecutado.

## Comandos

Primero debe estar revisado y commiteado el candidato de runtime: el lanzador conserva el guard
que prohíbe evaluar runtime sucio y archivos runtime sin seguimiento. No se deshabilitan guards.
La clave se lee exclusivamente desde el archivo ignorado `.eval/.env.local` (`DEEPSEEK_API_KEY`).
No se imprime ni se copia a reportes.

Verificación offline del evaluador, sin proveedor:

```bash
npx vitest run --config evals/golden/vitest.config.mts
```

Después de reemplazar `SHA-UTC` por la identidad única de esta ejecución:

```bash
STUDYX_GOLDEN_PROVIDER=deepseek STUDYX_GOLDEN_RESULT_STEM=formal-SHA-UTC node evals/golden/run-local.mjs
STUDYX_GOLDEN_PROVIDER=deepseek STUDYX_GOLDEN_CASE_IDS=17,18 STUDYX_GOLDEN_RESULT_STEM=owner-rules-SHA-UTC node evals/golden/run-local.mjs
STUDYX_GOLDEN_PROVIDER=deepseek STUDYX_GOLDEN_CASE_IDS=19 STUDYX_GOLDEN_RESULT_STEM=owner-replay-SHA-UTC node evals/golden/run-local.mjs
```

Cada comando inicia su propia base desechable en `127.0.0.1:55435` y backend en `127.0.0.1:3217`;
deben ejecutarse de forma secuencial. El runner y el juez usan DeepSeek oficial real. Las fronteras
de WhatsApp/Botpress Cloud y proveedores operativos quedan sustituidas por adaptadores locales.
Esta evidencia prueba el workflow real con modelo real en staging local aislado; no prueba el
scheduler ni el bundle de Botpress Cloud y debe complementarse con verificación del despliegue.

Los resultados, intentos del proveedor, observaciones y evidencia durable se guardan con el stem
único en `evals/golden/results/`; los archivos históricos no se sobrescriben. La salida exitosa
de Vitest significa que produjo el reporte, no que el comportamiento fue aprobado: inspeccionar
`absolute_acceptance.approved` en la formal, y cada `cases[].approved` en suplementos/replay.
No informar éxito con evaluaciones `null`, errores de ejecución o turnos ausentes.
