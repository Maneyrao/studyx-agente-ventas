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

El piloto real de WhatsApp sigue bloqueado hasta instalar/autenticar la integración oficial en Botpress. La automatización del adapter está deshabilitada por defecto.

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

## Despliegue seguro

1. Revisar y aplicar las migraciones `20260805010001` a `20260805010008` en staging.
2. Rotar credenciales históricas antes de producción; editar una migración vieja no rota un secreto ya expuesto.
3. Configurar los secretos equivalentes en Vercel y Botpress.
4. Instalar la integración oficial de WhatsApp y confirmar sus IDs/tipos reales.
5. Ejecutar el flujo completo en modo supervisado y reconciliar cualquier entrega ambigua sin reenviar a ciegas.

La matriz de fallos y los límites actuales están en [docs/FAILURE_MATRIX.md](docs/FAILURE_MATRIX.md). La secuencia de trabajo está en [docs/ROADMAP.md](docs/ROADMAP.md).
