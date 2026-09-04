# Incidente de empaquetado de Vercel CLI — 2026-09-04

El intento de despliegue con Vercel CLI 58.9.4 y `--archive=tgz` empaquetó recursivamente directorios que el listado previo mostraba como entradas vacías. Entre esos directorios estaban `.eval` y `botpress-agent`, excluidos por `.vercelignore`. El coordinador detuvo el proceso durante la carga. **No se puede afirmar que los archivos privados permanecieran exclusivamente en la máquina ni que Vercel haya eliminado los bytes recibidos.** Tampoco hay evidencia de una publicación pública de ese paquete.

Esta investigación sólo leyó código del CLI, metadatos de archivos y documentación pública. No volvió a empaquetar, cargar ni desplegar el árbol; no leyó valores de credenciales ni envió mensajes a soporte. No modificó el runtime.

## Intento identificado

| Dato | Evidencia |
| --- | --- |
| Proyecto | `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM` / `studyx-agente-ventas` |
| Equipo | `team_G25HixfcqzQ8ExR1GuKNEURb` |
| Fuente prevista | Commit `07328e23f97054aeb92a108562f70b6ef3a88bb4` |
| CLI | Vercel 58.9.4, Node.js 25.9.0 |
| Proceso detenido por el coordinador | PID 35944 |
| Franja documentada en UTC | Creación del log `2026-09-04T16:55:13.699368Z`; última modificación `2026-09-04T16:55:57.118586Z`. Son tiempos del archivo, no recibos del servidor. |
| Log | `.eval/codex-20260904/deploy-backend/vercel-deploy-final.log`, 164 bytes, SHA-256 `4a19bd67a3704369dbcf22c8d8bfccdeba9f9b252578f1811ec0e46f72c28a98` |
| Última salida | Total anunciado `346.4MB`; último avance impreso `86.6MB/346.4MB`; sin deployment ID ni recibo de archivo en ese log. |
| Listado previo | `.eval/codex-20260904/deploy-backend/vercel-upload-dry.json`, SHA-256 `e2df28c6460aec250722098cae9e1c23c4ce6278fed643c5088e5156af7a6e72` |

El listado previo contiene **313 entradas y 2.149.381 bytes**: 298 archivos regulares y 15 directorios de tamaño cero. No constituye un inventario del tar producido posteriormente.

## Causa comprobada en el CLI instalado

La fuente primaria inspeccionada es `/opt/homebrew/lib/node_modules/vercel/dist/chunks/chunk-3GTCSDQR.js`:

1. `buildFileTree`, líneas 46155–46176, aplica el filtro de Vercel para construir `fileList`.
2. `collectDeploymentFiles`, líneas 53049–53058, deriva al empaquetador cuando `archive === "tgz"`.
3. `createTgzFiles`, líneas 52956–52974, pasa `fileList` como `entries` a `tar-fs.pack(workPath, { entries })`. No pasa el filtro ignore del recorrido previo.
4. `tar-fs` 1.16.3, líneas 52600–52645, vuelve a leer el contenido de cada directorio y añade sus hijos a una cola. Su filtro por defecto es una función vacía. No sigue los enlaces simbólicos por defecto, pero sí recorre todos los directorios reales incluidos.

Por ello una entrada de directorio vacía en el listado previo vuelve a incorporar sus descendientes en el archivo comprimido. El `.vercelignore` local sí excluye `.eval/`, `botpress-agent/`, `.tools/`, `.env` y `.env.*`; esas reglas no se vuelven a aplicar dentro de `tar-fs.pack`.

Los 15 directorios del listado son `.claude`, `.eval`, `.specify/extensions/agent-context/scripts`, `.specify/scripts`, `.superpowers`, `artifacts/rejected-drafts`, `botpress-agent`, `coverage`, `docs`, `scripts`, `specs`, `supabase/.temp`, `supabase/seed/data`, `supabase/tests` y `tests`.

## Alcance local y límites del inventario

El censo posterior, realizado con nombres, tamaños y tipos de archivo, encontró:

| Directorio | Archivos | Bytes sin comprimir | Observación |
| --- | ---: | ---: | --- |
| `.eval` | 329 | 60.157.581 | Una `.env` no identificada como example/sample/template, de 1.392 bytes; 26 archivos con `private` en el nombre; seis comprimidos. Las categorías se superponen y los nombres no equivalen a un conteo de secretos. |
| `botpress-agent` | 33.406 | 1.203.763.726 | Incluye dependencias, resultados de evaluaciones y artefactos ADK. |
| `botpress-agent/node_modules` | 31.305 | 869.626.482 | Principal contribuyente local al volumen, sin contar los demás directorios. |
| `docs` | 871 | 55.362.014 | Incluye evidencias comprimidas. |

El directorio `.tools` no existe en la raíz de este worktree. No explica por sí mismo el paquete. Los números anteriores describen el filesystem al investigar, que incluye archivos que continuaron cambiando: **no son un manifiesto exacto de los bytes enviados ni una atribución de tamaño comprimido por directorio**. Las copias privadas de configuración y el archivo de entorno bajo `.eval` deben considerarse dentro del alcance potencial del intento.

No apareció un tar ni partes `source.tgz.part*` en `.vercel` o las ubicaciones temporales pertinentes. El código explica por qué: comprime hacia buffers en memoria, no escribe esos nombres a disco. `@vercel/build-utils/dist/fs/stream-to-buffer.js:66` divide la secuencia gzip en bloques de 100 MiB. El total mostrado corresponde a cuatro partes lógicas llamadas `.vercel/source.tgz.part1` a `.vercel/source.tgz.part4`.

No se reconstruyó el tar para buscar sus SHA: el empaquetador incluye metadatos `mtime` y el propio log de carga ya cambió, por lo que una reconstrucción actual no acredita los mismos objetos que el intento detenido.

## Qué prueba la carga parcial

El CLI envía cada parte con `POST https://api.vercel.com/v2/files`, Bearer, contexto de equipo, `Content-Length`, `x-now-size` y `x-now-digest` SHA1. `uploadFiles`, líneas 47423–47555 del mismo chunk, permite hasta 50 operaciones concurrentes. No transmite necesariamente las cuatro partes en secuencia.

El contador incrementa cuando el stream cliente entrega bytes al transporte, antes de recibir HTTP 200. La interfaz imprime avances cada 25% cuando no hay TTY (`chunk-5OWYFCOQ.js:1257–1280`). Por tanto, el último `86.6MB` es un umbral de progreso impreso, no una confirmación remota ni el volumen definitivo recibido al detener el proceso.

La [API de carga de Vercel](https://vercel.com/docs/rest-api/deployments/upload-deployment-files) permite almacenar archivos antes de crear un deployment. El intento puede haber dejado partes completas o bytes parciales en el proveedor sin deployment ID. El log disponible no incluye SHA de las partes, respuestas HTTP 200 ni eventos `file-uploaded`; **cuáles partes fueron aceptadas, su retención y su eliminación permanecen desconocidas**.

El coordinador debe distinguir la eventual comprobación remota de ausencia de un deployment de la eliminación de archivos: son condiciones diferentes. Un listado de deployments limitado a este proyecto y esta franja puede detectar un ID inesperado; no demuestra que no existan cargas huérfanas.

## Acceso y recuperación

La [OpenAPI oficial](https://openapi.vercel.sh/), consultada en memoria, expone `POST /v2/files`, `GET /v6/deployments/{id}/files` y `GET /v8/deployments/{id}/files/{fileId}`. No apareció una operación pública de listado o borrado de archivos de carga huérfanos. El CLI inspeccionado tampoco implementa una limpieza de esas partes al interrumpirse.

La carga y la [lectura de contenido de archivos](https://vercel.com/docs/rest-api/deployments/get-deployment-file-contents) usan autenticación Bearer; la lectura requiere además un deployment ID. No se identificó una URL pública para las partes de este intento. Esto no certifica sus controles internos de retención o acceso. La [protección de fuente y logs](https://vercel.com/docs/project-configuration/security-settings) aplica por defecto a deployments, pero no demuestra el estado de los objetos huérfanos.

No se propone un `DELETE /files/{sha}` inventado. El [borrado de deployment](https://vercel.com/docs/rest-api/deployments/delete-a-deployment) necesita un ID real propio; borrar otro deployment no es una limpieza válida de este incidente y tampoco acredita purga de objetos compartidos.

La vía restante para confirmar almacenamiento y solicitar purga es soporte Vercel, aportando equipo, proyecto, franja UTC, CLI, total anunciado y log sanitizado anteriores, sin adjuntar el árbol ni archivos privados. No se contactó al proveedor. Debe pedirse que identifique las solicitudes `POST /v2/files`, determine partes aceptadas/retención y confirme cualquier eliminación. Mientras no exista respuesta verificable, no declarar el incidente saneado; evaluar por separado la rotación de credenciales potencialmente incluidas sin interrumpir integraciones a ciegas.

## Medida adoptada para el siguiente despliegue

El coordinador preparó un export efímero con los **298 archivos regulares** del listado previo, comprobando sus hashes y fijando el commit de fuente. El siguiente despliegue se ejecuta sin `--archive`, desde ese export. Esta medida evita reintroducir descendientes de directorios excluidos. El resultado de ese despliegue se registra en la evidencia general del candidato; no subsana por sí mismo la incertidumbre del intento anterior.
