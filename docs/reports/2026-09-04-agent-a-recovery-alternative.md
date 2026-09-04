# Alternativa local de recuperación — 2026-09-04

Se preparó un bundle ADK desde el commit **`360cd37201a35bf3c4cceb82a93e809885494529`**, candidato local anterior de esta campaña. Es una alternativa concreta para revisión y eventual autorización. **No recupera ni identifica el JavaScript desplegado en Botpress el 3 de septiembre. No se desplegó.**

Esta preparación no aprueba la calidad conversacional del candidato ni reemplaza la evaluación del candidato actual. El baseline conserva brain V14/canónico V4; no contiene las correcciones posteriores de V15–V18, los dos guards ni la extracción de identidad corregidos después de ese commit. La selección de esta base fue una instrucción del coordinador; no se infirió a partir de la fecha remota.

## Artefactos disponibles

Directorio completo actual, externo al worktree:

```text
/private/tmp/studyx-recovery-360cd37-20260904/
```

La copia completa se movió después del build para impedir que lint analizara el bundle y la fuente extraída. No se recompiló ni modificó ningún artefacto. Las rutas originales de build en manifiesto, logs y sourcemap quedan preservadas como procedencia. `relocation.json`, junto al manifiesto original, registra la ruta anterior `.eval/codex-20260904/rollback-360cd37/`, la ubicación actual y el SHA del manifiesto sin alterarlo.

La evidencia compacta para el paquete final permanece en el worktree en:

```text
.eval/codex-20260904/recovery-360cd37-artifacts/
```

Ese directorio contiene solamente los dos archivos comprimidos de la tabla, manifiesto, resumen de hashes, snapshot sanitizado, `relocation.json`, resultado/log de build, registro de extracción y perfil de sandbox. No contiene fuente ni JavaScript descomprimido. Los hashes de las copias de archivo y manifiesto se verificaron idénticos después del traslado. No se añadieron exclusiones globales de lint.

| Archivo relativo a ese directorio | Bytes | SHA-256 |
| --- | ---: | --- |
| `artifacts/index.cjs` — JavaScript a revisar | 19247672 | `77bd1d1ea5d3982be92c9e1bf1ae1745514cf83c569cf435b348164b9777bbd5` |
| `recovery-artifacts-360cd37.tar.gz` — bundle, sourcemap, definición y metadatos | 5996040 | `9897fbb908c26f3527d02b52597de075ab6c00d86564ef3ef143bb08f60cdac8` |
| `source-360cd37201a35bf3c4cceb82a93e809885494529.tar` — `git archive` completo | 10117120 | `d2d68e737cd771cfe300d03b7a6e553ae9ccd43d098eeccce4be1708c915deea` |
| `recovery-manifest.json` — procedencia, versiones, límites y hashes individuales | — | `1c7a408e3e3a3a31b8c611c7d1fc1f2ea143efa80e81e3090e81ffe137c58000` |
| `remote-production-before.sanitized.json` — copia de observación previa | — | `ab810a3dc8e1cebf7a3e9de32d629beff7a3e9de32d629beff7a55b35147477227a742418594682ae` |

El paquete también conserva `index.cjs.map`, `bot.definition.ts`, `agent.config.ts`, `agent.json`, ambos lockfiles, `build-result.json`, `extraction.json` y la configuración remota sanitizada. El código fuente completo queda en el tar separado. `build-offline.log`, `offline-build.sb` y la copia extraída `source/` permiten inspeccionar la ejecución local. No se incluyeron valores de secretos ni perfiles de autenticación.

## Construcción y límites comprobados

1. Se ejecutó `git archive` del commit indicado hacia scratch propio. Se omitieron al extraer cinco symlinks absolutos de skills `.claude/skills/adk*`; no son entradas del build. Los **910 archivos regulares** extraídos se compararon byte a byte con el tar después de compilar: ninguno cambió, incluidos `agent.config.ts` y `agent.json`.
2. Se enlazaron las dependencias ya instaladas del proyecto y se copiaron tres interfaces compilables locales: `interface_Listable`, `interface_Llm` e `interface_TypingIndicator`. No hubo instalación ni descarga. Versiones: ADK CLI/runtime 2.0.5, Botpress CLI 6.8.13, SDK 6.11.2, Node v25.9.0 y Bun 1.3.12.
3. Se ejecutó `adk build --format json` en `source/botpress-agent` del scratch, entre `2026-09-04T15:36:13.696853Z` y `15:36:21.171724Z`. Exit code **0**, resultado `success: true` y los dos archivos de salida existentes. No se ejecutó `adk deploy`, `bp deploy` ni un dry-run remoto.
4. El proceso recibió un entorno explícito sin claves, telemetría deshabilitada y cache de paquetes offline. Una sandbox local negó toda conexión de red, lectura de `~/.botpress` y escrituras fuera del scratch/temporales. El CLI intentó consultar assets remotos; la sandbox lo bloqueó con `FailedToOpenSocket` y el CLI continuó. **No se obtuvo ni verificó el conjunto remoto de assets.** No se habilitó acceso ni se reintentó con credenciales.
5. La versión instalada de `adk build` carga el entorno de dependencias `dev`. El archivo Git no contiene snapshot `dev`; las quince integraciones y los dos plugins observados en producción no se reconstruyeron como definición de despliegue. El bundle local es una base ejecutable compilada, **no un paquete completo de configuración/dependencias de producción**. No aplicar su `bot.definition.ts` como reemplazo de la definición remota.

La comprobación de esta tarea fue construcción y procedencia del artefacto. No se ejecutaron modelos, DB, workflow, Telegram, pruebas de compatibilidad remota ni nuevos tests de comportamiento. Gasto añadido: **USD 0**. La revisión histórica exacta continúa documentada en `2026-09-04-agent-a-rollback-followup.md`.

## Configuración remota preservada

Se copió sin alterar `.eval/codex-20260904/botpress-production-before.json`. Identifica STUDYX, bot `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`, workspace `wkspace_01M0X4K3H2EE7RGM39Q29GF6VS`, observación de despliegue `2026-09-03T10:50:31.859Z`. Conserva los cinco valores operativos sanitizados previamente capturados:

| Campo | Observación previa |
| --- | --- |
| `apiBaseUrl` | `https://studyx-agente-ventas.vercel.app` |
| `automationEnabled` | `true` |
| `agentAPlannerlessV2Enabled` | `true` |
| `agentABrainDeepSeekModel` | `deepseek-v4-flash` |
| `requestTimeoutMs` | `8000` |

Incluye además IDs, versiones, estados y enabled de quince integraciones y nueve nombres de secretos. Es una observación parcial y anterior; **no es un backup completo de configuración secreta ni prueba de estado remoto actual**. No copiar ese JSON entero a `updateBot`, ni rellenar campos omitidos con defaults. Los secretos existentes deben conservarse por su mecanismo de provisionamiento; sus valores no están en el paquete.

## Restauración propuesta, pendiente de aprobación y compatibilidad

La decisión revisable es: aceptar este baseline independiente y sus límites como recuperación alternativa. Aprobarlo no lo transforma en el bundle remoto perdido. Si el requisito exige recuperar exactamente el despliegue anterior, este archivo no satisface ese requisito y hace falta el artefacto del proveedor o un recibo histórico que lo vincule.

Antes de una restauración autorizada:

1. Verificar de nuevo el hash de `artifacts/index.cjs` contra el manifiesto y conservar los bytes. **No ejecutar `adk deploy` sobre esta carpeta:** reconstruye el código y podría aplicar una definición sin las dependencias de producción. Tampoco usar `bp deploy --no-build` sin revisar todos sus efectos de definición/dependencias/tablas.
2. Confirmar la compatibilidad del baseline con backend/schema/flags y con las integraciones/plugins/assets que conservará el bot remoto. El tar contiene la fuente backend del mismo commit, pero esta tarea no construyó ni preparó su despliegue Vercel. La existencia del deployment Vercel previo `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji` no acredita compatibilidad con este bundle local. Si esa compatibilidad no puede verificarse, la restauración sigue pendiente.
3. Consultar, en la intervención autorizada, el estado actual de bot/configuración/dependencias y registrar cualquier diferencia respecto del snapshot. No restaurar automáticamente flags antiguos ni borrar valores omitidos. Confirmar disponibilidad de secretos mediante su almacenamiento legítimo, sin incorporarlos al artefacto.
4. Si se autoriza una restauración **sólo de código** y sus contratos son compatibles, la operación que admite el SDK instalado es `client.updateBot({ id: BOT_ID, code: bundleUtf8 })`. `bundleUtf8` debe provenir del `artifacts/index.cjs` cuyo SHA figura arriba. Omitir `configuration`, `integrations`, plugins, tablas y otros campos para no aplicar los defaults del build local. Esta instrucción describe la operación propuesta; no se ejecutó ni se generó un script que la aplique automáticamente.
5. Registrar SHA de los bytes enviados, bot ID, hora y respuesta de la actualización; después comprobar workflow real, persistencia y entrega con canario autorizado y presupuesto restante. Leer metadatos por sí solo no prueba que el código funcione ni permite descargar su SHA remoto. Si el canario falla, mantener la automatización bajo el control operativo autorizado y conservar las evidencias; no declarar recuperación exitosa por build verde.

Estado: **artefacto local construido y trazable; aprobación de baseline, compatibilidad y restauración pendientes**. El worktree fuente y los recursos remotos no fueron modificados por esta preparación.

## Límite conocido de la versión alternativa

El commit360cd37 contiene brainV14. Su evaluación live posterior expuso el contrato de repair_of incompatible y cuatro reparaciones sin éxito; la evidencia está preservada en el informe live. Esta compilación offline no corrige esos defectos ni certifica calidad. No debe confundirse una alternativa técnicamente compilable con un retorno a experiencia productiva verificada.
