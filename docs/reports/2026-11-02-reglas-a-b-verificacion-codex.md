# Verificación Codex de Reglas A/B — 2026-11-02

Este informe documenta exclusivamente fixtures y verificación de la continuación; el plan y el despliegue se siguen en `2026-11-02-reglas-a-b-continuacion-codex.md`.

## Cambios de fixtures

- `direct-course-bonus-{service,checkout,voice}.test.ts`: los catálogos de cada workspace usan Ecommerce → Fotografía con Celulares → Publicidad en Redes Sociales → Instagram para Emprendedores. Se conservan los nombres sintéticos de snapshot y las comprobaciones de identidad, versiones, pago, entrega y concurrencia.
- Los escenarios del catálogo StudyX usan Nutrición como primer regalo de Entrenamiento Funcional e Inglés 3 como primer regalo de Inglés 2. Las extensiones llevan una nueva observación del modelo citada literalmente; no se autoriza por palabras de precio.
- La carrera concurrente usa dos candidatos al mismo próximo curso autorizado; un curso activo fuera de orden tiene su propia regresión de rechazo sin efectos.
- `agent-turn-direct-bonus-commit.test.ts` verifica tres partes (precio, regalo e invitación) y ata la prueba de entrega a la parte que presenta el regalo. Los límites, recibos, paquete no entregado y rollback continúan verificándose.
- `course-mentions-commit.test.ts` mantiene los tres estados de entrega: pendiente, cancelado y entregado; sólo cambia el regalo a la afinidad real de Entrenamiento Funcional.
- Los fixtures tipados de `agent-a-brain-prompt.test.ts` y `course-mentions.test.ts` usan el contrato actual `required_price_objection_count=2`.

## Aislamiento de PostgreSQL

La primera suite se ejecutó contra la base de pruebas existente `127.0.0.1:55434/studyx_test`, sin reset. Para distinguir contaminación de un fallo real se creó una base nueva `127.0.0.1:55434/studyx_verify_20261102_codex_a` mediante `pg_dump --schema-only` y restauración en una base vacía, seguida de `supabase/seed.sql` canónico. No se copiaron datos históricos, no se interrumpieron sesiones ni se reseteó la base original.

Los doce fallos de `knowledge-projection.test.ts` se reprodujeron con esos seeds frescos. La causa era el fixture `drain`: después de que el worker productivo limitara cada invocación a dos trabajos, sus 50 iteraciones drenaban sólo 100 trabajos, aunque pedía `limit=20`. Los seeds canónicos exceden ese tamaño. El fixture ahora espera una reclamación vacía con un límite de 1.000 invocaciones y lanza una excepción si agota el límite. El worker productivo, su presupuesto y las aserciones no se modificaron. La prueba focalizada posterior aprobó 88/88 casos.

## Evidencia privada

Los logs y el manifiesto de la base desechable están en `.local-evidence/codex-continuation-2026-11-02/verification/`, con permisos privados. No deben agregarse a Git. Se mantuvieron los documentos de `docs/authority/` intactos y no se imprimieron claves.

## Estado de verificación

- 133/133 integraciones focalizadas de bonificación, checkout, voz, persistencia y permiso por teléfono: aprobadas antes de añadir la regresión de curso activo fuera de orden.
- 88/88 integraciones de los fixtures complementarios y proyección: aprobadas tras corregir el drenaje.
- 222/222 unitarias del prompt y la política: aprobadas después de las correcciones finales del runtime.
- TypeScript raíz y Botpress: aprobados; Next build: aprobado; ADK check: válido, sin errores ni avisos.
- `adk build` normal: pendiente de preflight de release. Falló por interfaces generadas de dependencias `listable`, `typing-indicator`, `llm`; no se editaron snapshots de dependencias. No presentar esta comprobación como aprobada hasta la preparación/publicación que preserva conexiones.
- Integración completa en base desechable: **983 aprobadas, 1 omitida, 99 archivos** (`integration-full-fresh.log`). La corrida duró 115 s. Como el último archivo de integración del runtime cambió durante esa corrida, después se ejecutaron únicamente los siete archivos afectados: **151/151 aprobadas** (`integration-affected-final.log`, 10:38:17−03:00).
- Unitarias completas finales: **5.090 aprobadas, 17 omitidas y 7 pendientes (`todo`), 272 archivos aprobados y 2 omitidos**. Comando: `npx vitest run --config vitest.config.mts --no-file-parallelism --maxWorkers=1`; evidencia `unit-final-serial.log`, inicio 10:38:46−03:00 y duración 63,69 s. Se ejecutó después de las últimas modificaciones de pruebas del runtime.
- El test de registro de workflows mediante ADK excedió sus 5 s bajo contención durante las corridas paralelas. Aislado aprobó en 1,87 s; la corrida completa serial también lo aprobó. No se modificaron límites ni aserciones.
- Revalidación final: **TypeScript raíz, TypeScript Botpress y lint aprobados**, códigos de salida 0 en `final-compiler-lint-status.json`. `git diff --check` aprobado y `docs/authority/` sin diferencias.

No se ejecutaron commits, push, cambios de configuración remota ni publicaciones desde esta verificación. La base desechable queda identificada arriba para reproducir la evidencia; el original permanece intacto.
