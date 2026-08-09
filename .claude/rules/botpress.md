---
paths:
  - "botpress-agent/**"
---

# Botpress ADK — reglas de subsistema

## Frontera
Botpress es SOLO capa de canal. Nunca guarda estado comercial canónico,
secretos de base, precios, consentimiento ni decisiones irreversibles.
La verdad vive en Next.js + Supabase.

## Channel-specific (se reimplementa por canal)
Recepción del evento, resolución de identidad, descarga de media, mapeo de
tipos, extracción de cita, envío de la respuesta, ventana de respuesta.

## Channel-agnostic (se escribe una vez, no menciona el canal)
`workflows/processInboundTurn`, contrato de decisión, política,
`allowed_actions`, y todo lo que esté detrás de `actions/`.

## Invariantes
- UN solo Conversation handler con `channel: '*'`. Dos handlers wildcard
  procesan el mismo mensaje dos veces.
- Clave de workflow: `turn:botpress:<integration_id>:<external_message_id>`.
- Fail-closed en identidad: sin E.164 válido no se ingiere; se descarta y se
  loguea `PHONE_E164_UNRESOLVED`. Nunca inventar identidad.
- Una entrega ambigua no se degrada ni se reenvía: pausa en `retry_pending`.
- `automationEnabled` queda en false hasta terminar el plan de testeo.

## CLI
Usar siempre `--format json`: `adk check`, `adk logs`, `adk traces`,
`adk status`. El dev server (`adk dev`) debe estar corriendo para traces.
Antes de tocar un canal nuevo: `adk integrations info <name>` para confirmar
los nombres reales de los tags.
