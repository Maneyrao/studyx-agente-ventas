# Plan — intención del turno, bonificación por motivo actual, programas PDF (2026-11-04)

Runtime canónico (decisión del dueño 2026-11-04): Agent A brain plannerless V2,
rama `claude/agent-a-model-owned-sales`, base `9987e2a`. Decision v4 queda fuera
del camino vivo. No se copia runtime desde `codex/bot-a-lean-g1-g2`, y no se
tocan los 43 archivos sin commitear del checkout principal.

## Artefacto del error

- Trace `a96de4bf-b7d1-4810-b851-680e4b63a06f`, turno `9c085893…`.
- Backend `9987e2a`; bot publicado 10:22Z del mismo código; brain v162; canónico v108; deepseek-v4-flash.
- Cliente: «osea me regalas otro curso?» + «dos por uno?».
- move `ask_course_information` 0.86. turn_reasoning: «objeción de precio con promo ya ofrecida», next_step «promo».
- proposed_action `offer_course_bonus` → `publicidad_redes_sociales`. Sin memorias nuevas.
- Paquete: ciclo `70374e5c`, offer_version 1 → 2, bonusCount 1 → 2. Sin rechazo ni reparación.
- Causa: el permiso acepta una objeción **persistida** (turno anterior) más cualquier respuesta posterior.
- «bien, y cómo se paga?» (trace `8d8c5474`) se clasificó bien: `ask_payment_options`, acción none.

## Bloques (un implementador a la vez, sin ediciones paralelas)

0. **AGENTS.md (al final) antes del código:** runtime canónico; motivo de bonificación en el mensaje actual; consultas de pago; `send_course_program`; Real Estate USD 360 activo; PDF servidos desde el backend; sin CTA prefabricados.

1. **Intención del turno.**
   - Agregar a `ConversationMoveKindV1` (bot y espejo del backend): `price_objection`, `explicit_promotion_request`, `request_course_program`. `decline_purchase` cubre `purchase_decline`. Ya existen `ask_payment_options`, `select_payment_plan` y `request_payment_link`.
   - Prompt y brain: la clasificación es del mensaje actual; el historial sólo resuelve referencias breves.

2. **Bonificación por motivo actual.**
   - `offer_course_bonus` suma `motive: { kind: price_objection | promotion_rejection | better_promotion_request | purchase_decline, quote }`.
   - El backend exige que `quote` sea literal del lote entrante actual, para toda bonificación (también la primera).
   - Se retira la vía «memoria persistida autoriza».
   - Se mantienen los demás límites: curso pago existente, activo y distinto, máximo 3, uno por acción, afinidad, oferta anterior respondida, paquete no aceptado, cerrado ni pagado, e idempotencia.
   - El «sí» a la pregunta del precio cuenta como motivo `price_objection` con la cita del «sí» actual.
   - En cualquier otro turno, el paquete queda igual (ciclo, versión, bonusCount y cursos). Test: no hay ningún otro escritor.

3. **CTA prefabricados fuera.**
   - Inventario de `commercial-router` y `transaction-fast-path` (y de cualquier texto comercial fijo vivo).
   - Las rutas sin modelo que redactan copy comercial pasan al modelo con los hechos. Los efectos (link y plan) se conservan.

4. **Programas PDF.**
   - Los 28 PDF oficiales (`Documents/AGENTE IA/programas-studyx/`) van empaquetados en `public/programas/<slug>.pdf`. Registro `offering_code → { slug, path, sha256, mime: application/pdf, filename, version }` validado contra `programas-studyx-pdf.json`.
   - Nueva acción `send_course_program { offering_code }`. El backend resuelve el asset (nunca una URL del modelo), valida curso, asset y sha, y arma la parte saliente de tipo archivo.
   - El bot envía el documento por WhatsApp (Botpress, mensaje `file`).
   - Entrega idempotente por (conversación, offering, versión): un segundo pedido no reenvía y recibe una respuesta natural.
   - Si la entrega falla, no se afirma que se envió; la reparación retira la oración que lo afirma.

5. **Real Estate.**
   - Migración aditiva: offering `real_estate`, USD 360, activo, planes 1 / 6×60 / 12×30, con sus hechos del programa. Se aplica a la base compartida sólo con el OK del dueño al desplegar.
   - Verificar el mapeo de checkout y link de pago.

6. **Tests sin proveedor y 12 replays con DeepSeek** (lista G del pedido). Tabla con la respuesta real, move, proposed_action, efectos y paquete antes/después.

7. **Revisión final del arquitecto.** No se despliega hasta presentar la evidencia.

## Ajustes tras la revisión del arquitecto (2026-11-04)
1. Además de la cita literal, `motive.kind` debe ser coherente con el `move`/`secondary_moves` declarado. En el trace del error el move era `ask_course_information`, así que habría sido rechazado. Prompt y replay: una aclaración de la oferta vigente no pide otro curso.
2. Retirar la vía persistida: `read-course-bonus-ladder.ts:67`, `agent-turn-policy-v2.ts:585`, `direct-course-bonus-service.ts:304-306`, capacidad y contexto (`read-course-bonus-capability.ts:635`, `agent-a-context.ts:731`, `agent-a-brain-v1.ts:202`), los esquemas (bot `agent-a-brain.ts:414`, espejo `agent-a-brain-schema.ts:263`, JSON schema de DeepSeek `lib/conversation/agent-a-brain.ts:586`) y los tests listados.
3. «Sí» a la pregunta del precio: la cita es un fragmento entero y el turno anterior del agente declaró estructuradamente la pregunta (persistida en la decisión). Nada de regex sobre el texto del agente.
4. Pedido de un curso puntual → `better_promotion_request`. El cambio no suma cursos. El test «sin otro escritor del paquete» cubre direct-course-bonus-service, reserve-payment-link, postgres-retell-orchestration-store y commercial-followup-service.
5. Bloque 3 acotado: en la ruta plannerless sólo queda `groundedPriceReplyV1` (CTA fijo) y el texto «Hubo un problema…». La copia del router y del fast-path sólo corre con el brain apagado.
6. Bloque 4:
   - Envío `file` por WhatsApp (integración 4.18.5).
   - Migración aditiva: `part_index` 0–2 y marca de documento, más la tabla `course_program_deliveries` con UNIQUE.
   - Variable de URL pública de assets.
   - Los PDF (170 MB) quedan fuera de git: se copian al deploy verificando el sha256.
   - Primero el documento; el texto nunca afirma el éxito.
7. Bloque 5: los offerings viven sólo en la base. Se prepara un script idempotente que se aplica con el OK del dueño. Los links son por plan. Faltan el código `real-estate`, sus hechos (no tiene ficha de Gabi), la afinidad y Central de Carga.
