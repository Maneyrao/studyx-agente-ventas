# Implementation Plan: Agent Message Ingestion Endpoint

**Branch**: `002-agent-message-ingestion` | **Date**: 2026-06-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-agent-message-ingestion/spec.md`

## Summary

Construir el punto de entrada del orquestador que reemplaza el acceso directo del agente
de texto a la base de datos. Se exponen **dos Route Handlers**: uno de **ingesta**
(`POST /api/agent/ingest`) que identifica/crea el contacto, registra el mensaje entrante y
devuelve un **paquete de contexto consolidado** (identificador de turno, estado, resumen,
turnos recientes y, condicionalmente, memoria de largo plazo); y uno de **registro de
respuesta** (`POST /api/agent/reply`) que persiste el mensaje saliente correlacionado por
identificador de turno, incrementa el contador de turnos y regenera el resumen por umbral.

El enfoque técnico es **orquestar primitivos ya existentes** de la feature 001
(`resolveContact`, `registerMessage`, `getRecentMessages`, `semanticSearch`,
`auditLog`) detrás de un servicio de orquestación nuevo, agregando solo: (a) dos
heurísticas deterministas en TypeScript (referencia-al-pasado y trivialidad), (b) un
servicio de resumen por umbral, y (c) una migración que añade a `contacts` las columnas de
resumen y contador, y a `messages` el vínculo de correlación de turno.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Next.js 16 (App Router, Route Handlers), React 19, runtime Node de Vercel.

**Primary Dependencies**: `next@^16`, `postgres@^3` (postgres.js, conexión `max:1` como `orchestrator_role` vía Supavisor en modo transacción), `openai@^6` (embeddings + chat de resumen), `zod@^4` (validación de inputs).

**Storage**: Supabase PostgreSQL 15 + pgvector instalado en el esquema `extensions` (índice HNSW coseno, `m=16`). Tablas reutilizadas: `contacts`, `conversations`, `messages`, `message_embeddings`, `audit_log`.

**Testing**: No hay framework de pruebas automatizadas configurado en el repo (igual que la 001). La validación se realiza mediante los escenarios `curl` de `quickstart.md` contra un entorno local/remoto. (No bloqueante; consistente con la feature previa.)

**Target Platform**: Vercel serverless (funciones Node, una conexión de BD por invocación).

**Project Type**: Web service — orquestador HTTP interno (Route Handlers bajo `src/app/api/`).

**Performance Goals** *(informativos, no normativos — no hay SC de latencia absoluta; SC-006 es comparativo)*:
- Turno **trivial** (sin referencia al pasado): contexto devuelto sin búsqueda semántica ni regeneración de resumen; solo upsert de contacto + lookup de conversación + insert de mensaje (+ embedding de almacenamiento heredado de 001). Referencia orientativa p95 < 400 ms.
- Turno **referencial**: agrega 1 generación de embedding de la consulta + 1 búsqueda vectorial HNSW. Referencia orientativa p95 < 1 s.
- Regeneración de resumen (cada ~10 turnos, fuera de la ruta trivial): 1 llamada chat acotada; no debe bloquear la respuesta del turno ante fallo (degradación, FR-015).
- El criterio verificable es **relativo** (SC-006: la ruta trivial evita por completo el costo de búsqueda y resumen); los números p95 son guías de diseño, no condiciones de aceptación.

**Constraints** (incluye recordatorio de implementación del usuario):
- pgvector vive en el esquema `extensions`, **no** en `public`. Todo cast a vector DEBE ser explícito (`::extensions.vector`) y no depender del `search_path` de sesión (el pooler en modo transacción no lo garantiza entre queries). El rol que use vectores requiere `GRANT USAGE ON SCHEMA extensions` (ya otorgado en `20260623184404_grant_extensions_usage.sql`).
- El código nuevo de esta feature **no introduce SQL de vectores nuevo**: reutiliza `registerMessage` y `search_contact_memory`, que ya hacen casts explícitos y fijan `SET search_path = public, extensions` en la función. Cualquier SQL nuevo que tocara vectores debería seguir la misma regla.
- `orchestrator_role` opera con `INSERT/UPDATE/SELECT` y **sin** `DELETE` sobre tablas críticas; las nuevas columnas heredan los grants a nivel de tabla.

**Scale/Scope**: Volumen bajo-medio (agente de ventas conversacional). Una conversación `open` activa por contacto/canal. Ventana de turnos recientes configurable (5–10). Umbral de resumen configurable (~10 turnos).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Aplicación en esta feature | Estado |
|-----------|----------------------------|--------|
| **I. Fuente Única de Verdad** | Toda la lógica de negocio (resolución de contacto, decisión de recuperar memoria, regeneración de resumen) vive en el orquestador; el agente solo envía/recibe vía los dos endpoints. | ✅ |
| **II. Menor Privilegio** | El agente no recibe credenciales de BD (FR-010); el contexto devuelto solo contiene datos de negocio. El agente invoca un set acotado de 2 endpoints. La heurística de referencia evita exponer la memoria salvo cuando corresponde. | ✅ |
| **III. Identidad y 2FA** | Esta feature no ejecuta acciones sensibles (no entrega datos de cuenta ni resets); solo registra mensajes y arma contexto. El 2FA aplica a features posteriores que consuman este contexto. | ✅ N/A directa |
| **IV. Nunca Eliminar Datos** | Ninguna operación hace `DELETE`. La migración solo agrega columnas/índices; `orchestrator_role` sigue sin `DELETE`. Mensajes y resúmenes son append/overwrite-in-place sin borrado. | ✅ |
| **V. Validación de Webhooks** | El llamante es el agente interno (Botpress), autenticado por el middleware `X-Orchestrator-Key` (no es un webhook de proveedor con firma). El middleware rechaza con 401 antes de tocar lógica (FR-013). Los webhooks de proveedores (pagos/voz) quedan fuera de esta feature. | ✅ |
| **VI. Aislamiento de Memoria** | Toda búsqueda de largo plazo pasa por `semanticSearch`/`search_contact_memory`, que **exige y filtra por `contact_id`** (FR-011, SC-005). No se añade ningún camino de consulta sin ese filtro. | ✅ |
| **VII. Scope Acotado** | El endpoint solo arma contexto; no inventa datos. El resumen se genera a partir de mensajes reales del propio contacto. La degradación nunca fabrica memoria inexistente. | ✅ |
| **VIII. Acciones Irreversibles a Humano** | No se ejecuta ninguna acción irreversible ni sobre dinero. | ✅ N/A directa |

**Architecture Constraints**: el orquestador expone API tipada (Zod); el agente es cliente exclusivo; el `audit_log` se escribe solo vía `write_audit_log()` (SECURITY DEFINER, rol `audit_writer`) — reutilizado sin cambios; la memoria rechaza queries sin `contact_id` en tiempo de ejecución.

**Resultado del gate**: PASS — sin violaciones. Sección *Complexity Tracking* no aplica.

## Project Structure

### Documentation (this feature)

```text
specs/002-agent-message-ingestion/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — decisiones técnicas
├── data-model.md        # Fase 1 — cambios de esquema y entidades
├── quickstart.md        # Fase 1 — escenarios de validación curl
├── contracts/
│   └── api.md           # Fase 1 — contratos de /api/agent/ingest y /api/agent/reply
└── tasks.md             # Fase 2 — generado por /speckit-tasks (NO por /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── api/
│       └── agent/
│           ├── ingest/route.ts      # NUEVO — POST: ingesta + contexto consolidado
│           └── reply/route.ts       # NUEVO — POST: registro de respuesta saliente
├── lib/
│   ├── services/
│   │   ├── ingestion.service.ts     # NUEVO — orquesta contacto+conversación+mensaje+contexto
│   │   ├── summary.service.ts       # NUEVO — regeneración de resumen por umbral
│   │   ├── contact.service.ts       # REUTILIZADO — resolveContact()
│   │   ├── conversation.service.ts  # EXTENDIDO — findOpenConversation()/getOrCreateOpenConversation()
│   │   ├── message.service.ts       # REUTILIZADO/EXTENDIDO — registerMessage() + vínculo in_reply_to
│   │   └── memory.service.ts        # REUTILIZADO — getRecentMessages(), semanticSearch()
│   └── heuristics/
│       ├── reference-detection.ts   # NUEVO — referencesPast(content): boolean
│       └── triviality.ts            # NUEVO — isTrivial(content): boolean
└── middleware.ts                    # REUTILIZADO — auth X-Orchestrator-Key (cubre /api/agent/*)

supabase/
└── migrations/
    └── 20260625XXXXXX_contact_summary_and_turn_link.sql  # NUEVO
        # ALTER contacts ADD summary, summary_updated_at, pending_turns
        # ALTER messages ADD in_reply_to + índice único parcial (un outbound por turno)
```

**Structure Decision**: Se mantiene el patrón de la 001 (Route Handlers delgados que delegan en servicios de `src/lib`). Los handlers nuevos viven bajo `src/app/api/agent/` para agrupar el contrato que consume el agente conversacional. La lógica de orquestación se concentra en `ingestion.service.ts`; las heurísticas deterministas se aíslan en `src/lib/heuristics/` para ser testeables de forma unitaria sin BD. El middleware existente ya protege `/api/:path*`, por lo que `/api/agent/*` queda autenticado sin cambios.

## Complexity Tracking

> No aplica — el Constitution Check pasó sin violaciones.
