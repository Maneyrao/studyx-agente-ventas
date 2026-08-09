# Botpress Inbound Pilot — Plan de prueba

**Fecha:** 2026-08-05  
**Alcance:** conversación de WhatsApp iniciada por el cliente  
**Decisión a tomar:** validar si Botpress funciona bien como capa conversacional y coordinador del turno, manteniendo Next.js como API de negocio y Supabase como fuente de verdad.

## Arquitectura bajo prueba

```text
WhatsApp / Botpress Emulator
            |
            v
Botpress Workflow
  1. recibe e identifica el mensaje
  2. llama POST /api/agent/ingest
  3. entrega contexto al nodo de IA
  4. genera una respuesta
  5. llama POST /api/agent/reply
  6. responde o entra en recuperación automática
            |
            v
Next.js -> Supabase/PostgreSQL + pgvector
```

Durante el piloto no se usan Vercel Workflow ni las tablas de Botpress como fuente de verdad.

## Estado técnico de partida

- `tsc --noEmit` finaliza correctamente.
- El build de Next.js compila y valida TypeScript, pero falla al recopilar la ruta `/api/cron/retry-embeddings` si `OPENAI_API_KEY` no está disponible durante el build. El preview para Botpress necesita las variables configuradas o una inicialización diferida del cliente.
- Los endpoints `/api/agent/ingest` y `/api/agent/reply` ya existen y coinciden con el flujo del piloto.
- El contrato de ingesta todavía no recibe un identificador externo de Botpress/WhatsApp, por lo que aún no garantiza idempotencia ante reentregas del canal.
- La consulta actual de memoria reciente ordena ascendente y aplica `LIMIT`; debe comprobarse/corregirse porque puede devolver los primeros N mensajes en vez de los últimos N.

## Criterios no negociables

- Supabase conserva contactos, conversaciones, mensajes, memoria y auditoría.
- Botpress no recibe credenciales de PostgreSQL ni la clave `service_role` de Supabase.
- El secreto `X-Orchestrator-Key` se guarda como variable segura de configuración, nunca como variable conversacional o global legible por el modelo.
- El modelo solo redacta y propone acciones; Next.js valida los cambios de estado.
- Cada mensaje debe poder correlacionarse con el identificador externo de WhatsApp/Botpress.
- Una reentrega del mismo evento no puede crear otro mensaje ni otra respuesta.
- Si memoria vectorial o resumen fallan, el turno continúa con memoria reciente.
- No existe transferencia humana en el MVP: los reclamos, ambigüedades y errores conversacionales se resuelven con flujos de IA controlados.
- Los errores técnicos no quedan a criterio libre del modelo: Botpress y Next.js aplican reintentos, límites y estados de recuperación; la IA comunica el resultado al cliente.

## Rebanadas verticales de implementación y prueba

- [ ] **1. Recorrer un turno en el Emulator:** crear un Workflow mínimo que reciba texto, extraiga identidad/contenido, invoque `/api/agent/ingest`, genere una respuesta controlada, invoque `/api/agent/reply` y la envíe. **Terminado cuando:** un turno completo queda registrado una sola vez en Supabase y puede rastrearse por `turn_id`. _Reutiliza: endpoints 002; crea: Workflow y Action HTTP de Botpress._

- [ ] **2. Asegurar identidad e idempotencia de canal:** incorporar `external_message_id`, `external_conversation_id` y `channel` al contrato y garantizar unicidad estructural para reintentos. **Terminado cuando:** diez entregas del mismo evento producen un inbound y, como máximo, un outbound. _Modifica: contrato 002, servicio de ingesta y migración de mensajes; crea: prueba de reentrega._

- [ ] **3. Corregir y validar memoria reciente:** verificar que el backend devuelva realmente los últimos N mensajes en orden cronológico, no los primeros N. **Terminado cuando:** una conversación de 50 mensajes devuelve los últimos N exactos y nunca mezcla contactos. _Modifica: `memory.service.ts`; reutiliza: tablas y endpoint de ingesta; crea: prueba de regresión._

- [ ] **4. Construir el contexto controlado del agente:** mapear estado estructurado, resumen, últimos turnos y memoria histórica en variables de Workflow; exponer al nodo autónomo solo los datos necesarios. **Terminado cuando:** el agente puede continuar una conversación y responder una referencia histórica sin acceder directamente a Supabase. _Reutiliza: respuesta de `/api/agent/ingest`; crea: esquema de variables y prompt de Botpress._

- [ ] **5. Implementar manejo autónomo de excepciones conversacionales:** detener la venta si `contact.blocked=true` y crear rutas específicas para reclamos, ambigüedad, baja confianza, contenido fuera de alcance y pedido de una persona. **Terminado cuando:** la IA responde de forma segura, no inventa resoluciones y deja la conversación en un estado automático explícito (`resolved`, `waiting_user`, `retry_pending` o `paused_error`). _Reutiliza: `contact.blocked`; crea: clasificador, transiciones y respuestas de contingencia de Botpress._

- [ ] **6. Probar WhatsApp real o Playground:** conectar la integración oficial y repetir texto, audio, imagen, respuesta citada y mensajes consecutivos. **Terminado cuando:** identidad, tipos de mensaje y referencias se mapean sin perder el identificador externo. _Reutiliza: Workflow del Emulator; modifica: adaptador de entrada; crea: matriz de canales._

- [ ] **7. Probar fallos controlados:** simular timeout de Next.js, indisponibilidad del modelo, fallo de embeddings, fallo al persistir outbound y error al enviar WhatsApp. **Terminado cuando:** cada fallo produce reintento seguro, degradación o pausa automática, sin duplicados ni pérdida silenciosa; la IA nunca comunica éxito si el backend no lo confirmó. _Reutiliza: degradación de memoria existente; modifica: manejo de errores del Workflow; crea: matriz de recuperación automática._

- [ ] **8. Medir latencia, consumo y concurrencia:** registrar tiempos Botpress→Next, Next→Supabase, modelo y envío; medir tokens por turno y ejecutar carga en ambiente de prueba. **Terminado cuando:** existe p50/p95, costo estimado y resultado bajo 25 conversaciones concurrentes, seguido de una prueba controlada del objetivo de 150. _Reutiliza: logs existentes; crea: tablero/planilla de medición y prueba de carga._

- [ ] **9. Ejecutar la decisión arquitectónica:** evaluar los resultados con los criterios de salida. **Terminado cuando:** queda documentada una decisión única entre (a) Botpress como capa conversacional, (b) Botpress con más coordinación, o (c) reemplazo del canal, indicando evidencia y deuda técnica. _Crea: ADR de decisión; reutiliza: todas las mediciones del piloto._

## Matriz mínima de escenarios

| Escenario | Resultado esperado |
|---|---|
| Contacto nuevo | Se crea una única identidad y conversación |
| Contacto conocido | Recupera estado, resumen y últimos turnos |
| Evento repetido | No duplica inbound ni respuesta |
| Dos mensajes rápidos | Cada outbound queda ligado al `turn_id` correcto |
| Mensaje trivial | No dispara búsqueda vectorial |
| Referencia al pasado | Recupera memoria solo del contacto actual |
| Contacto bloqueado | No responde comercialmente |
| Reclamo | La IA reconoce, consulta datos verificables y ofrece una resolución permitida |
| Pedido de humano | La IA explica que la atención es automática y continúa con opciones controladas |
| Falla pgvector | Responde con resumen y memoria reciente |
| Falla Next.js/Supabase | No inventa éxito ni duplica al reintentar |
| Falla de envío | Conserva trazabilidad y permite reintento |

## Criterios para aprobar Botpress

- Cero mezcla de datos entre contactos en todas las pruebas.
- Cero duplicados ante reentrega del mismo evento.
- Cero secretos de base de datos expuestos en variables o prompts.
- Trazabilidad completa desde el identificador de canal hasta `turn_id` y mensaje saliente.
- Recuperación automática verificable para errores conversacionales y técnicos.
- La latencia adicional de Botpress queda medida y resulta aceptable para conversación.
- La carga objetivo cabe en las cuotas y el costo del plan de Botpress elegido.
- El Workflow puede comprenderse y modificarse sin duplicar reglas ya existentes en Next.js.

## Señales para no usar Botpress como orquestador completo

- Requiere copiar estados comerciales o memoria canónica a tablas/variables de Botpress.
- Los reintentos dependen de lógica frágil dentro del Workflow.
- No puede correlacionar de manera confiable eventos, turnos y entregas.
- El flujo conversacional comienza a contener reglas de pagos, permisos o estados irreversibles.
- La observabilidad no permite reconstruir por qué se envió una respuesta.
- Las cuotas, latencia o costo no son razonables bajo la carga medida.
