-- Development seed data for Contact Identity Foundation
-- Run after migrations: supabase db reset

INSERT INTO contacts (id, phone, status, channel_origin, name)
VALUES
  ('00000000-0000-0000-0000-000000000001', '+5491112345678', 'prospecto', 'whatsapp', 'Ana García'),
  ('00000000-0000-0000-0000-000000000002', '+5491198765432', 'cliente',   'whatsapp', 'Carlos Méndez'),
  ('00000000-0000-0000-0000-000000000003', '+5491155551234', 'prospecto', 'voice',    'María López')
ON CONFLICT (phone) DO NOTHING;

INSERT INTO conversations (id, contact_id, channel, status)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'whatsapp', 'open'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'whatsapp', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO messages (conversation_id, contact_id, direction, content)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'inbound',  'Hola, me interesa el curso de Python para datos'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'outbound', 'Claro, te cuento sobre nuestro curso de Python para análisis de datos.'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'inbound',  '¿Cuándo es el próximo curso de Excel avanzado?')
ON CONFLICT DO NOTHING;
