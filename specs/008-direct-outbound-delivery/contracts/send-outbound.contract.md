# Contrato: Caso de uso `sendOutboundMessage`

**Feature**: 008 | **Fase**: 1 | **Ubicación**: `src/features/messaging/application/send-outbound-message.ts`

Función interna del orquestador. **No se expone como endpoint HTTP en esta feature**: su
consumidor será la custom function de Retell en la spec 008. Publicar una superficie de
envío antes de tener consumidor sería superficie de ataque sin uso (Principio II).

## Entrada

```ts
export interface SendOutboundMessageInput {
  workspaceId: string;
  contactId: string;
  text: string;
  /** Clave provista por el llamador. Determina la identidad del envío. */
  idempotencyKey: string;
  preferredChannel?: 'telegram' | 'whatsapp';
  purpose: 'conversational' | 'transactional' | 'support' | 'consent_confirmation';
}
```

`purpose` reutiliza el dominio ya admitido por `outbound_deliveries`; un link de pago es
`transactional`. No requiere ampliar el enum.

Validación con Zod en el borde: `text` entre 1 y 4096 caracteres, `idempotencyKey` no
vacío, identificadores con formato UUID.

## Salida

```ts
export interface SendOutboundMessageResult {
  outcome:
    | 'sent'                // el proveedor lo aceptó
    | 'rejected_by_policy'  // consentimiento, bloqueo o candado sandbox
    | 'unreachable'         // el contacto no tiene ningún canal utilizable
    | 'retryable'           // fallo transitorio o ambiguo; queda en el ledger
    | 'permanent';          // fallo definitivo
  channel: 'telegram' | 'whatsapp' | null;
  providerMessageId: string | null;
  deliveryId: string;
  /** Motivo estable y legible; apto para que un flujo en vivo lo explique. */
  reason: string | null;
}
```

`unreachable` es un desenlace de primera clase y **no** una variante de `retryable`:
reintentar no lo va a cambiar. El vendedor en una llamada lo necesita para ofrecer una
alternativa en lugar de prometer un mensaje que no va a llegar.

## Secuencia

```
1. Resolver contacto dentro del workspace (join por workspace_contacts).
   No pertenece  → error, sin revelar datos del contacto.          [FR-013]

2. Candado sandbox: ¿hay fila en sandbox_identities?
   Sí → 'rejected_by_policy', reason 'SANDBOX_LOCKED'.             [FR-034]

3. Política de contacto: evaluateTurnPolicy(facts).
   Bloqueado o consentimiento revocado
        → 'rejected_by_policy', reason 'CONTACT_BLOCKED' | 'CONSENT_REVOKED'.  [FR-011/012]

4. Seleccionar canal entre las identidades utilizables:
     - excluir channel_threads con unusable_at NOT NULL
     - WhatsApp cuenta como no disponible si reply_window_expires_at <= now()
     - preferencia del llamador primero; si no, orden por last_seen_at DESC
   Ninguno → 'unreachable', reason 'NO_USABLE_CHANNEL'.            [FR-018/019/021]

5. enqueue_outbound_delivery(...) con la clave de idempotencia.
   Choque contra el UNIQUE:
     - la fila ya está 'submitted'/'delivered' → devolver ese resultado
       SIN contactar al proveedor.                                 [FR-009]
     - la fila está 'failed_retryable'         → continuar, mismo registro.

6. Tomar el lease en el acto: leased_by = 'direct:<idempotencyKey>'.

7. Enviar por el adapter del canal elegido.

8. Registrar el desenlace y devolver.
```

## Mapeo de desenlaces

| Resultado del adapter | Estado del ledger | `outcome` | Efecto adicional |
|---|---|---|---|
| Éxito | `submitted` | `sent` | Guarda `provider_message_id` |
| `permanent` | `dead_letter` | `permanent` | Marca `unusable_at` en la identidad |
| `window_closed` | — | reintenta el paso 4 sin ese canal | Cierra la ventana local |
| `transient` | `failed_retryable` | `retryable` | `next_attempt_at` según `retry_after` |
| `config_error` | `failed_retryable` | `retryable` | Emite alerta; no es culpa del contacto |
| **`AmbiguousChannelError`** | `failed_retryable` | `retryable` | **Nunca** `submitted` |

## Invariantes

1. **Un pedido produce como máximo un mensaje entregado**, garantizado por
   `UNIQUE (provider, integration_id, idempotency_key)` en la base, no por la aplicación.
2. **Lo ambiguo nunca se reporta como enviado.** Si el mensaje pudo haber salido y no lo
   sabemos, el sistema dice "no confirmado". Es la única respuesta verdadera, y es la que
   evita tanto la mentira como el reenvío duplicado.
3. **La elegibilidad se evalúa en el momento del envío**, no al encolar: el consentimiento
   puede haberse retirado en el medio.
4. **`window_closed` no es un fallo.** Es información: ese canal no sirve ahora. Se cambia
   de canal y se sigue.
5. **Nada se borra.** Las identidades inservibles se marcan.
6. Toda consulta de contacto filtra por workspace.

## Cobertura de prueba obligatoria

Cada invariante tiene su escenario en `tests/integration/direct-outbound-delivery.test.ts`;
ver [quickstart.md](../quickstart.md).
