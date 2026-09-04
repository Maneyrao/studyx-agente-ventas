# Agente A V21 — canario de conversación en Botpress Cloud

Ejecución: 2026-09-04 23:33–23:38 UTC  
Canal: Botpress Cloud Webchat  
Resultado: **FAIL — silencio en el primer turno**  
Conversación efectiva: `conv_01M1QCB4MJNY10TEXKHVZ58XP5`

## Transcripción efectiva

**Cliente:** Hola, estoy buscando aprender fotografía pero no sé qué curso me conviene.

**Agente:** _Sin respuesta después de 55 segundos._

No corresponde puntuar naturalidad porque no hubo texto del agente. El silencio técnico cuenta como fallo conversacional.

## Correlación

- Webchat confirmó el handshake SSE de inicialización.
- Webchat conservó el mensaje `a7556406-854f-426b-8ea3-e35d9781bbab` en la conversación.
- Botpress no produjo logs del bot ni issues para esa conversación y ventana temporal.
- PostgreSQL no recibió channel thread, mensaje, batch, decisión ni delivery para ese `conversationId`.
- `/api/ready` permaneció `ready=true`; configuración, Brain V21, PostgreSQL y catálogo continuaron en `ok`.
- DeepSeek no fue invocado y el ledger de evaluación permanece en USD 1,048747608 de USD 1,08.

La frontera del fallo está entre el ingreso Webchat y la ejecución del `Conversation` handler ADK. La prueba no demuestra un defecto de catálogo, persistencia, modelo o materialización de links porque no alcanzó esas etapas.

## Preparación del driver

El primer preflight creó el contenedor Webchat `conv_01M1QBXCJMCHD4HWKM2PTMTVAG` sin el evento de activación requerido. No se vinculó al bot, no ingresó al backend y no llamó al modelo. Se corrigió el driver antes de iniciar la conversación efectiva.

En la conversación efectiva se emitió `conversation_started`. Al observar que faltaba el handshake SSE usado por el cliente oficial, se eliminó el único mensaje sintético no procesado, se inicializó el mismo `conversationId` y se repitió el primer turno dentro del mismo hilo. Volvió a quedar sin respuesta. No se creó otra conversación efectiva ni se envió un segundo turno comercial.

Evidencia privada: `.eval/codex-20260904/botpress-cloud-normal-canary/`. Contiene la credencial efímera del usuario Webchat y no debe publicarse.
