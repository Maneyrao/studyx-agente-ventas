# Agente A: candidato verificable del 4 de septiembre

**READY_FOR_LOCAL_REVIEW.** Se corrigieron falsos verdes y causas reproducidas de fallos conversacionales, y se verificó el recorrido por `processInboundTurn`, backend de producción local y PostgreSQL aislado. **No está READY_FOR_SUPERVISED_TELEGRAM ni certificado en producción**: falta evaluar el modelo real con una clave local utilizable, autorizar la migración remota y cerrar la recuperación del bundle anterior de Botpress.

Branch `codex/agent-a-plannerless-v2`; checkpoint recibido `ad15baafb63e8c55cb877f943a74e57c2899deda`, limpio al comenzar. No había cambios posteriores. El commit que incorpora este informe y `evidence/2026-09-04-agent-a/manifest.json` es el candidato; el manifiesto congela hashes de fuentes, prompts, esquema, catálogo, builds y reportes sin una referencia circular a su propio commit. El recibo local `.eval/codex-20260904/candidate-commit.json` y la entrega de la tarea registran el SHA final.

## Qué quedó corregido

- La indisponibilidad del modelo sigue produciendo una salida segura cuando corresponde, pero se cuenta como **fallo de atención**. La medición cruza turno, decisión, error y evidencia de bloqueo; una baja posterior no justifica un silencio anterior. Un fallback técnico con texto tampoco pasa como atención normal.
- Un link se considera entregado localmente sólo si coinciden autorización, turno/trace, destinatario, contenido, ID del adaptador y estado durable de entrega. Se separa `recordedLinks` de `deliveredLinks`. HTTP 200 con commit rechazado no pasa como commit exitoso.
- El validador obligaba a pedir datos pendientes incluso ante una postergación o pregunta distinta. Ahora el intake pendiente no desplaza la intención actual. La traza histórica no conservaba el rechazo original; se reprodujo y corrigió gratuitamente este mecanismo, sin atribuirle una causa de proveedor que no quedó registrada.
- `call_offer` es opcional: su ausencia se interpretaba como oferta y causaba `CALL_BUDGET_EXHAUSTED` después de elegir chat. El workflow determinístico reprodujo ese fallo antes de la corrección.
- Elegir plan guarda la elección, sin autorizar un link. Una solicitud explícita puede conservar permiso durante intake pendiente; postergar, rechazar compra o cambiar la selección lo revoca. Cambiar curso descarta el plan anterior. Elegir chat mantiene un permiso de intake válido sin volver a ofrecer llamada.
- Se bloquean promesas de notificación futura no materializadas, incluso atribuidas condicionalmente al equipo. Los guards comerciales eliminan becas/descuentos no autorizados y nombres de cursos inventados en los patrones cubiertos. El dedupe conserva prosa útil, pero retira anuncios de un nuevo envío que no ocurrió.

DeepSeek mantiene la interpretación y redacción; el backend valida hechos, consentimiento y efectos. No se reintrodujo el planner ni un repertorio de respuestas comerciales. Brain pasa a **v14**; el prompt canónico **v4 completo queda sin cambios**. Los detectores de texto siguen teniendo límites léxicos: las pruebas no demuestran comprensión universal.

## Evidencia funcional y gates

| Comprobación | Resultado observado | Alcance |
| --- | --- | --- |
| `npm run test:coverage` | 2.428 passed, 7 skipped, 7 todo; 172 archivos passed, 2 skipped | Unitarias y contratos; incluye RED/GREEN nuevos. Corrección final del borde de métricas verificada además en focales. |
| Integración completa | 353 passed, 1 skipped, 42 archivos | PostgreSQL real aislado; los 11 fallos originales fueron clasificados y resueltos. |
| Workflow determinístico | 2/2 | Diez entradas comerciales, replay y una conversación de fallo 503; modelo fixture, no muestra de naturalidad. |
| Lint y typecheck raíz | Exit 0 | Árbol del candidato. |
| Typecheck / check / build Botpress | Exit 0 | ADK 2.0.5; bundle identificado por hash. |
| Next build | Exit 0 | Build de producción usado por el backend local. |
| Diff check y revisión separada | Sin bloqueantes materiales pendientes al cerrar | Revisión de guards, consentimiento, medición y presupuesto; no sustituye evaluación live. |

Coverage está configurado **sólo para `src/lib/heuristics`**: statements 98,64 %, branches 87,30 %, functions/lines 100 %. No es cobertura de todo el backend ni del Agente A. Las omisiones y TODO permanecen explícitos. No se modificaron migraciones en esta campaña; el laboratorio usa el script nativo existente, incluyendo sus adaptaciones locales de compatibilidad, y no certifica una ejecución de toda la cadena remota.

La transcripción completa nueva está en [evidence/2026-09-04-agent-a/transcripts.md](evidence/2026-09-04-agent-a/transcripts.md). Los JSON comprimidos conservan propuestas antes de validación, texto enviado, HTTP, eventos de reparación, capturas y DB. El manifiesto identifica todas las corridas determinísticas completas y la corrida fallida inicial; no se borraron los reportes anteriores ni se eligió únicamente una corrida favorable.

El recorrido demuestra cambio de curso, chat persistido, plan, teléfono declarado separado del `+999`, ausencia de link sin permiso y durante postergación, un solo link de seis cuotas tras solicitud explícita, replay sin nueva salida/modelo, aviso de pago y baja causal con turno posterior bloqueado. El escenario 503 registra disponibilidad fallida aunque se complete un commit silencioso seguro. Ese test aprueba precisamente porque **detecta el fallo**, no porque el cliente haya sido atendido.

Las métricas nuevas deduplican trazas y contabilizan todos los intentos HTTP, incluidos reintentos y fallos. Capturan los eventos del workflow por trace; no infieren éxito de repair sólo de que haya texto. Sin muestra de reparación, su éxito queda `null`. p50/p95 incluyen turnos elegibles silenciosos; el usage ausente es desconocido. Las métricas locales de fixtures no certifican latencia del proveedor, scheduler Cloud ni Telegram. Los JSON mantienen `quality_ready=false`, `production_ready=false` y `stability_certified=false`.

## Naturalidad y presupuesto

El [revisor independiente](2026-09-04-agent-a-existing-transcript-review.md) calificó **41 transcripciones existentes, 167 turnos** con ocho dimensiones V2 y relevancia adicional, citas y hashes. Doce conversaciones usan el workflow real; las otras 29 vienen del runner histórico y no certifican este workflow. Encontró silencios en postergaciones, links sin permiso explícito, promesas futuras y repetición. No se presenta esa revisión de v13 como aprobación del candidato v14 ni se puntúan fixtures como salida natural del modelo.

La validación nueva `tests/workflow/agent-a-heldout-conversations.test.ts` conserva paráfrasis separadas de los escenarios de ajuste y está preparada, **sin ejecutar**. También quedan listas las suites completas, de persistencia y adaptativa por reglas. La credencial local DeepSeek estaba vacía; se pidió provisionarla sin imprimir valores ni recuperar claves de chats.

Gasto anterior **informado USD 0,38**; gasto API nuevo de esta ejecución **USD 0**; margen máximo provisional **USD 0,62**, tope acumulado **USD 1**. No se obtuvo una conciliación de factura del proveedor que convierta el gasto previo informado en gasto auditado. El ledger existente se conserva. El wrapper reserva cada solicitud antes de salir, cuenta reintentos y retiene la reserva si falta usage o falla el transporte; rechaza un ledger reiniciado por debajo de USD 0,38.

Se verificaron las tarifas oficiales del modelo el 4/9: el wrapper usa conservadoramente las tarifas pico por millón (input miss USD 0,44, cache USD 0,014, output USD 1,32). La tarifa y la versión servida deben revalidarse si se retoma otro día. Fuente: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).

## Reproducción local

El cluster desechable ya creado está en `127.0.0.1:55435/studyx_test`, esquema `public`; 45 ofertas del seed. Su snapshot y el digest de `supabase/seed.sql` quedan en el manifiesto. Cada conversación usa IDs nuevos y `+999…`; el contexto previo a la primera decisión y los estados posteriores quedan en el JSON. `contacts.declared_phone` es `text` nullable localmente.

Desde este worktree, con PostgreSQL local disponible:

```sh
node scripts/run-agent-a-workflow-lab.mjs npm run build
node scripts/run-agent-a-workflow-lab.mjs npm run start -- --hostname 127.0.0.1 --port 3217
# En otra terminal:
node scripts/run-agent-a-workflow-lab.mjs npm exec -- vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-deterministic-outcomes.test.ts
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test npm run test:integration
```

El lanzador establece únicamente el entorno local previsto y rechaza archivos `.env*` autocargables por Next. El modo pago lee **sólo** `DEEPSEEK_API_KEY` de `.eval/.env.local`; exige el ledger acumulado existente, no lo crea. Una vez provisionada esa clave y revisado el saldo, el coordinador puede ejecutar focales live, completas/adaptativa y finalmente las paráfrasis nuevas con `--paid`, siempre por este workflow y bajo el mismo tope. No ejecutar todas indiscriminadamente si las reservas consumirían el margen.

```sh
node scripts/run-agent-a-workflow-lab.mjs --paid npm exec -- vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-heldout-conversations.test.ts
```

Paridad prevista: plannerless V2; `deepseek-v4-flash`, `reasoning.effort=none`, temperatura 0,2, output máximo 800, JSON schema y sin streaming. Timeout/retries backend 8000/250/2000 ms; advisor vacío. Flags locales completos en el manifiesto. Diferencias explícitas: proveedor fixture en las corridas gratuitas, cliente de entrega capturado, pasos Cloud no durables, pagos fake, URLs `example.invalid`, sin llamadas/Sheets reales. Los flags sensibles de Vercel sólo se comprobaron por presencia, no por valor efectivo; se exige comparación antes del canario.

## Estado real de despliegue

**Sin migración remota, sin deploy Vercel/Botpress, sin push ni merge, sin mensajes enviados a Telegram.** Las credenciales de administración sí se comprobaron; no se alega ausencia de acceso a esas plataformas. Producción sigue en los destinos/versiones observados antes de esta campaña.

El [runbook de rollout y canario](2026-09-04-agent-a-rollout-canary.md) documenta identidad de destinos, dry-run, orden migración → backend → Botpress → flags → prueba visible, recuperación y criterios por turno. El lector nuevo no debe desplegarse antes de crear `declared_phone`. Su aprobación remota quedó explícitamente pendiente en el paso 5 del traspaso. Tampoco se encontró el artefacto anterior acreditado de Botpress: un export Studio y apagar plannerless no son rollback exacto.

Informes auxiliares: [triage de integración](2026-09-04-agent-a-integration-triage.md), [medición del workflow](2026-09-04-agent-a-workflow-measurement.md), [rúbrica independiente](2026-09-04-agent-a-existing-transcript-review.md). El trabajo independiente queda preservado para continuar desde este candidato, sin reiniciar presupuesto ni reconstruir el contexto.
