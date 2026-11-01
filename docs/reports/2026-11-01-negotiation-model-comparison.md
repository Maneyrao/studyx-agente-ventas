# Contexto de negociación: comparación Flash y Pro

Código evaluado: `89504243891f9bd5075aaff12c0dd9a9c4a09b9a`. Una corrida por modelo sobre los casos 03, 04, 06, 07 y 14, 22 turnos cada una. **Evaluación parcial: no acredita el criterio completo de 41/48 ni los cinco críticos.**

El modelo interno de producción y su guard siguen siendo Flash. Pro se selecciona únicamente en el transporte de evaluación para la redacción del agente; ambos usan el juez Flash con los mismos criterios. La autoridad canónica no se cambia. El alias solicitado `deepseek-v4-flash` puede resolverse a V4.1-Flash: los nombres solicitados y devueltos constan en los reportes, sin asumir que un alias conserva el mismo snapshot histórico.

| Modelo agente | Turnos aprobados | Fallidos | Errores del evaluador | Recuperaciones JSON juez | Solicitudes API | Costo estimado total |
|---|---:|---:|---:|---:|---:|---|
| deepseek-v4-flash | 8/22 | 14 | 0 | 2 | 44 | USD 0.036189 |
| deepseek-v4-pro | 10/22 | 12 | 0 | 2 | 43 | USD 0.151612 |

## Resultado observado

Pro mejora `06/isolate` y `14/installments`; los otros 20 resultados permanecen iguales. Flash se mantiene en 8/22 respecto de la referencia 1a24d76 para estos casos. Ambos siguen fallando `03/recommend`, omitiendo la llamada en `06/call_step` y dejando para después la decisión en `07/think`. El contexto llegó a ambas generaciones, pero su disponibilidad no garantizó que siguieran la secuencia de Gabi.

Hay tres resultados con precondición no alcanzada: `06/never_fourth` en Pro y `14/change` en ambas corridas. Se conservan sus fallos formales por arrastre del estado previo; no prueban independientemente un incumplimiento de esas reglas. Flash tuvo 21 solicitudes de juicio semántico y Pro 20. Las restantes se calificaron estructuralmente por esa precondición. **Cero errores del evaluador no significa que los 44 turnos recibieran juicio semántico.** No se cambió el score ni se repitió la evaluación.

## Consumo por función

Estimación con usage recibido y [tarifas oficiales](https://api-docs.deepseek.com/quick_start/pricing/) indicadas para horario valle del fin de semana: Flash por millón entrada caché USD 0,003, entrada sin caché USD 0,15 y salida USD 0,60; Pro USD 0,022 / 0,66 / 1,98. Los intentos sin usage completo conservan costo desconocido. Estos importes no son una factura ni se reemplazan por la variación redondeada del saldo.

| Corrida | Función | Solicitudes | Entrada conocida | Caché conocida | Salida conocida | Costo estimado |
|---|---|---:|---:|---:|---:|---|
| flash | agent | 23 | 351417 | 178432 | 7540 | USD 0.031007 |
| flash | judge | 21 | 55547 | 31616 | 2495 | USD 0.005181 |
| pro | agent | 23 | 349076 | 161280 | 9867 | USD 0.147030 |
| pro | judge | 20 | 52526 | 31104 | 2126 | USD 0.004582 |

## Comparación y límites

Resultados por turno Flash → Pro: {"igual":20,"mejora":2}. Es una única muestra por modelo, con estados que evolucionan según sus decisiones; no demuestra superioridad causal o estabilidad estadística.

Referencia histórica de 1a24d76 para estos mismos 22 turnos: 8/22 aprobados.

Los nuevos campos muestran el total previo de objeciones registradas, confirmación de precio como único freno con cita y fecha, invitación a llamada separada del permiso y ofrecimientos de bonificación entregados. No se presentan como una recomendación de escalón ni como permiso nuevo. La evidencia de estos campos proviene del contexto enviado por el backend. El exportador de auditoría usado en esta medición no incluye la nueva columna `agent_decisions.negotiation_observations`; su persistencia atómica e inmutabilidad se comprobaron en integración.

La recuperación del juez elimina sólo una llave final sobrante en el defecto demostrado. El raw original y la marca de recuperación se preservan; los criterios, referencias y comprobaciones de evidencia siguen vigentes. Un error de transporte o del evaluador queda identificado por separado del fallo comercial.

[Tabla completa por turno](evidence/2026-11-01-negotiation-model-comparison/por-turno.md) · [CSV](evidence/2026-11-01-negotiation-model-comparison/por-turno.csv) · [Resumen y contexto completo](evidence/2026-11-01-negotiation-model-comparison/resumen.json). Los reportes originales del proveedor, originales de ejecución y auditoría durable se conservan en `evidence/2026-11-01-negotiation-model-comparison/raw/flash/` y `raw/pro/`.

**Sin despliegue.**

## Saldos y verificación

Lecturas de saldo: USD 4,92 antes, USD 4,88 entre corridas y USD 4,78 al terminar. El primer intervalo incluye una separación de varias horas. Son lecturas de cuenta redondeadas, no una factura por corrida; no coinciden exactamente con los costos estimados por usage y tarifas públicas. Se conservan sus timestamps en `balance-before.json`, `balance-between.json` y `balance-after.json`.

Contexto y juez se subieron antes de medir: `f2f6f40` y `8950424`. Pasaron 4.879 unitarias, 928 de integración, 67 pruebas offline del evaluador, tipos, lint, build y validación offline ADK. La revisión del arquitecto aprobó implementación y evidencia con las precisiones de alcance anteriores. Los incidentes de aislamiento de fixtures y sus verificaciones están en `checks.json`.

No se añadió ninguna condición para bloquear bonificaciones. No se cambió el modelo de producción, el prompt canónico ni los criterios golden. No se aplicó la migración a producción ni se desplegó.
