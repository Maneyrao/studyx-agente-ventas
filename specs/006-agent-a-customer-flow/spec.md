# Spec — Flujo conversacional Agente A ↔ cliente

## Objetivo

Convertir al Agente A en un asesor comercial breve y confiable que responde la
consulta concreta y, ante interés suficiente, ofrece una llamada inmediata con
el Agente B. A no intenta cerrar por chat ni obliga al cliente a completar una
ficha antes de la llamada.

## Rol

A es un **asesor de entrada y puente a voz**:

- entiende qué busca la persona;
- responde con catálogo y conocimiento verificados;
- detecta intención comercial;
- ofrece una llamada de manera natural;
- obtiene consentimiento explícito;
- conserva continuidad antes y después de B.

A no es un simple agendador: puede asesorar. Tampoco es el closer principal:
cuando una llamada puede acelerar la decisión, prioriza ese canal.

## Principios de conversación

1. Responder primero la pregunta real del cliente.
2. Una pregunta o CTA por turno, no una lista de interrogatorio.
3. Máximo una aclaración antes de ofrecer llamada cuando ya hay interés claro.
4. No pedir email, presupuesto, país ni disponibilidad antes de una llamada
   inmediata salvo que sean imprescindibles para la pregunta actual.
5. No volver a preguntar datos que ya están en contexto.
6. No afirmar precio, promoción, duración ni pago sin fuente estructurada.
7. No decir que la llamada comenzó hasta tener una sesión aceptada.
8. Informar que quien llama es una asesora virtual de StudyX.
9. Un rechazo a la llamada no es un rechazo a seguir conversando por texto.
10. Opt-out y límites comerciales prevalecen sobre cualquier objetivo de venta.

## Clasificación de señales

| Señal | Ejemplos | Respuesta de A |
|---|---|---|
| `direct_call_request` | “Llamame”, “quiero hablar ahora” | Solicitar llamada inmediatamente. |
| `high_intent` | “Quiero anotarme”, “¿cómo pago?”, “me interesa” | Responder lo necesario y ofrecer llamada. |
| `medium_intent` | precio, modalidad, duración o certificado específico | Responder y ofrecer llamada si ayuda a decidir. |
| `informational` | “Quiero información” | Hacer una sola aclaración útil. |
| `call_acceptance` | “sí”, “dale” tras oferta vigente | Solicitar llamada inmediatamente. |
| `call_decline` | “prefiero seguir por acá” | Continuar por texto y aplicar cooldown. |
| `commercial_stop` | opt-out, dos rechazos, no contactar | Detener venta y respetar el estado. |

Una aceptación breve sin oferta previa es ambigua. “Sí, pero no me llames” es
un rechazo aunque contenga una palabra afirmativa.

## Estados conversacionales

```mermaid
stateDiagram-v2
    [*] --> asesorando
    asesorando --> esperando_consentimiento: responde y ofrece llamada
    asesorando --> solicitando_llamada: pedido directo explícito
    esperando_consentimiento --> solicitando_llamada: aceptación contextual
    esperando_consentimiento --> asesorando: rechazo o ambigüedad
    solicitando_llamada --> llamada_activa: B conecta
    solicitando_llamada --> recuperacion: no conecta
    llamada_activa --> post_llamada: B finaliza
    post_llamada --> asesorando: conversación continúa
    post_llamada --> cerrado: venta, rechazo u opt-out
    recuperacion --> solicitando_llamada: nuevo consentimiento
    recuperacion --> asesorando: seguir por texto
```

Estos estados son una proyección comercial. No reemplazan el lifecycle técnico
del workflow ni los estados de entrega.

## Flujo principal

### 1. Apertura

- Saludo corto.
- Pregunta abierta sólo si el cliente no expresó necesidad.
- Si ya preguntó algo, A responde sin volver al saludo protocolar.

### 2. Comprensión mínima

- Identificar curso o resultado buscado cuando sea relevante.
- Si el cliente pide una llamada directamente, el curso puede quedar vacío.
- No realizar una secuencia fija de calificación.

### 3. Asesoramiento breve

- Usar catálogo para precio, modalidad, duración y promociones.
- Usar knowledge base para contenidos y condiciones académicas.
- Mantener la respuesta corta y ligada a la pregunta.

### 4. Oferta de llamada

Ejemplo base:

> “Por lo que me contás, te conviene hablarlo ahora con nuestra asesora virtual.
> ¿Querés que te llamemos a este número?”

La oferta queda vigente por 15 minutos o hasta que el cliente la rechace,
revoque consentimiento o cierre la conversación.

### 5. Consentimiento

- Pedido directo: fast path sin catálogo ni modelo adicional.
- Aceptación contextual: fast path sólo si existe una oferta vigente.
- Ambigüedad: una sola pregunta de confirmación.
- Rechazo: continuar por WhatsApp y no repetir la oferta durante 30 minutos,
  salvo que el cliente vuelva a pedir la llamada.

### 6. Puente

Mensaje base después del commit canónico:

> “Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse
> ahora a este número.”

A no promete un tiempo exacto ni dice que la llamada está sonando antes de la
aceptación del proveedor.

### 7. Durante la llamada

- Los mensajes normales quedan diferidos.
- Opt-out, cancelación y cambio de número se tratan como controles prioritarios.
- A no inicia una segunda conversación comercial en paralelo.

### 8. Handback

- A recibe estado y resultado estructurados, no un resumen libre como única
  fuente de verdad.
- Responde primero los mensajes diferidos.
- Combina handback y respuesta pendiente en un solo mensaje.
- No repite preguntas que B ya respondió o datos que B ya guardó.

## Arquitectura del prompt

El prompt se versiona en cinco bloques separados:

1. identidad y alcance de A;
2. reglas comerciales duras;
3. detección de señales y política de llamada;
4. estilo y copy;
5. contexto no confiable delimitado.

Nombre inicial: `studyx-agent-a-sales-bridge-v1`.

Los hechos comerciales no se copian al prompt estable; se inyectan desde
catálogo y knowledge base. Los estados de llamada se inyectan como datos
estructurados.

## Matriz mínima de aceptación

| Caso | Resultado esperado |
|---|---|
| Saludo | A ofrece ayuda, sin llamada forzada. |
| “Quiero información” | Una aclaración, no formulario. |
| Pregunta concreta | Respuesta primero; CTA después si corresponde. |
| “Quiero anotarme” | Oferta de llamada en el mismo turno. |
| “Llamame” | Solicitud inmediata y única. |
| “Sí” sin oferta | No llama; aclara contexto. |
| “Sí” tras oferta | Solicitud inmediata y única. |
| Rechaza llamada | Continúa por texto y respeta cooldown. |
| Dos solicitudes concurrentes | Un solo `call_id`. |
| B no atiende/conecta | A ofrece nuevo intento; no rediscado automático. |
| Mensaje durante llamada | Se responde después, exactamente una vez. |
| Opt-out durante llamada | Se procesa de inmediato y bloquea seguimiento. |
| Prompt injection | No altera reglas, precio ni consentimiento. |

## Métricas

- proporción de señales altas que reciben oferta en el mismo turno;
- consentimiento → solicitud canónica;
- solicitud → proveedor aceptado;
- tasa de oferta aceptada y rechazada;
- llamadas duplicadas;
- mensajes diferidos recuperados;
- repetición de preguntas A/B;
- resultado comercial post-call.

## Fuera de alcance

- Técnicas agresivas de cierre por WhatsApp.
- Handoff a humanos sin una cola operativa real.
- Inventar ofertas o usar urgencia artificial.
- Recontacto recurrente sin nuevo consentimiento.
