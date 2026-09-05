# Agent A — autoridad semántica del catálogo

Fecha: 2026-09-05  
Rama: `codex/agent-a-semantic-catalog`  
Base verificada: `21c47d3bf9916f465ff87784316eb90adc46368c`  
Prompt: `studyx-agent-a-brain-v22`  
Modelo de producción previsto: `deepseek-v4-flash`

## Alcance ejecutado

El cerebro recibe las 40 identidades activas del catálogo cuando todavía no hay un curso seleccionado. Cada elemento contiene únicamente `code`, `fact_id`, `display_name` y `area_code`. El plannerless conserva el `move.course_reference` propuesto por el modelo y el backend sigue validando códigos, hechos y acciones antes del commit.

Se corrigieron dos incompatibilidades encontradas por el workflow real:

1. El validador local no autorizaba los `fact_id` de `available_offerings`, aunque ya se los mostraba al modelo. La prueba RED devolvió `FACT_NOT_AUTHORIZED`; luego quedó verde sin reparación.
2. En una referencia como “el de celulares”, el contexto decía que la llamada no estaba disponible porque el curso aún no existía en el estado previo, mientras el backend exigía la oferta después de aceptar la selección semántica. `may_offer_call` ahora representa el presupuesto de llamada; la selección canónica y el límite siguen verificándose en el backend.

No se agregaron migraciones, modelos, proveedores, tablas ni frameworks. No se modificaron Stripe, Sheets ni Retell. El planner y las obligaciones rígidas permanecen fuera de la ruta plannerless.

## Evidencia TDD y workflow

- Contrato RED inicial: faltaban `available_offerings` y la autoridad seguía en candidatos.
- Validación RED focal: 1 fallo esperado, `FACT_NOT_AUTHORIZED` para `offering:fotografia-profesional:name:v1` visible.
- Capacidad RED focal: `may_offer_call=false` en selección semántica; el workflow reproducía `CALL_BUDGET_EXHAUSTED` en ADK y `CALL_OFFER_REQUIRED` en backend.
- Resultado GREEN final: catálogo 5/5, frontera Telegram fixture 3/3, llamada/pago 4/4.

Las pruebas de workflow invocaron `processInboundTurn`, el backend Next aislado en `127.0.0.1:3217` y PostgreSQL en `127.0.0.1:55435`. Sólo la respuesta de DeepSeek fue fixture, con costo USD 0. Cada turno comprobó ingestión, lote, claim, propuesta, autorización, commit, estado durable y captura de entrega correlacionada.

### Catálogo

| Entrada | Salida autorizada | Estado |
|---|---|---|
| `Quiero un curso de foto.` | `Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `¿Tienen cursos de inglés?` | `Tenemos Inglés 1 y Inglés 2 y Inglés 3. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `Quiero estudiar fotografía.` | `Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `¿Tienen fotgrafia?` | `Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `¿Tienen Medicina? Si no, recomendame algo con salida laboral.` | `Medicina no figura entre los cursos disponibles. Por tu objetivo laboral, te recomiendo Especialista en Ventas, Excel Integral, Marketing Digital. ¿Cuál querés conocer mejor?` | Sin selección; sólo códigos reales; 1 outbound |

Cada caso recibió exactamente 40 identidades, realizó una sola generación, no invocó el planner y terminó con una pregunta útil.

### Secuencias Telegram anonimizadas

**L E**

> Cliente: Hola, quiero un curso de foto para mi emprendimiento.  
> Agente: Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál se acerca más a lo que buscás?  
> Cliente: El de celulares.  
> Agente: Perfecto, Fotografía con Celulares para Tiendas Online puede servirte para crear contenido de tu negocio. Si querés, coordinamos una llamada breve y te cuento cómo seguir.

Estado final: `fotografia_celulares_tiendas_online`, llamada ofrecida una vez, 2 decisiones y 2 outbounds correlacionados.

**gfalejandro**

> Cliente: ¿Y cursos de inglés tienen?  
> Agente: Sí: tenemos Inglés 1, Inglés 2 e Inglés 3. ¿Qué nivel te interesa?  
> Cliente: El nivel 2.  
> Agente: Buenísimo, entonces vemos Inglés 2. Si querés, coordinamos una llamada breve para orientarte; si no, seguimos por acá.

Estado final: `ingles_2`, llamada ofrecida una vez, 2 decisiones y 2 outbounds correlacionados.

**Lucas**

> Cliente: Me interesa Fotografía Profesional.  
> Agente: Perfecto, vemos Fotografía Profesional. Si querés, coordinamos una llamada breve para orientarte; si no, seguimos por acá.  
> Cliente: En realidad prefiero Excel Integral.  
> Agente: Claro, cambiamos a Excel Integral. ¿Qué uso te gustaría darle?  
> Cliente: ¿Y ese se cursa online?  
> Agente: Sí, Excel Integral se cursa 100% online. ¿Querés que te cuente cómo son las clases?

Estado final: `excel_integral`; la referencia conserva el curso nuevo y no resucita Fotografía Profesional. Hubo 3 decisiones y 3 outbounds correlacionados.

### Llamada y pago

Las cuatro regresiones determinísticas comprobaron: oferta de llamada y ledger, captura secuencial de nombre/apellido/correo/teléfono, persistencia del cambio de curso, selección de plan, postergación, consentimiento explícito, materialización backend del enlace, entrega única correlacionada, aviso de pago, opt-out e idempotencia. El enlace de prueba sólo apareció después de completar intake y quedó tanto registrado como entregado.

## Gates gratuitos

| Gate | Resultado |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm --prefix botpress-agent run typecheck` | PASS |
| `npm run test:unit` | PASS — 191 archivos, 2 omitidos; 2.994 tests, 7 omitidos, 7 TODO |
| `npm --prefix botpress-agent run check` | PASS — 0 errores, 0 warnings |
| `npm --prefix botpress-agent run build` | PASS |
| `git diff --check` | PASS |

Los skips están informados y no se cuentan como aprobados. La regresión Telegram de 11 turnos que usa DeepSeek quedó fuera de esta corrida mediante filtro porque el plan permite una sola campaña paga de seis conversaciones.

## Revisión manual

Las transcripciones finales no declaran ausentes Inglés ni Fotografía, no inventan cursos, no listan las 40 identidades, no restauran el curso anterior y no terminan sin un próximo paso. La redacción fixture prueba el contrato y la persistencia; la naturalidad queda reservada para la campaña held-out única.

Costo API nuevo hasta este checkpoint: **USD 0.00**.
