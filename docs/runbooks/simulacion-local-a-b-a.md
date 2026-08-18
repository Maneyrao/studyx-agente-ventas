# Runbook — Simulación local A→B→A (Telegram sandbox)

## Alcance

Este ciclo simula el flujo completo en tu máquina: le pedís una llamada a Bot A,
Bot B te escribe con el contexto en Telegram (simulando la llamada), marcás el
veredicto en los botones, y el cron post-llamada te manda el mensaje de cierre.
Sin Retell, sin WhatsApp, sin efectos reales. Valida la ruta backend→Telegram→
humano→cron, y es la forma soportada de probar la integración antes de entrar
en producción.

## Advertencia: producción vs. local

**CRÍTICO:** `DATABASE_URL` en `.env.local` apunta a tu Supabase remoto en
**producción**. Nunca la uses en simulaciones locales ni en tests. Usa siempre
el cluster local explícitamente en `127.0.0.1:55433`. Una conexión accidental a
producción puede escribir datos de prueba en el catálogo de clientes reales.

## Prerrequisitos

### 1. Levantar la base de datos local

```bash
bash scripts/pg-native-up.sh
```

Este comando arranca un PostgreSQL 17 en `127.0.0.1:55433`, crea y migra la
base de datos `studyx_test` automáticamente. Espera a que termine de
inicializar (verás logs de conexión). Luego carga los datos de prueba:

```bash
# Seed de fixtures sintéticas (contacto "Alumno Smoke" fake + tenant fake).
# Úsalo sólo para desarrollo local; dev.sql nunca toca producción.
psql -h 127.0.0.1 -p 55433 -U postgres studyx_test < supabase/seed/dev.sql

# Alternativamente, si necesitas probar contra el catálogo real de StudyX:
psql -h 127.0.0.1 -p 55433 -U postgres studyx_test < supabase/seed/studyx.sql
```

- `dev.sql` carga un contacto sintético y un tenant de juguete. Es rápido y
  aislado.
- `studyx.sql` carga el catálogo de clientes reales (workspace slug `studyx`,
  `environment='production'`). Es la forma soportada de actualizar el catálogo:
  edita el archivo, re-ejecúta, es idempotente.

### 2. Variables de entorno

Copia `.env.example` a `.env.local` y completa estas variables. Cada una viene
de una fuente distinta:

```bash
cp .env.example .env.local
# Luego edita .env.local con un editor:
```

- **`TELEGRAM_AGENT_B_BOT_TOKEN`**: el token del bot en Telegram. Obtenlo de
  BotFather (`/newbot` → copia el token `123456789:ABCdef...`).

- **`TELEGRAM_AGENT_B_WEBHOOK_SECRET`**: un secreto largo que inventas
  (ej: `openssl rand -hex 32`). Telegram lo devolverá en cada webhook para
  validar que eres vos. Guárdalo, lo usarás en el paso 5.

- **`TELEGRAM_AGENT_B_SMOKE_CHAT_ID`**: tu ID de chat privado en Telegram.
  Mandá un mensaje a `@userinfobot` desde tu cuenta; te mostrará
  `Your user ID: 123456789`. Ese es el valor.

- **`TELEGRAM_AGENT_B_SMOKE_USER_ID`**: tu ID de usuario de Telegram (el mismo
  que en `CHAT_ID`). Úsalo de nuevo.

- **`VOICE_PROVIDER=telegram_sandbox`**: déjalo así. Es el provider de voz para
  simulación.

- **`BUSINESS_WORKSPACE_SLUG=studyx`**: el workspace que quieres probar. Este
  valor está baked en `supabase/seed/studyx.sql` y no necesita configuración
  adicional.

- **`CRON_SECRET`**: otro secreto que inventas (ej: `openssl rand -hex 32`).
  Autentica la llamada del cron post-llamada.

### 3. Crear tu identidad de prueba

Para que Bot B te reconozca como un tester válido, registra tu usuario en la
tabla `sandbox_identities`:

```bash
# Usa el cluster local (no DATABASE_URL)
node scripts/seed-sandbox-tester.mjs \
  --database-url "postgresql://postgres@127.0.0.1:55433/studyx_test" \
  --telegram-user-id <TU_USER_ID> \
  --name "Tu Nombre"
```

Reemplaza `<TU_USER_ID>` con el número que obtuviste de `@userinfobot`. El
script se niega a conectar a cualquier host que no sea local.

### 4. Iniciar sesión con Bot B

Abre Telegram y busca a tu bot por `@tu_bot_username`. Enviale `/start` una
sola vez. **Esto es crítico:** un bot de Telegram no puede abrir una
conversación privada en frío; tiene que ser el usuario quien escriba primero.
Sin este paso, ningún mensaje llegará.

## Por sesión de prueba

### 1. Levantar el servidor local

```bash
npm run dev
```

El servidor escucha en `http://localhost:3000` y recarga con cambios.

### 2. Abrir un túnel

Telegram necesita una URL pública para enviarte las respuestas (los botones
que apretás). Exponé tu localhost con un túnel:

**Opción A (recomendado — ya está instalado):**

```bash
cloudflared tunnel --url http://localhost:3000
```

Verás algo como:

```
Your quick tunnel has been created! Visit it at (it may take some time to be reachable):
https://something-something-random.trycloudflare.com/
```

Copia esa URL (sin `/` final).

**Opción B (alternativa):**

Si no tenés `cloudflared`, descargá `ngrok`:

```bash
ngrok http 3000
```

Copiá la URL pública que te da.

### 3. Registrar el webhook de Bot B

Cada vez que cambias la URL del túnel (ej: si reiniciás cloudflared), tienes
que decirle a Telegram la nueva dirección. Usa la URL que copiaste arriba y
estos comandos:

```bash
TUNNEL_URL="https://tu-url-del-tunel"  # reemplaza con la que copiaste
curl -sS "https://api.telegram.org/bot${TELEGRAM_AGENT_B_BOT_TOKEN}/setWebhook" \
  -d "url=${TUNNEL_URL}/api/webhooks/voice/telegram" \
  -d "secret_token=${TELEGRAM_AGENT_B_WEBHOOK_SECRET}"
```

Verifica que Telegram aceptó:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_AGENT_B_BOT_TOKEN}/getWebhookInfo" | jq .
```

Busca:
- `"url": "https://tu-url-del-tunel/api/webhooks/voice/telegram"` (exacto)
- `"pending_update_count": 0` (significa que no hay retrasos)
- `"last_error_message"` debe estar vacío o ausente. Si tiene un valor, te
  dice por qué falló (ej: `connection refused`, `timeout`, etc).

### 4. Inyectar un turno inbound (opcional pero recomendado)

Si tienes Bot A en Botpress con su webhook conectado al mismo túnel, el flujo
es automático. Pero la ruta soportada para pruebas locales es inyectar
directamente en el backend a través del flujo completo:

1. **Ingerir el mensaje inbound** via `POST /api/agent/ingest` (requiere envelope
   HMAC-firmado).
2. **Reclamar el turno** via `POST /api/agent/batches/[batch_id]/claim`.
3. **Guardar la decisión del agente** via `POST /api/agent/turns/[turn_id]/decision`.
4. Una decisión con `request_call_now` reserva la llamada y dispara el flujo a Bot B.
5. **Despachar a Bot B** via `POST /api/agent/calls/[call_id]/dispatch` (la llamada
   ya existe en este punto).

Para el juego exacto de headers y el formato de la entrada de firma, consulta
`botpress-agent/README.md`: `src/proxy.ts` exige un header `x-signature` con
prefijo `v1=` y la entrada canónica es
`timestamp + "\n" + método + "\n" + pathname + "\n" + body JSON exacto`. El shape
del envelope está en `src/lib/contracts/inbound-envelope.ts`.

Ojo con `specs/002-agent-message-ingestion/quickstart.md`: sus ejemplos de curl
llevan sólo `X-Orchestrator-Key` y el proxy actual los rechaza. Sirve para ver la
secuencia de llamadas, no para armar la autenticación.

### 5. Verificar que todo funciona

Cuando llega el turno a Bot B:

1. Deberías recibir un mensaje en Telegram con dos botones:
   - "Correcto" (el contexto se ve bien)
   - "Incorrecto" (hay un problema)

2. Los logs de `npm run dev` mostrarán algo como:
   ```
   call_id=<uuid> method=POST path=/api/webhooks/voice/telegram status=200
   ```

3. Apreta un botón. Esto dispara la verificación.

4. Luego, el cron (`GET /api/cron/post-call-followup`) te enviará un mensaje de
   cierre en Telegram. En desarrollo local, puedes dispararlo manualmente:

   ```bash
   curl -sS "http://localhost:3000/api/cron/post-call-followup" \
     -H "Authorization: Bearer ${CRON_SECRET}" \
     -H "X-Vercel-Cron: true"
   ```

   (En producción, Vercel Crons lo llama automáticamente cada 5 minutos.)

## Verificación y diagnóstico

### El mensaje de Bot B no llega

1. **Primera parada:** `getWebhookInfo`
   ```bash
   curl -sS "https://api.telegram.org/bot${TELEGRAM_AGENT_B_BOT_TOKEN}/getWebhookInfo" | jq .last_error_message
   ```
   Si hay un `last_error_message`, Telegram te dice exactamente qué pasó. Temas
   comunes:
   - `connection refused`: el túnel se cayó o la URL es incorrecta.
   - `timeout`: tu backend tardó más de 30 segundos.
   - `TLS certificate problem`: el certificado del túnel tiene un problema.

2. **Logs del backend:** en `npm run dev`, busca el `call_id` de la llamada.
   Deberías ver las líneas de ingreso al webhook.

3. **Tabla `call_context_receipts`:** contiene tres campos que separan fallos:
   - `ack.status='accepted'`: Bot B armó y hashó el contexto.
   - `delivery_status='accepted'`: Telegram aceptó `sendMessage`.
   - `verdict='correct'|'incorrect'|null`: vos apretaste un botón (o no).

   Si `ack.status` falla, el backend rechazó algo en el contexto.
   Si `delivery_status` falla, el problema es entre el backend y Telegram.
   Si `verdict` es null, no apretaste el botón o el webhook de callback falló.

### Los botones no responden

- Verifica que apretaste uno de los dos botones en el mensaje.
- Los logs de `npm run dev` deberían mostrar un POST a
  `/api/webhooks/voice/telegram` de Telegram (el callback del botón).
- Si no aparece, el webhook no está registrado o Telegram tiene una URL
  cachada vieja.

### El cron no llega

- Confirma que `CRON_SECRET` en `.env.local` coincide con lo que pasaste en el
  header.
- En producción, el cron corre cada 5 minutos; en local, dispáralo manualmente.
- Los logs de `npm run dev` mostrarán `GET /api/cron/post-call-followup status=...`.

## Limpiar cuando termines

Cuando dejes de probar, le avisá a Telegram que baje el webhook:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_AGENT_B_BOT_TOKEN}/deleteWebhook"
```

Así Telegram no seguirá pegándole a un túnel muerto (y te ahorras un retry
storm en los logs).

Opcionalmente, mata el cluster local:

```bash
bash scripts/pg-native-down.sh
```

Este script detiene el proceso PostgreSQL con `pg_ctl -m fast` y limpia
`/private/tmp/studyx-pg17-55433`.

## Notas de arquitectura

- **Bot A** vive en Botpress, afuera de este repo. La simulación local no lo
  requiere; el backend lo invoca cuando llega un turno real.
- **Retell** (VoIP real) tampoco está en el flujo local. Telegram sandbox
  simula el contexto de la llamada sin hacer llamadas de verdad.
- **Candado anti-efectos-reales, verificado:** `VOICE_PROVIDER` es un switch
  global (`request-call.ts:resolveVoiceProvider`), no por contacto — hoy en
  producción, sin Retell, cualquier contacto real que confirme una llamada
  también recibe `call_sessions.provider = 'telegram_sandbox'`. Lo que impide
  que ese contacto real reciba el mensaje de Telegram del tester es el JOIN a
  `sandbox_identities` dentro de `PostgresContextReceiptStore.resolve`
  (`postgres-context-receipt-store.ts`): sin esa fila, `resolve()` lanza
  `TELEGRAM_AGENT_B_NOT_STARTED` antes de llamar a `telegram.sendMessage`, y
  `dispatchCall` cierra la llamada en `dispatch_ambiguous` — nunca en
  `provider_accepted`. Cubierto por el test
  `tests/integration/telegram-agent-b-smoke.test.ts` → *"un contacto real
  (sin sandbox_identities) nunca dispara un mensaje de Telegram"*.
- **El loop B→A se cierra por veredicto humano, no por webhook de Retell:**
  cuando apretás un botón en Telegram, `telegram-webhook.ts` traduce el
  veredicto a los eventos `call_events` (`started`+`ended` o sólo `ended`,
  ver `domain/context-verdict-outcome.ts`) que el cron post-llamada necesita
  para encontrar la llamada en estado terminal. Antes de esto, el ledger se
  quedaba trabado en `provider_accepted` y el cron nunca tenía nada que
  cerrar — verificado end-to-end en el mismo archivo de test, contra la ruta
  HTTP real (`handleTelegramWebhook` → `runPostCallFollowup`).
- **`TEST_DATABASE_URL`** es necesaria para que los tests de integración
  realmente ejecuten. Sin ella, las suites se saltan silenciosamente (imprimen
  `[integration skipped]` y no corren nada). Exportá siempre:
  ```bash
  export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:55433/studyx_test"
  npm run test:integration
  ```
  Verifica que el reporte muestra un número no cero de tests ejecutados.
