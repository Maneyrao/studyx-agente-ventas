-- Cierre del loop post-llamada (spec 007): el sistema, no el cliente, inicia
-- el mensaje de WhatsApp de cierre cuando una call_session llega a estado
-- terminal. No se abre un camino paralelo para "decisiones sin turno": se
-- sintetiza un evento de canal de sistema, resuelto al mismo contacto/thread
-- de WhatsApp que el contacto ya tiene, del que cuelga el mensaje inbound que
-- agent_decisions exige por FK. Todo lo demás (agent_decisions, delivery
-- pipeline, immutability trigger) se reusa sin cambios.

BEGIN;

ALTER TABLE channel_events
  DROP CONSTRAINT channel_events_event_kind_check;

ALTER TABLE channel_events
  ADD CONSTRAINT channel_events_event_kind_check
  CHECK (
    event_kind IN (
      'inbound_message',
      'delivery_update',
      'conversation_update',
      'system_call_result'
    )
  );

-- Un evento de resultado de llamada no viene de un webhook de proveedor: no
-- tiene external_message_id/external_conversation_id reales, pero sí exige
-- contact_id + channel_thread_id resueltos, igual que cualquier otro evento
-- que vaya a producir un mensaje (enforce_message_source_event_context ya
-- exige esto en la tabla messages; esta constraint lo exige simétricamente
-- del lado del evento, antes de que el mensaje exista).
ALTER TABLE channel_events
  DROP CONSTRAINT channel_events_inbound_identity_check;

ALTER TABLE channel_events
  ADD CONSTRAINT channel_events_inbound_identity_check
  CHECK (
    (
      event_kind = 'inbound_message'
      AND direction = 'inbound'
      AND external_message_id IS NOT NULL
      AND btrim(external_message_id) <> ''
      AND external_conversation_id IS NOT NULL
      AND btrim(external_conversation_id) <> ''
    )
    OR (
      event_kind = 'system_call_result'
      AND direction = 'inbound'
      AND contact_id IS NOT NULL
      AND channel_thread_id IS NOT NULL
      AND external_message_id IS NULL
      AND external_conversation_id IS NULL
    )
    OR event_kind NOT IN ('inbound_message', 'system_call_result')
  );

COMMENT ON COLUMN channel_events.event_kind IS
  'inbound_message/delivery_update/conversation_update: reales, de proveedor. '
  'system_call_result: sintetizado por el reconciliador post-llamada (spec 007), '
  'nunca viene de un webhook; su external_event_id es system:call_result:<call_id>, '
  'lo que le da idempotencia gratis vía channel_events_provider_event_uq.';

COMMIT;
