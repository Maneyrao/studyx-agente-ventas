# StudyX ↔ Xendra — ampliación final de `registrar_resultado`

## Contexto confirmado

StudyX ya acepta el contrato publicado por el Agente B v2 para:

- correlación mediante `internal_call_id`, `lead_id` y `conversation_id`;
- `guardar_datos_contacto`, incluido `apellido`;
- `enviar_link_pago` con `{ "cursos": ["codigo_canonico"], "plan_code": "..." }`;
- eventos `call_started`, `call_ended` y `call_analyzed`.

Estamos ampliando nuestro validador para conservar también una selección realizada durante la llamada aunque todavía no se haya solicitado el link de pago.

## Cambio solicitado en el Agente B

Agregar a `registrar_resultado` dos campos **opcionales**:

```json
{
  "curso_seleccionado": "codigo_canonico",
  "plan_code": "monthly_12 | monthly_6 | one_time"
}
```

Reglas:

1. Enviar `curso_seleccionado` únicamente cuando la persona haya elegido o confirmado un curso. No usarlo para cursos meramente mencionados, comparados u ofrecidos.
2. Enviar `plan_code` únicamente cuando haya una elección o confirmación expresa del plan.
3. Si alguno no está confirmado, omitir el campo; no enviar `null`, cadena vacía ni un valor inferido.
4. Estos campos no sustituyen `enviar_link_pago`: esa herramienta sigue siendo la única forma de solicitar que el Agente A entregue el link en el chat.
5. `pago_confirmado` solo puede ser verdadero cuando el backend haya verificado el pago. La declaración verbal del cliente no alcanza.
6. Mantener el resto del contrato v2 sin cambios.

## Coordinación de publicación

Podés implementar y probar el cambio ahora, pero no habilites al agente para emitir estos dos campos hasta que StudyX confirme:

`READY_STUDYX_RESULT_CONTRACT_V3`

Después de esa confirmación, publicá/fijá la versión y respondé con:

- número de versión publicada;
- esquema efectivo de `registrar_resultado`;
- confirmación de que los campos se omiten cuando no están confirmados;
- una muestra válida y otra sin esos campos.

## Criterio de aceptación conjunto

En una web call supervisada:

1. B obtiene o confirma curso y plan.
2. B guarda cualquier dato de contacto nuevo mediante el orquestador.
3. B puede solicitar el link durante la llamada.
4. A entrega un solo link en el chat.
5. `registrar_resultado` conserva la selección confirmada.
6. Al terminar, A retoma el mismo lead sin volver a pedir datos ya guardados.
7. No se duplican llamada, link, contacto, evento ni fila de Sheets.
