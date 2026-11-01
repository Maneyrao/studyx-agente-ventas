# Evidencia de las dos corridas Flash

Código ejecutado: 25970d5b870bb7bf3b4ad01a42a764f0f19b390d; brain v148, prompt canónico v101. Dos corridas reales de 06/07/14. No full16 ni deploy. Los archivos en raw son originales; los Markdown de resultados y logs están comprimidos sin modificar sus bytes.

- summary.md / per-turn.csv / turns.json: los 36 turnos y sus borradores, entrega, capa, acciones/roles, rechazos y latencia.
- delivery-audit*.json: revisión contextual literal de las 36 entregas, hashes y efectos. PASS se limita a ausencia observada de bono indebido; no sustituye la aprobación golden.
- summary.json conserva además el cruce conservador del juez: 19 PASS / 17 INDETERMINATE; la revisión contextual independiente es 36 PASS. La aceptación permanece fallida.
- version-contract-proof.json prueba 40/40 campos y versiones; declara explícitamente backend_sha durable nulo y SHA de ejecución acreditado por el runner.
- pricing.json: tarifas verificadas; costo estimado, no factura. Las consultas de saldo no se usan para calcular consumo.
- manifest.json: hashes y tamaños de todos los archivos de evidencia de este bloque; no se incluye a sí mismo.

Reproducir el resumen desde esta carpeta de originales, desde la raíz del repositorio, sin red ni modelos:

```bash
python3 docs/reports/evidence/2026-11-01-course-mentions/acceptance/summarize.py \
  --root . \
  --stems docs/reports/evidence/2026-11-01-course-mentions/acceptance/raw/r1/focused-25970d5-flash-060714-r1-20261101 \
          docs/reports/evidence/2026-11-01-course-mentions/acceptance/raw/r2/focused-25970d5-flash-060714-r2-20261101 \
  --delivery-audit docs/reports/evidence/2026-11-01-course-mentions/acceptance/delivery-audit.json \
  --output-dir /tmp/studyx-course-mentions-reproduction
```

Los contadores de rechazo leen los eventos backend_rejection y sus subjects, sin sumar dos veces los eventos espejo de feedback. R1 registra tres eventos en dos turnos.

Las discrepancias de fundamentos del juez se documentan en el informe principal; no se cambiaron sus veredictos, sus criterios ni las expectativas golden. El único reemplazo de prosa observado fue la contingencia de R1/06/bonus_3. La comparación técnica permite únicamente eliminar ¿/¡ y diferencias de espacios; cualquier otra diferencia queda señalada para revisión.
