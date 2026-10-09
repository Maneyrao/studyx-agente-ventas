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
7. Para probar el alta efectiva, disponer de una central de carga de pruebas y
   del worker publicado con entorno `test`. Una central configurada como `live`
   no debe dar de alta al cliente por un pago sandbox. Una fila en
   `fulfillment_jobs` confirma el pedido pendiente, no la habilitación del campus.

La integración de enlaces y avisos no agrega por sí misma un mensaje automático
de confirmación al cliente: comprobar por separado el worker de alta y la entrega
de credenciales una vez que la central confirme la habilitación.

Documentación: [Payment Links](https://docs.stripe.com/payment-links/api),
[tarjetas de prueba](https://docs.stripe.com/testing),
[webhooks](https://docs.stripe.com/webhooks).
