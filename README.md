# StudyX — agente de ventas

Backend canónico para un agente de ventas por WhatsApp. Botpress coordina la conversación; Next.js valida las decisiones; PostgreSQL/Supabase conserva identidad, consentimiento, mensajes, memoria derivada, auditoría y estado de entrega.

## Estado

El núcleo local está listo para un piloto supervisado:

- Ingesta idempotente por proveedor, integración y mensaje externo.
- Una sola conversación abierta por contacto/canal y por thread externo.
- Una sola decisión y un solo outbound lógico por inbound.
- Bloqueo, consentimiento y etapa comercial separados.
- Outbox transaccional, leases, reintentos y estados terminales.
- Embeddings asíncronos y reconstruibles; PostgreSQL sigue siendo la fuente de verdad.
- HMAC, timestamp y secreto de orquestador para las rutas del agente.
- Migraciones verificadas desde cero en tres clústeres PostgreSQL 17.

El único entregable de hoy es un **demo controlado de WhatsApp Sandbox**, no
producción. La regresión local está en 20/50 (el gate es 50/50), por lo que no
están autorizados despliegues, instalación/autorización de Botpress/Meta,
secretos cloud ni mensajes. Task 5 (canary externa) sigue bloqueada hasta una
autorización explícita; la automatización del adapter permanece deshabilitada
por defecto.

## Configuración

Copiar `.env.example` a `.env.local` y completar secretos reales fuera de Git.

```bash
npm install
npm run dev
```

Variables obligatorias en producción:

- `DATABASE_URL`: conexión Supabase del rol orquestador.
- `ORCHESTRATOR_API_KEY`: secreto compartido con Botpress.
- `ORCHESTRATOR_KEY_ID`: identificador no secreto de la clave activa; debe coincidir con Botpress.
- `STUDYX_SIGNING_SECRET`: secreto HMAC independiente.
- `CRON_SECRET`: autorización de Vercel Cron.
- `OPENAI_API_KEY`: sólo para embeddings/resúmenes; su caída no impide persistir un inbound.

## Contrato Botpress

```text
POST /api/agent/ingest
POST /api/agent/turns/:turn_id/decision
POST /api/agent/outbounds/:outbound_id/delivery
```

Los esquemas exactos viven en `botpress-agent/src/schemas/contracts.ts`. `/api/agent/reply` permanece como adapter legacy y delega en la misma decisión transaccional.

## Verificación

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Con una base local desechable:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test \
DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test \
npm run test:integration
```

En macOS con PostgreSQL 17 y pgvector instalados, `bash scripts/verify-native-postgres-loop.sh` crea y migra tres clústeres aislados.

## WhatsApp: runbook y despliegue seguro

El procedimiento controlado, las precondiciones de Meta/Botpress, los comandos
de health/ready/readiness, las ocho pruebas, la evidencia sin PII, y el
rollback están en [docs/runbooks/whatsapp-go-live.md](docs/runbooks/whatsapp-go-live.md).
Ese documento separa demo Sandbox, canary de producción y disponibilidad
general; no habilita producción.

1. Llegar a la regresión local 50/50 y pasar ambos builds.
2. Obtener autorización separada antes de cualquier mutación externa.
3. Seguir el runbook por gates; primero Sandbox con un único tester.
4. Conservar evidencia y reconciliar cualquier entrega ambigua sin reenviar a ciegas.

La matriz de fallos y los límites actuales están en [docs/FAILURE_MATRIX.md](docs/FAILURE_MATRIX.md). La secuencia de trabajo está en [docs/ROADMAP.md](docs/ROADMAP.md).
