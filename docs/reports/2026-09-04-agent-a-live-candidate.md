# Agente A — candidato verificable tras evaluación live

Estado: **READY_FOR_LOCAL_REVIEW**. No está listo para Telegram supervisado ni certificado para producción. Se ejecutó el workflow real `processInboundTurn` con Next compilado, PostgreSQL descartable, DeepSeek real y captura del adaptador local. No hubo migración, push, merge, despliegue Vercel/Botpress ni mensajes en Telegram.

La rama es `codex/agent-a-plannerless-v2`. Se partió del checkpoint limpio `ad15baafb63e8c55cb877f943a74e57c2899deda`; se preservó el candidato intermedio `360cd37201a35bf3c4cceb82a93e809885494529` y su evidencia histórica. El commit que contiene este informe y el nuevo paquete es el candidato final; su SHA exacto se entrega en la tarea. No se reinició el presupuesto.

## Qué se corrigió

- **Falsos verdes:** disponibilidad por turno, opt-out respaldado por revocación causal y entrega que exige correlación entre decisión, outbound, destino, texto, provider ID y captura. Una caída del modelo permanece como fallo de disponibilidad. Una fila con link sin salida del adaptador no cuenta como entrega.
- **Consentimiento:** elegir plan o aportar datos no autoriza el link. La postergación retira permiso; cambiar curso descarta plan y permiso anteriores. El simulador adaptativo ahora comprueba la autorización del propio cliente antes de cada efecto. La venta V15 antes considerada válida queda registrada como envío indebido.
- **Reparación:** el esquema JSON prohibía `repair_of` mientras el resolver lo exigía. Ahora correlaciona rejection ID e intento real. Se conservan las cuatro reparaciones V14 fallidas y las recuperaciones posteriores; sin muestra, éxito queda null.
- **Conversación y validación:** se envía explícitamente el mensaje actual al modelo; una pregunta pendiente no equivale a aceptación. La poda compara contenido aunque siga habiendo un solo mensaje. USD360 y USD360.00 se reconocen como el mismo importe en el borrador, manteniendo negativos de otros importes/monedas/negaciones. Se conserva la validación de salida firmada.
- **Catálogo y hechos operativos:** un descriptor de área canónica no se interpreta como otro curso. La condición de acreditación y su consecuencia se mantienen juntas. Una petición para registrar datos no afirma que ya se registraron; los demás hitos en la misma frase siguen exigiendo evidencia. No se autorizan avisos futuros ni acceso ya otorgado.
- **Datos personales:** los formularios con nombre compuesto antes de email admiten etiquetas personales, comas, punto y coma y saltos de línea. Se mantienen filtros de nombres plausibles y se rechazan encabezados negados, cursos y terceros ambiguos. Email y teléfono declarado permanecen separados de la identidad sintética del canal.
- **Prompt completo:** se reconciliaron instrucciones contradictorias de precio/cierre/permiso, acceso posterior a acreditación, seguimiento inexistente y llamada opcional. No se reinstaló planner ni se añadieron respuestas comerciales prefabricadas. Persisten limitaciones de calidad descritas por el revisor.

## Fuente y entorno final

| Campo | Valor |
| --- | --- |
| Brain / canónico | V19 / V8; prompt completo de 322 líneas |
| SHA canónico | `67adca0e95055f32943717af84cb22d211a624c631eb79848cf296c688ffa575` |
| Modelo | `deepseek-v4-flash`, Responses, temperature0.2, reasoning none, max800, sin streaming |
| Freeze final | `2026-09-04T15:47:41.402662+00:00`; posterior al cierre pagado |
| Digest de fuente | `a98f6e57ce2604c3cde29c5595c11ffee5598e26679516c3acfb83e80625430e` |
| Next build | `IrwZGDZAUGAKWeW7Jjxmn`; incluye corrección posterior del ledger de llamada |
| SHA bundle ADK | `b9376e34f04dc8d2cc47c587e9576b58140f057cf78658e60fd7f3c881c3fdf1`; compilación local, no bundle publicado |
| Workflow / DB | `127.0.0.1:3217` / `127.0.0.1:55435/studyx_test` |
| Pago / canal | URLs `example.invalid/eval`, proveedor fake, adaptador local |
| Servicios externos | No cobros, llamadas, Sheets ni embeddings reales |

El manifiesto vincula cada ronda con su fuente; la versión del prompt sola no identifica el backend. El laboratorio no cargó el entorno productivo. El runner pagado lee exclusivamente DEEPSEEK_API_KEY de `.eval/.env.local` y exige el ledger original.

## Resultados, sin borrar fallos previos

V14 se interrumpió al comprobar el defecto de reparación. V15 expuso un link sin permiso en la venta adaptativa y dos retries de JSON inválido que no se cuentan como reparación semántica. V16 completó 13 conversaciones/48 entradas con cero fallos de disponibilidad, pero su rúbrica no aprobó naturalidad. V17/V18 conservaron el plan y bloquearon el link prematuro, aunque todavía repitieron menú tras una elección guardada.

Las primeras validaciones reservadas permanecen inmutables: H1 falló porque el nombre no persistió; H2 pasó curso/chat/opt-out. La nueva V2 falló en T3 por formulario multilínea. Después de corregir la extracción, ambos guiones pasaron como **regresiones**, sin transformarse retrospectivamente en validación independiente. La primera V3 pasó sus cuatro turnos funcionales con cinco HTTP y una reparación; su tasa de reparación de 25% no aprueba ese gate. Su resultado pertenece al freeze V17 correspondiente, no a V19.

V19 completó **7 conversaciones / 31 entradas**, contenidas en cuatro tests. Las conversaciones y los JSON preservan borrador, rechazos, reparación, salida autorizada, captura y estado durable. El informe de medición y la revisión final muestran latencia, disponibilidad, reparaciones y rúbrica por separado. No se promedian versiones ni se convierte el porcentaje de tests en porcentaje de naturalidad.

En V19 pagado: **31 turnos modelo / 32 HTTP**, disponibilidad fallida0, fallback0, p50 3360 ms, **p95 4157 ms**, una reparación de31 turnos (3,23%) y éxito1/1. Los gates numéricos del agregado pasan; la submuestra V2 tiene reparación25% y no los pasa individualmente. La revisión independiente no aprueba calidad: persiste el menú tras elegir plan y aparece texto que anticipa pago. Un único éxito de reparación no certifica estabilidad.

**Costo acumulado conservador USD0,823283696; remanente USD0,176716304 del topeUSD1.** Incluye USD0,38 previos informados, 239 reservas/llamadas y todos los retries; 237 HTTP conciliados con reportes, un intento histórico con usage sin snapshot y una reserva de intento abortado sin usage conservada. No es una factura del proveedor. Ledger final SHA `d118ddc49db2aa7ba3aa480809f3b4dcbebb5d5cfc6b0da8b56d2a19f8c41332`.

La revisión también detectó que texto informativo en `call_offer` incrementaba el ledger aunque no ofreciera una llamada. Se corrigió después de la última paga: el campo declarado exige referencia al canal de voz, preservando el bloqueo de las ofertas reales y los reconocimientos de rechazo. La primera variante produjo dos falsos negativos y queda documentada; la corrección posterior y su workflow gratuito se distinguen de las métricas pagadas anteriores. No se atribuye el resultado live al código cambiado después.

## Verificación gratuita y límites del laboratorio

El cierre de fuente final registró **2531 unitarias/contratos aprobados, 7 omitidos y 7 TODO**; los cambios V19 sólo modifican prompt, versiones y su generación y pasaron nuevamente sus focales, typechecks raíz/Botpress, lint, ADK check/build. Cobertura de heurísticas: líneas100%, funciones100%, ramas87.01%. Next compilado y workflow determinístico3/3 aprobados; este último verifica también caída503 y replay sin duplicación. No se presentan skips/TODO como aprobados.

Integración completa previa al ajuste del ledger: **353 aprobadas / 1 omitida**. Después de ese cambio, las **20 integraciones relevantes** de turno, handoff y ledger de llamadas pasaron nuevamente. La base de evaluación acumuló 141 claims vencidos reclamables de pruebas anteriores; el barrido limitado a100 dejó fuera un claim nuevo en una corrida. Se conserva ese fallo y se creó una segunda DB descartable `studyx_integration_20260904` con el mismo esquema y catálogo, sin copiar conversaciones. Al restaurar se replicó también `search_path=public,extensions`, que pg_dump no incluye como ajuste de base. Las corridas previas y la configuración corregida quedan archivadas. La verificación final no certifica ausencia de starvation del reconciliador bajo ese backlog; no se cambió el SQL para ocultarlo ni se borró el laboratorio original.

La proyección de memoria se drenó con su worker SQL local cuando había backlog; no demuestra generación ni recuperación de embeddings. Los avisos MISSING_CRON_SECRET de fronteras simuladas no equivalen a servicios externos verificados. Tampoco `submitted` local demuestra un mensaje visible en Telegram.

## Evidencia y reproducción

- [Transcripciones de todas las rondas](evidence/2026-09-04-agent-a-live/transcripts-all-rounds.md), con texto antes/después y referencias a JSON.
- [Verificación de integridad](2026-09-04-agent-a-artifact-verification.md).
- [Manifiesto y hashes](evidence/2026-09-04-agent-a-live/manifest.json), freeze y presupuesto conservador archivados.
- [Medición completa](2026-09-04-agent-a-live-measurement.md) y [revisión final independiente](2026-09-04-agent-a-final-v19-review.md).
- Las revisiones V14, V15, V16, V17 y de intake conservan fallos originales y citas por turno.

Desde el worktree, con la DB descartable ya preparada:

```sh
node scripts/run-agent-a-workflow-lab.mjs npm run build
node scripts/run-agent-a-workflow-lab.mjs npm run start -- --hostname 127.0.0.1 --port 3217
node scripts/run-agent-a-workflow-lab.mjs npm exec -- vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-deterministic-outcomes.test.ts
node scripts/run-agent-a-workflow-lab.mjs --paid npm exec -- vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-payment-consent-regression.test.ts tests/workflow/agent-a-intake-heldout-v2.test.ts tests/workflow/agent-a-full-conversations.test.ts
```

La última orden consume el remanente original: no inicializar otro ledger. Las validaciones ya ejecutadas son regresión al repetirlas.

## Estado real del despliegue

El dry-run del ADK final pasó sin cambios de configuración, storage destructivo, dependencias bloqueantes ni versiones incompatibles; no publicó nada. Supabase productiva `eqspozrpzgzvtpowwprg` fue inspeccionada en lectura y no tiene `contacts.declared_phone`. El paso5 del traspaso exige autorización explícita para `20260904010001_contacts_declared_phone.sql`; «listo» confirmó la clave local, no esa migración. Es una columna text nullable, sin backfill ni cambio de identidad.

Vercel anterior identificado: `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji`. No se recuperó el bundle ADK exacto publicado el3/9. El manifiesto remoto y el export Studio no contienen una implementación equivalente acreditada. Una compilación offline de un commit local puede ofrecer recuperación alternativa, pero requiere aceptación explícita y no se presenta como copia de producción. Ver [investigación de rollback](2026-09-04-agent-a-rollback-followup.md) y [alternativa preparada](2026-09-04-agent-a-recovery-alternative.md).

El [runbook del canario](2026-09-04-agent-a-rollout-canary.md) conserva el orden migración→Vercel→Botpress→flags→Telegram supervisado y exige resolver gates/recuperación antes de publicar. Los remotos Git personal y Lucas están identificados; no se adivinó rama de destino ni se hizo push. El próximo paso externo requiere las autorizaciones pendientes y aceptar expresamente cualquier cambio del plan de recuperación; no basta el verde de unitarias.
