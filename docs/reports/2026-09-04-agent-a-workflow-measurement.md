# Agente A: medición del workflow, 4 de septiembre de 2026

Autor: subagente Codex `measurement`; integración, presupuesto y despliegue a cargo del coordinador. Rama de trabajo: `codex/agent-a-plannerless-v2`. Este informe describe cambios locales sin atribuirles un despliegue. Gasto API del subagente: USD 0; no reinicia el acumulado de campaña informado de USD 0,38.

## Cambios y falsos verdes eliminados

- **Disponibilidad por turno.** Se cruzan `turnId` y decisión persistida. Ya no se restan decisiones silenciosas globalmente. `BRAIN_UNAVAILABLE…`, `responseType=technical_fallback` y el fallback real del backend `EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED` cuentan como fallos aunque haya texto visible. Un link posterior no compensa ese fallo. El último código usa `responseType=clarification`, por eso filtrar sólo por tipo era insuficiente. Una poda parcial que conserva una respuesta válida no se clasifica automáticamente como fallo técnico.
- **Opt-out durable.** El silencio permitido exige decisión del turno, ausencia de error y de acción comercial, y revocación con evento causal persistida antes de la decisión, o bloqueo durable anterior. Una baja posterior no justifica silencios previos. La suite exige `revokedTurnId` del mensaje de baja y comprueba que una consulta posterior permanezca bloqueada. Un acuse auténtico de baja no se confunde con fallback.
- **Entrega local correlacionada.** `recordedLinks` distingue URLs guardadas de `deliveredLinks`. La segunda lista exige mismo outbound autorizado, turno, trace, destino externo, texto exacto e ID retornado por el adaptador, además de estado durable `submitted` o `delivered`. Ni una fila outbound sola ni una captura dirigida a otra conversación alcanzan.
- **Commit comprobado.** Una acción que responde HTTP 200 puede contener `status=rejected`. `commitSucceeded` exige `committed` o `duplicate` para el mismo turno, además de la acción completada.
- **Evidencia completa.** El driver conserva entrada, IDs, salida del adaptador, pasos, errores, configuración no secreta y cada intercambio HTTP de DeepSeek/backend. Se observan requests y responses, nunca headers de autenticación. Los errores HTTP, de transporte y los reintentos de JSON también quedan registrados.
- **Eventos y métricas automáticas.** El driver captura los JSON `studyx.turn.*` de `console.info` exclusivamente para su `traceId`, conserva el destino original del log y restaura el observador en `finally`. Cada reporte deriva `metrics` de `evidence`, `turns`, `conversations` y `cases`; deduplica por traza y hereda la evidencia DB. Incluye intentos de reparación fallidos, indisponibilidad previa al HTTP y latencia de silencios. El replay exige evidencia de la decisión previa; sin DB queda desconocido y sin outbound requiere silencio causal permitido.
- **Simulador del cliente.** Responde explícitamente al pedido de permiso para enviar el link. «Dejarlo registrado» ya no equivale a pedir datos personales; aportar nombre/correo/teléfono por sí solo no agrega autorización.

Archivos principales: `tests/helpers/agent-a-workflow-{driver,db-evidence,measurement,http-evidence,events,metrics,report}.ts`, `tests/helpers/agent-a-adaptive-customer.ts`, las suites `tests/workflow/` y cinco pruebas unitarias nuevas. El runtime de prueba usa timeout/reintentos `8000/250/2000` ms, alineados con los valores de producción revisados por el coordinador. El nombre del asesor sigue vacío y se registra como tal.

## RED y GREEN ejecutados

Las pruebas unitarias no requieren DB, backend ni proveedor:

```sh
npm run test:unit -- tests/unit/agent-a-workflow-measurement.test.ts
npm run test:unit -- tests/unit/agent-a-workflow-http-evidence.test.ts
npm run test:unit -- tests/unit/agent-a-adaptive-customer.test.ts
npm run test:unit -- tests/unit/agent-a-workflow-events.test.ts tests/unit/agent-a-workflow-metrics.test.ts
```

| Iteración | RED observado | GREEN observado |
| --- | --- | --- |
| Silencio, opt-out y entrega: lógica anterior extraída | 19 fallos de 20 | 20/20 |
| Registro de intentos HTTP y fallos | 2 fallos de 2 | 2/2 |
| Consentimiento en cliente adaptativo | 3 fallos de 4 | 4/4 |
| `status=rejected` con HTTP 200 | 1 fallo de 3 | 3/3 |
| Fallback técnico con texto visible | 1 fallo de 22 de medición | 22/22 |
| Fallback real de egress y destino incorrecto | 2 fallos de 24 de medición | 24/24 |
| Captura de eventos por trace | 1 fallo de 1 | 1/1 |
| Métricas con intentos fallidos, silencios y evidencia ausente | 9 fallos de 9 | 9/9 |
| Integración al archivo de reporte; fixtures nunca certifican calidad | 1 fallo de 11 | 11/11 |
| Replay y fallo previo al HTTP; resultado repair desconocido ante error de backend | 2 fallos de 13 y 1 fallo de 14 | 14/14 |
| Replay silencioso/submitted sin evidencia durable suficiente | 2 fallos de 16 | 16/16 |

Ejecución conjunta focal: **46/46** (24 medición, 3 HTTP, 4 cliente, 14 métricas y 1 eventos), 2026-09-04 13:56:19 UTC. La revisión final agregó dos regresiones de replay: último foco métricas/eventos **17/17** a las 13:58:23 UTC; los 31 focales anteriores no cambiaron. Se ejecutaron también typecheck raíz, ESLint focal y `git diff --check`; la verificación global final corresponde al coordinador.

## Workflow real gratuito

Comando usado durante las corridas, con el lanzador aislado preparado por el coordinador:

```sh
node .eval/codex-20260904/run-local.cjs npm exec -- vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-deterministic-outcomes.test.ts
```

El lanzador original era efímero. El coordinador lo reemplazó por el script versionable `scripts/run-agent-a-workflow-lab.mjs`. La invocación reproducible de la suite, una vez provisionado el backend/PostgreSQL local, es:

```sh
node scripts/run-agent-a-workflow-lab.mjs npm exec -- vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-deterministic-outcomes.test.ts
```

El runner fija `STUDYX_EVAL_API_BASE_URL`, `TEST_DATABASE_URL` y credenciales locales de firma coincidentes. En este modo gratuito no carga `.env.local`. Las corridas documentadas usaron backend `127.0.0.1:3217` y PostgreSQL `127.0.0.1:55435`; el driver rechaza destinos remotos y teléfonos que no comiencen con `+999`. El proveedor es una fixture HTTP y cualquier otra frontera externa queda rechazada. Para las corridas pagas, exclusivamente a cargo del coordinador, `--paid` carga sólo la clave DeepSeek de `.eval/.env.local` y exige el ledger acumulado existente `campaign-budget-20260904.json`; `scripts/agent-a-api-budget.mjs` reserva presupuesto antes de cada HTTP y registra intentos con o sin usage. Ese wrapper controla el límite de USD 1; no habilita un presupuesto nuevo.

La primera corrida obtuvo **1/2**: descubrió que omitir `call_offer` —campo opcional— se interpretaba como oferta y provocaba `CALL_BUDGET_EXHAUSTED` tras elegir chat. El coordinador corrigió el runtime con RED/GREEN propio. La fixture y su frase se conservaron. Dos corridas siguientes obtuvieron **2/2**, la última tras endurecer la validación de commit, en aproximadamente 12 segundos.

Cobertura observada: selección y cambio de curso; preferencia chat; plan persistido; teléfono declarado separado del sintético; plan más datos sin permiso sin link; postergación sin link; autorización posterior con entrega correlacionada de un solo link; replay del mismo evento sin nueva llamada al modelo ni salida del adaptador; aviso de pago persistido; baja causal y consulta posterior bloqueada. La segunda prueba inyecta HTTP 503 y exige explícitamente un fallo de disponibilidad aunque el workflow complete un commit silencioso seguro.

Los ajustes finales del contador, metadata, métricas y paridad de timeouts se verificaron con focales gratuitas. **La corrida final contra build de producción y su manifiesto están referenciados en el informe candidato del coordinador, en preparación; los reportes siguientes pertenecen a la ejecución de desarrollo precedente.** Este subagente no ejecutó llamadas live; las fixtures no pueden certificar p95 del modelo real ni transformar 0/0 reparaciones en éxito.

## Reportes conservados

Directorio: `botpress-agent/evals/results/`. Cada archivo nuevo tiene fecha, UUID y `run_id`; se escribe con creación exclusiva. Los reportes históricos `*-latest.json` no se sobrescriben. Los turnos y checkpoints se guardan antes de las aserciones, por lo que también quedan las corridas fallidas.

- RED del fallo `call_offer`: `workflow-deterministic-checkpoint-2026-09-04T13-37-10-807Z-5e35f217-4bd7-4e79-8031-c75996bbd298.json`.
- Último recorrido completo documentado: `workflow-deterministic-outcomes-2026-09-04T13-41-03-146Z-79e50dfb-31a1-4475-a9a7-92c4beef15d4.json`.
- Inyección HTTP 503: `workflow-deterministic-unavailable-2026-09-04T13-41-04-195Z-dc600e74-53c6-4550-be96-7483cbbc1726.json`.
- Logs de ejecución originales: `/tmp/studyx-deterministic-measurement-20260904.log`, y variantes `-r2.log` y `-r3.log`; son temporales, no artefactos versionados.

## Cómo reconstruir uso, latencia y reparación

1. Elegir un reporte de conversación o deduplicar archivos `workflow-turn-*` por `traceId`. Un mismo turno está repetido dentro de varios checkpoints: sumar todos los JSON del directorio duplicaría costos. Separar fixtures de llamadas reales (`providerMode` en reportes nuevos; `provider=fixture` en agregados anteriores).
2. Por turno, recorrer **todos** los `httpExchanges` con `boundary=deepseek`, incluso HTTP 200 con JSON inválido, HTTP no exitoso y errores de red. Sumar `responseBody.usage.input_tokens`, `output_tokens` y, cuando esté disponible, `input_tokens_details.cached_tokens` una vez por intercambio. El usage ausente es **desconocido**, no cero. Una solicitud fallida puede haber consumido tokens; el acumulado facturado requiere contraste externo o una reserva conservadora del coordinador.
3. Extraer el JSON de `<authorized_context>` en `requestBody.instructions`. Las solicitudes con `turn_rejection` pertenecen a una reparación semántica; agrupar por `rejection_id`. Dos intentos HTTP con el mismo contexto pueden ser reintentos de parseo dentro de una sola reparación. `steps` conserva `repair-agent-a-turn-proposal-v2` aunque luego esa llamada falle. El request original y las respuestas del proveedor permiten comparar propuesta inicial y reparada; el request `/decision`, su resultado y DB muestran la propuesta comprometida y la salida efectiva.
4. Para éxito de reparación, no usar «hubo respuesta visible»: el resolver puede conservar o podar una propuesta inicial después de fallar la reparación. Los reportes nuevos guardan `workflowEvents`, incluido `studyx.turn.agent_a_plannerless_v2` (`repair_attempted`, `repaired`, `rejection_codes`). Sólo `repaired=true` confirma éxito. Un evento negativo o fallback inequívoco confirma fracaso; si falta resultado y sólo hay error genérico de backend, el resultado queda desconocido. El intento nunca se excluye del denominador. Sin intentos, o con resultados de repair desconocidos, `repair_success_rate=null`; la ausencia de muestra no se convierte en cero ni en éxito.
5. `evidence.elapsedMs` mide el handler completo, con batching, reintentos, modelo, validación, commit, envío y reporte local. Cada intercambio también tiene `elapsedMs`. La suma HTTP sirve para costo temporal de fronteras; no sustituye la latencia completa. La observación añade lectura de cuerpos clonados, y esta latencia local no incluye scheduler ni red de Telegram.

El sumarizador calcula gates de tres estados (`true`, `false`, `null` por evidencia insuficiente): p95 < 6000 ms, repair rate ≤ 5 %, repair success ≥ 80 %, fallback rate ≤ 2 % y cero fallos de disponibilidad. P50/p95 usan todos los turnos elegibles del modelo, incluidos los fallidos y silenciosos; la elegibilidad no depende de terminar con respuesta. `numeric_gates_passed` es `false` si algún gate falla y `null` si faltan datos sin un fallo ya probado. En todos los casos `quality_ready`, `production_ready` y `stability_certified` son `false`: esos certificados requieren evidencia adicional a las métricas de esta muestra.

**Lectura correcta del resultado:** Vitest sigue afirmando contratos funcionales; los umbrales calculados se reportan separadamente y no se convierten en aserciones automáticas que una fixture pueda presentar como calidad real. El presupuesto se controla por el wrapper del coordinador. No corresponde afirmar estabilidad, naturalidad o latencia real por un verde funcional ni por métricas de proveedor simulado. `deliveredLinks` acredita entrega al adaptador local con submission durable; Telegram requiere una prueba visible de canal separada y no se inventa un acuse remoto. La ausencia de muestreo live permanece explícita hasta la evaluación centralizada autorizada.
