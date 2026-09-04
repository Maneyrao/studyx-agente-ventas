# Preflight Botpress para prueba supervisada — 2026-09-04

El coordinador informó la autorización del usuario para desplegar y probar de forma supervisada, con calidad todavía no certificada. Este informe prepara la publicación y contingencia; **no se publicó código, pausó automatización ni ejecutó migración**. La instrucción comercial nueva —ofrecer llamada antes del cierre por chat y respetar rechazos— queda bajo el cambio y verificación del coordinador; este encargo no editó runtime ni prompt.

**Referencia final de código, después de corregir T6/T8:** SHA-256 `4b4de7e17f9602ab814dbdd17fe16537361482ba135d10013b3bc0a5350f011c`, build de producción del `2026-09-04T16:51:44Z`. Los hashes anteriores de este informe son históricos. La corrección de guards se describe al final; no cambió el prompt.

## Lectura remota y acceso

`getBot` autenticado pasó el `2026-09-04T16:28:39Z` mediante el perfil local legítimo `~/.botpress/profiles.json`, perfil `default`. La clave se usa sólo en memoria. El SDK instalado es `@botpress/client 1.46.0`.

| Campo | Observado |
| --- | --- |
| Bot / workspace | `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b` / `wkspace_01M0X4K3H2EE7RGM39Q29GF6VS` |
| Nombre / tipo / estado | STUDYX / adk / active |
| deployedAt / updatedAt | `2026-09-03T10:50:31.859Z` / `2026-09-03T10:50:50.238Z` |
| Backend configurado | `https://studyx-agente-ventas.vercel.app` |
| automationEnabled / plannerless | true / true |
| DeepSeek configurado | `deepseek-v4-flash` |
| Dependencias | 15 integraciones, 2 plugins |
| Telegram | 1.0.11, enabled, registered |
| WhatsApp | 4.18.5, enabled, registration_failed; estado previo, no provocado aquí |
| Configuración | 13 claves; contiene una firma privada que debe preservarse |
| Secretos | 9 nombres configurados, incluidos DeepSeek, Telegram, clave orquestadora y firma HMAC |

La lectura verifica acceso al bot; **no prueba permiso de escritura ni validez de las claves del modelo/canal**. No se llamó a DeepSeek ni se leyó contenido de chats/contactos. La captura completa queda privada, con permisos 0600, y no debe incorporarse a un paquete público de evidencia. La salida sanitizada es:

```text
.eval/codex-20260904/deploy-supervised/2026-09-04T16-28-39-610Z-preflight.sanitized.json
```

El helper también conserva configuración, integraciones/plugins y esquemas completos de cada lectura previa en un archivo privado. SHA del conjunto preservable observado: `6f5b99f65fb1ce5624acec8946c9e0a46bb474b417531324900ab85c83aa4ac2`.

## Publicación sólo de código

Helper preparado y comprobado con `node --check`:

```text
.eval/codex-20260904/deploy-supervised/botpress-code-only.mjs
```

El código del SDK instalado confirma estas operaciones:

- Lectura: **GET** `https://api.botpress.cloud/v1/admin/bots/2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`.
- Publicación: **PUT** al mismo endpoint. El argumento SDK es `{id, code}`; `id` va en el path y el cuerpo JSON transmitido contiene exclusivamente **`{"code":"<JavaScript UTF-8>"}`**. Los otros campos quedan `undefined` y no se serializan. No envía definición, manifiesto ADK, integraciones, plugins, configuración, secretos ni tablas.
- Autenticación: `Authorization: Bearer <token del perfil>` y `x-workspace-id: wkspace_01M0X4K3H2EE7RGM39Q29GF6VS`. No requiere poner el token en argumentos de shell.
- Timeout explícito: **60000 ms por request**. Reintentos automáticos: **0**. Debug del SDK: false.

No ejecutar `adk deploy` en reemplazo del helper: reconstruye y aplica otras partes de la definición. `bp deploy --no-build` también tiene efectos adicionales; no es equivalente a actualizar sólo `code`.

Desde el worktree, luego de completar backend/migración y congelar el bundle final, el coordinador ejecuta una lectura fresca:

```sh
node .eval/codex-20260904/deploy-supervised/botpress-code-only.mjs preflight
```

La salida indica el path exacto del nuevo preflight. Para publicar, `STUDYX_APPROVED_ADK_SHA256` debe ser el SHA del freeze aprobado por el coordinador y `STUDYX_PREFLIGHT_JSON` ese archivo recién obtenido. No calcular el SHA desde un bundle cualquiera como sustituto de elegir el freeze correcto:

```sh
node .eval/codex-20260904/deploy-supervised/botpress-code-only.mjs publish --apply \
  --bundle botpress-agent/.adk/bot/.botpress/dist/index.cjs \
  --sha256 "$STUDYX_APPROVED_ADK_SHA256" \
  --preflight "$STUDYX_PREFLIGHT_JSON"
```

Estos parámetros quedan deliberadamente a cargo del coordinador: el bundle final todavía puede cambiar al incorporar la instrucción de llamada. El helper relee el bot, exige mismo ID/tipo, `updatedAt` y digest de estado preservable que el preflight; lee una vez los bytes y exige SHA exacto y UTF-8 sin pérdida. Registra intención antes del PUT y recibo al completar. No hace rebuild. Después relee y compara configuración, integraciones/plugins, secretos declarados y esquemas; una diferencia produce fallo explícito con `applied:true`, sin intentar corregirla a ciegas.

Si la actualización excede timeout o falla sin recibo, el resultado puede ser incierto: el helper reporta `mutationOutcome: unknown`. Revisar el recibo/intención y el remoto antes de cualquier repetición. Si falla sólo la lectura posterior, el recibo conserva que el PUT ya terminó; tampoco repetir automáticamente.

## Qué verifica el código desplegado

`getBot` observado devuelve `deployedAt`, pero no `code`, SHA del bundle ni `versionHash`. Los tags `dmHash`/`pluginsHash` existentes no acreditan el JavaScript. La especificación de `updateBot` no garantiza una actualización particular de `deployedAt` ante un PUT sólo de código; esta propiedad debe registrarse como observación, no usarse como condición de éxito inventada. El helper conserva `deployedAt` y `updatedAt` de la respuesta y lectura posterior para comprobar lo que efectivamente ocurra.

La verificación disponible combina: SHA de los bytes enviados + respuesta satisfactoria del PUT + lectura posterior con configuración/dependencias intactas + una entrada de prueba supervisada que recorra el workflow nuevo y produzca los IDs/versión de prompt esperados, persistencia y entrega. Esta última parte es del coordinador y debe respetar el presupuesto acumulado. Un cambio de timestamp por sí solo no demuestra qué código respondió; no existe en el endpoint inspeccionado una comparación independiente del SHA remoto.

## Contingencia operativa preparada

La contingencia primaria es **pausar automatización y conservar la configuración**, junto con la recuperación del backend previo ya identificado por el coordinador. No exige fingir que se recuperó el bundle del 3 de septiembre ni volver a pedir una aprobación general de calidad.

Comando preparado, no ejecutado:

```sh
node .eval/codex-20260904/deploy-supervised/botpress-code-only.mjs pause --apply
```

El helper lee la configuración vigente y envía exactamente `{configuration:{data:{...datosVigentes,automationEnabled:false}}}` al PUT del mismo bot. No usa el snapshot viejo como reemplazo ni envía otros campos. Verifica después que sólo cambió ese booleano dentro del conjunto preservable. La firma privada y las demás claves quedan en memoria y se conservan. No se preparó una reactivación automática.

En el candidato actual, `routeCommercialTurn` devuelve supresión con `automation_disabled` y `conversationalBaseEligible` queda false; WhatsApp además se bloquea en su router. Esto permite detener turnos nuevos bajo esa configuración. **No cancela mensajes ya enviados ni garantiza cancelar workflows iniciados antes del cambio**, que deben observarse desde el backend/canal. Si hay entregas en vuelo, el coordinador debe usar los controles operativos del backend además de esta pausa.

El backend previo identificado es `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji`, URL `studyx-agente-ventas-8f5utc6mm-maneyraos-projects.vercel.app`. Su restauración, contratos y migración son del coordinador; no se emitió una orden Vercel aquí.

### Alternativa adicional: candidato local anterior archivado

Antes de un nuevo rebuild se conservó el bundle de **`d5b786af65162c54721f9dc8ab0cbf7820b701e1`**, cuyo SHA coincide exactamente con `v19-call-final-freeze.json`. Son los bytes del candidato local previo, no el runtime remoto anterior:

| Campo | Valor |
| --- | --- |
| Bundle descomprimido | 19252117 bytes |
| SHA-256 JavaScript | `b9376e34f04dc8d2cc47c587e9576b58140f057cf78658e60fd7f3c881c3fdf1` |
| Archivo | `.eval/codex-20260904/deploy-supervised/known-candidate-d5b786a-index.cjs.gz` |
| SHA-256 gzip | `ef9ac63c12f51a8c3fc573090f467dd8e82ac5d635e58313bba4a481bfe837d1` |
| Manifiesto | `known-candidate-d5b786a-manifest.json`, junto al gzip |

Si el coordinador decide usarlo como recuperación de código, debe descomprimirlo fuera del worktree, comprobar el SHA indicado y pasarlo al mismo helper `publish` con un preflight fresco. Mantiene sus límites de calidad históricos y requiere backend compatible. No usar el baseline más antiguo `360cd37` como si incluyera las correcciones posteriores. No se repitió la búsqueda agotada del bundle remoto.

## Condiciones pendientes indispensables

- Finalizar y verificar la migración/backend bajo la autorización vigente: los controla el coordinador.
- Elegir el freeze final que incorpora la instrucción comercial del usuario y comprobar el SHA del bundle al publicar.
- Si falla autenticación/permisos al PUT, se necesita acceso de escritura real; no puede acreditarse mediante el GET sin mutar.
- Después de publicar, comprobar una entrada y su salida por el canal supervisado, más persistencia y correlación real. Si algo falla, pausa verificable y evidencia; no declarar éxito por el build o el PUT.

La calidad no certificada y la ausencia de copia exacta del bundle viejo permanecen informadas; no se convierten aquí en una nueva prohibición de la prueba supervisada autorizada. No se requiere otra API de modelos para preparar este procedimiento. Gasto de modelos de esta subtarea: USD 0.

## Memoria inicial del tester

No se encontró un comando `/start` o `/reset` que borre o reinicie estado comercial en el adapter, router o backend de StudyX. Los tipos de integración Telegram tampoco declaran una acción de reset. No se añadió una. `/start` y borrar/reabrir el chat **no son un procedimiento de reinicio del backend**.

El adapter usa el ID numérico del usuario Telegram para producir el teléfono sintético `+999…`, `external_user_id=tg:user:<id>` y `external_conversation_id=tg:chat:<id>`. Ingestion resuelve el contacto por esa identidad y reutiliza la conversación abierta de su channel/thread; el estado comercial se carga por contacto y conversación del backend. Cambiar sólo el ID de conversación Botpress no constituye una sesión comercial limpia. Una preferencia anterior por chat debe seguir respetándose.

Para comprobar la primera invitación a llamada sin borrar memoria:

1. Usar una segunda cuenta **propia del tester**, sin conversación previa con este bot. Desde la cuenta habitual puede obtenerse el username exacto en el perfil del bot; cambiar luego a la segunda cuenta Telegram y buscar ese mismo username. No se inventa aquí un username a partir de “STUDYX”.
2. Abrir el bot desde esa cuenta y escribir directamente la consulta de un curso canónico. Si Telegram exige pulsar Iniciar, hacerlo y después enviar la consulta; no interpretar el botón como reset de una identidad existente.
3. El coordinador debe verificar que la identidad sintética recién ingresada no tiene historia comercial anterior y que existe en `sandbox_identities` antes del efecto de prueba. La primera oferta debe quedar registrada; después de que el tester elija chat, los turnos siguientes no deben volver a ofrecer llamada.

Con la cuenta usada ayer, el recorrido correcto es una prueba de continuidad: conservar y respetar el rechazo anterior. Si no hay otra cuenta propia disponible, dejar la primera invitación como escenario sin ejecutar por canal; eso no impide observar el candidato desplegado ni autoriza borrar preferencias. No crear identidades de terceros ni modificar manualmente la memoria para conseguir el resultado esperado.

El coordinador informó después de este preflight que la migración fue aplicada y la columna/ledger remoto verificados. También coordina un ajuste backend para registrar `sandbox_identities` atómicamente al recibir `sandbox_provider=telegram_sandbox`: el envelope ADK ya contiene ese marcador y los IDs requeridos, por lo que no necesita un cambio adicional del adapter. Este informe no cuenta esas comprobaciones del coordinador como una segunda ejecución de DB.

## Gates V20 anteriores a la corrección de T6/T8

Tras el aviso explícito del revisor de que la fuente estaba estable, se ejecutaron los comandos siguientes. Brain **V20**, canónico **V9**, SHA del canónico `6d724acf6e366571bc6ce94d5013d007654442a67562daf67e672542c1eba17b`, 322 líneas. Se tomaron hashes de la fuente ADK antes de los gates y se comprobaron sin cambios al terminar ambos builds.

| Comando | Resultado |
| --- | --- |
| `npm --prefix botpress-agent run typecheck` | Exit 0, 16:37:23–25Z |
| `npm --prefix botpress-agent run check` | Exit 0, valid=true, errors=0, warnings=0 |
| `npm --prefix botpress-agent run build` | Exit 0, 16:37:27–36Z; SHA local `04f42cb453871b50771a860c690ea7cc9bbb380e2f21da722aa1bab8646c069e` |
| `npm --prefix botpress-agent run deploy -- --dry-run --format json` | Exit 0, 16:38:13–29Z; aplicado=false |

El dry-run no omitió validaciones ni usó permisos para storage o dependencias sin configurar. Plan: **0 cambios de configuración, 0 dependencias bloqueantes, 0 diferencias de versiones, hasDestructiveStorageChanges=false**. Tables, knowledgeBases y assets son null en el plan. Eval manifest cuenta 30 definiciones; ese número **no significa que se hayan ejecutado 30 evaluaciones**. Los únicos tres avisos corresponden a GEMINI_API_KEY, GROQ_API_KEY y OPENAI_API_KEY, todos optional=true y de compatibilidad legacy.

Esta corrida generó el siguiente bundle con contexto de producción. **Quedó reemplazado por el build posterior a T6/T8**, registrado al inicio y al final del informe:

| Artefacto | Resultado |
| --- | --- |
| Archivo construido en esa corrida | `botpress-agent/.adk/bot/.botpress/dist/index.cjs` |
| Bytes | 23126660 |
| SHA-256 histórico, no usar para publicación final | `c6a84c4d1fc6323dfd010649a9a23fa7b6c7792c1a2d42308dad812885e24943` |
| Archivo preservado, privado | `.eval/codex-20260904/deploy-supervised/v20-production-context-index.cjs.gz` |
| SHA-256 gzip | `107559dabb8dfdcd319890efdbdfc57b2e6e235c81638521e8722eaf7ffacb5f` |

No reconstruir entre este hash y la publicación. Si cambia la fuente o el bundle, este freeze deja de identificar el candidato nuevo. El helper de publicación exige los bytes exactos y no utiliza la definición generada para modificar configuración/dependencias.

En `deploy-supervised/` quedan `v20-adk-gates-source-freeze.json`, `v20-adk-local-gates.sanitized.json`, `v20-adk-deploy-dry-run.sanitized.json` y los logs/plan privados con permisos 0600. El log del dry-run tiene SHA `5a36be2ed805adeb7e0ccf41c192b19b906e9ae16fcfd735b4501a14b921419d`: coincide con un plan anterior porque el plan no cambió, **no** porque el código sea idéntico. El SHA del bundle es la referencia de código pertinente.

La revisión breve del diff verifica que el JSON de propuesta sólo cambia la descripción de `call_offer`, sin añadir acciones/campos; el prompt prioriza la llamada y conserva el veto/chat y el máximo de dos ofertas. Se informó al coordinador una tensión de precio aún existente: el canónico prohíbe dar precio antes de Fase 3, mientras el preámbulo pide responder brevemente una consulta concreta junto a la invitación. No se editó nuevamente el prompt por esa observación; la evaluación live del coordinador debe mostrar el efecto real y conservarlo si falla. No es una nueva prohibición de la prueba supervisada autorizada.

Esta subtarea no publicó Botpress, no ejecutó DB ni consumió llamadas de modelos.

## Corrección posterior de T6/T8 y freeze final

El live V20 de `workflow-call-first-sale-2026-09-04T16-40-59-391Z-8ebe8071-1ce8-49e0-840a-ff5944c35ad8.json` conserva ambos fallos originales:

- **T6, traza `fdcc2ea6-ede3-4e19-ae58-4988af31363c`:** el modelo respondió correctamente «Cada cuota del plan que elegiste es de USD 60, durante 6 meses. El total es USD 360». El backend interpretaba `6 meses` como duración académica y eliminaba la primera oración. La respuesta entregada fue sólo «El total es USD 360». El RED unitario reprodujo exactamente esa pérdida. El guard ahora distingue el período de cuotas mensuales, ligado al importe y número de cuotas canónicos y a una cláusula de pago. `decision.service` aporta las presentaciones de planes de la fuente canónica existente. Períodos inventados y duraciones académicas siguen rechazándose; no se añadió prosa comercial de reemplazo.
- **T8:** el borrador reparado decía que nombre/apellido ya estaban registrados y pedía correo aunque faltaban nombre/apellido. El matcher buscaba campos en cualquier parte del texto, por lo que una afirmación de registro hacía pasar una petición equivocada. Ahora verifica los campos dentro de la petición; deben estar en `intake_missing`. Los reconocimientos no satisfacen esa condición. Se mantienen las preguntas naturales y la forma «Compartí tu apellido» después de dos regresiones adicionales señaladas por el coordinador.

RED: tres casos de plazo y dos de intake; después, dos paráfrasis válidas expusieron un cue demasiado estricto y se corrigió antes del freeze. GREEN final: **121/121** entre commercial-truth-guard, agent-a-turn-validation y resolve-agent-a-plannerless. Lint de los archivos backend/tests y diffcheck limpios. Es verificación gratuita; no reetiqueta el live fallido como aprobado. El detector conserva límites léxicos y no acredita una cobertura semántica universal.

Los únicos archivos de runtime modificados por esta corrección fueron `commercial-truth-guard.ts`, `decision.service.ts` y `agent-a-brain.ts`, además de sus dos archivos de tests. No se editó el extractor de identidad, ingestion ni el prompt. El coordinador verifica su integración con backend y el replay live.

Se repitieron typecheck, check, build y dry-run del adapter con la fuente final quieta, `16:51:20–44Z`: **cuatro exit 0**, configuración sin cambios, storage no destructivo, cero dependencias bloqueantes y cero diferencias de versiones. Persisten solamente los tres secretos legacy opcionales informados arriba. Ninguna publicación aplicada.

| Artefacto final | Valor |
| --- | --- |
| Bundle activo de producción | `botpress-agent/.adk/bot/.botpress/dist/index.cjs` |
| Bytes / SHA-256 | 23128231 / `4b4de7e17f9602ab814dbdd17fe16537361482ba135d10013b3bc0a5350f011c` |
| Archivo privado preservado | `.eval/codex-20260904/deploy-supervised/v20-postguards-final-production-index.cjs.gz` |
| SHA-256 gzip | `5cb24012fa637624522fad569e5aba6cfb13ad631f8b05f8e60c3a92a74e7fb2` |
| Fuente / gates / plan | `v20-postguards-final-source-freeze.json`, `v20-postguards-final-gates.sanitized.json`, `v20-postguards-final-plan.private.json` en el mismo directorio |

Usar este SHA final en `publish --sha256`; no reconstruir antes de la subida. El build intermedio `035582…` también quedó archivado como histórico, anterior a corregir las dos paráfrasis del intake. Las copias comprimidas evitan que lint recorra JavaScript de 23 MB dentro de `.eval`.
