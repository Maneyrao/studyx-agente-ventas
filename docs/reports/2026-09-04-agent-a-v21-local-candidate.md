# Agente A V21 — candidato local y gate pendiente

Actualización: 2026-09-04 21:50 UTC.

## Estado

**READY_FOR_FRESH_PAID_RERUN. No está aprobado para desplegar ni para canario de Telegram.**

Producción continúa en `07328e23f97054aeb92a108562f70b6ef3a88bb4`, Brain V20. Vercel continúa en `dpl_4oQWvw17x2Pr6dVrXbW1qZ7adP4i`; Botpress STUDYX continúa con la publicación observada el 2026-09-04 a las 17:00:07 UTC. Este trabajo no ejecutó ninguna mutación remota.

## Qué pasó en la conversación real

La única conversación real conservada después del despliegue tuvo 21 mensajes entrantes y 20 respuestas entre 17:18:20 y 17:23:31 UTC. Hubo cero ofertas de llamada, cero acciones de pago y cero URLs. Las 20 salidas tienen reporte durable `submitted_to_botpress` y el usuario confirmó haberlas recibido.

La causa primaria fue que “fotografía” terminó como `catalog_resolution=not_found` aunque el catálogo tenía dos cursos pertinentes. El contexto autoritativo dejó curso y planes vacíos y `may_offer_call=false`. Después “Quizás personal” se persistió como preferencia `chat/declined` sin un rechazo real. El extractor guardó correo y teléfono, pero no nombre y apellido entregados durante el diálogo. Cuando el usuario escribió “Pasame el link de pago”, seguían faltando curso, plan e identidad autorizados. Una propuesta posterior intentó usar el curso incorrecto `aires_acondicionados`; los gates la bloquearon y ningún enlace fue enviado.

La evidencia sanitizada está en [transcripción del canario fallido](evidence/2026-09-04-agent-a-telegram-canary/transcript.md), [diagnóstico de workflows](evidence/2026-09-04-agent-a-telegram-canary/workflow-diagnostics.json) y [persistencia](evidence/2026-09-04-agent-a-telegram-canary/persistence.json). Los originales privados siguen bajo `.eval/codex-20260904/telegram-review/` y no deben publicarse.

## ¿Consume las indicaciones?

Sí: las 20 decisiones reales usaron `studyx-agent-a-brain-v20`, `deepseek-v4-flash` y la ruta `AGENT_A_PLANNERLESS_V2`. La ruta desplegada pasa `buildAgentABrainInstructionsV1(context)` como `instructions`; al reconstruir gratuitamente cada request desde su claim remoto, los 20 incluyen el canónico completo. El tamaño observado fue de 30.688 a 31.835 caracteres. No existe una captura HTTP literal, así que no se afirma igualdad byte a byte en tránsito.

El fallo no fue ausencia del prompt. El modelo recibió un contexto que ya decía “curso desconocido”, “no puede ofrecer llamada” y, luego, “prefiere chat”. Además, binding, reparación, poda y truth guard modificaron o redujeron varias propuestas antes de la entrega. El compositor legacy estaba apagado. Recibir las instrucciones completas no garantiza obedecerlas cuando el estado autoritativo está mal o cuando una etiqueta semántica abre un bypass posterior.

## Correcciones V21

- El catálogo devuelve los dos candidatos de fotografía y exige desambiguación antes de vender.
- Una llamada de voz es obligatoria en la primera respuesta con curso canónico y capacidad disponible; se conserva un máximo de dos invitaciones y se bloquean después de un rechazo real.
- `continue_by_chat` y `decline_call` requieren evidencia del texto actual. “Quizás personal” conserva preferencia desconocida.
- Si llegan varios mensajes juntos, la última elección explícita de canal manda. Una preferencia final por chat bloquea `request_call_now`; un pedido final de llamada lo habilita. Preguntas naturales como “¿Hablamos por teléfono?” se reconocen y un rechazo como “No quiero una llamada” nunca puede convertirse en handoff.
- La identidad se extrae según el pedido efectivamente entregado en la misma conversación, contacto, integración, proveedor y destino. Admite nombre y apellido en mensajes separados y no confía en metadata como si fuera respuesta.
- El intake incompleto no puede producir “quedó registrado” ni una respuesta que omita el siguiente campo pendiente.
- “Para dejarlo registrado necesito…” y “me falta… para dejarlo registrado” se reconocen como pedidos futuros tanto en el ADK como en el backend. Ya no se confunden con una afirmación de persistencia.
- El curso y plan persisten durante el intake. El backend materializa solamente el link canónico configurado después de pedido explícito y datos completos.
- `defer_payment` y `decline_purchase` requieren evidencia actual. “Después te paso mi apellido” no posterga el pago y “Inés” no cierra la venta.
- El segundo intento por JSON/schema inválido recibe el campo y código concretos sin sumar retries.

Estas medidas corresponden a las prácticas de feedback correlacionado y contexto vigente observadas en Parlant, LiveKit y OpenAI Agents SDK, sin incorporar otro runtime. La comparación está en [el informe de referencias](2026-09-04-agent-a-reference-feedback-comparison.md).

## Workflow V21 observado

Las repeticiones pagas posteriores encontraron dos falsos positivos adicionales antes de terminar la conversación. DeepSeek sí generó “Para dejarlo registrado necesito…” y, después de recibir `Inés`, “Me falta tu apellido… para dejarlo registrado”. El validador del ADK interpretó primero la finalidad futura como si fuera una afirmación de datos ya guardados. El backend tenía el mismo error con la forma pronominal “dejarlo registrado”. La poda por repetición terminó entregando solamente “¡Gracias, Inés!”.

Eso explica también la falta del link: la persistencia sólo acepta un apellido aislado si el último mensaje efectivamente entregado lo pidió. En la conversación contaminada el pedido había sido podado; por lo tanto `Valdés` no se infirió, `intake_missing=["apellido"]` permaneció activo y `may_send_payment_link=false` bloqueó correctamente la acción. La última reparación no pudo ejecutarse porque se agotó el margen reservable del presupuesto.

El candidato actual corrige ambos validadores y se probó con una conversación nueva de nueve turnos por el handler real, backend real y PostgreSQL real. Sólo la frontera DeepSeek fue sustituida por propuestas fixture, con costo USD 0:

1. Seleccionó Fotografía Profesional y ofreció una llamada.
2. Registró el rechazo y continuó por chat sin volver a ofrecerla.
3. Presentó USD 360, 12×USD 30, 6×USD 60 y pago único de USD 360.
4. Persistió el plan `one_time`.
5. Ante el pedido de link solicitó nombre, apellido, correo y teléfono.
6. Persistió `Inés` y entregó el pedido de apellido, correo y teléfono.
7. Persistió `Inés Valdés` y pidió correo y teléfono.
8. Persistió `ines.valdes@example.test` y pidió teléfono.
9. Persistió `+13055550176`, materializó exactamente `https://example.invalid/eval/contado` y correlacionó decisión, outbound y captura del adaptador.

Estado final verificado: `fotografia_profesional`, `one_time`, `payment_link_sent`, `callPreference=chat`, `callOfferStatus=declined`, una oferta de llamada, intake completo, una decisión de pago y un único link registrado y entregado. El escenario exige una sola propuesta aceptada por turno; una reparación inesperada lo hace fallar. El archivo completo pasa 4/4 e incluye además postergación, opt-out, idempotencia y caída del proveedor.

Esto certifica contratos, persistencia y entrega del workflow local. La comprensión y naturalidad del modelo requieren todavía una ejecución paga nueva desde una conversación limpia. Artefactos privados: `.eval/codex-20260904/candidate-v21-final/deterministic-sequential-intake-full.log` y `botpress-agent/evals/results/workflow-deterministic-sequential-intake-*.json`.

## Naturalidad observada

La revisión independiente de la primera transcripción fallida dio 3,0/5. En los últimos turnos pagados el modelo desambiguó bien, ofreció llamada, respetó el rechazo, contestó el precio canónico y pidió los cuatro datos. No se recalifica la conversación determinística como naturalidad real porque sus respuestas están fijadas. La variación de la segunda invitación y el cierre completo necesitan observarse en el próximo workflow pago.

| Dimensión | Puntaje / 5 |
| --- | ---: |
| Comprensión | 3 |
| Relevancia | 4 |
| Continuidad | 3 |
| Cordialidad | 3 |
| Iniciativa | 3 |
| Calidad comercial | 3 |
| Concisión | 4 |
| No repetición | 2 |

## Verificación gratuita del candidato actual

| Gate | Resultado |
| --- | --- |
| Workflow determinístico real | 4/4 pasan; escenario secuencial 9/9 turnos, sin reparaciones |
| Focales posteriores al último arreglo | 6 archivos, 289/289 pasan |
| Integraciones posteriores al último arreglo | 2 archivos, 16/16 pasan con PostgreSQL aislado |
| Focales de pago, contexto, ADK y backend | 237/237 pasan |
| Suite completa con cobertura | 173 archivos pasan, 2 omitidos; 2666 tests pasan, 7 omitidos, 7 todo |
| Cobertura | 97,72% statements; 98,29% lines |
| Integraciones pertinentes | 4 archivos, 44/44 pasan con PostgreSQL aislado |
| Lint | pasa con cero warnings |
| TypeScript raíz y Botpress | pasan |
| `adk check --format json` | válido, cero errores y cero warnings |
| Build ADK | pasa |
| Build Next aislado | pasa |
| `git diff --check` | pasa |

Evidencia local ignorada por Git: `.eval/codex-20260904/candidate-v21-final/`. El primer `npm run build` sin entorno falló por `DATABASE_URL is not set`; la repetición con la URL del PostgreSQL aislado del laboratorio pasó. Eso es configuración de build, no un defecto de código.

Identidad del artefacto local:

- Brain: `studyx-agent-a-brain-v21`.
- Canónico: SHA-256 `6d724acf6e366571bc6ce94d5013d007654442a67562daf67e672542c1eba17b`.
- Módulo canónico generado: SHA-256 `69f24163bf02409efa354bfb9a58d0f0a4248a2430ff153afc72b5a36a33eb6d`.
- Prompt Brain: SHA-256 `624e7cc1abea76f7dbb9d2f9a08393c518ffeefd25dd173ced0891ee1f995605`.
- Bundle ADK: SHA-256 `2aa3bd7cb030ad850b2bffed25619ff0b28a508a286768cece5a911443d29213`.
- Next build ID: `R3bwTLm25pjxcb3yH460q`.

## Presupuesto y gate restante

El ledger acumulado conserva el gasto histórico de USD 0,38 y registra 354 llamadas. El gasto total es USD 1,03011768 sobre el tope autorizado de USD 1,05; quedan USD 0,01988232. El wrapper exige exactamente ese tope y no permite una nueva llamada cuya reserva máxima lo exceda.

El margen actual es menor que la reserva necesaria para el próximo request y no alcanza para una conversación limpia completa. Para una única regresión de 11 turnos hace falta autorizar elevar el tope acumulado a USD 1,08. Sólo si termina con llamada, fases, identidad, link correcto, persistencia y entrega local correlacionada se puede desplegar V21. Después corresponde un canario supervisado de Telegram que compruebe recepción visible sin pagar el enlace.
