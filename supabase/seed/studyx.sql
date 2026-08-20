-- ---------------------------------------------------------------------------
-- StudyX (production). Datos VERIFICADOS del sitio mystudyx.com al 14-ago-2026
-- (docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md). Idempotente via ON CONFLICT.
--
-- PRECIOS (decisión del dueño, 17-ago-2026). El sitio tiene dos números: las
-- fichas `/diplomado/` publican $699.00USD y los 30 productos de `/shop` se
-- cobran a $1,200.00 sin excepción (hallazgo #1, verificado en 3 cursos, +71,7%).
-- Se modelan los dos:
--   * `price_amount = 1200.00` — el precio estándar, que es el que el checkout
--     cobra de verdad. Es el único que el agente cotiza, así que nunca puede
--     decir un número que el pago después desmienta.
--   * `metadata.beca_price_usd = 699.00` — el precio con Beca Studyx. NO lo
--     cotiza el agente: el sitio dice que la beca se aplica "únicamente con
--     asistencia del departamento de inscripciones", así que es la palanca de
--     cierre de una persona, no un descuento que el bot reparta.
-- La equivalencia beca↔$699 es la hipótesis de B.3 del análisis y sigue SIN
-- confirmar por StudyX (pregunta E.1). Por eso va marcada
-- `beca_hypothesis_unconfirmed: true` y no como un hecho.
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
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":38,"modules":5,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
  'entrenamiento_funcional', 'Diplomado en Entrenamiento Funcional', 'course', 'active',
  'Diplomado online de 36 clases en 3 módulos, con temario completo publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":36,"modules":3,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001',
  'decoracion_de_interiores', 'Diplomado en Decoración de Interiores', 'course', 'active',
  'Diplomado online de 34 clases, con temario publicado (el temario detalla 20 ítems).',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":34,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true,"declared_classes":34,"syllabus_item_count":20,"classes_syllabus_mismatch":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001',
  'unas_gelificadas', 'Diplomado en Uñas Gelificadas', 'course', 'active',
  'Diplomado online de 25 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":25,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001',
  'masoterapia', 'Diplomado en Masoterapia', 'course', 'active',
  'Diplomado online de 24 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":24,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001',
  'paisajismo_jardineria', 'Diplomado en Paisajismo y Jardinería', 'course', 'active',
  'Diplomado online de 24 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":24,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001',
  'fotografia_profesional', 'Diplomado en Fotografía Profesional', 'course', 'active',
  'Diplomado online de 41 clases, con temario publicado (el temario detalla 26 módulos).',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":41,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true,"declared_classes":41,"syllabus_module_count":26,"classes_syllabus_mismatch":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001',
  'estetica_integral', 'Técnica/o en Estética Integral', 'course', 'active',
  'Curso online de 20 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":20,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000001',
  'vino_cata_maridaje', 'Introducción al Vino, la Cata y el Maridaje', 'course', 'active',
  'Curso online de 19 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":19,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000001',
  'nutricion_alimentacion', 'Nutrición y Alimentación Saludable', 'course', 'active',
  'Curso online de 16 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":16,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001',
  'cuidador_adultos_mayores', 'Asistente y Cuidador de Adultos Mayores', 'course', 'active',
  'Curso online de 14 clases, más 7 trabajos integradores y un trabajo práctico final, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":14,"temario_publicado":true,"additional_activities":{"trabajos_integradores":7,"trabajo_practico_final":true},"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000001',
  'barista', 'Diplomado en Barista', 'course', 'active',
  'Diplomado online de 12 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":12,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"source_url":"/diplomado/barista/","standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001',
  'sushi_principiantes', 'Sushi para Principiantes', 'course', 'active',
  'Curso online de 10 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":10,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
),
(
  'b1000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000001',
  'depilacion_definitiva', 'Técnica/o en Depilación Definitiva', 'course', 'active',
  'Curso online de 7 clases, con temario publicado.',
  'Formación online en español, a ritmo propio, con actividades prácticas, exámenes y certificado de la academia.',
  'fixed', 1200.00, 'USD', 'custom',
  '{"language":"Spanish","min_age":18}'::jsonb,
  '{"modality":"online","classes":7,"temario_publicado":true,"includes":["actividades_practicas","examenes_parciales_y_final","profesores_que_acompanan","certificado_de_academia"]}'::jsonb,
  '{"never_invent_price":true,"price_message":"El diplomado son USD 1.200. Existe la Beca Studyx, que aplica unicamente el departamento de inscripciones.","beca_amount_gated":true,"forbidden_promises":["certificación verificada","título oficial","homologación","matrícula profesional","cuotas o financiación","más de 50 diplomados","horarios de clases en vivo","política de devoluciones"]}'::jsonb,
  '{"standard_price_usd":1200.00,"beca_price_usd":699.00,"price_source":"mystudyx.com 2026-08-14: /shop cobra 1200 en los 30 productos; las fichas /diplomado publican 699","beca_hypothesis_unconfirmed":true}'::jsonb
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
 'StudyX (Studyx Academia Internacional, operada por World Digital Group Corp / My Study X LLC, Florida, EE.UU.) vende diplomados online en español, a ritmo propio, con actividades prácticas, exámenes y un certificado emitido por la academia. El catálogo cargado en este sistema son los diplomados con temario publicado y verificado, en oficios, gastronomía, belleza y salud/bienestar. StudyX publica más diplomados de los que están cargados acá, así que el agente nunca afirma un total ni dice que un curso no existe porque no lo encuentre en su catálogo: ante un curso que no tenga, deriva a inscripciones. La moneda es USD y el pago es con tarjeta. La edad mínima es 18 años.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb),
('b4000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','policy',
 'Límites comerciales (T&C literales)',
 'Los T&C del sitio dicen: "No somos una entidad educativa con licencia para brindar títulos, certificados con aval nacional" y "nuestros cursos/capacitaciones, no obtienen un certificado o licencia para poder ejercer dichos aprendizajes". Por eso el agente puede decir que se emite un certificado de la academia, y NUNCA puede prometer certificación verificada, título oficial, homologación, matrícula ni salida laboral. Sobre el precio: el único importe que el agente dice es el del catálogo, y es el que cobra el checkout. No estima, no redondea, no arma planes. La Beca Studyx existe y es el mecanismo de descuento del negocio, pero el sitio dice que se aplica "únicamente con asistencia del departamento de inscripciones": el agente puede mencionar que la beca existe y ofrecer derivar, y nunca dice a cuánto queda el curso con beca. Tampoco puede ofrecer cuotas ni financiación (no existen en el sitio), ni afirmar horarios de clases en vivo (no hay publicados), ni responder sobre devoluciones (los documentos legales se contradicen entre sí). Ante cualquiera de esos temas: derivar al equipo de inscripciones.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb),
('b4000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','process',
 'Beca StudyX y cierre',
 'La Beca Studyx es el mecanismo de descuento del negocio y se aplica "únicamente con asistencia del departamento de inscripciones". Requisitos publicados: entregar los proyectos prácticos, 75% de asistencia y aprobar los exámenes con mínimo 6/10. El monto no está publicado: el agente nunca lo estima. El cierre natural del agente es agendar la conversación con inscripciones, donde se resuelven precio y beca.',
 'active',1,'{"source":"mystudyx.com 2026-08-14"}'::jsonb),

-- Los seis bloques siguientes son el resto de la verdad verificada del sitio
-- (Partes B y C del análisis) que hasta ahora no vivía en la base. Cada uno
-- responde a una objeción o a un riesgo real del embudo, y todos citan al sitio
-- de forma literal donde el texto importa jurídicamente.
('b4000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000001','business_profile',
 'Quién cobra y bajo qué ley',
 'La marca es "Studyx | Academia Internacional". La opera World Digital Group Corp (doing business as MyStudyx) y es propiedad de My Study X, LLC, con sede declarada en el sur de Florida, Estados Unidos. Los T&C dicen que "se aplicará la legislación estadounidense y todas las disputas serán resueltas por el tribunal estadounidense competente". El teléfono publicado es +1 (866) 217-7282 y el mail info@mystudyx.com. Hay una sede administrativa en Sunny Isles Beach, Florida, y otra en Recoleta, Santiago de Chile. Para usar el sitio hay que tener 18 años o la mayoría de edad del país. La entidad que cobra NO es argentina.',
 'active',1,'{"source":"mystudyx.com 2026-08-14","analysis_ref":"B.1"}'::jsonb),

('b4000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000001','policy',
 'Consentimiento: qué canal está cubierto',
 'El formulario del sitio captura, literal: "Al llenar este formulario, nos das tu consentimiento para comunicarnos contigo por SMS." La política de privacidad dice "We contact the people who fill out the form trough calls and SMS." No hay ninguna mención a WhatsApp en el consentimiento, ni en la privacidad, ni en los términos y condiciones. Es decir: el opt-in publicado cubre SMS y llamadas, no WhatsApp. Si un contacto llega por WhatsApp sin un consentimiento específico para ese canal, el caso se escala a una persona antes de cualquier mensaje comercial; no se asume cubierto por el formulario del sitio.',
 'active',1,'{"source":"mystudyx.com 2026-08-14","analysis_ref":"B.6 / C.3 riesgo 2","risk":"regulatorio"}'::jsonb),

('b4000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000001','policy',
 'Devoluciones: los documentos se contradicen',
 'La política de devoluciones dice, en inglés y sin traducción en un sitio "100% en español": "All sales are final and no refund will be issued." Los términos y condiciones dicen que "los productos digitales no poseen devolución del dinero", pero agregan que "si Studyx comprueba que hubiese un error de cobro, Studyx se responsabiliza a hacer el reembolso total del dinero". Las dos reglas no son compatibles entre sí. Mientras StudyX no defina cuál rige, el agente no afirma ninguna política de devolución: escucha el caso, no promete nada y lo deriva al equipo de inscripciones.',
 'active',1,'{"source":"mystudyx.com 2026-08-14","analysis_ref":"B.6 / C.3 riesgo 4"}'::jsonb),

('b4000000-0000-4000-8000-000000000007','b0000000-0000-4000-8000-000000000001','business_profile',
 'Tamaño real del catálogo y qué no afirmar',
 'La tienda tiene 30 productos y hay 28 fichas de diplomado publicadas. La home afirma "más de 50 diplomados online": ese número no se corresponde con nada verificable y el agente no lo repite. Aproximadamente la mitad del catálogo (13 de 28) no publica temario en el sitio; en esos casos el temario sólo existe dentro del PDF de "Descargar programa". Dos productos se venden sin ninguna ficha que los explique: AutoCAD orientado al Diseño de Interiores, y Estrategias para Emprender. Cuando alguien pregunta por un curso cuyo temario el agente no tiene, lo dice con naturalidad y ofrece que inscripciones le pase el programa, en vez de improvisar contenidos.',
 'active',1,'{"source":"mystudyx.com 2026-08-14","analysis_ref":"B.2 / C.3 riesgo 5"}'::jsonb),

('b4000000-0000-4000-8000-000000000008','b0000000-0000-4000-8000-000000000001','policy',
 'Modalidad: qué se puede afirmar sobre las clases',
 'Las 28 fichas declaran la modalidad como "Online en vivo", pero describen contenido asincrónico, y no hay un solo horario, fecha de inicio ni calendario publicado en ninguna ficha. Lo que sí está respaldado: es online, en español, a ritmo propio, con actividades prácticas, exámenes parciales y final, y profesores que acompañan durante la cursada. El agente puede afirmar eso. No afirma horarios ni fechas de clases en vivo, porque no existen publicados; si se lo preguntan, deriva a inscripciones. Ojo con el campus: la home enlaza la app de Moodle, pero el campus real corre sobre Tutor LMS.',
 'active',1,'{"source":"mystudyx.com 2026-08-14","analysis_ref":"B.7 / C.3 riesgo 6"}'::jsonb),

('b4000000-0000-4000-8000-000000000009','b0000000-0000-4000-8000-000000000001','process',
 'Prueba social publicada y programa Enterprise',
 'Testimonios publicados con nombre: Amanda Gutierrez, Omar Dominguez, Ailiim Carp, odelaisis hernandez y naanim montecinos. El de Omar Dominguez es material de venta directo: "Agradecido por el excelente diplomado me ayudo a despegar laboralmente y ahora soy mi propio jefe, lo recomiendo a ojos cerrados, ahora ya voy con mi segundo diplomado aumentando mis servicios en decoración de interiores y exteriores". Casos de éxito publicados: Felipe Serrano (oficios, paneles solares), Cristian y Ana Maria (gastronomía, catering y pastelería), Amparo y Edson (diseño gráfico). La valoración real de Google es 4.7 sobre 17 reseñas; las fichas del sitio muestran todas "4.5 de 5", que no es un dato verificable y el agente no lo cita. Sobre el programa Enterprise: lo único publicado es que los alumnos Enterprise pueden solicitar sin costo adicional el diploma físico enviado por FedEx. No hay página de planes, precios ni condiciones, así que el agente no describe el programa más allá de eso.',
 'active',1,'{"source":"mystudyx.com 2026-08-14","analysis_ref":"B.4 / B.8"}'::jsonb)
ON CONFLICT (workspace_id, title, version) DO UPDATE SET
  source_type = EXCLUDED.source_type, content = EXCLUDED.content,
  status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = now();

-- ---------------------------------------------------------------------------
-- Owner-confirmed commercial configuration (2026-08-20).
--
-- This deliberately supersedes the historical website scrape above. The
-- website's old price/financing copy is not an authority once the business
-- owner has configured the three live Stripe payment links below. Keeping the
-- options on the workspace makes them visible to Agent A as structured data;
-- the prompt fails closed if this exact three-option set is absent or altered.
-- ---------------------------------------------------------------------------

UPDATE workspaces
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
  'legal_entity', 'My Study X, LLC / World Digital Group Corp (FL)',
  'source', 'owner-confirmed 2026-08-20',
  'payment_options', jsonb_build_array(
    jsonb_build_object(
      'code', 'monthly_12', 'currency', 'USD', 'total_amount', '360.00',
      'installments', 12, 'installment_amount', '30.00',
      'payment_link', 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f'
    ),
    jsonb_build_object(
      'code', 'monthly_6', 'currency', 'USD', 'total_amount', '360.00',
      'installments', 6, 'installment_amount', '60.00',
      'payment_link', 'https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a'
    ),
    jsonb_build_object(
      'code', 'one_time', 'currency', 'USD', 'total_amount', '360.00',
      'installments', 1, 'installment_amount', '360.00',
      'payment_link', 'https://buy.stripe.com/9B64gy7hYesaaVa1Rpdwc0j'
    )
  )
), updated_at = now()
WHERE slug = 'studyx';

UPDATE offerings AS o
SET
  price_type = 'fixed',
  price_amount = 360.00,
  currency = 'USD',
  billing_interval = 'custom',
  guardrails = jsonb_build_object(
    'never_invent_price', true,
    'price_message', 'El valor total es USD 360. Podés elegir 12 pagos de USD 30, 6 pagos de USD 60 o un pago único de USD 360.',
    'forbidden_promises', jsonb_build_array(
      'certificación verificada', 'título oficial', 'homologación',
      'matrícula profesional', 'más de 50 diplomados',
      'horarios de clases en vivo', 'política de devoluciones'
    )
  ),
  metadata = jsonb_build_object(
    'total_price_usd', 360.00,
    'payment_options_owner_confirmed', true,
    'price_source', 'owner-confirmed 2026-08-20'
  ),
  updated_at = now()
FROM workspaces AS w
WHERE o.workspace_id = w.id AND w.slug = 'studyx';

UPDATE knowledge_sources AS ks
SET content = CASE ks.title
  WHEN 'Límites comerciales (T&C literales)' THEN
    'StudyX emite un certificado de la academia. El agente NUNCA promete certificación verificada, título oficial, homologación, matrícula, salida laboral, horarios de clases en vivo ni una política de devoluciones. Configuración comercial confirmada por el dueño el 20-ago-2026: el valor total es USD 360 y existen únicamente tres opciones: 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. No hay una cuarta opción, descuento adicional, Apple Pay, Google Pay ni otro enlace de pago que el agente pueda ofrecer. El enlace se comparte solamente después de que el prospecto elige explícitamente una de esas tres opciones. Un comprobante no confirma pago: la confirmación viene del webhook verificado de Stripe.'
  WHEN 'Beca StudyX y cierre' THEN
    'El cierre del Agente A ocurre después de una presentación breve y una pregunta de diagnóstico. Debe cerrar por elección entre tres opciones: 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o pago único de USD 360. Una vez que el prospecto elige, pide nombre completo, email, ciudad y ZIP code y comparte únicamente el enlace de la opción elegida. El acceso académico nunca se promete por una captura: depende de la confirmación de pago verificada por Stripe.'
  ELSE ks.content
END,
metadata = jsonb_set(ks.metadata, '{source}', to_jsonb('owner-confirmed 2026-08-20'::text), true),
updated_at = now()
FROM workspaces AS w
WHERE ks.workspace_id = w.id
  AND w.slug = 'studyx'
  AND ks.title IN ('Límites comerciales (T&C literales)', 'Beca StudyX y cierre');

COMMIT;
