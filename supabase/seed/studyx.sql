-- ---------------------------------------------------------------------------
-- StudyX (production). Datos VERIFICADOS del sitio mystudyx.com al 14-ago-2026
-- (docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md). Los precios NO se
-- cargan: el sitio publica $699 y cobra $1,200 (hallazgo #1). price_type=quote
-- hasta que StudyX confirme. Idempotente via ON CONFLICT.
--
-- Este archivo es SEGURO de correr contra producción y es la vía soportada
-- para actualizar el catálogo (p.ej. cuando StudyX responda la pregunta de
-- precio: se edita este bloque, se sube `version` en knowledge_sources si
-- corresponde, y se re-corre). No seedear esto junto con dev.sql: dev.sql
-- contiene fixtures sintéticas (Aburridont, el contacto "Alumno Smoke") que
-- nunca deben llegar a producción — por eso StudyX vive en su propio archivo.
-- ---------------------------------------------------------------------------

BEGIN;

INSERT INTO workspaces (id, slug, display_name, environment, status, default_locale, timezone, metadata)
VALUES (
  'b0000000-0000-4000-8000-000000000001', 'studyx',
  'StudyX — Academia Internacional', 'production', 'active',
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200","declared_classes":34,"syllabus_item_count":20,"classes_syllabus_mismatch":true}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200","declared_classes":41,"syllabus_module_count":26,"classes_syllabus_mismatch":true}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
  '{"published_price_conflict":"699_vs_1200"}'::jsonb
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
