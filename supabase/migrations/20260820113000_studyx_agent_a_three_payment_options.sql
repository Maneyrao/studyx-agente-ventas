-- Owner-confirmed commercial configuration for Agent A (2026-08-20).
-- Keep payment links as structured business data: the prompt will fail closed
-- unless these exact three records are available.

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
  guardrails = COALESCE(o.guardrails, '{}'::jsonb) || jsonb_build_object(
    'never_invent_price', true,
    'price_message', 'El valor total es USD 360. Podés elegir 12 pagos de USD 30, 6 pagos de USD 60 o un pago único de USD 360.',
    'forbidden_promises', jsonb_build_array(
      'certificación verificada', 'título oficial', 'homologación',
      'matrícula profesional', 'más de 50 diplomados',
      'horarios de clases en vivo', 'política de devoluciones'
    )
  ),
  metadata = COALESCE(o.metadata, '{}'::jsonb) || jsonb_build_object(
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
metadata = jsonb_set(COALESCE(ks.metadata, '{}'::jsonb), '{source}', to_jsonb('owner-confirmed 2026-08-20'::text), true),
updated_at = now()
FROM workspaces AS w
WHERE ks.workspace_id = w.id
  AND w.slug = 'studyx'
  AND ks.title IN ('Límites comerciales (T&C literales)', 'Beca StudyX y cierre');
