---

description: "Task list for feature 008 — Entrega Outbound Directa Multicanal"
---

# Tasks: Entrega Outbound Directa Multicanal

**Input**: Design documents from `/specs/008-direct-outbound-delivery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUIDOS y obligatorios. La constitución del proyecto y `CLAUDE.md` exigen
unitarias, integración, concurrencia e inyección de fallos; `quickstart.md` fija diez
escenarios de integración que deben pasar.

**Organization**: Agrupadas por historia de usuario para que cada una sea implementable y
verificable de forma independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: Historia a la que pertenece (US1–US4)

## Path Conventions

Proyecto único: `src/`, `tests/`, `supabase/migrations/` en la raíz del repositorio.
Convención de feature verificada en el repo: `src/features/<dominio>/{ports,adapters,application,domain}`.

---

## Phase 1: Setup

**Purpose**: Estructura y configuración. Sin lógica de negocio.

- [X] T001 Crear el árbol de archivos de la feature en `src/features/messaging/{ports,adapters,application,domain}` y `tests/unit/messaging/`, siguiendo la convención de `src/features/payments/`
- [X] T002 [P] Agregar `loadMessagingChannelsConfig()` en `src/lib/config.ts`, copiando el patrón de `loadTelegramAgentBConfig()` (requeridas explícitas, `throw new Error('MISSING_MESSAGING_CONFIG:KEY')`, `parsePositiveInt` para el timeout). Incluye la versión de Graph API **pineada** para WhatsApp
- [X] T003 [P] Declarar en `.env.example` las variables nuevas de WhatsApp Cloud sin valores reales: token, `phone_number_id`, versión de Graph API, timeout
- [X] T004 [P] Escribir `tests/unit/messaging/config.test.ts`: falta una variable requerida → error con el código esperado; timeout ausente → default

**Checkpoint**: la configuración carga y falla de forma explícita cuando falta algo.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema, puerto y piezas compartidas. **Ninguna historia puede empezar antes de terminar esta fase.**

**⚠️ CRÍTICO**: T005 y T009 tocan superficie ya en producción. Van con su cobertura de no-regresión en la misma tarea.

### Esquema

- [X] T005 Crear `supabase/migrations/20260818010001_channel_identity_telegram.sql`: ampliar el `CHECK` de `channel` a `('whatsapp','voice','telegram')` en `conversations`, `channel_threads`, `channel_events`, `contact_channel_permissions`, `consent_events` y `outbound_deliveries`, usando `DROP CONSTRAINT` + `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT`
- [X] T006 En la misma migración `supabase/migrations/20260818010001_channel_identity_telegram.sql`, agregar a `channel_threads` las columnas `unusable_at timestamptz` y `unusable_reason text`, más el índice parcial `channel_threads_usable_idx (contact_id, channel, last_seen_at DESC) WHERE unusable_at IS NULL`
- [X] T007 Verificar la migración: `npm run test:db:reset-loop`, `npm run test:db:lint` y `npm run test:db:invariants` deben pasar en verde sobre base limpia

### Puerto y contrato

- [X] T008 [P] Escribir el puerto en `src/features/messaging/ports/message-channel.ts` según `contracts/message-channel.port.md`: `MessageChannel`, `SendTextInput`, `SendTextResult`, `ChannelFailureKind`, `ConfirmedChannelError`, `AmbiguousChannelError`. Modelar sobre `src/features/calls/ports/voice-provider.ts`
- [X] T009 [P] Escribir el puerto `src/features/messaging/ports/channel-identity-store.ts`: resolución de identidades utilizables del contacto, lectura de permisos y ventana, marca de identidad inutilizable, y consulta del candado sandbox

### Cliente de Telegram (generalización)

- [X] T010 Mover `src/features/calls/adapters/telegram-bot-api.client.ts` a `src/features/messaging/adapters/telegram-bot-api.client.ts` y actualizar los imports en `src/features/calls/adapters/telegram-sim-voice.provider.ts`. **Solo movimiento, sin cambio de comportamiento**, para que el diff quede legible
- [X] T011 En `src/features/messaging/adapters/telegram-bot-api.client.ts`, hacer opcionales `correctCallbackData` e `incorrectCallbackData` para poder enviar texto plano, sin alterar el comportamiento de los llamadores actuales que sí los pasan
- [X] T012 En `src/features/messaging/adapters/telegram-bot-api.client.ts`, refinar la taxonomía de errores clasificando **por `error_code`**: 401/403 → permanente; 400 → permanente salvo que traiga `parameters.migrate_to_chat_id`; 429 → transitorio con `parameters.retry_after`; ≥500 → transitorio. Las `description` solo para telemetría, con `includes(...)`, nunca igualdad
- [X] T013 [P] Escribir `tests/unit/messaging/telegram-client.test.ts`: cada `error_code` cae en la clase correcta; el timeout produce ambiguo y no permanente; el teclado inline sigue emitiéndose cuando se pasan los callbacks

### Dominio compartido

- [X] T014 [P] Escribir `src/features/messaging/domain/delivery-outcome.ts`: función pura que mapea el resultado del adapter al estado del ledger según la tabla de `contracts/send-outbound.contract.md`. El éxito es `submitted`, **nunca** `delivered`; lo ambiguo es `failed_retryable`
- [X] T015 [P] Escribir `tests/unit/messaging/delivery-outcome.test.ts` cubriendo las seis filas de la tabla de mapeo, con aserción explícita de que ningún camino ambiguo produce `submitted`

### Identidad de canal en la ingesta (FR-028)

- [X] T016 En `src/lib/services/ingestion.service.ts:221`, reemplazar `const channel = 'whatsapp' as const` por la derivación del canal a partir del envelope, de modo que una identidad de Telegram se registre como tal en `channel_threads`
- [X] T017 Escribir `tests/integration/ingestion-channel-derivation.test.ts` con la cobertura de **no-regresión** de T016: un evento entrante de WhatsApp sigue registrándose exactamente igual que antes del cambio; uno de Telegram queda con `channel = 'telegram'`
- [X] T018 [P] Implementar `src/features/messaging/adapters/postgres-channel-identity-store.ts`: consultas de identidades utilizables (excluyendo `unusable_at`), permisos y ventana, candado sandbox, y marca de inutilizable. Toda consulta filtra por workspace

**Checkpoint**: esquema migrado, puerto definido, cliente generalizado. Las historias pueden empezar.

---

## Phase 3: User Story 1 — Entrega confirmada en el momento (Priority: P1) 🎯 MVP

**Goal**: un flujo interno puede enviarle un mensaje a un contacto por Telegram y obtener un resultado concluyente dentro de la misma operación.

**Independent Test**: invocar el caso de uso para un contacto con identidad de Telegram conocida; el mensaje llega al dispositivo y la operación devuelve `sent` con el identificador del proveedor.

- [X] T019 [US1] Implementar `src/features/messaging/adapters/telegram-message.channel.ts` sobre el cliente generalizado: envía texto plano y traduce los errores del cliente a `ConfirmedChannelError` / `AmbiguousChannelError`
- [X] T020 [US1] En `src/features/messaging/adapters/telegram-message.channel.ts`, componer el `providerMessageId` como `chatId:messageId`. **El `message_id` de Telegram es único por chat, no global**, y `outbound_deliveries` tiene `UNIQUE (provider, integration_id, provider_message_id)`
- [X] T021 [US1] Implementar el camino principal de `src/features/messaging/application/send-outbound-message.ts`: resolver contacto por workspace, crear el mensaje saliente, llamar a `enqueue_outbound_delivery(...)`, tomar el lease con `leased_by = 'direct:<clave>'`, enviar y registrar el desenlace
- [X] T022 [US1] Definir el esquema Zod de entrada y salida del caso de uso en `src/features/messaging/application/send-outbound-message.ts` (texto de 1 a 4096 caracteres, identificadores UUID, `purpose` dentro del dominio ya admitido por el ledger)
- [X] T023 [P] [US1] Escribir `tests/integration/direct-outbound-delivery.test.ts` con el escenario 1 de `quickstart.md`: envío exitoso → estado `submitted`, `provider_message_id` compuesto, mensaje registrado en el historial de la conversación
- [X] T024 [P] [US1] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 7: timeout del proveedor → `failed_retryable`, nunca `submitted`, y el resultado devuelto es `retryable`
- [X] T025 [P] [US1] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 9: dos envíos a chats de Telegram distintos que devuelven el mismo `message_id` no chocan contra `UNIQUE (provider, integration_id, provider_message_id)`

**Checkpoint**: US1 entrega valor sola. Es el MVP y el que desbloquea el piloto (EXT-05).

---

## Phase 4: User Story 2 — Un pedido, un solo mensaje (Priority: P2)

**Goal**: reintentos y pedidos repetidos nunca producen un segundo mensaje.

**Independent Test**: invocar dos veces con la misma clave; el contacto recibe uno solo y la segunda invocación devuelve el resultado de la primera.

- [X] T026 [US2] En `src/features/messaging/application/send-outbound-message.ts`, manejar el choque contra `UNIQUE (provider, integration_id, idempotency_key)`: si la fila existente ya está `submitted`, devolver su resultado **sin contactar al proveedor**; si está `failed_retryable`, continuar sobre el mismo registro sin crear otro
- [X] T027 [P] [US2] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 1 de idempotencia: dos invocaciones secuenciales con la misma clave → un solo mensaje, un solo registro
- [X] T028 [US2] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 2: dos invocaciones **concurrentes** con la misma clave → exactamente un envío. Es la prueba que justifica apoyar la garantía en el constraint y no en la aplicación
- [X] T029 [P] [US2] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 3 de la historia: un envío previo `failed_retryable` reintentado con la misma clave no duplica el registro

**Checkpoint**: la no-duplicación queda demostrada bajo concurrencia real.

---

## Phase 5: User Story 3 — Nunca escribirle a quien no corresponde (Priority: P2)

**Goal**: consentimiento, bloqueo, tenant y candado sandbox se verifican antes de cualquier contacto con un proveedor.

**Independent Test**: pedir el envío para un contacto sin consentimiento; no se envía nada, el rechazo queda registrado con motivo y el llamador recibe algo que puede explicar.

- [X] T030 [P] [US3] Escribir `src/features/messaging/domain/eligibility.ts`: función pura que **compone** sobre `isContactBlocked()` y `evaluateTurnPolicy()` de `src/features/orchestration/domain/turn-policy.ts`, agregando la dimensión de disponibilidad de canal. **No reimplementar el chequeo de consentimiento** — el encabezado de `turn-policy.ts` documenta que esa duplicación ya causó un defecto
- [X] T031 [P] [US3] Escribir `tests/unit/messaging/eligibility.test.ts`: bloqueado, consentimiento revocado, contacto eliminado, y el caso permitido
- [X] T032 [US3] Insertar el gate en `src/features/messaging/application/send-outbound-message.ts` como pasos 1 a 3 del contrato: resolución por workspace, candado sandbox, política de contacto — **todos antes** de resolver canal o tocar el ledger
- [X] T033 [US3] En `src/features/messaging/application/send-outbound-message.ts`, registrar los rechazos por política de forma auditable con contacto, motivo y momento, distinguibles de un fallo técnico (FR-014)
- [X] T034 [P] [US3] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 3 de `quickstart.md`: contacto con `consent_status = 'revoked'` → cero envíos, `rejected_by_policy` con motivo
- [X] T035 [US3] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 4: contacto con fila en `sandbox_identities` → cero efectos reales, motivo `SANDBOX_LOCKED`. **Es el gate de seguridad del Constitution Check (FR-034), no un test opcional**
- [X] T036 [P] [US3] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el caso de aislamiento por tenant: contacto de otro workspace → rechazo sin revelar datos del contacto

**Checkpoint**: ningún camino de envío puede saltear el gate.

---

## Phase 6: User Story 4 — Segundo canal y elección con respaldo (Priority: P3)

**Goal**: el envío usa el canal preferido y cae a otro cuando ese no está disponible.

**Independent Test**: pedir un canal para el que el contacto no tiene identidad; el mensaje sale por el alternativo y el resultado informa cuál se usó.

- [X] T037 [P] [US4] Escribir `src/features/messaging/domain/channel-selection.ts`: función pura de preferencia y respaldo, orden determinístico por `last_seen_at`, exclusión de identidades con `unusable_at`, y WhatsApp tratado como no disponible si `reply_window_expires_at` ya venció
- [X] T038 [P] [US4] Escribir `tests/unit/messaging/channel-selection.test.ts`: preferencia respetada, respaldo aplicado, ventana vencida como indisponibilidad, orden reproducible, y el caso sin ningún canal utilizable
- [X] T039 [US4] Implementar `src/features/messaging/adapters/whatsapp-cloud.channel.ts`: `POST graph.facebook.com/<version>/<phone_number_id>/messages` con la versión tomada de configuración, timeout por `AbortController`, y clasificación por `error.code` numérico según la tabla de `research.md` R2.2
- [X] T040 [US4] En `src/features/messaging/adapters/whatsapp-cloud.channel.ts`, mapear `131047` a `window_closed` — **no a un fallo**. Meta no expone el estado de la ventana, así que recibirlo es un camino esperado
- [X] T041 [US4] En `src/features/messaging/application/send-outbound-message.ts`, integrar la selección con respaldo y el manejo de `window_closed`: cerrar la ventana en el estado local y reintentar por el siguiente canal, sin registrar fallo
- [X] T042 [US4] En `src/features/messaging/application/send-outbound-message.ts`, devolver `unreachable` como desenlace de primera clase cuando no queda ningún canal utilizable, distinguible de `retryable` (FR-021)
- [X] T043 [US4] En `src/features/messaging/application/send-outbound-message.ts`, al recibir un rechazo permanente del proveedor, marcar `unusable_at` y `unusable_reason` en la identidad de canal en lugar de reintentar contra ella (FR-022)
- [X] T044 [P] [US4] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 5 de `quickstart.md`: ventana de WhatsApp vencida + identidad de Telegram → sale por Telegram, el resultado informa el cambio
- [X] T045 [P] [US4] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 6: sin ventana y sin Telegram → `unreachable` sin ningún intento contra un proveedor
- [X] T046 [US4] Agregar a `tests/integration/direct-outbound-delivery.test.ts` el escenario 8: WhatsApp responde `131047` con ventana que el estado local creía abierta → cae al respaldo y cierra la ventana local, sin marcar fallo

**Checkpoint**: los cuatro escenarios de canal del quickstart pasan.

---

## Phase 7: Polish & Cross-Cutting

- [X] T047 [P] Auditar `src/features/messaging/` y `supabase/migrations/20260818010001_channel_identity_telegram.sql`: ningún camino ejecuta `DELETE`, y que toda invalidación sea por marca lógica (Principio IV)
- [X] T048 [P] Auditar `src/features/messaging/adapters/` y `src/lib/config.ts`: ninguna credencial de canal se registra en logs ni se devuelva en un resultado (Principio II)
- [ ] T049 ⛔ **BLOQUEADA (requiere credenciales)** — Ejecutar la validación manual del piloto de `quickstart.md` sección 4 contra un chat de Telegram real, incluida la repetición con la misma clave de idempotencia
- [X] T050 [P] Actualizar `SESSION.md`: registrar que EXT-05 queda desbloqueado, porque la entrega ya no depende de la integración de Telegram en Botpress Cloud
- [X] T051 [P] Actualizar `docs/ORCHESTRATOR_MAP.md` con la feature `messaging` y el camino de entrega directa
- [X] T052 Verificación de cierre: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:integration`, `npm run build`
- [ ] T053 ⏸ **PENDIENTE DE DECISIÓN DEL USUARIO** (hace commit) — Invocar la skill `studyx-checkpoint` (actualiza `SESSION.md` y hace commit) para cerrar la fase antes de compactar contexto

---

## Dependencies

```
Phase 1 (Setup)
   └─► Phase 2 (Foundational)  ← BLOQUEANTE
          ├─► Phase 3  US1 (P1)  🎯 MVP
          │      └─► Phase 4  US2 (P2)   ← extiende el caso de uso de US1
          │      └─► Phase 5  US3 (P2)   ← extiende el caso de uso de US1
          │             └─► Phase 6  US4 (P3)
          └─► Phase 7 (Polish)
```

Dentro de la fase 2: T005 → T006 → T007 (misma migración, secuencial). T010 → T011 → T012
(mismo archivo, secuencial). T016 → T017.

US2 y US3 son independientes entre sí y ambas dependen de US1, porque las tres modifican
`send-outbound-message.ts`. Si se trabajan en paralelo, hay que coordinar ese archivo.

US4 depende de US3 porque la selección de canal se ejecuta después del gate de política.

## Parallel Opportunities

**Fase 1**: T002, T003, T004 en paralelo tras T001.

**Fase 2**: tres pistas simultáneas —
esquema (T005→T006→T007), cliente de Telegram (T010→T011→T012→T013), y
puertos + dominio (T008, T009, T014, T015, T018 en paralelo).

**Fase 3**: T023, T024, T025 en paralelo una vez que T021 esté listo.

**Fase 5**: T030 y T031 en paralelo con el resto; T034 y T036 en paralelo.

**Fase 6**: T037 y T038 en paralelo con T039; T044 y T045 en paralelo.

**Fase 7**: todo excepto T049 y T052, que van al final.

## Implementation Strategy

**MVP = Fase 1 + Fase 2 + Fase 3 (US1)**. Al terminar la fase 3 el orquestador ya envía
por Telegram con confirmación real, que es lo que destraba el piloto. Son 25 tareas.

Después, en orden de valor: US2 (no duplicar) y US3 (no escribirle a quien no
corresponde) son las dos garantías que hacen seguro apoyar automatismos encima. US4
(segundo canal) agrega alcance de entrega pero no es condición para operar.

**Entrega incremental**: cada fase de historia deja el sistema en un estado consistente y
verificable. No hace falta llegar a US4 para poner US1 en uso.


---

## Estado de ejecución (2026-08-18)

**51 de 53 completadas.** Verificación: typecheck 0 errores, lint 0, build de
producción en verde, 672 unitarias y 18 nuevas de integración pasando.

### Sin ejecutar

- **T049** — necesita el bot token de producción y un chat de Telegram real. Es la
  única prueba que confirma el desbloqueo de EXT-05 de punta a punta.
- **T053** — la skill hace commit; queda a decisión del usuario.

### Hallazgo bloqueante preexistente, ajeno a esta feature

La migración limpia desde cero está rota en `main`: `20260805000001_universal_business_memory.sql`
(commit 9d92e09) y `20260809020001_phase6_knowledge_base.sql` (commit cd74d92) crean
ambas la tabla `knowledge_chunks`.

Consecuencias: `supabase db reset` falla, y con él `npm run test:db:reset-loop`,
`test:db:lint` y `test:db:invariants` (T007 quedó verificado sobre un PostgreSQL
levantado a mano, no por la vía del proyecto). 22 tests de integración fallan por
esta causa —idénticos en `main` y en esta rama, comprobado con un worktree—, así que
no son regresiones de la 007.

Resolverlo exige decidir cuál de las dos definiciones de `knowledge_chunks` queda,
y eso toca migraciones ya aplicadas: decisión del usuario, no de esta feature.
