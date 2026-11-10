# Postventa predeterminada y preparación del release

La plantilla del dueño ya reemplaza la narrativa del modelo para el acceso, en un único mensaje. La excepción a prompt:230 y la aclaración de contraseña inicial fija están registradas en AGENTS.md; los documentos de autoridad no cambiaron. El agradecimiento posterior del cliente continúa en el Agente A.

Cambio de aplicación: `bac1af0dc90e68c2234184bee2d467fda03ed763`. Release preparado, con el helper de publicación revisado para ADK 2.0.8: `d558f938f849422d2adc12797e4773bf95b29a0d`. Ambos commits están subidos a `origin/codex/studyx-bonus-staged-release`.

| Caso solicitado | Resultado verificado |
|---|---|
| Alumno nuevo, 0 bonificados | Texto exacto, principal activo y ninguna línea de regalo |
| Alumno nuevo, 1 bonificado | Una línea de regalo por el curso activo verificado |
| Alumno nuevo, 3 bonificados | Tres líneas, ordenadas por el snapshot del pago |
| Cuenta existente | Credenciales de siempre; sin contraseña nueva, recordatorio ni sugerencia final |
| Activación parcial | Sólo cursos activos; pendientes antes de canales; caso humano durable |
| Principal pendiente y bonificado activo | No lista el principal como habilitado; lo identifica como pendiente |
| Contraseña sin E mayúscula inicial | Omite el recordatorio |
| Recuperación parcial → completa | Notificaciones distintas, una entrega por evento, sin perder el aviso final |
| Bienvenida a Studyx | Autorización de la plantilla completa; no dispara el falso positivo genérico |
| Auditoría del envío real | Contraseña redactada; proveedor e historial del cliente conservan la entrega exacta |

El usuario proviene del resultado de Central, contrastado con la identidad del pago. La contraseña inicial vigente proviene de configuración obligatoria y sólo se aplica cuando Central confirmó `student_was_created=true`, según la aclaración del dueño. No se agregó un campo ficticio de contraseña al contrato de Central ni una credencial de ejemplo en el código. Campus y contactos también provienen de configuración. Los bonificados se cruzan por código y posición con evidencia `active`/`already_enrolled`; los demás no se presentan como habilitados.

El acceso completo utiliza `access_ready`; el parcial terminal conserva `access_delayed` y el caso humano de spec §6. El claim de acceso no lleva historial ni credenciales a Botpress. Botpress solicita la entrega directamente: no genera, repara ni sustituye la plantilla con un modelo. Los avisos de pago/demora sin acceso verificado siguen usando su flujo anterior.

La protección de credenciales en el contexto cubre el evento inicial de acceso. Las proyecciones generales posteriores de memoria y resumen conservan su funcionamiento anterior: el historial contiene el mensaje exacto entregado y puede volver a entrar en esos contextos. Esta tarea no implementa una redacción global del historial.

Validación: 4.955 unitarias aprobadas, 962 de integración aprobadas sobre PostgreSQL limpio con todas las migraciones, 42 pruebas focalizadas y los dos recorridos firmados completos de compra/alta (total y parcial). Las 16 pruebas del helper y sus contratos también pasaron. TypeScript, lint, build del backend, ADK check y build de Botpress pasaron; revisión del arquitecto aprobada. Los proveedores externos fueron simulados: cero pedidos a modelos, cero tokens y costo de modelo USD 0. Estas pruebas no constituyen una nueva aceptación semántica de las 16 golden.

Durante la verificación se descartó una corrida de integración sobre una base ya utilizada: conservaba seguimientos pendientes. Se repitió la suite en una base limpia. El nuevo test de auditoría ahora genera un identificador único de proveedor. Los recorridos amplios también requirieron corregir sólo el lanzador temporal del laboratorio: flags de bonificación y enlaces de Stripe de entorno test debían coincidir entre servidor y runner. No se alteraron criterios comerciales ni código de producción para resolver esos fallos de entorno. El preflight final quedó archivado.

El destino quedó confirmado con la aclaración del dueño: cuenta Botpress `tmaneyro@gmail.com`, perfil explícito `studyx-detmaneyro`, workspace llamado **Vertice**, bot **STUDYX** `0d7c9ecb-4781-4c65-913d-f7e947fa14d4`. La sesión De Fazio corresponde a otra cuenta y no fue utilizada como destino. Backend: proyecto personal Vercel `studyx-agente-ventas`, equipo `maneyraos-projects`, proyecto `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM`.

Se prepararon y verificaron las seis variables nuevas en producción y preview del proyecto personal; la contraseña se guardó como secreto. Esa configuración no activó un despliegue. El ensayo de publicación de Botpress terminó sin mutaciones remotas y preservó 15 integraciones, 2 plugins, configuración y contratos; no requiere cambios de eventos, acciones ni etiquetas. El helper permanece protegido por el perfil explícito, el destino fijo, la versión revisada de ADK y `--publish` separado.

| Componente | Publicado actualmente | Preparado localmente |
|---|---|---|
| Backend | SHA `acfb9175571c2d1769c14bca29578356dbcbc1ba` | Build y `/api/health` local con SHA `d558f938f849422d2adc12797e4773bf95b29a0d` |
| Botpress STUDYX | Publicación del 2026-10-30 22:44:34.966 UTC; SHA no expuesto por la API | Mismo source SHA `d558f938f849422d2adc12797e4773bf95b29a0d`; bundle SHA256 `3718b45ff81a1981c88c58ef213330d828029c5ec4d15839ab3ed7042754e4a5` |

El endpoint público configurado en Botpress coincide con `https://studyx-agente-ventas.vercel.app`. Eso verifica el destino, pero no demuestra igualdad de código publicado: `getBot` no expone el SHA y las lecturas de versiones/bot-json devolvieron 500, con los reintentos detenidos. La paridad del paquete preparado sí está verificada por el manifiesto del bundle y la salud local del backend. No se publicó el release ni se afirmó paridad remota.

El bundle exacto está conservado localmente en `.local-evidence/releases/d558f93/botpress.bundle.cjs` (24.493.132 bytes). Para una activación posterior se debe usar el release congelado `d558f938f849422d2adc12797e4773bf95b29a0d`, inyectar ese SHA como `STUDYX_RELEASE_SHA` del backend y repetir el preflight de Botpress con el perfil confirmado antes de publicar. El despliegue backend vigente `dpl_5Jkkhp5kcuh6DCn4HvBBDS172oUx` queda identificado como referencia de retorno. La aceptación formal de las 16 golden no se volvió a ejecutar; su último resultado registrado sigue siendo 35/48 sobre `9482954`, no una aprobación del release nuevo.

Evidencia pública, sin credenciales: [verificación](evidence/2026-11-01-post-sale-access-template/verification.json), [preflight Botpress](evidence/2026-11-01-post-sale-access-template/botpress-preflight.json), [manifiesto preparado](evidence/2026-11-01-post-sale-access-template/prepared-botpress-manifest.json), [salud local](evidence/2026-11-01-post-sale-access-template/prepared-backend-health.json), [inventario de despliegue](evidence/2026-11-01-post-sale-access-template/deployment-inventory.json) y [configuración preparada](evidence/2026-11-01-post-sale-access-template/configuration-preparation.json). Los snapshots privados del bot no se versionaron.
