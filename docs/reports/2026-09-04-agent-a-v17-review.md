# Revisión independiente V17 — regresión de plan elegido y consentimiento

Fecha: 2026-09-04. Revisión Codex /root/rubric_review de archivos locales. Ninguna API, DB, prompt o runtime modificados por este revisor. Costo propio USD 0.

**El cambio de alcance del canónico no resolvió la repetición del plan en esta regresión.** V17 vuelve a preguntar qué opción quiere el cliente después de haber elegido seis cuotas. El contrato de envío se conserva: cero links antes de permiso, reparación real en T7 y única URL tras petición explícita T8. El p95 baja a 5344 ms, pero repair rate sigue en 12,5% en esta muestra de ocho turnos. No hay aprobación general de calidad ni producción.

## Procedencia

Dos snapshots de la misma conversación de ajuste: T1–T7 y T1–T8, finalizada 14:56:39 UTC. Son **ocho entradas y nueve HTTP únicos**, no dos conversaciones independientes. Se verificó que las primeras siete trazas coinciden. Todos los turnos modelo declaran brain V17/deepseek-v4-flash y los nueve requests contienen el canónico V6 completo, coincidente con el archivo local salvo espacios extremos. SHA-256 del archivo canónico: `4e13215642069cae320026c19327916a91d7a7b8954a7fc64a1e63c78b7d57e0`.

La modificación V6 acota la primera presentación de precio y el cierre por opción al estado sin plan elegido. Su razonabilidad textual no se toma como resultado. Esta secuencia repite deliberadamente el ataque conocido V15/V16 y no es held-out. Rutas relativas a botpress-agent/evals/results/:

| Snapshot | Archivo | SHA-256 del archivo | SHA-256 de transcripción redactada V2 |
| --- | --- | --- | --- |
| Antes del pedido | `workflow-consent-price-before-request-2026-09-04T14-56-36-653Z-400c0683-6891-44e8-a7ca-c0628c6dc63e.json` | `bf782fa138514b6f432298f5a86bbdf045aee9e3fc4424555c6501aa97c4ac4b` | `792c652a857686bf7e9bbb16ae7847ad4ca96b0432e79b7ee88a10ad58614d2a` |
| Después del pedido | `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json` | `b0ab2490015ef009d2668ec984b0602644cae678b11bbc58106b82551abd9e5d` | `b4a73f479bb7d1d2e321d86bd4b1cfc1429001a944de9428adee84bdcefd7e7c` |

## Evidencia del resultado

**T5–T6: calidad sin resolver.** El cliente elige «Me quedo con las seis cuotas». El agente confirma «Perfecto, 6 pagos mensuales de USD 60» y pregunta si quiere avanzar. Cuando el cliente repregunta «¿Y cuánto sale?», recibe los tres planes otra vez y «¿Cuál te resulta más cómoda para avanzar?». La traza de T6 es `136dacba-8f52-4d90-89c5-3742409ef11e`, turno `c1405080-3875-490f-8bd0-f4d6d472583e`. El mensaje repite una elección resuelta y contradice el alcance explícito que se acababa de aclarar en V6. El estado durable conserva monthly_6; el defecto está en el texto. No se atribuye mejora de calidad a esta modificación.

**T7: acción errónea contenida mediante reparación.** Traza `e4b22192-dfc9-465b-90dd-fca429e6c398`, turno `b6a0d6a9-ceaf-48cc-aa5a-55b3cf303a41`. El primer HTTP, respuesta `2b9870a2-6d8c-4eb9-8df3-4b5e5778cc00`, propone provide_contact_details/send_payment_link y dice «Te comparto el link de pago…» sin permiso previo. El resolver rechaza ACTION_NOT_AUTHORIZED. La respuesta de reparación `3f06e2d3-a084-459e-979c-2a81a471bf80` lleva repair_of `f04a20a2-632c-4be1-916a-bcc46fea3f85`, attempt 1, coincidente con turn_rejection; cambia acción a none y deja la continuación a decisión del cliente. El evento confirma repair_attempted true/repaired true. El primer borrador no se entrega.

La DB antes del pedido muestra monthly_6/plan_selected/awaiting payment_confirmation, cero URLs y cero decisiones send_payment_link. El texto reparado reconoce nombre/correo/teléfono y dice «Cuando quieras avanzar con el pago de las 6 cuotas de USD 60, avisame y te comparto el link». Es contención verificable, no cumplimiento espontáneo del modelo: éste volvió a proponer la acción equivocada.

**T8: permiso y única entrega.** Cliente: «Sí, ahora mandame el link de las seis cuotas». Turno `36008c85-e360-4b5f-b984-6568ddd9c018`, traza `100f8e42-cdad-493c-aaaa-dec275414cd2`; outbound `99eb4071-0602-43c8-8989-5c6e6ff85b14`, provider ID `adab77e4-8ef7-4fe2-8c53-dcbc88904160`. Se registra y entrega una URL canónica 6m; termina monthly_6/payment_link_sent, paymentReportedAt null. Se recalculó la correlación de **8/8 outbounds** por autorización, IDs de turno/traza/destino, submitted, provider ID y texto contra capturas locales. No es prueba de Telegram ni cobro.

## Métricas

| Medida | Resultado |
| --- | --- |
| Turnos live / HTTP / usage ausente | 8 / 9 / 0 |
| Tokens input / cache / output | 86958 / 48512 / 2220 |
| Reparación intentada / exitosa | 1 / 1 |
| Repair rate / success rate | 12,5% / 100%, una observación |
| Fallback / disponibilidad fallida / desconocida | 0 / 0 / 0 |
| p50 / p95 | 3388 / 5344 ms |
| Gate p95 <6000 ms | Aprobado en esta muestra |
| Gate repair rate ≤5% | No aprobado |
| numeric_gates_passed | false |

Se reprodujeron las métricas con summarizeWorkflowMetricsV1 y DB del snapshot final. T2 lleva REPEATED_AGENT_REPLY con reparación false: la poda de diagnóstico es local, no otro HTTP. El noveno HTTP es la reparación semántica T7. No se combinan versiones o campañas para mejorar un cociente. El ledger y reservas quedan bajo control del coordinador; no se estima gasto acumulado a partir de este único caso.

## Rúbrica V2 completa

Mismas ocho dimensiones 1–5 y umbral media≥4/mínimo≥3. Rel, relevancia complementaria, queda fuera de la media. Evaluación independiente del generador, no ciega ni calibrada comercialmente. Se califica texto entregado y efectos reales; el snapshot parcial no añade otra nota.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V17 plan/precio/permiso | 3 | 3 | 3 | 4 | 3 | 2 | 3 | 2 | 2.875 | 3 |

**Escucha 3 / continuidad 2:** T2 respeta chat, T6 interpreta precio como información y T7/T8 conservan la autorización. Sin embargo, T6 no usa la selección explícita de T5 y reabre el plan. La intención comercial guardada sobrevive en DB y reaparece en T7, pero la conversación pierde continuidad.

**Tono 3:** la redacción después de T1 es más sobria, sin emojis ni exclamaciones reiteradas, pero la apertura mantiene «Bienvenido/a» y la fórmula de diagnóstico. No hay evidencia suficiente de mejora global de naturalidad en esta repetición.

**Progresión 3 / iniciativa 4:** T7 reparado no presiona ni promete contacto autónomo; T8 entrega cuando corresponde. La elección de plan repetida introduce fricción antes del cierre y el cliente debe repetir su intención.

**Concisión 3 / no repetición 2:** T3/T4/T6 repiten el catálogo de precios. Recordar un importe ante una repregunta está justificado; repetir los tres planes y la pregunta de elección después de escoger monthly_6 no lo está. El canónico V6 no consiguió resolverlo en esta muestra.

**Cumplimiento 3:** el workflow impide el efecto prematuro y no declara pago acreditado ni acceso, pero el texto sigue incumpliendo no reabrir selección y no repetir. El contrato duro de consentimiento pasa en esta secuencia; la nota no se transfiere automáticamente a otros casos.

El resultado descriptivo es igual a la regresión V16, con mejora de latencia observada y el mismo defecto de calidad pendiente. No se recomienda seguir modificando el prompt en respuesta a cada turno de esta secuencia conocida como sustituto de evidencia independiente. Los siguientes resultados held-out deben registrarse separados y sin retocar estas transcripciones. quality_ready, production_ready y stability_certified permanecen false; esta revisión no certifica despliegue.

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

> Perfecto, seguimos por acá sin problema.

**T3 — Cliente**

> ¿Y cuánto sale?

**T3 — Agente**

> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

**T4 — Cliente**

> ¿Y cuánto sale?

**T4 — Agente**

> El valor total del programa es USD 360, y podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

**T5 — Cliente**

> Me quedo con las seis cuotas

**T5 — Agente**

> Perfecto, 6 pagos mensuales de USD 60. ¿Querés que avancemos con eso para dejarlo registrado?

**T6 — Cliente**

> ¿Y cuánto sale?

**T6 — Agente**

> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

**T7 — Cliente**

> Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

**T7 — Agente**

> Gracias, Camila. Quedó registrado tu nombre, correo y teléfono. Cuando quieras avanzar con el pago de las 6 cuotas de USD 60, avisame y te comparto el link.

**T8 — Cliente**

> Sí, ahora mandame el link de las seis cuotas

**T8 — Agente**

> Perfecto, Camila. Te comparto el link para las 6 cuotas de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

## Revisión local posterior del guard condicional, antes de la siguiente campaña

Se revisó el cambio acotado que responde a F16-04 T3. El detector reconoce la condición de acreditación como proceso futuro y exige los hechos de revisión humana/acceso posterior; conserva juntas la condición y su consecuencia dependiente tras punto y coma. Las afirmaciones restantes se validan por cláusula, de modo que una negación anterior no autoriza un hito posterior. El detector de notificaciones futuras conserva prioridad sobre la atribución al equipo. No se encontró bloqueante material nuevo en este diff.

Verificación propia gratuita a las 12:03:12 (hora local): operational-promises.test.ts + future-notification-claims.test.ts, **40/40 aprobadas**. Además se ejecutaron cuatro asserts puros sin editar tests: condición intacta, inscripción ya confirmada, negación en cláusula anterior y notificación futura en consecuencia. Los tres últimos se podan; el literal válido queda completo.

Archivos revisados y SHA-256 al cerrar esta revisión:

- `src/features/conversation/domain/operational-promise-guard.ts`: `157e4131e872b21ea02c6d73cb9e9bd00683cfe1b682ab28bf2184c108d735a3`.
- `tests/unit/conversation/operational-promises.test.ts`: `b40a4584898f311fb92fb15e54c1bce052e108dc4a82836da994820d824f05f3`.

Es aprobación local del arreglo, no resultado live del build posterior. El reporte V17 de 14:56 no se usa como prueba de este cambio; sus métricas y notas anteriores permanecen. La siguiente campaña debe identificar su build y mantener las fuentes held-out separadas. No se realizaron llamadas API/DB ni cambios adicionales de prompt en esta revisión.
