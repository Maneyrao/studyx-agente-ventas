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

## Verificación
`npm run test:db:reset-loop`, `npm run test:db:invariants`, `npm run test:db:lint`.
Las pruebas destructivas nunca contra el proyecto remoto compartido.
