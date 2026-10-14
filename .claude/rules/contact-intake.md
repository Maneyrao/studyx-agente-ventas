---
paths:
  - "src/lib/services/ingestion.service.ts"
  - "src/lib/heuristics/contact-identity.ts"
  - "src/lib/repositories/contact-intake.repository.ts"
---

# Identidad y respuestas de varios mensajes

- `contacts` es la fuente de verdad para la identidad y los datos de contacto;
  el historial que comprende el modelo no demuestra una escritura.
- `messages.metadata.contact_intake_response_v1` es un recibo generado por el
  backend, con `request_message_id` y `captured_fields`. Nunca copiarlo de los
  metadatos del caller.
- Conservar una pregunta entregada entre mensajes sólo si las respuestas
  intermedias tienen recibos para esa misma pregunta. Un mensaje ajeno o una
  nueva pregunta entregada cierra la asociación; campos ya respondidos no se
  sobrescriben por contexto ambiguo.
- Nombre parcial y apellido parcial conservan `contact_name_answer_v1`.
  Recibo, mensaje y actualización del contacto pertenecen a la misma
  transacción serializable. Replay no crea otra captura.
- La identidad del canal sigue en `contacts.phone`; un número escrito por la
  persona se guarda en `declared_phone`, sin cambiar la clave del contacto.
