# Agente A V21 — candidato local y gate pendiente

Actualización: 2026-09-04 22:05 UTC.

## Estado

**READY_FOR_DEPLOYMENT. El workflow local está aprobado; la recepción por Telegram todavía requiere canario supervisado.**

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

Esto certifica contratos, persistencia y entrega del workflow local. Artefactos privados: `.eval/codex-20260904/candidate-v21-final/deterministic-sequential-intake-full.log` y `botpress-agent/evals/results/workflow-deterministic-sequential-intake-*.json`.

### Regresión final con DeepSeek real

Después de aplicar ambos arreglos se inició una conversación nueva y se ejecutó una única regresión paga completa. Pasó **11/11 turnos**, cada uno con un solo request al modelo, cero reparaciones, cero fallback, cero silencios, un outbound y una captura de adaptador por turno. Desambiguó fotografía, ofreció llamada dos veces como máximo, interpretó “Quizás personal” como motivación, respetó el rechazo, presentó el precio canónico, persistió `one_time`, pidió y guardó `Inés` → `Valdés` → correo → teléfono y sólo entonces materializó el enlace.

Estado final leído de PostgreSQL: nombre `Inés Valdés`, correo y teléfono declarado completos, `fotografia_profesional`, `one_time`, `payment_link_sent`, llamada `declined`, dos ofertas, una decisión `send_payment_link` y un único link registrado/entregado. El `outboundId` final coincide con la captura del adaptador. El laboratorio usa deliberadamente `https://example.invalid/eval/contado`; producción conserva el enlace canónico configurado en Vercel.

Métricas: p50 3.292 ms, p95 3.900 ms, fallback 0, fallos de disponibilidad 0. El gate de éxito de reparación queda `null` porque no hubo una reparación que medir; no se convierte artificialmente en 100 %. Log privado: `.eval/codex-20260904/candidate-v21-final/telegram-regression-paid-clean-final.log`. Reporte: `botpress-agent/evals/results/workflow-telegram-regression-2026-09-04T22-00-48-879Z-74bf7eb4-78c5-4ed2-b89f-47b65a41bb3d.json`.

## Naturalidad observada

La revisión independiente de la conversación paga final dio **4,25/5**. Comprendió incluso “Quizás personal”, condujo el cierre y pidió progresivamente los datos. No hay bloqueo de naturalidad para un canario supervisado. Queda pulir la repetición de “41 clases, 100% online”, “¡Perfecto!” y “para dejarlo registrado”; después de usar el nombre completo volvió a llamarla sólo “Inés”.

| Dimensión | Puntaje / 5 |
| --- | ---: |
| Comprensión | 5 |
| Relevancia | 5 |
| Continuidad | 4 |
| Cordialidad | 4 |
| Iniciativa | 5 |
| Calidad comercial | 4 |
| Concisión | 4 |
| No repetición | 3 |

## Verificación gratuita del candidato actual

| Gate | Resultado |
| --- | --- |
| Workflow pago con DeepSeek V21 | 11/11 turnos; 0 reparaciones, 0 fallback, 0 silencios; p95 3.900 ms |
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

El usuario autorizó elevar el tope acumulado a USD 1,08 para una única regresión limpia. El ledger conserva USD 0,38 históricos y registra 365 llamadas. El gasto final es **USD 1,048747608**; quedan USD 0,031252392. No se harán más llamadas pagas para este candidato.

La corrida satisfizo llamada, fases, identidad, link correcto, persistencia y entrega local correlacionada. Corresponde desplegar V21 en el orden backend → Botpress y ejecutar un canario supervisado de Telegram que compruebe recepción visible sin pagar el enlace.
