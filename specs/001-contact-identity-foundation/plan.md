# Implementation Plan: Contact Identity Foundation

**Branch**: `001-contact-identity-foundation` | **Date**: 2026-06-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-contact-identity-foundation/spec.md`

## Summary

Implementar el servicio de identidad de contactos del orquestador: un sistema que
crea y recupera identidades únicas ancladas a números de teléfono E.164, registra
conversaciones y mensajes, y provee memoria de largo plazo por similitud semántica
siempre aislada por `contact_id`.

Stack: Next.js 16 App Router (Route Handlers) en Vercel, Supabase (PostgreSQL +
pgvector con índice HNSW coseno), postgres.js con conexiones directas vía Supavisor
usando roles de BD propios (sin service_role en runtime), embeddings vía OpenAI
text-embedding-3-small (1 536 dim), middleware de autenticación por API key interna.

## Technical Context

**Language/Version**: TypeScript 5 / Node.js 20 (Next.js 16.2+)

**Primary Dependencies**:
- `next` 16 — framework y Route Handlers
- `postgres` (postgres.js) v3 — cliente SQL directo con dos instancias de rol
- `openai` SDK v4 — generación de embeddings (text-embedding-3-small)
- `zod` — validación de schemas de entrada en cada Route Handler
- `@supabase/supabase-js` — devDependency únicamente (Supabase CLI + generación de tipos)

**Storage**: Supabase PostgreSQL 15 + extensión `pgvector`; índice HNSW con
`vector_cosine_ops` (m=16, ef_construction=64); conexiones vía Supavisor (transaction
mode) autenticadas como `orchestrator_role` y `audit_writer` respectivamente

**Testing**: Vitest + `@testing-library/react` (si aplica UI); integración con
Supabase local vía `supabase start`

**Target Platform**: Vercel Serverless Functions (Node.js runtime); Supabase en
región us-east-1 o sa-east-1 (según latencia objetivo)

**Project Type**: Web service (API interna del orquestador)

**Performance Goals**:
- Resolución de contacto: < 200 ms p95
- Recuperación de memoria reciente: < 100 ms p95 (conversaciones ≤ 500 mensajes)
- Búsqueda semántica: < 2 s p95 (contactos con ≤ 1 000 mensajes indexados)

**Constraints**:
- `orchestrator_role` y `audit_writer` son roles de conexión con LOGIN propio; ninguno
  es superusuario — los GRANTs/REVOKEs son efectivos a nivel de BD
- `SUPABASE_SERVICE_ROLE_KEY` no se usa en el runtime del orquestador (solo en CLI dev/CI)
- Toda búsqueda semántica DEBE incluir filtro `contact_id`; rechazada en ausencia
- No existe endpoint DELETE en ningún recurso
- Embeddings: best-effort (mensaje persiste aunque falle el vector store)

**Scale/Scope**: MVP — decenas de contactos concurrentes, sin requisito de sharding

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Verificación | Estado |
|-----------|-------------|--------|
| I. Fuente Única de Verdad | Route Handlers son los únicos endpoints; Botpress/Retell llaman al orquestador, no a estos endpoints directamente | ✅ |
| II. Menor Privilegio | `orchestrator_role` con LOGIN propio conecta vía Supavisor — no es superusuario, GRANTs y REVOKEs son efectivos; `audit_writer` con LOGIN propio es la única identidad con INSERT en `audit_log`; zod valida cada input en la capa HTTP | ✅ |
| III. Identidad y 2FA | Validación E.164 en capa de servicio; email guardado para 2FA futuro; agentes nunca ven passwords | ✅ (2FA completo en sprint posterior) |
| IV. Nunca Eliminar Datos | `REVOKE DELETE` a nivel BD; soft-delete con `deleted_at`; `audit_log` solo INSERT | ✅ |
| V. Validación de Webhooks | Middleware `X-Orchestrator-Key` en `src/middleware.ts` para todas las rutas `/api/*` | ✅ |
| VI. Aislamiento de Memoria | Función SQL `search_contact_memory` con `WHERE contact_id = $1` estructural; servicio rechaza búsquedas sin filtro | ✅ |
| VII. Scope Acotado | Endpoints solo exponen operaciones del dominio; ningún endpoint de propósito general | ✅ |
| VIII. Acciones Irreversibles a Humano | No hay bajas, cancelaciones ni reembolsos en este servicio | ✅ N/A |

**Resultado**: Todos los principios satisfechos. Sin violaciones que justificar.

## Project Structure

### Documentation (this feature)

```text
specs/001-contact-identity-foundation/
├── plan.md         # Este archivo
├── research.md     # Decisiones técnicas (Phase 0)
├── data-model.md   # Esquema BD + roles + función de búsqueda
├── quickstart.md   # Guía de validación end-to-end
├── contracts/
│   └── api.md      # Contratos de los 5 endpoints
└── tasks.md        # Generado por /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── app/
│   └── api/
│       ├── contacts/
│       │   └── route.ts              # POST (resolver/crear contacto)
│       ├── conversations/
│       │   ├── route.ts              # POST (crear conversación)
│       │   └── [id]/
│       │       └── route.ts          # PATCH (actualizar estado/intención)
│       ├── messages/
│       │   └── route.ts              # POST (registrar mensaje)
│       └── memory/
│           ├── recent/
│           │   └── route.ts          # GET (últimos N turnos)
│           └── search/
│               └── route.ts          # POST (búsqueda semántica)
├── lib/
│   ├── db/
│   │   ├── orchestrator.ts           # postgres.js como orchestrator_role (Supavisor)
│   │   └── audit.ts                  # postgres.js como audit_writer (Supavisor)
│   ├── supabase/
│   │   └── database.types.ts         # Tipos generados por Supabase CLI (dev tooling)
│   ├── services/
│   │   ├── contact.service.ts        # upsert atómico, validación E.164
│   │   ├── conversation.service.ts   # crear y actualizar conversaciones
│   │   ├── message.service.ts        # registrar mensaje + trigger embedding
│   │   └── memory.service.ts         # memoria reciente y búsqueda semántica
│   ├── embeddings/
│   │   └── openai.ts                 # Wrapper text-embedding-3-small
│   ├── audit/
│   │   └── logger.ts                 # append-only audit log writer
│   └── observability/
│       └── structured-log.ts         # Logging estructurado JSON
├── middleware.ts                     # Validación X-Orchestrator-Key global
supabase/
├── migrations/
│   ├── 20260623000001_enable_pgvector.sql
│   ├── 20260623000002_contacts.sql
│   ├── 20260623000003_conversations.sql
│   ├── 20260623000004_messages.sql
│   ├── 20260623000005_message_embeddings.sql
│   ├── 20260623000006_audit_log.sql
│   ├── 20260623000007_hnsw_index.sql
│   ├── 20260623000008_roles.sql
│   ├── 20260623000009_audit_write_function.sql
│   └── 20260623000010_search_function.sql
└── seed/
    └── dev.sql
```

**Structure Decision**: Single project (Next.js App Router). El directorio `src/app/api/`
contiene los Route Handlers del orquestador. La lógica de negocio está en `src/lib/services/`,
completamente separada de la capa HTTP para facilitar testing unitario.

## Complexity Tracking

> No hay violaciones a la constitución que justificar en este plan.
