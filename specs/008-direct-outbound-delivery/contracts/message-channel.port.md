# Contrato: Puerto `MessageChannel`

**Feature**: 008 | **Fase**: 1 | **Ubicación**: `src/features/messaging/ports/message-channel.ts`

Interfaz que todo canal de mensajería debe satisfacer. Modelada sobre el patrón de
`src/features/calls/ports/voice-provider.ts`.

## Principio del contrato

El puerto adopta el modelo de garantía **más débil** de los proveedores que lo implementan:
aceptación asíncrona, sin idempotencia nativa. Prometer la confirmación fuerte de Telegram
haría que WhatsApp no pudiera implementarlo con honestidad, y un adapter que miente sobre
su garantía es peor que uno limitado.

## Interfaz

```ts
export interface SendTextInput {
  /** Identificador del destinatario en el canal: chat_id o teléfono. */
  destination: string;
  text: string;
  /** Sólo para trazabilidad del proveedor; la idempotencia la resuelve el ledger. */
  correlationId: string;
}

export interface SendTextResult {
  /**
   * Identificador estable del mensaje en el proveedor.
   * Telegram: compuesto `chatId:messageId`, porque message_id es único por chat.
   * WhatsApp: el `wamid.` tal cual, que ya es global.
   */
  providerMessageId: string;
  acceptedAt: string;
}

export interface MessageChannel {
  readonly channel: 'telegram' | 'whatsapp';
  readonly provider: string;
  readonly integrationId: string;
  /** Largo máximo admitido; ambos proveedores usan 4096. */
  readonly maxTextLength: number;
  sendText(input: SendTextInput): Promise<SendTextResult>;
}
```

## Errores

Todo adapter traduce el error crudo del proveedor a una de estas clases. El caso de uso
decide **solo** sobre ellas; nunca inspecciona el error original.

```ts
export type ChannelFailureKind =
  | 'permanent'      // la identidad no sirve más: bloqueado, inexistente, desactivado
  | 'transient'      // límite de tasa o falla del proveedor: reintentable
  | 'window_closed'  // WhatsApp 131047: el canal no está disponible ahora
  | 'config_error';  // token inválido, número no registrado: escalar, no reintentar

export class ConfirmedChannelError extends Error {
  readonly kind: ChannelFailureKind;
  readonly code: string;              // código estable del proveedor, para auditoría
  readonly retryAfterSeconds: number | null;
}

/**
 * El envío pudo haber salido y no lo sabemos: timeout, corte de red, respuesta ilegible.
 * NUNCA debe tratarse como éxito ni como fallo permanente.
 */
export class AmbiguousChannelError extends Error {
  readonly code: string;
}
```

## Obligaciones del implementador

1. **Timeout obligatorio.** Toda llamada saliente lleva `AbortController` con el timeout de
   configuración, liberado en `finally`. Patrón ya establecido en
   `TelegramBotApiClient.request`.
2. **Cualquier fallo no clasificable es ambiguo, no permanente.** Un error de red no
   prueba que el mensaje no salió. Clasificarlo como fallo definitivo llevaría a un
   reenvío que duplica.
3. **Clasificar por código, no por texto.** Las descripciones de error no son contrato
   estable en ninguno de los dos proveedores.
4. **No reintentar internamente.** El reintento es decisión del caso de uso y del ledger,
   que son los que tienen la clave de idempotencia. Un adapter que reintenta por su cuenta
   puede duplicar sin que el ledger se entere.
5. **`providerMessageId` debe ser único dentro de `(provider, integration_id)`.** Lo exige
   `UNIQUE (provider, integration_id, provider_message_id)` en `outbound_deliveries`. Para
   Telegram esto obliga a componer con el `chat_id`.
