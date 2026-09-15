# Handoff de integración — StudyX Agente A ↔ Xendra ↔ Agente B

Fecha: 15 de septiembre de 2026
Estado: configuración preparada; despliegue productivo del orquestador todavía pendiente.

## Objetivo

Conectar el Agente A de WhatsApp/Telegram con el Agente B de voz mediante Xendra:

```text
Agente A → Orquestador Next.js → Xendra → Retell / Agente B
Agente B → herramientas y eventos → Orquestador → conversación original de A
```

El Agente B conversa y solicita acciones. El orquestador conserva la autoridad sobre identidad,
catálogo, pagos, mensajería, Supabase y Google Sheets.

## Identificadores confirmados

- Retell Agent ID: `agent_d2c1a4ac7900ae95a47727156b`
- Retell LLM ID: `llm_eea8f670b6569b44689e9394b150`
- Versión: `0`
- Endpoint de Xendra: `https://xendrapro-admin.vercel.app/api/studyx/llamar`
- URL base del orquestador: `https://studyx-agente-ventas.vercel.app`

No se debe compartir ni solicitar una API key privada de Retell. El orquestador llama a Xendra,
y Xendra administra Retell, el trunk SIP y el número saliente.

## Secretos compartidos

### Orquestador ↔ Xendra

Lucas lo denomina `STUDYX_ORCHESTRATOR_SECRET`. En el backend de StudyX se almacena como:

```text
XENDRA_ORCHESTRATOR_SECRET
```

Es el mismo valor. Se envía mediante:

```text
x-studyx-orchestrator-secret: <secreto compartido>
```

El valor ya fue validado contra Xendra. No incluirlo en este documento ni en Git.

### Herramientas del Agente B

StudyX generó otro secreto independiente, almacenado en Vercel como:

```text
RETELL_TOOLS_SECRET
```

Lucas debe recibirlo por un canal privado y configurarlo en las nueve herramientas como:

```text
x-studyx-tools-secret: <RETELL_TOOLS_SECRET>
```

## Disparo de una llamada

El orquestador ejecuta:

```http
POST https://xendrapro-admin.vercel.app/api/studyx/llamar
Content-Type: application/json
x-studyx-orchestrator-secret: <STUDYX_ORCHESTRATOR_SECRET>
```

Payload:

```json
{
  "telefono": "+5491155667788",
  "conversation_id": "identificador_conversacion",
  "lead_id": "identificador_lead",
  "variables": {
    "nombre_lead": "Juan",
    "curso_interes": "curso consultado",
    "pais": "AR",
    "email_lead": "juan@example.com",
    "nombre_asesor": "Valentina",
    "numero_closer": "+5491100000000",
    "resumen_whatsapp": "Resumen breve y fiel de la conversación previa."
  }
}
```

Respuesta esperada:

```json
{ "ok": true, "call_id": "call_abc123" }
```

No reintentar automáticamente un `502`, timeout o resultado ambiguo. Un `409` indica que ya existe
una llamada en curso para ese número.

## Relay de eventos Xendra → Orquestador

URL:

```text
POST https://studyx-agente-ventas.vercel.app/retell/eventos
```

Headers obligatorios:

```text
Content-Type: application/json
x-studyx-orchestrator-secret: <STUDYX_ORCHESTRATOR_SECRET>
x-studyx-event: call_started | call_ended | call_analyzed
```

`x-studyx-event` cambia en cada solicitud:

- Inicio: `call_started`
- Finalización: `call_ended`
- Análisis posterior: `call_analyzed`

El body debe ser el payload de Retell sin modificar. El endpoint debe recibir los eventos desde
Xendra; no se debe configurar Retell para enviar directamente al orquestador de StudyX.

## Herramientas que Lucas debe configurar

Todas usan `POST`, `Content-Type: application/json` y el header
`x-studyx-tools-secret: <RETELL_TOOLS_SECRET>`.

1. `https://studyx-agente-ventas.vercel.app/retell/tools/consultar-curso`
2. `https://studyx-agente-ventas.vercel.app/retell/tools/consultar-oferta`
3. `https://studyx-agente-ventas.vercel.app/retell/tools/guardar-datos-contacto`
4. `https://studyx-agente-ventas.vercel.app/retell/tools/enviar-link-pago`
5. `https://studyx-agente-ventas.vercel.app/retell/tools/verificar-pago`
6. `https://studyx-agente-ventas.vercel.app/retell/tools/enviar-material`
7. `https://studyx-agente-ventas.vercel.app/retell/tools/derivar-humano`
8. `https://studyx-agente-ventas.vercel.app/retell/tools/agendar-seguimiento`
9. `https://studyx-agente-ventas.vercel.app/retell/tools/registrar-resultado`

Las URLs placeholder `REEMPLAZAR-ORQUESTADOR.studyx.com` deben eliminarse completamente.

## Contrato de planes de pago

Para `enviar-link-pago`, utilizar preferentemente:

```json
{
  "curso": "codigo_canonico",
  "plan_code": "monthly_12"
}
```

Valores admitidos:

- `monthly_12`: doce pagos mensuales.
- `monthly_6`: seis pagos mensuales.
- `one_time`: pago único.

Por compatibilidad, `contado` se convierte en `one_time`. El valor genérico `cuotas` no determina
si son seis o doce y debe pedir una aclaración.

## Tareas de Lucas / Xendra

1. Confirmar que Xendra espera el mismo `STUDYX_ORCHESTRATOR_SECRET` ya validado.
2. Reemplazar las nueve URLs placeholder por las URLs productivas anteriores.
3. Configurar `x-studyx-tools-secret` con el secreto enviado por StudyX.
4. Configurar el relay de los tres eventos hacia `/retell/eventos`.
5. Publicar o activar la versión `0` del Agente B en Retell.
6. Confirmar el número saliente utilizado por Xendra.
7. Confirmar `numero_closer` si se habilitará transferencia a una persona.
8. Avisar cuando la configuración esté lista para una llamada supervisada.

## Tareas de StudyX / Thiago

1. Fusionar la rama de integración del Agente B con la versión vigente del Agente A.
2. Desplegar el backend actualizado en Vercel.
3. Verificar que `/retell/eventos` y las nueve rutas `/retell/tools/*` ya no respondan `404`.
4. Confirmar a Lucas el momento en que las URLs estén operativas.
5. Ejecutar una única prueba supervisada punta a punta.

## Criterio de aceptación

La integración queda aprobada cuando una prueba supervisada demuestra:

1. A ofrece la llamada y el cliente acepta.
2. Xendra inicia exactamente una llamada y devuelve un `call_id`.
3. B recibe el contexto del chat y no repite información conocida.
4. B consulta curso y oferta mediante las herramientas.
5. Ante elección de plan, el orquestador envía exactamente un link al chat original.
6. Datos y resultado quedan persistidos en PostgreSQL.
7. La fila de Google Sheets se actualiza sin duplicarse.
8. Los eventos de llamada llegan autenticados al webhook.
9. A puede retomar la misma conversación después de la llamada.

## Seguridad

- No pegar los secretos en este archivo, Git, tickets ni capturas.
- Enviar `RETELL_TOOLS_SECRET` por separado.
- No entregar una API key de Retell.
- No realizar una llamada facturada hasta que ambas partes confirmen la configuración.
