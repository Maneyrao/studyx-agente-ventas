# Seguimiento de recuperación Botpress — 2026-09-04

## Resultado

No encontré una operación soportada por el SDK/CLI instalado o por la API pública revisada que descargue el JavaScript ADK actualmente ejecutado por STUDYX o restaure ese despliegue exacto sin un artefacto previo. **La recuperación exacta del despliegue del 3 de septiembre sigue sin estar certificada.** Esto describe las capacidades y evidencia disponibles; no afirma que el proveedor carezca de copias internas.

La consulta actual confirma que el bot `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b` continúa `active`, de tipo `adk`, con `deployedAt = 2026-09-03T10:50:31.859Z`. Observación: `2026-09-04T14:19:03.598Z`. No hubo despliegues, cambios de configuración, llamadas a modelos, lectura de conversaciones/contactos, migraciones ni compilaciones en esta investigación. Gasto de modelos añadido: USD 0.

El checkpoint local `ad15baafb63e8c55cb877f943a74e57c2899deda` **no identifica el código remoto**. Un build de ese commit sería una recuperación desde una base local, con verificación propia; no un rollback certificado del bot que hoy atiende.

## Evidencia nueva, de lectura

Se utilizó el perfil Botpress local existente, exclusivamente en memoria. No se imprimieron tokens, valores de configuración, credenciales ni URLs firmadas. Los cuerpos remotos se inspeccionaron en memoria y no se guardaron en el repositorio; este documento contiene sólo los resultados sanitizados.

| Recurso | Resultado verificable | Consecuencia |
| --- | --- | --- |
| `getBot({ id })` | Devuelve metadatos, configuración, dependencias y tags; no contiene `code`, bundle, referencia a versión de ejecución ni hash de código. La única clave de despliegue en el nivel superior es `deployedAt`. | Sirve para identificar el bot y estado, no para obtener su implementación. |
| Tag `botContentFileId` → `getFile` | `file_01M0X4WMS2FY6PRKJSJQAXY4XA`, `application/json`, 241552 bytes, creado/actualizado `2026-08-25T19:03:26.747Z`; purpose `bot-content`. | Es una referencia residual al contenido Studio; no corresponde al bundle ADK del 3 de septiembre. |
| JSON de ese `bot-content` | SHA-256 `142c43e959fc68ba3b349270d605ec256fe5a2c62233f99591ef40c607c3ae98`. Contiene `flows`, `settings`, `agents`, `hooks`, `knowledge_base` y otros campos de Studio; no contiene un campo de código ADK. | No usar como rollback ADK. El tag `dmHash` tampoco quedó acreditado como hash del JavaScript ejecutable. |
| `listFiles`, filtrado por `{type:"adk-deployed-agent-manifest",schemaVersion:"1"}` | Un único archivo, sin siguiente página: `file_01M11H9A13J9TX3V2PHC6EKVSW`, key `.adk/deployed-agent-manifest.json`, 141194 bytes. Creado `2026-08-27T11:57:02.363Z`, actualizado `2026-09-03T10:50:53.509Z`. | Existe un manifiesto ADK vinculado temporalmente al despliegue investigado. |
| Contenido de ese manifiesto ADK | `generatedAt = 2026-09-03T10:50:53.270Z`; SHA-256 `78378f0ecca2476cb213b8f86b167556559f87e61fe3dc02615d2a0a02de22df`; claves superiores `agent`, `generatedAt`, `primitives`, `schemaVersion`. | Es evidencia del contrato/descripciones desplegados, no un bundle ni un hash de bundle. |
| Primitivas del manifiesto | 8 actions, 3 workflows, 1 conversation; sin tools, triggers, tables, knowledge ni customComponents. Cada `source` sólo aporta `path` y `exportName`. Las definiciones contienen esquemas, nombres, descripciones y opciones; no los cuerpos de las funciones. | No permite reconstruir la implementación exacta. Incluye `src/workflows/processInboundTurn.ts` y `src/conversations/router.ts`, sin commit ni contenido fuente. |
| `getAuditRecords` del workspace | La primera página alcanza el 31 de agosto e incluye `DEPLOY_BOT` para STUDYX: `audit_01M1KE8TSDGYC5B1ZEZG6173XE`, `2026-09-03T10:50:40.815Z`; seguido por `UPDATE_BOT`: `audit_01M1KE940KZX1QMJVFP2BBEJY5`, `2026-09-03T10:50:50.260Z`. Ambos sin `value`. | Confirma la operación, pero no proporciona versión, código, hash ni referencia recuperable. No hizo falta paginar a registros más antiguos. |

El resultado previo del coordinador de `listBotVersions` fue una lista vacía; no se repitió ni se inventó un `versionId`. `getBotJson` ya fue descartado como contenido Studio y no se trató como archivo ejecutable.

## Qué hace realmente el software instalado

Versiones inspeccionadas: `@botpress/client 1.46.0`, `@botpress/cli 6.8.13`, `@botpress/adk-cli 2.0.5`.

1. En `botpress-agent/node_modules/@botpress/client/dist/index.d.ts`, `GetBotRequestQuery` está vacío; `GetBotResponse` no incluye código ni una opción para pedirlo. `UpdateBotRequestBody` sí acepta `code`. `GetBotVersionResponse` devuelve una URL, pero exige un `versionId` existente; no hay un identificador de versión recuperable en la evidencia actual. La documentación pública coincide con la diferencia entre [obtener metadatos](https://botpress.com/docs/api-reference/admin-api/openapi/getBot/) y [subir JavaScript al actualizar](https://botpress.com/docs/api-reference/admin-api/openapi/updateBot/).

2. `botpress-agent/node_modules/@botpress/cli/dist/command-implementations/deploy-command.js:379` lee el archivo `outFileCJS` y lo envía en `updateBotBody.code` a `client.updateBot`. `dist/consts.js:78` identifica el archivo de salida como `dist/index.cjs`. La implementación instalada no guarda una versión ejecutable remota descargable al completar la operación; el [código primario del CLI](https://github.com/botpress/botpress/blob/master/packages/cli/src/command-implementations/deploy-command.ts) documenta el mismo mecanismo.

3. El ADK instalado ejecuta `adkBuild` durante `adkDeploy`, antes de invocar el CLI con `--noBuild`. Referencias locales: `node_modules/@botpress/adk-cli/dist/chunk-cjmk2xvw.js:393` y `chunk-p0hjqn4r.js:121515`. Por lo tanto, ejecutar nuevamente `adk deploy` **reconstruye**; no conserva por sí mismo los bytes de un bundle archivado. El CLI inferior sí dispone de [`bp deploy --no-build`](https://botpress.com/docs/integrations/sdk/cli-reference/), aunque además actualiza definición/dependencias y publica tablas según el proyecto. No se ejecutó ninguno de ellos.

4. El manifiesto remoto se fabrica en `chunk-p0hjqn4r.js:122881`: registra definiciones y referencias `source.path`/`source.exportName`, luego sube un JSON a la misma key `.adk/deployed-agent-manifest.json`. El serializador no incorpora el cuerpo ejecutable ni su SHA. Su hash identifica ese JSON únicamente.

5. `adk export` **sí existe** en esta versión, pero exporta el proyecto local. `chunk-hyhtg415.js` obtiene `project.path`, consulta sólo las dependencias Cloud y entrega esa ruta local a `createAdkArchive`. `chunk-73xfqhym.js:29` excluye `.adk`, `dist` y `node_modules` del archivo. No es una descarga del agente remoto ni conserva el bundle compilado. `adk dependencies export` sólo exporta dependencias; la [documentación oficial de dependencias](https://www.botpress.com/docs/adk-v2/setup/managing-dependencies/) separa esa operación del código del agente.

6. `adk assets pull` descarga archivos estáticos, según la [referencia oficial del CLI](https://botpress.com/docs/adk-v1-17/cli/cli-reference/). No es un comando de recuperación del ejecutable ADK. No se encontraron comandos de rollback o descarga de ejecutable en el registro de comandos del ADK/CLI instalado.

## Condiciones concretas para recuperar

**Para restaurar exactamente el despliegue hoy activo:** hace falta obtener el JavaScript enviado el `2026-09-03T10:50:31.859Z`, o una versión del proveedor que pueda restaurarlo, junto con evidencia que lo vincule a este bot/despliegue. Son fuentes válidas un archivo previo de la petición de deploy, un bundle archivado con registro de subida y hash, o una recuperación asistida por Botpress usando bot ID, timestamp y audit ID anteriores. No alcanza una coincidencia de fecha de commit ni el manifiesto de primitivas. No se contactó al proveedor porque esta tarea sólo autoriza consultas de lectura.

**Si se acepta una recuperación desde una base local:** el coordinador puede seleccionar explícitamente una base conocida —por ejemplo el checkpoint `ad15ba…`— y construirla en un directorio aislado, sin llamarla copia de producción. Debe verificar su comportamiento y compatibilidad con el backend/schema/flags reales antes de usarla. El procedimiento local pendiente ya está descrito en `docs/reports/2026-09-04-agent-a-integration-triage.md`; no se ejecutó aquí.

Para que esa alternativa sea un destino de recuperación verificable, antes del siguiente despliegue se necesita:

- Archivar fuera de Git el `botpress-agent/.adk/bot/.botpress/dist/index.cjs` exacto y su SHA-256, además del source commit, lockfiles, versiones de herramientas y definición generada necesarios para interpretar sus contratos. Preservar configuraciones/dependencias y referencias de secretos en un almacenamiento privado; una exportación pública sin configuración no basta para restaurar toda la operación.
- Asociar los bytes archivados con los bytes enviados por la operación de deploy, sin rebuild entre el hash y la subida. Registrar bot ID, timestamp y resultado de la operación. Un hash del árbol fuente o del manifiesto de primitivas no sustituye el hash del JavaScript enviado.
- Mantener alineados el candidato Botpress y el backend/schema/flags. Restaurar sólo `code` por `updateBot` es técnicamente posible, pero sólo es una recuperación válida cuando sus contratos y dependencias siguen siendo compatibles. Un `bp deploy --no-build` exige revisar también los cambios de definición/dependencias/tablas que ese comando realiza.
- Validar persistencia y entrega por el workflow y canario autorizados, con el presupuesto acumulado controlado por el coordinador. Guardar las transcripciones y evidencias que identifiquen el despliegue que las produjo.

Esto habilita una base de recuperación conocida hacia adelante. No elimina retrospectivamente la falta del artefacto anterior ni convierte `ad15ba…` en el SHA del bot remoto.

## Estado de cierre

Investigación de lectura completada. Sólo se añadió este informe. No se creó un archivo de recuperación, no se compiló, no se desplegó y no se modificó ningún recurso remoto. La decisión pendiente es si las condiciones vigentes exigen el rollback exacto anterior —requiere el artefacto o asistencia del proveedor— o admiten una recuperación desde un baseline independiente y verificado. El coordinador debe conservar esa distinción al evaluar la autorización de despliegue.

## Búsqueda local complementaria de bundles y respaldos

El segundo encargo se limitó a filesystem, nombres, metadatos y hashes: **sin nuevas APIs ni builds**. Se recorrió el workspace `/Users/tmaneyro22/Documents/AGENTE IA`, el checkout principal, los worktrees existentes de StudyX y el worktree hermano `studyx-feature2-aburridont`. Se excluyeron dependencias instaladas, datos de Git, salidas Next, logs, trazas y conversaciones. Los dos worktrees temporales que Git conserva como `prunable` apuntan a ubicaciones inexistentes; no se borró ni reparó ninguno.

Todos los bundles encontrados están en `botpress-agent/.adk/bot/.botpress/dist/index.cjs`, relativos a cada checkout de la tabla. Se calcularon hashes sobre los archivos existentes, sin reconstruirlos. Los tiempos son `mtime` UTC y no constituyen prueba de subida.

| Checkout dentro de `studyx-agente-ventas` | `mtime` UTC | Bytes | SHA-256 local |
| --- | --- | --- | --- |
| Principal | `2026-08-26T00:24:28.451779Z` | 20893666 | `afc24010793ae86f0f163a0b3c6a7d47ae7a08fec42c2b05c3938721894dc1c0` |
| `.worktrees/agent-a-chanl-evals` | `2026-09-02T02:59:48.388356Z` | 19177212 | `6880c6aee12e4cace82f2496631793ac7e2ba7ec50eb87be9063de27b6d8ea75` |
| `.worktrees/agent-a-outbound-prod-deploy` | `2026-08-31T14:17:32.210993Z` | 22931484 | `163aeeea2e36ec22267b3e51b0537ad52c5b42d0483b2830d4677e845e5aeeed` |
| `.worktrees/agent-a-plannerless-v2` | `2026-09-04T14:33:50.510562Z` | 19247941 | `ab969e7adf1a099f47725a3e6802850f54eae4c871053b3d924644e90069d5e7` |
| `.worktrees/agent-a-state-continuity-fix` | `2026-08-31T14:01:36.653679Z` | 19062278 | `05db5cc2701768cf2d473108e7f44c26c002f994cfdad4e897a9db366cb18a44` |
| `.worktrees/latency-hotpath` | `2026-08-22T12:48:59.987088Z` | 18290994 | `0c07998bded83516d0c677cc799e57cd9381e1af9bb6a7efcc6dabedfad22250` |
| `.worktrees/whatsapp-demo` | `2026-08-25T21:10:19.493210Z` | 18651598 | `53cdb7cbab1e714dc5c7996eb3aded1c040b1ab84faddb0ccd73359401791680` |

Los siete tienen sourcemaps adyacentes con fechas del mismo build. No apareció un bundle del 3 de septiembre, un archivo local del manifiesto ADK remoto acompañado por su implementación, ni otro ejecutable grande fuera de estos bundles. Los archivos comprimidos encontrados en el workspace corresponden a evidencias de las pruebas del 4 de septiembre. No se encontró un archivo `.adk`, `.bpz`, ZIP o tar de recuperación. El único elemento de `.backups` es un dump Supabase anterior del 5 de agosto; se inspeccionó su nombre, no su contenido, y no es un respaldo de Botpress.

Para buscar respaldos de Claude sin recorrer HOME de forma amplia, se identificaron sólo los siete directorios de proyecto cuyo nombre corresponde exactamente al checkout StudyX o sus worktrees. Se tomaron los nombres de sus 118 archivos de sesión, **sin abrir los JSONL de conversaciones**, y se verificaron únicamente sus directorios homónimos en `/Users/tmaneyro22/.claude/file-history`. Tres sesiones del checkout principal conservan 106 archivos de respaldo; el mayor ocupa 27914 bytes y ninguno tiene `mtime` del 3 de septiembre UTC. Los demás proyectos —incluidos `agent-a-chanl-evals`, `agent-a-outbound-prod-deploy` y `agent-a-plannerless-v2`— no tienen directorios de respaldo asociados a esas sesiones. No se leyeron los contenidos de esos respaldos ni se buscaron claves.

La búsqueda de referencias exactas al timestamp, al deployment Vercel anterior y a SHA de artefacto en documentación local no aportó un recibo histórico de deploy ni una asociación entre alguno de estos bundles y el bot remoto. Las referencias encontradas son las observaciones de esta campaña del 4 de septiembre. `.claude/CLAUDE.md.bak` es un respaldo de instrucciones, no un ejecutable.

**Conclusión local: el despliegue Botpress del 3 de septiembre no es recuperable de manera exacta con los artefactos locales encontrados.** El bundle más próximo es anterior y no tiene prueba de correspondencia remota; el actual fue compilado durante esta campaña. Ningún hash de esta tabla puede compararse con un SHA remoto del ejecutable porque ese SHA no está disponible. No se designó ni aprobó un baseline alternativo y no se creó uno. Las condiciones hipotéticas de la sección anterior no constituyen autorización para reemplazar el requisito de rollback.
