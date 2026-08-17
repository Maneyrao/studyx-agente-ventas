-- Sandbox seed: Aburridont / Inglés IT.
-- All people and identifiers below are synthetic and exist only for smoke tests.

BEGIN;

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
  '{"test_data":true,"replaceable":true,"owner":"Thiago"}'::jsonb
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
  ('a2100000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'new',                     'Nuevo',                         0, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'engaged',                 'En conversación',               1, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'qualifying',              'Calificando',                    2, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'qualified',               'Calificado',                     3, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 'consultation_requested',  'Llamada solicitada',             4, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000001', 'consultation_in_progress','Llamada en curso',                 5, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000001', 'follow_up',               'Seguimiento',                    6, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000001', 'nurture',                 'Nutrición',                      7, false, NULL,              '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000009', 'a2000000-0000-4000-8000-000000000001', 'won',                     'Ganado',                         8, true,  'won',             '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000010', 'a2000000-0000-4000-8000-000000000001', 'lost',                    'Perdido',                        9, true,  'lost',            '{}'::jsonb),
  ('a2100000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001', 'disqualified',            'No califica',                   10, true,  'disqualified',    '{}'::jsonb)
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
   '¿Querés arrancar ahora en agosto o estás averiguando para más adelante?', 'single_select', '["august","within_30_days","later","browsing"]'::jsonb, true, 5,
   '{"priority_values":["august","within_30_days"]}'::jsonb, 'active'),
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

INSERT INTO knowledge_chunks (
  id, source_id, chunk_index, content, embedding, embedding_status, embedding_model, embedded_at, metadata
)
SELECT
  mapping.chunk_id,
  source.id,
  0,
  source.content,
  NULL,
  'pending',
  NULL,
  NULL,
  '{"test_data":true}'::jsonb
FROM knowledge_sources source
JOIN (
  VALUES
    ('a4000000-0000-4000-8000-000000000001'::uuid, 'a4100000-0000-4000-8000-000000000001'::uuid),
    ('a4000000-0000-4000-8000-000000000002'::uuid, 'a4100000-0000-4000-8000-000000000002'::uuid),
    ('a4000000-0000-4000-8000-000000000003'::uuid, 'a4100000-0000-4000-8000-000000000003'::uuid),
    ('a4000000-0000-4000-8000-000000000004'::uuid, 'a4100000-0000-4000-8000-000000000004'::uuid),
    ('a4000000-0000-4000-8000-000000000005'::uuid, 'a4100000-0000-4000-8000-000000000005'::uuid),
    ('a4000000-0000-4000-8000-000000000006'::uuid, 'a4100000-0000-4000-8000-000000000006'::uuid)
) AS mapping(source_id, chunk_id) ON mapping.source_id = source.id
ON CONFLICT (source_id, chunk_index) DO UPDATE SET
  content = EXCLUDED.content,
  embedding = NULL,
  embedding_status = 'pending',
  embedding_model = NULL,
  embedded_at = NULL,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO contacts (id, phone, status, channel_origin, name)
VALUES (
  'a5000000-0000-4000-8000-000000000001',
  '+5491100000001',
  'prospecto',
  'whatsapp',
  'Alumno Smoke'
)
ON CONFLICT (phone) DO UPDATE SET
  status = 'prospecto',
  channel_origin = 'whatsapp',
  name = 'Alumno Smoke',
  email = NULL,
  summary = NULL,
  summary_updated_at = NULL,
  pending_turns = 0,
  deleted_at = NULL,
  updated_at = now();

INSERT INTO workspace_contacts (
  id, workspace_id, contact_id, lifecycle_status, source_channel, metadata
) VALUES (
  'a5100000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'active',
  'whatsapp',
  '{"synthetic":true,"purpose":"smoke_test"}'::jsonb
)
ON CONFLICT (workspace_id, contact_id) DO UPDATE SET
  lifecycle_status = 'active',
  source_channel = 'whatsapp',
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO contact_consents (
  id, workspace_contact_id, channel, purpose, status, source, evidence
) VALUES (
  'a5200000-0000-4000-8000-000000000001',
  'a5100000-0000-4000-8000-000000000001',
  'voice',
  'sales_call',
  'unknown',
  'sandbox_seed',
  '{"synthetic":true}'::jsonb
)
ON CONFLICT (workspace_contact_id, channel, purpose) DO UPDATE SET
  status = 'unknown',
  source = 'sandbox_seed',
  granted_at = NULL,
  revoked_at = NULL,
  expires_at = NULL,
  evidence = EXCLUDED.evidence,
  updated_at = now();

INSERT INTO opportunities (
  id, workspace_contact_id, offering_id, pipeline_id, stage_id, status,
  qualification_score, next_action, metadata
) VALUES (
  'a5300000-0000-4000-8000-000000000001',
  'a5100000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a2100000-0000-4000-8000-000000000001',
  'open',
  NULL,
  'Iniciar conversación de calificación',
  '{"synthetic":true,"purpose":"smoke_test"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  offering_id = EXCLUDED.offering_id,
  pipeline_id = EXCLUDED.pipeline_id,
  stage_id = EXCLUDED.stage_id,
  status = 'open',
  qualification_score = NULL,
  next_action = EXCLUDED.next_action,
  next_action_at = NULL,
  closed_reason = NULL,
  closed_at = NULL,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO memory_items (
  id, workspace_contact_id, memory_type, memory_key, content, structured_value,
  source_type, confidence, sensitivity
) VALUES (
  'a5400000-0000-4000-8000-000000000001',
  'a5100000-0000-4000-8000-000000000001',
  'fact',
  'test_identity',
  'Este contacto es un alumno completamente sintético utilizado para smoke tests.',
  '{"synthetic":true}'::jsonb,
  'system',
  1.0,
  'public'
)
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  structured_value = EXCLUDED.structured_value,
  source_type = EXCLUDED.source_type,
  confidence = EXCLUDED.confidence,
  sensitivity = EXCLUDED.sensitivity,
  valid_until = NULL,
  superseded_by = NULL,
  updated_at = now();

INSERT INTO memory_embeddings (
  id, memory_item_id, embedding, status, embedding_model, embedded_at
) VALUES (
  'a5500000-0000-4000-8000-000000000001',
  'a5400000-0000-4000-8000-000000000001',
  NULL,
  'pending',
  NULL,
  NULL
)
ON CONFLICT (memory_item_id) DO UPDATE SET
  embedding = NULL,
  status = 'pending',
  embedding_model = NULL,
  embedded_at = NULL,
  retry_count = 0,
  last_error_code = NULL,
  updated_at = now();

INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload)
VALUES (
  'a9000000-0000-4000-8000-000000000001',
  'sandbox_seed',
  'sandbox.dataset.seeded',
  'workspace',
  'a0000000-0000-4000-8000-000000000001',
  '{"dataset":"aburridont-english-it-sandbox","synthetic":true,"contains_real_customer_data":false}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- StudyX (sandbox). Datos VERIFICADOS del sitio mystudyx.com al 14-ago-2026
-- (docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md). Los precios NO se
-- cargan: el sitio publica $699 y cobra $1,200 (hallazgo #1). price_type=quote
-- hasta que StudyX confirme. Idempotente via ON CONFLICT.
-- ---------------------------------------------------------------------------

BEGIN;

INSERT INTO workspaces (id, slug, display_name, environment, status, default_locale, timezone, metadata)
VALUES (
  'b0000000-0000-4000-8000-000000000001', 'studyx-sandbox',
  'StudyX — Academia Internacional (Sandbox)', 'sandbox', 'active',
  'es-419', 'America/New_York',
  '{"legal_entity":"My Study X, LLC / World Digital Group Corp (FL)","psp":"authorize_net_cim_credit_card","source":"mystudyx.com 2026-08-14","price_conflict_open":true}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name, environment = EXCLUDED.environment,
  status = EXCLUDED.status, default_locale = EXCLUDED.default_locale,
  timezone = EXCLUDED.timezone, metadata = EXCLUDED.metadata, updated_at = now();

INSERT INTO offerings (
  id, workspace_id, code, display_name, offering_type, status, description,
  value_proposition, price_type, price_amount, currency, billing_interval,
  audience, delivery, guardrails, metadata
) VALUES
(
  'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
  'maquillaje_profesional', 'Diplomado en Maquillaje Profesional', 'course', 'active',
  'Diplomado online de 38 clases en 5 módulos, con temario completo publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":38,"modules":5,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/maquillaje-profesional/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
  'entrenamiento_funcional', 'Diplomado en Entrenamiento Funcional', 'course', 'active',
  'Diplomado online de 36 clases en 3 módulos, con temario completo publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":36,"modules":3,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/entrenamiento-funcional/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001',
  'decoracion_de_interiores', 'Diplomado en Decoración de Interiores', 'course', 'active',
  'Diplomado online de 34 clases, con temario publicado (el temario detalla 20 ítems).',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":34,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/decoracion-de-interiores/","published_price_conflict":"699_vs_1200","declared_classes":34,"syllabus_item_count":20,"classes_syllabus_mismatch":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001',
  'unas_gelificadas', 'Diplomado en Uñas Gelificadas', 'course', 'active',
  'Diplomado online de 25 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":25,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/unas-gelificadas/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001',
  'masoterapia', 'Diplomado en Masoterapia', 'course', 'active',
  'Diplomado online de 24 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":24,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/masoterapia/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001',
  'paisajismo_jardineria', 'Diplomado en Paisajismo y Jardinería', 'course', 'active',
  'Diplomado online de 24 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":24,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/paisajismo-jardineria/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001',
  'fotografia_profesional', 'Diplomado en Fotografía Profesional', 'course', 'active',
  'Diplomado online de 41 clases, con temario publicado (el temario detalla 26 módulos).',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":41,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/fotografia-profesional/","published_price_conflict":"699_vs_1200","declared_classes":41,"syllabus_module_count":26,"classes_syllabus_mismatch":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001',
  'estetica_integral', 'Técnica/o en Estética Integral', 'course', 'active',
  'Curso online de 20 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":20,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/estetica-integral/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000001',
  'vino_cata_maridaje', 'Introducción al Vino, la Cata y el Maridaje', 'course', 'active',
  'Curso online de 19 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":19,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/vino-cata-maridaje/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000001',
  'nutricion_alimentacion', 'Nutrición y Alimentación Saludable', 'course', 'active',
  'Curso online de 16 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":16,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/nutricion-alimentacion/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001',
  'cuidador_adultos_mayores', 'Asistente y Cuidador de Adultos Mayores', 'course', 'active',
  'Curso online de 14 clases, más 7 trabajos integradores y un trabajo práctico final, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":14,"temario_publicado":true,"additional_activities":{"trabajos_integradores":7,"trabajo_practico_final":true},"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/cuidador-adultos-mayores/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000001',
  'barista', 'Diplomado en Barista', 'course', 'active',
  'Diplomado online de 12 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":12,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/barista/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001',
  'sushi_principiantes', 'Sushi para Principiantes', 'course', 'active',
  'Curso online de 10 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":10,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/sushi-principiantes/","published_price_conflict":"699_vs_1200"}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000001',
  'depilacion_definitiva', 'Técnica/o en Depilación Definitiva', 'course', 'active',
  'Curso online de 7 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'quote', NULL, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":7,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El precio te lo confirma el equipo de inscripciones.","forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/depilacion-definitiva/","published_price_conflict":"699_vs_1200"}'::jsonb
)
ON CONFLICT (workspace_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name, offering_type = EXCLUDED.offering_type,
  status = EXCLUDED.status, description = EXCLUDED.description,
  value_proposition = EXCLUDED.value_proposition, price_type = EXCLUDED.price_type,
  price_amount = EXCLUDED.price_amount, currency = EXCLUDED.currency,
  billing_interval = EXCLUDED.billing_interval, audience = EXCLUDED.audience,
  delivery = EXCLUDED.delivery, guardrails = EXCLUDED.guardrails,
  metadata = EXCLUDED.metadata, updated_at = now();

INSERT INTO knowledge_sources (id, workspace_id, source_type, title, content, status, version, metadata) VALUES
('b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','business_profile',
 'Qué vende StudyX',
 'StudyX (Studyx Academia Internacional, operada por World Digital Group Corp / My Study X LLC, Florida, EE.UU.) vende diplomados online en español, a ritmo propio, con actividades prácticas, exámenes y un certificado emitido por la academia. El catálogo verificado tiene 14 diplomados con temario publicado, en oficios, gastronomía, marketing, belleza y salud/bienestar. La moneda es USD y el pago es con tarjeta. La edad mínima es 18 años.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb),
('b4000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','policy',
 'Límites comerciales (T&C literales)',
 'Los T&C del sitio dicen: "No somos una entidad educativa con licencia para brindar títulos, certificados con aval nacional" y "nuestros cursos/capacitaciones, no obtienen un certificado o licencia para poder ejercer dichos aprendizajes". Por eso el agente puede decir que se emite un certificado de la academia, y NUNCA puede prometer certificación verificada, título oficial, homologación, matrícula ni salida laboral. Tampoco puede citar precios (existe una contradicción $699/$1.200 sin resolver), ni ofrecer cuotas (no existen), ni afirmar horarios de clases en vivo (no hay publicados), ni responder sobre devoluciones (los documentos legales se contradicen). Ante cualquiera de esos temas: derivar al equipo de inscripciones.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb),
('b4000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','process',
 'Beca StudyX y cierre',
 'La Beca Studyx es el mecanismo de descuento del negocio y se aplica "únicamente con asistencia del departamento de inscripciones". Requisitos publicados: entregar los proyectos prácticos, 75% de asistencia y aprobar los exámenes con mínimo 6/10. El monto no está publicado: el agente nunca lo estima. El cierre natural del agente es agendar la conversación con inscripciones, donde se resuelven precio y beca.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb)
ON CONFLICT (workspace_id, title, version) DO UPDATE SET
  source_type = EXCLUDED.source_type, content = EXCLUDED.content,
  status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = now();

COMMIT;
