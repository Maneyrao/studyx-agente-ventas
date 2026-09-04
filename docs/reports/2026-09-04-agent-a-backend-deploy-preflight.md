# Preflight de backend/Supabase — 2026-09-04

El esquema remoto ya tiene `contacts.declared_phone` después de la migración aplicada por el coordinador. El preflight encontró además que la ingesta Telegram no creaba automáticamente el candado de efectos sandbox: se corrigió y verificó con PostgreSQL aislado, RED 4 fallos → GREEN 5/5. Quedan para el coordinador build/despliegue y comprobación visible de Telegram. Este informe no declara esas acciones terminadas.

## Migración y compatibilidad del esquema

Destino verificado: Supabase `eqspozrpzgzvtpowwprg`. La lectura de las 16:29:21 UTC se ejecutó con `transaction_read_only=on`: 55 migraciones remotas, 56 locales, ninguna versión remota desconocida y una única pendiente, `20260904010001_contacts_declared_phone.sql`. SHA-256 de ese archivo: `070305c509f958ce81166c3d9937c4843ea4e6c2f9338b6556fd50006c2594dd`.

La migración agrega exclusivamente una columna `text` nullable y su comentario, dentro de `BEGIN/COMMIT`. No cambia `contacts.phone`, no hace backfill y no agrega UNIQUE ni CHECK. La comparación de nombres de tablas/columnas del dump local de laboratorio contra el remoto encontró sólo esa columna faltante: 686 columnas locales frente a 685 remotas, sin columnas remotas adicionales. Esta comparación y el ledger acreditan compatibilidad estructural del lector; no son una auditoría completa de semántica de funciones, constraints o permisos.

El procedimiento usado por el coordinador fue el CLI nativo, mediante `.eval/codex-20260904/deploy-backend/migrate-phone.mjs`: comprueba proyecto y hash, usa pooler de sesión en puerto 5432 para las prepared statements del ledger, ejecuta `supabase db push --dry-run`, exige que el único archivo pendiente sea el autorizado y sólo con `--apply` hace `db push --yes`. No usó `--include-all`, `--include-seed`, reparación manual del ledger ni SQL directo aislado. El flujo coincide con la [documentación de migraciones de Supabase](https://supabase.com/docs/guides/deployment/database-migrations): `db push` aplica pendientes y conserva `supabase_migrations.schema_migrations`.

Aplicación del coordinador: exit 0 a las 16:32:36 UTC, evidencia `migration-apply-1788539556769.json`. La relectura a las 16:33:04 UTC confirma 56 migraciones, ninguna pendiente y `declared_phone`: `text`, nullable, sin default. Evidencia `db-preflight-2026-09-04T16-33-04-973Z.json`, SHA-256 `ed7edeaaf485f366443edbf487cac443209d1eb22b3fd8fd254043d8675e67e3`. Ante rollback de código se conserva la columna aditiva. Este subagente no ejecutó SQL remoto de escritura.

## Vercel y flags

Proyecto `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM`, `studyx-agente-ventas`, team `team_G25HixfcqzQ8ExR1GuKNEURb`. Lectura de producción a las 16:32:31 UTC:

| Configuración | Estado comprobado | Configuración prevista para paridad |
| --- | --- | --- |
| `AGENT_A_BRAIN_V1_ENABLED` | `true`, exportable | `true` |
| `AGENT_A_BRAIN_V1_SHADOW` | `false`, exportable | `false` |
| `CONVERSATION_PIPELINE_V1_ENABLED` | `true`, exportable | `false`, como el laboratorio |
| `AGENT_A_CONTEXT_SCOPING` | Existe, Sensitive; valor desconocido | Fijar `false` |
| `AGENT_A_REPAIR_ENABLED` | Existe, Sensitive; valor desconocido | Fijar `true` |
| `AGENT_A_SINGLE_ROUTE` | Existe, Sensitive; valor desconocido | Fijar `true` |
| `AGENT_A_STATE_ASSERTIONS` | Existe, Sensitive; valor desconocido | Fijar `true` |
| `PAYMENT_PROVIDER` | No definido | Default `fake` |
| `VOICE_PROVIDER` | No definido | Default `telegram_sandbox` |

Los valores Sensitive son write-only; una descarga CLI vacía no demuestra una variable remota vacía. Así lo documenta [Vercel](https://vercel.com/docs/environment-variables/sensitive-environment-variables). El primer export sanitizado `vercel-env-2026-09-04T16-30-37-929Z.json` midió sólo disponibilidad en el proceso de descarga: **sus `false`/vacíos de Sensitive no son ausencia runtime**. La evidencia corregida `vercel-env-2026-09-04T16-32-31-198Z.json` conserva esa incertidumbre como `null` y `SENSITIVE_WRITE_ONLY`. No se intentó extraer valores mediante un endpoint de revelación.

Lectura pública, sin llamadas de modelo: `/api/health` y `/api/ready` devolvieron 200 a las 16:40:45 UTC. El deployment anterior se identifica como commit `1ad468d7a1f3b3a71cdfe3b0b2cd48ffecc0fead`; readiness informó configuración requerida, brain, PostgreSQL y snapshot comercial OK. Esto acredita presencia runtime de las tres variables de link y del workspace, no sus valores ni la paridad de los cuatro flags Sensitive. El coordinador fijará explícitamente los flags al construir/desplegar y verificará el commit nuevo. No se consultó `/api/diagnostics`, porque su probe Gemini realiza una llamada real.

## Catálogo y entrega del link

Lectura SQL remota de sólo agregados/catálogo a las 16:35:17 UTC: workspace `studyx`, `production`, activo; 45 ofertas, 40 activas; las activas tienen importe canónico USD 360. No hay filas en `offering_payment_configs`. Esa tabla sirve al flujo Checkout y no es requisito de la acción actual `send_payment_link`, cuyo resolver lee exclusivamente las variables siguientes:

| Plan | Presentación canónica | Configuración de URL |
| --- | --- | --- |
| `monthly_12` | 12 pagos de USD 30 | `PAYMENT_LINK_12M` presente, Sensitive |
| `monthly_6` | 6 pagos de USD 60 | `PAYMENT_LINK_6M` presente, Sensitive |
| `one_time` | Un pago de USD 360 | `PAYMENT_LINK_CONTADO` presente, Sensitive |

`materializePaymentLinkAction` revalida permiso, plan y oferta; `createConfigPaymentLinkResolver` acepta la URL Stripe configurada y arma texto autorizado. Ese recorrido no crea un Checkout ni llama a Stripe. La identidad sandbox no bloquea la entrega de ese texto. Las URLs `example.invalid` del laboratorio no están habilitadas contra la base remota.

El usuario autorizó recibir los enlaces configurados, sin pagar. Por eso se conservan: no se sustituyen por fake. Su modo test/live no pudo determinarse por lectura de secretos; `PAYMENT_PROVIDER=fake` no transforma una URL de Stripe en una URL sin cobro. El canario debe comprobar recepción y correspondencia con el plan, sin completar un pago. La presencia en readiness no sustituye esa prueba visible ni demuestra entrega a Telegram.

## Candado sandbox: defecto encontrado y corrección

Antes del arreglo, `telegram-envelope.ts` enviaba `sandbox_provider=telegram_sandbox`, pero `persistInbound` no llamaba `registerSandboxIdentity`. La fila en `channel_threads` no activa por sí sola el candado de `sandbox.service.ts`: éste consulta `sandbox_identities`. Un agregado remoto, sin IDs ni datos personales, encontró 195 contactos asociados a threads sandbox y 181 sin la fila de candado. No se realizó backfill ni se modificó ninguno de esos contactos.

Cambio autorizado en `src/lib/services/ingestion.service.ts`: después de resolver/bloquear el contacto, y antes de capturar identidad o guardar el mensaje, registra `sandbox_identities` dentro de la misma transacción sólo si el envelope declara explícitamente el proveedor sandbox. No infiere sandbox a partir de `+999`. Verifica el contacto resultante tras `ON CONFLICT`; un usuario externo ya ligado a otro contacto provoca `SANDBOX_IDENTITY_CONFLICT` y rollback. Un contacto existente queda protegido al ingresar su siguiente mensaje sandbox nuevo. Los replay ya persistidos mantienen la ruta de idempotencia; no se presenta esto como reparación masiva del histórico.

SHA-256 del source estabilizado: `bb3daf1462f9c34279a73e3ec1556e5478246210aa6ada5f446ad0d26c607d08`. Test nuevo `tests/integration/telegram-sandbox-intake.test.ts`, SHA-256 `ac340b67e21e7bb8b32b69e0a1c57c18825909d5761add00b0729893d558db76`.

Comando focal, sin cargar `.env.local` y sobre base desechable explícita:

```sh
env -u DATABASE_URL -u GEMINI_API_KEY -u DEEPSEEK_API_KEY \
  TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_integration_20260904 \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/telegram-sandbox-intake.test.ts
```

RED: 4 fallos/1 aprobado; GREEN: 5/5, a las 16:38:46 UTC. Logs `sandbox-intake-red-final.log` y `sandbox-intake-green.log`. Los casos comprueban primer registro, replay/follow-up idempotentes, contacto existente, ausencia de inferencia por prefijo y rollback de conflicto. El caso Sheets utiliza el adaptador real y lookup de PostgreSQL, con cliente Google simulado como última frontera: exige `CONTACT_IS_SANDBOX` antes de construir ese cliente y cero llamadas a `values.update`. ESLint de los dos archivos: exit 0. El fix no consumió API ni escribió en la base remota; requiere el build y despliegue nuevos coordinados por root.

## Aceptación de llamada y Sheets durante el canario

`request_call_now` puede registrar una sesión durable con proveedor `telegram_sandbox`; eso no demuestra una llamada realizada. El endpoint `api/agent/calls/[call_id]/dispatch` sólo construye `TelegramSimVoiceProvider`; un proveedor distinto devuelve `VOICE_PROVIDER_NOT_IMPLEMENTED`, sin implementación Retell. Las cuatro variables `TELEGRAM_AGENT_B_*` requeridas no están configuradas en este proyecto. El intento de dispatch, si se solicita, termina `AGENT_B_DISPATCH_ERROR` antes de construir cliente/red: no integrar Agente B ni comunicar ese registro como ejecución exitosa. La configuración de Botpress y el resultado visible siguen siendo responsabilidad del coordinador del canario.

`GoogleSheetsProvider.updateRow` ejecuta `assertRealSideEffectAllowed` antes de crear credenciales/cliente y antes de `spreadsheets.values.update`. Una vez persistida la fila sandbox por el nuevo intake, el contacto queda bloqueado para esa escritura real aunque existan credenciales de Sheets. Una proyección/outbox local durable no equivale a una fila exportada a Google. El canario debe verificar el candado durable del contacto que acaba de escribir antes de aceptar una acción comercial.

## Intake etiquetado encontrado en la regresión V20

La corrida live posterior, ejecutada por el coordinador, falló con un formulario que separaba `nombre`, `apellido`, `correo` y teléfono mediante punto y coma, sin dos puntos después de cada etiqueta. El snapshot `workflow-call-first-sale-2026-09-04T16-40-59-391Z-8ebe8071-1ce8-49e0-840a-ff5944c35ad8.json` conserva `name=null` y correo/teléfono correctamente persistidos. El pedido posterior de correo es una equivocación semántica del modelo; no fue un fallo de extracción de email.

Se corrigió `src/lib/heuristics/contact-identity.ts` para combinar campos explícitos `nombre(s)`/`apellido(s)`, con dos puntos opcionales y separados por punto y coma o salto de línea. Se exige encabezado propio o formulario completo al inicio, correo contiguo al bloque y capitalización plausible. No se cambió la captura de email ni se agregó conocimiento de nombres concretos. Tres casos nuevos positivos —incluido el input live exacto— y ocho negativos cubren negación, terceros, curso, ambigüedad, minúsculas y apellido ausente. RED 3 fallos/47 aprobados → GREEN 50/50 a las 16:45:09 UTC; ESLint exit 0. Logs `contact-labeled-red.log` y `contact-labeled-green.log`. SHA-256 source `ba005603d9725081947eca8c98980ee6a854718c2003e4fa13a765100e4440f0`; test `f943267d75fdd901cde5390bd2a58a861904ffebdd81f34be6c48f2abc0abebb`. Este fix requiere build y regresión coordinados; las unitarias no acreditan una conversación live exitosa.

Toda la evidencia sanitizada está bajo `.eval/codex-20260904/deploy-backend/`. No se guardaron secretos, datos reales de contactos ni URLs completas de pago en este informe. Este subagente no consumió API. El coordinador informó después de V20 un acumulado de USD 0,844721136 y margen USD 0,155278864; el corte anterior V19 de USD 0,823283696 permanece como evidencia histórica, sin reiniciar el presupuesto.
