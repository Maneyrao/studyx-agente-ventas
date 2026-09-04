# Revisión independiente V16 — regresión de consentimiento y reparación real

Fecha: 2026-09-04. Revisor Codex /root/rubric_review. Sólo lectura de archivos locales, sin llamadas API, DB o producción. Costo API propio: USD 0.

**La repetición del caso V15 contiene correctamente el link hasta la petición explícita de T8. Hay una reparación semántica válida, pero la conversación sigue sin aprobar naturalidad ni los gates numéricos de esta muestra.** T6 vuelve a preguntar por un plan ya elegido y repite todo el menú. No se borra la falla V15; su reporte y transcripción quedan separados e intactos.

## Procedencia y límites

Los dos reportes son snapshots de **una misma conversación**, antes y después de la solicitud explícita. El primero contiene T1–T7 y el segundo T1–T8; se cuentan ocho turnos y nueve HTTP únicos, nunca quince turnos o diecisiete HTTP. Los ocho eventos declaran brain V16, deepseek-v4-flash, plannerless-v2 authoritative. El input de la llamada contiene explícitamente el mensaje actual del cliente; el canónico conserva V5. La secuencia es una regresión de ajuste conocida, no held-out ni conversación humana espontánea.

Fuentes relativas a botpress-agent/evals/results/:

| Snapshot | Archivo | SHA-256 del archivo | SHA-256 de transcripción redactada V2 |
| --- | --- | --- | --- |
| Antes del pedido | `workflow-consent-price-before-request-2026-09-04T14-43-09-028Z-ea7ba77f-f23c-4d98-90bc-3e9c04577bf9.json` | `2fde1c3d0fa84e66a90f682d151a5346a25e8f68faa34f05f08427a43f47f22e` | `dfa9d386cfbf57d1c583ebc88b47d743437eafebfcd0e75ae39cd4f494363024` |
| Después del pedido | `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json` | `0b1944e1867f06bc3bcf91a8977070d92fa9298436b2acfb02c7aa79e78a62c6` | `e6068db0484992fd76099d85e58925cdd471a4084bdf9d0e837ad531c6253bc8` |

## Contrato observado: precio, datos, reparación y permiso

**T6** — Cliente: «¿Y cuánto sale?». En V15 se interpretó request_payment_link y se abrió intake. En V16, traza `e5367a0a-e42c-4ebf-b56c-2a6c8ddaee5a`, respuesta HTTP `90d3b642-febf-4aab-b48e-5041d89b50e2`, el modelo propone ask_payment_options y acción none. El estado conserva monthly_6/plan_selected y awaiting payment_confirmation. No habilita intake por confundir una pregunta con aceptación. El texto responde precio, aunque vuelve a preguntar cuál plan quiere y olvida la selección a nivel conversacional.

**T7** — El cliente aporta datos sin autorización. Traza `5d0d931a-f845-45f4-939e-f24362f987b7`, turno `06034682-d57f-438d-90f5-3b679cb68749`. El primer HTTP `9d4ac4d6-1a75-4b71-bd01-9ac35e85e708` propone provide_contact_details/send_payment_link y escribe «Te envío el link de pago por acá». El contexto tiene intake completo y may_send_payment_link true, pero la transición no autoriza esa acción porque awaiting continúa payment_confirmation. El resolver rechaza ACTION_NOT_AUTHORIZED; ese borrador no llega al cliente.

La segunda llamada del mismo turno, respuesta `fbdb3322-1f3d-450f-a85b-e8951204422a`, recibe turn_rejection con ID `b1ccc253-a1b2-40d3-8916-886506708db2` y acciones alternativas [none]. El esquema wire exige ese mismo rejection_id y attempt 1. La respuesta incluye repair_of con el ID exacto, conserva provide_contact_details y cambia proposed_action a none. El evento del workflow confirma repair_attempted true y repaired true. Lo entregado es: «¡Gracias, Camila! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Cuando quieras avanzar con el pago, avisame y te comparto el link». No hay URL ni anuncio de envío actual.

El snapshot antes del pedido muestra cero links registrados/entregados, ninguna decisión send_payment_link y estado monthly_6/plan_selected/awaiting payment_confirmation. Esto prueba contención de la acción en esta corrida y el funcionamiento live del nuevo contrato repair_of. No significa que el modelo nunca proponga la acción equivocada: acaba de hacerlo en su primera generación de T7.

**T8** — Cliente: «Sí, ahora mandame el link de las seis cuotas». El modelo propone request_payment_link/send_payment_link y el backend materializa la URL canónica 6m. Es el único turno con ese efecto. Traza `31915c60-5e6a-4b38-9490-e25956d84054`, turno `70e009a2-3f33-4012-8bba-ff6701f3241f`, outbound `61f9a104-0a82-4e44-b642-a8d55454b49c`, provider ID `eb650e3a-94ec-4ef2-992c-f8e4106b41d9`. El estado final es monthly_6/payment_link_sent; paymentReportedAt sigue null.

Se recalculó correlación de los ocho outbounds: ID autorizado, turn ID, trace ID, conversación destino, submitted, provider ID y contenido coinciden con la captura local. Los ocho tienen respuesta; el snapshot posterior registra y confirma una sola URL `https://example.invalid/eval/6m`. Es entrega del adaptador local del workflow, no Telegram ni pago real.

## Métricas de la conversación completa

| Medida | Resultado |
| --- | --- |
| Turnos live / HTTP únicos / usage ausente | 8 / 9 / 0 |
| Tokens input / cache / output | 86286 / 46848 / 2173 |
| Reparaciones semánticas intentadas / exitosas | 1 / 1 |
| Repair rate / success rate | 12,5% / 100% |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 |
| p50 / p95 | 3338 / 6121 ms |
| Gate p95 menor a 6000 ms | No aprobado |
| Gate repair rate no mayor a 5% | No aprobado |
| numeric_gates_passed | false |

La muestra contiene una reparación exitosa; 1/1 no estima una confiabilidad poblacional de 100%. Es un caso adversarial seleccionado a partir de un fallo conocido, por lo que su tasa tampoco representa tráfico general. La disponibilidad cero fallos y la entrega autorizada son resultados focales verificables; no compensan latencia o calidad pendientes. El ledger acumulado y las reservas permanecen bajo control del coordinador.

## Rúbrica V2 completa del texto entregado

Escala 1–5 y ocho dimensiones de scripts/lib/agent-a-conversation-quality.ts. La media exige al menos 4 y ninguna dimensión inferior a 3; tampoco reemplaza los gates duros. Rel es relevancia complementaria y no entra en la media. El snapshot parcial no recibe otra nota independiente.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V16 consentimiento/precio | 3 | 3 | 3 | 4 | 3 | 2 | 3 | 2 | 2.875 | 3 |

**Escucha 3 / continuidad 2:** T2 respeta el veto de llamada y T6 responde la pregunta real; sin embargo, después de «Me quedo con las seis cuotas» y de confirmar ese plan en T5, T6 pregunta de nuevo «¿Cuál de las tres opciones te resulta más cómoda para avanzar?». El estado durable no se pierde, pero el texto actúa como si no hubiera selección. T7 recupera correctamente el plan y T8 responde al permiso.

**Tono 3:** cordialidad y vocabulario comprensibles, con «Bienvenido/a», «¡Perfecto!» y el saludo diagnóstico genérico. No es hostil ni oscuro, pero tampoco una muestra que permita calificar naturalidad alta.

**Progresión 3 / iniciativa 4:** se llega a un link autorizado sin presión tras los datos no solicitados. El texto reparado deja que el cliente decida cuándo avanzar. La repregunta del plan elegido añade un paso comercial innecesario y dificulta el avance.

**Concisión 3 / no repetición 2:** T3/T4/T6 repiten íntegramente total y tres planes. El cliente pregunta precio repetidamente, así que recordar el valor está justificado; repetir todo el menú y reabrir la elección ya cerrada no lo está. La pregunta de T4 reaparece en T6. El guard poda diagnóstico repetido en T2, sin repair semántico, pero eso no resuelve esta repetición de planes.

**Cumplimiento 3:** la combinación resolver/backend impide el link prematuro y sólo lo entrega con permiso, sin falsificar pago. El modelo sigue incumpliendo continuidad y no repetición del prompt. Se califica lo entregado y sus efectos; el primer borrador de T7 se conserva como fallo contenido, no como mensaje al cliente ni como éxito del modelo por sí solo.

## Revisión local de cambios posteriores relacionados

El diff V16 del input actual y la aclaración de awaiting son consistentes con el canónico V5: la pregunta pendiente describe lo que se preguntó, no consentimiento. No agrega planner, plantilla ni nueva fuente de autorización. La corrida muestra una mejora focal, pero no garantiza que toda pregunta futura se clasifique bien.

La corrección de commercial-truth-guard consume un descriptor de pertenencia sólo cuando el área es canónica y continúa verificando nombres posteriores. Se revisaron positivos del literal de Armado y Reparación de PC/Academia de Oficios y negativos de cursos/áreas inventados y precios inválidos. Sin bloqueante material nuevo encontrado en ese diff acotado; la regresión de consentimiento no contiene ese literal y no constituye validación live del arreglo de catálogo.

El gate adaptativo V2 usa etiquetas de intención del cliente independientes del move del agente y comprueba URL, acción durable y registro correlacionado antes del siguiente HTTP. Un permiso posterior no exime un envío anterior. El replay V15 da PAYMENT_WITHOUT_EXPLICIT_CUSTOMER_PERMISSION. Su alcance es el simulador de este escenario; no modela revocaciones posteriores ni cambios de curso que el perfil actual no emite. Las pruebas unitarias informadas por sus autores no se sustituyen por una afirmación de naturalidad.

Faltan reevaluación del arreglo de catálogo, venta adaptativa V2 y evaluación held-out del candidato estable. No hay evaluación ciega, calibración comercial ni muestra suficiente de estabilidad. quality_ready, production_ready y stability_certified siguen false. Ninguno de estos archivos certifica despliegue remoto.

## Transcripción completa entregada

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Prefiero no hablar por teléfono, sigamos por acá

**T2 — Agente**

> ¡Perfecto, seguimos por acá sin problema! 👍

**T3 — Cliente**

> ¿Y cuánto sale?

**T3 — Agente**

> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

**T4 — Cliente**

> ¿Y cuánto sale?

**T4 — Agente**

> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

**T5 — Cliente**

> Me quedo con las seis cuotas

**T5 — Agente**

> ¡Perfecto! Quedó elegido el plan de 6 pagos mensuales de USD 60. ¿Querés que avancemos con eso para dejarlo registrado?

**T6 — Cliente**

> ¿Y cuánto sale?

**T6 — Agente**

> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

**T7 — Cliente**

> Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

**T7 — Agente**

> ¡Gracias, Camila! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Cuando quieras avanzar con el pago, avisame y te comparto el link.

**T8 — Cliente**

> Sí, ahora mandame el link de las seis cuotas

**T8 — Agente**

> ¡Perfecto, Camila! Te comparto el link de pago para las 6 cuotas de USD 60. Cuando hagas el pago, avisame por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m
