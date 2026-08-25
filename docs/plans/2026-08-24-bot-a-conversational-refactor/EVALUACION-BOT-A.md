# Evaluación de la capa conversacional de Bot A

Fecha de corte: 2026-08-24. Alcance: solo lectura del repositorio y de la base local `studyx_test`. Este documento no afirma estado de producción cuando no existe evidencia local suficiente.

## Resumen ejecutivo

Bot A ya tiene una arquitectura transaccional fuerte: ingesta durable, claim exclusivo, decisión estructurada y validada, commit antes del envío físico y reporte posterior. El problema se concentra en la política conversacional entre el claim y el commit: los fast paths crecieron como una cadena ordenada de casos y el modelo todavía puede redactar hechos comerciales no respaldados. No existe hoy un validador de egreso completo entre el texto ya commiteado y `client.createMessage`.

La ejecución delegada de esta auditoría excedió dos intentos sin producir archivo. Se cerró de forma focal por el agente principal, siguiendo la regla de dos strikes, sin modificar producción.

## 1. Flujo real del turno

1. `POST /api/agent/ingest` valida el envelope, ejecuta `processInboundMessage` y devuelve su resultado; no construye el snapshot comercial controlado (`src/app/api/agent/ingest/route.ts:57-115`).
2. `POST /api/agent/batches/:batch_id/claim` es la barrera exclusiva antes de que el modelo pueda hablar y devuelve el contexto controlado al único propietario del batch (`src/app/api/agent/batches/[batch_id]/claim/route.ts:48-61`). El loader del claim obtiene y construye `business_context` desde PostgreSQL (`src/app/api/agent/batches/[batch_id]/claim/route.ts:20-38`).
3. El workflow consume el claim y evalúa, en orden, llamada, pago, identidad, hechos de curso, cierre, descubrimiento de curso y saludo (`botpress-agent/src/workflows/processInboundTurn.ts:383-409`).
4. Si no aplica un fast path, se genera una decisión estructurada. Gemini directo, Groq directo y Botpress administrado convergen en `applyDecisionPolicy`; no hay una política distinta por proveedor (`botpress-agent/src/workflows/processInboundTurn.ts:458-550`).
5. `POST /api/agent/turns/:turn_id/decision` valida forma y reglas de dominio antes de aceptar la decisión (`src/app/api/agent/turns/[turn_id]/decision/route.ts:27-35`).
6. Solo después del commit se crea el mensaje físico con el contenido del outbound commiteado (`botpress-agent/src/workflows/processInboundTurn.ts:678-705`). La entrega se reporta al backend después de que Botpress retorna un ID (`botpress-agent/src/workflows/processInboundTurn.ts:750-769`).

### Punto de egreso

Para este workflow existe un punto físico único: `client.createMessage({ payload: { text: committed.outbound.content } })` (`botpress-agent/src/workflows/processInboundTurn.ts:684-704`). Entre `committed.outbound.content` y ese envío no aparece un validador semántico de hechos comerciales. La validación existente controla la decisión antes del commit, pero no demuestra que todo curso, precio, clase, requisito, horario, certificado, devolución o link mencionado en prosa pertenezca al snapshot.

[FALTA DATO: confirmar si existen otros emisores de mensajes de Bot A fuera de `processInboundTurn` en producción y si todos pasan por el mismo commit.]

## 2. Inventario de reglas conversacionales actuales

La cadena activa está centralizada en el workflow, pero implementada en varios utilitarios:

| Capacidad actual | Archivo | Observación |
|---|---|---|
| Llamada directa/aceptación | `botpress-agent/src/utils/call-handoff-fast-path.ts` | Reutiliza `deterministic_route` y `allowed_actions`; el backend conserva autoridad final. |
| Selección de plan y link | `botpress-agent/src/utils/transaction-fast-path.ts` | Convierte una selección inequívoca en `send_payment_link`. |
| Identidad | `botpress-agent/src/utils/transaction-fast-path.ts` | Confirma identidad ya extraída sin repetir email. |
| Hechos del curso | `botpress-agent/src/utils/transaction-fast-path.ts` | Responde clases, requisitos, precio, pago, devolución, certificado y horarios mediante regex y snapshot. |
| Cierre/cancelación | `botpress-agent/src/utils/transaction-fast-path.ts` | Plantillas para venta diferida y cancelación de llamada. |
| Descubrimiento/alias de curso | `botpress-agent/src/utils/transaction-fast-path.ts` | Resolución literal o aproximada y respuesta corta. |
| Saludo | `botpress-agent/src/utils/greeting.ts` | Evita modelo en un saludo inequívoco. |
| Normalización posterior | `botpress-agent/src/utils/decision-policy.ts` | Valida acciones y agrega memoria determinista de curso. |

El orden y la exclusión mutua están duplicados en el workflow real (`botpress-agent/src/workflows/processInboundTurn.ts:383-422`) y en el runner local (`scripts/run-agent-a-conversations.ts:325-356`). Esa duplicación crea riesgo de paridad: agregar o reordenar una capacidad exige tocar ambos caminos.

El caso 22 demostró un hueco observable: una consulta por Programación en Python llegó al modelo y Groq afirmó que el curso existía. La suite original no tenía un hard gate semántico que comparara cada curso mencionado contra el catálogo.

## 3. Catálogo y verdad comercial

La vista autorizada distingue `price_type` de `price_assertable`. Un precio solo viaja como `{ amount, currency }` y `price_assertable=false` significa que el agente no puede afirmar el importe (`src/features/orchestration/domain/business-context.ts:88-100`). También expone modalidad, horarios, certificación, clases, módulos, incluidos, edad, idioma y promesas permitidas/prohibidas (`src/features/orchestration/domain/business-context.ts:93-113`). No se verificó un campo `price_status`.

El snapshot limita ofertas a 40 y registra truncamiento explícito si el catálogo supera ese límite (`src/features/orchestration/domain/business-context.ts:180-203`). La consulta directa de la base local `studyx_test`, workspace `studyx`, devolvió al corte:

- 40 offerings activos.
- 9 valores distintos de `metadata.academy`.

Eso no demuestra “40 diplomados”: debe separarse por `offering_type` y contrastarse con la fuente comercial de 35 diplomados. Tampoco prueba el contenido de Supabase remoto.

[FALTA DATO: snapshot remoto autorizado, fecha de vigencia y definición comercial exacta de curso/diplomado/oferta.]

[FALTA DATO: política de precios por chat — nunca mostrar vs. mostrar solo precio auditado.]

## 4. Resolución de curso, precio y plan

- Curso: hoy se resuelve parcialmente en `transaction-fast-path.ts` y se vuelve a inferir para memoria en `decision-policy.ts`; usa nombres canónicos, historial reciente y coincidencias aproximadas.
- Precio: proviene de `BusinessOfferingView.price` solo cuando `price_assertable=true` (`src/features/orchestration/domain/business-context.ts:88-100`).
- Plan: la detección determinista está en `botpress-agent/src/utils/payment-choice.ts` y el backend vuelve a validar la decisión antes del commit.
- Link: no lo escribe el modelo; la acción estructurada selecciona un plan y el backend proyecta el link autorizado.

El principal riesgo no es la ausencia total de controles, sino que la resolución está repartida entre router, policy, prompt y backend. El texto final no transporta una lista estructurada de claims que pueda verificarse exhaustivamente.

## 5. Proveedores y fallback

El workflow soporta tres caminos configurables: Gemini directo, Groq directo y `execute` administrado por Botpress (`botpress-agent/src/workflows/processInboundTurn.ts:468-536`). Todos terminan en `applyDecisionPolicy` (`botpress-agent/src/workflows/processInboundTurn.ts:546-550`).

El runner local sí implementa failover entre Gemini y Groq cuando el error primario es transitorio (`scripts/run-agent-a-conversations.ts:372-400`). En cambio, el workflow de Botpress selecciona un proveedor por configuración; el fallback automático cruzado Gemini↔Groq no aparece en ese bloque. Para provider directo, el step del workflow usa un solo intento (`botpress-agent/src/workflows/processInboundTurn.ts:552-560`).

Groq reintenta una vez errores marcados como retryables (`botpress-agent/src/lib/decision/groq-direct.ts:264-305`). Gemini clasifica 429/503 como retryables (`botpress-agent/src/lib/decision/gemini-direct.ts:318-324`). No hay evidencia suficiente para afirmar que `GEMINI_API_KEY` sea inválida; las corridas locales observadas reportaron cuota/transitorio.

[FALTA DATO: provider y credencial configurados en el deploy efectivo de Botpress, sin exponer el secreto.]

## 6. Estado comercial y máquinas existentes

El claim expone un `sales_context` y las decisiones usan `next_state`, mientras llamadas, pagos y batches tienen persistencia propia. Sin embargo, la secuencia comercial de alto nivel no está demostrada aquí como una única máquina explícita y canónica por conversación.

[FALTA DATO: inventario definitivo, con tablas y transiciones, de las máquinas comercial, turno, llamada y pago; el brief no debe convertir “cuatro” en verdad sin evidencia del código.]

## 7. Suite de evaluación

El runner valida claves conocidas del resultado ideal, unicidad de ID/email/persona y conversaciones de 4 a 8 turnos (`scripts/lib/agent-a-conversation-runner.ts:490-556`). Ejecuta secuencialmente y permite checkpoint después de cada caso (`scripts/lib/agent-a-conversation-runner.ts:559-585`).

La suite council compone 35 casos base y 15 adicionales mediante una extensión propia del runner. Un consumidor que lea solo `.cases` del archivo council puede ejecutar 15 y presentarlo erróneamente como 50. También hay checks agregados que pueden encontrar un hecho correcto en un turno viejo aunque el estado final sea incorrecto.

Estado verificable de esta sesión: 22 casos fueron ejecutados en distintos lotes y 19 alcanzaron verde en su última repetición individual. No existe todavía un único reporte consolidado 22/22 ni 50/50. El caso 22 sigue rojo por curso inexistente y el trabajo de implementación fue pausado para este refactor documental.

Riesgos del runner que deben mantenerse visibles:

- exige una respuesta por turno y puede marcar como fallo un silencio correcto tras opt-out;
- varias assertions son léxicas, no semánticas;
- latencia end-to-end mezcla aplicación, modelo, red y entorno local;
- la búsqueda de PII durable no cubre todas las tablas;
- un dominio Stripe permitido no demuestra que el link exacto esté autorizado.

## 8. Hallazgos críticos

1. **P0 — Falta validación semántica completa del egreso.** Existe un punto físico único en el workflow, pero no una comprobación de todos los claims antes de enviar.
2. **P0 — Curso inexistente no está resuelto como capacidad general.** El caso Python llegó al proveedor y produjo una afirmación comercial falsa.
3. **P1 — Router duplicado entre producción y runner local.** Puede generar verdes locales que no reflejen el workflow desplegado.
4. **P1 — Provider failover divergente.** El runner cruza Gemini/Groq; el workflow configurado no demuestra el mismo comportamiento.
5. **P1 — La suite no prueba generalización.** Los casos usados para implementar no sustituyen variaciones held-out.
6. **P1 — Estado remoto no verificado.** Los conteos y pruebas actuales corresponden a una base local de integración.
