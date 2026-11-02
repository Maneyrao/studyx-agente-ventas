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

La invitación temprana se prueba con su diálogo y turno de origen, ordinal 2/3 registrado por
la regla, recibo de commit, contador persistido y entrega local del texto exacto de `call_offer`.
El caso 17 admite esa invitación ya realizada; no exige repetirla en el tercer turno. El caso 18
mantiene el requisito de `call_offer` en el turno actual, porque ahí coinciden A y B. Un contador
positivo sin ese recibo y esa entrega, una invitación de otro diálogo o una posterior a la tercera
respuesta no satisfacen el check.

El juez semántico recibe en todos los casos el estado y recibo del turno anterior, la comparación
exacta de miembros del paquete anterior/actual y el próximo curso decidido por el backend en el
contexto de generación. Así puede distinguir recordar un miembro vigente de prometer uno nuevo,
y primero/segundo/tercer escalón sin inferirlo sólo de la prosa. No se sustituyen ni se fuerzan sus
veredictos; una promesa nueva sin efecto sigue siendo un fallo aunque no cambie el ledger.

Si una reparación final del backend sustituye el candidato, se observa el último evento de
reglas correspondiente al turno y trace del recibo comprometido, contrastando la identidad
del efecto con la propuesta de ese recibo. Los eventos y borradores anteriores permanecen en
la evidencia cruda. El runtime no emite un hash de propuesta en ese evento: la correlación
usa turno, trace, último recibo exitoso e identidad del bonificado; sin commit o con identidad
incompatible no se declara un outcome válido.

## Primera campaña real y correcciones del evaluador

La campaña `owner-rules-0fa6bce-20261102T134433Z`, sobre runtime `0fa6bce`, ejecutó 14 turnos:
8 aprobados y 6 fallidos, ambos casos fallidos. Hubo 33 llamadas HTTP 200 (19 agente y 14 juez),
366.183 tokens de entrada, 7.847 de salida y 172.288 de entrada cacheados; sin usage ausente.
El intento anterior `134345Z` terminó al iniciar PostgreSQL por IPC bloqueado en sandbox, antes
de cualquier llamada a modelos. La repetición autorizada necesitó permisos IPC locales.

Se conservaron íntegros los reportes y observaciones originales de `0fa6bce`. Esa campaña reveló
dos defectos del evaluador: exigir de nuevo la invitación ya entregada, y no mostrar al juez el
ledger anterior, haciendo que confundiera un recordatorio del paquete con una nueva oferta.
También reveló defectos reales del runtime: faltaban los datos de Ecommerce cuando no había
sido nombrado por el agente anterior, y algunas escaladas omitían la recapitulación de cursos
previos. Las correcciones del evaluador no convierten esos fallos reales en aprobados. Se requiere
una nueva campaña completa con el SHA revisado que incluya las correcciones del runtime.

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
