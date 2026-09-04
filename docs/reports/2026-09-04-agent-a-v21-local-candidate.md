# Agente A V21 — candidato local y gate pendiente

Actualización: 2026-09-04 20:47 UTC.

## Estado

**READY_FOR_SINGLE_PAID_RERUN. No está aprobado para desplegar ni para canario de Telegram.**

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
- El curso y plan persisten durante el intake. El backend materializa solamente el link canónico configurado después de pedido explícito y datos completos.
- `defer_payment` y `decline_purchase` requieren evidencia actual. “Después te paso mi apellido” no posterga el pago y “Inés” no cierra la venta.
- El segundo intento por JSON/schema inválido recibe el campo y código concretos sin sumar retries.

Estas medidas corresponden a las prácticas de feedback correlacionado y contexto vigente observadas en Parlant, LiveKit y OpenAI Agents SDK, sin incorporar otro runtime. La comparación está en [el informe de referencias](2026-09-04-agent-a-reference-feedback-comparison.md).

## Workflow V21 observado

Se ejecutó una sola regresión paga de 11 turnos. Falló al preparar el turno 9, después de ocho intercambios visibles:

1. **Cliente:** Hola, quisiera información del curso de fotografía.
   **Agente:** desambiguó Fotografía Profesional frente a Fotografía con Celulares para Tiendas Online.
2. **Cliente:** Me interesa Fotografía Profesional.
   **Agente:** informó 41 clases y ofreció una llamada breve.
3. **Cliente:** Quizás personal.
   **Agente:** explicó la utilidad personal y repitió la invitación de llamada.
4. **Cliente:** No quiero una llamada; prefiero que sigamos por chat.
   **Agente:** respetó el rechazo, explicó modalidad, 41 clases y certificado, y avanzó a pago.
5. **Cliente:** ¿Cuál es el precio total y qué opciones de pago tienen?
   **Agente:** respondió USD 360, 12×USD 30, 6×USD 60 y pago único de USD 360.
6. **Cliente:** Elijo hacer un pago único al contado.
   **Agente:** confirmó el plan y pidió permiso para registrar y enviar el link.
7. **Cliente:** Sí, quiero avanzar ahora: mandame el enlace para pagar al contado.
   **Agente:** pidió nombre, apellido, correo y teléfono.
8. **Cliente:** Inés.
   **Agente:** “¡Gracias, Inés!” y omitió pedir el siguiente campo.

Persistencia al fallar: curso `fotografia_profesional`, plan `one_time`, nombre `Inés`, preferencia de llamada `chat/declined`, dos ofertas registradas, `awaiting_reply=contact_details`, cero links y cero acciones de pago. Las ocho salidas quedaron `submitted` por el adaptador local; eso prueba correlación del workflow de laboratorio, no recepción en Telegram.

La causa exacta fue una propuesta `defer_payment` sin evidencia. El detector trató esa etiqueta como autorización para suspender el intake; luego la poda por repetición dejó sólo el agradecimiento. El candidato actual reencuadra esa etiqueta como `provide_contact_details`, exige el próximo campo y aplica el mismo gate en ADK y backend. También cierra el bypass equivalente de `decline_purchase` y distingue postergaciones de pago de frases como “después te paso mi apellido”. Estas correcciones se realizaron después del run pago y todavía no tienen una inferencia V21 nueva.

Artefactos privados: `.eval/codex-20260904/canary-fixes/telegram-regression-paid-final6.log` y `botpress-agent/evals/results/workflow-telegram-regression-checkpoint-2026-09-04T20-21-16-525Z-9698806a-d66f-4ea5-98f1-00e9ee64e2ea.json`.

## Naturalidad observada

La revisión independiente de esa transcripción dio 3,0/5. La respuesta fue clara y comercial hasta el intake, pero la invitación de llamada del turno 3 repitió casi literalmente la del turno 2 y la respuesta final quedó sin próximo paso. La corrección determinista elimina el cierre truncado; la variación real de la segunda invitación necesita observarse en el próximo workflow.

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

El ledger acumulado registra 325 llamadas, una reserva histórica sin usage, USD 0,978618504 consumidos y USD 0,021381496 disponibles del tope USD 1. No se realizó ninguna llamada paga después del fallo descrito.

El margen actual no alcanza con seguridad para reservar y completar otra conversación de 11 turnos. Hace falta autorizar al menos USD 0,05 adicionales. Con esa autorización se ejecuta una sola regresión completa; sólo si termina con llamada, fases, identidad, link correcto, persistencia y entrega local correlacionada se puede desplegar V21. Después corresponde un canario supervisado de Telegram que compruebe recepción visible sin pagar el enlace.
