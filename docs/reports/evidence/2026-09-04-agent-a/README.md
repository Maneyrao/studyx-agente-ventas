# Evidencia preservada del candidato

`manifest.json` identifica fuentes/builds, entorno, parámetros, métricas, estado del despliegue y SHA-256 de cada archivo comprimido y su original. El commit que introduce este paquete identifica el candidato. No se archivaron secretos ni conversaciones reales; los datos nuevos son fixtures de prueba.

- `transcripts.md`: recorrido final completo, texto antes/después y prueba de caída503, con IDs y persistencia.
- `workflow-deterministic-*.json.gz`: reportes originales íntegros; incluyen las corridas previas completas y el checkpoint fallido inicial. No todas usan el mismo estado del código: la procedencia temporal está descrita en el manifiesto.
- `*-red*.log.gz`, informes de triage y `*-green*.log.gz`: ejemplos de regresión antes/después. Los originales permanecen en `.eval/codex-20260904` y `botpress-agent/evals/results`.
- Logs `coverage-candidate`, `integration-verified`, `metrics-final`, `workflow-final`: gates de cierre. La focal final incluye el último borde de replay añadido después de la corrida general.
- `local-catalog.json`: snapshot del catálogo de la DB desechable, 45 ofertas. El manifiesto incluye los hashes de todas las migraciones y del seed.
- `budget-snapshot.json`: estado del ledger acumulado al entregar (USD0.38 informado previamente, ninguna llamada nueva, capUSD1). Continuar con el ledger original vivo, nunca reemplazarlo por este snapshot.
- `botpress-production-before.json` y `botpress-deploy-dry-run-sanitized.json`: metadata remota y plan sin aplicar, sin valores de secretos. No son un backup del bundle ADK.
- `SESSION-before.md`: historial previo preservado, cuyo estado fuera de AgenteA no fue revalidado.

Para leer un archivo sin alterar el original, usar `gzip -cd <archivo.json.gz>`. El SHA-256 del JSON descomprimido debe coincidir con `sha256` en el manifiesto; el del gzip coincide con `archive_sha256`. La latencia fixture no mide DeepSeek ni Telegram, y 0 reparaciones no proporciona una tasa de éxito. Consultar el informe candidato y el runbook antes de reanudar.
