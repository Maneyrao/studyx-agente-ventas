# Research: Contact Identity Foundation

## Stack decisions

### Next.js App Router + Route Handlers
- **Decision**: Route Handlers en `src/app/api/` como endpoints del orquestador.
- **Rationale**: Serverless nativo en Vercel, sin cold start adicional, soporte de
  Edge Runtime para middleware de validación. App Router permite colocar middleware
  compartido sin duplicación.
- **Alternatives considered**: Express standalone (descartado: overhead de servidor
  dedicado), tRPC (descartado: overkill para una API interna sin cliente TypeScript
  generado en el lado del agente).

### Supabase + PostgreSQL + pgvector
- **Decision**: Supabase como BaaS; pgvector para índice vectorial; service_role key
  restringida a INSERT/UPDATE mediante Row Level Security (RLS) + rol de BD dedicado.
- **Rationale**: pgvector con índice HNSW sobre una tabla PostgreSQL estándar evita
  introducir un vector store externo (Pinecone, Weaviate) en el MVP. Supabase provee
  gestión de conexiones (pgBouncer), backups automáticos y CLI para migraciones.
- **Alternatives considered**: Pinecone (descartado: vendor adicional, latencia de
  red extra, costo), Neon (descartado: sin BaaS completo), PlanetScale (descartado:
  MySQL, sin pgvector).

### HNSW con distancia coseno
- **Decision**: `CREATE INDEX USING hnsw (embedding vector_cosine_ops)` con
  `m=16, ef_construction=64`.
- **Rationale**: HNSW no requiere entrenamiento previo (a diferencia de IVFFlat),
  tiene mejor recall a latencias equivalentes para datasets < 1M vectores, y los
  parámetros conservadores (m=16) balancean uso de memoria y velocidad para un MVP.
  Distancia coseno es la apropiada para embeddings de texto normalizados.
- **Alternatives considered**: IVFFlat (requiere `VACUUM ANALYZE` y número de listas
  estimado), búsqueda exacta sin índice (descartada: O(n) inviable a escala).

### OpenAI text-embedding-3-small (1 536 dim)
- **Decision**: Modelo de embeddings para todos los mensajes. Llamada síncrona con
  fallback a estado `pending` si falla.
- **Rationale**: 1 536 dimensiones, mejor calidad que ada-002 al mismo costo,
  compatible con español, ampliamente documentado con pgvector.
- **Alternatives considered**: text-embedding-3-large (3072 dims, mayor costo de
  almacenamiento sin ganancia proporcional para este dominio), sentence-transformers
  local (requiere servidor dedicado, no encaja en Vercel serverless).

### Upsert atómico para resolución de contacto
- **Decision**: `INSERT INTO contacts … ON CONFLICT (phone) DO NOTHING RETURNING *`
  combinado con un `SELECT` posterior si el INSERT no devuelve filas.
- **Rationale**: Garantía de unicidad a nivel de BD con un único round-trip. La
  constraint `UNIQUE` en la columna `phone` hace imposible el duplicado aunque lleguen
  N solicitudes simultáneas. No requiere lock de aplicación ni transacción distribuida.
- **Alternatives considered**: SELECT-then-INSERT con lock advisory (más complejo,
  mismo resultado), Supabase `.upsert()` (usa ON CONFLICT UPDATE, actualiza campos
  innecesariamente en cada hit; preferimos DO NOTHING para no tocar opt-in timestamp).

### Credencial de BD con permisos restringidos
- **Decision**: Rol PostgreSQL `orchestrator_role` con GRANT INSERT, UPDATE sobre
  tablas críticas. REVOKE DELETE, TRUNCATE. La tabla `audit_log` tiene GRANT INSERT
  únicamente. Supabase service_role key usa este rol.
- **Rationale**: Cumple Principio IV de la constitución: la seguridad es de permisos,
  no de instrucciones. Aunque el código tenga un bug que genere un DELETE, la BD
  lo rechaza.
- **Note**: Supabase expone dos keys: `anon` (con RLS) y `service_role` (bypass RLS).
  El orquestador usa `service_role` pero a través del rol restringido. RLS actúa
  como defensa en profundidad adicional.

### Middleware de autenticación del orquestador
- **Decision**: Header `X-Orchestrator-Key` validado en `src/middleware.ts` de Next.js
  para todas las rutas `/api/*`. Valor almacenado en variable de entorno del servidor.
- **Rationale**: Los agentes (Botpress, Retell) nunca llaman directamente a estos
  endpoints; solo el orquestador lo hace. Una API key interna simple es suficiente
  para el MVP sin introducir JWT o OAuth.
- **Alternatives considered**: mTLS (demasiado complejo para MVP), JWT (overhead
  innecesario para llamadas servidor-a-servidor sin usuarios humanos en el loop).

### Embeddings asincrónicos (best-effort)
- **Decision**: El mensaje se persiste de forma síncrona. La generación del embedding
  se intenta en el mismo request con un timeout de 5s; si falla, el mensaje queda
  con `status = 'pending'` en `message_embeddings`. Un Vercel Cron (cada 5 min) reintenta
  los pendientes.
- **Rationale**: Cumple FR-012 y SC-004: la indisponibilidad del vector store no
  bloquea el registro de mensajes. El Vercel Cron es gratuito en el plan Hobby y
  no requiere infraestructura adicional.
- **Alternatives considered**: Supabase pg_cron (requiere extensión habilitada en
  plan pago), cola de mensajes dedicada (SQS, BullMQ — overkill para el volumen
  esperado en el MVP).

### Logging estructurado
- **Decision**: `console.log(JSON.stringify({ level, event, contact_id, … }))` en
  cada operación crítica. Vercel captura stdout como logs estructurados consultables
  en el dashboard y via CLI.
- **Rationale**: Sin infraestructura adicional (no Datadog, no Grafana en MVP).
  Los contadores de eventos (contactos creados, mensajes registrados, búsquedas,
  embeddings pendientes) se emiten como campos en el log estructurado.
- **Alternatives considered**: Pino (mejor performance, pero requiere configuración
  extra en Edge Runtime), OpenTelemetry (deferido a sprint de observabilidad).
