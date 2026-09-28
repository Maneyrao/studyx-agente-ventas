# Plan de cierre StudyX A → B → A

## Objetivo

Cerrar la integración real entre chat, llamada, pagos y persistencia sin modificar la personalidad ni el prompt conversacional del Agente A.

## 1. Alinear el despacho a Xendra

- Conservar `internal_call_id`, `lead_id` y `conversation_id` en el cuerpo de `/api/studyx/llamar`.
- Enviar `apellido_lead`, `curso_interes` y `plan_code` solo cuando exista un valor durable.
- Incorporar `campos_faltantes`.
- No enviar cadenas vacías para valores desconocidos.
- Mantener nombre, correo, teléfono, país, asesor y resumen existentes.

### Pruebas focales

- Contexto completo: transmite todos los valores.
- Contexto parcial: omite opcionales desconocidos y declara `campos_faltantes`.
- Replay del despacho: no crea una segunda llamada.

## 2. Ampliar `registrar_resultado`

- Aceptar opcionalmente `curso_seleccionado` y `plan_code`.
- Resolver el curso contra el catálogo canónico y el plan contra los tres códigos autorizados.
- Persistir selecciones confirmadas en el mismo estado comercial de la conversación.
- No transformar una posibilidad, consulta u oferta en selección.
- Mantener separados pago informado, link enviado y pago verificado.
- Actualizar Supabase y la misma proyección de Sheets de forma idempotente.

### Pruebas focales

- Selección válida actualiza el mismo lead.
- Campos omitidos no borran información previa.
- Curso o plan inválido produce error estructurado sin perder el resto del resultado.
- Repetición del mismo evento no duplica estado ni filas.

## 3. Verificar ciclo de llamada

- Validar recepción idempotente de `call_started`, `call_ended` y `call_analyzed`.
- Conservar el `disconnection_reason` real.
- Esperar brevemente `call_analyzed` después de `call_ended` antes del fallback.
- Comprobar estos cierres:
  - no atendió → ofrecer reintento o chat;
  - corte abrupto → preguntar si desea reintentar o continuar;
  - error del proveedor → informar indisponibilidad y continuar por chat;
  - finalización normal → continuar desde lo aprendido por B.

## 4. Reparar el webhook productivo de Stripe

- Crear o regenerar el endpoint productivo con los eventos necesarios.
- Cargar el nuevo `whsec_` directamente en Vercel.
- Desplegar y enviar una entrega de prueba.
- Exigir respuesta `2xx` y comprobar replay idempotente.
- Desactivar el endpoint anterior solo después de verificar el reemplazo.
- Nunca registrar claves, firmas completas ni datos sensibles.

Esta operación sobre Stripe productivo se ejecutará únicamente con autorización explícita del propietario.

## 5. Gates y despliegue

Durante el desarrollo, ejecutar únicamente pruebas focales. Al cerrar:

- unitarias;
- integraciones afectadas con PostgreSQL;
- typecheck;
- lint;
- ADK check/build;
- build de Next.js;
- `git diff --check`.

Después:

1. Commit y push.
2. Desplegar Vercel y Botpress desde el mismo SHA.
3. Verificar commit en health/readiness.
4. Enviar a Lucas `READY_STUDYX_RESULT_CONTRACT_V3`.
5. Confirmar la versión publicada de B.

## 6. Smoke vertical supervisado

Recorrido obligatorio:

```text
A recibe el lead
→ solicita llamada
→ Xendra inicia B
→ B pregunta únicamente los datos faltantes
→ B guarda datos mediante el orquestador
→ B confirma curso y plan
→ B solicita el link
→ A entrega un único link en el chat
→ se interrumpe o finaliza la llamada
→ llegan call_ended y call_analyzed
→ A retoma con la memoria actualizada
→ Stripe verifica el pago mediante webhook
→ Supabase y Sheets reflejan el mismo lead
```

## Criterio final

La integración queda aprobada si:

- hay una sola llamada y un solo link;
- A y B usan el mismo lead y conversación;
- A no vuelve a pedir datos obtenidos por B;
- no existen `401`, errores de correlación ni solicitudes de herramienta inválidas;
- no se duplican contacto, fila de Sheets, eventos ni pago;
- un pago solo se marca verificado tras la confirmación firmada de Stripe;
- el seguimiento posterior corresponde al resultado real de la llamada.
