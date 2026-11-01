# Evidencia: aceptación después de alinear paid

Una corrida de las 16 golden sobre `94829544b571b947739acbeecfc931c96d3a28ef`: **35 PASS, 13 FAIL, 0 INDETERMINATE**. Pasan los críticos 07/10/11/15; 12 falla en el agradecimiento posterior al alta. No alcanza 41/48. No se desplegó.

- `summary.md`, `per-turn.csv`, `turns.json`: los 48 turnos y sus borradores/entrega, tipo de generación, capa, rechazos y latencia.
- `delivery-audit.json`: revisión individual de cada entrega y efecto, con una cita literal y hash del texto. Los 48 PASS tienen sólo el alcance de ausencia observada de bonificaciones sin respaldo; no sustituyen los resultados golden.
- `diagnostics.json/md`: análisis del caso 12, agregados de enlace y contingencia de postventa. El falso positivo de la regex de bienvenida se documenta como inferencia reproducida offline; el evento durable sólo registra el rechazo general.
- `raw/`: originales de resultados, observaciones, uso, respuestas y recibos. Markdown y log se comprimieron sin modificar sus bytes.
- `version-proof.json`: 51 salidas del agente con brain v149 y esquema course_mentions obligatorio; 48 respuestas exitosas del juez con esquema v3. El evaluador lógico v4 se acredita por el SHA de fuente. La normalización de códigos no se ejercitó en vivo; el replay de las cuatro respuestas antiguas la prueba. Dos llaves finales extra se recuperaron con el parser existente, sin solicitudes adicionales.
- `pricing.json`: tarifas oficiales verificadas. USD 0,104593734 estimados para el uso informado, más un intento de red sin consumo reportado. No se determina el total exacto ni se usa la diferencia de saldo como factura.
- `manifest.json`: hashes y tamaños de la evidencia, excepto el propio manifiesto.

101 solicitudes: 51 del agente (incluye un setup fuera de los 48 turnos), 49 del juez (48 respuestas y un incidente de red sin turno confirmado), una de postventa. El incidente `call-0067` está contabilizado globalmente y no atribuido a una fila por inferencia de orden. Todos los pedidos tienen rol y scope de ejecución conocidos; uno carece de uso y de identidad de turno confirmada.

En 06/14 hubo cero efectos `offer_course_bonus` y cero rechazos `ladder_step_pending`. Esta corrida no demuestra exposición de la escalera, máximo de tres o cancelación de un paquete ofrecido por el modelo; el paquete de acceso del caso 12 proviene del setup controlado.

El API no devuelve el input JSON del juez; se conservan las instrucciones/esquema devueltos, el código evaluado y sus tests. El campo backend_sha durable local sigue nulo; la fuente se acredita por checkout limpio, runner, resultados y estado de ejecución.

Reproducir las tablas desde la raíz del repositorio sin nuevos modelos:

```bash
python3 docs/reports/evidence/2026-11-01-paid-role-alignment/acceptance/summarize.py \
  --root . \
  --stems docs/reports/evidence/2026-11-01-paid-role-alignment/acceptance/raw/acceptance-9482954-flash-full16-20261101 \
  --delivery-audit docs/reports/evidence/2026-11-01-paid-role-alignment/acceptance/delivery-audit.json \
  --output-dir /tmp/studyx-paid-alignment-reproduction
```

La reproducción conserva los 48 juicios, uso, distribución de solicitudes y gate formal. No vuelve a juzgar ni cambia requisitos.
