# Sesión StudyX

## Estado vigente

El usuario autorizó desplegar para prueba supervisada el 4/9 y pidió priorizar la llamada antes de continuar la venta por chat. **Desplegado y listo para su prueba en Telegram; entrega visible aún pendiente.** No equivale a producción certificada.

Fuente desplegada: `07328e23f97054aeb92a108562f70b6ef3a88bb4`, rama `codex/agent-a-plannerless-v2`. Base anterior `d5b786af65162c54721f9dc8ab0cbf7820b701e1` conservada. Sin push ni merge. Informe vigente: `docs/reports/2026-09-04-agent-a-supervised-deployment.md`; transcripciones, recibos y ledger: `docs/reports/evidence/2026-09-04-agent-a-supervised/`. No borrar ni reinterpretar los fallos anteriores.

## Despliegue observado

Supabase: migración aditiva `declared_phone` aplicada; columna text nullable y 56 migraciones verificadas, sin pendientes ni backfill.

Vercel: `dpl_4oQWvw17x2Pr6dVrXbW1qZ7adP4i`, READY, alias `https://studyx-agente-ventas.vercel.app`. Health devuelve el commit desplegado; readiness comprueba configuración, brain, PostgreSQL y catálogo. Deployment previo `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji` conservado. La publicación final usó un export de 298 archivos regulares y ningún archivo privado en el árbol remoto verificado.

Botpress STUDYX: `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`, activo, Telegram `amsterdam_reservas_bot` registrado. El PUT sólo de código no devolvió confirmación a tiempo; no repetir. Lecturas posteriores y auditoría confirman nueva publicación: deployedAt 17:00:07 UTC, evento DEPLOY_BOT 17:00:56 UTC. Configuración, integraciones, plugins y esquemas preservados. No hay hash remoto del bundle.

## Evidencia funcional

Brain V20 / canónico V9 íntegro, 322 líneas. Se corrigieron nombre/apellido etiquetados, plazo mensual del pago confundido con duración académica, pedidos de datos ya presentes y registro transaccional de identidad sandbox Telegram. Se preservó el primer V20 fallido y se corrigió la aserción que confundía 360 con 60.

V20 final: 8 turnos / 8 HTTP, 0 silencios, 0 reparaciones, p95 4400 ms. Llamada inicial, rechazo, cuota USD 60, identidad completa y enlace de seis cuotas con salida durable correlacionada. Workflow real con PostgreSQL aislado y adaptadores externos de laboratorio: no acredita entrega visible en Telegram.

2565 unitarias/contratos, 44 integraciones y 121 focales finales aprobadas; lint y builds Next/ADK aprobados. Naturalidad: revisión independiente 3,83/5, muestra de ajuste sin calibración humana. En T4 falta pregunta de elección de plan; no es un bloqueo para la prueba supervisada.

Freeze de 316 archivos: `72a2d1cdae9eb12b2a5bb548a2993f1d9c6f43934d39c077e141869dcccfd334`. Next local: `n4AG7eWnxPRzL0QlH6b7R`. Bundle publicado: SHA `4b4de7e17f9602ab814dbdd17fe16537361482ba135d10013b3bc0a5350f011c`. Canónico SHA `6d724acf6e366571bc6ce94d5013d007654442a67562daf67e672542c1eba17b`.

## Pendiente y recuperación

Prueba visible del usuario en Telegram, con recepción del enlace sin pagarlo. La preferencia y el historial persisten; no existe `/reset`. Agente B/Retell no conectado en esta entrega. Contingencia Botpress: helper privado `botpress-code-only.mjs pause --apply`, que preserva configuración; backend anterior disponible. El bundle local d5b786a archivado no es una copia del deployment remoto anterior.

Incidente abierto: primer upload Vercel con `--archive=tgz` recorrió directorios excluidos y pudo enviar archivos privados. Se detuvo, sin deployment observado, pero retención de partes desconocida. **No volver a usar archive desde el worktree.** Ver `docs/reports/2026-09-04-vercel-archive-upload-incident.md`. Borrador de soporte listo y no enviado; requiere autorización para contactar al proveedor. No declarar saneado ni rotar credenciales a ciegas.

## Presupuesto

Tope acumulado USD 1; usado USD 0,858633752; restante USD 0,141366248. 256 reservas, incluidos USD 0,38 previos y una reserva histórica sin usage. No reiniciar. No hubo llamadas pagas posteriores a la regresión final. Clave en `.eval/.env.local`: nunca imprimir. Laboratorio API 3217 / PostgreSQL 55435 aislados; no cargar el entorno productivo en pruebas.
