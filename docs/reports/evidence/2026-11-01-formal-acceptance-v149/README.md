# Evidencia de aceptación formal Flash v149

Una corrida de las 16 golden sobre `f1f0f9c5d3676d324642238e43279c0c0fada2b7`: **34/48 aprobados, 13 fallidos y 1 indeterminado**. Críticos 07/10/11/12/15 completos y cero bonificaciones sin respaldo observadas. Falla el mínimo de 41. No se desplegó. 06 y 14 no tienen gate individual; sus turnos integran los 48.

- `summary.md`, `per-turn.csv`, `turns.json`: las 48 filas, con fuente de borrador (agente/postventa), entrega, capa, rechazos y latencia.
- `raw/`: resultados, observaciones, recibos durables, consumo y respuestas originales. Markdown y log están comprimidos sin alterar sus bytes.
- `delivery-audit.json`: revisión contextual de 48 entregas y efectos, ligada por SHA256. Su PASS tiene sólo el alcance de ausencia observada de bonos indebidos; no reemplaza los scores golden.
- `diagnostics.json/md`: análisis Codex que distingue los cursos seleccionados que recibió el modelo de la selección persistida nula. La causa de esa desalineación queda pendiente de diagnóstico. Los 12 snapshots y los scores originales se conservan.
- `version-evidence-scope-proof.json`: 60 salidas exitosas del agente con v149/contrato, un aborto sin salida y 51 respuestas con esquema de juez v3. El API no devuelve el JSON de entrada del juez; el código y sus tests cubren la construcción normativa. El SHA local se acredita por runner y checkout; `backend_sha` durable continúa nulo.
- `pricing.json`: tarifas oficiales verificadas. USD 0,115728834 estimados por el uso conocido, más un aborto sin datos de uso. El total exacto no se determina. El saldo no se usa para calcular costo.
- `manifest.json`: hashes y tamaños de los archivos de evidencia, excepto el propio manifiesto.

Se contabilizan 113 solicitudes: 61 del agente (incluye una de setup fuera de los 48 turnos), 51 del juez (incluye tres reintentos por referencia inválida) y una de postventa. El primer turno del caso 12 es postventa con hechos de acceso autorizados; no se presenta como borrador del agente. El uso del setup también está incluido.

Reproducir las tablas desde la raíz del repositorio, sin nuevas llamadas al modelo:

```bash
python3 docs/reports/evidence/2026-11-01-formal-acceptance-v149/summarize.py \
  --root . \
  --stems docs/reports/evidence/2026-11-01-formal-acceptance-v149/raw/acceptance-f1f0f9c-flash-full16-20261101 \
  --delivery-audit docs/reports/evidence/2026-11-01-formal-acceptance-v149/delivery-audit.json \
  --output-dir /tmp/studyx-formal-v149-reproduction
```

La reproducción coincide en las 48 filas, juicios originales, uso, atribución de solicitudes y criterio formal. No vuelve a juzgar ni modifica requisitos.
