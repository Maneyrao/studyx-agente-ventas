# StudyX Agente de Ventas

Backend conversacional con Next.js, Supabase/PostgreSQL, pgvector y Botpress.

## Fuente de verdad

- PostgreSQL contiene identidad, consentimiento, estados, mensajes y entrega.
- Resúmenes y embeddings son datos derivados y reconstruibles.
- Las reglas críticas deben estar protegidas por constraints y transacciones.

## Trabajo actual

Seguir [docs/ROADMAP.md](docs/ROADMAP.md). La fase activa está registrada en `SESSION.md`.

## Reglas operativas

- Crear migraciones aditivas; no reescribir migraciones aplicadas.
- No registrar secretos ni imprimir valores de `.env`.
- Preservar los cambios locales existentes del usuario.
- Ante fallos transitorios, intentar como máximo tres veces con backoff; luego registrar y escalar.
- Priorizar seguridad: pausar antes que duplicar, inventar o responder a un contacto bloqueado.

## Verificación mínima

- TypeScript, lint y unitarias.
- Migración limpia en Supabase local.
- Integración, concurrencia, replay e inyección de fallos.
- Build de producción antes de cada entrega.


## Política de contexto

Delegar en el subagente `studyx-scout` (haiku) toda investigación verbosa:
exploración del repo, búsqueda de archivos, rastreo de code paths, lectura de
logs, documentación y triage de tests fallidos. Devuelve conclusiones, no volcados.

No traer al contexto principal archivos completos, logs completos, salidas de
test completas, greps amplios ni diffs completos. Buscar antes de leer:
símbolo/referencia → grep → rango de líneas → archivo completo sólo si hace falta.

Haiku para exploración y resúmenes. Sonnet para implementar, testear y depurar.
Opus sólo para una decisión de arquitectura difícil o un conflicto de diseño.

Al cerrar cada fase invocar la skill `studyx-checkpoint` antes de compactar.

Ahorrar contexto nunca justifica saltear tests, typecheck, validación de
contratos Zod, chequeos de idempotencia ni verificación de migraciones.
