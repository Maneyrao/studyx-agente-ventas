---
paths:
  - "supabase/**"
  - "src/lib/db/**"
  - "src/lib/supabase/**"
  - "src/lib/services/*.service.ts"
---

# Supabase / PostgreSQL — reglas de subsistema

## Regla dura
Migraciones SOLO aditivas. Nunca editar una migración ya aplicada
(`20260623000001` … `20260806010009`). Si hace falta cambiar algo, migración nueva.

## Hechos del esquema (no re-descubrir)
- `contacts.phone`: NOT NULL UNIQUE, E.164 estricto `/^\+[1-9]\d{7,14}$/`.
  Es la identidad. No hay tabla de identidades múltiples.
- `channel` tiene CHECK `IN ('whatsapp','voice')` en 7 tablas.
- `ingestion.service.ts` fija `channel = 'whatsapp'`; `provider` distingue el origen.
- `provider` participa de TODAS las constraints de unicidad
  (`channel_threads`, `channel_events` ×2) => aísla sandbox de producción.
- Sandbox: `provider = 'telegram_sandbox'` + teléfono sintético `+999…`
  + fila en `sandbox_identities`.

## Candado de sandbox
Ninguna acción con efecto real (llamada Retell, cobro, envío WhatsApp,
Sheets de producción) puede ejecutarse sobre un contacto con fila en
`sandbox_identities`. Validar en el backend antes de invocar cualquier provider.

## `DATABASE_URL` es PRODUCCIÓN (2026-08-17)
El `DATABASE_URL` de `.env.local` apunta al pooler de Supabase de producción
(`aws-1-us-east-2.pooler.supabase.com:6543`). Un `psql "$DATABASE_URL" -f
supabase/seed/dev.sql` copiado de un doc ya sembró fixtures sintéticas en la
base real de clientes una vez. Para cualquier trabajo local usar el cluster
desechable y nunca esa variable.

`tests/setup/integration.ts` pisa `DATABASE_URL` siempre (nunca `??=`) con la
URL local: sin eso, un shell con la variable exportada hacía que la suite de
integración escribiera en producción — verificado, el pooler contestaba
`(ENOIDENTIFIER) no tenant identifier provided`.

## Cluster local desechable (no re-descubrir)
- `LC_ALL=C bash scripts/pg-native-up.sh [puerto]` — sin `LC_ALL` válido
  `pg_ctl` no arranca en esta Mac ("postmaster se volvió multi-hilo").
- Base **`studyx_test`**, no `postgres`. Puertos aprobados: 55432-55435
  (`tests/helpers/db.ts`). URL: `postgresql://postgres@127.0.0.1:55433/studyx_test`.
- Teardown: `bash scripts/pg-native-down.sh [puerto]`. Docker no está instalado.
- Sin `TEST_DATABASE_URL` exportada las suites de integración se saltean en
  silencio (`[integration skipped]`): un verde puede ser 0 tests corridos.

## La cadena de migraciones no corre de cero (2026-08-17, sin resolver)
Dos defectos pre-existentes impiden construir una base migrada desde vacío:
1. `20260805000001_universal_business_memory.sql:379` hace REVOKE sobre
   `anon, authenticated` sin guardas; en un cluster pelado esos roles no
   existen y la migración aborta entera (tiene BEGIN/COMMIT propio). Las
   migraciones del 16-ago en adelante sí usan
   `IF EXISTS (SELECT 1 FROM pg_roles ...)`.
2. `20260805000001:194` crea `knowledge_chunks(source_id)`, que choca con el
   canónico `knowledge_chunks(document_id)` de `20260809020001:15`. El código y
   las migraciones posteriores (20260811010001, 20260817020001) usan
   `document_id`; la del 08-05 es vestigial.

Producción lo resolvió fuera de banda: tiene `legacy_knowledge_chunks_20260805`,
tabla que **ninguna migración de este repo crea**. `scripts/pg-native-up.sh`
reproduce la reconciliación sólo para el cluster local. Arreglar la cadena de
verdad exige decidir sobre el historial de migraciones de producción.

## Verificación
`npm run test:db:reset-loop`, `npm run test:db:invariants`, `npm run test:db:lint`.
Las pruebas destructivas nunca contra el proyecto remoto compartido.
