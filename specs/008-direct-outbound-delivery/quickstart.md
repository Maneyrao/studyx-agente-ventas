# Quickstart: validar la entrega outbound directa

**Feature**: 008 | **Fase**: 1

Guía para comprobar que la feature funciona de punta a punta. No contiene código de
implementación; los detalles de diseño están en [contracts/](./contracts/) y
[data-model.md](./data-model.md).

## Prerrequisitos

- Supabase local corriendo (`supabase start`)
- `.env.local` con las variables del canal. Telegram reutiliza
  `TELEGRAM_AGENT_B_BOT_TOKEN`; WhatsApp requiere las nuevas (token, `phone_number_id`,
  versión de Graph API pineada)
- Un chat de Telegram real que ya haya iniciado conversación con el bot — sin eso no hay
  `chat_id` y el envío es imposible por diseño del proveedor

## 1. Migración limpia

```bash
npm run test:db:reset-loop     # aplica todas las migraciones desde cero
npm run test:db:lint           # supabase db lint --level error
npm run test:db:invariants     # pgTAP
```

**Esperado**: sin errores. La migración `20260818010001` debe poder aplicarse dos veces
seguidas sobre una base limpia sin romper.

**Verificación puntual** — que `telegram` sea ahora un canal válido y que las columnas de
invalidación existan:

```sql
INSERT INTO channel_threads (contact_id, provider, integration_id, channel, external_conversation_id)
VALUES ('<contact-uuid>', 'telegram', 'test', 'telegram', '123456789');
-- Esperado: éxito. Antes de la migración fallaba por el CHECK de channel.

SELECT unusable_at, unusable_reason FROM channel_threads LIMIT 1;
-- Esperado: las columnas existen.
```

## 2. Dominio puro

```bash
npm run test:unit -- tests/unit/messaging
```

Cubre selección de canal, ventana vencida tratada como indisponibilidad, mapeo de cada
desenlace del proveedor y el gate de elegibilidad. Sin base de datos ni red.

## 3. Integración

```bash
npm run test:integration -- direct-outbound-delivery
```

Escenarios obligatorios, uno por invariante del contrato:

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Dos invocaciones con la misma clave | Un solo mensaje, un solo registro; la segunda devuelve el resultado de la primera |
| 2 | Dos invocaciones **concurrentes** con la misma clave | Exactamente un envío; la perdedora lee la fila ganadora |
| 3 | Contacto con `consent_status = 'revoked'` | Cero envíos; `rejected_by_policy` con motivo |
| 4 | Contacto con fila en `sandbox_identities` | Cero efectos reales; `SANDBOX_LOCKED` |
| 5 | Ventana de WhatsApp vencida + identidad de Telegram | Sale por Telegram; el resultado informa el cambio |
| 6 | Sin ventana y sin identidad de Telegram | `unreachable`, sin ningún intento contra un proveedor |
| 7 | Timeout del proveedor | `failed_retryable`; **nunca** `submitted` |
| 8 | WhatsApp responde `131047` con ventana que el estado local creía abierta | Cae al canal de respaldo y cierra la ventana local, sin marcar fallo |
| 9 | Dos chats de Telegram distintos devuelven el mismo `message_id` | No chocan contra `UNIQUE (provider, integration_id, provider_message_id)` |
| 10 | Ingesta de un evento entrante tras el cambio de canal | No-regresión: el flujo existente sigue registrando igual |

El escenario 2 es el que justifica el diseño: si la no-duplicación dependiera de una
comprobación en la aplicación en lugar del constraint, este test la detectaría.

## 4. Prueba manual — desbloqueo del piloto

Esto es lo que valida EXT-05, que `SESSION.md` registra como bloqueo del piloto de
Telegram por no tener la integración instalada en Botpress Cloud.

1. Desde el bot, hacer que un chat real envíe un mensaje (registra la identidad).
2. Verificar que quedó vinculada:

```sql
SELECT contact_id, channel, external_conversation_id, unusable_at
FROM channel_threads
WHERE channel = 'telegram';
```

3. Invocar el caso de uso para ese contacto con un texto de prueba.
4. **Esperado**: el mensaje llega al dispositivo, el resultado es `sent`, y el ledger
   muestra `submitted` con `provider_message_id` compuesto (`chatId:messageId`).

```sql
SELECT state, channel, provider, destination, provider_message_id, attempt_count
FROM outbound_deliveries
ORDER BY created_at DESC LIMIT 1;
```

5. Repetir el paso 3 **con la misma clave de idempotencia**. Esperado: no llega un segundo
   mensaje y el ledger sigue teniendo una sola fila.

## 5. Cierre

```bash
npm run typecheck
npm run lint
npm run build
```

## Qué NO valida este quickstart

- Que el destinatario **haya leído** el mensaje. v1 registra aceptación del proveedor, no
  entrega al dispositivo; no se procesan callbacks de estado.
- El envío en frío a un lead que nunca abrió un canal: es imposible por diseño de ambos
  proveedores. Ver el riesgo abierto en el plan.
