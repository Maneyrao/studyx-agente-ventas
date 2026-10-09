# Stripe sandbox en el chat

El agente conserva el recorrido comercial: consulta, elección del curso, datos
del contacto, confirmación del plan y envío del link. No se manda un link por
cada mensaje ni se registra una venta por haberlo enviado.

## Configuración

- `PAYMENT_LINK_ENVIRONMENT=test` selecciona los tres links `PAYMENT_LINK_SANDBOX_12M`,
  `PAYMENT_LINK_SANDBOX_6M` y `PAYMENT_LINK_SANDBOX_CONTADO`.
- Esos links deben pertenecer a Stripe sandbox (`https://buy.stripe.com/test_...`).
  Si falta uno, no se sustituye por el link real ni por otro plan.
- `STRIPE_SANDBOX_WEBHOOK_SECRET` autentica exclusivamente
  `/api/webhooks/payments/stripe/sandbox`. Registrar ese destino en el sandbox
  con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed` y `checkout.session.expired`.
- Mantener las credenciales y links reales existentes. No hace falta sustituir
  `STRIPE_SECRET_KEY`: estos Payment Links son alojados por Stripe y el receptor
  comprueba la firma localmente.
- Publicar de nuevo después de cambiar variables en Vercel. El selector se aplica
  a todas las conversaciones atendidas por ese backend y al seguimiento de llamadas,
  que comparte el mismo resolver. Para una prueba separada, configurar otro backend
  y conectar sólo el bot o chat de prueba a él.
- Para restaurar los links reales, fijar `PAYMENT_LINK_ENVIRONMENT=live` y volver
  a publicar. Verificar antes que los tres links reales estén configurados.

## Asociación y confirmación

Antes de entregar un link, se reserva un pago con el cliente, curso, plan y
entorno. El agente añade `client_reference_id` a la URL; Stripe lo devuelve en
su aviso firmado. Probar con el link recibido desde el chat, no con el link base.
El correo escrito en Checkout no reemplaza la identidad registrada en el chat.

Sólo un aviso firmado de pago `paid`, con importe, moneda, sesión y entorno
coincidentes, puede registrar el pago y crear una solicitud de alta. Los avisos
repetidos no crean una segunda solicitud. Los pagos de prueba conservan
`payments.environment=test`. La deduplicación de links distingue prueba y real.

## Prueba manual

1. Iniciar una conversación nueva con un contacto de prueba y consultar un curso
   activo. Verificar respuestas normales, captura de datos y elección del plan.
2. Confirmar la compra. Comprobar que llega un link sandbox con referencia propia.
3. Pagar con la tarjeta de prueba `4242 4242 4242 4242`, vencimiento futuro y CVC
   de tres cifras. Confirmar el aviso de Stripe, pago `paid` en entorno `test`,
   cliente/curso correctos y una sola solicitud de alta.
4. Con otro contacto, probar rechazo (`4000 0000 0000 0002`), abandono y expiración.
   No debe registrarse pago confirmado ni crearse el alta. Un rechazo de tarjeta
   dentro de Checkout no implica automáticamente un evento de fallo de sesión.
5. Probar los otros planes y dos contactos distintos. Cada pago debe conservar
   su propio cliente y curso.
6. Repetir el aviso de confirmación y comprobar que no se duplica la solicitud.
7. Para la prueba autorizada del 09-10-2026, la central actual debe aceptar
   explícitamente pagos `test` y ejecutar el alta real en el campus. El worker
   sigue publicado con entorno `test`. Sin esa excepción, una central `live`
   rechaza el pago sandbox. Una fila en `fulfillment_jobs` confirma el pedido
   pendiente, no la habilitación del campus.

Con `POST_SALE_ENABLED=true`, el pago confirmado dispara el aviso automático y
el pedido de alta. La entrega de credenciales requiere la confirmación efectiva
de la central; comprobar también que se puede ingresar al curso.

Documentación: [Payment Links](https://docs.stripe.com/payment-links/api),
[tarjetas de prueba](https://docs.stripe.com/testing),
[webhooks](https://docs.stripe.com/webhooks).

## Activated post-sale flow — 2026-10-09

The production Agent A chat now selects explicit Stripe sandbox links (`PAYMENT_LINK_ENVIRONMENT=test`). `POST_SALE_ENABLED=true` activates durable follow-ups. Central enrollment consumes only test payments after the configured activation cutoff. The user explicitly authorized creating real platform accounts and course access from these test payments in the current Central de Carga. `CENTRAL_CARGA_ALLOW_SANDBOX_CONTACTS=true` permits those identities while retaining `environment=test`; it does not change the remote Central's accepted payment environments.

A verified paid event queues `payment_received` and enrollment independently. The Botpress custom event `studyxPostSale` lets the existing Agent A model/personality write the confirmation without another customer turn. Confirmed central enrollment queues `access_ready`; it waits until the payment notification has been accepted by the messaging provider. Enrollment email must match the frozen registration email. The backend adds:

- Usuario: the confirmed registration email
- Contraseña: Studyx.123 for a newly created user

Existing users retain their current password. Password changes are suggested, never required. The login URL is included only when the central returns a valid HTTPS URL. The narrative is model-authored; the credential list uses authoritative values. Delivery is pinned to the purchase conversation.

Stripe webhook background work runs enrollment immediately and can retry transient enrollment failures within a bounded 240-second budget, at most three attempts. Hobby does not support a minute-level cron; the daily recovery sweep remains, with opportunistic recovery on the existing chat projection flush. Failed narrative generation schedules a bounded delayed dispatch. Ambiguous message delivery is held for reconciliation rather than blindly resending credentials. Permanent enrollment failures queue an access-delay notice and retain the paid state for operator resolution.

Validation: TypeScript/lint, production build, 3,691 unit tests and 97 integration tests passed. Botpress ADK build/typecheck/check passed and production deployment succeeded. The production backend health and authenticated pipeline probes returned 200; Central signed GET returned expected `not_found` for a random payment UUID; Botpress runtime authentication returned 200 and matched the deployed bot. Actual DeepSeek smoke responses confirmed natural payment/access copy and an optional password-change suggestion.

This establishes deployment and integration readiness. A new chat purchase still needs to confirm actual Central POST acceptance of `test`, course mapping, credentials, and campus login. Do not label those downstream behaviors verified solely from the GET probe or local fake Central tests.

## Alta real desde sandbox: activación pendiente

El pago `46595744-4993-48cd-87f0-026ec619272e` está confirmado en `test`.
La tarea `e3b37e71-de3f-48bc-933e-429ee8c5b2af` recibió
`central_environment_mismatch`, tras un intento, y no tiene alta confirmada.

El cambio pendiente pertenece a la central: permitir temporalmente `test` en
su validación de entorno, después de autenticar la request, y usar el servicio
real de alta e inscripción. El repositorio del orquestador no contiene esa
implementación ni controla la configuración remota de aceptación de la central.

Después de publicar ese cambio, recuperar el pago existente sin cobrar otra vez:

1. Consultar la central por el mismo `payment_id` para reconciliar cualquier alta.
2. Reabrir sólo la tarea identificada, si sigue en `dead_letter` por ese error y
   el pago sigue `paid/test`. Conservar el historial y `attempt_count=1`.
3. Ejecutar el pipeline con ese `payment_id`. El worker consulta primero el alta
   y reutiliza la clave de idempotencia si debe crearla.
4. Confirmar el alta del mail registrado al curso Inglés 2, la entrega de la lista
   de credenciales y el ingreso efectivo a ese curso. La contraseña acordada
   para cuentas nuevas es `Studyx.123`; cuentas existentes conservan la suya.

Para cerrar la prueba, retirar la aceptación de `test` en la central, restaurar
`PAYMENT_LINK_ENVIRONMENT=live` y `CENTRAL_CARGA_ENVIRONMENT=live` en el
orquestador y publicar nuevamente. Desactivar los Payment Links sandbox para
que los links ya enviados no permitan nuevas compras de prueba. Revisar antes
las tareas pendientes; no borrar pagos ni volver a enviar credenciales de altas
ya completadas.
