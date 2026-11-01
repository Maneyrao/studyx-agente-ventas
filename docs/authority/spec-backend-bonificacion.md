# Spec backend — Bonificación de cursos (opción B)

Objetivo: que el Agente A pueda ofrecer cursos bonificados directamente en la conversación, sin pasar por `request_promotion_review`, con un máximo de 3 cursos por venta. El agente decide **cuándo** y **cuál**; el backend valida los **límites** y es la única autoridad sobre lo que queda ofrecido y aceptado.

Reemplaza el flujo actual `request_promotion_review` → `offer_available` (los campos `may_request_review` y `bonus_selection_mode` dejan de usarse en el prompt).

---

## 1. Capability nueva / modificada

```json
"capabilities": {
  "course_bonus": {
    "enabled": true,
    "max_bonus_courses": 3
  }
}
```

- `enabled`: interruptor global (o por campaña). Si es `false`, el agente nunca ofrece.
- `max_bonus_courses`: tope configurable. Hoy = 3.

## 2. Estado de la promoción

```json
"commercial_state": {
  "promotion": {
    "promotion_code": "PRM-xxxx",
    "status": "none | offer_available | accepted | expired | cancelled",
    "interest_offering_code": "<curso pago>",
    "bonus_offerings": [
      { "offering_code": "<código>", "name": "<nombre>", "offered_at": "<ISO>" }
    ],
    "accepted_at": null
  }
}
```

- Una sola promoción por venta (por `interest_offering_code`). Cada oferta nueva **agrega** un curso a `bonus_offerings`; no crea otra promoción.
- Si el cliente cambia de curso pago, la promoción anterior pasa a `cancelled` y se arranca de cero.

## 3. Acción nueva: `offer_course_bonus`

Propuesta del agente:

```json
{
  "move": "negotiate",
  "proposed_action": "offer_course_bonus",
  "bonus_offering_code": "<un solo código>",
  "interest_offering_code": "<curso pago>"
}
```

### Validaciones (rechazar el turno con `turn_rejection` si alguna falla)

| # | Regla | Motivo de rechazo sugerido |
|---|---|---|
| 1 | `capabilities.course_bonus.enabled = true` | `bonus_disabled` |
| 2 | Existe al menos una memoria `type=objection, key=price_objection` en la conversación | `no_price_objection` |
| 3 | `bonus_offering_code` existe y está activo en `catalog.available_offerings` | `invalid_offering` |
| 4 | Es distinto de `interest_offering_code` | `same_as_paid_course` |
| 5 | No está ya en `bonus_offerings` | `duplicate_bonus` |
| 6 | `len(bonus_offerings) < max_bonus_courses` | `bonus_limit_reached` |
| 7 | Un solo código por turno | `multiple_bonus_in_turn` |
| 8 | Hay un mensaje del cliente posterior a la última oferta de bonificación (no dos ofertas seguidas sin respuesta) | `bonus_without_reply` |
| 9 | La venta no está pagada (`payment_verification.status != paid`) ni con promoción `accepted` | `sale_already_closed` |

Si pasa: agregar el curso a `bonus_offerings`, poner `status=offer_available` (crear `promotion_code` si no existía) y ejecutar el turno con la respuesta del agente tal cual.

Si se rechaza: devolver `turn_rejection` con `subject=forbidden_promise` y el motivo. El agente reescribe sin mencionar la bonificación (el prompt ya lo contempla).

**Importante:** la validación tiene que ocurrir **antes** de enviar el mensaje al cliente, porque el agente nombra el curso bonificado en la misma respuesta.

## 4. `accept_promotion` (modificar)

- Recibe `promotion_code` e `interest_offering_code` (el curso pago).
- Acepta **todos** los cursos de `bonus_offerings` de esa promoción.
- Pasa `status=accepted` y guarda `accepted_at`.
- Validar que `status` sea `offer_available`.

## 5. `send_payment_link` (modificar)

- Si hay promoción `accepted`, el link lleva el `promotion_code`.
- El precio del curso pago no cambia (USD 360 en el plan elegido). Los bonificados van a USD 0.

## 6. Alta / fulfillment (modificar)

- Al verificar el pago (`paid` + `paid_at`), inscribir al alumno en el curso pago **y en cada curso de `bonus_offerings`**.
- El mensaje de acceso debe reflejar todos los cursos activados. Si un bonificado falla al dar de alta, el pago sigue confirmado y el caso se deriva a humano.

## 7. Logs / métricas recomendadas

- Cantidad de bonificados por venta cerrada (0, 1, 2, 3).
- Tasa de cierre después de cada escalón de bonificación.
- Rechazos por motivo (para detectar si el agente intenta ofrecer de más).

## 8. Casos de prueba mínimos

1. Ofrece bonificación sin objeción de precio previa → rechazado (`no_price_objection`).
2. Primera bonificación válida → `offer_available` con 1 curso.
3. Segunda bonificación en el turno siguiente sin respuesta del cliente → rechazado (`bonus_without_reply`).
4. Tercera bonificación válida → 3 cursos. Cuarta → rechazado (`bonus_limit_reached`).
5. Bonifica el mismo curso que compra → rechazado (`same_as_paid_course`).
6. Cliente acepta → `accepted`, link con `promotion_code`, pago, alta en 1 + N cursos.
7. Cliente cambia de curso pago después de una bonificación → promoción anterior `cancelled`.
