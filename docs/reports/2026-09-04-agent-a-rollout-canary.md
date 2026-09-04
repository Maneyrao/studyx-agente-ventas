# Agente A: preparación de rollout y canario Telegram

Estado: **preparado, no ejecutado**. Este documento continúa el traspaso del 4 de septiembre; no habilita por sí mismo una migración remota. El candidato y sus evidencias se identifican en `2026-09-04-agent-a-live-candidate.md` y en `evidence/2026-09-04-agent-a-live/manifest.json` (brain V17, canónico V6); el paquete anterior permanece como evidencia histórica.

## Preflight observado

| Superficie | Evidencia del 4/9 | Consecuencia |
| --- | --- | --- |
| Supabase | Proyecto `eqspozrpzgzvtpowwprg`; consulta remota de sólo lectura: `public.contacts.declared_phone` ausente | Aplicar migración autorizada antes de publicar el lector de esa columna. |
| Vercel | Cuenta CLI `maneyrao`; proyecto `studyx-agente-ventas`, `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM`; team `team_G25HixfcqzQ8ExR1GuKNEURb` | Destino comprobado. |
| Backend anterior | Deployment `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji`, READY; URL `studyx-agente-ventas-8f5utc6mm-maneyraos-projects.vercel.app` | Conservar para rollback. No contiene SHA de fuente en el inspect obtenido. |
| Botpress | Bot STUDYX `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`; workspace `wkspace_01M0X4K3H2EE7RGM39Q29GF6VS` | Destino comprobado; último despliegue observado `2026-09-03T10:50:31.859Z`. |
| Config Botpress | Plannerless V2 true; modelo `deepseek-v4-flash`; backend `https://studyx-agente-ventas.vercel.app`; automation true; timeout 8000 ms | Releer después de publicar. Advisor ausente: default vacío; retries ausentes: defaults 250/2000 ms. |
| Telegram | Integración 1.0.11 habilitada y registered | Aún falta prueba visible del canal. |
| ADK dry-run | `npm run deploy -- --dry-run --format json`: exit 0, sin cambios de configuración, sin storage destructivo, sin dependencias bloqueantes ni diferencias de versiones | Se calculó el plan; no se aplicó. Warnings sólo de tres secretos legacy opcionales. |
| Credencial DeepSeek | Clave local provisionada por el usuario y comprobada con llamadas reales | Leer sólo DEEPSEEK_API_KEY mediante el runner seguro; mantener el ledger acumulado. La clave no forma parte del commit. |
| Rollback Botpress | API de versiones vacía; export JSON sólo Studio; sin bundle local vinculado al deploy del 3/9 | La reversión exacta del ADK no está acreditada. Procedimiento alternativo no certificado en el informe de triage. |

## Orden de ejecución cuando se resuelvan los pendientes

1. Revisar la evaluación live por `processInboundTurn` con ledger acumulado y las transcripciones completas con rúbrica independiente. Los gates de calidad siguen sin certificarse: no sustituirlos por el gate numérico. Resolver la recuperación de ambos artefactos antes de iniciar cambios remotos, incluido el backend. Las primeras validaciones reservadas H1 y V2 fallaron y quedan conservadas; V3 aprobó funcionalmente con gate de reparación fallido. Sus repeticiones posteriores son regresión, no validación nueva. Consultar el informe live del candidato y las rúbricas antes de continuar. Cualquier límite de muestra o presupuesto debe permanecer visible.
2. Obtener una aprobación concreta para `supabase/migrations/20260904010001_contacts_declared_phone.sql`. El paso 5 del traspaso exige esa aprobación. Es `ADD COLUMN IF NOT EXISTS declared_phone text`, nullable, con comentario; no hace backfill ni cambia la identidad del canal. Revalidar destino y ausencia antes de aplicar exclusivamente esta migración, sin ejecutar toda la cadena remota.
3. Verificar en lectura columna `text`, nullable, y éxito de la transacción. Conservar evidencia de aplicación. No borrar la columna ante rollback de código.
4. Publicar el backend de este candidato en el proyecto Vercel comprobado, usando sus credenciales remotas. No pasarle el entorno del laboratorio. Registrar deployment ID/URL y commit, confirmar health/readiness y comparar flags efectivos con el manifiesto. La inspección inicial sólo acreditó nombres de varias variables sensibles, no sus valores.
5. Con la recuperación por artefacto/configuración anterior ya verificada, repetir dry-run del candidato y publicar únicamente en el bot STUDYX comprobado; no usar `--confirm-storage-changes` ni `--allow-unconfigured`. Registrar el timestamp remoto y el digest del bundle local que se envió. El comando del paquete es `npm --prefix botpress-agent run deploy`.
6. Releer configuración remota: backend correcto, plannerless true, modelo/timeout/retries y advisor coincidentes. Confirmar Telegram registered. El historial de WhatsApp `registration_failed` no forma parte de esta campaña.
7. Sólo entonces pedir al usuario el canario de Telegram. No pedirle una conversación contra el bundle anterior ni presentar el estado como `READY_FOR_SUPERVISED_TELEGRAM` antes de estos pasos.

## Prueba supervisada preparada

El usuario inicia el contacto; el agente de implementación no envía mensajes a terceros. Usar identidad de prueba y registrar de antemano `provider=telegram_sandbox`, IDs del canal y memoria/estado conocidos. Telegram mantiene `channel=whatsapp` por contrato interno, con proveedor sandbox y teléfono sintético `+999…`. Comprobar la fila de aislamiento antes de cualquier efecto comercial. Si la identidad ya tiene historia, documentarla o usar una identidad nueva; no borrar memoria ajena.

| Recorrido del usuario | Evidencia requerida |
| --- | --- |
| Pregunta por un curso y luego cambia a otro | Respuesta relevante; código del segundo curso persistido y plan anterior descartado. |
| Elige chat/rechaza llamada | Ledger de llamada declined; no insistencia posterior. |
| Elige plan y vuelve a preguntar precio | Confirmar el importe consultado sin reabrir una elección ya guardada; una pregunta no autoriza intake ni link. |
| Elige plan y luego posterga | Plan persistido; respuesta a la postergación; ninguna acción ni link nuevo. |
| Aporta datos de prueba sin autorizar link | Intake conserva sólo lo declarado, teléfono separado del sintético; sin link. |
| Pide explícitamente el link | Sólo el plan/catálogo autorizados. En sandbox no efectuar cobro; registrar efecto que la frontera permita y no confundir bloqueo seguro con venta completada. |
| Informa un pago de prueba | Aviso persistido; sin acreditar pago, inscripción, acceso ni promesa de notificación futura. |
| Pide baja; luego vuelve a escribir | Revocación causal persistida; silencio posterior justificado por ese bloqueo. |

Para cada respuesta visible, relacionar mensaje entrante → turn/trace → propuesta y validación → decisión/outbound autorizado → `createMessage` → estado durable de entrega → mensaje visible en Telegram. Guardar IDs técnicos y transcripción de prueba. Un HTTP 200, `submitted` o health verde sin observación del canal no demuestra entrega remota. No inventar un read receipt. Los textos se evalúan por comprensión, relevancia, continuidad, tono, iniciativa y cumplimiento; un turno silencioso por fallo técnico permanece como fallo aunque el siguiente responda.

## Recuperación y Git

Ante degradación del canario, detener el ensayo y conservar evidencia. Restaurar el deployment anterior de Vercel sólo después de verificar compatibilidad y disponibilidad. Para Botpress falta el artefacto anterior acreditado: apagar plannerless activa V1 dentro del mismo bundle y no reemplaza un rollback. La reconstrucción de `ad15ba…` en el informe de triage es una alternativa de recuperación que requiere su propia verificación, no una copia de producción.

Remotos comprobados: `personal=https://github.com/Maneyrao/studyx-agente-ventas.git`; `origin=https://github.com/lbozzolo/studyx-agente-ventas.git`. El candidato queda en `codex/agent-a-plannerless-v2`; esta campaña no ejecutó push, merge ni force-push. Confirmar el ref de destino concreto antes de publicar Git; no confundir el `main` del usuario con el repositorio de Lucas.
