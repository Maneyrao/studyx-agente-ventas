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

-- ---------------------------------------------------------------------------
-- Aburridont — Inglés IT (sandbox). Synthetic, reproducible business fixture:
-- every id, name and figure below is test data. Idempotent via ON CONFLICT.
-- knowledge_chunks is NOT seeded: it is the derived index, rebuilt by the
-- knowledge-source projection (see 20260817010001_universal_business_schema).
-- ---------------------------------------------------------------------------

INSERT INTO workspaces (
  id, slug, display_name, environment, status, default_locale, timezone, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'aburridont-english-it-sandbox',
  'Aburridont — Inglés IT (Sandbox)',
  'sandbox',
  'active',
  'es-AR',
  'America/Argentina/Buenos_Aires',
  '{"test_data":true,"replaceable":true}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  environment = EXCLUDED.environment,
  status = EXCLUDED.status,
  default_locale = EXCLUDED.default_locale,
  timezone = EXCLUDED.timezone,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO offerings (
  id, workspace_id, code, display_name, offering_type, status, description,
  value_proposition, price_type, price_amount, currency, billing_interval,
  audience, delivery, guardrails, metadata
) VALUES
(
  'a1000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'group_it_english',
  'Plan Grupal IT',
  'course',
  'active',
  'Clases grupales virtuales de inglés IT con foco en speaking práctico para entrevistas, dailies, calls, clientes y explicación de proyectos.',
  'Ayudar a perfiles tech A1+/A2 a destrabar el inglés hablado en situaciones laborales concretas.',
  'fixed',
  85000,
  'ARS',
  'monthly',
  '{"profiles":["programming","qa","data","product","ux_ui","tech_support"],"levels":["A1+","A2"],"language":"Spanish"}'::jsonb,
  '{"modality":"virtual","hours_per_month":8,"recommended_duration_months":3,"certification":true,"group_size":"reduced","schedules":[{"days":["tuesday","thursday"],"start":"21:00","timezone":"America/Argentina/Buenos_Aires"},{"days":["saturday"],"start":"15:00","end":"17:00","timezone":"America/Argentina/Buenos_Aires"}],"includes":["live_classes","speaking_practice","interview_role_play","daily_and_call_role_play","it_vocabulary"]}'::jsonb,
  '{"allowed_promise":"Destrabar el inglés hablado en contextos laborales IT.","forbidden_promises":["fluidez total en 3 meses","ser bilingüe en 3 meses"]}'::jsonb,
  '{"test_data":true}'::jsonb
),
(
  'a1000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  'individual_it_english',
  'Plan Individual / Semipersonalizado',
  'course',
  'active',
  'Alternativa para alumnos con horarios difíciles, nivel distinto al grupo o una necesidad laboral urgente.',
  'Adaptar frecuencia, foco y horarios a una necesidad concreta.',
  'quote',
  NULL,
  'ARS',
  'custom',
  '{"profiles":["tech"],"use_when":["schedule_mismatch","level_mismatch","urgent_goal"]}'::jsonb,
  '{"modality":"virtual","frequency":"to_confirm"}'::jsonb,
  '{"price_message":"Precio a confirmar según frecuencia y objetivo.","never_invent_price":true}'::jsonb,
  '{"test_data":true}'::jsonb
)
ON CONFLICT (workspace_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  offering_type = EXCLUDED.offering_type,
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  value_proposition = EXCLUDED.value_proposition,
  price_type = EXCLUDED.price_type,
  price_amount = EXCLUDED.price_amount,
  currency = EXCLUDED.currency,
  billing_interval = EXCLUDED.billing_interval,
  audience = EXCLUDED.audience,
  delivery = EXCLUDED.delivery,
  guardrails = EXCLUDED.guardrails,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO sales_pipelines (id, workspace_id, code, display_name, status)
VALUES (
  'a2000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'primary_sales',
  'Pipeline comercial principal',
  'active'
)
ON CONFLICT (workspace_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO pipeline_stages (
  id, pipeline_id, code, display_name, position, is_terminal, outcome, metadata
) VALUES
  ('a2100000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'new',                      'Nuevo',              0, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'engaged',                  'En conversación',    1, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'qualifying',               'Calificando',        2, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'qualified',                'Calificado',         3, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 'consultation_requested',   'Llamada solicitada', 4, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000001', 'consultation_in_progress', 'Llamada en curso',   5, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000001', 'follow_up',                'Seguimiento',        6, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000001', 'nurture',                  'Nutrición',          7, false, NULL,           '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000009', 'a2000000-0000-4000-8000-000000000001', 'won',                      'Ganado',             8, true,  'won',          '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000010', 'a2000000-0000-4000-8000-000000000001', 'lost',                     'Perdido',            9, true,  'lost',         '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001', 'disqualified',             'No califica',       10, true,  'disqualified', '{}'::jsonb)
ON CONFLICT (pipeline_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  position = EXCLUDED.position,
  is_terminal = EXCLUDED.is_terminal,
  outcome = EXCLUDED.outcome,
  metadata = EXCLUDED.metadata;

INSERT INTO qualification_fields (
  id, workspace_id, code, prompt, response_type, options, is_required, position, rules, status
) VALUES
  ('a3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'tech_profile',
   '¿Trabajás o estudiás algo relacionado con programación o IT?', 'boolean', '[]'::jsonb, true, 0,
   '{"positive_signal":true}'::jsonb, 'active'),
  ('a3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'goal',
   '¿Para qué querés mejorar tu inglés?', 'multi_select', '["interviews","dailies","calls","remote_work","clients","general_base"]'::jsonb, true, 1,
   '{"priority_values":["interviews","dailies","calls","remote_work","clients"]}'::jsonb, 'active'),
  ('a3000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'self_assessed_level',
   '¿Qué nivel sentís que tenés hoy?', 'single_select', '["from_zero","A1","A1+","A2","intermediate","advanced"]'::jsonb, true, 2,
   '{"group_fit":["A1+","A2"]}'::jsonb, 'active'),
  ('a3000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'speaking_blocker',
   '¿Qué te pasa cuando tenés que hablar en inglés?', 'text', '[]'::jsonb, true, 3,
   '{}'::jsonb, 'active'),
  ('a3000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'schedule_availability',
   '¿Tenés disponibilidad martes y jueves a las 21, o sábados de 15 a 17?', 'multi_select', '["tue_thu_21","sat_15_17","neither"]'::jsonb, true, 4,
   '{"group_fit":["tue_thu_21","sat_15_17"]}'::jsonb, 'active'),
  ('a3000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'start_timing',
   '¿Querés arrancar ahora o estás averiguando para más adelante?', 'single_select', '["now","within_30_days","later","browsing"]'::jsonb, true, 5,
   '{"priority_values":["now","within_30_days"]}'::jsonb, 'active'),
  ('a3000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'budget_fit',
   'El grupo cuesta 85.000 ARS por mes. ¿Ese presupuesto te sirve?', 'single_select', '["yes","maybe","no"]'::jsonb, true, 6,
   '{"group_fit":["yes"]}'::jsonb, 'active')
ON CONFLICT (workspace_id, code) DO UPDATE SET
  prompt = EXCLUDED.prompt,
  response_type = EXCLUDED.response_type,
  options = EXCLUDED.options,
  is_required = EXCLUDED.is_required,
  position = EXCLUDED.position,
  rules = EXCLUDED.rules,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO knowledge_sources (
  id, workspace_id, source_type, title, content, status, version, metadata
) VALUES
  ('a4000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'business_profile',
   'Qué vende Aburridont',
   'Aburridont ofrece clases de inglés IT para programadores y otros perfiles tech hispanohablantes. El foco es speaking práctico para entrevistas, dailies, calls, clientes y explicación de proyectos. El alumno típico entiende documentación o contenido en inglés, pero se bloquea cuando debe hablar.',
   'active', 1, '{"test_data":true}'::jsonb),
  ('a4000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'offering',
   'Plan Grupal IT',
   'El Plan Grupal IT es 100% virtual, para nivel A1+/A2, incluye 8 horas mensuales en vivo, speaking, role-plays de entrevistas, dailies y calls, vocabulario IT, grupo reducido y certificación. El proceso sugerido dura 3 meses. Horarios: martes y jueves a las 21, o sábados de 15 a 17. Precio: 85.000 ARS por mes.',
   'active', 1, '{"offering_code":"group_it_english","test_data":true}'::jsonb),
  ('a4000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'offering',
   'Plan Individual o Semipersonalizado',
   'El Plan Individual o Semipersonalizado es una alternativa para quien tiene horarios difíciles, un nivel distinto al grupo o una necesidad urgente. El precio y la frecuencia se confirman según el objetivo. El agente nunca debe inventar ese precio.',
   'active', 1, '{"offering_code":"individual_it_english","test_data":true}'::jsonb),
  ('a4000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'qualification',
   'Cliente objetivo y calificación',
   'Priorizar programadores, QA, Data, Product, UX/UI y soporte técnico con una meta laboral concreta, nivel A1+/A2, disponibilidad, urgencia y presupuesto cercano a 85.000 ARS mensuales. Derivar al plan individual si existe una meta real pero no encajan nivel u horarios. Nutrir si comenzará más adelante o no tiene presupuesto. No califica para el grupo quien busca inglés general sin objetivo laboral, exige fluidez perfecta en 3 meses, tiene nivel C1/C2, no dispone de horarios o es menor sin oferta específica.',
   'active', 1, '{"test_data":true}'::jsonb),
  ('a4000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'policy',
   'Promesas y límites comerciales',
   'La promesa permitida es ayudar al alumno a destrabar el inglés hablado en contextos laborales IT. No se puede prometer fluidez total, bilingüismo ni resultados laborales garantizados en 3 meses. Para descuentos, excepciones, precios no publicados o información incierta se debe escalar a una persona.',
   'active', 1, '{"test_data":true}'::jsonb),
  ('a4000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'process',
   'Objetivo de la conversación comercial',
   'El agente atiende consultas, entiende la situación del prospecto, registra los siete datos mínimos de calificación y prioriza llevar a una llamada a quienes muestran encaje e intención. Debe hacer una pregunta por vez, ser breve y solicitar consentimiento explícito antes de iniciar una llamada. Durante la llamada el agente de texto no debe competir con el agente de voz; después retoma con el resultado y próximo paso registrados.',
   'active', 1, '{"test_data":true}'::jsonb)
ON CONFLICT (workspace_id, title, version) DO UPDATE SET
  source_type = EXCLUDED.source_type,
  content = EXCLUDED.content,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = now();
